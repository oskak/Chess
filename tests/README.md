# Tests

```bash
npm install            # first time (jsdom, fake-indexeddb, stockfish, playwright)
npm test               # fast suites, no browser needed
npm run test:e2e       # real Chromium
npm run test:electron  # desktop app (Linux: xvfb-run -a npm run test:electron)
```

| Command | What it proves |
|---|---|
| `npm run test:logic`  | Core logic in Node: move tree & serialization, trainer (full lines: completion on either side, grading by misses, re-queue, alternatives, learn→review scheduling, per-move stats), PGN, ECO, transposition keys, engine wrapper with a scripted fake UCI worker (White-perspective scores, search sequencing, game over, MultiPV), IndexedDB + backup. **160 checks.** |
| `npm run test:wiring` | Every DOM id used by `js/app.js` exists in `index.html`. |
| `npm run test:boot`   | The full app boots in jsdom with the real vendor libraries and renders the board. |
| `npm run test:engine` | The real Stockfish 18 WASM returns an evaluation over UCI. |
| `npm run test:e2e`    | Drives the app in Chromium like a user (50 checks): sample repertoires, learning with arrows via click-to-move, a review with a miss (grading, re-queue, weak spots), explorer navigation/edit mode/notes/NAGs, Stockfish in a Web Worker (sign of the score, MultiPV, best-move arrow), promotion picker, checks in the sandbox, the new-repertoire dialog, and the mobile layout. Fails on any page error or native `alert/confirm/prompt`. Set `E2E_SHOTS=dir` to save screenshots, `HEADED=1` to watch. |
| `npm run test:electron` | The desktop app from `file://`: the new-repertoire dialog (Electron has no `prompt()`), Stockfish loading from `file://`, click-to-move. |

Helper files: `tests/harness.js` loads the browser modules into a Node VM.
