/**
 * PGN Parser for Chess Opening Repertoire
 *
 * Handles large PGN files with recursive variations.
 * Parses PGN into MoveTree structure efficiently.
 *
 * Supports:
 * - Multiple games in one file
 * - Recursive Alternative Variations (RAV): (1... c5 2. Nf3)
 * - Comments: {text}
 * - NAGs: $1, $2, !, ?, !!, ??, !?, ?!
 * - Move numbers: 1. 1... etc.
 * - Large files via chunked processing
 */

class PGNParser {

    static NAG_MAP = {
        '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6
    };

    static NAG_REVERSE = {
        1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!'
    };

    /**
     * Parse a PGN string into one or more MoveTree objects.
     * For large files, this processes in chunks to avoid blocking UI.
     */
    static parse(pgnText, options = {}) {
        const {
            repertoireName = 'Imported',
            color = 'white',
            mergeGames = true    // merge all games into one tree
        } = options;

        const games = PGNParser.splitGames(pgnText);

        if (mergeGames) {
            const tree = new MoveTree(repertoireName, color);
            for (const game of games) {
                PGNParser.parseGameIntoTree(game, tree);
            }
            return [tree];
        } else {
            return games.map((game, i) => {
                const tree = new MoveTree(
                    game.headers['Event'] || game.headers['White'] || `Game ${i + 1}`,
                    color
                );
                tree.metadata = game.headers;
                PGNParser.parseGameIntoTree(game, tree);
                return tree;
            });
        }
    }

    /**
     * Parse a large PGN file asynchronously in chunks.
     * Returns a Promise that resolves to MoveTree(s).
     * Calls onProgress(percent) during parsing.
     */
    static async parseAsync(pgnText, options = {}) {
        const { onProgress = () => {} } = options;
        const games = PGNParser.splitGames(pgnText);
        const total = games.length;

        const tree = new MoveTree(options.repertoireName || 'Imported', options.color || 'white');
        const chunkSize = 100; // games per chunk

        for (let i = 0; i < games.length; i += chunkSize) {
            const chunk = games.slice(i, i + chunkSize);
            for (const game of chunk) {
                PGNParser.parseGameIntoTree(game, tree);
            }
            onProgress(Math.min(100, Math.round(((i + chunk.length) / total) * 100)));
            // Yield to event loop
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        return [tree];
    }

    /**
     * Split PGN text into individual games.
     * Each game = { headers: {}, movetext: "" }
     */
    static splitGames(pgnText) {
        const games = [];
        // Normalize line endings
        const text = pgnText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Split on double newline before header tags
        const sections = text.split(/\n\n(?=\[)/);
        let currentHeaders = {};
        let currentMovetext = '';

        for (const section of sections) {
            const trimmed = section.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('[')) {
                // This section has headers
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

                // If we had a previous game's movetext, save it
                if (currentMovetext) {
                    games.push({ headers: currentHeaders, movetext: currentMovetext.trim() });
                    currentMovetext = '';
                }

                currentHeaders = headers;

                if (movetextStart >= 0) {
                    currentMovetext = lines.slice(movetextStart).join(' ');
                }
            } else {
                // Pure movetext (continuation of previous game)
                currentMovetext += ' ' + trimmed;
            }
        }

        // Don't forget the last game
        if (currentMovetext || Object.keys(currentHeaders).length > 0) {
            games.push({ headers: currentHeaders, movetext: currentMovetext.trim() });
        }

        // Handle case where there are no headers at all (just movetext)
        if (games.length === 0 && pgnText.trim()) {
            games.push({ headers: {}, movetext: pgnText.trim() });
        }

        return games;
    }

    /**
     * Parse a single game's movetext and add it to a MoveTree.
     */
    static parseGameIntoTree(game, tree) {
        const tokens = PGNParser.tokenize(game.movetext);
        if (tokens.length === 0) return;

        // We need a chess instance to validate moves and track position
        const chess = new Chess();
        PGNParser._parseTokens(tokens, 0, tree.root, chess);
    }

    /**
     * Tokenize PGN movetext into an array of tokens.
     * Token types: move, comment, nag, variation_start, variation_end, result
     */
    static tokenize(movetext) {
        if (!movetext) return [];

        const tokens = [];
        let i = 0;
        const len = movetext.length;

        while (i < len) {
            const ch = movetext[i];

            // Skip whitespace
            if (/\s/.test(ch)) {
                i++;
                continue;
            }

            // Comment: { ... }
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

            // Line comment: ; ... (until end of line)
            if (ch === ';') {
                const end = movetext.indexOf('\n', i + 1);
                if (end === -1) {
                    i = len;
                } else {
                    i = end + 1;
                }
                continue;
            }

            // Variation start
            if (ch === '(') {
                tokens.push({ type: 'variation_start' });
                i++;
                continue;
            }

            // Variation end
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

            // Result: 1-0, 0-1, 1/2-1/2, *
            if (ch === '*') {
                tokens.push({ type: 'result', value: '*' });
                i++;
                continue;
            }

            // Check for results like 1-0, 0-1, 1/2-1/2
            const resultMatch = movetext.substring(i).match(/^(1-0|0-1|1\/2-1\/2)/);
            if (resultMatch) {
                tokens.push({ type: 'result', value: resultMatch[1] });
                i += resultMatch[1].length;
                continue;
            }

            // Move number: skip (e.g., "1." "1..." "12.")
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

            // Move: SAN notation (starts with a letter, piece symbol, or O for castling)
            const moveMatch = movetext.substring(i).match(/^([KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O-O[+#]?|O-O[+#]?|0-0-0[+#]?|0-0[+#]?)/);
            if (moveMatch) {
                // Normalize castling notation
                let moveSan = moveMatch[1].replace(/0-0-0/, 'O-O-O').replace(/0-0/, 'O-O');
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
     * Returns the index after the last consumed token.
     */
    static _parseTokens(tokens, startIdx, parentNode, chess) {
        let i = startIdx;
        let currentNode = parentNode;
        let lastMoveNode = null;

        while (i < tokens.length) {
            const token = tokens[i];

            switch (token.type) {
                case 'move': {
                    // Validate and make the move
                    const moveResult = chess.move(token.value, { sloppy: true });
                    if (moveResult) {
                        const san = moveResult.san;
                        currentNode = currentNode.addChild(san);
                        lastMoveNode = currentNode;
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
                    // Save chess state before variation
                    const savedFen = chess.fen();

                    // Go back one move - the variation starts from the parent position
                    chess.undo();

                    // Parse the variation recursively
                    i = PGNParser._parseTokens(tokens, i + 1, currentNode.parent || parentNode, chess);

                    // Restore position after variation
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
            includeNags = true,
            lineWidth = 80
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
                // Alternative variation
                result += ' (';
            }

            // Move number
            if (isWhite) {
                result += `${moveNum}. `;
            } else if (!isFirst || !isMainline) {
                result += `${moveNum}... `;
            }

            // Move
            result += child.move;

            // NAGs
            if (includeNags && child.nags.length > 0) {
                for (const nag of child.nags) {
                    const sym = PGNParser.NAG_REVERSE[nag];
                    result += sym ? sym : ` $${nag}`;
                }
            }

            // Comment
            if (includeComments && child.comment) {
                result += ` {${child.comment}}`;
            }

            // Recurse
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
     * Validate PGN text (basic check).
     */
    static validate(pgnText) {
        try {
            const games = PGNParser.splitGames(pgnText);
            if (games.length === 0) return { valid: false, error: 'No games found' };

            // Try to parse the first game
            const chess = new Chess();
            const tokens = PGNParser.tokenize(games[0].movetext);
            let moveCount = 0;
            for (const token of tokens) {
                if (token.type === 'move') {
                    const result = chess.move(token.value, { sloppy: true });
                    if (!result) {
                        return { valid: false, error: `Invalid move: ${token.value}` };
                    }
                    moveCount++;
                }
            }

            return {
                valid: true,
                gameCount: games.length,
                firstGameMoves: moveCount
            };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }
}

window.PGNParser = PGNParser;
