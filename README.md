# Chess Opening Repertoire Trainer

Build your opening repertoire and make it stick. Import or build lines move by
move, learn them with arrows on the board, and review them with spaced
repetition just before you would forget them. Includes a full move-tree
explorer with notes, transposition detection, ECO opening names, a free
sandbox board and **Stockfish 18** analysis. Runs entirely offline — your data
lives in your browser (IndexedDB) and is never sent anywhere.

![CI](https://github.com/oskak/chess/actions/workflows/ci.yml/badge.svg)

---

## Quick start

**Easiest: use it online — nothing to install.** The `main` branch is
published with GitHub Pages at **https://oskak.github.io/Chess/**. In Chrome or
Edge, click the *Install* icon in the address bar to get it as an app with its
own window and desktop icon. It also works **offline** after the first visit.

**Or run it locally:**

```bash
npm install      # first time only
npm run web      # then open http://localhost:8080
```

Or run it as a desktop app (Electron):

```bash
npm start
```

Both load the exact same app. To update after new changes are pushed:

```bash
git pull origin main
npm install
npm run web      # or: npm start
```

> First time? Click **Try the sample repertoires** on the start screen — you get
> an Italian Game (White) and a Caro-Kann (Black) repertoire to train right away.

---

## How training works

1. **Learn** — a line you have never seen is played out with a green arrow on
   each of your moves (and its note, if it has one). You replay it.
2. **Review** — about 4 hours later the line is due. Now you play it from
   memory. The opponent's replies are played for you.
3. **Spaced repetition (SM-2)** — a line played without a miss comes back after
   1 day, then 3 days, then at growing intervals. Any miss (wrong move, hint or
   "show move") resets it, and it is repeated once more at the end of the session.
4. Every one of your moves is also tracked individually, so the tree view and
   the explorer show which moves you actually know (green) and which you keep
   missing (red).

Playing *another* move from your repertoire at a branch point is not a
mistake — you are told the line trains a different move and can try again.

## Features

- **Trainer** — learn/review modes, hints (highlight the piece), show-move
  arrows, per-line grading, per-move accuracy, session summary, due counts.
- **Explorer** — browse the repertoire with arrows for your prepared moves,
  ◀ ▶ navigation (mainline forward), **Edit mode** to build lines by playing
  moves, **notes and move-quality marks** (!, ?, !!, ??, !?, ?!) for every move,
  "Train from here", transposition links, right-click menu on the tree
  (train from here, set mainline, enable/disable, delete).
- **Stockfish 18** — runs in your browser (WASM): evaluation bar beside the
  board, the top three lines (click one to play it), best-move arrow.
- **Sandbox** — a free board: play any moves, load a FEN, copy FEN/PGN, save
  the line into a new or existing repertoire.
- **PGN import/export** — variations, comments and NAGs are kept; unreadable
  moves are reported instead of silently dropped. Multi-language piece letters
  (Czech, German, French, Spanish…) are detected automatically.
- **Click or drag** — tap a piece then a square, or drag it. Pawn promotion
  opens a piece picker.
- **Backup & restore** — download everything (including training progress) as
  a JSON file and restore it on any machine.

### Keyboard shortcuts

Press **?** in the app for the full list.

| Key | Action |
|-----|--------|
| `←` / `→` | Back / forward (Explorer), undo / redo (Sandbox) |
| `Home` / `End` | Start position / end of mainline |
| `F` | Flip board |
| `E` | Engine on / off |
| `H` / `S` | Hint / show the move (Training) |
| `N` or `Enter` | Next line (Training) |
| `M` | Sounds on / off |

---

## Your data & backups

Everything is stored locally in your browser (or in the desktop app) via
**IndexedDB**: it survives restarts and works offline, and progress is saved
after every training line. Click **💾 Backup** (top right) now and then — the
start screen reminds you when your last backup is older than a week. Use
**Restore Backup** to load it back, e.g. on another computer.

Note: data is stored per address, so the online version, `npm run web`
(localhost:8080) and the desktop app (`npm start`) each keep **separate**
data. Use Backup/Restore to move data between them.

---

## Development & testing

Plain HTML/CSS/JS with vendored libraries in `vendor/` (jQuery, chessboard.js,
chess.js, Stockfish 18) — no build step.

```bash
npm test               # logic, DOM wiring, boot, engine (no browser needed)
npm run test:e2e       # end-to-end in real Chromium (Playwright)
npm run test:electron  # the desktop app (Linux needs: xvfb-run -a npm run test:electron)
```

See [`tests/README.md`](tests/README.md) for what each suite covers. CI
(GitHub Actions) runs all of them on every push.

### Project layout

```
index.html              app shell
css/app.css             styles
js/
  app.js                main controller (views, board, explorer, trainer UI, sandbox)
  trainer.js            spaced-repetition engine (learn → review, SM-2 grading)
  move-tree.js          repertoire data model (trie, per-move stats, transpositions)
  engine.js             Stockfish wrapper (Web Worker + UCI, MultiPV, sequencing)
  board-overlay.js      SVG arrows over the board
  dialogs.js            modal dialogs, promotion picker, toasts
  pgn-parser.js         PGN import/export
  db.js                 IndexedDB persistence, backup, repertoire summaries
  eco.js                ECO opening names
  sample-repertoires.js sample repertoires for first run
  pieces.js, sounds.js  inline SVG pieces, synthesized sounds
scripts/serve.js        dependency-free local web server (npm run web)
sw.js, manifest.webmanifest, icons/   installable app + offline support (network-first)
electron-main.js        desktop app entry (npm start)
vendor/                 jQuery, chessboard.js, chess.js, Stockfish 18 WASM
tests/                  automated tests
```

---

## License

MIT. Stockfish is GPLv3 (see `vendor/stockfish`).
