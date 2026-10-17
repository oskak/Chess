/**
 * Electron smoke test: launches the desktop app exactly like `npm start`
 * (file:// page, Electron's Chromium) and checks the features that used to
 * break there — window.prompt() is unsupported in Electron, and the
 * Stockfish worker/WASM must load from file:// URLs.
 *
 * Run (Linux needs a display): xvfb-run -a node tests/electron-e2e.js
 */
const path = require('path');

let _electron, electronPath;
try {
    ({ _electron } = require('playwright'));
} catch (e) {
    try {
        ({ _electron } = require('/opt/node-tools/node_modules/playwright'));
    } catch (e2) {
        console.log('\x1b[33m⊘ playwright not installed — skipping Electron test\x1b[0m');
        process.exit(0);
    }
}
try {
    electronPath = require('electron'); // the electron package exports the binary path
} catch (e) {
    console.log('\x1b[33m⊘ electron not installed — skipping Electron test\x1b[0m');
    process.exit(0);
}

let passed = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) passed++;
    else failures.push(`${name}${detail !== undefined ? ' — ' + detail : ''}`);
    console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${!cond && detail !== undefined ? ' — ' + detail : ''}`);
}

(async () => {
    const ROOT = path.join(__dirname, '..');
    const app = await _electron.launch({
        executablePath: electronPath,
        args: ['--no-sandbox', ROOT],
        cwd: ROOT
    });
    const errors = [];
    try {
        const win = await app.firstWindow();
        win.on('pageerror', e => errors.push(e.message));
        win.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
        await win.waitForFunction(() => window.app && document.querySelector('#welcome-content').children.length > 0, null, { timeout: 30000 });

        console.log('\x1b[1mElectron desktop app\x1b[0m');
        check('loads from file://', win.url().startsWith('file://'), win.url());

        // New repertoire through the in-app dialog (prompt() is unsupported in Electron).
        // Electron keeps its IndexedDB between runs, so compare counts.
        const before = await win.evaluate(async () => (await app.db.listRepertoires()).length);
        const name = 'Desktop test ' + Date.now();
        await win.click('#btn-new-repertoire');
        await win.waitForSelector('.modal input[data-name="name"]', { timeout: 5000 });
        await win.fill('.modal input[data-name="name"]', name);
        await win.click('.modal .btn-primary');
        await win.waitForSelector('#explorer-panel', { state: 'visible' });
        const after = await win.evaluate(async () => (await app.db.listRepertoires()).length);
        check('"New Repertoire" works in Electron', after === before + 1 && await win.evaluate(n => app.currentTree.name === n, name),
            `${before} -> ${after}`);

        // Stockfish from file:// (the on/off preference persists between runs)
        await win.waitForTimeout(300);
        if (!(await win.isChecked('#engine-toggle'))) await win.click('.engine-head .switch');
        await win.waitForFunction(() => /depth \d+/.test(document.getElementById('engine-depth').textContent)
            || /could not start/.test(document.getElementById('engine-lines').textContent), null, { timeout: 60000 });
        const depth = await win.textContent('#engine-depth');
        check('Stockfish 18 runs from file://', /depth \d+/.test(depth), await win.textContent('#engine-lines'));
        check('engine name reported', /Stockfish 18/.test(await win.textContent('#engine-name-label')));

        // Build a move with click-to-move in edit mode
        await win.click('#board .square-e2');
        await win.click('#board .square-e4');
        await win.waitForTimeout(300);
        check('click-to-move adds a move in edit mode', await win.evaluate(() => !!app.currentTree.getNodeAt(['e4'])));

        // Clean up the test repertoire so repeated runs don't pile up data
        await win.evaluate(async () => { await app.db.deleteRepertoire(app.currentRepertoireId); });
    } catch (e) {
        failures.push('crashed: ' + (e.stack || e.message));
    } finally {
        const real = errors.filter(e => !/Persistent storage|Electron Security Warning/i.test(e));
        check('no page errors', real.length === 0, real.join(' | '));
        await app.close();
    }

    console.log(`\n${'='.repeat(50)}`);
    if (failures.length === 0) {
        console.log(`\x1b[32m✓ ELECTRON: ALL ${passed} CHECKS PASSED\x1b[0m`);
        process.exit(0);
    }
    console.log(`\x1b[31m✗ ELECTRON: ${failures.length} FAILED\x1b[0m`);
    failures.forEach(f => console.log('  \x1b[31m✗\x1b[0m ' + f));
    process.exit(1);
})();
