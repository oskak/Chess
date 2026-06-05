/**
 * Boot test — actually instantiates the full App in jsdom with the real
 * vendor libraries (jQuery, chessboard.js, chess.js) and runs init().
 * Catches runtime errors that break the app at startup (board not showing, etc.)
 *
 * Run: node tests/boot.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const FDBFactory = require('fake-indexeddb/lib/FDBFactory');
const FDBKeyRange = require('fake-indexeddb/lib/FDBKeyRange');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Capture console errors from inside the page
const pageErrors = [];
// jsdom lacks some browser APIs (canvas, layout). These specific "Not
// implemented" notices are jsdom limitations, NOT app bugs — ignore them.
const BENIGN = [/Not implemented: HTMLCanvasElement/, /Not implemented: window\.scroll/, /Could not parse CSS/];
const isBenign = (msg) => BENIGN.some(re => re.test(msg));
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
    const msg = (e.detail && e.detail.message) || e.message || String(e);
    if (!isBenign(msg)) pageErrors.push('jsdomError: ' + msg);
});
vc.on('error', (...a) => {
    const msg = a.join(' ');
    if (!isBenign(msg)) pageErrors.push('console.error: ' + msg);
});

const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
});
const { window } = dom;

// --- shim browser APIs jsdom lacks ---
window.indexedDB = new FDBFactory();
window.IDBKeyRange = FDBKeyRange;
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
// Worker is only used when the engine is toggled (not at boot); provide a stub
window.Worker = class { constructor() {} postMessage() {} terminate() {} addEventListener() {} };
window.AudioContext = class { constructor() {} createOscillator() { return { connect(){}, start(){}, stop(){}, frequency:{} }; } createGain() { return { connect(){}, gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} } }; } get destination(){return {};} get currentTime(){return 0;} };
window.webkitAudioContext = window.AudioContext;
if (!window.navigator.storage) {
    Object.defineProperty(window.navigator, 'storage', {
        value: {
            estimate: async () => ({ usage: 1048576, quota: 104857600 }),
            persist: async () => true,
            persisted: async () => true,
        }, configurable: true,
    });
}

function run(relPath) {
    const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    try {
        window.eval(src);
    } catch (e) {
        pageErrors.push(`Error loading ${relPath}: ${e.message}`);
    }
}

// Load exactly what index.html loads, in order
[
    'vendor/jquery-3.7.1.min.js',
    'vendor/chessboard-1.0.0.min.js',
    'vendor/chess.min.js',
    'js/sounds.js',
    'js/pieces.js',
    'js/eco.js',
    'js/engine.js',
    'js/move-tree.js',
    'js/pgn-parser.js',
    'js/trainer.js',
    'js/db.js',
    'js/app.js',
    // NOTE: js/pgn-worker.js is intentionally excluded — it's a Web Worker
    // script (uses importScripts) loaded via new Worker(), not a page script.
].forEach(run);

(async () => {
    let bootOk = true;
    let boardHasContent = false;
    let appExists = false;

    try {
        // chess.min.js exports Chess via CommonJS-style; ensure global for app
        if (typeof window.Chess === 'undefined' && typeof window.exports === 'object' && window.exports.Chess) {
            window.Chess = window.exports.Chess;
        }
        appExists = typeof window.App === 'function';
        if (!appExists) throw new Error('App class not defined after loading js/app.js');

        window.app = new window.App();
        await window.app.init();

        // Did the board element get populated by chessboard.js?
        const boardEl = window.document.getElementById('board');
        boardHasContent = boardEl && boardEl.children.length > 0;
    } catch (e) {
        bootOk = false;
        pageErrors.push('Boot error: ' + e.message + '\n' + (e.stack || ''));
    }

    console.log('\x1b[1mBoot test\x1b[0m');
    console.log('  App class defined:        ' + (appExists ? '\x1b[32myes\x1b[0m' : '\x1b[31mno\x1b[0m'));
    console.log('  init() completed:         ' + (bootOk ? '\x1b[32myes\x1b[0m' : '\x1b[31mno\x1b[0m'));
    console.log('  board element populated:  ' + (boardHasContent ? '\x1b[32myes\x1b[0m' : '\x1b[33mno (jsdom has no layout)\x1b[0m'));
    console.log('  Chess global available:   ' + (typeof window.Chess === 'function' ? '\x1b[32myes\x1b[0m' : '\x1b[31mno\x1b[0m'));

    console.log(`\n${'='.repeat(50)}`);
    if (bootOk && appExists && pageErrors.length === 0) {
        console.log('\x1b[32m✓ App boots without runtime errors\x1b[0m');
        process.exit(0);
    } else {
        console.log(`\x1b[31m✗ Boot problems (${pageErrors.length}):\x1b[0m`);
        pageErrors.forEach(e => console.log('  \x1b[31m✗\x1b[0m ' + e.split('\n')[0]));
        // print first full stack for debugging
        if (pageErrors.length) console.log('\n' + pageErrors[0]);
        process.exit(1);
    }
})();
