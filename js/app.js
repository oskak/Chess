/**
 * Main Application - Chess Opening Repertoire Trainer
 *
 * Views: welcome, import, and the workspace views explorer / trainer / sandbox
 * which share one chessboard.js board. `this.chess` always points at the
 * chess.js game currently shown on the board: the trainer's own game while
 * training, otherwise `this.boardChess`.
 */

const PREFS_KEY = 'crt-prefs-v1';
const MOVE_QUALITY_NAGS = [1, 3, 5, 6, 2, 4]; // ! !! !? ?! ? ??

class App {
    constructor() {
        this.db = new RepertoireDB();
        this.board = null;
        this.overlay = null;
        this.boardChess = new Chess();   // explorer & sandbox game
        this.chess = this.boardChess;     // game currently on the board
        this.trainer = null;
        this.currentTree = null;
        this.currentNode = null;          // tree node of the board position (explorer), null = off-book
        this.currentRepertoireId = null;
        this.boardOrientation = 'white';
        this.view = 'welcome';
        this.autoPlayDelay = 450;          // ms before the opponent's reply in training
        this.sounds = new SoundEngine();
        this._repertoireList = [];

        // Explorer
        this.explorerMoveStack = [];       // chess.js moves from the start position
        this.explorerForwardStack = [];    // moves stepped back over (for forward navigation)
        this.editMode = false;
        this._noteNode = null;
        this._noteTimer = null;

        // Sandbox
        this.sandboxMoveStack = [];
        this.sandboxRedoStack = [];
        this.sandboxStartFen = null;

        // Engine
        this.engine = null;
        this.engineEnabled = false;
        this.engineStatus = 'off';         // off | loading | ready | error
        this.engineError = '';
        this.engineSnapshot = null;        // latest analysis of the board position
        this.engineDepth = 18;
        this.engineLines = 3;
        this._engineTimer = null;
        this._engineRenderQueued = false;

        // Trainer
        this.trainerArrow = null;
        this._opponentTimer = null;
        this._autoNextTimer = null;

        // Board interaction
        this._selectedSquare = null;
        this._pendingPromotion = false;
        this._lastHighlight = null;
        this._hintSquare = null;
        this._saveTimer = null;

        this._contextMenuNode = null;
        this.useFigurine = this._detectFigurineSupport();
        this.prefs = this._loadPrefs();
    }

    async init() {
        try {
            this._initBoard();
        } catch (e) {
            console.error('Board init failed:', e);
            document.getElementById('board').innerHTML =
                '<div style="padding:20px;color:#e55b5b;">Board failed to load: ' + this._escapeHtml(e.message) + '</div>';
        }

        try {
            this._bindEvents();
        } catch (e) {
            console.error('Event binding failed:', e);
        }

        this._applyPrefs();

        // Request persistent storage (prevents browser eviction)
        try {
            await this.db.requestPersistentStorage();
        } catch (e) {
            console.warn('Persistent storage request failed:', e);
        }

        try {
            await this._loadSidebar();
        } catch (e) {
            console.error('Loading repertoires failed:', e);
        }

        this._showView('welcome');
        await this._renderWelcome();
    }

    // ===================== PREFERENCES =====================

    _loadPrefs() {
        const defaults = { engineOn: false, learnNew: true, sound: true, lastBackup: null, trainMode: 'mix', trainLimit: 20 };
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
        } catch (e) {
            return defaults;
        }
    }

    _savePref(key, value) {
        this.prefs[key] = value;
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
        } catch (e) { /* storage unavailable — preference just won't persist */ }
    }

    _applyPrefs() {
        this.sounds.enabled = this.prefs.sound !== false;
        document.getElementById('btn-sound')?.classList.toggle('muted', !this.sounds.enabled);
        const learn = document.getElementById('train-learn');
        if (learn) learn.checked = this.prefs.learnNew !== false;
        const mode = document.getElementById('train-mode');
        if (mode && this.prefs.trainMode) mode.value = this.prefs.trainMode;
        const limit = document.getElementById('train-limit');
        if (limit && this.prefs.trainLimit) limit.value = this.prefs.trainLimit;
        this.engineEnabled = false; // turned on lazily when a board view opens
    }

    /**
     * Detect if browser/OS can render chess figurine Unicode symbols.
     */
    _detectFigurineSupport() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 20;
            canvas.height = 20;
            const ctx = canvas.getContext('2d');
            if (!ctx) return false;
            ctx.font = '16px serif';
            const metrics = ctx.measureText('♘'); // knight
            // If width is very small or zero, the symbol likely renders as a box
            return metrics.width > 4;
        } catch (e) {
            return false;
        }
    }

    // ===================== BOARD =====================

    _initBoard() {
        this.board = Chessboard('board', {
            draggable: true,
            position: 'start',
            orientation: 'white',
            pieceTheme: (piece) => getPieceImageUrl(piece),
            onDragStart: (source, piece) => this._onDragStart(source, piece),
            onDrop: (source, target, piece) => this._onDrop(source, target, piece),
            onSnapEnd: () => this._onSnapEnd(),
            moveSpeed: 160,
            snapbackSpeed: 120,
            snapSpeed: 60,
            appearSpeed: 100
        });
        this.overlay = new BoardOverlay('board', () => this.boardOrientation);
        this._initClickToMove();

        // Keep the board fitted to its column (window resize, sidebar, panels).
        let timer = null;
        let lastWidth = 0;
        const refit = () => {
            const el = document.getElementById('board');
            const w = el ? el.clientWidth : 0;
            if (w && w !== lastWidth) {
                lastWidth = w;
                this._resizeBoard();
            }
        };
        window.addEventListener('resize', () => {
            clearTimeout(timer);
            timer = setTimeout(refit, 60);
        });
        if (window.ResizeObserver) {
            const col = document.querySelector('.workspace-board');
            if (col) new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(refit, 30); }).observe(col);
        }
    }

    _resizeBoard() {
        if (!this.board) return;
        this.board.resize();
        // chessboard.js rebuilds the squares on resize: restore our marks
        this._selectedSquare = null;
        this._reapplySquareMarks();
        if (this.overlay) this.overlay.redraw();
    }

    _resizeBoardSoon() {
        setTimeout(() => this._resizeBoard(), 30);
    }

    _setOrientation(color) {
        this.boardOrientation = color === 'black' ? 'black' : 'white';
        if (this.board) this.board.orientation(this.boardOrientation);
        this._afterBoardRedraw();
    }

    _flipBoard() {
        this._setOrientation(this.boardOrientation === 'white' ? 'black' : 'white');
        this._renderEvalGauge();
    }

    _afterBoardRedraw() {
        this._selectedSquare = null;
        this._reapplySquareMarks();
        if (this.overlay) this.overlay.redraw();
    }

    /** Can the user pick up this piece in the current mode? */
    _canMovePiece(piece) {
        if (this._pendingPromotion || this.chess.game_over()) return false;
        const pieceColor = piece[0];
        if (pieceColor !== this.chess.turn()) return false;

        if (this.view === 'explorer' || this.view === 'sandbox') return true;
        if (this.view === 'trainer') {
            return !!this.trainer && this.trainer.state === 'playing' && this.trainer.isPlayerMove();
        }
        return false;
    }

    _onDragStart(source, piece) {
        return this._canMovePiece(piece);
    }

    _onDrop(source, target, piece) {
        if (source === target || target === 'offboard') {
            // A tap on a piece (no movement): select it for click-to-move.
            if (source === target) this._onSquareTapped(source);
            return 'snapback';
        }
        this._clearSelection();

        if (this._isPromotionMove(source, target)) {
            // Keep the pawn on the target square while the player picks a piece.
            this._pendingPromotion = true;
            Dialogs.promotion(piece[0]).then((promotion) => {
                this._pendingPromotion = false;
                if (promotion) this._dispatchMove(source, target, promotion);
                // Re-sync the board whatever happened (move made, rejected or cancelled)
                this.board.position(this.chess.fen(), false);
            });
            return;
        }

        return this._dispatchMove(source, target);
    }

    /** True if moving source→target is a legal pawn promotion in the current position. */
    _isPromotionMove(source, target) {
        return this.chess.moves({ square: source, verbose: true })
            .some(m => m.to === target && m.promotion);
    }

    _isLegalTarget(source, target) {
        return this.chess.moves({ square: source, verbose: true }).some(m => m.to === target);
    }

    /**
     * Route a move to the active mode. Returns 'snapback' if it was rejected.
     * Used by drag-and-drop, click-to-move and the promotion picker.
     */
    _dispatchMove(source, target, promotion) {
        this._clearSelection();
        if (this.view === 'explorer') return this._onExplorerDrop(source, target, promotion);
        if (this.view === 'trainer') return this._onTrainerDrop(source, target, promotion);
        if (this.view === 'sandbox') return this._onSandboxDrop(source, target, promotion);
        return 'snapback';
    }

    _onSnapEnd() {
        if (this._pendingPromotion) return;
        // Castling, en passant and promotion change more than the dragged piece.
        this.board.position(this.chess.fen(), false);
    }

    // ----- Click-to-move (tap a piece, then a square) -----

    _initClickToMove() {
        const el = document.getElementById('board');
        if (!el) return;
        el.addEventListener('click', (e) => {
            const sq = e.target.closest('[data-square]');
            if (sq) this._onSquareTapped(sq.dataset.square);
        });
    }

    _onSquareTapped(square) {
        if (this._pendingPromotion) return;
        const from = this._selectedSquare;
        if (from && from !== square && this._isLegalTarget(from, square)) {
            this._clearSelection();
            this._playUserMove(from, square);
            return;
        }
        const piece = this.chess.get(square);
        if (piece && this._canMovePiece(piece.color + piece.type.toUpperCase())) {
            if (from === square) this._clearSelection();
            else this._selectSquare(square);
            return;
        }
        this._clearSelection();
    }

    _playUserMove(from, to) {
        if (this._isPromotionMove(from, to)) {
            this._pendingPromotion = true;
            Dialogs.promotion(this.chess.turn()).then((promotion) => {
                this._pendingPromotion = false;
                if (promotion) this._dispatchMove(from, to, promotion);
                this.board.position(this.chess.fen(), false);
            });
            return;
        }
        const result = this._dispatchMove(from, to);
        this.board.position(this.chess.fen(), result !== 'snapback');
    }

    _selectSquare(square) {
        this._clearSelection();
        this._selectedSquare = square;
        this._squareEl(square)?.classList.add('sq-selected');
        for (const m of this.chess.moves({ square, verbose: true })) {
            this._squareEl(m.to)?.classList.add(m.captured ? 'sq-capture' : 'sq-target');
        }
    }

    _clearSelection() {
        this._selectedSquare = null;
        document.querySelectorAll('#board .sq-selected, #board .sq-target, #board .sq-capture').forEach(el => {
            el.classList.remove('sq-selected', 'sq-target', 'sq-capture');
        });
    }

    _squareEl(square) {
        return document.querySelector(`#board .square-${square}`);
    }

    // ----- Square highlights -----

    _clearAllSquareEffects() {
        document.querySelectorAll('#board .highlight-correct, #board .highlight-wrong, #board .highlight-last, #board .hint-source').forEach(el => {
            el.classList.remove('highlight-correct', 'highlight-wrong', 'highlight-last', 'hint-source');
        });
        this._lastHighlight = null;
        this._hintSquare = null;
        this._clearSelection();
    }

    _highlightMove(move, type) {
        document.querySelectorAll('#board .highlight-correct, #board .highlight-wrong, #board .highlight-last').forEach(el => {
            el.classList.remove('highlight-correct', 'highlight-wrong', 'highlight-last');
        });
        this._lastHighlight = move ? { from: move.from, to: move.to, type } : null;
        if (!move) return;
        this._squareEl(move.from)?.classList.add(`highlight-${type}`);
        this._squareEl(move.to)?.classList.add(`highlight-${type}`);
    }

    _reapplySquareMarks() {
        if (this._lastHighlight) {
            const { from, to, type } = this._lastHighlight;
            this._squareEl(from)?.classList.add(`highlight-${type}`);
            this._squareEl(to)?.classList.add(`highlight-${type}`);
        }
        if (this._hintSquare) this._squareEl(this._hintSquare)?.classList.add('hint-source');
    }

    _flashWrong(source, target) {
        const els = [this._squareEl(source), this._squareEl(target)].filter(Boolean);
        els.forEach(el => el.classList.add('flash-wrong'));
        setTimeout(() => els.forEach(el => el.classList.remove('flash-wrong')), 450);
    }

    _playMoveSound(move) {
        if (this.chess.in_check()) this.sounds.playCheck();
        else if (move.captured) this.sounds.playCapture();
        else this.sounds.playMove();
    }

    // ===================== ARROWS =====================

    _updateArrows() {
        if (!this.overlay) return;
        const C = BoardOverlay.COLORS;
        const arrows = [];
        const fen = this.chess.fen();

        if (this.view === 'explorer' && this.currentNode) {
            const probe = new Chess(fen);
            const children = [...this.currentNode.children.values()].sort((a, b) => a.priority - b.priority);
            for (const child of children) {
                const m = probe.move(child.move, { sloppy: true });
                if (!m) continue;
                probe.undo();
                const main = child.priority === 0;
                arrows.push({
                    from: m.from, to: m.to,
                    color: child.enabled ? (main ? C.green : C.paleGreen) : '#777',
                    opacity: main ? 0.85 : 0.5,
                    width: main ? 15 : 11
                });
            }
        }

        if ((this.view === 'explorer' || this.view === 'sandbox') && this.engineEnabled) {
            const snap = this.engineSnapshot;
            if (snap && snap.fen === fen && snap.bestMove && snap.bestMove.length >= 4) {
                arrows.push({ from: snap.bestMove.slice(0, 2), to: snap.bestMove.slice(2, 4), color: C.blue, opacity: 0.65, width: 10 });
            }
        }

        if (this.view === 'trainer' && this.trainerArrow) arrows.push(this.trainerArrow);

        this.overlay.setArrows(arrows);
    }

    // ===================== EXPLORER =====================

    _openExplorer(path = []) {
        if (!this.currentTree) return;
        this._cancelTrainerTimers();
        this.chess = this.boardChess;
        this._showView('explorer');
        this._setOrientation(this.currentTree.color);
        this._navigateToPath(path);
        this._renderTreeView();
        this._ensureEngineForView();
    }

    _onExplorerDrop(source, target, promotion) {
        const moveObj = { from: source, to: target };
        if (promotion) moveObj.promotion = promotion;

        const move = this.chess.move(moveObj);
        if (!move) return 'snapback';
        this._explorerApplyMove(move);
    }

    /**
     * Book-keeping after a move was made on the explorer board (by drag, click,
     * continuation list, engine line or forward navigation).
     */
    _explorerApplyMove(move, { navigation = false } = {}) {
        this._flushNote();
        this.explorerMoveStack.push(move);
        const fwd = this.explorerForwardStack;
        if (fwd.length && fwd[fwd.length - 1].san === move.san) fwd.pop();
        else this.explorerForwardStack = [];

        const path = this.explorerMoveStack.map(m => m.san);
        let node = this.currentTree ? this.currentTree.getNodeAt(path) : null;

        if (!node && this.editMode && this.currentTree && !navigation) {
            node = this.currentTree.addLine(path);
            this.currentTree.rebuildPositionIndex();
            this._repertoireChanged();
            Dialogs.toast(`Added ${this._formatPly(path.length - 1, move.san)} to the repertoire`, 'success', 1800);
        }

        this.currentNode = node;
        if (navigation) this.sounds.playMove();
        else {
            this._playMoveSound(move);
            if (node && node.isTransposition) this.sounds.playTransposition();
        }
        this._highlightMove(move, 'last');
        this._updateExplorerUI();
    }

    _explorerPlaySan(san) {
        const move = this.chess.move(san, { sloppy: true });
        if (!move) return;
        this.board.position(this.chess.fen());
        this._explorerApplyMove(move);
    }

    _explorerPlayUci(uci) {
        const move = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        if (!move) return;
        this.board.position(this.chess.fen());
        if (this.view === 'sandbox') this._sandboxApplyMove(move);
        else this._explorerApplyMove(move);
    }

    _explorerStepBack() {
        if (this.explorerMoveStack.length === 0) return false;
        if (!this.chess.undo()) return false;
        this.explorerForwardStack.push(this.explorerMoveStack.pop());
        return true;
    }

    _explorerStepForward() {
        const fwd = this.explorerForwardStack;
        let san = null;
        if (fwd.length) {
            san = fwd[fwd.length - 1].san;
        } else {
            const node = this._explorerNodeAtBoard();
            const main = node ? node.getMainline() : null;
            if (main) san = main.move;
        }
        if (!san) return false;
        const move = this.chess.move(san, { sloppy: true });
        if (!move) {
            this.explorerForwardStack = [];
            return false;
        }
        if (fwd.length) fwd.pop();
        this.explorerMoveStack.push(move);
        return true;
    }

    _explorerNodeAtBoard() {
        if (!this.currentTree) return null;
        return this.currentTree.getNodeAt(this.explorerMoveStack.map(m => m.san));
    }

    /** Re-sync board, tree position and panel after navigation. */
    _explorerSync(animate = true) {
        this._flushNote();
        this.board.position(this.chess.fen(), animate);
        this.currentNode = this._explorerNodeAtBoard();
        const last = this.explorerMoveStack[this.explorerMoveStack.length - 1];
        this._hintSquare = null;
        this._clearSelection();
        this._highlightMove(last || null, 'last');
        this._updateExplorerUI();
    }

    _explorerBack() {
        if (this._explorerStepBack()) {
            this.sounds.playMove();
            this._explorerSync();
        }
    }

    _explorerForward() {
        if (this._explorerStepForward()) {
            this.sounds.playMove();
            this._explorerSync();
        }
    }

    _explorerGoToStart() {
        let moved = false;
        while (this._explorerStepBack()) moved = true;
        if (moved) this._explorerSync(false);
    }

    _explorerGoToEnd() {
        let moved = false;
        for (let i = 0; i < 300 && this._explorerStepForward(); i++) moved = true;
        if (moved) this._explorerSync(false);
    }

    _explorerGoToPly(ply) {
        while (this.explorerMoveStack.length > ply && this._explorerStepBack()) { /* back */ }
        while (this.explorerMoveStack.length < ply && this._explorerStepForward()) { /* forward */ }
        this._explorerSync(false);
    }

    _navigateToPath(movePath) {
        this._flushNote();
        this.chess.reset();
        this.explorerMoveStack = [];
        this.explorerForwardStack = [];
        for (const san of movePath) {
            const move = this.chess.move(san, { sloppy: true });
            if (!move) break;
            this.explorerMoveStack.push(move);
        }
        this._explorerSync(false);
    }

    _setEditMode(on) {
        this.editMode = !!on;
        const btn = document.getElementById('btn-edit-mode');
        if (btn) {
            btn.classList.toggle('active', this.editMode);
            btn.setAttribute('aria-pressed', String(this.editMode));
        }
        const banner = document.getElementById('edit-banner');
        if (banner) banner.hidden = !this.editMode;
        if (this.view === 'explorer') this._updateExplorerUI();
    }

    /** Add the moves on the board (from the start) to the repertoire. */
    _addCurrentLine() {
        if (!this.currentTree || this.explorerMoveStack.length === 0) return;
        const path = this.explorerMoveStack.map(m => m.san);
        const existed = !!this.currentTree.getNodeAt(path);
        this.currentNode = this.currentTree.addLine(path);
        this.currentTree.rebuildPositionIndex();
        this._repertoireChanged();
        this._updateExplorerUI();
        if (!existed) Dialogs.toast('Line added to the repertoire.', 'success');
    }

    _trainFromHere(path = null) {
        if (!this.currentTree) return;
        const from = path || this.explorerMoveStack.map(m => m.san);
        const node = this.currentTree.getNodeAt(from);
        if (!node) {
            Dialogs.toast('This position is not in your repertoire.', 'warning');
            return;
        }
        this._showView('trainer');
        this._startTraining({ startFromMoves: from.length ? from : null, mode: 'all', lineLimit: 100 });
    }

    _updateExplorerUI() {
        if (!this.currentTree) return;
        this._renderMoveList('explorer-moves', this.explorerMoveStack.map(m => m.san), this.explorerMoveStack.length, this.chess);
        this._updateECO('explorer-opening');
        this._renderContinuations();
        this._updateTranspositionInfo();
        this._renderNotes();
        this._updateExplorerStats();
        this._markTreeActive();
        this._updateArrows();
        this._requestEngineEval();
        this._updateNavButtons();
    }

    _updateNavButtons() {
        const atStart = this.explorerMoveStack.length === 0;
        const node = this._explorerNodeAtBoard();
        const canForward = this.explorerForwardStack.length > 0 || !!(node && node.getMainline());
        const set = (id, disabled) => { const b = document.getElementById(id); if (b) b.disabled = disabled; };
        set('btn-explorer-start', atStart);
        set('btn-explorer-back', atStart);
        set('btn-explorer-forward', !canForward);
        set('btn-explorer-end', !canForward);
        set('btn-train-here', !this.currentNode || this.currentNode.isLeaf() && this.currentNode === this.currentTree.root);
    }

    _isPlayerTurn() {
        if (!this.currentTree) return false;
        return (this.chess.turn() === 'w') === (this.currentTree.color === 'white');
    }

    _renderContinuations() {
        const list = document.getElementById('explorer-children');
        const label = document.getElementById('explorer-children-label');
        if (!list) return;
        const node = this.currentNode;

        if (!node) {
            if (label) label.textContent = 'Off-book';
            list.innerHTML = this._offBookHtml();
            return;
        }

        const yourTurn = this._isPlayerTurn();
        if (label) label.textContent = yourTurn ? 'Your move in this repertoire' : 'Opponent replies you have prepared';

        const children = [...node.children.values()].sort((a, b) => a.priority - b.priority);
        if (children.length === 0) {
            list.innerHTML = `<div class="no-moves">${node === this.currentTree.root ? 'This repertoire is empty.' : 'End of this line.'}
                ${this.editMode ? 'Play a move on the board to extend it.' : 'Turn on <strong>Edit mode</strong> to extend it.'}</div>`;
            return;
        }

        const ply = this.explorerMoveStack.length;
        list.innerHTML = children.map(child => {
            const nag = child.nags.map(n => PGNParser.NAG_REVERSE[n] || '').join('');
            const acc = MoveTree.getNodeAccuracy(child);
            const accChip = acc !== null && child.moveStats.attempts > 0
                ? `<span class="acc-chip ${acc >= 80 ? 'good' : acc >= 60 ? 'ok' : 'bad'}" title="Found ${child.moveStats.correct} of ${child.moveStats.attempts} times in training">${acc}%</span>`
                : '';
            const main = child.priority === 0 && children.length > 1 ? '<span class="main-badge">main</span>' : '';
            const disabled = !child.enabled ? '<span class="off-badge" title="Disabled for training">off</span>' : '';
            const comment = child.comment ? `<span class="move-comment">${this._escapeHtml(child.comment)}</span>` : '';
            const trans = child.isTransposition ? '<span class="transposition-badge" title="This position is also reached by another move order">TRANS</span>' : '';
            return `<div class="explorer-child${child.enabled ? '' : ' is-disabled'}" data-move="${this._escapeHtml(child.move)}" role="button" tabindex="0">
                <span class="move-san">${this._formatPly(ply, this._figHtml(child.move), true)}<span class="nag">${nag}</span></span>
                ${main}${disabled}${accChip}${comment}${trans}
            </div>`;
        }).join('');
    }

    _offBookHtml() {
        const path = this.explorerMoveStack.map(m => m.san);
        // Deepest position of the line that is still in the repertoire
        let inBook = 0;
        let node = this.currentTree.root;
        for (const san of path) {
            const next = node.getChild(san);
            if (!next) break;
            node = next;
            inBook++;
        }
        const leftAt = path[inBook] ? this._formatPly(inBook, path[inBook]) : '';
        const rejoin = (this.currentTree.positionIndex.get(MoveTree.positionFen(this.chess)) || [])[0];

        return `<div class="offbook">
            <div>You left the repertoire${leftAt ? ` with <strong>${this._escapeHtml(leftAt)}</strong>` : ''}.</div>
            ${rejoin ? `<div class="offbook-trans">&#8644; This position is in your repertoire via another move order: <span class="mono">${this._escapeHtml(this._formatPath(rejoin.getPath()))}</span></div>` : ''}
            <div class="offbook-actions">
                <button class="btn btn-sm btn-primary" data-action="add-line">+ Add these moves to the repertoire</button>
                ${rejoin ? `<button class="btn btn-sm" data-action="rejoin" data-path="${this._escapeHtml(rejoin.getPath().join(','))}">Jump there</button>` : ''}
            </div>
        </div>`;
    }

    _updateExplorerStats() {
        const el = document.getElementById('explorer-stats');
        if (!el || !this.currentTree) return;
        const s = this.currentTree.getStatsOverview();
        el.innerHTML = this._statsHtml(s);
    }

    _statsHtml(s) {
        return `
            <div class="stat" title="Trainable lines"><span class="stat-value">${s.totalLines}</span><span class="stat-label">Lines</span></div>
            <div class="stat" title="Lines you have not learned yet"><span class="stat-value">${s.newLines}</span><span class="stat-label">New</span></div>
            <div class="stat${s.due > 0 ? ' stat-due' : ''}" title="Lines due for review"><span class="stat-value">${s.due}</span><span class="stat-label">Due</span></div>
            <div class="stat" title="How often you find your moves in training"><span class="stat-value">${s.accuracy === null ? '—' : s.accuracy + '%'}</span><span class="stat-label">Accuracy</span></div>`;
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
            <div class="trans-title">&#8644; Transposition — ${transpositions.length + 1} move orders reach this position</div>`;
        for (const other of transpositions.slice(0, 5)) {
            const path = other.getPath();
            html += `<div class="trans-path" data-path="${this._escapeHtml(path.join(','))}" role="button" tabindex="0">${this._escapeHtml(this._formatPath(path))}</div>`;
        }
        if (transpositions.length > 5) {
            html += `<div class="trans-path">…and ${transpositions.length - 5} more</div>`;
        }
        html += '</div>';
        el.innerHTML = html;
    }

    // ----- Notes & move-quality glyphs -----

    _renderNagButtons() {
        const el = document.getElementById('nag-buttons');
        if (!el) return;
        const titles = { 1: 'Good move', 2: 'Mistake', 3: 'Brilliant move', 4: 'Blunder', 5: 'Interesting move', 6: 'Dubious move' };
        el.innerHTML = MOVE_QUALITY_NAGS.map(n =>
            `<button type="button" class="nag-btn" data-nag="${n}" title="${titles[n]}">${PGNParser.NAG_REVERSE[n]}</button>`).join('');
    }

    _renderNotes() {
        const section = document.getElementById('notes-section');
        if (!section) return;
        const node = this.currentNode;
        if (!node || !this.currentTree || node === this.currentTree.root) {
            section.hidden = true;
            this._noteNode = null;
            return;
        }
        section.hidden = false;
        const ply = this.explorerMoveStack.length - 1;
        document.getElementById('notes-move').textContent = this._formatPly(ply, node.move);
        document.querySelectorAll('#nag-buttons .nag-btn').forEach(btn => {
            btn.classList.toggle('active', node.nags.includes(Number(btn.dataset.nag)));
        });
        const text = document.getElementById('note-text');
        if (this._noteNode !== node || document.activeElement !== text) {
            text.value = node.comment || '';
        }
        this._noteNode = node;
        const status = document.getElementById('note-status');
        if (status && !this._noteTimer) status.textContent = '';
    }

    _onNoteInput() {
        const status = document.getElementById('note-status');
        if (status) status.textContent = 'Editing…';
        clearTimeout(this._noteTimer);
        this._noteTimer = setTimeout(() => this._flushNote(), 600);
    }

    /** Write a pending note edit to its node and persist it. */
    _flushNote() {
        if (!this._noteTimer) return;
        clearTimeout(this._noteTimer);
        this._noteTimer = null;
        const node = this._noteNode;
        const text = document.getElementById('note-text');
        if (!node || !text) return;
        const value = text.value.trim();
        if (value === (node.comment || '')) return;
        node.comment = value;
        this._repertoireChanged();
        const status = document.getElementById('note-status');
        if (status) status.textContent = 'Saved ✓';
        this._renderContinuationsSoon();
    }

    _renderContinuationsSoon() {
        if (this.view === 'explorer') setTimeout(() => this._renderContinuations(), 0);
    }

    _toggleNag(nag) {
        const node = this._noteNode;
        if (!node) return;
        const had = node.nags.includes(nag);
        node.nags = node.nags.filter(n => !MOVE_QUALITY_NAGS.includes(n));
        if (!had) node.nags.push(nag);
        this._repertoireChanged();
        this._renderNotes();
        this._renderContinuations();
    }

    // ===================== ECO OPENING NAMES =====================

    _updateECO(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const eco = this._findOpening();
        el.innerHTML = eco
            ? `<span class="eco-code">${this._escapeHtml(eco.code)}</span>${this._escapeHtml(eco.name)}`
            : '';
    }

    /** Opening name of the current position, or of the latest named position on the way here. */
    _findOpening() {
        const named = (eco) => eco && eco.name && eco.code ? eco : null; // skip "Starting Position"
        const direct = named(lookupECO(this.chess.fen()));
        if (direct) return direct;
        // Replaying the history only makes sense for games from the initial position.
        if (this.view === 'sandbox' && this.sandboxStartFen) return null;
        const probe = new Chess();
        let best = null;
        for (const san of this.chess.history()) {
            if (!probe.move(san)) return best;
            best = named(lookupECO(probe.fen())) || best;
        }
        return best;
    }

    // ===================== ENGINE =====================

    _engineActiveInView() {
        return this.view === 'explorer' || this.view === 'sandbox';
    }

    /** Turn the engine on automatically when a board view opens, if the user left it on. */
    _ensureEngineForView() {
        if (this._engineActiveInView() && this.prefs.engineOn && !this.engineEnabled && this.engineStatus !== 'error') {
            this._setEngineEnabled(true);
        } else {
            this._renderEngine();
            this._requestEngineEval();
        }
    }

    async _setEngineEnabled(on) {
        const toggle = document.getElementById('engine-toggle');
        this.engineEnabled = !!on;
        this._savePref('engineOn', this.engineEnabled);
        if (toggle) toggle.checked = this.engineEnabled;

        if (!this.engineEnabled) {
            this._stopEngine();
            this.engineSnapshot = null;
            if (this.engineStatus !== 'error') this.engineStatus = 'off';
            this._renderEngine();
            this._updateArrows();
            this._resizeBoardSoon();
            return;
        }

        if (!this.engine) this.engine = new ChessEngine();
        this._resizeBoardSoon();
        if (!this.engine.ready) {
            this.engineStatus = 'loading';
            this._renderEngine();
            try {
                await this.engine.init();
            } catch (e) {
                console.error('Engine init failed:', e);
                this.engineStatus = 'error';
                this.engineError = e.message || String(e);
                this.engineEnabled = false;
                if (toggle) toggle.checked = false;
                this._renderEngine();
                this._resizeBoardSoon();
                return;
            }
        }
        if (!this.engineEnabled) return; // switched off while loading
        this.engineStatus = 'ready';
        this._renderEngine();
        this._requestEngineEval();
    }

    _requestEngineEval() {
        if (!this.engineEnabled || !this.engine || !this.engine.ready || !this._engineActiveInView()) return;
        const fen = this.chess.fen();
        // Already analysing (or analysed) this exact position: don't restart it.
        if (this._engineFen === fen) return;
        if (this.engineSnapshot && this.engineSnapshot.fen !== fen) {
            this.engineSnapshot = null;
            this._renderEngine();
        }
        clearTimeout(this._engineTimer);
        this._engineTimer = setTimeout(async () => {
            if (this.chess.fen() !== fen || !this.engineEnabled) return;
            this._engineFen = fen;
            this.engine.onInfo = (snap) => {
                if (snap.fen !== this.chess.fen()) return;
                this.engineSnapshot = snap;
                this._scheduleEngineRender();
            };
            let result = null;
            try {
                result = await this.engine.evaluate(fen, this.engineDepth, { multiPV: this.engineLines });
            } catch (e) {
                console.error('Engine evaluation failed:', e);
            }
            if (!result) {
                // Superseded or stopped: allow this position to be requested again.
                if (this._engineFen === fen) this._engineFen = null;
                return;
            }
            if (result.fen !== this.chess.fen() || !this.engineEnabled) return;
            this.engineSnapshot = result;
            this._scheduleEngineRender();
        }, 120);
    }

    _stopEngine() {
        clearTimeout(this._engineTimer);
        this._engineFen = null;
        if (this.engine) this.engine.stop();
    }

    _scheduleEngineRender() {
        if (this._engineRenderQueued) return;
        this._engineRenderQueued = true;
        const run = () => {
            this._engineRenderQueued = false;
            this._renderEngine();
            this._updateArrows();
        };
        if (window.requestAnimationFrame) requestAnimationFrame(run);
        else setTimeout(run, 16);
    }

    _renderEngine() {
        const nameEl = document.getElementById('engine-name-label');
        const depthEl = document.getElementById('engine-depth');
        const scoreEl = document.getElementById('engine-score');
        const linesEl = document.getElementById('engine-lines');
        if (!linesEl) return;
        const toggle = document.getElementById('engine-toggle');
        if (toggle) toggle.checked = this.engineEnabled;

        const name = (this.engine && this.engine.name) || 'Stockfish 18';
        nameEl.textContent = this.engineStatus === 'loading' ? 'Loading Stockfish…' : name;
        depthEl.textContent = '';
        scoreEl.textContent = '';
        scoreEl.className = 'engine-score';

        if (this.engineStatus === 'error' && !this.engineEnabled) {
            linesEl.innerHTML = `<div class="engine-msg error">The engine could not start: ${this._escapeHtml(this.engineError)}
                <button class="btn btn-sm" data-action="engine-retry">Try again</button></div>`;
        } else if (!this.engineEnabled) {
            linesEl.innerHTML = '<div class="engine-msg">Turn on to see Stockfish\'s evaluation and best lines <kbd>E</kbd></div>';
        } else if (this.engineStatus === 'loading') {
            linesEl.innerHTML = '<div class="engine-msg"><span class="spinner"></span> Starting the engine…</div>';
        } else {
            const snap = this.engineSnapshot && this.engineSnapshot.fen === this.chess.fen() ? this.engineSnapshot : null;
            if (!snap) {
                linesEl.innerHTML = '<div class="engine-msg"><span class="spinner"></span> Analysing…</div>';
            } else if (snap.terminal) {
                scoreEl.textContent = ChessEngine.formatScore(snap);
                linesEl.innerHTML = `<div class="engine-msg">${snap.terminal === 'checkmate' ? 'Checkmate.' : 'Stalemate.'}</div>`;
            } else {
                scoreEl.textContent = ChessEngine.formatScore(snap);
                scoreEl.classList.add(snap.score >= 0 && (snap.mate === null || snap.mate > 0) ? 'white-better' : 'black-better');
                depthEl.textContent = `depth ${snap.depth}`;
                const lines = snap.lines && snap.lines.length ? snap.lines : [snap];
                linesEl.innerHTML = lines.map(l => {
                    const sans = ChessEngine.pvToSan(snap.fen, l.pv, 10);
                    if (!sans.length) return '';
                    const text = this._formatSanSequence(snap.fen, sans);
                    return `<div class="engine-line" data-uci="${this._escapeHtml(l.pv[0])}" role="button" tabindex="0" title="Play ${this._escapeHtml(sans[0])}">
                        <span class="line-eval">${ChessEngine.formatScore(l)}</span>
                        <span class="line-moves">${text}</span>
                    </div>`;
                }).join('');
            }
        }
        this._renderEvalGauge();
    }

    _renderEvalGauge() {
        const gauge = document.getElementById('eval-gauge');
        if (!gauge) return;
        const show = this.engineEnabled && this._engineActiveInView();
        if (gauge.hidden === show) {
            gauge.hidden = !show;
            this._resizeBoardSoon();
        }
        if (!show) return;
        const snap = this.engineSnapshot && this.engineSnapshot.fen === this.chess.fen() ? this.engineSnapshot : null;
        const pct = snap ? ChessEngine.getBarPercent(snap) : 50;
        const fill = document.getElementById('eval-gauge-fill');
        const label = document.getElementById('eval-gauge-label');
        gauge.classList.toggle('flipped', this.boardOrientation === 'black');
        if (fill) fill.style.height = pct + '%';
        if (label) {
            label.textContent = snap ? ChessEngine.formatScore(snap).replace(/^\+/, '') : '';
            label.classList.toggle('on-white', pct >= 50);
        }
    }

    // ===================== TREE VIEW =====================

    _renderTreeView() {
        const container = document.getElementById('explorer-tree-view');
        if (!container || !this.currentTree) return;

        const html = this._renderTreeBranch(this.currentTree.root, 0, 8);
        container.innerHTML = html || '<div class="tree-more">Empty repertoire — turn on Edit mode and play moves to build it.</div>';
        this._markTreeActive();
    }

    _renderTreeBranch(node, depth, maxDepth) {
        let html = '';
        const children = [...node.children.entries()].sort((a, b) => a[1].priority - b[1].priority);

        children.forEach(([san, child], idx) => {
            const hasChildren = child.hasChildren();
            const isCollapsed = child.collapsed;
            const colorClass = this._getTreeNodeClass(child, depth + 1);
            const indent = depth * 14 + 4;
            const nagStr = child.nags.map(n => PGNParser.NAG_REVERSE[n] || '').join('');
            const moveNum = Math.floor(depth / 2) + 1;
            const isWhite = depth % 2 === 0;
            const moveNumStr = isWhite
                ? `<span class="tree-movenum">${moveNum}.</span>`
                : (idx > 0 || node.children.size > 1 ? `<span class="tree-movenum">${moveNum}…</span>` : '');
            const pathAttr = this._escapeHtml(child.getPath().join(','));

            const chevron = hasChildren
                ? `<span class="tree-chevron" data-path="${pathAttr}">${isCollapsed ? '&#9654;' : '&#9660;'}</span>`
                : '<span class="tree-chevron"></span>';

            const acc = child.moveStats.attempts > 0 ? MoveTree.getNodeAccuracy(child) : null;
            const accBadge = acc !== null ? `<span class="tree-accuracy">${acc}%</span>` : '';
            const note = child.comment ? '<span class="tree-note" title="Has notes">&#9998;</span>' : '';

            const toggleIcon = child.enabled ? '&#9679;' : '&#9675;';
            html += `<div class="tree-node ${colorClass}" style="padding-left:${indent}px" data-path="${pathAttr}">
                ${chevron}
                <span class="tree-move">${moveNumStr}${this._figHtml(san)}</span>
                ${nagStr ? `<span class="tree-nag">${nagStr}</span>` : ''}
                ${note}
                ${accBadge}
                <button class="tree-toggle-btn${child.enabled ? '' : ' disabled'}" data-path="${pathAttr}" title="${child.enabled ? 'Included in training — click to disable' : 'Disabled for training — click to enable'}" aria-label="${child.enabled ? 'Disable' : 'Enable'} line">${toggleIcon}</button>
            </div>`;

            if (hasChildren && !isCollapsed && depth < maxDepth) {
                html += this._renderTreeBranch(child, depth + 1, maxDepth);
            } else if (hasChildren && !isCollapsed && depth >= maxDepth) {
                html += `<div class="tree-more" style="padding-left:${(depth + 1) * 14 + 4}px" data-expand-path="${pathAttr}">… more</div>`;
            }
        });
        return html;
    }

    /** Colour a tree node by how reliably the player finds it (player moves only). */
    _getTreeNodeClass(node, depth) {
        if (!node.enabled) return 'tree-disabled';
        const isPlayerMove = (this.currentTree.color === 'white') === (depth % 2 === 1);
        if (!isPlayerMove) return 'tree-opponent';
        const ms = node.moveStats;
        if (!ms || ms.attempts === 0) return 'tree-new';
        const acc = ms.correct / ms.attempts * 100;
        if (ms.streak >= 3 && acc >= 75) return 'tree-mastered';
        if (acc < 60) return 'tree-struggling';
        return 'tree-learning';
    }

    _markTreeActive() {
        const container = document.getElementById('explorer-tree-view');
        if (!container) return;
        container.querySelectorAll('.tree-active').forEach(el => el.classList.remove('tree-active'));
        if (!this.currentNode || !this.currentTree || this.currentNode === this.currentTree.root) return;
        const key = this.currentNode.getPath().join(',');
        const el = [...container.querySelectorAll('.tree-node')].find(n => n.dataset.path === key);
        if (el) {
            el.classList.add('tree-active');
            // Scroll only the tree box (scrollIntoView would also scroll the page).
            const box = container.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            if (box.height > 0 && (r.top < box.top || r.bottom > box.bottom)) {
                container.scrollTop += r.top - box.top - box.height / 2;
            }
        }
    }

    _bindTreeEvents() {
        // Event delegation: bound once, survives re-renders.
        const container = document.getElementById('explorer-tree-view');
        if (!container) return;
        const pathOf = (el, attr = 'path') => (el.dataset[attr] || '').split(',').filter(Boolean);

        container.addEventListener('click', (e) => {
            if (!this.currentTree) return;
            const chevron = e.target.closest('.tree-chevron[data-path]');
            const toggle = e.target.closest('.tree-toggle-btn');
            const more = e.target.closest('.tree-more[data-expand-path]');
            const nodeEl = e.target.closest('.tree-node');
            if (chevron) {
                const node = this.currentTree.getNodeAt(pathOf(chevron));
                if (node) {
                    node.collapsed = !node.collapsed;
                    this._renderTreeView();
                }
            } else if (toggle) {
                const node = this.currentTree.getNodeAt(pathOf(toggle));
                if (node) {
                    this.currentTree.toggleEnabled(node);
                    this._repertoireChanged();
                    this._updateExplorerUI();
                }
            } else if (more) {
                const node = this.currentTree.getNodeAt(pathOf(more, 'expandPath'));
                if (node) {
                    node.collapsed = false;
                    this._renderTreeView();
                }
            } else if (nodeEl) {
                this._navigateToPath(pathOf(nodeEl));
            }
        });

        container.addEventListener('contextmenu', (e) => {
            const nodeEl = e.target.closest('.tree-node');
            if (!nodeEl || !this.currentTree) return;
            e.preventDefault();
            const node = this.currentTree.getNodeAt(pathOf(nodeEl));
            if (node) this._showContextMenu(e.clientX, e.clientY, node);
        });
    }

    // ===================== CONTEXT MENU =====================

    _showContextMenu(x, y, node) {
        this._hideContextMenu();
        this._contextMenuNode = node;

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.id = 'context-menu';
        menu.setAttribute('role', 'menu');
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        menu.innerHTML = `
            <div class="context-menu-item" role="menuitem" data-action="goto">&#9654; Go to position</div>
            <div class="context-menu-item" role="menuitem" data-action="train">&#127919; Train from here</div>
            <div class="context-menu-sep"></div>
            <div class="context-menu-item" role="menuitem" data-action="toggle-enable">${node.enabled ? '&#9675; Disable for training' : '&#9679; Enable for training'}</div>
            <div class="context-menu-item" role="menuitem" data-action="set-mainline">&#9733; Set as mainline</div>
            <div class="context-menu-sep"></div>
            <div class="context-menu-item danger" role="menuitem" data-action="delete">&#128465; Delete branch…</div>
        `;

        document.body.appendChild(menu);

        // Keep it on screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = Math.max(4, x - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = Math.max(4, y - rect.height) + 'px';

        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item) return;
            this._hideContextMenu();
            this._handleContextAction(item.dataset.action);
        });

        setTimeout(() => {
            document.addEventListener('click', () => this._hideContextMenu(), { once: true });
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
            case 'goto':
                this._navigateToPath(node.getPath());
                return;
            case 'train':
                this._trainFromHere(node.getPath());
                return;
            case 'toggle-enable':
                this.currentTree.toggleEnabled(node);
                break;
            case 'set-mainline':
                this.currentTree.setMainline(node);
                break;
            case 'delete':
                this._confirmDeleteNode(node);
                return;
        }

        this._repertoireChanged();
        this._updateExplorerUI();
    }

    async _confirmDeleteNode(node) {
        if (!this.currentTree || !node || !node.parent) return;
        const path = node.getPath();
        let lines = 0;
        this.currentTree._traverse(node, x => { if (x.isLeaf()) lines++; });
        const ok = await Dialogs.confirm(
            `Delete ${this._formatPath(path)} and everything after it?\n(${lines} line${lines === 1 ? '' : 's'} will be removed.)`,
            { title: 'Delete branch', okText: 'Delete', danger: true });
        if (!ok || !this.currentTree) return;

        // If the board is inside the deleted branch, step back to its parent.
        const boardPath = this.explorerMoveStack.map(m => m.san);
        const inside = path.every((san, i) => boardPath[i] === san);
        this.currentTree.deleteSubtree(node);
        this._repertoireChanged();
        if (inside) this._navigateToPath(path.slice(0, -1));
        else this._updateExplorerUI();
        Dialogs.toast('Branch deleted.', 'success');
    }

    // ===================== SANDBOX =====================

    _enterSandbox() {
        this._saveCurrentRepertoire();
        this._cancelTrainerTimers();
        this.currentRepertoireId = null;
        this.currentTree = null;
        this.currentNode = null;
        this.trainer = null;
        this.chess = this.boardChess;
        this.chess.reset();
        this.sandboxStartFen = null;
        this.sandboxMoveStack = [];
        this.sandboxRedoStack = [];
        this._showView('sandbox');
        this.board.position('start', false);
        this._clearAllSquareEffects();
        this._updateSandboxUI();
        this._ensureEngineForView();
    }

    _onSandboxDrop(source, target, promotion) {
        const moveObj = { from: source, to: target };
        if (promotion) moveObj.promotion = promotion;

        const move = this.chess.move(moveObj);
        if (!move) return 'snapback';
        this._sandboxApplyMove(move);
    }

    _sandboxApplyMove(move, fromRedo = false) {
        this.sandboxMoveStack.push(move);
        if (!fromRedo) this.sandboxRedoStack = [];
        this._playMoveSound(move);
        this._highlightMove(move, 'last');
        this._updateSandboxUI();
    }

    _sandboxUndo() {
        if (this.sandboxMoveStack.length === 0) return false;
        const move = this.chess.undo();
        if (!move) return false;
        this.sandboxRedoStack.push(this.sandboxMoveStack.pop());
        this.board.position(this.chess.fen());
        const last = this.sandboxMoveStack[this.sandboxMoveStack.length - 1];
        this._highlightMove(last || null, 'last');
        this.sounds.playMove();
        this._updateSandboxUI();
        return true;
    }

    _sandboxRedo() {
        if (this.sandboxRedoStack.length === 0) return false;
        const move = this.sandboxRedoStack.pop();
        const done = this.chess.move({ from: move.from, to: move.to, promotion: move.promotion });
        if (!done) {
            this.sandboxRedoStack = [];
            return false;
        }
        this.board.position(this.chess.fen());
        this._sandboxApplyMove(done, true);
        return true;
    }

    _sandboxGoToPly(ply) {
        while (this.sandboxMoveStack.length > ply && this.chess.undo()) {
            this.sandboxRedoStack.push(this.sandboxMoveStack.pop());
        }
        while (this.sandboxMoveStack.length < ply && this.sandboxRedoStack.length) {
            const m = this.sandboxRedoStack.pop();
            const done = this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
            if (!done) break;
            this.sandboxMoveStack.push(done);
        }
        this.board.position(this.chess.fen(), false);
        const last = this.sandboxMoveStack[this.sandboxMoveStack.length - 1];
        this._highlightMove(last || null, 'last');
        this._updateSandboxUI();
    }

    _sandboxReset() {
        this.chess.reset();
        this.sandboxStartFen = null;
        this.sandboxMoveStack = [];
        this.sandboxRedoStack = [];
        this.board.position('start');
        this._clearAllSquareEffects();
        this._updateSandboxUI();
    }

    _sandboxLoadFen(fen) {
        const tempChess = new Chess();
        const check = tempChess.validate_fen ? tempChess.validate_fen(fen) : { valid: true };
        if (!check.valid || !tempChess.load(fen)) {
            Dialogs.toast('Invalid FEN' + (check.error ? ': ' + check.error : ''), 'error', 4000);
            return;
        }
        this.chess.load(fen);
        this.sandboxStartFen = tempChess.fen() === new Chess().fen() ? null : this.chess.fen();
        this.sandboxMoveStack = [];
        this.sandboxRedoStack = [];
        this.board.position(this.chess.fen());
        this._clearAllSquareEffects();
        this._updateSandboxUI();
        Dialogs.toast('Position loaded.', 'success', 1500);
    }

    _updateSandboxUI() {
        this._updateECO('sandbox-opening');
        this._renderMoveList('sandbox-moves', this.chess.history(), this.sandboxMoveStack.length, this.chess, this.sandboxStartFen);
        const fenInput = document.getElementById('sandbox-fen-input');
        if (fenInput && document.activeElement !== fenInput) fenInput.value = this.chess.fen();
        const set = (id, disabled) => { const b = document.getElementById(id); if (b) b.disabled = disabled; };
        set('btn-sandbox-back', this.sandboxMoveStack.length === 0);
        set('btn-sandbox-forward', this.sandboxRedoStack.length === 0);
        this._updateArrows();
        this._requestEngineEval();
    }

    async _copyText(text, what) {
        try {
            await navigator.clipboard.writeText(text);
            Dialogs.toast(`${what} copied to the clipboard.`, 'success', 1600);
        } catch (e) {
            // Clipboard API unavailable (e.g. insecure context): show it for manual copy.
            Dialogs.show({
                title: `Copy ${what}`,
                bodyHtml: `<textarea class="copy-box" readonly rows="4">${this._escapeHtml(text)}</textarea>`,
                buttons: [{ label: 'Close', value: true, kind: 'primary', submit: true }],
                cancelValue: true,
                onOpen: (modal) => { const t = modal.querySelector('textarea'); t.focus(); t.select(); }
            });
        }
    }

    async _sandboxSaveAsRepertoire() {
        if (this.sandboxMoveStack.length === 0) {
            Dialogs.toast('Play some moves first — there is nothing to save yet.', 'warning');
            return;
        }
        if (this.sandboxStartFen) {
            Dialogs.alert('This line starts from a custom position (loaded FEN). Repertoires always start from the initial position, so it can\'t be saved into one. Use Copy PGN instead.',
                { title: 'Cannot save this line' });
            return;
        }

        const lastColor = this.sandboxMoveStack[this.sandboxMoveStack.length - 1].color;
        const targets = this._repertoireList.map(r => ({ value: r.id, label: `${r.color === 'black' ? '♚' : '♔'} ${r.name}` }));
        const fields = [
            { name: 'name', label: 'New repertoire name', type: 'text', value: '', placeholder: 'e.g. My Sicilian line' },
            { name: 'color', label: 'I play as (new repertoire)', type: 'color', value: lastColor === 'b' ? 'black' : 'white' }
        ];
        if (targets.length > 0) {
            fields.unshift({
                name: 'target', label: 'Save into', type: 'select', value: '__new__',
                options: [{ value: '__new__', label: '+ New repertoire' }, ...targets]
            });
        }
        const result = await Dialogs.form({ title: 'Save line', okText: 'Save', fields });
        if (!result) return;

        try {
            let tree;
            if (result.target && result.target !== '__new__') {
                tree = await this.db.loadRepertoire(result.target);
                if (!tree) throw new Error('Repertoire not found');
            } else {
                if (!result.name) {
                    Dialogs.toast('Please give the new repertoire a name.', 'warning');
                    return;
                }
                tree = new MoveTree(result.name, result.color);
            }
            tree.addLine(this.sandboxMoveStack.map(m => m.san));
            tree.rebuildPositionIndex();
            await this.db.saveRepertoire(tree);
            await this._loadSidebar();
            Dialogs.toast(`Line saved to "${tree.name}".`, 'success');
        } catch (e) {
            console.error('Save failed:', e);
            Dialogs.alert('Save failed: ' + e.message, { title: 'Error' });
        }
    }

    // ===================== TRAINER =====================

    _trainerSettings() {
        const mode = document.getElementById('train-mode')?.value || 'mix';
        const limit = Math.max(1, Math.min(500, parseInt(document.getElementById('train-limit')?.value || '20', 10) || 20));
        const learn = document.getElementById('train-learn')?.checked !== false;
        return { mode, limit, learn };
    }

    _startTraining(options = {}) {
        if (!this.currentTree) return;
        this._cancelTrainerTimers();

        this.trainer = new Trainer(this.currentTree);
        this.chess = this.trainer.chess;
        this.trainerArrow = null;
        this._setOrientation(this.currentTree.color);
        this.board.position('start', false);
        this._clearAllSquareEffects();
        this._setTrainerFeedback('');
        this._showTrainerComment(null);

        const settings = this._trainerSettings();
        const sessionInfo = this.trainer.startSession({
            mode: settings.mode,
            lineLimit: settings.limit,
            learnNewLines: settings.learn,
            ...options
        });

        this._renderTrainerStats();
        if (sessionInfo.state === 'finished') {
            this._showTrainerEmpty(settings.mode);
            this._updateTrainerUI();
            return;
        }

        this._trainerNextLine();
    }

    _showTrainerEmpty(mode) {
        const total = this.currentTree.countLines();
        const overview = this.currentTree.getStatsOverview();
        if (total === 0) {
            this._setTrainerFeedback(`<div class="feedback feedback-info">This repertoire has no moves yet.
                <div class="feedback-actions"><button class="btn btn-sm btn-primary" data-action="open-explorer-edit">Build it in the Explorer</button></div></div>`);
            return;
        }
        let msg = 'Nothing to train in this mode right now.';
        if (mode === 'review' || mode === 'mix') {
            msg = overview.nextDue
                ? `You're all caught up! Next review ${this._relativeTime(overview.nextDue)}.`
                : 'You\'re all caught up!';
        } else if (mode === 'new') {
            msg = 'You have learned every line in this repertoire.';
        }
        this._setTrainerFeedback(`<div class="feedback feedback-success">${msg}
            <div class="feedback-actions">
                <button class="btn btn-sm" data-action="train-all">Drill all lines anyway</button>
                <button class="btn btn-sm btn-secondary" data-action="open-explorer">Explore repertoire</button>
            </div></div>`);
    }

    _trainerNextLine() {
        if (!this.trainer) return;
        this._cancelTrainerTimers();

        const lineInfo = this.trainer.nextLine();
        if (!lineInfo) {
            this._showTrainerComplete();
            return;
        }

        this.chess = this.trainer.chess;
        this.trainerArrow = null;
        this.board.position(this.chess.fen(), false);
        this._clearAllSquareEffects();
        this._setTrainerFeedback('');
        this._showTrainerComment(null);
        this._updateArrows();

        if (this.trainer.isPlayerMove()) this._onPlayerTurn();
        else this._scheduleOpponentMove();
        this._updateTrainerUI();
    }

    _scheduleOpponentMove() {
        clearTimeout(this._opponentTimer);
        this._opponentTimer = setTimeout(() => this._playOpponentMove(), this.autoPlayDelay);
    }

    _cancelTrainerTimers() {
        clearTimeout(this._opponentTimer);
        clearTimeout(this._autoNextTimer);
        this._opponentTimer = null;
        this._autoNextTimer = null;
    }

    _playOpponentMove() {
        if (!this.trainer || this.view !== 'trainer') return;
        const result = this.trainer.playOpponentMove();
        if (!result) return;

        this._playMoveSound(result.move);
        this.board.position(this.chess.fen());
        this._highlightMove(result.move, 'last');
        this._showTrainerComment(this.trainer.currentNode);

        if (result.isLineComplete) {
            this._onTrainerLineComplete();
            return;
        }
        if (this.trainer.isPlayerMove()) this._onPlayerTurn();
        else this._scheduleOpponentMove();
        this._updateTrainerUI();
    }

    /** It's the player's move: in learning mode, reveal it. */
    _onPlayerTurn() {
        const t = this.trainer;
        if (!t) return;
        this._hintSquare = null;
        if (t.isLearning) {
            const exp = t.getExpectedMove();
            if (exp) {
                this.trainerArrow = { from: exp.from, to: exp.to, color: BoardOverlay.COLORS.green, opacity: 0.85 };
                const next = t.currentNode ? t.currentNode.getChild(exp.san) : null;
                this._showTrainerComment(next, true);
            }
        }
        this._updateArrows();
        this._updateTrainerUI();
    }

    _onTrainerDrop(source, target, promotion) {
        if (!this.trainer || !this.trainer.isPlayerMove()) return 'snapback';

        const result = this.trainer.submitMove(source, target, promotion);
        if (!result.valid) return 'snapback';

        if (result.correct) {
            this.trainerArrow = null;
            this._hintSquare = null;
            this.chess.in_check() ? this.sounds.playCheck() : this.sounds.playCorrect();
            this._highlightMove(result.move, 'correct');
            this._setTrainerFeedback('');
            this._showTrainerComment(this.trainer.currentNode);
            this._updateArrows();
            if (result.isLineComplete) {
                this._onTrainerLineComplete();
            } else {
                this._scheduleOpponentMove();
                this._updateTrainerUI();
            }
            return;
        }

        this._flashWrong(source, target);
        if (result.isAlternative) {
            this.sounds.playMove();
            this._setTrainerFeedback(`<div class="feedback feedback-info">
                <strong>${this._escapeHtml(result.played)}</strong> is also in your repertoire, but this line trains a different move here. Try again.
                <div class="feedback-actions">
                    <button class="btn btn-sm" data-action="hint">&#128161; Hint</button>
                    <button class="btn btn-sm btn-secondary" data-action="show-move">&#128065; Show move</button>
                </div></div>`);
            return 'snapback';
        }

        this.sounds.playError();
        if (this.trainer.isLearning) {
            this._setTrainerFeedback('<div class="feedback feedback-info">Play the move shown by the arrow.</div>');
        } else {
            this._setTrainerFeedback(`<div class="feedback feedback-wrong">
                <strong>${this._escapeHtml(result.played)}</strong> is not your repertoire move here.
                <div class="feedback-actions">
                    <button class="btn btn-sm" data-action="hint">&#128161; Hint</button>
                    <button class="btn btn-sm btn-secondary" data-action="show-move">&#128065; Show move</button>
                </div></div>`);
        }
        this._updateTrainerUI();
        return 'snapback';
    }

    _trainerHint() {
        const t = this.trainer;
        if (!t || this.view !== 'trainer' || !t.isPlayerMove()) return;
        const exp = t.getExpectedMove();
        if (!exp) return;
        t.useHint();
        this._hintSquare = exp.from;
        this._squareEl(exp.from)?.classList.add('hint-source');
        this._setTrainerFeedback('<div class="feedback feedback-info">&#128161; Hint: the highlighted piece moves. (Hints count as a miss for scheduling.)</div>');
        this._updateTrainerUI();
    }

    _trainerShowMove() {
        const t = this.trainer;
        if (!t || this.view !== 'trainer' || !t.isPlayerMove()) return;
        const exp = t.getExpectedMove();
        if (!exp) return;
        t.useHint();
        this.trainerArrow = { from: exp.from, to: exp.to, color: BoardOverlay.COLORS.green, opacity: 0.85 };
        this._updateArrows();
        this._setTrainerFeedback(`<div class="feedback feedback-info">The move is <strong>${this._figHtml(exp.san)}</strong> — play it on the board.</div>`);
        this._updateTrainerUI();
    }

    _onTrainerLineComplete() {
        const t = this.trainer;
        if (!t) return;
        this.trainerArrow = null;
        this._hintSquare = null;
        this._updateArrows();
        // Persist after every line so progress is never lost.
        this._saveCurrentRepertoire();
        this._refreshSidebarSoon();

        const last = t.completedLines[t.completedLines.length - 1] || {};
        const nextBtn = '<button class="btn btn-sm btn-primary" data-action="next-line">Next line &#9654;</button>';
        if (last.learned) {
            this.sounds.playSuccess();
            this._setTrainerFeedback(`<div class="feedback feedback-success">&#128216; Line learned! It will come back for a review in about 4 hours.
                <div class="feedback-actions">${nextBtn}</div></div>`);
        } else if (last.correct) {
            this.sounds.playSuccess();
            this._setTrainerFeedback(`<div class="feedback feedback-success">&#10003; Perfect!
                <div class="feedback-actions">${nextBtn}</div></div>`);
            this._autoNextTimer = setTimeout(() => this._trainerNextLine(), 1200);
        } else {
            this.sounds.playMove();
            this._setTrainerFeedback(`<div class="feedback feedback-info">Line complete with ${last.mistakes} miss${last.mistakes === 1 ? '' : 'es'} — it will be repeated at the end of this session.
                <div class="feedback-actions">${nextBtn}</div></div>`);
        }
        this._renderTrainerStats();
        this._updateTrainerUI();
    }

    _showTrainerComplete() {
        this._cancelTrainerTimers();
        this.trainerArrow = null;
        this._updateArrows();
        this._saveCurrentRepertoire();
        this._refreshSidebarSoon();
        const s = this.trainer ? this.trainer.getProgress().stats : null;
        if (!s) return;
        const tested = s.correct + s.wrong;
        const accuracy = tested > 0 ? Math.round(s.correct / tested * 100) + '%' : '—';
        const overview = this.currentTree ? this.currentTree.getStatsOverview() : null;
        const next = overview && overview.due > 0
            ? `${overview.due} line${overview.due === 1 ? ' is' : 's are'} still due.`
            : overview && overview.nextDue ? `Next review ${this._relativeTime(overview.nextDue)}.` : '';

        this._setTrainerFeedback(`
            <div class="session-complete">
                <h3>Session complete!</h3>
                <div class="session-summary">
                    <div class="stat"><span class="stat-value">${s.total}</span><span class="stat-label">Lines</span></div>
                    <div class="stat"><span class="stat-value">${s.learnedLines}</span><span class="stat-label">Learned</span></div>
                    <div class="stat"><span class="stat-value">${s.perfectLines}</span><span class="stat-label">Perfect</span></div>
                    <div class="stat"><span class="stat-value">${accuracy}</span><span class="stat-label">Accuracy</span></div>
                </div>
                ${next ? `<p class="text-muted session-next">${next}</p>` : ''}
                <button id="btn-train-again" class="btn btn-primary" data-action="train-again">Train again</button>
                <button id="btn-back-home" class="btn btn-secondary" data-action="open-explorer">Explore repertoire</button>
            </div>`);
        this._renderTrainerStats();
        this._updateTrainerUI();
    }

    _setTrainerFeedback(html) {
        const el = document.getElementById('trainer-feedback');
        if (el) el.innerHTML = html;
    }

    /** Show the annotation of a node while training (learning: the move to play). */
    _showTrainerComment(node, upcoming = false) {
        const el = document.getElementById('trainer-comment');
        if (!el) return;
        if (!node || !node.comment) {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        el.hidden = false;
        el.innerHTML = `<span class="comment-label">${upcoming ? 'About this move' : this._escapeHtml(this._formatPly(node.getDepth() - 1, node.move))}</span>${this._escapeHtml(node.comment)}`;
    }

    _updateTrainerUI() {
        const t = this.trainer;
        this._renderMoveList('trainer-moves', this.chess.history(), this.chess.history().length, this.chess, null, false);

        const progressEl = document.getElementById('trainer-progress');
        if (progressEl && t) {
            const p = t.getProgress();
            progressEl.innerHTML = `
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${p.percent}%"></div>
                </div>
                <div class="progress-text">Line ${Math.min(p.completed + (t.lineCompleted ? 0 : 1), p.total)} of ${p.total}
                    <span class="sep">·</span> found ${p.stats.correct} <span class="sep">·</span> missed ${p.stats.wrong}</div>`;
        }

        const prompt = document.getElementById('trainer-prompt');
        if (prompt) {
            if (!t || !t.currentLine) {
                prompt.innerHTML = '';
            } else {
                const eco = this._findOpening();
                const pos = t.getLinePosition();
                const colorName = this.currentTree.color === 'white' ? 'White' : 'Black';
                let main, cls;
                if (t.lineCompleted) {
                    main = 'Line complete';
                    cls = 'done';
                } else if (t.isPlayerMove()) {
                    main = t.isLearning ? '&#128216; New line — play the arrowed move' : `Your move as ${colorName}`;
                    cls = t.isLearning ? 'learn' : 'your-move';
                } else {
                    main = 'Opponent is moving…';
                    cls = 'waiting';
                }
                const sub = [eco ? `${this._escapeHtml(eco.name)}` : '', pos.total ? `move ${Math.min(pos.done + (t.lineCompleted ? 0 : 1), pos.total)} of ${pos.total}` : '']
                    .filter(Boolean).join(' · ');
                prompt.className = 'trainer-prompt ' + cls;
                prompt.innerHTML = `<div class="prompt-main">${main}</div>${sub ? `<div class="prompt-sub">${sub}</div>` : ''}`;
            }
        }

        const set = (id, disabled) => { const b = document.getElementById(id); if (b) b.disabled = disabled; };
        const canAct = !!t && t.state === 'playing' && t.isPlayerMove() && !t.isLearning;
        set('btn-hint', !canAct);
        set('btn-show-move', !canAct);
        set('btn-trainer-skip', !t || !t.currentLine || t.state === 'finished');
    }

    _renderTrainerStats() {
        const el = document.getElementById('trainer-stats');
        if (el && this.currentTree) el.innerHTML = this._statsHtml(this.currentTree.getStatsOverview());
    }

    _trainerSkip() {
        if (!this.trainer || !this.trainer.currentLine) return;
        this.trainer.skipLine();
        // skipLine already advanced the queue; render what it produced
        if (!this.trainer.currentLine) {
            this._showTrainerComplete();
            return;
        }
        this._cancelTrainerTimers();
        this.chess = this.trainer.chess;
        this.trainerArrow = null;
        this.board.position(this.chess.fen(), false);
        this._clearAllSquareEffects();
        this._setTrainerFeedback('');
        this._showTrainerComment(null);
        if (this.trainer.isPlayerMove()) this._onPlayerTurn();
        else this._scheduleOpponentMove();
        this._updateArrows();
        this._updateTrainerUI();
    }

    // ===================== VIEWS =====================

    _showView(viewName) {
        const prev = this.view;
        this.view = viewName;
        if (prev === 'trainer' && viewName !== 'trainer') this._cancelTrainerTimers();
        if (prev !== viewName) this._stopEngine();
        this._hideContextMenu();
        this._clearSelection();

        document.querySelectorAll('.view-panel').forEach(v => {
            v.classList.remove('active');
            v.style.display = 'none';
        });

        const workspace = document.getElementById('workspace');
        const isBoardView = viewName === 'explorer' || viewName === 'trainer' || viewName === 'sandbox';

        if (isBoardView) {
            workspace.style.display = 'flex';
            workspace.classList.add('active');

            const show = (id, on, display = 'block') => {
                const el = document.getElementById(id);
                if (el) el.style.display = on ? display : 'none';
            };
            show('explorer-panel', viewName === 'explorer');
            show('trainer-panel', viewName === 'trainer');
            show('sandbox-panel', viewName === 'sandbox');
            show('engine-panel', viewName === 'explorer' || viewName === 'sandbox');
            show('explorer-controls', viewName === 'explorer', 'flex');
            show('trainer-controls', viewName === 'trainer', 'flex');
            show('sandbox-controls', viewName === 'sandbox', 'flex');

            const tabTrain = document.getElementById('tab-train');
            const tabExplore = document.getElementById('tab-explore');
            const tabSandbox = document.getElementById('tab-sandbox');
            const sandbox = viewName === 'sandbox';
            tabTrain.style.display = sandbox ? 'none' : '';
            tabExplore.style.display = sandbox ? 'none' : '';
            tabSandbox.style.display = sandbox ? '' : 'none';
            tabSandbox.classList.toggle('active', sandbox);
            tabTrain.classList.toggle('active', viewName === 'trainer');
            tabExplore.classList.toggle('active', viewName === 'explorer');

            const title = document.getElementById('workspace-title');
            if (title) {
                if (sandbox) title.textContent = '';
                else if (this.currentTree) {
                    title.innerHTML = `<span class="ws-color ${this.currentTree.color}">${this.currentTree.color === 'white' ? '&#9812;' : '&#9818;'}</span>${this._escapeHtml(this.currentTree.name)}`;
                }
            }

            if (viewName !== 'trainer') this.trainerArrow = null;
            this._renderEngine();
            setTimeout(() => {
                this._resizeBoard();
                this._updateArrows();
            }, 30);
        } else {
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

    async _goHome() {
        this._flushNote();
        await this._saveCurrentRepertoire();
        this._showView('welcome');
        await this._loadSidebar();
        await this._renderWelcome();
    }

    // ===================== WELCOME / DASHBOARD =====================

    async _renderWelcome() {
        const el = document.getElementById('welcome-content');
        if (!el) return;
        const list = this._repertoireList || [];

        if (list.length === 0) {
            el.innerHTML = `
                <div class="welcome-hero">
                    <div class="welcome-icon">&#9822;</div>
                    <h2>Build your opening repertoire — and make it stick</h2>
                    <p>Import your lines (or build them move by move), then train with spaced repetition:
                        new lines are shown to you first, and you are quizzed again just before you would forget them.</p>
                    <div class="welcome-actions">
                        <button class="btn btn-primary" data-action="import">Import a PGN</button>
                        <button class="btn" data-action="samples">Try the sample repertoires</button>
                        <button class="btn" data-action="new">Start an empty repertoire</button>
                        <button class="btn" data-action="sandbox">Open the sandbox board</button>
                    </div>
                    <ol class="how-it-works">
                        <li><strong>Add lines</strong> — import a PGN or use Edit mode in the Explorer.</li>
                        <li><strong>Learn</strong> — new lines are played out with arrows; you repeat them.</li>
                        <li><strong>Review</strong> — come back when lines are due; misses are repeated until they stick.</li>
                    </ol>
                </div>`;
        } else {
            const totalDue = list.reduce((n, r) => n + (r.summary ? r.summary.due : 0), 0);
            const totalNew = list.reduce((n, r) => n + (r.summary ? r.summary.newLines : 0), 0);
            const headline = totalDue > 0
                ? `<strong class="due-text">${totalDue}</strong> line${totalDue === 1 ? '' : 's'} due for review.`
                : totalNew > 0 ? `Nothing due — ${totalNew} new line${totalNew === 1 ? '' : 's'} waiting to be learned.`
                : 'Nothing due right now — great job.';
            const cards = list.map(r => {
                const s = r.summary || { lines: 0, due: 0, newLines: 0, learned: 0, accuracy: null, nextDue: null };
                const pct = s.lines > 0 ? Math.round(s.learned / s.lines * 100) : 0;
                const status = s.lines === 0 ? 'Empty — open the Explorer to add moves'
                    : s.due > 0 ? `<span class="due-text">${s.due} due now</span>`
                    : s.newLines > 0 ? `${s.newLines} new to learn`
                    : s.nextDue ? `All caught up · next ${this._relativeTime(s.nextDue)}` : 'All caught up';
                const primary = s.lines === 0
                    ? `<button class="btn btn-sm btn-primary" data-action="explore" data-id="${r.id}">Open Explorer</button>`
                    : `<button class="btn btn-sm btn-primary" data-action="train" data-id="${r.id}">${s.due > 0 ? `Review ${s.due}` : s.newLines > 0 ? 'Learn' : 'Train'}</button>
                       <button class="btn btn-sm" data-action="explore" data-id="${r.id}">Explore</button>`;
                return `<div class="rep-card ${r.color}">
                    <div class="rep-card-head">
                        <span class="rep-card-icon">${r.color === 'white' ? '&#9812;' : '&#9818;'}</span>
                        <span class="rep-card-name">${this._escapeHtml(r.name)}</span>
                    </div>
                    <div class="rep-card-status">${status}</div>
                    <div class="rep-card-bar" title="${s.learned} of ${s.lines} lines learned"><div style="width:${pct}%"></div></div>
                    <div class="rep-card-meta">${s.lines} lines · ${s.learned} learned${s.accuracy !== null ? ` · ${s.accuracy}% accuracy` : ''}</div>
                    <div class="rep-card-actions">${primary}</div>
                </div>`;
            }).join('');
            el.innerHTML = `
                <div class="dashboard">
                    <div class="dashboard-head">
                        <h2>Your repertoires</h2>
                        <p class="text-muted">${headline}</p>
                    </div>
                    ${this._backupReminderHtml()}
                    <div class="rep-cards">${cards}</div>
                    <div class="dashboard-actions">
                        <button class="btn btn-sm" data-action="import">Import PGN</button>
                        <button class="btn btn-sm" data-action="new">New repertoire</button>
                        <button class="btn btn-sm" data-action="sandbox">Sandbox board</button>
                    </div>
                </div>`;
        }
        this._updateStorageStatus();
    }

    _backupReminderHtml() {
        const last = this.prefs.lastBackup;
        const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
        if (days !== null && days < 7) return '';
        const text = days === null
            ? 'You have never downloaded a backup. Your data lives only in this browser.'
            : `Your last backup was ${days} days ago.`;
        return `<div class="backup-reminder">&#128190; ${text}
            <button class="btn btn-sm" data-action="backup">Back up now</button></div>`;
    }

    async _updateStorageStatus() {
        const el = document.getElementById('storage-status');
        if (!el) return;
        try {
            const est = await this.db.getStorageEstimate();
            const persistent = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
            const last = this.prefs.lastBackup ? new Date(this.prefs.lastBackup).toLocaleDateString() : 'never';
            el.innerHTML = `<div class="storage-info">
                Saved in this browser (IndexedDB)${est ? ` · ${est.usageMB} MB used` : ''}
                · ${persistent ? 'protected from automatic clean-up' : 'not marked persistent — keep backups'}
                · last backup: ${last}</div>`;
        } catch (e) {
            el.innerHTML = '';
        }
    }

    async _loadSamples() {
        try {
            let added = 0;
            for (const sample of (window.SAMPLE_REPERTOIRES || [])) {
                const tree = PGNParser.parse(sample.pgn, { repertoireName: sample.name, color: sample.color })[0];
                if (!tree || tree.countNodes() === 0) continue;
                await this.db.saveRepertoire(tree);
                added++;
            }
            await this._loadSidebar();
            await this._renderWelcome();
            Dialogs.toast(`Loaded ${added} sample repertoire${added === 1 ? '' : 's'}. Pick one to start training.`, 'success', 3500);
        } catch (e) {
            Dialogs.alert('Could not load the samples: ' + e.message, { title: 'Error' });
        }
    }

    // ===================== SIDEBAR =====================

    _updateSidebarSelection() {
        document.querySelectorAll('.sidebar-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === this.currentRepertoireId);
        });
    }

    async _loadSidebar() {
        const list = await this.db.listRepertoires();
        this._repertoireList = list;
        const container = document.getElementById('sidebar-list');
        if (!container) return;

        if (list.length === 0) {
            container.innerHTML = '<div class="sidebar-empty">No repertoires yet.<br>Import a PGN or create one below.</div>';
            return;
        }

        container.innerHTML = list.map(rep => {
            const s = rep.summary || { lines: 0, due: 0, newLines: 0 };
            const colorIcon = rep.color === 'white' ? '&#9812;' : '&#9818;';
            const colorClass = rep.color === 'white' ? 'white-rep' : 'black-rep';
            const isActive = rep.id === this.currentRepertoireId ? ' active' : '';
            const badge = s.due > 0
                ? `<span class="badge badge-due" title="${s.due} line(s) due for review">${s.due}</span>`
                : s.newLines > 0 ? `<span class="badge badge-new" title="${s.newLines} new line(s) to learn">${s.newLines}</span>`
                : s.lines > 0 ? '<span class="badge badge-done" title="All caught up">&#10003;</span>' : '';
            return `
                <div class="sidebar-item ${colorClass}${isActive}" data-id="${rep.id}" role="button" tabindex="0">
                    <span class="sidebar-color">${colorIcon}</span>
                    <span class="sidebar-text">
                        <span class="sidebar-name">${this._escapeHtml(rep.name)}</span>
                        <span class="sidebar-meta">${s.lines} line${s.lines === 1 ? '' : 's'}</span>
                    </span>
                    ${badge}
                    <div class="sidebar-item-actions">
                        <button class="btn btn-export-sb" data-id="${rep.id}" title="Export as PGN" aria-label="Export">&#11015;</button>
                        <button class="btn btn-delete-sb btn-danger" data-id="${rep.id}" title="Delete" aria-label="Delete">&#10005;</button>
                    </div>
                </div>`;
        }).join('');
    }

    _refreshSidebarSoon() {
        clearTimeout(this._sidebarTimer);
        this._sidebarTimer = setTimeout(() => this._loadSidebar().catch(() => {}), 400);
    }

    /** Open a repertoire; with no mode, train if there is something to train, else explore. */
    async _openRepertoire(id, mode = null) {
        this._flushNote();
        await this._saveCurrentRepertoire();
        let tree = null;
        try {
            tree = await this.db.loadRepertoire(id);
        } catch (e) {
            console.error('Load failed:', e);
        }
        if (!tree) {
            Dialogs.alert('This repertoire could not be found. It may have been deleted.', { title: 'Not found' });
            await this._loadSidebar();
            return;
        }

        this._cancelTrainerTimers();
        this.currentTree = tree;
        this.currentNode = tree.root;
        this.currentRepertoireId = id;
        this.trainer = null;
        this.chess = this.boardChess;
        this.chess.reset();
        this.explorerMoveStack = [];
        this.explorerForwardStack = [];
        this.engineSnapshot = null;
        this._setEditMode(false);
        this.currentTree.setDefaultCollapse(4);

        if (!mode) mode = tree.countLines() === 0 ? 'explorer' : 'trainer';

        if (mode === 'explorer') {
            this._openExplorer([]);
        } else {
            this._showView('trainer');
            this._startTraining();
        }
        this._updateSidebarSelection();
    }

    _repertoireChanged() {
        if (!this.currentTree) return;
        this.currentTree._dirty = true;
        this._renderTreeView();
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this._saveCurrentRepertoire();
            this._refreshSidebarSoon();
        }, 400);
    }

    async _saveCurrentRepertoire() {
        if (!this.currentTree) return;
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
        try {
            await this.db.saveRepertoire(this.currentTree);
        } catch (e) {
            console.error('Failed to save:', e);
            Dialogs.toast('Could not save your changes: ' + e.message, 'error', 5000);
        }
    }

    async _exportRepertoire(id) {
        try {
            const tree = await this.db.loadRepertoire(id);
            if (!tree) throw new Error('Repertoire not found');
            const pgn = PGNParser.export(tree);
            const safeName = tree.name.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 50) || 'repertoire';
            this._download(pgn, `${safeName}.pgn`, 'application/x-chess-pgn');
        } catch (e) {
            Dialogs.alert('Export failed: ' + e.message, { title: 'Error' });
        }
    }

    _download(text, filename, type) {
        const blob = new Blob([text], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ===================== BACKUP / RESTORE =====================

    async _backupAll() {
        try {
            await this._saveCurrentRepertoire();
            const backup = await this.db.exportAll();
            const date = new Date().toISOString().split('T')[0];
            this._download(JSON.stringify(backup, null, 2), `chess-repertoire-backup-${date}.json`, 'application/json');
            this._savePref('lastBackup', Date.now());
            Dialogs.toast(`Backup of ${backup.repertoireCount} repertoire(s) downloaded.`, 'success');
            if (this.view === 'welcome') this._renderWelcome();
        } catch (e) {
            Dialogs.alert('Backup failed: ' + e.message, { title: 'Error' });
        }
    }

    async _restoreFromFile(file) {
        const statusEl = document.getElementById('restore-status');
        try {
            const text = await file.text();
            let backup;
            try {
                backup = JSON.parse(text);
            } catch (e) {
                throw new Error('This file is not a valid backup (JSON could not be read).');
            }

            const count = backup.repertoireCount || backup.repertoires?.length || 0;
            const date = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : 'unknown date';

            const mode = await Dialogs.choose(
                `Backup from ${date} with ${count} repertoire(s).`,
                {
                    title: 'Restore backup',
                    choices: [
                        { label: 'Replace all', value: 'replace', kind: 'danger', description: 'delete current data, then restore the backup' },
                        { label: 'Merge', value: 'merge', kind: 'primary', description: 'add repertoires that are missing, keep existing ones' }
                    ]
                });
            if (!mode) return;

            if (mode === 'replace') {
                const sure = await Dialogs.confirm(
                    'This will DELETE all current repertoires and replace them with the backup. Continue?',
                    { title: 'Replace all data', okText: 'Replace', danger: true });
                if (!sure) return;
            }

            const result = await this.db.importAll(backup, mode);
            let msg = `Restored ${result.imported} repertoire(s).`;
            if (result.skipped > 0) msg += ` Skipped ${result.skipped} (already present).`;
            if (result.errors.length > 0) msg += ` ${result.errors.length} error(s).`;

            if (mode === 'replace') {
                this.currentTree = null;
                this.currentRepertoireId = null;
                this.trainer = null;
            }
            await this._loadSidebar();
            this._showView('welcome');
            await this._renderWelcome();
            Dialogs.toast(msg, result.errors.length ? 'warning' : 'success', 4500);
        } catch (e) {
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.className = 'restore-error';
                statusEl.textContent = 'Restore failed: ' + e.message;
                setTimeout(() => { statusEl.style.display = 'none'; }, 6000);
            } else {
                Dialogs.alert('Restore failed: ' + e.message, { title: 'Error' });
            }
        }
    }

    async _deleteRepertoire(id) {
        const rep = this._repertoireList.find(r => r.id === id);
        const name = rep ? `"${rep.name}"` : 'this repertoire';
        const ok = await Dialogs.confirm(
            `Delete ${name}? All its lines and training progress will be removed.\n\nTip: use Backup first if you might want it back.`,
            { title: 'Delete repertoire', okText: 'Delete', danger: true });
        if (!ok) return;
        try {
            await this.db.deleteRepertoire(id);
            if (this.currentRepertoireId === id) {
                this._cancelTrainerTimers();
                this.currentRepertoireId = null;
                this.currentTree = null;
                this.currentNode = null;
                this.trainer = null;
            }
            await this._loadSidebar();
            if (!this.currentTree && this.view !== 'sandbox' && this.view !== 'import') {
                this._showView('welcome');
            }
            if (this.view === 'welcome') await this._renderWelcome();
            Dialogs.toast('Repertoire deleted.', 'success');
        } catch (e) {
            Dialogs.alert('Delete failed: ' + e.message, { title: 'Error' });
        }
    }

    // ===================== IMPORT =====================

    _showImportDialog() {
        this._saveCurrentRepertoire();
        this._showView('import');
        setTimeout(() => document.getElementById('import-name')?.focus(), 50);
    }

    async _handleImport() {
        const fileInput = document.getElementById('pgn-file');
        const textInput = document.getElementById('pgn-text');
        const nameInput = document.getElementById('import-name');
        const colorSelect = document.getElementById('import-color');
        const progressEl = document.getElementById('import-progress');
        const statusEl = document.getElementById('import-status');
        const importBtn = document.getElementById('btn-do-import');

        let pgnText = '';
        let fileName = '';

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            fileName = file.name.replace(/\.(pgn|txt)$/i, '');
            statusEl.textContent = `Reading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`;
            pgnText = await file.text();
        } else if (textInput.value.trim()) {
            pgnText = textInput.value.trim();
        } else {
            Dialogs.toast('Choose a PGN file or paste PGN text first.', 'warning');
            return;
        }

        const name = nameInput.value.trim() || fileName || 'Imported Repertoire';
        const color = colorSelect.value;

        const langInfo = document.getElementById('import-language-info');
        const statsDiv = document.getElementById('import-stats');
        const detectedLang = PGNParser.detectLanguage(pgnText.substring(0, 5000));
        const langName = PGNParser.getLanguageName(detectedLang);

        if (langInfo) {
            langInfo.innerHTML = `<span class="language-badge">${detectedLang !== 'en' ? 'Detected notation' : 'Notation'}: ${this._escapeHtml(langName)}</span>`;
        }

        statusEl.textContent = 'Parsing PGN...';
        progressEl.style.display = 'block';
        progressEl.querySelector('.progress-bar').style.width = '0%';
        if (importBtn) importBtn.disabled = true;

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
            const skipped = tree._skippedMoves || 0;

            // Nothing usable parsed — don't save an empty repertoire silently.
            if (nodeCount === 0) {
                statusEl.textContent = skipped > 0
                    ? `No valid moves found (${skipped} unreadable). Check the PGN format.`
                    : 'No moves found in the PGN.';
                progressEl.style.display = 'none';
                return;
            }

            statusEl.textContent = `Saving: ${nodeCount} positions, ${lineCount} lines...`;
            await this.db.saveRepertoire(tree);

            statusEl.textContent = skipped > 0
                ? `Imported with warnings — ${skipped} move(s) could not be read and were skipped.`
                : 'Imported successfully!';
            progressEl.querySelector('.progress-bar').style.width = '100%';

            if (statsDiv) {
                statsDiv.style.display = 'flex';
                statsDiv.innerHTML = `
                    <span class="stat-item"><strong>${nodeCount}</strong> positions</span>
                    <span class="stat-item"><strong>${lineCount}</strong> lines</span>
                    <span class="stat-item"><strong>${transCount}</strong> transpositions</span>
                    ${skipped > 0 ? `<span class="stat-item" style="color:var(--warning)"><strong>${skipped}</strong> skipped</span>` : ''}
                `;
            }

            fileInput.value = '';
            textInput.value = '';
            nameInput.value = '';

            try {
                await this._loadSidebar();
            } catch (e) {
                console.error('Sidebar refresh after import failed:', e);
            }

            Dialogs.toast(`Imported "${tree.name}" — ${lineCount} lines.`, skipped ? 'warning' : 'success', 3500);
            setTimeout(() => {
                progressEl.style.display = 'none';
                if (statsDiv) statsDiv.style.display = 'none';
                if (langInfo) langInfo.innerHTML = '';
                statusEl.textContent = '';
                if (this.view === 'import') this._openRepertoire(tree.id, 'explorer');
            }, skipped ? 2500 : 900);

        } catch (e) {
            statusEl.textContent = 'Import failed: ' + e.message;
            progressEl.style.display = 'none';
            console.error('Import error:', e);
        } finally {
            if (importBtn) importBtn.disabled = false;
        }
    }

    // ===================== EVENTS =====================

    _bindEvents() {
        const on = (id, event, handler) => document.getElementById(id)?.addEventListener(event, handler);

        // Header
        on('btn-home', 'click', () => this._goHome());
        on('btn-home', 'keydown', (e) => { if (e.key === 'Enter') this._goHome(); });
        on('btn-backup', 'click', () => this._backupAll());
        on('btn-shortcuts', 'click', () => this._showShortcuts());
        on('btn-sound', 'click', () => this._toggleSound());

        // Sidebar
        on('btn-import', 'click', () => this._showImportDialog());
        on('btn-new-repertoire', 'click', () => this._createNewRepertoire());
        on('btn-sandbox', 'click', () => this._enterSandbox());
        on('restore-file', 'change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this._restoreFromFile(file);
                e.target.value = ''; // reset so the same file can be picked again
            }
        });
        const sidebarList = document.getElementById('sidebar-list');
        sidebarList?.addEventListener('click', (e) => {
            const exp = e.target.closest('.btn-export-sb');
            const del = e.target.closest('.btn-delete-sb');
            const item = e.target.closest('.sidebar-item');
            if (exp) { e.stopPropagation(); this._exportRepertoire(exp.dataset.id); }
            else if (del) { e.stopPropagation(); this._deleteRepertoire(del.dataset.id); }
            else if (item) this._openRepertoire(item.dataset.id);
        });
        sidebarList?.addEventListener('keydown', (e) => {
            const item = e.target.closest('.sidebar-item');
            if (item && e.key === 'Enter' && e.target === item) this._openRepertoire(item.dataset.id);
        });
        on('btn-sidebar-toggle', 'click', () => {
            const sidebar = document.getElementById('sidebar');
            sidebar?.classList.toggle('open');
            document.getElementById('sidebar-overlay')?.classList.toggle('active', sidebar?.classList.contains('open'));
        });
        on('sidebar-overlay', 'click', () => {
            document.getElementById('sidebar')?.classList.remove('open');
            document.getElementById('sidebar-overlay')?.classList.remove('active');
        });

        // Welcome / dashboard actions
        document.getElementById('welcome-content')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const id = btn.dataset.id;
            switch (btn.dataset.action) {
                case 'import': this._showImportDialog(); break;
                case 'new': this._createNewRepertoire(); break;
                case 'samples': this._loadSamples(); break;
                case 'sandbox': this._enterSandbox(); break;
                case 'backup': this._backupAll(); break;
                case 'train': this._openRepertoire(id, 'trainer'); break;
                case 'explore': this._openRepertoire(id, 'explorer'); break;
            }
        });

        // Import
        on('btn-do-import', 'click', () => this._handleImport());
        on('btn-cancel-import', 'click', () => this._goHome());

        // Tabs
        on('tab-train', 'click', () => {
            if (!this.currentTree || this.view === 'trainer') return;
            this._flushNote();
            this._saveCurrentRepertoire();
            this._showView('trainer');
            this._startTraining();
        });
        on('tab-explore', 'click', () => {
            if (!this.currentTree || this.view === 'explorer') return;
            this._openExplorer([]);
        });

        // Explorer
        on('btn-explorer-start', 'click', () => this._explorerGoToStart());
        on('btn-explorer-back', 'click', () => this._explorerBack());
        on('btn-explorer-forward', 'click', () => this._explorerForward());
        on('btn-explorer-end', 'click', () => this._explorerGoToEnd());
        on('btn-explorer-flip', 'click', () => this._flipBoard());
        on('btn-edit-mode', 'click', () => this._setEditMode(!this.editMode));
        on('btn-train-here', 'click', () => this._trainFromHere());
        on('note-text', 'input', () => this._onNoteInput());
        on('note-text', 'blur', () => this._flushNote());
        this._renderNagButtons();
        on('nag-buttons', 'click', (e) => {
            const btn = e.target.closest('.nag-btn');
            if (btn) this._toggleNag(Number(btn.dataset.nag));
        });
        const children = document.getElementById('explorer-children');
        children?.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]');
            if (action) {
                if (action.dataset.action === 'add-line') this._addCurrentLine();
                if (action.dataset.action === 'rejoin') this._navigateToPath(action.dataset.path.split(',').filter(Boolean));
                return;
            }
            const child = e.target.closest('.explorer-child');
            if (child) this._explorerPlaySan(child.dataset.move);
        });
        children?.addEventListener('keydown', (e) => {
            const child = e.target.closest('.explorer-child');
            if (child && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                this._explorerPlaySan(child.dataset.move);
            }
        });
        on('explorer-transposition', 'click', (e) => {
            const p = e.target.closest('.trans-path[data-path]');
            if (p) this._navigateToPath(p.dataset.path.split(',').filter(Boolean));
        });
        on('explorer-moves', 'click', (e) => {
            const m = e.target.closest('[data-ply]');
            if (m) this._explorerGoToPly(Number(m.dataset.ply));
        });
        on('btn-tree-collapse-all', 'click', () => {
            if (!this.currentTree) return;
            this.currentTree.setDefaultCollapse(1);
            this._renderTreeView();
        });
        on('btn-tree-expand-all', 'click', () => {
            if (!this.currentTree) return;
            this.currentTree._traverse(this.currentTree.root, n => { n.collapsed = false; });
            this._renderTreeView();
        });
        this._bindTreeEvents();

        // Engine
        on('engine-toggle', 'change', (e) => this._setEngineEnabled(e.target.checked));
        on('engine-lines', 'click', (e) => {
            if (e.target.closest('[data-action="engine-retry"]')) {
                this.engineStatus = 'off';
                this.engine = null;
                this._setEngineEnabled(true);
                return;
            }
            const line = e.target.closest('.engine-line[data-uci]');
            if (line) this._explorerPlayUci(line.dataset.uci);
        });
        on('engine-lines', 'keydown', (e) => {
            const line = e.target.closest('.engine-line[data-uci]');
            if (line && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                this._explorerPlayUci(line.dataset.uci);
            }
        });

        // Sandbox
        on('btn-sandbox-back', 'click', () => this._sandboxUndo());
        on('btn-sandbox-forward', 'click', () => this._sandboxRedo());
        on('btn-sandbox-reset', 'click', () => this._sandboxReset());
        on('btn-sandbox-flip', 'click', () => this._flipBoard());
        on('btn-sandbox-load-fen', 'click', () => {
            const fen = document.getElementById('sandbox-fen-input').value.trim();
            if (fen) this._sandboxLoadFen(fen);
        });
        on('sandbox-fen-input', 'keydown', (e) => {
            if (e.key === 'Enter') {
                const fen = e.target.value.trim();
                if (fen) this._sandboxLoadFen(fen);
            }
        });
        on('sandbox-moves', 'click', (e) => {
            const m = e.target.closest('[data-ply]');
            if (m) this._sandboxGoToPly(Number(m.dataset.ply));
        });
        on('btn-sandbox-copy-fen', 'click', () => this._copyText(this.chess.fen(), 'FEN'));
        on('btn-sandbox-copy-pgn', 'click', () => this._copyText(this.chess.pgn(), 'PGN'));
        on('btn-sandbox-save-rep', 'click', () => this._sandboxSaveAsRepertoire());

        // Trainer
        on('btn-hint', 'click', () => this._trainerHint());
        on('btn-show-move', 'click', () => this._trainerShowMove());
        on('btn-trainer-skip', 'click', () => this._trainerSkip());
        on('btn-trainer-flip', 'click', () => this._flipBoard());
        on('btn-trainer-restart', 'click', () => this._startTraining());
        on('train-mode', 'change', (e) => { this._savePref('trainMode', e.target.value); this._startTraining(); });
        on('train-limit', 'change', (e) => { this._savePref('trainLimit', parseInt(e.target.value, 10) || 20); this._startTraining(); });
        on('train-learn', 'change', (e) => { this._savePref('learnNew', e.target.checked); this._startTraining(); });
        on('trainer-feedback', 'click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            switch (btn.dataset.action) {
                case 'next-line': this._trainerNextLine(); break;
                case 'hint': this._trainerHint(); break;
                case 'show-move': this._trainerShowMove(); break;
                case 'train-again': this._startTraining(); break;
                case 'train-all': this._startTraining({ mode: 'all' }); break;
                case 'open-explorer': this._openExplorer([]); break;
                case 'open-explorer-edit': this._openExplorer([]); this._setEditMode(true); break;
            }
        });

        // Persist on tab close / hide
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this._flushNote();
                this._saveCurrentRepertoire();
            }
        });
        window.addEventListener('beforeunload', () => {
            this._flushNote();
            this._saveCurrentRepertoire();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this._onKeyDown(e));
    }

    _onKeyDown(e) {
        if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        const tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
        const onButton = tag === 'BUTTON';

        const boardView = this.view === 'explorer' || this.view === 'sandbox' || this.view === 'trainer';
        let handled = true;
        switch (e.key) {
            case 'ArrowLeft':
                if (this.view === 'explorer') this._explorerBack();
                else if (this.view === 'sandbox') this._sandboxUndo();
                else handled = false;
                break;
            case 'ArrowRight':
                if (this.view === 'explorer') this._explorerForward();
                else if (this.view === 'sandbox') this._sandboxRedo();
                else handled = false;
                break;
            case 'Home':
                if (this.view === 'explorer') this._explorerGoToStart();
                else if (this.view === 'sandbox') this._sandboxGoToPly(0);
                else handled = false;
                break;
            case 'End':
                if (this.view === 'explorer') this._explorerGoToEnd();
                else if (this.view === 'sandbox') this._sandboxGoToPly(this.sandboxMoveStack.length + this.sandboxRedoStack.length);
                else handled = false;
                break;
            case 'f':
                if (boardView) this._flipBoard(); else handled = false;
                break;
            case 'e':
                if (this._engineActiveInView()) this._setEngineEnabled(!this.engineEnabled); else handled = false;
                break;
            case 'm':
                this._toggleSound();
                break;
            case 'h':
                if (this.view === 'trainer') this._trainerHint(); else handled = false;
                break;
            case 's':
                if (this.view === 'trainer') this._trainerShowMove(); else handled = false;
                break;
            case 'n':
            case 'Enter':
            case ' ':
                if (!onButton && this.view === 'trainer' && this.trainer && (this.trainer.lineCompleted || this.trainer.state === 'waiting')) {
                    this._trainerNextLine();
                } else handled = false;
                break;
            case '?':
                this._showShortcuts();
                break;
            case 'Escape':
                this._clearSelection();
                this._hideContextMenu();
                break;
            default:
                handled = false;
        }
        if (handled) e.preventDefault();
    }

    _toggleSound() {
        const enabled = this.sounds.toggle();
        this._savePref('sound', enabled);
        const btn = document.getElementById('btn-sound');
        if (btn) {
            btn.classList.toggle('muted', !enabled);
            btn.title = enabled ? 'Sounds on (M)' : 'Sounds off (M)';
        }
        Dialogs.toast(enabled ? 'Sounds on' : 'Sounds off', 'info', 1200);
    }

    _showShortcuts() {
        const rows = [
            ['← / →', 'Back / forward (Explorer), undo / redo (Sandbox)'],
            ['Home / End', 'Start position / end of mainline'],
            ['F', 'Flip the board'],
            ['E', 'Engine on / off (Explorer, Sandbox)'],
            ['H', 'Hint: highlight the piece to move (Training)'],
            ['S', 'Show the move (Training)'],
            ['N / Enter', 'Next line (Training)'],
            ['M', 'Sounds on / off'],
            ['Click piece → square', 'Move without dragging'],
            ['Right-click tree move', 'Train from here, set mainline, delete…']
        ];
        Dialogs.show({
            title: 'Keyboard shortcuts',
            bodyHtml: `<table class="shortcuts">${rows.map(([k, v]) =>
                `<tr><td><kbd>${this._escapeHtml(k)}</kbd></td><td>${this._escapeHtml(v)}</td></tr>`).join('')}</table>`,
            buttons: [{ label: 'Close', value: true, kind: 'primary', submit: true }],
            cancelValue: true
        });
    }

    async _createNewRepertoire() {
        const result = await Dialogs.form({
            title: 'New repertoire',
            description: 'Start an empty repertoire and build it move by move in the Explorer.',
            okText: 'Create',
            fields: [
                { name: 'name', label: 'Name', type: 'text', value: '', placeholder: 'e.g. Italian Game (White)', required: true },
                { name: 'color', label: 'I play as', type: 'color', value: 'white' }
            ]
        });
        if (!result) return;

        try {
            const tree = new MoveTree(result.name, result.color);
            await this.db.saveRepertoire(tree);
            await this._loadSidebar();
            await this._openRepertoire(tree.id, 'explorer');
            this._setEditMode(true);
            Dialogs.toast('Repertoire created — play moves on the board to add them.', 'success', 4000);
        } catch (e) {
            console.error('Create repertoire failed:', e);
            Dialogs.alert('Could not create the repertoire: ' + e.message, { title: 'Error' });
        }
    }

    // ===================== FORMATTING HELPERS =====================

    /**
     * Render a clickable move list into `elementId`.
     * @param {string[]} sans - moves from the list's start position
     * @param {number} currentPly - number of moves played so far (highlights move currentPly)
     * @param {Chess} chess - used only for the starting move number when startFen is set
     * @param {string|null} startFen - custom starting position (sandbox)
     */
    _renderMoveList(elementId, sans, currentPly, chess, startFen = null, clickable = true) {
        const el = document.getElementById(elementId);
        if (!el) return;
        let moveNumber = 1;
        let blackFirst = false;
        if (startFen) {
            const parts = startFen.split(' ');
            moveNumber = parseInt(parts[5], 10) || 1;
            blackFirst = parts[1] === 'b';
        }
        let html = '';
        sans.forEach((san, i) => {
            const isBlack = blackFirst ? i % 2 === 0 : i % 2 === 1;
            const num = moveNumber + Math.floor((i + (blackFirst ? 1 : 0)) / 2);
            if (!isBlack) html += `<span class="move-number">${num}.</span>`;
            else if (i === 0) html += `<span class="move-number">${num}…</span>`;
            const cls = `move-text${i + 1 === currentPly ? ' current-move' : ''}${clickable ? '' : ' static'}`;
            html += `<span class="${cls}"${clickable ? ` data-ply="${i + 1}" role="button" tabindex="-1"` : ''}>${this._figHtml(san)}</span> `;
        });
        el.innerHTML = html || '<span class="no-moves">Starting position</span>';
        const current = el.querySelector('.current-move');
        if (current) {
            const box = el.getBoundingClientRect();
            const r = current.getBoundingClientRect();
            if (r.bottom > box.bottom || r.top < box.top) el.scrollTop += r.top - box.top - 8;
        }
    }

    /** "12...Nf6 13.Bxe5 Nd5" for SAN moves starting at `fen`. */
    _formatSanSequence(fen, sans) {
        const parts = fen.split(' ');
        let num = parseInt(parts[5], 10) || 1;
        let white = parts[1] === 'w';
        let out = '';
        sans.forEach((san, i) => {
            if (white) out += `<span class="pv-num">${num}.</span>`;
            else if (i === 0) out += `<span class="pv-num">${num}…</span>`;
            out += `<span class="pv-move${i === 0 ? ' first' : ''}">${this._figHtml(san)}</span> `;
            if (!white) num++;
            white = !white;
        });
        return out.trim();
    }

    /** Move with its number for a ply index from the initial position: "3.Bb5" / "3…a6". */
    _formatPly(plyIndex, san, html = false) {
        const num = Math.floor(plyIndex / 2) + 1;
        const prefix = plyIndex % 2 === 0 ? `${num}.` : `${num}…`;
        return html ? `<span class="ply-num">${prefix}</span>${san}` : prefix + san;
    }

    /** "1.e4 e5 2.Nf3" style text for a move path. */
    _formatPath(path) {
        let s = '';
        // Paths always start from the initial position, so White moves first.
        for (let i = 0; i < path.length; i++) {
            if (i % 2 === 0) s += `${Math.floor(i / 2) + 1}.`;
            s += path[i] + ' ';
        }
        return s.trim();
    }

    _relativeTime(ts) {
        const diff = ts - Date.now();
        if (diff <= 0) return 'now';
        const min = Math.round(diff / 60000);
        if (min < 60) return `in ${min} min`;
        const h = Math.round(min / 60);
        if (h < 36) return `in ${h} h`;
        const d = Math.round(h / 24);
        return `in ${d} day${d === 1 ? '' : 's'}`;
    }

    /**
     * Convert SAN to figurine algebraic notation using Unicode chess symbols.
     * K→♔ Q→♕ R→♖ B→♗ N→♘ (kept as a wider-spaced span via CSS).
     * Falls back to plain letters if figurines can't be rendered.
     */
    _toFigurine(san) {
        if (!this.useFigurine || !san) return san;
        const map = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
        if (san.length > 1 && map[san[0]]) {
            return map[san[0]] + san.substring(1);
        }
        return san;
    }

    /** HTML for a SAN move with an enlarged figurine glyph. */
    _figHtml(san) {
        const text = this._toFigurine(san);
        if (text && text !== san) {
            return `<span class="fig">${text[0]}</span>${this._escapeHtml(text.substring(1))}`;
        }
        return this._escapeHtml(text);
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML.replace(/"/g, '&quot;');
    }
}

// Expose for debugging from the console and for tests
window.App = App;

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init().catch(console.error);
});
