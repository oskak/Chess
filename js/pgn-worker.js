/**
 * Web Worker for Massive PGN File Parsing
 *
 * Offloads heavy PGN parsing to a background thread.
 * Handles files with thousands of games without blocking the UI.
 *
 * Communication protocol:
 *   Main -> Worker: { type: 'parse', pgnText, options }
 *   Worker -> Main: { type: 'progress', percent, gamesProcessed, totalGames }
 *   Worker -> Main: { type: 'complete', treeData, stats }
 *   Worker -> Main: { type: 'error', message }
 *   Worker -> Main: { type: 'language_detected', language, languageName }
 */

// Import chess.js in worker context
importScripts('https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js');

// ============= Inline dependencies (no module imports in workers) =============

// Minimal PGN language detection & conversion (duplicated from pgn-parser.js for worker isolation)

const PIECE_MAPS = {
    en: { K: 'K', Q: 'Q', R: 'R', B: 'B', N: 'N' },
    cs: { K: 'K', D: 'Q', V: 'R', S: 'B', J: 'N' },
    es: { R: 'K', D: 'Q', T: 'R', A: 'B', C: 'N' },
    de: { K: 'K', D: 'Q', T: 'R', L: 'B', S: 'N' },
    fr: { R: 'K', D: 'Q', T: 'R', F: 'B', C: 'N' }
};

const LANG_SIGNATURES = {
    en: ['Q', 'N', 'B'],
    cs: ['J', 'V'],
    es: ['A'],
    de: ['L'],
    fr: ['F']
};

const ALL_PIECE_LETTERS = 'KQRBNPDVSJTALFC';

const NAG_MAP = {
    '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6
};

const LANG_NAMES = {
    en: 'English',
    cs: 'Czech (Česky)',
    es: 'Spanish (Español)',
    de: 'German (Deutsch)',
    fr: 'French (Français)'
};

function detectLanguage(movetext) {
    if (!movetext) return 'en';
    const cleaned = movetext
        .replace(/\{[^}]*\}/g, '')
        .replace(/;[^\n]*/g, '')
        .replace(/\$\d+/g, '')
        .replace(/\d+\.+\s*/g, ' ')
        .replace(/[()]/g, ' ');

    const pieceUsage = {};
    const movePattern = /([A-Z])([a-h]?[1-8]?x?[a-h][1-8])/g;
    let match;
    while ((match = movePattern.exec(cleaned)) !== null) {
        const letter = match[1];
        if (ALL_PIECE_LETTERS.includes(letter)) {
            pieceUsage[letter] = (pieceUsage[letter] || 0) + 1;
        }
    }

    const scores = {};
    for (const [lang, sigs] of Object.entries(LANG_SIGNATURES)) {
        scores[lang] = 0;
        for (const letter of sigs) {
            if (pieceUsage[letter]) scores[lang] += pieceUsage[letter];
        }
    }

    if (pieceUsage['J'] || pieceUsage['V']) scores.cs += 100;
    if (pieceUsage['Q'] || pieceUsage['N']) scores.en += 100;
    if (pieceUsage['A'] && !pieceUsage['B'] && !pieceUsage['N']) scores.es += 50;
    if (pieceUsage['L'] && !pieceUsage['N'] && !pieceUsage['Q']) scores.de += 50;
    if (pieceUsage['F'] && !pieceUsage['B'] && !pieceUsage['N']) scores.fr += 50;
    scores.en += 10;

    let bestLang = 'en', bestScore = scores.en;
    for (const [lang, score] of Object.entries(scores)) {
        if (score > bestScore) { bestScore = score; bestLang = lang; }
    }
    return bestLang;
}

function convertPieceNotation(moveSan, fromLang) {
    if (fromLang === 'en') return moveSan;
    const pieceMap = PIECE_MAPS[fromLang];
    if (!pieceMap) return moveSan;

    const firstChar = moveSan[0];
    if (firstChar && /[A-Z]/.test(firstChar) && pieceMap[firstChar]) {
        moveSan = pieceMap[firstChar] + moveSan.substring(1);
    }
    const promoMatch = moveSan.match(/=([A-Z])/);
    if (promoMatch && pieceMap[promoMatch[1]]) {
        moveSan = moveSan.replace(`=${promoMatch[1]}`, `=${pieceMap[promoMatch[1]]}`);
    }
    return moveSan;
}

// ============= Game splitting =============

function splitGames(pgnText) {
    const games = [];
    const text = pgnText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const sections = text.split(/\n\n(?=\[)/);
    let currentHeaders = {};
    let currentMovetext = '';

    for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('[')) {
            const lines = trimmed.split('\n');
            const headers = {};
            let movetextStart = -1;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                const headerMatch = line.match(/^\[(\w+)\s+"(.*)"\]$/);
                if (headerMatch) {
                    headers[headerMatch[1]] = headerMatch[2];
                } else if (line && !line.startsWith('[')) {
                    movetextStart = i;
                    break;
                }
            }

            if (currentMovetext) {
                games.push({ headers: currentHeaders, movetext: currentMovetext.trim() });
                currentMovetext = '';
            }
            currentHeaders = headers;
            if (movetextStart >= 0) {
                currentMovetext = lines.slice(movetextStart).join(' ');
            }
        } else {
            currentMovetext += ' ' + trimmed;
        }
    }

    if (currentMovetext || Object.keys(currentHeaders).length > 0) {
        games.push({ headers: currentHeaders, movetext: currentMovetext.trim() });
    }

    if (games.length === 0 && pgnText.trim()) {
        games.push({ headers: {}, movetext: pgnText.trim() });
    }

    return games;
}

// ============= Tokenizer =============

function tokenize(movetext, language) {
    if (!movetext) return [];
    const tokens = [];
    let i = 0;
    const len = movetext.length;
    const pieceRegex = new RegExp(`^([${ALL_PIECE_LETTERS}]?[a-h]?[1-8]?x?[a-h][1-8](?:=[${ALL_PIECE_LETTERS}])?[+#]?|O-O-O[+#]?|O-O[+#]?|0-0-0[+#]?|0-0[+#]?)`);

    while (i < len) {
        const ch = movetext[i];

        if (/\s/.test(ch)) { i++; continue; }

        if (ch === '{') {
            const end = movetext.indexOf('}', i + 1);
            if (end === -1) {
                tokens.push({ type: 'comment', value: movetext.substring(i + 1).trim() });
                break;
            }
            tokens.push({ type: 'comment', value: movetext.substring(i + 1, end).trim() });
            i = end + 1;
            continue;
        }

        if (ch === ';') {
            const end = movetext.indexOf('\n', i + 1);
            i = end === -1 ? len : end + 1;
            continue;
        }

        if (ch === '(') { tokens.push({ type: 'variation_start' }); i++; continue; }
        if (ch === ')') { tokens.push({ type: 'variation_end' }); i++; continue; }

        if (ch === '$') {
            let j = i + 1;
            while (j < len && /\d/.test(movetext[j])) j++;
            tokens.push({ type: 'nag', value: parseInt(movetext.substring(i + 1, j)) });
            i = j;
            continue;
        }

        if (ch === '*') { tokens.push({ type: 'result', value: '*' }); i++; continue; }

        const resultMatch = movetext.substring(i).match(/^(1-0|0-1|1\/2-1\/2)/);
        if (resultMatch) {
            tokens.push({ type: 'result', value: resultMatch[1] });
            i += resultMatch[1].length;
            continue;
        }

        const moveNumMatch = movetext.substring(i).match(/^(\d+)(\.{1,3})\s*/);
        if (moveNumMatch) { i += moveNumMatch[0].length; continue; }

        const nagSymMatch = movetext.substring(i).match(/^(\!\!|\?\?|\!\?|\?\!|\!|\?)/);
        if (nagSymMatch) {
            const nagNum = NAG_MAP[nagSymMatch[1]];
            if (nagNum !== undefined) tokens.push({ type: 'nag', value: nagNum });
            i += nagSymMatch[1].length;
            continue;
        }

        const moveMatch = movetext.substring(i).match(pieceRegex);
        if (moveMatch) {
            let moveSan = moveMatch[1].replace(/0-0-0/, 'O-O-O').replace(/0-0/, 'O-O');
            moveSan = convertPieceNotation(moveSan, language);
            tokens.push({ type: 'move', value: moveSan });
            i += moveMatch[1].length;
            continue;
        }

        i++;
    }

    return tokens;
}

// ============= Tree building (serialized format) =============

function parseTokensIntoTree(tokens, startIdx, parentPath, chess, treeData, positionCounts) {
    let i = startIdx;
    let currentPath = parentPath;
    let lastMovePath = null;

    while (i < tokens.length) {
        const token = tokens[i];

        switch (token.type) {
            case 'move': {
                const moveResult = chess.move(token.value, { sloppy: true });
                if (moveResult) {
                    const san = moveResult.san;
                    const fen = chess.fen().split(' ').slice(0, 4).join(' ');

                    // Navigate/create in tree
                    let node = getOrCreateNode(treeData, currentPath, san);
                    node.f = fen;

                    // Track transpositions
                    if (!positionCounts[fen]) positionCounts[fen] = 0;
                    positionCounts[fen]++;
                    if (positionCounts[fen] > 1) node.t = 1;

                    currentPath = currentPath + '/' + san;
                    lastMovePath = currentPath;
                }
                i++;
                break;
            }

            case 'comment': {
                if (lastMovePath) {
                    let node = getNodeByPath(treeData, lastMovePath);
                    if (node) {
                        node.a = (node.a ? node.a + ' ' : '') + token.value;
                    }
                }
                i++;
                break;
            }

            case 'nag': {
                if (lastMovePath) {
                    let node = getNodeByPath(treeData, lastMovePath);
                    if (node) {
                        if (!node.n) node.n = [];
                        node.n.push(token.value);
                    }
                }
                i++;
                break;
            }

            case 'variation_start': {
                const savedFen = chess.fen();
                chess.undo();
                // Parent path is one level up
                const parentOfCurrent = currentPath.substring(0, currentPath.lastIndexOf('/'));
                i = parseTokensIntoTree(tokens, i + 1, parentOfCurrent || '', chess, treeData, positionCounts);
                chess.load(savedFen);
                break;
            }

            case 'variation_end': {
                return i + 1;
            }

            case 'result': {
                i++;
                break;
            }

            default:
                i++;
        }
    }

    return i;
}

function getOrCreateNode(treeData, parentPath, moveSan) {
    const fullPath = parentPath ? parentPath + '/' + moveSan : moveSan;

    if (!treeData._nodes) treeData._nodes = {};

    if (treeData._nodes[fullPath]) return treeData._nodes[fullPath];

    const node = { m: moveSan };

    // Add to parent's children
    let parent;
    if (!parentPath) {
        parent = treeData;
    } else {
        parent = treeData._nodes[parentPath];
    }

    if (parent) {
        if (!parent.c) parent.c = {};
        if (!parent.c[moveSan]) {
            parent.c[moveSan] = node;
        }
    }

    treeData._nodes[fullPath] = parent ? (parent.c[moveSan]) : node;
    return treeData._nodes[fullPath];
}

function getNodeByPath(treeData, path) {
    if (!treeData._nodes) return null;
    return treeData._nodes[path] || null;
}

// ============= Main worker message handler =============

self.onmessage = function(e) {
    const { type, pgnText, options } = e.data;

    if (type !== 'parse') return;

    try {
        const games = splitGames(pgnText);
        const total = games.length;

        // Detect language from first few games
        const sampleText = games.slice(0, 5).map(g => g.movetext).join(' ');
        const language = options.language || detectLanguage(sampleText);

        self.postMessage({
            type: 'language_detected',
            language: language,
            languageName: LANG_NAMES[language] || 'Unknown'
        });

        // Build tree in serialized format
        const treeData = { c: {} };
        treeData._nodes = { '': treeData };
        const positionCounts = {};

        const chunkSize = 50;
        let gamesProcessed = 0;

        for (let i = 0; i < games.length; i += chunkSize) {
            const chunk = games.slice(i, i + chunkSize);

            for (const game of chunk) {
                const tokens = tokenize(game.movetext, language);
                if (tokens.length === 0) continue;

                const chess = new Chess();
                parseTokensIntoTree(tokens, 0, '', chess, treeData, positionCounts);
                gamesProcessed++;
            }

            self.postMessage({
                type: 'progress',
                percent: Math.min(100, Math.round((gamesProcessed / total) * 100)),
                gamesProcessed,
                totalGames: total
            });
        }

        // Clean up internal node map before sending
        delete treeData._nodes;

        // Count stats
        let nodeCount = 0;
        let lineCount = 0;
        let transpositionCount = 0;

        function countTree(node) {
            if (!node.c || Object.keys(node.c).length === 0) {
                lineCount++;
                return;
            }
            for (const [, child] of Object.entries(node.c)) {
                nodeCount++;
                if (child.t) transpositionCount++;
                countTree(child);
            }
        }
        countTree(treeData);

        self.postMessage({
            type: 'complete',
            treeData: treeData,
            stats: {
                games: total,
                nodes: nodeCount,
                lines: lineCount,
                transpositions: Object.values(positionCounts).filter(c => c > 1).length,
                language: language,
                languageName: LANG_NAMES[language] || 'Unknown'
            }
        });

    } catch (err) {
        self.postMessage({
            type: 'error',
            message: err.message || String(err)
        });
    }
};
