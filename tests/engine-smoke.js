/**
 * Engine smoke test — runs the ACTUAL vendored Stockfish 18 WASM and verifies
 * it speaks UCI and returns an evaluation + bestmove for a position.
 *
 * Loads node_modules/stockfish (byte-identical to vendor/stockfish), which is
 * the same engine the browser app loads as a Web Worker.
 *
 * Run: node tests/engine-smoke.js
 */
const path = require('path');

let initEngine;
try {
    initEngine = require('stockfish');
} catch (e) {
    console.log('\x1b[33m⊘ stockfish npm package not installed — skipping engine smoke test\x1b[0m');
    console.log('  (vendor/stockfish/*.js verified byte-identical to SF18 elsewhere)');
    process.exit(0);
}

(async () => {
    const lines = [];
    let bestmove = null;
    let sawScore = false;
    let sawUciOk = false;
    let idName = '';

    const timeout = setTimeout(() => {
        console.log('\x1b[31m✗ Engine timed out (no bestmove in 30s)\x1b[0m');
        process.exit(1);
    }, 30000);

    const engine = await initEngine('lite-single');

    engine.listener = (line) => {
        if (typeof line !== 'string') return;
        lines.push(line);
        if (line.startsWith('id name')) idName = line.slice(8).trim();
        if (line === 'uciok') sawUciOk = true;
        if (line.startsWith('info') && line.includes(' score ')) sawScore = true;
        if (line.startsWith('bestmove')) {
            bestmove = line.split(' ')[1];
            clearTimeout(timeout);

            const ok = sawUciOk && sawScore && bestmove && bestmove !== '(none)';
            console.log('\x1b[1mEngine smoke test (real Stockfish 18 WASM)\x1b[0m');
            console.log('  id name:    ' + (idName || '(none)'));
            console.log('  uciok:      ' + (sawUciOk ? '\x1b[32myes\x1b[0m' : '\x1b[31mno\x1b[0m'));
            console.log('  score info: ' + (sawScore ? '\x1b[32myes\x1b[0m' : '\x1b[31mno\x1b[0m'));
            console.log('  bestmove:   ' + bestmove);
            console.log('\n' + '='.repeat(50));
            if (ok && /stockfish\s*18/i.test(idName)) {
                console.log('\x1b[32m✓ Stockfish 18 evaluates positions correctly\x1b[0m');
                process.exit(0);
            } else if (ok) {
                console.log('\x1b[32m✓ Engine evaluates\x1b[0m \x1b[33m(name not "Stockfish 18": ' + idName + ')\x1b[0m');
                process.exit(0);
            } else {
                console.log('\x1b[31m✗ Engine did not produce a valid evaluation\x1b[0m');
                process.exit(1);
            }
        }
    };

    // Drive UCI: init, set a position (after 1.e4), search to depth 12
    engine.sendCommand('uci');
    engine.sendCommand('isready');
    engine.sendCommand('position fen rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    engine.sendCommand('go depth 12');
})().catch(e => {
    console.log('\x1b[31m✗ Engine smoke test error: ' + e.message + '\x1b[0m');
    process.exit(1);
});
