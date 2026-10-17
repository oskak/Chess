/**
 * Small, annotated sample repertoires offered on first run so the trainer
 * can be tried immediately. Each entry is plain PGN (one game per line),
 * merged into a single tree on import.
 */

const SAMPLE_REPERTOIRES = [
    {
        name: 'Sample: Italian Game (White)',
        color: 'white',
        pgn: `
[Event "Italian - Giuoco Pianissimo"]
1. e4 {Control the centre and open lines for the bishop and queen.} e5 2. Nf3 {Develop with tempo: the knight attacks e5.} Nc6 3. Bc4 {The Italian Game: the bishop eyes f7, Black's weakest square.} Bc5 4. c3 {Prepares d4 to build a big pawn centre.} Nf6 5. d3 {The slow Italian: solid and flexible, keeps all the tension.} d6 6. O-O O-O 7. Re1 a6 8. a4 {Stops ...b5 from harassing the bishop.} *

[Event "Italian - Two Knights"]
1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 {Avoids the sharp Two Knights theory and keeps a calm position.} Be7 5. O-O O-O 6. Re1 d6 7. c3 *

[Event "vs Sicilian"]
1. e4 c5 2. Nf3 d6 3. d4 {The Open Sicilian: trade the c-pawn for the d-pawn and develop quickly.} cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 {The English Attack setup: f3, Qd2, O-O-O and a kingside pawn storm.} *

[Event "vs French"]
1. e4 e6 2. d4 d5 3. Nd2 {The Tarrasch: avoids the Winawer pin with ...Bb4.} Nf6 4. e5 Nfd7 5. Bd3 c5 6. c3 Nc6 7. Ne2 *

[Event "vs Caro-Kann"]
1. e4 c6 2. d4 d5 3. e5 {The Advance: gain space and cramp Black.} Bf5 4. Nf3 e6 5. Be2 c5 6. Be3 *
`
    },
    {
        name: 'Sample: Caro-Kann (Black)',
        color: 'black',
        pgn: `
[Event "Caro-Kann Classical"]
1. e4 c6 {Prepares ...d5 with a rock-solid pawn chain.} 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 {The Classical: develop the light-squared bishop before closing it in with ...e6.} 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 8. h5 Bh7 9. Bd3 Bxd3 10. Qxd3 e6 {Solid set-up; next ...Ngf6, ...Be7 and ...O-O.} *

[Event "Caro-Kann Advance"]
1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 5. Be2 c5 {Strike at the centre immediately, before White completes development.} 6. O-O Nc6 *

[Event "Caro-Kann Exchange"]
1. e4 c6 2. d4 d5 3. exd5 cxd5 4. Bd3 Nc6 5. c3 Nf6 6. Bf4 Bg4 {Develop the bishop actively before ...e6; it also hits the queen.} *

[Event "Caro-Kann Two Knights"]
1. e4 c6 2. Nf3 d5 3. Nc3 Bg4 {Pin the knight; the bishop trade gives Black easy development.} 4. h3 Bxf3 5. Qxf3 e6 *

[Event "Caro-Kann Panov-style"]
1. e4 c6 2. c4 d5 3. exd5 cxd5 4. cxd5 Nf6 {Regain the pawn with piece play.} 5. Nc3 Nxd5 *
`
    }
];

window.SAMPLE_REPERTOIRES = SAMPLE_REPERTOIRES;
