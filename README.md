# Chess Opening Repertoire Trainer

Build and drill your chess opening repertoire with spaced repetition, a full
move tree, transposition detection, ECO opening names, a free-play sandbox, and
an integrated **Stockfish 18** engine. Runs entirely offline — your data lives in
your browser (IndexedDB), nothing is sent anywhere.

![CI](https://github.com/oskak/chess/actions/workflows/ci.yml/badge.svg)

---

## Quick start

```bash
npm install      # first time only
npm run web      # serve at http://localhost:8080
```

Then open **http://localhost:8080** in your browser.

> **Desktop app (optional):** `npm start` launches it in an Electron window
> instead of the browser. Both load the exact same app.

To get the latest version after changes are pushed:

```bash
git pull origin main
npm install
npm run web
```

---

## Features

- **Spaced-repetition training (SM-2)** — drills your weakest lines first,
  schedules reviews, tracks accuracy and streaks per move.
- **Move tree explorer** — browse your whole repertoire, collapse/expand
  branches, see accuracy colour-coding, enable/disable lines, right-click to
  set mainline or delete.
- **Transposition detection** — positions reachable by multiple move orders are
  detected and linked (en-passant-aware, so it doesn't miss real transpositions).
- **ECO opening names** — shows e.g. *B90: Sicilian, Najdorf* as you navigate.
- **Stockfish 18 engine** — eval bar, best line, and score in the explorer and
  sandbox (toggle with the gear button or the `E` key).
- **Sandbox** — a free board separate from your repertoires: play any moves,
  load a FEN, copy FEN/PGN, or save a line as a new repertoire.
- **PGN import** — paste or load `.pgn` files (multi-language piece notation
  supported); variations, comments and NAGs are preserved.
- **Backup & restore** — export all repertoires (incl. training stats) to a JSON
  file and import it back. Persistent-storage is requested so the browser won't
  evict your data.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `←` / `→` | Undo / redo (explorer & sandbox) |
| `F` | Flip board |
| `E` | Toggle engine (explorer & sandbox) |
| `H` | Toggle hints (training) |
| `M` | Mute / unmute sounds |

---

## Your data & backups

Everything is stored locally in your browser via **IndexedDB** — it survives
closing the browser and works fully offline. Two things to know:

1. The app requests **persistent storage** so the browser won't clear it under
   disk pressure.
2. Still, click **💾 Backup** (top-right) every so often to download a JSON copy.
   If you ever clear browser data or switch machines, use **Restore Backup** to
   load it back. This is the only way data moves between devices.

---

## Development & testing

The app is plain HTML/CSS/JS with vendored libraries in `vendor/` (jQuery,
chessboard.js, chess.js, Stockfish 18) — no build step.

Run the automated test suite (no browser needed):

```bash
npm test
```

It runs four suites — see [`tests/README.md`](tests/README.md):

- **logic** — move tree, serialization, SM-2 training, PGN, ECO, engine parsing,
  IndexedDB (74 checks)
- **wiring** — every DOM id referenced in JS exists in the HTML
- **boot** — the full app boots in jsdom and the board renders
- **engine** — the real Stockfish 18 WASM returns an evaluation

CI (GitHub Actions) runs the whole suite on Node 20 and 22 for every push.

### Project layout

```
index.html            app shell
css/app.css           styles
js/
  app.js              main controller (views, board, events)
  move-tree.js        repertoire data model (trie + transpositions)
  trainer.js          SM-2 spaced-repetition engine
  pgn-parser.js       PGN import/export
  engine.js           Stockfish wrapper (Web Worker + UCI)
  eco.js              ECO opening-name lookup
  db.js               IndexedDB persistence + backup
  pieces.js           inline SVG pieces (no image files needed)
  sounds.js           move/capture/check sound effects
vendor/               jQuery, chessboard.js, chess.js, Stockfish 18 WASM
tests/                automated test suites
```

---

## License

MIT
