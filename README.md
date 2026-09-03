[نسخه فارسی](README.fa.md)

# Shelem Scoreboard

A scoreboard for **Shelem** (شلم), the Persian trick-taking card game. Track the declarer and contract for each hand, and the running totals, point difference, and winner are worked out for you.

The interface is in Persian and lays out right-to-left. Everything else (the code, this README) is in English.

> Live: [lordarma.com/shelem](https://lordarma.com/shelem/)

## What it does

- **Per-hand entry:** pick the declarer (حاکم) and their contract (تعهد), then enter both teams' scores.
- **Assist calculator:** type the card points the declarer actually collected and both scores are filled in, including the opponent's share and a negative contract when the declarer goes set.
- **Live totals:** running sums per hand, point difference, progress bars, "points to target" per team, and a winner banner on the hand where the target is first crossed.
- **Two house variants:** With Joker and Without Joker, which change both the legal contract range and the points available in a hand (see below).
- **Sanity notes:** a non-blocking hint when a hand looks wrong, e.g. a declarer scoring below their own contract, or a hand totalling more than the deck allows.
- **Undo:** 40 steps deep, covering hand deletion, resets, and mode switches.
- **New game:** a reset button in the action bar clears every hand and score behind a confirmation step, leaving team names, target score, mode, and calculator rule untouched. It is undoable too.
- **Copy summary:** the whole game as plain text, hand by hand, for pasting into a chat.
- **Autosave:** the game is kept in `localStorage`, so a refresh or a closed tab loses nothing.

## Game modes

The scoring depends on which deck the table is using, since a joker carries card points of its own.

| Mode | Persian | Contract range | Points in a hand |
| --- | --- | --- | --- |
| Without Joker (default) | بدون جوکر | 100-165 | 165 |
| With Joker | با جوکر | 120-200 | 200 |

Contracts step by 5, and the top of each range is a **shelem** (a bid for every point in the deck). The declarer's score and the opponents' share always sum to the mode's total, so switching modes rescales the calculator. Contracts already on the table are clamped into the new range when you switch, rather than being left as impossible bids.

The **calculator rule** setting decides what a successful declarer is credited with: their contract (به اندازه تعهد) or the points they actually took (امتیاز واقعی). A declarer who goes set always scores minus their contract.

The default target score is **1200**; change it in settings.

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl` / `Cmd` + `Enter` | Add a new hand |
| `Ctrl` / `Cmd` + `Z` | Undo |
| `Enter` | Commit a team name, or apply the calculator |

## Running it

Pure static files: no build step, no package manager, no dependencies. Serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly as a `file://` URL mostly works, but the browser will refuse to load the fonts, so serve it instead.

Deploying is a matter of copying the folder to any static host.

## Project layout

```
index.html              markup only
assets/
  css/fonts.css         @font-face declarations
  css/style.css         all styles
  js/app.js             all logic
  fonts/*.woff2         6 self-hosted subsets (~185 KB)
  img/favicon-32.png
```

**No external requests.** Both fonts are self-hosted as woff2: [Lalezar](https://fonts.google.com/specimen/Lalezar) for display, [Vazirmatn](https://fonts.google.com/specimen/Vazirmatn) for body text. They are split into `arabic` / `latin` / `latin-ext` subsets with `unicode-range` so a browser fetches only what the page actually needs. Nothing is loaded from a CDN, and nothing is phoned home.

## Notes on the code

`app.js` is a single plain-JavaScript file, no framework, structured as:

```
state  ->  derive()  ->  render()  (rebuilds cards)
                     \-> paint()   (numbers only)
```

`paint()` deliberately never rewrites input values, so typing into a score field never moves the caret. Events are delegated, one listener per event type on the hands container, so re-rendering costs nothing in bookkeeping.

Two details worth knowing if you touch the number handling:

- **Digits.** Numbers display as Persian digits, but the parser accepts Persian, Arabic-Indic, and ASCII digits, plus the ASCII hyphen, Unicode minus, en dash, and em dash as a minus sign.
- **Bidi.** A minus sign is bidi-neutral, so inside an RTL run `-120` renders as `۱۲۰−` with the sign on the wrong side. Negative numbers are therefore wrapped in an LTR isolate (`U+2066` … `U+2069`), which fixes both the rendered page and the copied summary. Numeric inputs are set `direction: ltr` for the same reason.

Saved games live under the `shelem.v2` key; games from the older version of this table are migrated on first load.

## License

[MIT](LICENSE).

The bundled fonts are third-party and carry their own terms: Lalezar and
Vazirmatn are both licensed under the SIL Open Font License 1.1.

## Credits

Built by [Arma](https://lordarma.com/).
