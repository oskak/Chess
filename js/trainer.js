/**
 * Spaced Repetition Trainer Engine
 *
 * A repertoire is a move tree; every leaf is a training "line". Lines are
 * scheduled with SM-2 on their leaf node. Within a line every player move is
 * also tracked individually (node.moveStats) so weak spots can be found.
 *
 * Per line: nextLine() → playOpponentMove() / submitMove() ... The line
 * completes automatically when its last move is played — by either side, or
 * via playCorrectMove() — and is graded by the mistakes made along the way.
 *
 * New (never-seen) lines are first *learned*: the expected move is revealed
 * and the player replays it. Learned lines come back for a cold review later.
 */

class Trainer {
    // First cold review of a freshly learned line.
    static LEARN_REVIEW_DELAY_MS = 4 * 60 * 60 * 1000;

    constructor(moveTree) {
        this.tree = moveTree;
        this.chess = new Chess();
        this.currentLine = null;        // Current line being practiced (array of SAN)
        this.currentMoveIndex = 0;      // Index of the next move to be played
        this.currentNode = null;        // Tree node of the position on the board
        this.sessionStats = this._emptyStats();
        this.lineQueue = [];            // Lines still to practice this session
        this.completedLines = [];       // Lines completed this session
        this.state = 'idle';            // idle, playing, waiting, finished

        this.learnNewLines = true;      // reveal moves of never-seen lines
        this.isLearning = false;        // current line is being learned, not tested
        this.lineMistakes = 0;          // positions missed in the current line
        this.lineCompleted = false;
        this.positionFailed = false;    // player already erred at the current move
        this._requeued = new Set();     // failed lines already re-queued this session

        this.wrongMoveCallback = null;
        this.correctMoveCallback = null;
        this.opponentMoveCallback = null;
        this.lineCompleteCallback = null;
        this.sessionCompleteCallback = null;
    }

    _emptyStats() {
        return {
            total: 0,          // lines completed
            correct: 0,        // player moves found on the first try
            wrong: 0,          // player moves missed (counted once per position)
            newLines: 0,       // first cold review of a line
            reviewedLines: 0,  // later reviews
            perfectLines: 0,   // reviewed lines without a single miss
            learnedLines: 0    // lines learned (shown) this session
        };
    }

    /**
     * Start a training session.
     * @param {Object} options
     * @param {number} options.lineLimit - Max lines per session
     * @param {string} options.mode - 'review' (due), 'new' (unlearned), 'mix' (both), 'all'
     * @param {string[]} options.startFromMoves - Only train lines below this position
     * @param {boolean} options.learnNewLines - Reveal moves of never-seen lines (default true)
     */
    startSession(options = {}) {
        const {
            lineLimit = 20,
            mode = 'mix',
            startFromMoves = null,
            learnNewLines = true
        } = options;

        this.learnNewLines = learnNewLines;
        this.sessionStats = this._emptyStats();
        this.completedLines = [];
        this._requeued = new Set();
        this.currentLine = null;
        this.lineCompleted = false;
        this.lineQueue = this._buildLineQueue(mode, lineLimit, startFromMoves);
        this.state = this.lineQueue.length > 0 ? 'playing' : 'finished';

        return {
            totalLines: this.lineQueue.length,
            state: this.state
        };
    }

    _buildLineQueue(mode, limit, startFrom) {
        const now = Date.now();
        const allLines = [];
        const startNode = startFrom ? this.tree.getNodeAt(startFrom) : this.tree.root;
        if (!startNode) return [];

        this._collectAllLines(startNode, startFrom ? [...startFrom] : [], allLines);

        const newLines = [];
        const dueLines = [];
        const otherLines = [];

        for (const line of allLines) {
            const leafNode = this.tree.getNodeAt(line);
            if (!leafNode) continue;

            if (!leafNode.stats.lastReviewed) {
                newLines.push(line);
            } else if (leafNode.stats.nextReview && leafNode.stats.nextReview <= now) {
                dueLines.push(line);
            } else {
                otherLines.push(line);
            }
        }

        // Shuffle within categories
        this._shuffle(newLines);
        this._shuffle(dueLines);
        this._shuffle(otherLines);

        // Most overdue first
        dueLines.sort((a, b) => {
            const nodeA = this.tree.getNodeAt(a);
            const nodeB = this.tree.getNodeAt(b);
            return (nodeA.stats.nextReview || 0) - (nodeB.stats.nextReview || 0);
        });

        let queue = [];
        switch (mode) {
            case 'review':
                queue = dueLines;
                break;
            case 'new':
                queue = newLines;
                break;
            case 'mix':
                // Interleave: 3 due for every 1 new
                while (queue.length < limit && (dueLines.length > 0 || newLines.length > 0)) {
                    for (let i = 0; i < 3 && dueLines.length > 0 && queue.length < limit; i++) {
                        queue.push(dueLines.shift());
                    }
                    if (newLines.length > 0 && queue.length < limit) {
                        queue.push(newLines.shift());
                    }
                }
                break;
            case 'all':
                queue = [...dueLines, ...newLines, ...otherLines];
                break;
        }

        return queue.slice(0, limit);
    }

    _collectAllLines(node, currentPath, lines) {
        // Skip disabled nodes and their subtrees
        if (!node.enabled && currentPath.length > 0) return;

        if (node.isLeaf() && currentPath.length > 0) {
            // A line in which the player never moves has nothing to train.
            if (this._hasPlayerMove(currentPath)) lines.push([...currentPath]);
            return;
        }
        for (const [moveSan, child] of node.children) {
            currentPath.push(moveSan);
            this._collectAllLines(child, currentPath, lines);
            currentPath.pop();
        }
    }

    /** True if move index i (0 = White's first move) is played by the user. */
    _isPlayerIndex(i) {
        return (this.tree.color === 'white') === (i % 2 === 0);
    }

    _hasPlayerMove(line) {
        for (let i = 0; i < line.length; i++) {
            if (this._isPlayerIndex(i)) return true;
        }
        return false;
    }

    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    /**
     * Get the next line to practice.
     * Returns null if session is complete.
     */
    nextLine() {
        if (this.lineQueue.length === 0) {
            this.state = 'finished';
            this.currentLine = null;
            if (this.sessionCompleteCallback) {
                this.sessionCompleteCallback(this.sessionStats);
            }
            return null;
        }

        this.currentLine = this.lineQueue.shift();
        this.currentMoveIndex = 0;
        this.currentNode = this.tree.root;
        this.chess.reset();
        this.state = 'playing';
        this.lineMistakes = 0;
        this.lineCompleted = false;
        this.positionFailed = false;

        const leaf = this.tree.getNodeAt(this.currentLine);
        this.isLearning = this.learnNewLines && !!leaf && !leaf.stats.lastReviewed;

        return {
            line: this.currentLine,
            fen: this.chess.fen(),
            isPlayerTurn: this.isPlayerMove(),
            isLearning: this.isLearning,
            totalMoves: this.currentLine.length,
            currentMove: 0
        };
    }

    /**
     * Check if the current position requires a player move.
     */
    isPlayerMove() {
        if (!this.currentLine || this.currentMoveIndex >= this.currentLine.length) return false;
        return this._isPlayerIndex(this.currentMoveIndex);
    }

    /**
     * The move expected next in the current line, with squares for arrows/hints.
     * @returns {{san, from, to, promotion}|null}
     */
    getExpectedMove() {
        if (!this.currentLine || this.currentMoveIndex >= this.currentLine.length) return null;
        const probe = new Chess(this.chess.fen());
        const m = probe.move(this.currentLine[this.currentMoveIndex], { sloppy: true });
        return m ? { san: m.san, from: m.from, to: m.to, promotion: m.promotion } : null;
    }

    /** How many of the player's moves in this line are done, out of how many. */
    getLinePosition() {
        if (!this.currentLine) return { done: 0, total: 0 };
        let total = 0, done = 0;
        for (let i = 0; i < this.currentLine.length; i++) {
            if (!this._isPlayerIndex(i)) continue;
            total++;
            if (i < this.currentMoveIndex) done++;
        }
        return { done, total };
    }

    /**
     * Get the opponent's next move (auto-play).
     * Returns null if it's the player's turn or line is complete.
     */
    getOpponentMove() {
        if (!this.currentLine || this.isPlayerMove()) return null;
        if (this.currentMoveIndex >= this.currentLine.length) return null;
        return this.currentLine[this.currentMoveIndex];
    }

    /**
     * Play the opponent's move automatically.
     */
    playOpponentMove() {
        if (this.state !== 'playing') return null;
        const move = this.getOpponentMove();
        if (!move) return null;

        const result = this.chess.move(move, { sloppy: true });
        if (!result) return null;

        const isLineComplete = this._advance(result);
        const info = {
            move: result,
            fen: this.chess.fen(),
            moveIndex: this.currentMoveIndex,
            isLineComplete
        };

        if (this.opponentMoveCallback) {
            this.opponentMoveCallback(info);
        }

        return info;
    }

    /**
     * Submit a player's move attempt.
     * @returns {Object} { valid, correct, isAlternative, ... }
     *   - correct: the expected move of this line
     *   - isAlternative: another move from the repertoire at this position;
     *     not counted as a mistake, the player is asked for this line's move
     *   - otherwise a genuine mistake; the move is taken back
     */
    submitMove(from, to, promotion) {
        if (this.state !== 'playing' || !this.currentLine || this.currentMoveIndex >= this.currentLine.length) {
            return { valid: false, error: 'No active line' };
        }
        if (!this.isPlayerMove()) {
            return { valid: false, error: 'Not your move' };
        }

        const expectedMove = this.currentLine[this.currentMoveIndex];

        const moveObj = { from, to };
        if (promotion) moveObj.promotion = promotion;

        const result = this.chess.move(moveObj);
        if (!result) {
            return { valid: false, error: 'Illegal move' };
        }

        if (result.san === expectedMove) {
            const node = this.currentNode ? this.currentNode.getChild(result.san) : null;
            if (!this.isLearning) {
                if (node) this._recordMoveAttempt(node, !this.positionFailed);
                if (!this.positionFailed) this.sessionStats.correct++;
            }
            this.positionFailed = false;

            const isLineComplete = this._advance(result);
            const info = {
                valid: true,
                correct: true,
                isAlternative: false,
                move: result,
                fen: this.chess.fen(),
                moveIndex: this.currentMoveIndex,
                isLineComplete
            };

            if (this.correctMoveCallback) {
                this.correctMoveCallback(info);
            }
            return info;
        }

        // Not the expected move — take it back.
        this.chess.undo();

        const base = {
            valid: true,
            correct: false,
            played: result.san,
            expected: expectedMove,
            correctMoves: [expectedMove],
            fen: this.chess.fen(),
            moveIndex: this.currentMoveIndex
        };

        // Another repertoire move: not wrong, just not the line being trained.
        if (this.currentNode && this.currentNode.getChild(result.san)) {
            return { ...base, isAlternative: true };
        }

        if (!this.isLearning) this._markPositionFailed();

        const info = { ...base, isAlternative: false };
        if (this.wrongMoveCallback) {
            this.wrongMoveCallback(info);
        }
        return info;
    }

    /**
     * The player asked for a hint (e.g. the piece to move). Counts as a miss
     * for grading, because the move wasn't recalled unaided.
     */
    useHint() {
        if (!this.isPlayerMove() || this.isLearning) return;
        this._markPositionFailed();
    }

    /**
     * Force-play the expected move (after showing it to the user).
     */
    playCorrectMove() {
        if (this.state !== 'playing' || !this.isPlayerMove()) return null;

        const expectedMove = this.currentLine[this.currentMoveIndex];
        const result = this.chess.move(expectedMove, { sloppy: true });
        if (!result) return null;

        if (!this.isLearning) {
            // Asking for the answer means it wasn't known.
            this._markPositionFailed();
            const node = this.currentNode ? this.currentNode.getChild(result.san) : null;
            if (node) this._recordMoveAttempt(node, false);
        }
        this.positionFailed = false;

        const isLineComplete = this._advance(result);
        return {
            move: result,
            fen: this.chess.fen(),
            moveIndex: this.currentMoveIndex,
            isLineComplete
        };
    }

    _markPositionFailed() {
        if (this.positionFailed) return;
        this.positionFailed = true;
        this.lineMistakes++;
        this.sessionStats.wrong++;
    }

    _recordMoveAttempt(node, correct) {
        const ms = node.moveStats;
        ms.attempts++;
        if (correct) {
            ms.correct++;
            ms.streak++;
        } else {
            ms.streak = 0;
        }
        ms.lastSeen = Date.now();
    }

    /** Move along the line after a move was played; completes the line at its end. */
    _advance(moveResult) {
        const child = this.currentNode ? this.currentNode.getChild(moveResult.san) : null;
        if (child) this.currentNode = child;
        this.currentMoveIndex++;
        const isLineComplete = this.currentMoveIndex >= this.currentLine.length;
        if (isLineComplete && !this.lineCompleted) {
            this._completeLine();
        }
        return isLineComplete;
    }

    /**
     * Handle line completion: schedule the line and record session stats.
     */
    _completeLine() {
        this.lineCompleted = true;
        this.state = 'waiting';
        this.sessionStats.total++;

        const wasPerfect = this.lineMistakes === 0;
        const leafNode = this.tree.getNodeAt(this.currentLine);

        if (leafNode) {
            if (this.isLearning) {
                this.sessionStats.learnedLines++;
                this._markLearned(leafNode);
            } else {
                // A line never reviewed cold before (learning was skipped or disabled)
                if (leafNode.stats.attempts === 0) this.sessionStats.newLines++;
                else this.sessionStats.reviewedLines++;
                if (wasPerfect) this.sessionStats.perfectLines++;

                this._updateSM2(leafNode, wasPerfect ? 4 : 1);

                // Re-test a failed line once more at the end of the session.
                const key = this.currentLine.join(' ');
                if (!wasPerfect && !this._requeued.has(key)) {
                    this._requeued.add(key);
                    this.lineQueue.push(this.currentLine);
                }
            }
        }

        this.completedLines.push({
            line: this.currentLine,
            correct: wasPerfect,
            learned: this.isLearning,
            mistakes: this.lineMistakes
        });

        if (this.lineCompleteCallback) {
            this.lineCompleteCallback({
                line: this.currentLine,
                correct: wasPerfect,
                learned: this.isLearning,
                stats: this.sessionStats,
                remaining: this.lineQueue.length
            });
        }
    }

    /** Schedule the first cold review of a line that was just learned. */
    _markLearned(node) {
        const stats = node.stats;
        const now = Date.now();
        stats.lastReviewed = now;
        stats.streak = 0;
        stats.interval = 0;
        stats.nextReview = now + Trainer.LEARN_REVIEW_DELAY_MS;
    }

    /**
     * SM-2 Spaced Repetition Algorithm
     * @param {MoveTreeNode} node - The node to update
     * @param {number} quality - Response quality (0-5, where 3+ is correct)
     */
    _updateSM2(node, quality) {
        const stats = node.stats;
        const now = Date.now();

        stats.attempts++;
        stats.lastReviewed = now;

        if (quality >= 3) {
            // Correct response
            stats.correct++;
            stats.streak++;

            if (stats.streak === 1) {
                stats.interval = 1;
            } else if (stats.streak === 2) {
                stats.interval = 3;
            } else {
                stats.interval = Math.round(stats.interval * stats.ease);
            }

            // Update ease factor
            stats.ease = Math.max(1.3,
                stats.ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
            );
        } else {
            // Incorrect response - reset
            stats.streak = 0;
            stats.interval = 0; // Review again soon
            stats.ease = Math.max(1.3, stats.ease - 0.2);
        }

        // Schedule next review
        stats.nextReview = now + stats.interval * 24 * 60 * 60 * 1000;
    }

    /**
     * Skip current line and put it at the back of the queue.
     */
    skipLine() {
        if (this.currentLine && !this.lineCompleted) {
            this.lineQueue.push(this.currentLine);
        }
        return this.nextLine();
    }

    /**
     * Mark the current line as failed and move on.
     */
    failLine() {
        if (this.currentLine && !this.lineCompleted) {
            this.lineMistakes = Math.max(1, this.lineMistakes);
            this._completeLine();
        }
        return this.nextLine();
    }

    getProgress() {
        const inFlight = this.currentLine && !this.lineCompleted ? 1 : 0;
        const remaining = this.lineQueue.length + inFlight;
        const total = this.sessionStats.total + remaining;
        return {
            completed: this.sessionStats.total,
            remaining,
            total,
            percent: total > 0 ? Math.round((this.sessionStats.total / total) * 100) : 0,
            stats: { ...this.sessionStats }
        };
    }

    /**
     * Get comprehensive overview for the training dashboard.
     */
    getOverview() {
        const stats = this.tree.getStatsOverview();
        return {
            ...stats,
            color: this.tree.color,
            name: this.tree.name,
            session: this.sessionStats
        };
    }
}

window.Trainer = Trainer;
