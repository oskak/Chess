/**
 * End-to-end test in a real browser (Chromium via Playwright).
 *
 * Serves the app over HTTP and drives it like a user: loads the sample
 * repertoires, learns and reviews lines, uses the explorer (edit mode, notes,
 * navigation), the engine, the sandbox (promotion dialog, checks) and checks
 * the mobile layout. Fails on any page error.
 *
 * Run: node tests/e2e.js            (headless)
 *      HEADED=1 node tests/e2e.js   (watch it)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
    ({ chromium } = require('playwright'));
} catch (e) {
    try {
        ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
    } catch (e2) {
        console.log('\x1b[33m⊘ playwright not installed — skipping e2e test (npm i -D playwright)\x1b[0m');
        process.exit(0);
    }
}

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.E2E_SHOTS || null; // directory for screenshots (optional)
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

// ---- tiny assertion framework ----
let passed = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) passed++;
    else failures.push(`${name}${detail !== undefined ? ' — ' + detail : ''}`);
    console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${!cond && detail !== undefined ? ' — ' + detail : ''}`);
}
const section = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');

function startServer() {
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const f = path.join(ROOT, p);
        if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
            res.writeHead(404);
            return res.end('not found');
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        fs.createReadStream(f).pipe(res);
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
    const server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({ headless: !process.env.HEADED });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
    page.on('dialog', d => { pageErrors.push('native dialog used: ' + d.message()); d.dismiss(); });

    const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
    const sq = async (s) => {
        const b = await page.locator(`#board .square-${s}`).boundingBox();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const drag = async (from, to) => {
        const a = await sq(from), b = await sq(to);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
        await page.mouse.move(b.x, b.y, { steps: 4 });
        await page.mouse.up();
        await page.waitForTimeout(200);
    };
    const tap = async (from, to) => {
        await page.click(`#board .square-${from}`);
        await page.click(`#board .square-${to}`);
        await page.waitForTimeout(200);
    };
    const fen = () => page.evaluate(() => app.chess.fen());
    const arrows = () => page.locator('#board svg.board-overlay line').count();
    /** squares of the trainer's expected move */
    const expected = () => page.evaluate(() => app.trainer && app.trainer.getExpectedMove());
    /** Play the current training line to its end, following the expected moves. */
    const playTrainingLine = async ({ useTap = false, missAt = -1 } = {}) => {
        let playerMoves = 0;
        for (let guard = 0; guard < 80; guard++) {
            const st = await page.evaluate(() => ({
                done: !app.trainer || !app.trainer.currentLine || app.trainer.lineCompleted,
                mine: app.trainer && app.trainer.isPlayerMove()
            }));
            if (st.done) return playerMoves;
            if (!st.mine) { await page.waitForTimeout(150); continue; }
            if (playerMoves === missAt) {
                // play a legal move that is not the expected one
                const wrong = await page.evaluate(() => {
                    const exp = app.trainer.getExpectedMove();
                    const kids = [...app.trainer.currentNode.children.keys()];
                    const m = app.chess.moves({ verbose: true }).find(x => x.san !== exp.san && !kids.includes(x.san));
                    return m && { from: m.from, to: m.to };
                });
                await drag(wrong.from, wrong.to);
                missAt = -1;
                continue;
            }
            const exp = await expected();
            if (useTap) await tap(exp.from, exp.to);
            else await drag(exp.from, exp.to);
            playerMoves++;
        }
        return playerMoves;
    };

    try {
        await page.goto(url);
        await page.waitForFunction(() => window.app && document.querySelector('#welcome-content').children.length > 0);

        // ------------------------------------------------------------------
        section('1. First run: onboarding + sample repertoires');
        check('onboarding shown for an empty app', await page.locator('.welcome-hero').count() === 1);
        await shot('01-welcome');
        await page.click('[data-action="samples"]');
        await page.waitForSelector('.sidebar-item');
        check('two sample repertoires loaded', await page.locator('.sidebar-item').count() === 2);
        check('sidebar shows "new lines" badges', await page.locator('.sidebar-item .badge-new').count() === 2);
        check('dashboard cards rendered', await page.locator('.rep-card').count() === 2);
        await shot('02-dashboard');

        // ------------------------------------------------------------------
        section('2. Learning a new line (arrows + click-to-move)');
        await page.click('.sidebar-item:has-text("Italian")');
        await page.waitForSelector('#trainer-panel', { state: 'visible' });
        await page.waitForTimeout(300);
        check('trainer opens on a repertoire with lines', await page.isVisible('#trainer-panel'));
        check('first line is in learning mode', await page.evaluate(() => app.trainer.isLearning));
        check('prompt explains what to do', /New line/.test(await page.textContent('#trainer-prompt')));
        check('learning arrow drawn on the board', await arrows() >= 1);
        await shot('03-learn');
        await playTrainingLine({ useTap: true });
        await page.waitForTimeout(250);
        check('line learned message', /learned/i.test(await page.textContent('#trainer-feedback')));
        const learned = await page.evaluate(() => {
            const t = app.trainer.completedLines[0];
            const leaf = app.currentTree.getNodeAt(t.line);
            return { learned: t.learned, last: leaf.stats.lastReviewed, next: leaf.stats.nextReview };
        });
        check('learned line scheduled ~4h ahead', learned.learned && learned.next - learned.last === 4 * 3600 * 1000, JSON.stringify(learned));
        // persisted to IndexedDB?
        await page.waitForTimeout(300);
        const persisted = await page.evaluate(async () => {
            const t = await app.db.loadRepertoire(app.currentRepertoireId);
            return t.getStatsOverview().reviewed;
        });
        check('progress saved to IndexedDB right away', persisted >= 1, String(persisted));
        await shot('04-learned');

        // ------------------------------------------------------------------
        section('3. Review with a mistake (graded, repeated, per-move stats)');
        await page.evaluate(async () => {
            // Make every learned line due now, then train "Due only"
            app.currentTree._traverse(app.currentTree.root, n => {
                if (n.isLeaf() && n.stats.lastReviewed) n.stats.nextReview = Date.now() - 1000;
            });
            await app._saveCurrentRepertoire();
            document.getElementById('train-mode').value = 'review';
            document.getElementById('train-mode').dispatchEvent(new Event('change'));
        });
        await page.waitForTimeout(400);
        check('due line is tested (not learned)', await page.evaluate(() => app.trainer.currentLine && !app.trainer.isLearning));
        await playTrainingLine({ missAt: 1 });
        await page.waitForTimeout(250);
        const review = await page.evaluate(() => ({
            mistakes: app.trainer.lineMistakes,
            queue: app.trainer.lineQueue.length,
            feedback: document.getElementById('trainer-feedback').innerText,
            streak: app.currentTree.getNodeAt(app.trainer.currentLine).stats.streak
        }));
        check('mistake recorded for the line', review.mistakes === 1, JSON.stringify(review));
        check('failed line queued again this session', review.queue === 1, String(review.queue));
        check('completion message mentions the repeat', /repeated/.test(review.feedback), review.feedback);
        check('failed review resets the streak', review.streak === 0);
        const weak = await page.evaluate(() => app.currentTree.getWeakestMoves(5, 1).length);
        check('missed move shows up as a weak spot', weak >= 1, String(weak));
        // Show move: arrow appears, user plays it
        await page.click('[data-action="next-line"]');
        await page.waitForTimeout(600);
        if (await page.evaluate(() => app.trainer.isPlayerMove())) {
            await page.click('#btn-show-move');
            check('"Show move" draws an arrow', await arrows() >= 1);
            const exp = await expected();
            await drag(exp.from, exp.to);
            check('arrowed move accepted', await page.evaluate(() => !app.trainerArrow));
        }
        await shot('05-review');

        // ------------------------------------------------------------------
        section('4. Explorer: arrows, navigation, edit mode, notes');
        await page.click('#tab-explore');
        await page.waitForSelector('#explorer-panel', { state: 'visible' });
        await page.waitForTimeout(250);
        check('repertoire continuation listed', await page.locator('.explorer-child[data-move="e4"]').count() === 1);
        check('repertoire move drawn as an arrow', await arrows() === 1, String(await arrows()));
        await page.click('.explorer-child[data-move="e4"]');
        await page.waitForTimeout(200);
        check('opponent replies listed after 1.e4', await page.locator('.explorer-child').count() >= 3);
        check('opening name shown', /King's Pawn/.test(await page.textContent('#explorer-opening')));
        await page.keyboard.press('ArrowLeft');
        check('← steps back', (await fen()).startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP'));
        await page.keyboard.press('ArrowRight');
        check('→ steps forward', (await fen()).includes('4P3'));
        await page.keyboard.press('End');
        const endPly = await page.evaluate(() => app.explorerMoveStack.length);
        check('End follows the mainline', endPly >= 10, String(endPly));
        await page.keyboard.press('Home');
        check('Home returns to start', await page.evaluate(() => app.explorerMoveStack.length) === 0);

        // Off-book without edit mode → offered to add
        await drag('d2', 'd4');
        check('off-book move is not added silently', await page.evaluate(() => app.currentTree.getNodeAt(['d4']) === null));
        check('off-book panel offers to add the line', await page.locator('[data-action="add-line"]').count() === 1);
        // Edit mode adds moves
        await page.click('#btn-edit-mode');
        await drag('d7', 'd5');
        check('edit mode adds the line', await page.evaluate(() => !!app.currentTree.getNodeAt(['d4', 'd5'])));
        // Notes
        await page.fill('#note-text', 'Queen pawn test note');
        await page.locator('#note-text').blur();
        await page.waitForTimeout(150);
        check('note saved on the node', await page.evaluate(() => app.currentTree.getNodeAt(['d4', 'd5']).comment === 'Queen pawn test note'));
        await page.click('.nag-btn[data-nag="5"]');
        check('NAG toggled on the node', await page.evaluate(() => app.currentTree.getNodeAt(['d4', 'd5']).nags.includes(5)));
        await page.waitForTimeout(600);
        const savedNote = await page.evaluate(async () => {
            const t = await app.db.loadRepertoire(app.currentRepertoireId);
            const n = t.getNodeAt(['d4', 'd5']);
            return n && n.comment;
        });
        check('note persisted', savedNote === 'Queen pawn test note', String(savedNote));
        await page.click('#btn-edit-mode');
        await shot('06-explorer');

        // ------------------------------------------------------------------
        section('5. Engine (Stockfish 18 in a Web Worker)');
        await page.keyboard.press('Home');
        await page.click('.engine-head .switch');
        await page.waitForFunction(() => /depth (1[0-9]|2\d)/.test(document.getElementById('engine-depth').textContent), null, { timeout: 60000 });
        check('engine reports its name', /Stockfish 18/.test(await page.textContent('#engine-name-label')));
        check('start position: White is better (+)', (await page.textContent('#engine-score')).startsWith('+'));
        check('eval gauge visible', await page.isVisible('#eval-gauge'));
        check('MultiPV: several engine lines', await page.locator('.engine-line').count() >= 2);
        await page.click('.explorer-child[data-move="e4"]');
        await page.waitForFunction(() => /depth (1[0-9]|2\d)/.test(document.getElementById('engine-depth').textContent), null, { timeout: 60000 });
        const scoreAfterE4 = await page.textContent('#engine-score');
        check('after 1.e4 (Black to move) White is still better', scoreAfterE4.startsWith('+'), scoreAfterE4);
        check('engine best move arrow drawn', await page.evaluate(() =>
            [...document.querySelectorAll('#board svg.board-overlay line')].some(l => l.getAttribute('stroke') === BoardOverlay.COLORS.blue)));
        const before = await page.evaluate(() => app.explorerMoveStack.length);
        await page.click('.engine-line >> nth=0');
        await page.waitForTimeout(250);
        check('clicking an engine line plays its move', await page.evaluate(() => app.explorerMoveStack.length) === before + 1);
        await shot('07-engine');

        // ------------------------------------------------------------------
        section('6. Sandbox: promotion dialog, checks, FEN');
        await page.click('#btn-sandbox');
        await page.waitForSelector('#sandbox-panel', { state: 'visible' });
        await page.fill('#sandbox-fen-input', '8/P7/8/8/8/8/k7/7K w - - 0 1');
        await page.press('#sandbox-fen-input', 'Enter');
        await page.waitForTimeout(250);
        await drag('a7', 'a8');
        await page.waitForSelector('.modal-promotion', { timeout: 3000 });
        check('graphical promotion picker opens', await page.locator('.promo-choice').count() === 4);
        await page.click('.promo-choice[data-piece="n"]');
        await page.waitForTimeout(250);
        check('underpromotion to a knight', (await fen()).startsWith('N7/'), await fen());
        await shot('08-sandbox-promo');
        await page.fill('#sandbox-fen-input', '4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
        await page.press('#sandbox-fen-input', 'Enter');
        await page.waitForTimeout(200);
        await drag('a1', 'a8');
        check('giving check works (no error)', await page.evaluate(() => app.chess.in_check()));
        await page.click('#btn-sandbox-save-rep');
        await page.waitForSelector('.modal');
        check('saving a custom-FEN line is explained, not attempted', /custom position/.test(await page.textContent('.modal')));
        await page.keyboard.press('Escape');

        // ------------------------------------------------------------------
        section('7. New repertoire dialog (no window.prompt)');
        await page.click('#btn-new-repertoire');
        await page.waitForSelector('.modal input[data-name="name"]');
        await page.fill('.modal input[data-name="name"]', 'E2E Black');
        await page.click('.modal .segment[data-value="black"]');
        await page.click('.modal .btn-primary');
        await page.waitForSelector('#explorer-panel', { state: 'visible' });
        await page.waitForTimeout(250);
        check('new repertoire created as Black', await page.evaluate(() => app.currentTree.name === 'E2E Black' && app.currentTree.color === 'black'));
        check('edit mode on for a new repertoire', await page.evaluate(() => app.editMode));
        check('board oriented for Black', await page.evaluate(() => app.boardOrientation === 'black'));

        // ------------------------------------------------------------------
        section('8. Mobile layout (390 px)');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(500);
        const layout = await page.evaluate(() => ({
            scrollW: document.querySelector('.workspace-grid').scrollWidth,
            clientW: document.querySelector('.workspace-grid').clientWidth,
            boardRight: document.querySelector('#board .board-b72b1').getBoundingClientRect().right
        }));
        check('no horizontal overflow on mobile', layout.scrollW <= layout.clientW + 1, JSON.stringify(layout));
        check('board fits the screen', layout.boardRight <= 390, JSON.stringify(layout));
        await shot('09-mobile');
    } catch (e) {
        failures.push('E2E crashed: ' + (e.stack || e.message));
        console.log('\x1b[31m' + (e.stack || e.message) + '\x1b[0m');
        await shot('crash');
    }

    // ------------------------------------------------------------------
    section('9. Installable & offline (service worker)');
    try {
        const ctx2 = await browser.newContext();
        const p2 = await ctx2.newPage();
        p2.on('pageerror', e => pageErrors.push('offline page: ' + e.message));
        await p2.goto(url);
        await p2.waitForFunction(() => window.app, null, { timeout: 15000 });
        const swReady = await p2.evaluate(async () => {
            if (!navigator.serviceWorker) return false;
            await navigator.serviceWorker.ready;
            return true;
        });
        check('service worker registered', swReady);
        const manifest = await p2.evaluate(async () => (await fetch('manifest.webmanifest')).json());
        check('web app manifest with icons', manifest.display === 'standalone' && manifest.icons.length >= 2);
        await p2.reload(); // now controlled by the service worker
        await p2.waitForFunction(() => window.app, null, { timeout: 15000 });
        await ctx2.setOffline(true);
        await p2.reload();
        const offlineOk = await p2.waitForFunction(() => window.app && document.querySelector('#welcome-content').children.length > 0, null, { timeout: 15000 })
            .then(() => true).catch(() => false);
        check('app loads while offline', offlineOk);
        await ctx2.setOffline(false);
        await ctx2.close();
    } catch (e) {
        check('offline test ran', false, e.message);
    }

    section('Page errors');
    const realErrors = pageErrors.filter(e => !/Persistent storage/i.test(e));
    check('no page errors or native dialogs', realErrors.length === 0, realErrors.join(' | '));

    await browser.close();
    server.close();

    console.log(`\n${'='.repeat(50)}`);
    if (failures.length === 0) {
        console.log(`\x1b[32m✓ E2E: ALL ${passed} CHECKS PASSED\x1b[0m`);
        process.exit(0);
    }
    console.log(`\x1b[31m✗ E2E: ${failures.length} FAILED\x1b[0m, ${passed} passed`);
    failures.forEach(f => console.log('  \x1b[31m✗\x1b[0m ' + f));
    process.exit(1);
})();
