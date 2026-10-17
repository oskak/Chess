/**
 * Stockfish Engine Wrapper
 *
 * Wraps stockfish.js (WASM, Stockfish 18 lite single-threaded) in a small
 * async API. The engine runs as a Web Worker and speaks UCI.
 *
 * Guarantees:
 *  - Scores are always from WHITE's point of view (UCI reports them from the
 *    side to move).
 *  - Searches are strictly sequenced: a new request stops the running search
 *    and only starts after its 'bestmove' arrives, so a stale result can never
 *    be attributed to a newer position.
 *  - Checkmate/stalemate positions resolve immediately.
 *  - A wedged worker is restarted by a watchdog instead of hanging forever.
 */

class ChessEngine {
    constructor() {
        this.worker = null;
        this.ready = false;
        this.name = 'Stockfish';     // Engine name from UCI id
        this.debug = false;          // Log raw UCI traffic to the console
        this.evalTimeoutMs = 20000;  // Watchdog: max wait for a 'bestmove' reply
        this.cache = new Map();      // `${fen}|${depth}|${multiPV}` -> result
        this.maxCacheSize = 5000;
        this.onInfo = null;          // Live progress callback(snapshot)

        this._initPromise = null;
        this._search = null;         // running search request
        this._pending = null;        // next request, waiting for the running one to stop
        this._multiPV = 1;           // value currently configured in the engine
    }

    /** True while a search is running (kept for backwards compatibility). */
    get evaluating() {
        return this._search !== null;
    }

    /**
     * Worker + WASM locations. The .wasm URL is passed explicitly in the
     * worker URL's hash (supported by the stockfish.js loader) so it never
     * depends on how `location.origin` behaves for file:// pages (Electron on
     * Windows) versus http://.
     */
    static workerUrl() {
        const base = (typeof document !== 'undefined' && document.baseURI) ? document.baseURI : '';
        const wasm = new URL('vendor/stockfish/stockfish.wasm', base || 'http://localhost/').href;
        return 'vendor/stockfish/stockfish.js#' + encodeURIComponent(wasm);
    }

    /**
     * Initialize the Stockfish engine.
     * @returns {Promise} Resolves when engine is ready.
     */
    init() {
        if (this.ready) return Promise.resolve();
        if (this._initPromise) return this._initPromise;

        this._initPromise = new Promise((resolve, reject) => {
            const fail = (err) => {
                clearTimeout(timeout);
                this._initPromise = null;
                this._terminateWorker();
                reject(err);
            };
            const timeout = setTimeout(() => fail(new Error('Stockfish did not start within 15s')), 15000);

            try {
                const url = ChessEngine.workerUrl();
                if (this.debug) console.log('[SF] starting worker', url);
                this.worker = new Worker(url);
            } catch (e) {
                fail(new Error('Failed to create Stockfish worker: ' + e.message));
                return;
            }

            this._onReady = () => {
                clearTimeout(timeout);
                this._initPromise = null;
                resolve();
            };

            this.worker.onmessage = (e) => {
                if (this.debug) console.log('[SF]', e.data);
                this._handleMessage(e.data);
            };

            this.worker.onerror = (e) => {
                console.error('[SF] Worker error:', e);
                if (!this.ready) {
                    fail(new Error('Stockfish worker error: ' + (e.message || e.filename || 'failed to load')));
                }
            };

            this._send('uci');
        });
        return this._initPromise;
    }

    _send(cmd) {
        if (this.worker) {
            this.worker.postMessage(cmd);
        }
    }

    _handleMessage(line) {
        if (typeof line !== 'string') return;

        if (line.startsWith('id name')) {
            this.name = line.substring(8).trim();
            return;
        }

        if (line === 'uciok') {
            this._send('setoption name Hash value 32');
            this._send('isready');
            return;
        }

        if (line === 'readyok') {
            if (!this.ready) {
                this.ready = true;
                this._multiPV = 1;
                if (this._onReady) {
                    this._onReady();
                    this._onReady = null;
                }
            }
            return;
        }

        if (line.startsWith('info')) {
            this._handleInfo(line);
            return;
        }

        if (line.startsWith('bestmove')) {
            this._handleBestMove(line);
        }
    }

    _handleInfo(line) {
        const s = this._search;
        // Lines arriving while a search is being stopped belong to the old
        // position — never show them.
        if (!s || s.stopping) return;
        if (!line.includes(' score ')) return;
        // Aspiration-window bound lines carry provisional scores.
        if (line.includes(' lowerbound') || line.includes(' upperbound')) return;

        const info = this._parseInfo(line);
        if (!info) return;
        const normalized = ChessEngine._toWhitePerspective(info, s.turn);
        s.lines[(info.multipv || 1) - 1] = normalized;
        if (info.multipv === 1 || !info.multipv) s.main = normalized;

        if (this.onInfo && s.main) {
            try { this.onInfo(this._snapshot(s)); } catch (e) { console.error(e); }
        }
    }

    _handleBestMove(line) {
        const s = this._search;
        this._search = null;
        if (s) {
            clearTimeout(s.watchdog);
            if (s.stopping || s.abandoned) {
                // Superseded or stopped on request: the caller doesn't want it.
                s.resolve(null);
            } else {
                const best = line.split(' ')[1] || null;
                const result = this._finalResult(s, best);
                if (result && !result.terminal) this._cachePut(s.key, result);
                s.resolve(result);
            }
        }
        if (this._pending) {
            const next = this._pending;
            this._pending = null;
            this._start(next);
        }
    }

    _snapshot(s) {
        const main = s.main;
        return {
            fen: s.fen,
            depth: main.depth,
            score: main.score,
            mate: main.mate,
            pv: main.pv,
            bestMove: main.pv[0] || null,
            lines: s.lines.filter(Boolean).map(l => ({ ...l })),
            nodes: main.nodes,
            nps: main.nps,
            terminal: null,
            winner: null
        };
    }

    _finalResult(s, bestMove) {
        if (s.main) {
            const r = this._snapshot(s);
            r.bestMove = bestMove && bestMove !== '(none)' ? bestMove : r.bestMove;
            return r;
        }
        // No usable info: game-over position (Stockfish answers 'bestmove (none)').
        return ChessEngine.terminalResult(s.fen);
    }

    /**
     * Result for a position with no legal moves.
     */
    static terminalResult(fen) {
        let checkmate = false;
        try {
            const c = new Chess(fen);
            checkmate = c.in_checkmate();
        } catch (e) { /* Chess unavailable — treat as stalemate */ }
        const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
        return {
            fen, depth: 0, score: 0, mate: checkmate ? 0 : null, pv: [], bestMove: null, lines: [],
            nodes: 0, nps: 0,
            terminal: checkmate ? 'checkmate' : 'stalemate',
            winner: checkmate ? (turn === 'w' ? 'b' : 'w') : null
        };
    }

    /** Convert a side-to-move score into White's perspective. */
    static _toWhitePerspective(info, turn) {
        const flip = turn === 'b' ? -1 : 1;
        return {
            ...info,
            score: info.score * flip,
            mate: info.mate === null ? null : info.mate * flip
        };
    }

    _parseInfo(line) {
        const result = {
            depth: 0,
            multipv: 1,
            score: 0,
            mate: null,
            pv: [],
            nodes: 0,
            nps: 0,
            time: 0
        };
        let hasScore = false;

        const parts = line.split(' ');

        for (let i = 0; i < parts.length; i++) {
            switch (parts[i]) {
                case 'depth':
                    result.depth = parseInt(parts[i + 1]);
                    break;
                case 'multipv':
                    result.multipv = parseInt(parts[i + 1]) || 1;
                    break;
                case 'score':
                    if (parts[i + 1] === 'cp') {
                        result.score = parseInt(parts[i + 2]) / 100; // centipawns to pawns
                        result.mate = null;
                        hasScore = true;
                    } else if (parts[i + 1] === 'mate') {
                        result.mate = parseInt(parts[i + 2]);
                        result.score = result.mate > 0 ? 100 : -100;
                        hasScore = true;
                    }
                    break;
                case 'pv':
                    result.pv = parts.slice(i + 1).filter(Boolean);
                    i = parts.length; // stop parsing after PV
                    break;
                case 'nodes':
                    result.nodes = parseInt(parts[i + 1]);
                    break;
                case 'nps':
                    result.nps = parseInt(parts[i + 1]);
                    break;
                case 'time':
                    result.time = parseInt(parts[i + 1]);
                    break;
            }
        }

        // Need a real search line: a score and a principal variation.
        return hasScore && result.depth > 0 && result.pv.length > 0 ? result : null;
    }

    _cachePut(key, result) {
        if (this.cache.size >= this.maxCacheSize) {
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(key, result);
    }

    /**
     * Evaluate a position.
     * @param {string} fen - Position FEN
     * @param {number} depth - Search depth (default 18)
     * @param {Object} [options]
     * @param {number} [options.multiPV=1] - number of best lines to report
     * @returns {Promise<Object|null>} White-perspective result, or null if the
     *   request was superseded by a newer one / stopped.
     */
    async evaluate(fen, depth = 18, options = {}) {
        const multiPV = Math.max(1, Math.min(5, options.multiPV || 1));
        const key = `${fen}|${depth}|${multiPV}`;
        if (this.cache.has(key)) return this.cache.get(key);

        if (!this.ready) await this.init();

        // Game over: no need to ask the engine.
        try {
            const c = new Chess(fen);
            if (c.game_over() && (c.in_checkmate() || c.in_stalemate())) {
                return ChessEngine.terminalResult(fen);
            }
        } catch (e) { /* ignore — engine will handle it */ }

        let resolve;
        const promise = new Promise(r => { resolve = r; });
        const req = { fen, depth, multiPV, key, resolve, turn: fen.split(' ')[1] === 'b' ? 'b' : 'w' };

        if (this._search) {
            // Replace any older queued request — only the newest position matters.
            if (this._pending) this._pending.resolve(null);
            this._pending = req;
            if (!this._search.stopping) {
                this._search.stopping = true;
                this._send('stop');
            }
        } else {
            this._start(req);
        }
        return promise;
    }

    _start(req) {
        req.lines = [];
        req.main = null;
        req.stopping = false;
        this._search = req;

        if (this._multiPV !== req.multiPV) {
            this._send('setoption name MultiPV value ' + req.multiPV);
            this._multiPV = req.multiPV;
        }
        this._send('position fen ' + req.fen);
        this._send('go depth ' + req.depth);

        req.watchdog = setTimeout(() => {
            if (this._search !== req) return;
            // The worker didn't answer in time: hand back what we have and
            // restart the engine so the next request starts clean.
            req.abandoned = true;
            this._search = null;
            req.resolve(req.main ? this._snapshot(req) : null);
            const pending = this._pending;
            this._pending = null;
            this._restart();
            if (pending) {
                this.evaluate(pending.fen, pending.depth, { multiPV: pending.multiPV }).then(pending.resolve);
            }
        }, this.evalTimeoutMs);
    }

    /**
     * Stop the current analysis. Its promise resolves with null.
     */
    stop() {
        if (this._pending) {
            this._pending.resolve(null);
            this._pending = null;
        }
        if (this._search && !this._search.stopping) {
            this._search.stopping = true;
            this._send('stop');
        }
    }

    _terminateWorker() {
        if (this.worker) {
            try { this.worker.terminate(); } catch (e) { /* ignore */ }
        }
        this.worker = null;
        this.ready = false;
    }

    _restart() {
        this._terminateWorker();
        this._initPromise = null;
    }

    /**
     * Format a result for display: "+0.45", "-1.20", "#3", "#-5", "1-0", "½-½".
     */
    static formatScore(evalResult) {
        if (!evalResult) return '—';
        if (evalResult.terminal === 'checkmate') return evalResult.winner === 'w' ? '1-0' : '0-1';
        if (evalResult.terminal === 'stalemate') return '½-½';
        if (evalResult.mate !== null && evalResult.mate !== undefined) {
            return evalResult.mate > 0 ? '#' + evalResult.mate : '#-' + Math.abs(evalResult.mate);
        }
        const s = evalResult.score;
        return (s >= 0 ? '+' : '') + s.toFixed(2);
    }

    /**
     * Evaluation bar fill (0-100, 50 = equal, 100 = White winning).
     * Uses the winning-chances curve popularised by Lichess.
     */
    static getBarPercent(evalResult) {
        if (!evalResult) return 50;
        if (evalResult.terminal === 'checkmate') return evalResult.winner === 'w' ? 100 : 0;
        if (evalResult.terminal === 'stalemate') return 50;
        if (evalResult.mate !== null && evalResult.mate !== undefined) {
            return evalResult.mate > 0 ? 100 : 0;
        }
        const cp = Math.max(-1000, Math.min(1000, evalResult.score * 100));
        const winChance = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
        return Math.round(50 + 50 * winChance);
    }

    /**
     * Convert UCI move (e.g. "e2e4") to SAN using a Chess instance.
     * The board is left unchanged.
     */
    static uciToSan(chess, uciMove) {
        if (!uciMove || uciMove.length < 4) return uciMove;
        const from = uciMove.substring(0, 2);
        const to = uciMove.substring(2, 4);
        const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
        const move = chess.move({ from, to, promotion });
        if (move) {
            const san = move.san;
            chess.undo();
            return san;
        }
        return uciMove;
    }

    /**
     * Convert a UCI principal variation to SAN moves from `fen`.
     * Stops at the first move that doesn't apply.
     */
    static pvToSan(fen, pv, maxMoves = 8) {
        const out = [];
        try {
            const c = new Chess(fen);
            for (const uci of pv.slice(0, maxMoves)) {
                const m = c.move({ from: uci.substring(0, 2), to: uci.substring(2, 4), promotion: uci[4] });
                if (!m) break;
                out.push(m.san);
            }
        } catch (e) { /* ignore */ }
        return out;
    }

    /**
     * Destroy the engine worker.
     */
    destroy() {
        this.stop();
        this._terminateWorker();
    }

    isReady() {
        return this.ready;
    }
}

window.ChessEngine = ChessEngine;
