# Tests

Automated verification that the app's features actually work. No browser needed —
everything runs in Node.

```bash
npm install     # first time (installs jsdom, fake-indexeddb, stockfish)
npm test        # run everything
```

Or run individually:

| Command | What it proves |
|---|---|
| `npm run test:logic`  | Core logic: move tree, serialization, training (SM-2), PGN parse/export, ECO names, engine UCI parsing, IndexedDB save/load + backup round-trip. **74 checks.** |
| `npm run test:wiring` | Every DOM id referenced in `js/app.js` actually exists in `index.html` (catches dead buttons / silently broken features). |
| `npm run test:boot`   | The full app (with real jQuery + chessboard.js + chess.js) instantiates and `init()` runs without errors. The board renders. |
| `npm run test:engine` | The vendored **Stockfish 18** WASM actually evaluates a position and returns a best move over UCI. |

## What the suites cover

### `tests/run.js` — functional logic (74 checks)
Loads the real app modules in a Node VM and exercises them:
- **MoveTree**: addLine/getNodeAt, branching, serialize↔deserialize round-trip
  (comments, NAGs, all stats fields, `enabled`, `collapsed`), toggle/delete/setMainline,
  transposition detection, accuracy helper.
- **PGNParser**: parse mainline + variations, comments, NAGs, export.
- **Trainer**: line-queue building, **disabled lines are skipped**, the
  `startSession → nextLine → submitMove` flow, SM-2 interval/ease updates.
- **ECO**: every stored FEN is legal, and replaying real openings
  (Italian, Ruy Lopez, Sicilian, French, Caro-Kann, QGD, KID, English, Réti)
  returns the right name.
- **Engine helpers**: UCI `info` parsing, score formatting, eval-bar %, UCI→SAN.
- **DB** (fake-indexeddb): save→load preserves stats; export→delete→import restores.

### `tests/wiring.js` — DOM wiring audit
Parses `index.html` for all `id="…"` and `js/app.js` for all
`getElementById('…')` / `querySelector('#…')`, then verifies every reference
resolves (dynamically-injected ids are whitelisted).

### `tests/boot.js` — full boot in jsdom
Loads exactly what `index.html` loads, constructs `App`, runs `init()`, and
asserts no runtime errors and that chessboard.js populated the board element.

### `tests/engine-smoke.js` — real Stockfish 18
Runs the actual engine (`node_modules/stockfish`, byte-identical to
`vendor/stockfish/`) and asserts it emits `uciok`, a `score`, and a legal
`bestmove`.
