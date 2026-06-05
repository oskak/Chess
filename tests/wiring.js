/**
 * DOM wiring audit — catches the class of bug where JS references a DOM id
 * that doesn't exist in index.html (silent broken features / dead buttons).
 *
 * Run: node tests/wiring.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

const dom = new JSDOM(html);
const doc = dom.window.document;

// 1. Collect every id present in the HTML
const htmlIds = new Set();
doc.querySelectorAll('[id]').forEach(el => htmlIds.add(el.id));

// 2. Collect every getElementById('X') referenced in app.js
const getByIdRe = /getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
const referencedIds = new Map(); // id -> count
let m;
while ((m = getByIdRe.exec(appJs)) !== null) {
    if (m[1].includes('${')) continue; // skip dynamic template-literal ids (e.g. view-${viewName})
    referencedIds.set(m[1], (referencedIds.get(m[1]) || 0) + 1);
}

// 3. Ids that are referenced in JS but created dynamically (not in static HTML).
//    These are legitimately absent from index.html — list them so the audit
//    doesn't false-positive.
const dynamicIds = new Set([
    'context-menu',      // created in _showContextMenu
    'toast-message',     // created in _toast
    // Injected via innerHTML in trainer feedback, then bound in the same scope:
    'btn-next-line',
    'btn-retry',
    'btn-show-move',
    'btn-train-again',
    'btn-back-home',
]);

let failed = 0;
const missing = [];
for (const [id, count] of referencedIds) {
    if (!htmlIds.has(id) && !dynamicIds.has(id)) {
        failed++;
        missing.push(`${id} (referenced ${count}×)`);
    }
}

console.log(`\x1b[1mDOM wiring audit\x1b[0m`);
console.log(`  HTML ids: ${htmlIds.size}`);
console.log(`  JS getElementById targets: ${referencedIds.size}`);
console.log(`  Dynamic (whitelisted): ${dynamicIds.size}`);

// 4. Also check addEventListener-style direct id usage via querySelector in app.js
//    for ids (#foo) — lightweight scan.
const qsIdRe = /querySelector(?:All)?\(\s*['"`]#([A-Za-z0-9_-]+)['"`]/g;
const qsMissing = [];
while ((m = qsIdRe.exec(appJs)) !== null) {
    const id = m[1];
    if (!htmlIds.has(id) && !dynamicIds.has(id)) qsMissing.push(id);
}

console.log(`\n${'='.repeat(50)}`);
if (missing.length === 0 && qsMissing.length === 0) {
    console.log(`\x1b[32m✓ All ${referencedIds.size} referenced DOM ids exist in index.html\x1b[0m`);
    process.exit(0);
} else {
    if (missing.length) {
        console.log(`\x1b[31m✗ ${missing.length} getElementById target(s) missing from HTML:\x1b[0m`);
        missing.forEach(x => console.log('  \x1b[31m✗\x1b[0m ' + x));
    }
    if (qsMissing.length) {
        console.log(`\x1b[31m✗ ${qsMissing.length} querySelector(#id) target(s) missing:\x1b[0m`);
        qsMissing.forEach(x => console.log('  \x1b[31m✗\x1b[0m #' + x));
    }
    process.exit(1);
}
