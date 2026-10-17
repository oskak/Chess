/**
 * Functional test suite — exercises real app logic in Node.
 * Run: node tests/run.js
 */
const { sandbox, Chess, check, section, report } = require('./harness');
const { MoveTree, MoveTreeNode, Trainer, PGNParser, lookupECO, ChessEngine, RepertoireDB } = sandbox;

// position FEN helper (first 4 fields, matches what the app stores)
const posFen = (chess) => chess.fen().split(' ').slice(0, 4).join(' ');

// ============================================================
section('1. MoveTree — structure & navigation');
// ============================================================
{
    const t = new MoveTree('Test', 'white');
    check('MoveTree constructs', t && t.root, 'no root');

    // addLine
    t.addLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    const node = t.getNodeAt(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    check('addLine + getNodeAt reaches Bb5', node && node.move === 'Bb5', node ? node.move : 'null');

    // a second line that branches
    t.addLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
    const root = t.root;
    const e4 = root.getChild('e4');
    const e5 = e4.getChild('e5');
    const nf3 = e5.getChild('Nf3');
    const nc6 = nf3.getChild('Nc6');
    check('branch creates 2 children at Nc6', nc6.children.size === 2, 'size=' + nc6.children.size);

    // getNodeAt on missing path returns null
    check('getNodeAt missing → null', t.getNodeAt(['d4', 'd5']) === null);
}

// ============================================================
section('2. MoveTree — serialize / deserialize round-trip');
// ============================================================
{
    const t = new MoveTree('RoundTrip', 'black');
    t.addLine(['d4', 'Nf6', 'c4', 'e6']);
    const n = t.getNodeAt(['d4', 'Nf6']);
    n.comment = 'Indian defense — flexible';
    n.nags = [1]; // !
    n.priority = 0;
    n.stats.attempts = 5;
    n.stats.correct = 4;
    n.stats.streak = 3;
    n.stats.ease = 2.6;
    n.stats.interval = 6;
    n.stats.lastReviewed = 1700000000000;
    n.stats.nextReview = 1700500000000;
    // disable + collapse another node
    const e6 = t.getNodeAt(['d4', 'Nf6', 'c4', 'e6']);
    e6.enabled = false;
    e6.collapsed = true;

    const serialized = t.serialize();
    const json = JSON.parse(JSON.stringify(serialized)); // simulate storage
    const t2 = MoveTree.deserialize(json);

    check('deserialize name', t2.name === 'RoundTrip', t2.name);
    check('deserialize color', t2.color === 'black', t2.color);
    const n2 = t2.getNodeAt(['d4', 'Nf6']);
    check('comment survives', n2 && n2.comment === 'Indian defense — flexible', n2 && n2.comment);
    check('nags survive', n2 && JSON.stringify(n2.nags) === '[1]', n2 && JSON.stringify(n2.nags));
    check('stats.attempts survives', n2 && n2.stats.attempts === 5, n2 && n2.stats.attempts);
    check('stats.correct survives', n2 && n2.stats.correct === 4);
    check('stats.streak survives', n2 && n2.stats.streak === 3);
    check('stats.ease survives', n2 && Math.abs(n2.stats.ease - 2.6) < 1e-9, n2 && n2.stats.ease);
    check('stats.lastReviewed survives', n2 && n2.stats.lastReviewed === 1700000000000);
    const e6b = t2.getNodeAt(['d4', 'Nf6', 'c4', 'e6']);
    check('enabled=false survives', e6b && e6b.enabled === false, e6b && String(e6b.enabled));
    check('collapsed=true survives', e6b && e6b.collapsed === true, e6b && String(e6b.collapsed));
}

// ============================================================
section('3. MoveTree — manipulation (toggle/delete/mainline)');
// ============================================================
{
    const t = new MoveTree('Manip', 'white');
    t.addLine(['e4', 'c5', 'Nf3']);
    t.addLine(['e4', 'e5', 'Nf3']);
    t.addLine(['e4', 'c6', 'd4']);
    const e4 = t.getNodeAt(['e4']);

    // setMainline: make c6 the mainline
    const c6 = t.getNodeAt(['e4', 'c6']);
    t.setMainline(c6);
    check('setMainline sets priority 0', c6.priority === 0, 'prio=' + c6.priority);
    const others = [...e4.children.values()].filter(n => n !== c6);
    check('setMainline bumps siblings', others.every(n => n.priority > 0), others.map(n => n.priority).join(','));

    // toggleEnabled with propagation
    t.toggleEnabled(c6, true);
    check('toggleEnabled disables node', c6.enabled === false);
    const d4 = t.getNodeAt(['e4', 'c6', 'd4']);
    check('toggleEnabled propagates to child', d4.enabled === false, String(d4.enabled));

    // deleteSubtree
    const before = e4.children.size;
    t.deleteSubtree(c6);
    check('deleteSubtree removes branch', e4.children.size === before - 1, `${e4.children.size} vs ${before-1}`);
    check('deleted node gone from getNodeAt', t.getNodeAt(['e4', 'c6']) === null);
}

// ============================================================
section('4. MoveTree — transposition detection');
// ============================================================
{
    // Two move orders reaching the same position:
    // 1.e4 e6 2.d4 d5  vs  1.d4 d5 2.e4 e6  → same position
    const t = new MoveTree('Trans', 'white');
    t.addLine(['e4', 'e6', 'd4', 'd5']);
    t.addLine(['d4', 'd5', 'e4', 'e6']);
    t.rebuildPositionIndex();

    const n1 = t.getNodeAt(['e4', 'e6', 'd4', 'd5']);
    const n2 = t.getNodeAt(['d4', 'd5', 'e4', 'e6']);
    check('both transposition nodes exist', n1 && n2);
    check('addLine computed a FEN', n1 && !!n1.fen, 'fen is ' + (n1 && n1.fen));
    check('node1 flagged transposition', n1 && n1.isTransposition === true, n1 && String(n1.isTransposition));
    check('node2 flagged transposition', n2 && n2.isTransposition === true, n2 && String(n2.isTransposition));
    check('same non-empty FEN for both paths', n1 && n2 && n1.fen && n1.fen === n2.fen, `${n1&&n1.fen} vs ${n2&&n2.fen}`);
}

// ============================================================
section('5. MoveTree — accuracy helper');
// ============================================================
{
    const t = new MoveTree('Acc', 'white');
    t.addLine(['e4']);
    const e4 = t.getNodeAt(['e4']);
    check('accuracy null when no attempts', MoveTree.getNodeAccuracy(e4) === null);
    e4.stats.attempts = 4; e4.stats.correct = 3;
    check('accuracy = 75%', MoveTree.getNodeAccuracy(e4) === 75, String(MoveTree.getNodeAccuracy(e4)));
}

// ============================================================
section('6. PGNParser — parse & export');
// ============================================================
{
    const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4 Bc5) a6 4. Ba4 Nf6';
    let tree;
    try {
        tree = PGNParser.parse(pgn, { repertoireName: 'Parsed', color: 'white' })[0];
    } catch (e) {
        check('PGNParser.parse runs', false, e.message);
    }
    if (tree) {
        check('parse builds tree', tree.root.hasChildren());
        check('mainline reaches Nf6', !!tree.getNodeAt(['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6']),
            'mainline missing');
        check('variation Bc4 present', !!tree.getNodeAt(['e4','e5','Nf3','Nc6','Bc4']),
            'variation missing');

        // export should produce a string containing the moves
        try {
            const out = PGNParser.export(tree);
            check('export produces PGN text', typeof out === 'string' && out.includes('Nf3'), 'no Nf3 in export');
        } catch (e) {
            check('PGNParser.export runs', false, e.message);
        }
    }
}

// ============================================================
section('7. PGNParser — comments & NAGs');
// ============================================================
{
    const pgn = '1. e4 {King pawn} e5 2. Nf3!';
    let tree;
    try { tree = PGNParser.parse(pgn, { repertoireName: 'C', color: 'white' })[0]; }
    catch (e) { check('parse w/ comment runs', false, e.message); }
    if (tree) {
        const e4 = tree.getNodeAt(['e4']);
        check('comment captured', e4 && e4.comment && e4.comment.includes('King'), e4 && e4.comment);
        const nf3 = tree.getNodeAt(['e4', 'e5', 'Nf3']);
        check('NAG captured on Nf3', nf3 && nf3.nags && nf3.nags.length > 0, nf3 && JSON.stringify(nf3 && nf3.nags));
    }
}

// ============================================================
section('8. Trainer — queue building & disabled-node skipping');
// ============================================================
{
    const t = new MoveTree('Train', 'white');
    t.addLine(['e4', 'e5', 'Nf3']);   // line A
    t.addLine(['e4', 'c5', 'Nf3']);   // line B
    t.addLine(['d4', 'd5', 'c4']);    // line C

    const trainer = new Trainer(t);
    const lines = [];
    trainer._collectAllLines(t.root, [], lines);
    check('collects 3 lines', lines.length === 3, 'got ' + lines.length);

    // Disable the d4 subtree → its line should be skipped
    const d4 = t.getNodeAt(['d4']);
    d4.enabled = false;
    const lines2 = [];
    trainer._collectAllLines(t.root, [], lines2);
    check('disabled subtree skipped', lines2.length === 2, 'got ' + lines2.length);
    check('remaining lines are e4 lines', lines2.every(l => l[0] === 'e4'), JSON.stringify(lines2.map(l=>l[0])));
}

// ============================================================
section('9. Trainer — move submission & SM-2');
// ============================================================
{
    const t = new MoveTree('Sub', 'white');
    t.addLine(['e4', 'e5', 'Nf3', 'Nc6']);
    const trainer = new Trainer(t);
    const started = trainer.startSession({ mode: 'all', lineLimit: 10 });
    check('startSession returns totalLines', started && started.totalLines >= 1, JSON.stringify(started));

    const first = trainer.nextLine();
    check('nextLine loads a line', first && Array.isArray(first.line), JSON.stringify(first && first.line));
    check('white repertoire: player to move first', trainer.isPlayerMove() === true, String(trainer.isPlayerMove()));

    // Submit e4 via coordinates (e2→e4), as the board does
    const res = trainer.submitMove('e2', 'e4');
    check('correct move accepted', res && res.valid && res.correct === true, JSON.stringify(res));
    // Illegal move rejected
    const illegal = trainer.submitMove('e2', 'e5');
    check('illegal move rejected', illegal && illegal.valid === false, JSON.stringify(illegal));

    // SM-2 update sanity on a node
    const node = t.getNodeAt(['e4']);
    const beforeEase = node.stats.ease;
    trainer._updateSM2(node, 5);
    check('SM-2 correct keeps ease ≥ 1.3', node.stats.ease >= 1.3, String(node.stats.ease));
    check('SM-2 sets nextReview', !!node.stats.nextReview, String(node.stats.nextReview));
    check('SM-2 sets interval ≥ 1 day', node.stats.interval >= 1, String(node.stats.interval));
    trainer._updateSM2(node, 1); // failure resets
    check('SM-2 failure lowers ease', node.stats.ease < beforeEase + 0.2, String(node.stats.ease));
}

// ============================================================
section('10. ECO — every stored FEN is legal & lookup works');
// ============================================================
{
    const db = sandbox.ECO_DATABASE;
    let illegal = 0, firstBad = null;
    for (const key of Object.keys(db)) {
        // key is a 4-field FEN; Chess.js needs full 6 fields
        const full = key + ' 0 1';
        const c = new Chess();
        const ok = c.load(full);
        if (!ok) { illegal++; if (!firstBad) firstBad = key; }
    }
    check('all ECO FENs are legal', illegal === 0, `${illegal} illegal, first: ${firstBad}`);

    // Replay real opening lines and confirm the name matches what we stored.
    const cases = [
        { moves: ['e4','e5','Nf3','Nc6','Bc4'], expect: /Italian|Giuoco/ },
        { moves: ['e4','e5','Nf3','Nc6','Bb5'], expect: /Ruy Lopez/ },
        { moves: ['e4','c5'], expect: /Sicilian/ },
        { moves: ['e4','e6'], expect: /French/ },
        { moves: ['e4','c6'], expect: /Caro-Kann/ },
        { moves: ['d4','d5','c4'], expect: /Queen's Gambit/ },
        { moves: ['d4','Nf6','c4','g6'], expect: /King's Indian/ },
        { moves: ['c4'], expect: /English/ },
        { moves: ['Nf3'], expect: /Réti|Reti/ },
    ];
    for (const tc of cases) {
        const c = new Chess();
        let ok = true;
        for (const m of tc.moves) { if (!c.move(m)) { ok = false; break; } }
        const eco = ok ? lookupECO(c.fen()) : null;
        check(`ECO lookup ${tc.moves.join(' ')}`, eco && tc.expect.test(eco.name),
            eco ? `got "${eco.name}"` : 'no match (FEN mismatch → wrong stored FEN)');
    }
}

// ============================================================
section('11. Engine — pure parsing/formatting helpers');
// ============================================================
{
    const e = new ChessEngine();
    const info = e._parseInfo('info depth 20 seldepth 28 score cp 35 nodes 1000 nps 50000 time 20 pv e2e4 e7e5 g1f3');
    check('parseInfo depth', info && info.depth === 20, info && info.depth);
    check('parseInfo score cp→pawns', info && Math.abs(info.score - 0.35) < 1e-9, info && info.score);
    check('parseInfo pv parsed', info && info.pv[0] === 'e2e4', info && info.pv && info.pv[0]);

    const mateInfo = e._parseInfo('info depth 10 score mate 3 pv e2e4');
    check('parseInfo mate', mateInfo && mateInfo.mate === 3, mateInfo && mateInfo.mate);

    check('formatScore +', ChessEngine.formatScore({ score: 0.45, mate: null }) === '+0.45',
        ChessEngine.formatScore({ score: 0.45, mate: null }));
    check('formatScore mate', ChessEngine.formatScore({ score: 100, mate: 3 }) === '#3',
        ChessEngine.formatScore({ score: 100, mate: 3 }));
    check('formatScore mated', ChessEngine.formatScore({ score: -100, mate: -2 }) === '#-2',
        ChessEngine.formatScore({ score: -100, mate: -2 }));
    check('getBarPercent equal≈50', Math.abs(ChessEngine.getBarPercent({ score: 0, mate: null }) - 50) <= 1);
    check('getBarPercent mate=100', ChessEngine.getBarPercent({ score: 100, mate: 5 }) === 100);

    // uciToSan
    const c = new Chess();
    check('uciToSan e2e4→e4', ChessEngine.uciToSan(c, 'e2e4') === 'e4', ChessEngine.uciToSan(c, 'e2e4'));
    check('uciToSan does not mutate board', c.fen() === new Chess().fen(), c.fen());
}

// ============================================================
section('12. DB — save/load & backup round-trip (fake-indexeddb)');
// ============================================================
(async () => {
    try {
        const db = new RepertoireDB();
        const t = new MoveTree('DBTest', 'white');
        t.addLine(['e4', 'e5']);
        t.getNodeAt(['e4']).stats.attempts = 2;

        const id = await db.saveRepertoire(t);
        check('saveRepertoire returns id', !!id, String(id));

        const loaded = await db.loadRepertoire(id);
        check('loadRepertoire returns tree', loaded && loaded.name === 'DBTest', loaded && loaded.name);
        check('loaded stats preserved', loaded && loaded.getNodeAt(['e4']).stats.attempts === 2,
            loaded && loaded.getNodeAt(['e4']).stats.attempts);

        const list = await db.listRepertoires();
        check('listRepertoires includes saved', list.some(r => r.id === id), 'not in list');

        // backup round trip
        const backup = await db.exportAll();
        check('exportAll has repertoires', backup && backup.repertoires.length >= 1, 'empty backup');
        await db.deleteRepertoire(id);
        const afterDel = await db.listRepertoires();
        check('deleteRepertoire works', !afterDel.some(r => r.id === id), 'still present');

        const imp = await db.importAll(backup, 'merge');
        check('importAll restores', imp.imported >= 1, JSON.stringify(imp));
        const list2 = await db.listRepertoires();
        check('imported repertoire back in list', list2.some(r => r.id === id), 'not restored');
    } catch (e) {
        check('DB suite runs without throwing', false, e.message + '\n' + e.stack);
    }

    // ============================================================
    section('13. Hardening — deserialize survives corrupt data');
    // ============================================================
    {
        // null / non-object input must not throw
        let ok = true;
        try { MoveTree.deserialize(null); MoveTree.deserialize(undefined); MoveTree.deserialize(42); }
        catch (e) { ok = false; }
        check('deserialize(null/garbage) does not throw', ok);

        // missing name/color → defaults
        const t1 = MoveTree.deserialize({ tree: {} });
        check('missing name → default string', typeof t1.name === 'string' && t1.name.length > 0, t1.name);
        check('invalid color → white', t1.color === 'white', t1.color);

        // corrupt stats array (NaN, strings, wrong length, correct>attempts)
        const corrupt = {
            name: 'Corrupt', color: 'white',
            tree: { c: { e4: { s: [NaN, 'x', null, null, -5, 0.1, NaN], c: {} } } }
        };
        let t2;
        try { t2 = MoveTree.deserialize(corrupt); }
        catch (e) { check('deserialize(corrupt stats) does not throw', false, e.message); }
        if (t2) {
            const n = t2.getNodeAt(['e4']);
            check('corrupt stats sanitized to finite', n &&
                Number.isFinite(n.stats.attempts) && Number.isFinite(n.stats.correct) &&
                Number.isFinite(n.stats.ease) && Number.isFinite(n.stats.streak),
                n && JSON.stringify(n.stats));
            check('ease floored to ≥ 1.3', n && n.stats.ease >= 1.3, n && n.stats.ease);
            check('interval not negative', n && n.stats.interval >= 0, n && n.stats.interval);
        }

        // accuracy must never be NaN even with weird stats
        const t3 = MoveTree.deserialize({ name: 'A', color: 'white', tree: { c: { e4: { s: [0, 5, null, null, 0, 2.5, 0] } } } });
        const acc = MoveTree.getNodeAccuracy(t3.getNodeAt(['e4']));
        check('accuracy is null or a finite number', acc === null || Number.isFinite(acc), String(acc));
    }

    // ============================================================
    section('14. Hardening — PGN reports skipped illegal moves');
    // ============================================================
    {
        // "Nf3" after 1.e4 e5 is fine; "Zz9" is illegal and must be counted, not silently dropped
        const tree = PGNParser.parse('1. e4 e5 2. Nf3 Zz9 3. Bb5', { repertoireName: 'Bad', color: 'white' })[0];
        check('valid prefix still imported', !!tree.getNodeAt(['e4', 'e5', 'Nf3']), 'Nf3 missing');
        check('illegal move counted as skipped', (tree._skippedMoves || 0) >= 1, 'skipped=' + tree._skippedMoves);

        // clean PGN reports zero skipped
        const clean = PGNParser.parse('1. e4 e5 2. Nf3 Nc6', { repertoireName: 'Clean', color: 'white' })[0];
        check('clean PGN has no skipped moves', !clean._skippedMoves, 'skipped=' + clean._skippedMoves);
    }

    // ============================================================
    section('15. Hardening — engine watchdog resolves (no hang)');
    // ============================================================
    {
        const eng = new ChessEngine();
        eng.ready = true;                 // pretend initialized
        eng.evalTimeoutMs = 60;           // fast watchdog for the test
        eng._send = () => {};             // worker that never replies
        const start = Date.now();
        const result = await eng.evaluate('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 18);
        const elapsed = Date.now() - start;
        check('evaluate resolves instead of hanging', result === null, JSON.stringify(result));
        check('watchdog fired within reasonable time', elapsed < 2000, elapsed + 'ms');
        check('engine not left in evaluating state', eng.evaluating === false, String(eng.evaluating));
    }

    // ============================================================
    section('16. Trainer — full lines (completion, grading, alternatives, learning)');
    // ============================================================
    {
        // Helper: play the current line to the end. `answer(i, expectedSan)` returns
        // the SAN the player tries at player-move index i (default: the right move).
        const playLine = (trainer, answer = null) => {
            for (let guard = 0; guard < 60 && trainer.currentLine && !trainer.lineCompleted; guard++) {
                if (!trainer.isPlayerMove()) { trainer.playOpponentMove(); continue; }
                const exp = trainer.getExpectedMove();
                const want = answer ? answer(trainer.currentMoveIndex, exp.san) : exp.san;
                const probe = new Chess(trainer.chess.fen());
                const m = probe.move(want, { sloppy: true });
                const r = trainer.submitMove(m.from, m.to, m.promotion);
                if (!r.correct && !r.isAlternative) {
                    // after a miss, play the right move
                    const ok = new Chess(trainer.chess.fen()).move(exp.san, { sloppy: true });
                    trainer.submitMove(ok.from, ok.to, ok.promotion);
                }
            }
        };

        // (a) Line ending on the OPPONENT's move must still be recorded.
        {
            const t = new MoveTree('EndsOnOpponent', 'white');
            t.addLine(['e4', 'e5', 'Nf3', 'Nc6']); // last move is Black's
            const tr = new Trainer(t);
            tr.startSession({ mode: 'all', lineLimit: 5, learnNewLines: false });
            tr.nextLine();
            playLine(tr);
            const leaf = t.getNodeAt(['e4', 'e5', 'Nf3', 'Nc6']);
            check('line ending on opponent move completes', tr.lineCompleted === true);
            check('…and is scheduled (SM-2 attempts=1)', leaf.stats.attempts === 1, 'attempts=' + leaf.stats.attempts);
            check('…session counts it', tr.sessionStats.total === 1, 'total=' + tr.sessionStats.total);
            const p = tr.getProgress();
            check('progress does not double-count the finished line', p.total === 1 && p.completed === 1, JSON.stringify(p));
        }

        // (b) A mistake grades the line as failed and re-queues it once.
        {
            const t = new MoveTree('Mistake', 'white');
            t.addLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
            const leaf = t.getNodeAt(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
            leaf.stats.lastReviewed = Date.now() - 86400000; // already learned
            leaf.stats.nextReview = Date.now() - 1000;        // due
            leaf.stats.streak = 3; leaf.stats.interval = 8; leaf.stats.attempts = 3; leaf.stats.correct = 3;
            const tr = new Trainer(t);
            tr.startSession({ mode: 'review', lineLimit: 5 });
            tr.nextLine();
            check('due line is tested, not learned', tr.isLearning === false);
            playLine(tr, (i, exp) => (exp === 'Nf3' ? 'Nc3' : exp)); // miss move 2
            check('mistake resets streak', leaf.stats.streak === 0, 'streak=' + leaf.stats.streak);
            check('mistake resets interval', leaf.stats.interval === 0, 'interval=' + leaf.stats.interval);
            check('failed line re-queued for this session', tr.lineQueue.length === 1, 'queue=' + tr.lineQueue.length);
            check('miss counted once per position', tr.sessionStats.wrong === 1, 'wrong=' + tr.sessionStats.wrong);
            const nf3 = t.getNodeAt(['e4', 'e5', 'Nf3']);
            check('per-move stats record the miss', nf3.moveStats.attempts === 1 && nf3.moveStats.correct === 0,
                JSON.stringify(nf3.moveStats));
            const e4 = t.getNodeAt(['e4']);
            check('per-move stats record the hit', e4.moveStats.attempts === 1 && e4.moveStats.correct === 1,
                JSON.stringify(e4.moveStats));
            // Retry passes: not re-queued again
            tr.nextLine();
            playLine(tr);
            check('re-tested line passes and is not re-queued again', tr.lineQueue.length === 0 && leaf.stats.streak === 1,
                `queue=${tr.lineQueue.length} streak=${leaf.stats.streak}`);
        }

        // (c) Perfect review grows the interval.
        {
            const t = new MoveTree('Perfect', 'white');
            t.addLine(['d4', 'd5', 'c4']);
            const leaf = t.getNodeAt(['d4', 'd5', 'c4']);
            Object.assign(leaf.stats, { lastReviewed: Date.now() - 1e8, nextReview: Date.now() - 1, streak: 2, interval: 3, attempts: 2, correct: 2 });
            const tr = new Trainer(t);
            tr.startSession({ mode: 'review' });
            tr.nextLine();
            playLine(tr);
            check('perfect review increments streak', leaf.stats.streak === 3, 'streak=' + leaf.stats.streak);
            check('perfect review grows interval beyond 3 days', leaf.stats.interval > 3, 'interval=' + leaf.stats.interval);
            check('perfect review not re-queued', tr.lineQueue.length === 0);
        }

        // (d) Another repertoire move is an "alternative", not a mistake, and doesn't derail the line.
        {
            const t = new MoveTree('Alt', 'white');
            t.addLine(['e4', 'e5', 'Nf3']);
            t.addLine(['e4', 'e5', 'Bc4']);
            const tr = new Trainer(t);
            tr.startSession({ mode: 'all', learnNewLines: false });
            tr.nextLine();
            // play until it's our second move
            tr.submitMove('e2', 'e4'); tr.playOpponentMove();
            const exp = tr.getExpectedMove().san;
            const other = exp === 'Nf3' ? { from: 'f1', to: 'c4' } : { from: 'g1', to: 'f3' };
            const fenBefore = tr.chess.fen();
            const r = tr.submitMove(other.from, other.to);
            check('alternative repertoire move flagged', r.isAlternative === true && r.correct === false, JSON.stringify(r));
            check('alternative is not counted as a mistake', tr.sessionStats.wrong === 0 && tr.lineMistakes === 0);
            check('alternative is taken back (board unchanged)', tr.chess.fen() === fenBefore);
            const okMove = new Chess(tr.chess.fen()).move(exp);
            const r2 = tr.submitMove(okMove.from, okMove.to);
            check('line continues normally after alternative', r2.correct === true && tr.lineCompleted === true);
        }

        // (e) New lines are learned first, then scheduled for a review in ~4h.
        {
            const t = new MoveTree('Learn', 'black');
            t.addLine(['e4', 'c5', 'Nf3', 'd6']);
            const tr = new Trainer(t);
            tr.startSession({ mode: 'new' });
            const info = tr.nextLine();
            check('new line starts in learning mode', info.isLearning === true && tr.isLearning === true);
            check('black repertoire: opponent (White) moves first', tr.isPlayerMove() === false);
            playLine(tr);
            const leaf = t.getNodeAt(['e4', 'c5', 'Nf3', 'd6']);
            check('learned line gets a schedule', !!leaf.stats.lastReviewed && !!leaf.stats.nextReview);
            const delay = leaf.stats.nextReview - leaf.stats.lastReviewed;
            check('first review ~4h after learning', Math.abs(delay - 4 * 3600 * 1000) < 1000, 'delay=' + delay);
            check('learning does not count graded attempts', leaf.stats.attempts === 0, 'attempts=' + leaf.stats.attempts);
            check('learning does not touch per-move stats', t.getNodeAt(['e4', 'c5']).moveStats.attempts === 0);
            check('session records learned line', tr.sessionStats.learnedLines === 1);
            // persistence of a learned-but-never-graded line
            const t2 = MoveTree.deserialize(JSON.parse(JSON.stringify(t.serialize())));
            const leaf2 = t2.getNodeAt(['e4', 'c5', 'Nf3', 'd6']);
            check('learned state survives save/load', leaf2.stats.lastReviewed === leaf.stats.lastReviewed,
                `${leaf2.stats.lastReviewed} vs ${leaf.stats.lastReviewed}`);
        }

        // (f) Show-move counts as a miss and can complete the line.
        {
            const t = new MoveTree('Show', 'white');
            t.addLine(['e4']);
            const tr = new Trainer(t);
            tr.startSession({ mode: 'all', learnNewLines: false });
            tr.nextLine();
            const r = tr.playCorrectMove();
            check('show-move completes a one-move line', r && r.isLineComplete === true && tr.lineCompleted === true);
            check('show-move graded as failure', t.getNodeAt(['e4']).stats.streak === 0 && tr.lineMistakes === 1);
        }

        // (g) Lines without any player move are not trained (black rep, single White move).
        {
            const t = new MoveTree('NoPlayerMove', 'black');
            t.addLine(['e4']);
            t.addLine(['d4', 'Nf6']);
            const tr = new Trainer(t);
            const lines = [];
            tr._collectAllLines(t.root, [], lines);
            check('opponent-only line skipped', lines.length === 1 && lines[0].join(' ') === 'd4 Nf6', JSON.stringify(lines));
        }

        // (h) Per-move stats survive serialization; tree accuracy uses them.
        {
            const t = new MoveTree('MS', 'white');
            t.addLine(['e4', 'e5']);
            const e4 = t.getNodeAt(['e4']);
            Object.assign(e4.moveStats, { attempts: 4, correct: 3, streak: 2, lastSeen: 1700000000000 });
            const t2 = MoveTree.deserialize(JSON.parse(JSON.stringify(t.serialize())));
            const e4b = t2.getNodeAt(['e4']);
            check('moveStats round-trip', JSON.stringify(e4b.moveStats) === JSON.stringify(e4.moveStats), JSON.stringify(e4b.moveStats));
            check('getNodeAccuracy uses per-move stats', MoveTree.getNodeAccuracy(e4b) === 75, String(MoveTree.getNodeAccuracy(e4b)));
            const weak = t2.getWeakestMoves(5, 2);
            check('getWeakestMoves finds e4 at 75%', weak.length === 1 && weak[0].accuracy === 75, JSON.stringify(weak.map(w => w.path)));
        }
    }

    // ============================================================
    section('17. MoveTree — mainline persistence, counts, due with disabled branches');
    // ============================================================
    {
        const t = new MoveTree('Main', 'white');
        t.addLine(['e4', 'e5']);
        t.addLine(['d4', 'd5']);
        t.setMainline(t.getNodeAt(['d4']));
        const t2 = MoveTree.deserialize(JSON.parse(JSON.stringify(t.serialize())));
        check('setMainline survives reload', t2.root.getMainline().move === 'd4', t2.root.getMainline().move);
        check('only one mainline after reload', [...t2.root.children.values()].filter(n => n.priority === 0).length === 1,
            [...t2.root.children.values()].map(n => n.move + ':' + n.priority).join(','));

        const empty = new MoveTree('Empty', 'white');
        check('empty repertoire has 0 lines', empty.countLines() === 0, String(empty.countLines()));
        const t3 = new MoveTree('Counts', 'white');
        t3.addLine(['e4', 'e5', 'Nf3']);
        check('countLines then countNodes both fresh', t3.countLines() === 1 && t3.countNodes() === 3,
            `${t3.countLines()} lines / ${t3.countNodes()} nodes`);
        t3.addLine(['d4']);
        check('counts refresh after adding a line', t3.countNodes() === 4 && t3.countLines() === 2,
            `${t3.countLines()} lines / ${t3.countNodes()} nodes`);

        const t4 = new MoveTree('Due', 'white');
        t4.addLine(['e4', 'e5', 'Nf3']);
        t4.addLine(['d4', 'd5', 'c4']);
        for (const p of [['e4', 'e5', 'Nf3'], ['d4', 'd5', 'c4']]) {
            Object.assign(t4.getNodeAt(p).stats, { lastReviewed: 1, nextReview: 2, attempts: 1, correct: 1 });
        }
        check('both lines due', t4.getStatsOverview().due === 2);
        t4.getNodeAt(['d4']).enabled = false; // disable the parent only
        check('due ignores lines under a disabled parent', t4.getStatsOverview().due === 1, String(t4.getStatsOverview().due));
    }

    // ============================================================
    section('18. Transposition keys — string normalization & old data');
    // ============================================================
    {
        const N = MoveTree.normalizeFenKey;
        check('non-capturable e.p. square stripped',
            N('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1') === 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -');
        check('capturable e.p. square kept',
            N('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3').endsWith(' d6'));
        check('4-field input accepted', N('8/8/8/8/8/8/8/8 w - -') === '8/8/8/8/8/8/8/8 w - -');

        // Must agree with a legal-move based check on real opening positions.
        let disagreements = 0, checked = 0;
        const games = [
            ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'],
            ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O'],
            ['e4', 'd5', 'e5', 'f5', 'exf6', 'Nxf6', 'd4', 'c5', 'd5', 'e5', 'dxe6'],
            ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'f4', 'e5'],
            ['c4', 'e5', 'Nc3', 'Nf6', 'g3', 'd5', 'cxd5', 'Nxd5', 'Bg2', 'Nb6', 'b4', 'a5', 'b5']
        ];
        for (const g of games) {
            const c = new Chess();
            for (const san of g) {
                if (!c.move(san)) break;
                const parts = c.fen().split(' ');
                const legalEp = parts[3] !== '-' && c.moves({ verbose: true }).some(m => m.flags.includes('e'));
                const expectedKey = `${parts[0]} ${parts[1]} ${parts[2]} ${legalEp ? parts[3] : '-'}`;
                checked++;
                if (N(c.fen()) !== expectedKey) disagreements++;
            }
        }
        check(`string normalization matches legal moves (${checked} positions)`, disagreements === 0, disagreements + ' disagreements');

        // Old data: a node stored with the raw e.p. field must match a new node.
        const t = new MoveTree('Old', 'white');
        t.addLine(['d4', 'd5', 'e4', 'e6']); // new-format keys
        const data = JSON.parse(JSON.stringify(t.serialize()));
        // Simulate an old-format branch reaching the same position via 1.e4 e6 2.d4 d5
        data.tree.c.e4 = { m: 'e4', f: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3',
            c: { e6: { m: 'e6', f: 'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
                c: { d4: { m: 'd4', f: 'rnbqkbnr/pppp1ppp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3',
                    c: { d5: { m: 'd5', f: 'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq d6' } } } } } } };
        const t2 = MoveTree.deserialize(data);
        check('old-format FEN normalized on load', t2.getNodeAt(['e4']).fen.endsWith(' -'), t2.getNodeAt(['e4']).fen);
        check('transposition detected between old and new data',
            t2.getNodeAt(['e4', 'e6', 'd4', 'd5']).isTransposition && t2.getNodeAt(['d4', 'd5', 'e4', 'e6']).isTransposition);

        // Deleting one branch clears the flag on the other
        t2.deleteSubtree(t2.getNodeAt(['e4']));
        check('transposition flag cleared after deleting the other path', !t2.getNodeAt(['d4', 'd5', 'e4', 'e6']).isTransposition);
    }

    // ============================================================
    section('19. Engine — perspective, sequencing, game over, MultiPV (fake worker)');
    // ============================================================
    {
        // A scripted stand-in for the Stockfish worker.
        class FakeWorker {
            constructor() { this.sent = []; this.onmessage = null; }
            postMessage(cmd) { this.sent.push(cmd); }
            emit(line) { this.onmessage && this.onmessage({ data: line }); }
            terminate() {}
        }
        const tick = () => new Promise(r => setTimeout(r, 0));
        const mkEngine = () => {
            const e = new ChessEngine();
            const w = new FakeWorker();
            e.worker = w; e.ready = true;
            w.onmessage = (ev) => e._handleMessage(ev.data);
            return { e, w };
        };
        const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
        const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

        // Perspective: Black to move, Stockfish says "-34" for Black → +0.34 for White.
        {
            const { e, w } = mkEngine();
            const p = e.evaluate(AFTER_E4, 12);
            await tick();
            check('sends position + go', w.sent.includes('position fen ' + AFTER_E4) && w.sent.includes('go depth 12'), JSON.stringify(w.sent));
            w.emit('info depth 12 seldepth 16 multipv 1 score cp -34 nodes 9000 nps 90000 pv e7e5 g1f3');
            w.emit('bestmove e7e5 ponder g1f3');
            const r = await p;
            check('black-to-move score converted to White perspective', r && Math.abs(r.score - 0.34) < 1e-9, r && r.score);
            check('bar favours White', ChessEngine.getBarPercent(r) > 50, String(ChessEngine.getBarPercent(r)));
            check('bestMove from bestmove line', r.bestMove === 'e7e5', r.bestMove);
            const mateR = (() => { const x = e._parseInfo('info depth 5 score mate 2 pv e7e5'); return ChessEngine._toWhitePerspective(x, 'b'); })();
            check('black mating → negative mate for White', mateR.mate === -2, String(mateR.mate));
        }

        // Sequencing: a stopped search's late lines/bestmove must not leak into the next one.
        {
            const { e, w } = mkEngine();
            const pa = e.evaluate(START, 18);
            await tick();
            w.emit('info depth 10 multipv 1 score cp 30 nodes 1 nps 1 pv e2e4');
            const pb = e.evaluate(AFTER_E4, 18);   // supersedes A
            await tick();
            check('new request sends stop to the running search', w.sent.filter(c => c === 'stop').length === 1);
            check('B not started before A has stopped', w.sent.filter(c => c.startsWith('position')).length === 1);
            // Late output from A (after stop) — must be ignored
            w.emit('info depth 11 multipv 1 score cp 999 nodes 1 nps 1 pv d2d4');
            w.emit('bestmove e2e4');
            await tick();
            check('B starts after A\'s bestmove', w.sent.filter(c => c.startsWith('position')).length === 2 &&
                w.sent[w.sent.length - 1] === 'go depth 18', JSON.stringify(w.sent.slice(-3)));
            w.emit('info depth 18 multipv 1 score cp -25 nodes 1 nps 1 pv e7e5');
            w.emit('bestmove e7e5');
            const [ra, rb] = await Promise.all([pa, pb]);
            check('superseded search resolves null', ra === null, JSON.stringify(ra));
            check('B gets its own result (not A\'s +9.99)', rb && rb.fen === AFTER_E4 && Math.abs(rb.score - 0.25) < 1e-9,
                JSON.stringify(rb && { fen: rb.fen, score: rb.score }));
            check('superseded result is not cached', !e.cache.has(START + '|18|1'));
            check('completed result is cached', e.cache.has(AFTER_E4 + '|18|1'));
        }

        // Game over positions resolve immediately, without the engine.
        {
            const { e, w } = mkEngine();
            const MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'; // fool's mate
            const r = await e.evaluate(MATED, 18);
            check('checkmate detected', r.terminal === 'checkmate' && r.winner === 'b', JSON.stringify(r));
            check('checkmate formatted 0-1', ChessEngine.formatScore(r) === '0-1');
            check('checkmate bar = 0 (Black won)', ChessEngine.getBarPercent(r) === 0);
            check('engine not queried for game over', !w.sent.some(c => c.startsWith('go')));
        }

        // MultiPV: lines collected by rank, setoption sent once.
        {
            const { e, w } = mkEngine();
            const p = e.evaluate(START, 14, { multiPV: 3 });
            await tick();
            check('MultiPV configured', w.sent.includes('setoption name MultiPV value 3'));
            w.emit('info depth 14 multipv 1 score cp 35 nodes 1 nps 1 pv e2e4 e7e5');
            w.emit('info depth 14 multipv 2 score cp 30 nodes 1 nps 1 pv d2d4 d7d5');
            w.emit('info depth 14 multipv 3 score cp 22 nodes 1 nps 1 pv g1f3 d7d5');
            w.emit('info depth 14 multipv 1 score cp 40 lowerbound nodes 1 nps 1 pv e2e4');
            w.emit('bestmove e2e4');
            const r = await p;
            check('three lines returned', r.lines.length === 3, String(r.lines.length));
            check('lines ordered by rank', r.lines.map(l => l.pv[0]).join(',') === 'e2e4,d2d4,g1f3', r.lines.map(l => l.pv[0]).join(','));
            check('bound lines ignored', Math.abs(r.score - 0.35) < 1e-9, String(r.score));
            check('pvToSan converts PV', ChessEngine.pvToSan(START, ['e2e4', 'e7e5', 'g1f3']).join(' ') === 'e4 e5 Nf3');
        }

        // Live updates carry the FEN they belong to.
        {
            const { e, w } = mkEngine();
            const seen = [];
            e.onInfo = (snap) => seen.push(snap);
            const p = e.evaluate(AFTER_E4, 10);
            await tick();
            w.emit('info depth 8 multipv 1 score cp -20 nodes 1 nps 1 pv e7e5 g1f3');
            w.emit('bestmove e7e5');
            await p;
            check('onInfo snapshot includes fen, pv and white-perspective score',
                seen.length === 1 && seen[0].fen === AFTER_E4 && seen[0].pv.length === 2 && seen[0].score > 0,
                JSON.stringify(seen[0]));
        }

        // Worker URL passes the wasm location explicitly (Windows/Electron file:// safety).
        {
            const url = ChessEngine.workerUrl();
            check('worker url is relative', url.startsWith('vendor/stockfish/stockfish.js#'), url);
            const wasm = decodeURIComponent(url.split('#')[1]);
            check('wasm url absolute and ends with stockfish.wasm', /^[a-z]+:\/\/.*\/vendor\/stockfish\/stockfish\.wasm$/.test(wasm), wasm);
            const winBase = 'file:///C:/Users/super/chess/chess/index.html';
            check('Windows file:// base resolves to a file URL', new URL('vendor/stockfish/stockfish.wasm', winBase).href ===
                'file:///C:/Users/super/chess/chess/vendor/stockfish/stockfish.wasm');
        }
    }

    process.exit(report());
})();
