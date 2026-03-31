/**
 * Move Tree (Trie) Data Structure for Chess Opening Repertoire
 *
 * Efficiently stores hundreds of thousands of variations using shared prefixes.
 * Each node represents a position reached after a move, with children being
 * possible continuations.
 */

class MoveTreeNode {
    constructor(move = null, parent = null) {
        this.move = move;           // SAN notation (e.g., "e4", "Nf3")
        this.children = new Map();  // SAN -> MoveTreeNode
        this.parent = parent;       // Reference to parent node
        this.comment = '';          // Annotation text
        this.nags = [];             // Numeric Annotation Glyphs [!, ?, !!, etc.]
        this.priority = 0;          // 0 = mainline, 1+ = alternative

        // Training stats (SM-2 spaced repetition)
        this.stats = {
            attempts: 0,
            correct: 0,
            lastReviewed: null,
            nextReview: null,
            interval: 0,       // days
            ease: 2.5,         // SM-2 ease factor
            streak: 0          // consecutive correct
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
}


class MoveTree {
    constructor(name = 'Unnamed', color = 'white') {
        this.root = new MoveTreeNode();
        this.name = name;
        this.color = color;       // 'white' or 'black'
        this.id = MoveTree.generateId();
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
        this.metadata = {};       // PGN headers, etc.

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
        for (let i = 0; i < moves.length; i++) {
            const moveSan = moves[i];
            node = node.addChild(moveSan);
            if (comments[i]) {
                node.comment = comments[i];
            }
            if (nags[i]) {
                node.nags = nags[i];
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

    countNodes() {
        if (!this._dirty) return this._nodeCount;
        let count = 0;
        this._traverse(this.root, () => count++);
        this._nodeCount = count - 1; // exclude root
        return this._nodeCount;
    }

    countLines() {
        if (!this._dirty) return this._lineCount;
        let count = 0;
        this._traverse(this.root, (node) => {
            if (node.isLeaf()) count++;
        });
        this._lineCount = count;
        this._dirty = false;
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

        // Sort by priority: due for review first, then new lines
        lines.sort((a, b) => {
            const aNode = a.node;
            const bNode = b.node;
            // Never reviewed - high priority
            if (!aNode.stats.lastReviewed && bNode.stats.lastReviewed) return -1;
            if (aNode.stats.lastReviewed && !bNode.stats.lastReviewed) return 1;
            // Due for review
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
        let mastered = 0; // streak >= 5
        let due = 0;
        const now = Date.now();

        this._traverse(this.root, (node) => {
            if (node === this.root) return;
            totalNodes++;
            if (node.isLeaf()) {
                totalLines++;
                if (node.stats.lastReviewed) {
                    reviewed++;
                    if (node.stats.streak >= 5) mastered++;
                    if (node.stats.nextReview && node.stats.nextReview <= now) due++;
                }
            }
        });

        return { totalNodes, totalLines, reviewed, mastered, due };
    }

    _traverse(node, callback) {
        callback(node);
        for (const [, child] of node.children) {
            this._traverse(child, callback);
        }
    }

    // Merge another tree into this one (for importing additional PGNs)
    merge(otherTree) {
        this._mergeNodes(this.root, otherTree.root);
        this._dirty = true;
    }

    _mergeNodes(target, source) {
        for (const [moveSan, sourceChild] of source.children) {
            let targetChild = target.getChild(moveSan);
            if (!targetChild) {
                targetChild = target.addChild(moveSan);
            }
            // Merge comments (keep existing if present)
            if (sourceChild.comment && !targetChild.comment) {
                targetChild.comment = sourceChild.comment;
            }
            if (sourceChild.nags.length > 0 && targetChild.nags.length === 0) {
                targetChild.nags = [...sourceChild.nags];
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
        if (node.priority > 0) obj.p = node.priority;
        if (node.stats.attempts > 0) {
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
        if (node.children.size > 0) {
            obj.c = {};
            for (const [moveSan, child] of node.children) {
                obj.c[moveSan] = this._serializeNode(child);
            }
        }
        return obj;
    }

    static deserialize(data) {
        const tree = new MoveTree(data.name, data.color);
        tree.id = data.id;
        tree.createdAt = data.createdAt;
        tree.updatedAt = data.updatedAt;
        tree.metadata = data.metadata || {};
        tree._deserializeNode(tree.root, data.tree);
        tree._dirty = true;
        return tree;
    }

    _deserializeNode(node, data) {
        if (data.a) node.comment = data.a;
        if (data.n) node.nags = data.n;
        if (data.p !== undefined) node.priority = data.p;
        if (data.s) {
            node.stats = {
                attempts: data.s[0],
                correct: data.s[1],
                lastReviewed: data.s[2],
                nextReview: data.s[3],
                interval: data.s[4],
                ease: data.s[5],
                streak: data.s[6]
            };
        }
        if (data.c) {
            for (const [moveSan, childData] of Object.entries(data.c)) {
                const child = node.addChild(moveSan);
                child.move = moveSan;
                this._deserializeNode(child, childData);
            }
        }
    }
}

// Export for use in other files
window.MoveTree = MoveTree;
window.MoveTreeNode = MoveTreeNode;
