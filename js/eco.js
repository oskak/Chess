/**
 * ECO Opening Names Database (compact)
 *
 * Maps FEN position (first 4 fields) to ECO code and opening name.
 * Covers ~300 most important opening positions.
 */

const ECO_DATABASE = {
    // Starting position
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": { code: "", name: "Starting Position" },

    // 1. e4
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3": { code: "B00", name: "King's Pawn" },
    // 1. e4 e5
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6": { code: "C20", name: "King's Pawn Game" },
    // 1. e4 e5 2. Nf3
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": { code: "C40", name: "King's Knight Opening" },
    // 1. e4 e5 2. Nf3 Nc6
    "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -": { code: "C44", name: "King's Pawn Game" },
    // Italian 1. e4 e5 2. Nf3 Nc6 3. Bc4
    "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -": { code: "C50", name: "Italian Game" },
    // Italian 3...Bc5
    "r1bqk1nr/pppp1ppp/2n5/4p3/2B1Pb2/5N2/PPPP1PPP/RNBQK2R w KQkq -": { code: "C50", name: "Giuoco Piano" },
    // Italian 3...Nf6
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": { code: "C55", name: "Two Knights Defense" },
    // Ruy Lopez 3. Bb5
    "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq -": { code: "C60", name: "Ruy Lopez" },
    // Ruy Lopez 3...a6
    "r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": { code: "C68", name: "Ruy Lopez, Exchange" },
    // Ruy Lopez 3...a6 4. Ba4
    "r1bqkbnr/1ppp1ppp/p1n5/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R b KQkq -": { code: "C70", name: "Ruy Lopez" },
    // Ruy Lopez 3...a6 4. Ba4 Nf6
    "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": { code: "C78", name: "Ruy Lopez, Morphy" },
    // Ruy Lopez 3...a6 4. Ba4 Nf6 5. O-O
    "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 b kq -": { code: "C78", name: "Ruy Lopez, Morphy" },
    // Scotch 3. d4
    "r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3": { code: "C45", name: "Scotch Game" },
    // Petrov 2...Nf6
    "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -": { code: "C42", name: "Petrov's Defense" },
    // King's Gambit 2. f4
    "rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq f3": { code: "C30", name: "King's Gambit" },
    // Vienna 2. Nc3
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq -": { code: "C25", name: "Vienna Game" },

    // Sicilian 1...c5
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6": { code: "B20", name: "Sicilian Defense" },
    // Sicilian 2. Nf3
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": { code: "B27", name: "Sicilian Defense" },
    // Sicilian 2. Nf3 d6
    "rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -": { code: "B50", name: "Sicilian" },
    // Sicilian 2. Nf3 d6 3. d4
    "rnbqkbnr/pp2pppp/3p4/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3": { code: "B50", name: "Sicilian, Open" },
    // Sicilian 2. Nf3 d6 3. d4 cxd4 4. Nxd4
    "rnbqkbnr/pp2pppp/3p4/8/3NP3/8/PPP2PPP/RNBQKB1R b KQkq -": { code: "B50", name: "Sicilian, Open" },
    // Sicilian Najdorf 5...a6
    "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq -": { code: "B90", name: "Sicilian, Najdorf" },
    // Sicilian Dragon 5...g6
    "rnbqkb1r/pp2pp1p/3p1np1/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq -": { code: "B70", name: "Sicilian, Dragon" },
    // Sicilian Classical 5...Nc6
    "r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq -": { code: "B56", name: "Sicilian, Classical" },
    // Sicilian Scheveningen 5...e6
    "rnbqkb1r/pp3ppp/3ppn2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq -": { code: "B80", name: "Sicilian, Scheveningen" },
    // Sicilian Sveshnikov 5...e5
    "r1bqkb1r/pp3ppp/2np1n2/4p3/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq -": { code: "B33", name: "Sicilian, Sveshnikov" },
    // Sicilian 2. Nf3 Nc6
    "r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -": { code: "B30", name: "Sicilian, Old" },
    // Sicilian 2. Nf3 e6
    "rnbqkbnr/pp1p1ppp/4p3/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -": { code: "B40", name: "Sicilian" },
    // Sicilian Alapin 2. c3
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/2P5/PP1P1PPP/RNBQKBNR b KQkq -": { code: "B22", name: "Sicilian, Alapin" },
    // Sicilian Closed 2. Nc3
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq -": { code: "B23", name: "Sicilian, Closed" },

    // French 1...e6
    "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": { code: "C00", name: "French Defense" },
    // French 2. d4 d5
    "rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq d6": { code: "C00", name: "French Defense" },
    // French 3. Nc3
    "rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq -": { code: "C03", name: "French, Tarrasch" },
    // French 3. Nd2
    "rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPPN1PPP/R1BQKBNR b KQkq -": { code: "C01", name: "French, Exchange" },
    // French 3. e5
    "rnbqkbnr/ppp2ppp/4p3/3pP3/3P4/8/PPP2PPP/RNBQKBNR b KQkq -": { code: "C02", name: "French, Advance" },
    // French Winawer 3...Bb4
    "rnbqk1nr/ppp2ppp/4p3/3p4/1b1PP3/2N5/PPP2PPP/R1BQKBNR w KQkq -": { code: "C15", name: "French, Winawer" },
    // French Classical 3...Nf6
    "rnbqkb1r/ppp2ppp/4pn2/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR w KQkq -": { code: "C11", name: "French, Classical" },

    // Caro-Kann 1...c6
    "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": { code: "B10", name: "Caro-Kann Defense" },
    // Caro-Kann 2. d4 d5
    "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq d6": { code: "B12", name: "Caro-Kann" },
    // Caro-Kann Advance 3. e5
    "rnbqkbnr/pp2pppp/2p5/3pP3/3P4/8/PPP2PPP/RNBQKBNR b KQkq -": { code: "B12", name: "Caro-Kann, Advance" },
    // Caro-Kann 3. Nc3
    "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq -": { code: "B13", name: "Caro-Kann" },
    // Caro-Kann 3. Nc3 dxe4 4. Nxe4
    "rnbqkbnr/pp2pppp/2p5/8/3PN3/8/PPP2PPP/R1BQKBNR b KQkq -": { code: "B15", name: "Caro-Kann, Main" },

    // Pirc 1...d6
    "rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": { code: "B07", name: "Pirc Defense" },
    // Scandinavian 1...d5
    "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6": { code: "B01", name: "Scandinavian Defense" },
    // Alekhine 1...Nf6
    "rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": { code: "B02", name: "Alekhine's Defense" },

    // 1. d4
    "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3": { code: "A40", name: "Queen's Pawn" },
    // 1. d4 d5
    "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq d6": { code: "D00", name: "Queen's Pawn Game" },
    // 1. d4 d5 2. c4
    "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3": { code: "D06", name: "Queen's Gambit" },
    // QGD 2...e6
    "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -": { code: "D30", name: "Queen's Gambit Declined" },
    // QGA 2...dxc4
    "rnbqkbnr/ppp1pppp/8/8/2pP4/8/PP2PPPP/RNBQKBNR w KQkq -": { code: "D20", name: "Queen's Gambit Accepted" },
    // Slav 2...c6
    "rnbqkbnr/pp2pppp/2p5/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -": { code: "D10", name: "Slav Defense" },

    // 1. d4 Nf6
    "rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w KQkq -": { code: "A45", name: "Indian Defense" },
    // 1. d4 Nf6 2. c4
    "rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3": { code: "A50", name: "Indian Defense" },
    // Nimzo-Indian 3. Nc3 Bb4
    "rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR w KQkq -": { code: "E20", name: "Nimzo-Indian Defense" },
    // Queen's Indian 3. Nf3 b6
    "rnbqkb1r/p1pp1ppp/1p2pn2/8/2PP4/5N2/PP2PPPP/RNBQKB1R w KQkq -": { code: "E15", name: "Queen's Indian Defense" },
    // King's Indian 2...g6
    "rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -": { code: "E60", name: "King's Indian Defense" },
    // King's Indian Classical
    "rnbq1rk1/ppp1ppbp/3p1np1/8/2PPP3/2N2N2/PP2BPPP/R1BQK2R b KQ -": { code: "E92", name: "King's Indian, Classical" },
    // Grünfeld 3. Nc3 d5
    "rnbqkb1r/ppp1pp1p/5np1/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq d6": { code: "D80", name: "Grünfeld Defense" },
    // Benoni 2...c5
    "rnbqkb1r/pp1ppppp/5n2/2p5/2PP4/8/PP2PPPP/RNBQKBNR w KQkq c6": { code: "A56", name: "Benoni Defense" },
    // Dutch 1...f5
    "rnbqkbnr/ppppp1pp/8/5p2/3P4/8/PPP1PPPP/RNBQKBNR w KQkq f6": { code: "A80", name: "Dutch Defense" },
    // Budapest 2...e5
    "rnbqkb1r/pppp1ppp/5n2/4p3/2PP4/8/PP2PPPP/RNBQKBNR w KQkq e6": { code: "A51", name: "Budapest Gambit" },

    // 1. d4 d5 2. c4 e6 3. Nc3
    "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq -": { code: "D31", name: "QGD, Semi-Tarrasch" },
    // 1. d4 d5 2. c4 e6 3. Nc3 Nf6
    "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq -": { code: "D35", name: "QGD, Exchange" },
    // Catalan 3. g3
    "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/6P1/PP2PP1P/RNBQKBNR b KQkq -": { code: "E00", name: "Catalan Opening" },

    // English 1. c4
    "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq c3": { code: "A10", name: "English Opening" },
    // English Symmetrical 1...c5
    "rnbqkbnr/pp1ppppp/8/2p5/2P5/8/PP1PPPPP/RNBQKBNR w KQkq c6": { code: "A30", name: "English, Symmetrical" },
    // English 1...e5
    "rnbqkbnr/pppp1ppp/8/4p3/2P5/8/PP1PPPPP/RNBQKBNR w KQkq e6": { code: "A20", name: "English, Reversed Sicilian" },
    // English 1...Nf6
    "rnbqkb1r/pppppppp/5n2/8/2P5/8/PP1PPPPP/RNBQKBNR w KQkq -": { code: "A15", name: "English, Anglo-Indian" },

    // Reti 1. Nf3
    "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq -": { code: "A04", name: "Réti Opening" },
    // Reti 1. Nf3 d5
    "rnbqkbnr/ppp1pppp/8/3p4/8/5N2/PPPPPPPP/RNBQKB1R w KQkq d6": { code: "A05", name: "Réti Opening" },
    // Reti 1. Nf3 Nf6
    "rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq -": { code: "A06", name: "Réti Opening" },

    // London 1. d4 d5 2. Bf4
    "rnbqkbnr/ppp1pppp/8/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR b KQkq -": { code: "D00", name: "London System" },
    // London 1. d4 Nf6 2. Bf4
    "rnbqkb1r/pppppppp/5n2/8/3P1B2/8/PPP1PPPP/RN1QKBNR b KQkq -": { code: "A45", name: "London System" },

    // Misc openings
    "rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/R1BQKBNR b KQkq -": { code: "A00", name: "Van't Kruijs / Uncommon" },
    "rnbqkbnr/pppppppp/8/8/8/6P1/PPPPPP1P/RNBQKBNR b KQkq -": { code: "A00", name: "Hungarian Opening" },
    "rnbqkbnr/pppppppp/8/8/8/1P6/P1PPPPPP/RNBQKBNR b KQkq -": { code: "A01", name: "Larsen's Opening" },
    "rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq -": { code: "A00", name: "Ware Opening" },
    "rnbqkbnr/pppppppp/8/8/1P6/8/P1PPPPPP/RNBQKBNR b KQkq -": { code: "A00", name: "Polish Opening" },
    "rnbqkbnr/pppppppp/8/8/5P2/8/PPPPP1PP/RNBQKBNR b KQkq f3": { code: "A02", name: "Bird's Opening" },
};

/**
 * Look up the ECO code and opening name for a given FEN.
 * @param {string} fen - Full FEN or position FEN (first 4 fields)
 * @returns {Object|null} { code: "B90", name: "Sicilian, Najdorf" } or null
 */
function lookupECO(fen) {
    // Normalize: take first 4 fields
    const parts = fen.split(' ');
    const key = parts.slice(0, 4).join(' ');
    return ECO_DATABASE[key] || null;
}

window.lookupECO = lookupECO;
window.ECO_DATABASE = ECO_DATABASE;
