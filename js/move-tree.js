/**
 * Move Tree (Trie) Data Structure for Chess Opening Repertoire
 *
 * Efficiently stores hundreds of thousands of variations using shared prefixes.
 * Each node represents a position reached after a move, with children being
 * possible continuations.
 *
 * Includes transposition detection via FEN position indexing.
 */

class MoveTreeNode {
    constructor(move = null, parent = null) {
        this.move = move;           // SAN notation (e.g., "e4", "Nf3")
        this.children = new Map();  // SAN -> MoveTreeNode
        this.parent = parent;       // Reference to parent node
        this.comment = '';          // Annotation text (UTF-8, any language)
        this.nags = [];             // Numeric Annotation Glyphs [!, ?, !!, etc.]
        this.priority = 0;          // 0 = mainline, 1+ = alternative
        this.fen = null;            // Position FEN (first 4 fields - no counters)
        this.isTransposition = false; // True if this position is reachable via multiple paths
        this.enabled = true;        // Whether this node is active for training
        this.collapsed = false;     // UI state for tree view (collapsed branch)

        // Line-level spaced-repetition stats (SM-2). Only meaningful on leaf
        // nodes, which represent a complete training line.
        this.stats = {
            attempts: 0,
            correct: 0,
            lastReviewed: null,
            nextReview: null,
            interval: 0,       // days
            ease: 2.5,         // SM-2 ease factor
            streak: 0          // consecutive correct
        };

        // Per-move stats: how reliably the player finds THIS move when it is
        // their turn in training. Drives tree colours and weak-spot detection.
        this.moveStats = {
            attempts: 0,
            correct: 0,
            streak: 0,
            lastSeen: null
        };
    }

    addChild(moveSan, priority = -1) {
        if (this.children.has(moveSan)) {
            return this.children.get(moveSan);
        }
        const child = new MoveTreeNode(moveSan, this);
        child.priority = priority >= 0 ? priority : this.children.size;
        this.children.set(moveSan, child);
        return child;
    }

    getChild(moveSan) {
        return this.children.get(moveSan) || null;
    }

    hasChildren() {
        return this.children.size > 0;
    }

    isLeaf() {
        return this.children.size === 0;
    }

    getMainline() {
        let best = null;
        let bestPriority = Infinity;
        for (const [, child] of this.children) {
            if (child.priority < bestPriority) {
                bestPriority = child.priority;
                best = child;
            }
        }
        return best;
    }

    getDepth() {
        let depth = 0;
        let node = this;
        while (node.parent) {
            depth++;
            node = node.parent;
        }
        return depth;
    }

    getPath() {
        const path = [];
        let node = this;
        while (node.parent) {
            path.unshift(node.move);
            node = node.parent;
        }
        return path;
    }

    getMoveNumber() {
        return Math.floor(this.getDepth() / 2) + 1;
    }

    isWhiteMove() {
        return this.getDepth() % 2 === 1;
    }

    /**
     * Get all other nodes that reach the same position (transpositions).
     * Requires tree's positionIndex.
     */
    getTranspositions(positionIndex) {
        if (!this.fen || !positionIndex) return [];
        const nodes = positionIndex.get(this.fen);
        if (!nodes) return [];
        return nodes.filter(n => n !== this);
    }
}


class MoveTree {
    constructor(name = 'Unnamed', color = 'white') {
        this.root = new MoveTreeNode();
        this.name = name;
        this.color = color;       // 'white' or 'black'
        this.id = MoveTree.generateId();
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
        this.metadata = {};       // PGN headers, language info, etc.

        // Position index for transposition detection: FEN -> [MoveTreeNode]
        this.positionIndex = new Map();

        // Cached stats
        this._nodeCount = 0;
        this._lineCount = 0;
        this._dirty = true;
    }

    static generateId() {
        return 'rep_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }

    addLine(moves, comments = {}, nags = {}) {
        let node = this.root;
        // Replay moves to compute position FENs so transposition detection works.
        // Chess is a global (vendor/chess.min.js); guard in case it's unavailable.
        let chess = (typeof Chess !== 'undefined') ? new Chess() : null;
        for (let i = 0; i < moves.length; i++) {
            const moveSan = moves[i];
            node = node.addChild(moveSan);
            if (comments[i]) {
                node.comment = comments[i];
            }
            if (nags[i]) {
                node.nags = nags[i];
            }
            // Compute and store the normalized position FEN for this node.
            if (chess) {
                const made = chess.move(moveSan, { sloppy: true });
                if (made) {
                    node.fen = MoveTree.positionFen(chess);
                } else {
                    // Illegal/unknown SAN — stop computing FENs for the rest of the line.
                    chess = null;
                }
            }
        }
        this._dirty = true;
        return node;
    }

    getNodeAt(moves) {
        let node = this.root;
        for (const moveSan of moves) {
            node = node.getChild(moveSan);
            if (!node) return null;
        }
        return node;
    }

    /**
     * Compute the canonical position FEN used as the transposition key.
     * Uses placement + side-to-move + castling + en-passant, BUT strips the
     * en-passant square unless a capture is actually available. chess.js emits
     * an e.p. square after every double pawn push even when no pawn can capture,
     * which would otherwise make identical positions reached by different move
     * orders look different and defeat transposition detection.
     *
     * @param {Chess} chess - a chess.js instance at the position
     * @returns {string} 4-field position FEN (normalized)
     */
    static positionFen(chess) {
        return MoveTree.normalizeFenKey(chess.fen());
    }

    /**
     * Normalize any FEN (4 or 6 fields) to the transposition key used in the
     * tree, working on the string alone (fast: no move generation, and it can
     * be applied to FENs stored by older versions on load).
     *
     * The en-passant square is kept only if a pawn of the side to move stands
     * next to the pawn that just advanced two squares. (Pins are ignored —
     * irrelevant for opening transpositions, and the rule is applied the same
     * way everywhere, so keys stay consistent.)
     */
    static normalizeFenKey(fen) {
        if (typeof fen !== 'string') return fen;
        const parts = fen.trim().split(/\s+/);
        if (parts.length < 4) return fen;
        const [placement, turn, castling] = parts;
        let ep = parts[3];
        if (ep !== '-') {
            let capturable = false;
            if (/^[a-h][36]$/.test(ep)) {
                const rows = placement.split('/'); // rows[0] is rank 8
                const pieceAt = (file, rank) => {
                    const row = rows[8 - rank] || '';
                    let f = 0;
                    for (const ch of row) {
                        if (ch >= '1' && ch <= '8') f += Number(ch);
                        else {
                            if (f === file) return ch;
                            f++;
                        }
                    }
                    return null;
                };
                const file = ep.charCodeAt(0) - 97;
                const pawnRank = ep[1] === '3' ? 4 : 5; // rank of the pawn that just moved
                const capturer = turn === 'w' ? 'P' : 'p';
                capturable = [file - 1, file + 1].some(f => f >= 0 && f <= 7 && pieceAt(f, pawnRank) === capturer);
            }
            if (!capturable) ep = '-';
        }
        return `${placement} ${turn} ${castling} ${ep}`;
    }

    /**
     * Build the position index from all nodes in the tree.
     * Call after deserialization or manual tree construction.
     */
    rebuildPositionIndex() {
        this.positionIndex.clear();
        this._traverse(this.root, (node) => {
            node.isTransposition = false; // recomputed below (e.g. after a branch was deleted)
            if (node.fen) {
                if (!this.positionIndex.has(node.fen)) {
                    this.positionIndex.set(node.fen, []);
                }
                this.positionIndex.get(node.fen).push(node);
                if (this.positionIndex.get(node.fen).length > 1) {
                    for (const n of this.positionIndex.get(node.fen)) {
                        n.isTransposition = true;
                    }
                }
            }
        });
    }

    /**
     * Get count of unique transpositions in the tree.
     */
    countTranspositions() {
        let count = 0;
        for (const [, nodes] of this.positionIndex) {
            if (nodes.length > 1) count++;
        }
        return count;
    }

    /**
     * Find all transposition groups (positions reachable by multiple paths).
     */
    getTranspositionGroups() {
        const groups = [];
        for (const [fen, nodes] of this.positionIndex) {
            if (nodes.length > 1) {
                groups.push({
                    fen,
                    paths: nodes.map(n => n.getPath()),
                    nodeCount: nodes.length
                });
            }
        }
        return groups;
    }

    // Node and line counts are cached together so that calling one never
    // leaves the other stale.
    _refreshCounts() {
        if (!this._dirty) return;
        let nodes = 0;
        let lines = 0;
        this._traverse(this.root, (node) => {
            nodes++;
            if (node !== this.root && node.isLeaf()) lines++;
        });
        this._nodeCount = nodes - 1;
        this._lineCount = lines;
        this._dirty = false;
    }

    countNodes() {
        this._refreshCounts();
        return this._nodeCount;
    }

    countLines() {
        this._refreshCounts();
        return this._lineCount;
    }

    getMaxDepth() {
        let maxDepth = 0;
        this._traverse(this.root, (node) => {
            const d = node.getDepth();
            if (d > maxDepth) maxDepth = d;
        });
        return maxDepth;
    }

    getAllLines() {
        const lines = [];
        this._collectLines(this.root, [], lines);
        return lines;
    }

    _collectLines(node, currentPath, lines) {
        if (node.isLeaf() && currentPath.length > 0) {
            lines.push([...currentPath]);
            return;
        }
        for (const [moveSan, child] of node.children) {
            currentPath.push(moveSan);
            this._collectLines(child, currentPath, lines);
            currentPath.pop();
        }
    }

    getLinesForTraining(limit = 50) {
        const now = Date.now();
        const lines = [];
        this._collectTrainingLines(this.root, [], lines, now);

        lines.sort((a, b) => {
            const aNode = a.node;
            const bNode = b.node;
            if (!aNode.stats.lastReviewed && bNode.stats.lastReviewed) return -1;
            if (aNode.stats.lastReviewed && !bNode.stats.lastReviewed) return 1;
            if (aNode.stats.nextReview && bNode.stats.nextReview) {
                return aNode.stats.nextReview - bNode.stats.nextReview;
            }
            return 0;
        });

        return lines.slice(0, limit);
    }

    _collectTrainingLines(node, currentPath, lines, now) {
        if (node.isLeaf() && currentPath.length > 0) {
            const isDue = !node.stats.nextReview || node.stats.nextReview <= now;
            const isNew = !node.stats.lastReviewed;
            if (isDue || isNew) {
                lines.push({
                    path: [...currentPath],
                    node: node,
                    isNew: isNew
                });
            }
            return;
        }
        for (const [moveSan, child] of node.children) {
            currentPath.push(moveSan);
            this._collectTrainingLines(child, currentPath, lines, now);
            currentPath.pop();
        }
    }

    getStatsOverview() {
        let totalNodes = 0;
        let totalLines = 0;
        let reviewed = 0;
        let mastered = 0;
        let due = 0;
        let moveAttempts = 0;
        let moveCorrect = 0;
        let nextDue = null;
        const now = Date.now();

        // Walk with an "effectively enabled" flag: a line is trainable only if
        // no node on its path is disabled (mirrors Trainer._collectAllLines).
        const walk = (node, active) => {
            if (node !== this.root) {
                totalNodes++;
                moveAttempts += node.moveStats.attempts;
                moveCorrect += node.moveStats.correct;
                active = active && node.enabled;
                if (node.isLeaf() && active) {
                    totalLines++;
                    if (node.stats.lastReviewed) {
                        reviewed++;
                        if (node.stats.streak >= 5) mastered++;
                        if (node.stats.nextReview && node.stats.nextReview <= now) due++;
                        else if (node.stats.nextReview && (nextDue === null || node.stats.nextReview < nextDue)) {
                            nextDue = node.stats.nextReview;
                        }
                    }
                }
            }
            for (const [, child] of node.children) walk(child, active);
        };
        walk(this.root, true);

        const transpositions = this.countTranspositions();
        const accuracy = moveAttempts > 0 ? Math.round(moveCorrect / moveAttempts * 100) : null;

        return {
            totalNodes, totalLines, reviewed, mastered, due, transpositions,
            newLines: totalLines - reviewed,
            accuracy,
            nextDue
        };
    }

    /**
     * The player's least reliable moves (by per-move training accuracy).
     * @param {number} limit
     * @param {number} minAttempts - ignore moves seen fewer times than this
     * @returns {Array<{node: MoveTreeNode, path: string[], accuracy: number, attempts: number}>}
     */
    getWeakestMoves(limit = 5, minAttempts = 2) {
        const out = [];
        this._traverse(this.root, (node) => {
            const ms = node.moveStats;
            if (node === this.root || ms.attempts < minAttempts) return;
            const accuracy = Math.round(ms.correct / ms.attempts * 100);
            if (accuracy < 100) out.push({ node, path: node.getPath(), accuracy, attempts: ms.attempts });
        });
        out.sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts);
        return out.slice(0, limit);
    }

    _traverse(node, callback) {
        callback(node);
        for (const [, child] of node.children) {
            this._traverse(child, callback);
        }
    }

    /**
     * Toggle enabled state of a node. Disabled nodes are skipped during training.
     */
    toggleEnabled(node, propagateToChildren = false) {
        node.enabled = !node.enabled;
        if (propagateToChildren) {
            this._traverse(node, (child) => {
                if (child !== node) child.enabled = node.enabled;
            });
        }
        this._dirty = true;
    }

    /**
     * Delete a node and its entire subtree from the tree.
     */
    deleteSubtree(node) {
        if (!node.parent) return; // Can't delete root
        node.parent.children.delete(node.move);
        this._dirty = true;
        this.rebuildPositionIndex();
    }

    /**
     * Set a node as the mainline (priority 0) among its siblings.
     */
    setMainline(node) {
        if (!node.parent) return;
        for (const [, sibling] of node.parent.children) {
            if (sibling === node) {
                sibling.priority = 0;
            } else if (sibling.priority <= node.priority) {
                sibling.priority++;
            }
        }
        this._dirty = true;
    }

    /**
     * Get accuracy percentage for a node (0-100 or null if no attempts).
     */
    static getNodeAccuracy(node) {
        // Prefer per-move stats (how often the player finds this move);
        // fall back to line-level stats on leaves trained before per-move
        // tracking existed.
        const ms = node.moveStats;
        if (ms && ms.attempts > 0) return Math.round((ms.correct / ms.attempts) * 100);
        if (!node.stats || node.stats.attempts === 0) return null;
        return Math.round((node.stats.correct / node.stats.attempts) * 100);
    }

    /**
     * Set default collapse state: expand up to maxDepth, collapse deeper.
     */
    setDefaultCollapse(maxExpandedDepth = 3) {
        this._traverse(this.root, (node) => {
            node.collapsed = node.getDepth() >= maxExpandedDepth && node.hasChildren();
        });
    }

    merge(otherTree) {
        this._mergeNodes(this.root, otherTree.root);
        this._dirty = true;
        this.rebuildPositionIndex();
    }

    _mergeNodes(target, source) {
        for (const [moveSan, sourceChild] of source.children) {
            let targetChild = target.getChild(moveSan);
            if (!targetChild) {
                targetChild = target.addChild(moveSan);
            }
            if (sourceChild.comment && !targetChild.comment) {
                targetChild.comment = sourceChild.comment;
            }
            if (sourceChild.nags.length > 0 && targetChild.nags.length === 0) {
                targetChild.nags = [...sourceChild.nags];
            }
            if (sourceChild.fen) {
                targetChild.fen = sourceChild.fen;
            }
            this._mergeNodes(targetChild, sourceChild);
        }
    }

    // Serialization - compact format for storage
    serialize() {
        return {
            id: this.id,
            name: this.name,
            color: this.color,
            createdAt: this.createdAt,
            updatedAt: Date.now(),
            metadata: this.metadata,
            tree: this._serializeNode(this.root)
        };
    }

    _serializeNode(node) {
        const obj = {};
        if (node.move) obj.m = node.move;
        if (node.comment) obj.a = node.comment;
        if (node.nags.length > 0) obj.n = node.nags;
        // Priority 0 (mainline) is the default on load, so only store non-zero.
        if (node.priority > 0) obj.p = node.priority;
        if (node.fen) obj.f = node.fen;
        if (node.isTransposition) obj.t = 1;
        if (!node.enabled) obj.e = 0;
        if (node.collapsed) obj.cl = 1;
        // A line that was learned (shown once) has a schedule but no graded
        // attempts yet — it must still be persisted.
        if (node.stats.attempts > 0 || node.stats.lastReviewed) {
            obj.s = [
                node.stats.attempts,
                node.stats.correct,
                node.stats.lastReviewed,
                node.stats.nextReview,
                node.stats.interval,
                Math.round(node.stats.ease * 100) / 100,
                node.stats.streak
            ];
        }
        if (node.moveStats.attempts > 0) {
            obj.ms = [
                node.moveStats.attempts,
                node.moveStats.correct,
                node.moveStats.streak,
                node.moveStats.lastSeen
            ];
        }
        if (node.children.size > 0) {
            obj.c = {};
            for (const [moveSan, child] of node.children) {
                obj.c[moveSan] = this._serializeNode(child);
            }
        }
        return obj;
    }

    static deserialize(data) {
        // Defensive: a corrupt/empty record must never throw and make a
        // repertoire permanently inaccessible. Fall back to sane defaults.
        if (!data || typeof data !== 'object') {
            return new MoveTree('Recovered', 'white');
        }
        const tree = new MoveTree(
            typeof data.name === 'string' ? data.name : 'Untitled',
            data.color === 'black' ? 'black' : 'white'
        );
        tree.id = data.id;
        tree.createdAt = data.createdAt;
        tree.updatedAt = data.updatedAt;
        tree.metadata = (data.metadata && typeof data.metadata === 'object') ? data.metadata : {};
        try {
            if (data.tree && typeof data.tree === 'object') {
                tree._deserializeNode(tree.root, data.tree);
            }
        } catch (e) {
            // Keep whatever was successfully parsed rather than losing everything.
            console.error('MoveTree.deserialize: partial tree recovered after error:', e);
        }
        tree._dirty = true;
        tree.rebuildPositionIndex();
        return tree;
    }

    // Coerce a stored value to a finite number, or fall back.
    static _num(v, fallback) {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    }

    _deserializeNode(node, data) {
        if (!data || typeof data !== 'object') return;
        if (typeof data.a === 'string') node.comment = data.a;
        if (Array.isArray(data.n)) node.nags = data.n;
        // Missing priority means mainline (0) — only non-zero is stored. Using
        // the insertion index here instead would lose a "Set as Mainline"
        // choice on reload whenever the mainline wasn't the first child.
        node.priority = data.p !== undefined ? MoveTree._num(data.p, 0) : 0;
        // Older versions stored the raw en-passant field: normalize on load so
        // their positions match new ones for transposition detection.
        if (typeof data.f === 'string') node.fen = MoveTree.normalizeFenKey(data.f);
        if (data.t) node.isTransposition = true;
        if (data.e === 0) node.enabled = false;
        if (data.cl) node.collapsed = true;
        if (Array.isArray(data.s)) {
            const s = data.s;
            node.stats = {
                attempts: Math.max(0, MoveTree._num(s[0], 0)),
                correct: Math.max(0, MoveTree._num(s[1], 0)),
                lastReviewed: s[2] != null ? MoveTree._num(s[2], null) : null,
                nextReview: s[3] != null ? MoveTree._num(s[3], null) : null,
                interval: Math.max(0, MoveTree._num(s[4], 0)),
                ease: MoveTree._num(s[5], 2.5),
                streak: Math.max(0, MoveTree._num(s[6], 0))
            };
            // Guard against impossible ratios from corrupt data.
            if (node.stats.correct > node.stats.attempts) {
                node.stats.correct = node.stats.attempts;
            }
            if (node.stats.ease < 1.3) node.stats.ease = 1.3;
        }
        if (Array.isArray(data.ms)) {
            const m = data.ms;
            node.moveStats = {
                attempts: Math.max(0, MoveTree._num(m[0], 0)),
                correct: Math.max(0, MoveTree._num(m[1], 0)),
                streak: Math.max(0, MoveTree._num(m[2], 0)),
                lastSeen: m[3] != null ? MoveTree._num(m[3], null) : null
            };
            if (node.moveStats.correct > node.moveStats.attempts) {
                node.moveStats.correct = node.moveStats.attempts;
            }
        }
        if (data.c && typeof data.c === 'object') {
            for (const [moveSan, childData] of Object.entries(data.c)) {
                if (!moveSan) continue;
                const child = node.addChild(moveSan);
                child.move = moveSan;
                this._deserializeNode(child, childData);
            }
        }
    }
}

window.MoveTree = MoveTree;
window.MoveTreeNode = MoveTreeNode;
