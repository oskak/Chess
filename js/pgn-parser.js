/**
 * PGN Parser for Chess Opening Repertoire
 *
 * Handles large PGN files with recursive variations.
 * Auto-detects piece notation language (English, Czech, Spanish, German, French).
 * Full UTF-8 support for comments (Czech: ř,č,ť,ě,š,ž / Spanish: ñ,¿,¡ etc.)
 *
 * Supports:
 * - Multiple games in one file
 * - Recursive Alternative Variations (RAV): (1... c5 2. Nf3)
 * - Comments: {text} with any Unicode characters
 * - NAGs: $1, $2, !, ?, !!, ??, !?, ?!
 * - Move numbers: 1. 1... etc.
 * - Large files via chunked processing
 * - Auto-detection of piece notation language
 */

class PGNParser {

    static NAG_MAP = {
        '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6
    };

    static NAG_REVERSE = {
        1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!'
    };

    /**
     * Piece notation mappings for different languages.
     * Maps foreign piece letter -> English piece letter.
     *
     * English: K Q R B N (King, Queen, Rook, Bishop, Knight)
     * Czech:   K D V S J (Král, Dáma, Věž, Střelec, Jezdec)
     * Spanish: R D T A C (Rey, Dama, Torre, Alfil, Caballo)
     * German:  K D T L S (König, Dame, Turm, Läufer, Springer)
     * French:  R D T F C (Roi, Dame, Tour, Fou, Cavalier)
     */
    static PIECE_MAPS = {
        en: { K: 'K', Q: 'Q', R: 'R', B: 'B', N: 'N' },
        cs: { K: 'K', D: 'Q', V: 'R', S: 'B', J: 'N' },
        es: { R: 'K', D: 'Q', T: 'R', A: 'B', C: 'N' },
        de: { K: 'K', D: 'Q', T: 'R', L: 'B', S: 'N' },
        fr: { R: 'K', D: 'Q', T: 'R', F: 'B', C: 'N' }
    };

    // Unique piece letters per language (letters that distinguish this language)
    static LANG_SIGNATURES = {
        en: ['Q', 'N', 'B'],    // Q and N are unique to English
        cs: ['J', 'V'],          // J and V are unique to Czech
        es: ['A'],               // A (Alfil) is fairly unique to Spanish
        de: ['L'],               // L (Läufer) is unique to German
        fr: ['F']                // F (Fou) is unique to French
    };

    // All possible piece letters across all languages
    static ALL_PIECE_LETTERS = 'KQRBNPDVSJTALFC';

    /**
     * Detect the piece notation language from PGN movetext.
     * Returns language code: 'en', 'cs', 'es', 'de', 'fr'
     */
    static detectLanguage(movetext) {
        if (!movetext) return 'en';

        // Remove comments and variations to focus on moves
        const cleaned = movetext
            .replace(/\{[^}]*\}/g, '')     // remove comments
            .replace(/;[^\n]*/g, '')        // remove line comments
            .replace(/\$\d+/g, '')          // remove NAGs
            .replace(/\d+\.+\s*/g, ' ')     // remove move numbers
            .replace(/[()]/g, ' ');         // remove variation markers

        // Extract piece letters from moves (uppercase letter before coordinate)
        const pieceUsage = {};
        const movePattern = /([A-Z])([a-h]?[1-8]?x?[a-h][1-8])/g;
        let match;

        while ((match = movePattern.exec(cleaned)) !== null) {
            const letter = match[1];
            // Skip if it could be a pawn file or not a piece letter
            if (PGNParser.ALL_PIECE_LETTERS.includes(letter)) {
                pieceUsage[letter] = (pieceUsage[letter] || 0) + 1;
            }
        }

        // Score each language
        const scores = {};
        for (const [lang, signatures] of Object.entries(PGNParser.LANG_SIGNATURES)) {
            scores[lang] = 0;
            for (const letter of signatures) {
                if (pieceUsage[letter]) {
                    scores[lang] += pieceUsage[letter];
                }
            }
        }

        // Additional heuristics:
        // If we see J (Czech Knight) or V (Czech Rook) - strongly Czech
        if (pieceUsage['J'] || pieceUsage['V']) {
            scores.cs += 100;
        }
        // If we see Q or N - strongly English
        if (pieceUsage['Q'] || pieceUsage['N']) {
            scores.en += 100;
        }
        // If we see A (Alfil) without B or N - Spanish
        if (pieceUsage['A'] && !pieceUsage['B'] && !pieceUsage['N']) {
            scores.es += 50;
        }
        // If we see L (Läufer) - German
        if (pieceUsage['L'] && !pieceUsage['N'] && !pieceUsage['Q']) {
            scores.de += 50;
        }
        // If we see F (Fou) - French
        if (pieceUsage['F'] && !pieceUsage['B'] && !pieceUsage['N']) {
            scores.fr += 50;
        }

        // English is the default
        scores.en += 10;

        // Find best scoring language
        let bestLang = 'en';
        let bestScore = scores.en;
        for (const [lang, score] of Object.entries(scores)) {
            if (score > bestScore) {
                bestScore = score;
                bestLang = lang;
            }
        }

        return bestLang;
    }

    /**
     * Convert a move from a given language to English SAN.
     */
    static convertPieceNotation(moveSan, fromLang) {
        if (fromLang === 'en') return moveSan;

        const pieceMap = PGNParser.PIECE_MAPS[fromLang];
        if (!pieceMap) return moveSan;

        // Only convert the first character if it's an uppercase piece letter
        const firstChar = moveSan[0];
        if (firstChar && /[A-Z]/.test(firstChar) && pieceMap[firstChar]) {
            return pieceMap[firstChar] + moveSan.substring(1);
        }

        // Also handle promotion: =D -> =Q, =V -> =R, etc.
        const promoMatch = moveSan.match(/=([A-Z])/);
        if (promoMatch && pieceMap[promoMatch[1]]) {
            moveSan = moveSan.replace(`=${promoMatch[1]}`, `=${pieceMap[promoMatch[1]]}`);
        }

        return moveSan;
    }

    /**
     * Get human-readable language name.
     */
    static getLanguageName(langCode) {
        const names = {
            en: 'English',
            cs: 'Czech (Česky)',
            es: 'Spanish (Español)',
            de: 'German (Deutsch)',
            fr: 'French (Français)'
        };
        return names[langCode] || 'Unknown';
    }

    /**
     * Parse a PGN string into one or more MoveTree objects.
     */
    static parse(pgnText, options = {}) {
        const {
            repertoireName = 'Imported',
            color = 'white',
            mergeGames = true,
            language = null  // auto-detect if null
        } = options;

        const games = PGNParser.splitGames(pgnText);

        // Detect language from first game's movetext
        const detectedLang = language || PGNParser.detectLanguage(
            games.length > 0 ? games[0].movetext : ''
        );

        if (mergeGames) {
            const tree = new MoveTree(repertoireName, color);
            tree.metadata._pgnLanguage = detectedLang;
            for (const game of games) {
                PGNParser.parseGameIntoTree(game, tree, detectedLang);
            }
            return [tree];
        } else {
            return games.map((game, i) => {
                const tree = new MoveTree(
                    game.headers['Event'] || game.headers['White'] || `Game ${i + 1}`,
                    color
                );
                tree.metadata = { ...game.headers, _pgnLanguage: detectedLang };
                PGNParser.parseGameIntoTree(game, tree, detectedLang);
                return tree;
            });
        }
    }

    /**
     * Parse a large PGN file asynchronously in chunks.
     * Returns a Promise with { trees, detectedLanguage }.
     */
    static async parseAsync(pgnText, options = {}) {
        const { onProgress = () => {}, language = null } = options;
        const games = PGNParser.splitGames(pgnText);
        const total = games.length;

        // Detect language from first few games
        const sampleText = games.slice(0, 5).map(g => g.movetext).join(' ');
        const detectedLang = language || PGNParser.detectLanguage(sampleText);

        const tree = new MoveTree(options.repertoireName || 'Imported', options.color || 'white');
        tree.metadata._pgnLanguage = detectedLang;
        const chunkSize = 100;

        for (let i = 0; i < games.length; i += chunkSize) {
            const chunk = games.slice(i, i + chunkSize);
            for (const game of chunk) {
                PGNParser.parseGameIntoTree(game, tree, detectedLang);
            }
            onProgress(Math.min(100, Math.round(((i + chunk.length) / total) * 100)));
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        return { trees: [tree], detectedLanguage: detectedLang };
    }

    /**
     * Split PGN text into individual games.
     */
    static splitGames(pgnText) {
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

    /**
     * Parse a single game's movetext and add it to a MoveTree.
     */
    static parseGameIntoTree(game, tree, language = 'en') {
        const tokens = PGNParser.tokenize(game.movetext, language);
        if (tokens.length === 0) return;

        const chess = new Chess();
        PGNParser._parseTokens(tokens, 0, tree.root, chess, tree);
    }

    /**
     * Tokenize PGN movetext into an array of tokens.
     * Handles multi-language piece notation.
     */
    static tokenize(movetext, language = 'en') {
        if (!movetext) return [];

        const tokens = [];
        let i = 0;
        const len = movetext.length;

        // Build piece letter regex based on detected language
        const pieceLetters = PGNParser.ALL_PIECE_LETTERS;

        while (i < len) {
            const ch = movetext[i];

            // Skip whitespace
            if (/\s/.test(ch)) {
                i++;
                continue;
            }

            // Comment: { ... } - preserves all Unicode characters inside
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

            // Line comment: ; ...
            if (ch === ';') {
                const end = movetext.indexOf('\n', i + 1);
                if (end === -1) {
                    i = len;
                } else {
                    i = end + 1;
                }
                continue;
            }

            // Variation start/end
            if (ch === '(') {
                tokens.push({ type: 'variation_start' });
                i++;
                continue;
            }
            if (ch === ')') {
                tokens.push({ type: 'variation_end' });
                i++;
                continue;
            }

            // NAG: $number
            if (ch === '$') {
                let j = i + 1;
                while (j < len && /\d/.test(movetext[j])) j++;
                tokens.push({ type: 'nag', value: parseInt(movetext.substring(i + 1, j)) });
                i = j;
                continue;
            }

            // Result: *, 1-0, 0-1, 1/2-1/2
            if (ch === '*') {
                tokens.push({ type: 'result', value: '*' });
                i++;
                continue;
            }

            const resultMatch = movetext.substring(i).match(/^(1-0|0-1|1\/2-1\/2)/);
            if (resultMatch) {
                tokens.push({ type: 'result', value: resultMatch[1] });
                i += resultMatch[1].length;
                continue;
            }

            // Move number: skip
            const moveNumMatch = movetext.substring(i).match(/^(\d+)(\.{1,3})\s*/);
            if (moveNumMatch) {
                i += moveNumMatch[0].length;
                continue;
            }

            // Symbolic NAGs: !!, ??, !?, ?!, !, ?
            const nagSymMatch = movetext.substring(i).match(/^(\!\!|\?\?|\!\?|\?\!|\!|\?)/);
            if (nagSymMatch) {
                const nagNum = PGNParser.NAG_MAP[nagSymMatch[1]];
                if (nagNum !== undefined) {
                    tokens.push({ type: 'nag', value: nagNum });
                }
                i += nagSymMatch[1].length;
                continue;
            }

            // Move: SAN notation with multi-language piece letters
            // Pattern accepts any known piece letter from any language
            const moveMatch = movetext.substring(i).match(
                new RegExp(`^([${pieceLetters}]?[a-h]?[1-8]?x?[a-h][1-8](?:=[${pieceLetters}])?[+#]?|O-O-O[+#]?|O-O[+#]?|0-0-0[+#]?|0-0[+#]?)`)
            );
            if (moveMatch) {
                let moveSan = moveMatch[1].replace(/0-0-0/, 'O-O-O').replace(/0-0/, 'O-O');
                // Convert to English notation
                moveSan = PGNParser.convertPieceNotation(moveSan, language);
                tokens.push({ type: 'move', value: moveSan });
                i += moveMatch[1].length;
                continue;
            }

            // Unknown character - skip
            i++;
        }

        return tokens;
    }

    /**
     * Recursively parse tokens into the move tree.
     * Also tracks FEN for transposition detection.
     */
    static _parseTokens(tokens, startIdx, parentNode, chess, tree) {
        let i = startIdx;
        let currentNode = parentNode;
        let lastMoveNode = null;

        while (i < tokens.length) {
            const token = tokens[i];

            switch (token.type) {
                case 'move': {
                    const moveResult = chess.move(token.value, { sloppy: true });
                    if (moveResult) {
                        const san = moveResult.san;
                        const isNewNode = !currentNode.children.has(san);
                        currentNode = currentNode.addChild(san);
                        lastMoveNode = currentNode;

                        // Store normalized FEN for transposition detection
                        // (strips non-capturable en-passant square — see MoveTree.positionFen)
                        const positionFen = MoveTree.positionFen(chess);
                        currentNode.fen = positionFen;

                        // Register with tree's transposition index
                        if (tree && tree.positionIndex) {
                            if (!tree.positionIndex.has(positionFen)) {
                                tree.positionIndex.set(positionFen, []);
                            }
                            const nodes = tree.positionIndex.get(positionFen);
                            if (!nodes.includes(currentNode)) {
                                nodes.push(currentNode);
                            }
                            // Mark as transposition if multiple paths reach this position
                            if (nodes.length > 1) {
                                currentNode.isTransposition = true;
                                for (const n of nodes) {
                                    n.isTransposition = true;
                                }
                            }
                        }
                    }
                    i++;
                    break;
                }

                case 'comment': {
                    if (lastMoveNode) {
                        lastMoveNode.comment = (lastMoveNode.comment ? lastMoveNode.comment + ' ' : '') + token.value;
                    }
                    i++;
                    break;
                }

                case 'nag': {
                    if (lastMoveNode) {
                        lastMoveNode.nags.push(token.value);
                    }
                    i++;
                    break;
                }

                case 'variation_start': {
                    const savedFen = chess.fen();
                    chess.undo();
                    i = PGNParser._parseTokens(tokens, i + 1, currentNode.parent || parentNode, chess, tree);
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

    /**
     * Export a MoveTree back to PGN format.
     */
    static export(tree, options = {}) {
        const {
            includeHeaders = true,
            includeComments = true,
            includeNags = true
        } = options;

        let pgn = '';

        if (includeHeaders) {
            pgn += `[Event "${tree.name}"]\n`;
            pgn += `[Site "Chess Opening Repertoire"]\n`;
            pgn += `[Date "${new Date().toISOString().split('T')[0].replace(/-/g, '.')}"]\n`;
            pgn += `[White "${tree.color === 'white' ? 'Repertoire' : '?'}"]\n`;
            pgn += `[Black "${tree.color === 'black' ? 'Repertoire' : '?'}"]\n`;
            pgn += `[Result "*"]\n\n`;
        }

        pgn += PGNParser._exportNode(tree.root, 0, true, includeComments, includeNags);
        pgn += ' *';

        return pgn;
    }

    static _exportNode(node, depth, isMainline, includeComments, includeNags) {
        let result = '';
        const children = [...node.children.values()].sort((a, b) => a.priority - b.priority);

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const isFirst = i === 0;
            const moveNum = Math.floor((depth) / 2) + 1;
            const isWhite = depth % 2 === 0;

            if (!isFirst) {
                result += ' (';
            }

            if (isWhite) {
                result += `${moveNum}. `;
            } else if (!isFirst || !isMainline) {
                result += `${moveNum}... `;
            }

            result += child.move;

            if (includeNags && child.nags.length > 0) {
                for (const nag of child.nags) {
                    const sym = PGNParser.NAG_REVERSE[nag];
                    result += sym ? sym : ` $${nag}`;
                }
            }

            if (includeComments && child.comment) {
                result += ` {${child.comment}}`;
            }

            if (child.hasChildren()) {
                result += ' ' + PGNParser._exportNode(child, depth + 1, isFirst, includeComments, includeNags);
            }

            if (!isFirst) {
                result += ')';
            }
        }

        return result;
    }

    /**
     * Validate PGN text (basic check) with language detection.
     */
    static validate(pgnText) {
        try {
            const games = PGNParser.splitGames(pgnText);
            if (games.length === 0) return { valid: false, error: 'No games found' };

            const detectedLang = PGNParser.detectLanguage(games[0].movetext);
            const chess = new Chess();
            const tokens = PGNParser.tokenize(games[0].movetext, detectedLang);
            let moveCount = 0;

            for (const token of tokens) {
                if (token.type === 'move') {
                    const result = chess.move(token.value, { sloppy: true });
                    if (!result) {
                        return { valid: false, error: `Invalid move: ${token.value}`, detectedLanguage: detectedLang };
                    }
                    moveCount++;
                }
            }

            return {
                valid: true,
                gameCount: games.length,
                firstGameMoves: moveCount,
                detectedLanguage: detectedLang,
                detectedLanguageName: PGNParser.getLanguageName(detectedLang)
            };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }
}

window.PGNParser = PGNParser;
