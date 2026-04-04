/**
 * Spaced Repetition Trainer Engine
 *
 * Uses SM-2 algorithm for scheduling reviews.
 * Manages training sessions, tracks progress, picks lines to practice.
 */

class Trainer {
    constructor(moveTree) {
        this.tree = moveTree;
        this.chess = new Chess();
        this.currentLine = null;        // Current line being practiced
        this.currentMoveIndex = 0;      // Current position in the line
        this.currentNode = null;        // Current node in the tree
        this.sessionStats = {
            total: 0,
            correct: 0,
            wrong: 0,
            newLines: 0,
            reviewedLines: 0
        };
        this.lineQueue = [];            // Lines to practice
        this.completedLines = [];       // Lines completed this session
        this.isPlayerTurn = false;
        this.state = 'idle';            // idle, playing, waiting, finished
        this.wrongMoveCallback = null;
        this.correctMoveCallback = null;
        this.opponentMoveCallback = null;
        this.lineCompleteCallback = null;
        this.sessionCompleteCallback = null;
    }

    /**
     * Start a training session.
     * @param {Object} options - Training options
     * @param {number} options.lineLimit - Max lines per session
     * @param {string} options.mode - 'review' (due lines), 'new' (unlearned), 'mix' (both), 'all'
     * @param {number[]} options.startFromMoves - Optional: start from this position
     */
    startSession(options = {}) {
        const {
            lineLimit = 20,
            mode = 'mix',
            startFromMoves = null
        } = options;

        this.sessionStats = { total: 0, correct: 0, wrong: 0, newLines: 0, reviewedLines: 0 };
        this.completedLines = [];
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

        this._collectAllLines(startNode, startFrom || [], allLines);

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

        // Sort due lines: most overdue first
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
            lines.push([...currentPath]);
            return;
        }
        for (const [moveSan, child] of node.children) {
            currentPath.push(moveSan);
            this._collectAllLines(child, currentPath, lines);
            currentPath.pop();
        }
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

        // Determine if first move is player's
        const isWhiteRepertoire = this.tree.color === 'white';
        // First move (index 0) is always white's move
        // If we play white, moves at even indices are ours
        // If we play black, moves at odd indices are ours
        this.isPlayerTurn = isWhiteRepertoire; // White plays first

        return {
            line: this.currentLine,
            fen: this.chess.fen(),
            isPlayerTurn: this.isPlayerTurn,
            totalMoves: this.currentLine.length,
            currentMove: 0
        };
    }

    /**
     * Check if the current position requires a player move.
     */
    isPlayerMove() {
        if (!this.currentLine || this.currentMoveIndex >= this.currentLine.length) return false;
        const isWhiteRepertoire = this.tree.color === 'white';
        const isWhiteToMove = this.currentMoveIndex % 2 === 0;
        return isWhiteRepertoire === isWhiteToMove;
    }

    /**
     * Get the opponent's next move (auto-play).
     * Returns null if it's the player's turn or line is complete.
     */
    getOpponentMove() {
        if (this.isPlayerMove()) return null;
        if (this.currentMoveIndex >= this.currentLine.length) return null;

        const expectedMove = this.currentLine[this.currentMoveIndex];
        return expectedMove;
    }

    /**
     * Play the opponent's move automatically.
     */
    playOpponentMove() {
        const move = this.getOpponentMove();
        if (!move) return null;

        const result = this.chess.move(move, { sloppy: true });
        if (!result) return null;

        this.currentNode = this.currentNode.getChild(result.san) || this.currentNode;
        this.currentMoveIndex++;

        const info = {
            move: result,
            fen: this.chess.fen(),
            moveIndex: this.currentMoveIndex,
            isLineComplete: this.currentMoveIndex >= this.currentLine.length
        };

        if (this.opponentMoveCallback) {
            this.opponentMoveCallback(info);
        }

        return info;
    }

    /**
     * Submit a player's move attempt.
     * @param {string} moveSan - The move in SAN or from-to format
     * @returns {Object} Result with correct/wrong status
     */
    submitMove(from, to, promotion) {
        if (!this.currentLine || this.currentMoveIndex >= this.currentLine.length) {
            return { valid: false, error: 'No active line' };
        }

        const expectedMove = this.currentLine[this.currentMoveIndex];

        // Try to make the move
        const moveObj = { from, to };
        if (promotion) moveObj.promotion = promotion;

        const result = this.chess.move(moveObj);
        if (!result) {
            return { valid: false, error: 'Illegal move' };
        }

        // Check if it matches expected move
        const isCorrect = result.san === expectedMove;

        // Also check if it's an acceptable alternative (branch in tree)
        let isAlternative = false;
        if (!isCorrect && this.currentNode) {
            const altNode = this.currentNode.getChild(result.san);
            if (altNode && altNode.hasChildren()) {
                isAlternative = true;
            }
        }

        if (isCorrect || isAlternative) {
            // Correct move
            this.currentNode = this.currentNode.getChild(result.san) || this.currentNode;
            this.currentMoveIndex++;
            this.sessionStats.correct++;

            const info = {
                valid: true,
                correct: true,
                isAlternative,
                move: result,
                fen: this.chess.fen(),
                moveIndex: this.currentMoveIndex,
                isLineComplete: this.currentMoveIndex >= this.currentLine.length
            };

            if (this.correctMoveCallback) {
                this.correctMoveCallback(info);
            }

            if (info.isLineComplete) {
                this._onLineComplete(true);
            }

            return info;
        } else {
            // Wrong move - undo it
            this.chess.undo();
            this.sessionStats.wrong++;

            // Get all correct moves at this position
            const correctMoves = [];
            if (this.currentNode) {
                for (const [san] of this.currentNode.children) {
                    correctMoves.push(san);
                }
            } else {
                correctMoves.push(expectedMove);
            }

            const info = {
                valid: true,
                correct: false,
                played: result.san,
                expected: expectedMove,
                correctMoves,
                fen: this.chess.fen(),
                moveIndex: this.currentMoveIndex
            };

            if (this.wrongMoveCallback) {
                this.wrongMoveCallback(info);
            }

            return info;
        }
    }

    /**
     * Force-play the correct move (after showing it to the user).
     */
    playCorrectMove() {
        if (!this.currentLine || this.currentMoveIndex >= this.currentLine.length) return null;

        const expectedMove = this.currentLine[this.currentMoveIndex];
        const result = this.chess.move(expectedMove, { sloppy: true });
        if (!result) return null;

        this.currentNode = this.currentNode.getChild(result.san) || this.currentNode;
        this.currentMoveIndex++;

        return {
            move: result,
            fen: this.chess.fen(),
            moveIndex: this.currentMoveIndex,
            isLineComplete: this.currentMoveIndex >= this.currentLine.length
        };
    }

    /**
     * Handle line completion - update spaced repetition stats.
     */
    _onLineComplete(wasCorrect) {
        this.sessionStats.total++;

        const leafNode = this.tree.getNodeAt(this.currentLine);
        if (!leafNode) return;

        const isNew = !leafNode.stats.lastReviewed;
        if (isNew) {
            this.sessionStats.newLines++;
        } else {
            this.sessionStats.reviewedLines++;
        }

        // Update SM-2 stats
        this._updateSM2(leafNode, wasCorrect ? 4 : 1);

        this.completedLines.push({
            line: this.currentLine,
            correct: wasCorrect
        });

        if (this.lineCompleteCallback) {
            this.lineCompleteCallback({
                line: this.currentLine,
                correct: wasCorrect,
                stats: this.sessionStats,
                remaining: this.lineQueue.length
            });
        }
    }

    /**
     * SM-2 Spaced Repetition Algorithm
     * @param {MoveTreeNode} node - The node to update
     * @param {number} quality - Response quality (0-5, where 4+ is correct)
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
     * Skip current line and mark it for later review.
     */
    skipLine() {
        if (this.currentLine) {
            // Put it back at the end of the queue
            this.lineQueue.push(this.currentLine);
        }
        return this.nextLine();
    }

    /**
     * Mark the current line as failed and move on.
     */
    failLine() {
        if (this.currentLine) {
            this._onLineComplete(false);
        }
        return this.nextLine();
    }

    getProgress() {
        const total = this.sessionStats.total + this.lineQueue.length + (this.currentLine ? 1 : 0);
        return {
            completed: this.sessionStats.total,
            remaining: this.lineQueue.length + (this.currentLine ? 1 : 0),
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
