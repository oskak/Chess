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
    check('formatScore mate', ChessEngine.formatScore({ score: 100, mate: 3 }) === 'M3',
        ChessEngine.formatScore({ score: 100, mate: 3 }));
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

    process.exit(report());
})();
