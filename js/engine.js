/**
 * Stockfish Engine Wrapper
 *
 * Wraps stockfish.js (WASM) in a clean async API.
 * Runs as a Web Worker, communicates via UCI protocol.
 */

class ChessEngine {
    constructor() {
        this.worker = null;
        this.ready = false;
        this.evaluating = false;
        this._resolveReady = null;
        this._resolveEval = null;
        this._currentEval = null;
        this.cache = new Map();      // FEN -> evaluation result
        this.maxCacheSize = 5000;
        this.onInfo = null;          // Callback for intermediate info updates
        this.debug = false;          // Toggle console logging of raw UCI messages
        this.name = 'Stockfish';     // Engine name from UCI id
        this.evalTimeoutMs = 20000;  // Watchdog: max wait for a 'bestmove' reply
    }

    /**
     * Initialize the Stockfish engine.
     * @returns {Promise} Resolves when engine is ready.
     */
    async init() {
        if (this.ready) return;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Stockfish init timed out after 10s'));
            }, 10000);

            try {
                // Resolve correct path for both browser and Electron
                let workerPath = 'vendor/stockfish/stockfish.js';
                if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
                    // In Electron/file:// context, use absolute path
                    const base = window.location.pathname.replace(/[^/\\]*$/, '');
                    workerPath = base + workerPath;
                    // On Windows, remove leading slash from /C:/...
                    if (/^\/[A-Z]:/.test(workerPath)) {
                        workerPath = workerPath.substring(1);
                    }
                }
                console.log('Loading Stockfish 18 (lite-single WASM) from:', workerPath);
                this.worker = new Worker(workerPath);
            } catch (e) {
                clearTimeout(timeout);
                reject(new Error('Failed to create Stockfish worker: ' + e.message));
                return;
            }

            this._resolveReady = () => {
                clearTimeout(timeout);
                resolve();
            };

            this.worker.onmessage = (e) => {
                if (this.debug) console.log('[SF]', e.data);
                this._handleMessage(e.data);
            };

            this.worker.onerror = (e) => {
                clearTimeout(timeout);
                console.error('[SF] Worker error:', e);
                reject(new Error('Stockfish worker error: ' + (e.message || e.filename || 'unknown')));
            };

            this.worker.onmessageerror = (e) => {
                console.error('[SF] Message error:', e);
            };

            // Start UCI initialization
            this._send('uci');
        });
    }

    _send(cmd) {
        if (this.worker) {
            this.worker.postMessage(cmd);
        }
    }

    _handleMessage(line) {
        if (typeof line !== 'string') return;

        // Capture engine name
        if (line.startsWith('id name')) {
            this.name = line.substring(8).trim();
            return;
        }

        // UCI initialization
        if (line === 'uciok') {
            this._send('isready');
            return;
        }

        if (line === 'readyok') {
            if (!this.ready) {
                this.ready = true;
                // Set reasonable defaults
                this._send('setoption name Threads value 1');
                this._send('setoption name Hash value 32');
                if (this._resolveReady) {
                    this._resolveReady();
                    this._resolveReady = null;
                }
            }
            return;
        }

        // Parse info lines during evaluation
        if (line.startsWith('info') && line.includes('score')) {
            const info = this._parseInfo(line);
            if (info) {
                this._currentEval = info;
                if (this.onInfo) {
                    this.onInfo(info);
                }
            }
            return;
        }

        // Best move - evaluation complete
        if (line.startsWith('bestmove')) {
            const parts = line.split(' ');
            const bestMove = parts[1] || null;

            if (this._resolveEval && this._currentEval) {
                this._currentEval.bestMove = bestMove;
                this._resolveEval(this._currentEval);
                this._resolveEval = null;
            }
            this.evaluating = false;
        }
    }

    _parseInfo(line) {
        const result = {
            depth: 0,
            score: 0,
            mate: null,
            pv: [],
            nodes: 0,
            nps: 0,
            time: 0
        };

        const parts = line.split(' ');

        for (let i = 0; i < parts.length; i++) {
            switch (parts[i]) {
                case 'depth':
                    result.depth = parseInt(parts[i + 1]);
                    break;
                case 'score':
                    if (parts[i + 1] === 'cp') {
                        result.score = parseInt(parts[i + 2]) / 100; // centipawns to pawns
                        result.mate = null;
                    } else if (parts[i + 1] === 'mate') {
                        result.mate = parseInt(parts[i + 2]);
                        result.score = result.mate > 0 ? 100 : -100;
                    }
                    break;
                case 'pv':
                    result.pv = parts.slice(i + 1);
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

        // Only return if we got a valid depth
        return result.depth > 0 ? result : null;
    }

    /**
     * Evaluate a position.
     * @param {string} fen - Position FEN
     * @param {number} depth - Search depth (default 18)
     * @returns {Promise<{score, mate, bestMove, pv, depth}>}
     */
    async evaluate(fen, depth = 18) {
        if (!this.ready) {
            await this.init();
        }

        // Check cache
        const cacheKey = fen + ':' + depth;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // Cancel any ongoing evaluation
        if (this.evaluating) {
            this.stop();
            // Wait a tick for stop to process
            await new Promise(r => setTimeout(r, 10));
        }

        return new Promise((resolve) => {
            this.evaluating = true;
            this._currentEval = null;

            // Safety timeout: if the worker never replies with 'bestmove'
            // (crashed/wedged), don't hang forever — resolve with whatever
            // partial info we have (or null) and reset state.
            const watchdog = setTimeout(() => {
                if (this._resolveEval) {
                    const partial = this._currentEval;
                    this._resolveEval = null;
                    this.evaluating = false;
                    resolve(partial || null);
                }
            }, this.evalTimeoutMs);

            this._resolveEval = (result) => {
                clearTimeout(watchdog);
                // Cache the result
                if (result) {
                    if (this.cache.size >= this.maxCacheSize) {
                        // Remove oldest entry
                        const firstKey = this.cache.keys().next().value;
                        this.cache.delete(firstKey);
                    }
                    this.cache.set(cacheKey, result);
                }
                resolve(result);
            };

            this._send('position fen ' + fen);
            this._send('go depth ' + depth);
        });
    }

    /**
     * Stop current evaluation.
     */
    stop() {
        if (this.evaluating) {
            this._send('stop');
        }
    }

    /**
     * Format score for display.
     * @param {Object} evalResult - Result from evaluate()
     * @returns {string} e.g. "+0.45", "-1.20", "M3", "-M5"
     */
    static formatScore(evalResult) {
        if (!evalResult) return '?';
        if (evalResult.mate !== null) {
            return (evalResult.mate > 0 ? 'M' : '-M') + Math.abs(evalResult.mate);
        }
        const s = evalResult.score;
        return (s >= 0 ? '+' : '') + s.toFixed(2);
    }

    /**
     * Get evaluation bar percentage (0-100, 50 = equal).
     * @param {Object} evalResult
     * @returns {number} 0-100 where 100 = white winning completely
     */
    static getBarPercent(evalResult) {
        if (!evalResult) return 50;
        if (evalResult.mate !== null) {
            return evalResult.mate > 0 ? 100 : 0;
        }
        // Sigmoid-like scaling: ±5 pawns maps roughly to 5%-95%
        const s = evalResult.score;
        return Math.round(50 + 50 * (2 / (1 + Math.exp(-0.5 * s)) - 1));
    }

    /**
     * Convert UCI move (e.g. "e2e4") to SAN using a Chess instance.
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
     * Destroy the engine worker.
     */
    destroy() {
        if (this.worker) {
            this.stop();
            this.worker.terminate();
            this.worker = null;
            this.ready = false;
        }
    }

    isReady() {
        return this.ready;
    }
}

window.ChessEngine = ChessEngine;
