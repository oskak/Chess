/**
 * Main Application - Chess Opening Repertoire Trainer
 *
 * Manages UI, board interaction, and coordinates all components.
 * Includes: sound effects, transposition detection UI, multi-language PGN support,
 * Web Worker for massive file parsing.
 */

class App {
    constructor() {
        this.db = new RepertoireDB();
        this.board = null;
        this.chess = new Chess();
        this.trainer = null;
        this.currentTree = null;
        this.currentNode = null;
        this.boardOrientation = 'white';
        this.view = 'welcome'; // welcome, explorer, trainer, import
        this.currentRepertoireId = null;
        this.explorerMoveStack = []; // For undo in explorer
        this.highlightSquares = [];
        this.autoPlayDelay = 400; // ms delay for opponent moves
        this.showHints = false;
        this.trainerLineHadError = false;
        this.sounds = new SoundEngine();
        this.pgnWorker = null;
        this.engine = null;
        this.engineEnabled = false;
        this._engineDebounce = null;
        this._contextMenuNode = null;
    }

    async init() {
        this._initBoard();
        this._bindEvents();
        await this._loadSidebar();
        this._showView('welcome');
    }

    // ===================== BOARD =====================

    _initBoard() {
        const config = {
            draggable: true,
            position: 'start',
            orientation: 'white',
            pieceTheme: function(piece) { return getPieceImageUrl(piece); },
            onDragStart: (source, piece, position, orientation) => this._onDragStart(source, piece, position, orientation),
            onDrop: (source, target, piece, newPos, oldPos, orientation) => this._onDrop(source, target, piece),
            onSnapEnd: () => this._onSnapEnd(),
            onMouseoutSquare: () => this._clearHighlights(),
            onMouseoverSquare: (square) => this._onHoverSquare(square)
        };
        this.board = Chessboard('board', config);

        // Make board responsive
        window.addEventListener('resize', () => {
            if (this.board) this.board.resize();
        });
    }

    _onDragStart(source, piece, position, orientation) {
        if (this.chess.game_over()) return false;

        // In explorer mode: allow any move
        if (this.view === 'explorer') {
            if ((this.chess.turn() === 'w' && piece.search(/^b/) !== -1) ||
                (this.chess.turn() === 'b' && piece.search(/^w/) !== -1)) {
                return false;
            }
            return true;
        }

        // In trainer mode: only allow player moves
        if (this.view === 'trainer') {
            if (!this.trainer || this.trainer.state !== 'playing') return false;
            if (!this.trainer.isPlayerMove()) return false;

            if ((this.chess.turn() === 'w' && piece.search(/^b/) !== -1) ||
                (this.chess.turn() === 'b' && piece.search(/^w/) !== -1)) {
                return false;
            }
            return true;
        }

        return false;
    }

    _onDrop(source, target, piece) {
        // Check for promotion
        let promotion = undefined;
        const isPromotion = piece[1] === 'P' &&
            ((piece[0] === 'w' && target[1] === '8') || (piece[0] === 'b' && target[1] === '1'));

        if (isPromotion) {
            promotion = this._askPromotion();
        }

        if (this.view === 'explorer') {
            return this._onExplorerDrop(source, target, promotion);
        }

        if (this.view === 'trainer') {
            return this._onTrainerDrop(source, target, promotion);
        }

        return 'snapback';
    }

    _onSnapEnd() {
        this.board.position(this.chess.fen());
    }

    _onHoverSquare(square) {
        if (this.view !== 'trainer' || !this.showHints) return;
        if (!this.trainer || !this.trainer.isPlayerMove()) return;

        // Show legal moves from this square
        const moves = this.chess.moves({ square, verbose: true });
        if (moves.length === 0) return;

        this._highlightSquare(square, 'hint-source');
        for (const move of moves) {
            this._highlightSquare(move.to, 'hint-target');
        }
    }

    _highlightSquare(square, className) {
        const el = document.querySelector(`.square-${square}`);
        if (el) {
            el.classList.add(className);
            this.highlightSquares.push({ el, className });
        }
    }

    _clearHighlights() {
        for (const { el, className } of this.highlightSquares) {
            el.classList.remove(className);
        }
        this.highlightSquares = [];
    }

    _clearAllSquareEffects() {
        document.querySelectorAll('.highlight-correct, .highlight-wrong, .highlight-last, .hint-source, .hint-target').forEach(el => {
            el.classList.remove('highlight-correct', 'highlight-wrong', 'highlight-last', 'hint-source', 'hint-target');
        });
        this.highlightSquares = [];
    }

    _highlightMove(move, type) {
        this._clearAllSquareEffects();
        const fromEl = document.querySelector(`.square-${move.from}`);
        const toEl = document.querySelector(`.square-${move.to}`);
        if (fromEl) fromEl.classList.add(`highlight-${type}`);
        if (toEl) toEl.classList.add(`highlight-${type}`);
    }

    _askPromotion() {
        // Simple prompt for now
        const choice = prompt('Promote to: Q (Queen), R (Rook), B (Bishop), N (Knight)', 'Q');
        const map = { 'Q': 'q', 'R': 'r', 'B': 'b', 'N': 'n', 'q': 'q', 'r': 'r', 'b': 'b', 'n': 'n' };
        return map[choice] || 'q';
    }

    // ===================== EXPLORER MODE =====================

    _onExplorerDrop(source, target, promotion) {
        const moveObj = { from: source, to: target };
        if (promotion) moveObj.promotion = promotion;

        const move = this.chess.move(moveObj);
        if (!move) return 'snapback';

        // Play sound
        if (move.captured) {
            this.sounds.playCapture();
        } else {
            this.sounds.playMove();
        }

        this.explorerMoveStack.push(move);

        // Navigate tree
        if (this.currentNode) {
            const child = this.currentNode.getChild(move.san);
            if (child) {
                this.currentNode = child;
                // Transposition notification
                if (child.isTransposition) {
                    this.sounds.playTransposition();
                }
            } else {
                // Move not in repertoire - offer to add it
                if (confirm(`Add ${move.san} to repertoire?`)) {
                    const newNode = this.currentNode.addChild(move.san);
                    newNode.fen = this.chess.fen().split(' ').slice(0, 4).join(' ');
                    this.currentNode = newNode;
                    this.currentTree._dirty = true;
                    this._saveCurrentRepertoire();
                    this._renderTreeView();
                } else {
                    this.currentNode = null;
                }
            }
        }

        this._updateExplorerUI();
        this._highlightMove(move, 'last');
    }

    _updateExplorerUI() {
        const moveList = document.getElementById('explorer-moves');
        const childList = document.getElementById('explorer-children');
        const comment = document.getElementById('explorer-comment');

        // Update move list
        if (moveList) {
            moveList.innerHTML = this._formatMoveHistory();
        }

        // Update available children
        if (childList && this.currentNode) {
            let html = '';
            const children = [...this.currentNode.children.entries()]
                .sort((a, b) => a[1].priority - b[1].priority);

            for (const [san, child] of children) {
                const nagStr = child.nags.map(n => PGNParser.NAG_REVERSE[n] || `$${n}`).join('');
                const statsStr = child.stats.attempts > 0
                    ? ` (${Math.round(child.stats.correct / child.stats.attempts * 100)}%)`
                    : '';
                const transStr = child.isTransposition ? '<span class="transposition-badge">TRANS</span>' : '';
                html += `<div class="explorer-child" data-move="${san}">
                    <span class="move-san">${this._toFigurine(san)}${nagStr}</span>${statsStr}
                    ${child.comment ? `<span class="move-comment">${child.comment}</span>` : ''}
                    ${transStr}
                </div>`;
            }
            childList.innerHTML = html || '<div class="no-moves">No continuations in repertoire</div>';

            // Bind click events
            childList.querySelectorAll('.explorer-child').forEach(el => {
                el.addEventListener('click', () => {
                    const san = el.dataset.move;
                    this._explorerPlayMove(san);
                });
            });
        }

        // Update comment
        if (comment && this.currentNode) {
            comment.textContent = this.currentNode.comment || '';
        }

        // Update transposition info
        this._updateTranspositionInfo();

        // Update ECO opening name
        this._updateECO();

        // Update engine evaluation (debounced)
        this._updateEngineEval();

        this._updateExplorerStats();
    }

    _explorerPlayMove(san) {
        const move = this.chess.move(san);
        if (!move) return;

        this.explorerMoveStack.push(move);
        this.board.position(this.chess.fen());

        if (this.currentNode) {
            const child = this.currentNode.getChild(move.san);
            if (child) this.currentNode = child;
            else this.currentNode = null;
        }

        this._updateExplorerUI();
        this._highlightMove(move, 'last');
    }

    _explorerUndo() {
        if (this.explorerMoveStack.length === 0) return;

        const move = this.chess.undo();
        if (!move) return;

        this.explorerMoveStack.pop();
        this.board.position(this.chess.fen());

        // Navigate back in tree
        if (this.currentNode && this.currentNode.parent) {
            this.currentNode = this.currentNode.parent;
        } else {
            // Recalculate from root
            this.currentNode = this.currentTree ? this.currentTree.root : null;
            for (const m of this.explorerMoveStack) {
                if (this.currentNode) {
                    this.currentNode = this.currentNode.getChild(m.san) || null;
                }
            }
        }

        this._clearAllSquareEffects();
        this._updateExplorerUI();
    }

    _explorerReset() {
        this.chess.reset();
        this.explorerMoveStack = [];
        this.currentNode = this.currentTree ? this.currentTree.root : null;
        this.board.position('start');
        this._clearAllSquareEffects();
        this._updateExplorerUI();
    }

    _updateExplorerStats() {
        const el = document.getElementById('explorer-stats');
        if (!el || !this.currentTree) return;

        const stats = this.currentTree.getStatsOverview();
        el.innerHTML = `
            <div class="stat"><span class="stat-value">${stats.totalNodes}</span><span class="stat-label">Positions</span></div>
            <div class="stat"><span class="stat-value">${stats.totalLines}</span><span class="stat-label">Lines</span></div>
            <div class="stat"><span class="stat-value">${stats.transpositions || 0}</span><span class="stat-label">Transpositions</span></div>
            <div class="stat"><span class="stat-value">${stats.due}</span><span class="stat-label">Due</span></div>
        `;
    }

    _updateTranspositionInfo() {
        const el = document.getElementById('explorer-transposition');
        if (!el) return;

        if (!this.currentNode || !this.currentNode.isTransposition || !this.currentTree) {
            el.innerHTML = '';
            return;
        }

        const transpositions = this.currentNode.getTranspositions(this.currentTree.positionIndex);
        if (transpositions.length === 0) {
            el.innerHTML = '';
            return;
        }

        let html = `<div class="transposition-info">
            <div class="trans-title">&#8644; Transposition (${transpositions.length + 1} paths reach this position)</div>`;

        for (const other of transpositions.slice(0, 5)) {
            const path = other.getPath();
            let pathStr = '';
            for (let i = 0; i < path.length; i++) {
                if (i % 2 === 0) pathStr += `${Math.floor(i / 2) + 1}. `;
                pathStr += path[i] + ' ';
            }
            html += `<div class="trans-path">${pathStr.trim()}</div>`;
        }
        if (transpositions.length > 5) {
            html += `<div class="trans-path">...and ${transpositions.length - 5} more</div>`;
        }
        html += '</div>';
        el.innerHTML = html;
    }

    // ===================== ECO OPENING NAMES =====================

    _updateECO() {
        const el = document.getElementById('explorer-opening');
        if (!el) return;
        const fen = this.chess.fen();
        const eco = lookupECO(fen);
        if (eco && eco.name) {
            el.innerHTML = eco.code
                ? `<span class="eco-code">${eco.code}</span>${eco.name}`
                : eco.name;
        } else {
            el.innerHTML = '';
        }
    }

    // ===================== ENGINE =====================

    async _toggleEngine() {
        this.engineEnabled = !this.engineEnabled;
        const content = document.getElementById('engine-content');
        const btn = document.getElementById('btn-engine-toggle');

        if (this.engineEnabled) {
            if (!this.engine) {
                this.engine = new ChessEngine();
                try {
                    btn.textContent = '⏳';
                    await this.engine.init();
                    console.log('Stockfish engine ready');
                } catch (e) {
                    console.error('Engine init failed:', e);
                    this.engineEnabled = false;
                    this.engine = null;
                    btn.textContent = '\u2699';
                    btn.title = 'Engine failed: ' + e.message;
                    if (content) content.style.display = 'none';
                    return;
                }
            }
            content.style.display = 'block';
            btn.classList.add('active');
            btn.textContent = '\u2699';
            this._updateEngineEval();
        } else {
            content.style.display = 'none';
            btn.classList.remove('active');
            if (this.engine) this.engine.stop();
        }
    }

    _updateEngineEval() {
        if (!this.engineEnabled || !this.engine || this.view !== 'explorer') return;

        clearTimeout(this._engineDebounce);
        this._engineDebounce = setTimeout(async () => {
            const fen = this.chess.fen();
            const fillEl = document.getElementById('engine-eval-fill');
            const scoreEl = document.getElementById('engine-score');
            const pvEl = document.getElementById('engine-pv');
            const depthEl = document.getElementById('engine-depth');

            // Live updates via onInfo callback
            this.engine.onInfo = (info) => {
                if (fillEl) fillEl.style.width = ChessEngine.getBarPercent(info) + '%';
                if (scoreEl) scoreEl.textContent = ChessEngine.formatScore(info);
                if (depthEl) depthEl.textContent = `depth ${info.depth}`;
            };

            try {
                const result = await this.engine.evaluate(fen, 18);
                if (!result) return;

                if (fillEl) fillEl.style.width = ChessEngine.getBarPercent(result) + '%';
                if (scoreEl) scoreEl.textContent = ChessEngine.formatScore(result);
                if (depthEl) depthEl.textContent = `depth ${result.depth}`;

                // Show PV in figurine notation
                if (pvEl && result.pv && result.pv.length > 0) {
                    const tempChess = new Chess(fen);
                    const pvSan = [];
                    for (let i = 0; i < Math.min(result.pv.length, 6); i++) {
                        const uci = result.pv[i];
                        const san = ChessEngine.uciToSan(tempChess, uci);
                        const move = tempChess.move(san, { sloppy: true });
                        if (!move) break;
                        pvSan.push(this._toFigurine(move.san));
                    }
                    pvEl.textContent = pvSan.join(' ');
                }
            } catch (e) {
                console.error('Engine eval error:', e);
            }
        }, 400);
    }

    // ===================== TREE VIEW =====================

    _renderTreeView() {
        const container = document.getElementById('explorer-tree-view');
        if (!container || !this.currentTree) return;

        const html = this._renderTreeBranch(this.currentTree.root, 0, 8);
        container.innerHTML = html || '<div class="tree-more">Empty repertoire</div>';
        this._bindTreeEvents(container);
    }

    _renderTreeBranch(node, depth, maxDepth) {
        let html = '';
        const children = [...node.children.entries()].sort((a, b) => a[1].priority - b[1].priority);

        for (const [san, child] of children) {
            const hasChildren = child.hasChildren();
            const isCollapsed = child.collapsed;
            const acc = MoveTree.getNodeAccuracy(child);
            const colorClass = this._getTreeNodeClass(child);
            const indent = depth * 14 + 4;
            const isActive = this.currentNode === child;
            const nagStr = child.nags.map(n => PGNParser.NAG_REVERSE[n] || '').join('');
            const moveNum = Math.floor(depth / 2) + 1;
            const isWhite = depth % 2 === 0;
            const moveNumStr = isWhite ? `<span class="tree-movenum">${moveNum}.</span>` :
                               (child.priority > 0 || !node.children.entries().next().value || node.children.entries().next().value[1] !== child)
                               ? `<span class="tree-movenum">${moveNum}...</span>` : '';

            const chevron = hasChildren
                ? `<span class="tree-chevron" data-path="${child.getPath().join(',')}">${isCollapsed ? '&#9654;' : '&#9660;'}</span>`
                : '<span class="tree-chevron"></span>';

            const accBadge = acc !== null
                ? `<span class="tree-accuracy">${acc}%</span>`
                : '';

            const toggleIcon = child.enabled ? '&#128065;' : '&#10005;';
            const toggleClass = child.enabled ? '' : ' disabled';

            html += `<div class="tree-node ${colorClass}${isActive ? ' tree-active' : ''}" style="padding-left:${indent}px" data-path="${child.getPath().join(',')}">
                ${chevron}
                <span class="tree-move">${moveNumStr}${this._toFigurine(san)}</span>
                ${nagStr ? `<span class="tree-nag">${nagStr}</span>` : ''}
                ${accBadge}
                <button class="tree-toggle-btn${toggleClass}" data-path="${child.getPath().join(',')}" title="${child.enabled ? 'Disable' : 'Enable'}">${toggleIcon}</button>
            </div>`;

            // Render children if not collapsed and within depth limit
            if (hasChildren && !isCollapsed && depth < maxDepth) {
                html += this._renderTreeBranch(child, depth + 1, maxDepth);
            } else if (hasChildren && !isCollapsed && depth >= maxDepth) {
                html += `<div class="tree-more" style="padding-left:${(depth + 1) * 14 + 4}px" data-expand-path="${child.getPath().join(',')}">... more</div>`;
            }
        }
        return html;
    }

    _getTreeNodeClass(node) {
        if (!node.enabled) return 'tree-disabled';
        if (node.stats.attempts === 0) return 'tree-new';
        const acc = MoveTree.getNodeAccuracy(node);
        if (node.stats.streak >= 5) return 'tree-mastered';
        if (acc !== null && acc < 50) return 'tree-struggling';
        return 'tree-learning';
    }

    _bindTreeEvents(container) {
        // Chevron click - toggle collapse
        container.querySelectorAll('.tree-chevron[data-path]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const path = el.dataset.path.split(',').filter(Boolean);
                const node = this.currentTree.getNodeAt(path);
                if (node) {
                    node.collapsed = !node.collapsed;
                    this._renderTreeView();
                }
            });
        });

        // Node click - navigate to position
        container.querySelectorAll('.tree-node').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.tree-chevron') || e.target.closest('.tree-toggle-btn')) return;
                const path = el.dataset.path.split(',').filter(Boolean);
                this._navigateToPath(path);
            });

            // Right-click context menu
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const path = el.dataset.path.split(',').filter(Boolean);
                const node = this.currentTree.getNodeAt(path);
                if (node) this._showContextMenu(e.clientX, e.clientY, node);
            });
        });

        // Toggle enabled
        container.querySelectorAll('.tree-toggle-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const path = el.dataset.path.split(',').filter(Boolean);
                const node = this.currentTree.getNodeAt(path);
                if (node) {
                    this.currentTree.toggleEnabled(node);
                    this._renderTreeView();
                    this._saveCurrentRepertoire();
                }
            });
        });

        // "More" links
        container.querySelectorAll('.tree-more[data-expand-path]').forEach(el => {
            el.addEventListener('click', () => {
                const path = el.dataset.expandPath.split(',').filter(Boolean);
                const node = this.currentTree.getNodeAt(path);
                if (node) {
                    node.collapsed = false;
                    this._renderTreeView();
                }
            });
        });
    }

    _navigateToPath(movePath) {
        this.chess.reset();
        this.currentNode = this.currentTree.root;
        this.explorerMoveStack = [];

        for (const san of movePath) {
            const move = this.chess.move(san, { sloppy: true });
            if (!move) break;
            this.explorerMoveStack.push(move);
            const child = this.currentNode.getChild(move.san);
            if (child) this.currentNode = child;
            else break;
        }

        this.board.position(this.chess.fen());
        this._clearAllSquareEffects();
        this._updateExplorerUI();

        if (this.explorerMoveStack.length > 0) {
            const lastMove = this.explorerMoveStack[this.explorerMoveStack.length - 1];
            this._highlightMove(lastMove, 'last');
        }
    }

    // ===================== CONTEXT MENU =====================

    _showContextMenu(x, y, node) {
        this._hideContextMenu();
        this._contextMenuNode = node;

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.id = 'context-menu';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        const enableLabel = node.enabled ? 'Disable Line' : 'Enable Line';
        const enableIcon = node.enabled ? '&#10005;' : '&#10003;';

        menu.innerHTML = `
            <div class="context-menu-item" data-action="toggle-enable">${enableIcon} ${enableLabel}</div>
            <div class="context-menu-item" data-action="set-mainline">&#9733; Set as Mainline</div>
            <div class="context-menu-sep"></div>
            <div class="context-menu-item danger" data-action="delete">&#128465; Delete Line</div>
        `;

        document.body.appendChild(menu);

        // Adjust if off-screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';

        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                this._handleContextAction(item.dataset.action);
                this._hideContextMenu();
            });
        });

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', this._hideContextMenu.bind(this), { once: true });
        }, 10);
    }

    _hideContextMenu() {
        const menu = document.getElementById('context-menu');
        if (menu) menu.remove();
    }

    _handleContextAction(action) {
        const node = this._contextMenuNode;
        if (!node || !this.currentTree) return;

        switch (action) {
            case 'toggle-enable':
                this.currentTree.toggleEnabled(node);
                break;
            case 'set-mainline':
                this.currentTree.setMainline(node);
                break;
            case 'delete':
                if (confirm(`Delete "${node.move}" and all continuations?`)) {
                    this.currentTree.deleteSubtree(node);
                    // If we deleted the current node, go to parent
                    if (this.currentNode === node) {
                        this.currentNode = node.parent || this.currentTree.root;
                    }
                }
                break;
        }

        this._renderTreeView();
        this._updateExplorerUI();
        this._saveCurrentRepertoire();
    }

    _formatMoveHistory() {
        const moves = this.chess.history();
        let html = '';
        for (let i = 0; i < moves.length; i++) {
            if (i % 2 === 0) {
                html += `<span class="move-number">${Math.floor(i / 2) + 1}.</span>`;
            }
            const isCurrentMove = i === moves.length - 1;
            html += `<span class="move-text ${isCurrentMove ? 'current-move' : ''}">${this._toFigurine(moves[i])}</span> `;
        }
        return html || '<span class="no-moves">Starting position</span>';
    }

    /**
     * Convert SAN to figurine algebraic notation using Unicode chess symbols.
     * K→♔ Q→♕ R→♖ B→♗ N→♘
     */
    _toFigurine(san) {
        const map = { K: '\u2654', Q: '\u2655', R: '\u2656', B: '\u2657', N: '\u2658' };
        if (san.length > 1 && map[san[0]]) {
            return map[san[0]] + san.substring(1);
        }
        return san;
    }

    // ===================== TRAINER MODE =====================

    _onTrainerDrop(source, target, promotion) {
        if (!this.trainer || !this.trainer.isPlayerMove()) return 'snapback';

        const result = this.trainer.submitMove(source, target, promotion);

        if (!result.valid) return 'snapback';

        if (result.correct) {
            this.sounds.playCorrect();
            this._highlightMove(result.move, 'correct');
            this._updateTrainerUI();

            if (result.isLineComplete) {
                this._onTrainerLineComplete();
            } else {
                // Play opponent's response after delay
                setTimeout(() => this._playOpponentMove(), this.autoPlayDelay);
            }
        } else {
            // Wrong move
            this.sounds.playError();
            this.trainerLineHadError = true;
            this._showTrainerFeedback(false, result);
            return 'snapback';
        }
    }

    _playOpponentMove() {
        if (!this.trainer || this.trainer.isPlayerMove()) return;

        const result = this.trainer.playOpponentMove();
        if (!result) return;

        if (result.move.captured) {
            this.sounds.playCapture();
        } else {
            this.sounds.playMove();
        }

        this.board.position(this.chess.fen());
        this._highlightMove(result.move, 'last');
        this._updateTrainerUI();

        if (result.isLineComplete) {
            this._onTrainerLineComplete();
        }
    }

    _onTrainerLineComplete() {
        this.trainer.state = 'waiting';
        const progress = this.trainer.getProgress();

        const feedbackEl = document.getElementById('trainer-feedback');
        if (feedbackEl) {
            if (this.trainerLineHadError) {
                this.sounds.playMove();
                feedbackEl.innerHTML = `<div class="feedback feedback-info">Line complete (with mistakes). <button id="btn-next-line" class="btn btn-sm">Next Line</button></div>`;
            } else {
                this.sounds.playSuccess();
                feedbackEl.innerHTML = `<div class="feedback feedback-success">Perfect! <button id="btn-next-line" class="btn btn-sm">Next Line</button></div>`;
            }
            const btn = document.getElementById('btn-next-line');
            if (btn) btn.addEventListener('click', () => this._trainerNextLine());
        }

        this._updateTrainerProgress();
    }

    _trainerNextLine() {
        if (!this.trainer) return;

        this.trainerLineHadError = false;
        const lineInfo = this.trainer.nextLine();

        if (!lineInfo) {
            this._showTrainerComplete();
            return;
        }

        this.chess = this.trainer.chess;
        this.board.position(this.chess.fen());
        this._clearAllSquareEffects();

        const feedbackEl = document.getElementById('trainer-feedback');
        if (feedbackEl) feedbackEl.innerHTML = '';

        this._updateTrainerUI();

        // If opponent moves first
        if (!this.trainer.isPlayerMove()) {
            setTimeout(() => this._playOpponentMove(), this.autoPlayDelay);
        }
    }

    _showTrainerFeedback(correct, result) {
        const feedbackEl = document.getElementById('trainer-feedback');
        if (!feedbackEl) return;

        if (correct) {
            feedbackEl.innerHTML = `<div class="feedback feedback-success">Correct!</div>`;
        } else {
            const correctMoves = result.correctMoves.join(', ');
            feedbackEl.innerHTML = `
                <div class="feedback feedback-wrong">
                    <strong>${result.played}</strong> is not in the repertoire.
                    Expected: <strong>${correctMoves}</strong>
                    <div class="feedback-actions">
                        <button id="btn-retry" class="btn btn-sm">Try Again</button>
                        <button id="btn-show-move" class="btn btn-sm btn-secondary">Show Move</button>
                    </div>
                </div>`;

            document.getElementById('btn-retry')?.addEventListener('click', () => {
                feedbackEl.innerHTML = '<div class="feedback feedback-info">Try the correct move...</div>';
            });

            document.getElementById('btn-show-move')?.addEventListener('click', () => {
                const r = this.trainer.playCorrectMove();
                if (r) {
                    this.board.position(this.chess.fen());
                    this._highlightMove(r.move, 'last');
                    this._updateTrainerUI();

                    if (r.isLineComplete) {
                        this._onTrainerLineComplete();
                    } else {
                        setTimeout(() => this._playOpponentMove(), this.autoPlayDelay);
                    }
                }
            });
        }
    }

    _showTrainerComplete() {
        const progress = this.trainer.getProgress();
        const container = document.getElementById('trainer-feedback');
        if (container) {
            const pct = progress.stats.total > 0
                ? Math.round(progress.stats.correct / (progress.stats.correct + progress.stats.wrong) * 100) : 0;
            container.innerHTML = `
                <div class="session-complete">
                    <h3>Session Complete!</h3>
                    <div class="session-summary">
                        <div class="stat"><span class="stat-value">${progress.stats.total}</span><span class="stat-label">Lines</span></div>
                        <div class="stat"><span class="stat-value">${progress.stats.correct}</span><span class="stat-label">Correct</span></div>
                        <div class="stat"><span class="stat-value">${progress.stats.wrong}</span><span class="stat-label">Wrong</span></div>
                        <div class="stat"><span class="stat-value">${pct}%</span><span class="stat-label">Accuracy</span></div>
                    </div>
                    <button id="btn-train-again" class="btn">Train Again</button>
                    <button id="btn-back-home" class="btn btn-secondary">Back</button>
                </div>`;

            document.getElementById('btn-train-again')?.addEventListener('click', () => {
                this._startTraining();
            });
            document.getElementById('btn-back-home')?.addEventListener('click', () => {
                this._saveCurrentRepertoire();
                this._showView('welcome');
            });
        }
    }

    _updateTrainerUI() {
        const moveList = document.getElementById('trainer-moves');
        if (moveList) {
            moveList.innerHTML = this._formatMoveHistory();
        }
        this._updateTrainerProgress();
    }

    _updateTrainerProgress() {
        const progress = this.trainer.getProgress();
        const progressEl = document.getElementById('trainer-progress');
        if (progressEl) {
            progressEl.innerHTML = `
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${progress.percent}%"></div>
                </div>
                <div class="progress-text">
                    ${progress.completed} / ${progress.total} lines
                    | Correct: ${progress.stats.correct} | Wrong: ${progress.stats.wrong}
                </div>`;
        }
    }

    // ===================== VIEWS =====================

    _showView(viewName) {
        this.view = viewName;

        // Hide all view panels
        document.querySelectorAll('.view-panel').forEach(v => {
            v.classList.remove('active');
            v.style.display = 'none';
        });

        const workspace = document.getElementById('workspace');
        const explorerPanel = document.getElementById('explorer-panel');
        const trainerPanel = document.getElementById('trainer-panel');
        const explorerControls = document.getElementById('explorer-controls');
        const trainerControls = document.getElementById('trainer-controls');

        if (viewName === 'explorer' || viewName === 'trainer') {
            // Show workspace
            workspace.style.display = 'flex';
            workspace.classList.add('active');

            // Toggle panels and controls
            explorerPanel.style.display = viewName === 'explorer' ? 'block' : 'none';
            trainerPanel.style.display = viewName === 'trainer' ? 'block' : 'none';
            explorerControls.style.display = viewName === 'explorer' ? 'flex' : 'none';
            trainerControls.style.display = viewName === 'trainer' ? 'flex' : 'none';

            // Update tabs
            document.getElementById('tab-train')?.classList.toggle('active', viewName === 'trainer');
            document.getElementById('tab-explore')?.classList.toggle('active', viewName === 'explorer');

            // Resize board after layout
            setTimeout(() => {
                if (this.board) this.board.resize();
            }, 50);
        } else {
            // Show the requested view panel
            workspace.style.display = 'none';
            const viewEl = document.getElementById(`view-${viewName}`);
            if (viewEl) {
                viewEl.style.display = 'flex';
                viewEl.classList.add('active');
            }
        }

        // Close mobile sidebar
        document.getElementById('sidebar')?.classList.remove('open');
        document.getElementById('sidebar-overlay')?.classList.remove('active');

        this._updateSidebarSelection();
    }

    _updateSidebarSelection() {
        document.querySelectorAll('.sidebar-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === this.currentRepertoireId);
        });
    }

    async _loadSidebar() {
        const list = await this.db.listRepertoires();
        const container = document.getElementById('sidebar-list');
        if (!container) return;

        if (list.length === 0) {
            container.innerHTML = '<div class="sidebar-empty">No repertoires yet.</div>';
            return;
        }

        let html = '';
        for (const rep of list) {
            const colorIcon = rep.color === 'white' ? '&#9812;' : '&#9818;';
            const colorClass = rep.color === 'white' ? 'white-rep' : 'black-rep';
            const isActive = rep.id === this.currentRepertoireId ? ' active' : '';
            html += `
                <div class="sidebar-item ${colorClass}${isActive}" data-id="${rep.id}">
                    <span class="sidebar-color">${colorIcon}</span>
                    <span class="sidebar-name">${this._escapeHtml(rep.name)}</span>
                    <div class="sidebar-item-actions">
                        <button class="btn btn-export-sb" data-id="${rep.id}" title="Export PGN">&#128190;</button>
                        <button class="btn btn-delete-sb btn-danger" data-id="${rep.id}" title="Delete">&#10005;</button>
                    </div>
                </div>`;
        }
        container.innerHTML = html;

        // Bind sidebar click events
        container.querySelectorAll('.sidebar-item').forEach(el => {
            el.addEventListener('click', (e) => {
                // Don't trigger if clicking action buttons
                if (e.target.closest('.sidebar-item-actions')) return;
                this._saveCurrentRepertoire();
                this._openRepertoire(el.dataset.id, 'trainer');
            });
        });

        container.querySelectorAll('.btn-export-sb').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._exportRepertoire(btn.dataset.id);
            });
        });

        container.querySelectorAll('.btn-delete-sb').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._deleteRepertoire(btn.dataset.id);
            });
        });
    }

    async _openRepertoire(id, mode) {
        const tree = await this.db.loadRepertoire(id);
        if (!tree) {
            alert('Repertoire not found');
            return;
        }

        this.currentTree = tree;
        this.currentNode = tree.root;
        this.currentRepertoireId = id;
        this.boardOrientation = tree.color;
        this.board.orientation(this.boardOrientation);

        this.chess.reset();
        this.board.position('start');
        this.explorerMoveStack = [];
        this._clearAllSquareEffects();

        if (mode === 'explorer') {
            this._showView('explorer');
            this.currentTree.setDefaultCollapse(3);
            this._updateExplorerUI();
            this._renderTreeView();
        } else if (mode === 'trainer') {
            this._showView('trainer');
            this._startTraining();
        }

        this._updateSidebarSelection();
    }

    _startTraining(options = {}) {
        if (!this.currentTree) return;

        this.trainer = new Trainer(this.currentTree);
        this.chess = this.trainer.chess;
        this.trainerLineHadError = false;

        const mode = document.getElementById('train-mode')?.value || 'mix';
        const limit = parseInt(document.getElementById('train-limit')?.value || '20');

        const sessionInfo = this.trainer.startSession({
            mode,
            lineLimit: limit,
            ...options
        });

        if (sessionInfo.state === 'finished') {
            const feedbackEl = document.getElementById('trainer-feedback');
            if (feedbackEl) {
                feedbackEl.innerHTML = '<div class="feedback feedback-info">No lines to review! All caught up.</div>';
            }
            return;
        }

        this._trainerNextLine();
    }

    async _saveCurrentRepertoire() {
        if (!this.currentTree) return;
        try {
            await this.db.saveRepertoire(this.currentTree);
        } catch (e) {
            console.error('Failed to save:', e);
        }
    }

    async _exportRepertoire(id) {
        try {
            const tree = await this.db.loadRepertoire(id);
            if (!tree) throw new Error('Repertoire not found');
            const pgn = PGNParser.export(tree);
            const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeName = tree.name.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 50);
            a.download = `${safeName}.pgn`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('Export failed: ' + e.message);
        }
    }

    // ===================== BACKUP / RESTORE =====================

    async _backupAll() {
        try {
            const backup = await this.db.exportAll();
            const json = JSON.stringify(backup, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date().toISOString().split('T')[0];
            a.download = `chess-repertoire-backup-${date}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('Backup failed: ' + e.message);
        }
    }

    async _restoreFromFile(file) {
        const statusEl = document.getElementById('restore-status');
        try {
            statusEl.style.display = 'block';
            statusEl.className = '';
            statusEl.textContent = 'Reading backup file...';

            const text = await file.text();
            const backup = JSON.parse(text);

            const count = backup.repertoireCount || backup.repertoires?.length || 0;
            const date = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : 'unknown';

            const mode = confirm(
                `Backup from ${date}\n${count} repertoire(s) found.\n\nOK = Merge (add missing, keep existing)\nCancel = Replace ALL (delete current data first)`
            ) ? 'merge' : 'replace';

            if (mode === 'replace') {
                if (!confirm('Are you sure? This will DELETE all current repertoires and replace them with the backup.')) {
                    statusEl.style.display = 'none';
                    return;
                }
            }

            statusEl.textContent = 'Restoring...';

            const result = await this.db.importAll(backup, mode);

            statusEl.className = 'restore-success';
            let msg = `Restored ${result.imported} repertoire(s).`;
            if (result.skipped > 0) msg += ` Skipped ${result.skipped} (already exist).`;
            if (result.errors.length > 0) msg += ` ${result.errors.length} error(s).`;
            statusEl.textContent = msg;

            await this._loadSidebar();

            setTimeout(() => { statusEl.style.display = 'none'; }, 5000);

        } catch (e) {
            statusEl.className = 'restore-error';
            statusEl.textContent = 'Restore failed: ' + e.message;
            setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
        }
    }

    async _deleteRepertoire(id) {
        if (!confirm('Delete this repertoire? This cannot be undone.')) return;
        try {
            await this.db.deleteRepertoire(id);
            await this._loadSidebar();
        } catch (e) {
            alert('Delete failed: ' + e.message);
        }
    }

    // ===================== IMPORT =====================

    _showImportDialog() {
        this._showView('import');
    }

    async _handleImport() {
        const fileInput = document.getElementById('pgn-file');
        const textInput = document.getElementById('pgn-text');
        const nameInput = document.getElementById('import-name');
        const colorSelect = document.getElementById('import-color');
        const progressEl = document.getElementById('import-progress');
        const statusEl = document.getElementById('import-status');

        let pgnText = '';

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            statusEl.textContent = `Reading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`;
            pgnText = await file.text();
        } else if (textInput.value.trim()) {
            pgnText = textInput.value.trim();
        } else {
            alert('Please select a PGN file or paste PGN text.');
            return;
        }

        const name = nameInput.value.trim() || 'Imported Repertoire';
        const color = colorSelect.value;

        // Detect language first
        const langInfo = document.getElementById('import-language-info');
        const statsDiv = document.getElementById('import-stats');
        const detectedLang = PGNParser.detectLanguage(pgnText.substring(0, 5000));
        const langName = PGNParser.getLanguageName(detectedLang);

        if (langInfo) {
            langInfo.innerHTML = detectedLang !== 'en'
                ? `<span class="language-badge">Detected notation: ${langName}</span>`
                : `<span class="language-badge">Notation: ${langName}</span>`;
        }

        statusEl.textContent = 'Parsing PGN...';
        progressEl.style.display = 'block';
        progressEl.querySelector('.progress-bar').style.width = '0%';

        try {
            const result = await PGNParser.parseAsync(pgnText, {
                repertoireName: name,
                color: color,
                mergeGames: true,
                language: detectedLang,
                onProgress: (pct) => {
                    progressEl.querySelector('.progress-bar').style.width = pct + '%';
                    statusEl.textContent = `Parsing... ${pct}% (${langName})`;
                }
            });

            const tree = result.trees[0];
            const nodeCount = tree.countNodes();
            const lineCount = tree.countLines();
            const transCount = tree.countTranspositions();

            statusEl.textContent = `Saving: ${nodeCount} positions, ${lineCount} lines...`;

            await this.db.saveRepertoire(tree);

            statusEl.textContent = `Imported successfully!`;
            progressEl.querySelector('.progress-bar').style.width = '100%';

            if (statsDiv) {
                statsDiv.style.display = 'flex';
                statsDiv.innerHTML = `
                    <span class="stat-item"><strong>${nodeCount}</strong> positions</span>
                    <span class="stat-item"><strong>${lineCount}</strong> lines</span>
                    <span class="stat-item"><strong>${transCount}</strong> transpositions</span>
                    <span class="stat-item">Notation: <strong>${langName}</strong></span>
                `;
            }

            fileInput.value = '';
            textInput.value = '';
            nameInput.value = '';

            await this._loadSidebar();

            setTimeout(() => {
                this._showView('welcome');
                progressEl.style.display = 'none';
                if (statsDiv) statsDiv.style.display = 'none';
                if (langInfo) langInfo.innerHTML = '';
            }, 2000);

        } catch (e) {
            statusEl.textContent = 'Error: ' + e.message;
            console.error('Import error:', e);
        }
    }

    // ===================== EVENTS =====================

    _bindEvents() {
        // Navigation
        document.getElementById('btn-home')?.addEventListener('click', () => {
            this._saveCurrentRepertoire();
            this._showView('welcome');
        });

        document.getElementById('btn-import')?.addEventListener('click', () => {
            this._showImportDialog();
        });

        document.getElementById('btn-new-repertoire')?.addEventListener('click', () => {
            this._createNewRepertoire();
        });

        // Backup / Restore
        document.getElementById('btn-backup')?.addEventListener('click', () => {
            this._backupAll();
        });

        document.getElementById('restore-file')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this._restoreFromFile(file);
                e.target.value = ''; // reset so same file can be selected again
            }
        });

        // Import
        document.getElementById('btn-do-import')?.addEventListener('click', () => {
            this._handleImport();
        });

        document.getElementById('btn-cancel-import')?.addEventListener('click', () => {
            this._showView('welcome');
        });

        // Explorer controls
        document.getElementById('btn-explorer-back')?.addEventListener('click', () => {
            this._explorerUndo();
        });

        document.getElementById('btn-explorer-reset')?.addEventListener('click', () => {
            this._explorerReset();
        });

        document.getElementById('btn-explorer-flip')?.addEventListener('click', () => {
            this.board.flip();
        });

        // Engine toggle
        document.getElementById('btn-engine-toggle')?.addEventListener('click', () => {
            this._toggleEngine();
        });

        // Tree view controls
        document.getElementById('btn-tree-collapse-all')?.addEventListener('click', () => {
            if (this.currentTree) {
                this.currentTree.setDefaultCollapse(0);
                this._renderTreeView();
            }
        });

        document.getElementById('btn-tree-expand-all')?.addEventListener('click', () => {
            if (this.currentTree) {
                this.currentTree._traverse(this.currentTree.root, n => { n.collapsed = false; });
                this._renderTreeView();
            }
        });

        // Tab switching
        document.getElementById('tab-train')?.addEventListener('click', () => {
            if (!this.currentTree) return;
            if (this.view === 'trainer') return;
            this._showView('trainer');
            this._startTraining();
        });

        document.getElementById('tab-explore')?.addEventListener('click', () => {
            if (!this.currentTree) return;
            if (this.view === 'explorer') return;
            this._showView('explorer');
            this.chess.reset();
            this.board.position('start');
            this.explorerMoveStack = [];
            this.currentNode = this.currentTree.root;
            this._clearAllSquareEffects();
            this._updateExplorerUI();
            this._renderTreeView();
        });

        // Sidebar toggle (mobile)
        document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            sidebar?.classList.toggle('open');
            if (overlay) {
                overlay.classList.toggle('active', sidebar?.classList.contains('open'));
            }
        });

        // Sidebar overlay click closes sidebar
        document.addEventListener('click', (e) => {
            if (e.target.id === 'sidebar-overlay') {
                document.getElementById('sidebar')?.classList.remove('open');
                e.target.classList.remove('active');
            }
        });

        // Trainer controls
        document.getElementById('btn-trainer-skip')?.addEventListener('click', () => {
            if (this.trainer) {
                this.trainerLineHadError = false;
                const line = this.trainer.skipLine();
                if (line) {
                    this.chess = this.trainer.chess;
                    this.board.position(this.chess.fen());
                    this._clearAllSquareEffects();
                    this._updateTrainerUI();
                    if (!this.trainer.isPlayerMove()) {
                        setTimeout(() => this._playOpponentMove(), this.autoPlayDelay);
                    }
                } else {
                    this._showTrainerComplete();
                }
            }
        });

        document.getElementById('btn-trainer-flip')?.addEventListener('click', () => {
            this.board.flip();
        });

        document.getElementById('btn-trainer-restart')?.addEventListener('click', () => {
            this._startTraining();
        });

        document.getElementById('btn-hints')?.addEventListener('click', () => {
            this.showHints = !this.showHints;
            const btn = document.getElementById('btn-hints');
            btn.classList.toggle('active', this.showHints);
        });

        // Sound toggle
        document.getElementById('btn-sound')?.addEventListener('click', () => {
            const enabled = this.sounds.toggle();
            const btn = document.getElementById('btn-sound');
            btn.classList.toggle('muted', !enabled);
            btn.title = enabled ? 'Sounds ON' : 'Sounds OFF';
        });

        // Train settings
        document.getElementById('train-mode')?.addEventListener('change', () => {
            this._startTraining();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case 'ArrowLeft':
                    if (this.view === 'explorer') this._explorerUndo();
                    break;
                case 'f':
                    this.board.flip();
                    break;
                case 'h':
                    if (this.view === 'trainer') {
                        this.showHints = !this.showHints;
                        document.getElementById('btn-hints')?.classList.toggle('active', this.showHints);
                    }
                    break;
                case 'm': {
                    const enabled = this.sounds.toggle();
                    const btn = document.getElementById('btn-sound');
                    if (btn) {
                        btn.classList.toggle('muted', !enabled);
                        btn.title = enabled ? 'Sounds ON' : 'Sounds OFF';
                    }
                    break;
                }
                case 'e':
                    if (this.view === 'explorer') {
                        this._toggleEngine();
                    }
                    break;
            }
        });
    }

    async _createNewRepertoire() {
        const name = prompt('Repertoire name:', 'My Repertoire');
        if (!name) return;

        const color = prompt('Color? (white/black):', 'white');
        if (color !== 'white' && color !== 'black') {
            alert('Please enter "white" or "black"');
            return;
        }

        const tree = new MoveTree(name, color);
        await this.db.saveRepertoire(tree);
        await this._loadSidebar();
        await this._openRepertoire(tree.id, 'explorer');
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init().catch(console.error);
});
