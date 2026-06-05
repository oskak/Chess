/**
 * Test harness: loads the app's browser-style JS modules into Node
 * by running them in a shared VM context with browser globals shimmed.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Chess } = require('../vendor/chess.min.js');

// fake-indexeddb for DB tests
require('fake-indexeddb/auto');

const ROOT = path.join(__dirname, '..');

// Minimal DOM shim for the few things non-app modules touch (escapeHtml etc.)
const documentShim = {
    createElement() {
        return {
            _text: '',
            set textContent(v) { this._text = String(v); },
            get textContent() { return this._text; },
            get innerHTML() {
                return this._text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
            },
            set innerHTML(v) { this._text = v; },
            getContext() { return null; }, // forces figurine fallback path if ever called
        };
    },
};

// Build a shared sandbox where window === sandbox
const sandbox = {};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.Chess = Chess;
sandbox.indexedDB = indexedDB;
sandbox.IDBKeyRange = IDBKeyRange;
sandbox.console = console;
sandbox.document = documentShim;
sandbox.navigator = {
    storage: {
        estimate: async () => ({ usage: 1024 * 1024, quota: 100 * 1024 * 1024 }),
        persist: async () => true,
        persisted: async () => true,
    },
};
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.performance = { now: () => Date.now() };
vm.createContext(sandbox);

function load(relPath) {
    const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    vm.runInContext(src, sandbox, { filename: relPath });
}

// Load in dependency order
load('js/move-tree.js');
load('js/pgn-parser.js');
load('js/trainer.js');
load('js/eco.js');
load('js/engine.js');
load('js/db.js');
load('js/sounds.js');

// ---- tiny assertion framework ----
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) { passed++; }
    else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
function section(title) { console.log('\n\x1b[1m' + title + '\x1b[0m'); }
function report() {
    console.log(`\n${'='.repeat(50)}`);
    if (failed === 0) {
        console.log(`\x1b[32m✓ ALL ${passed} CHECKS PASSED\x1b[0m`);
    } else {
        console.log(`\x1b[31m✗ ${failed} FAILED\x1b[0m, ${passed} passed`);
        failures.forEach(f => console.log('  \x1b[31m✗\x1b[0m ' + f));
    }
    return failed;
}

module.exports = { sandbox, Chess, check, section, report };
