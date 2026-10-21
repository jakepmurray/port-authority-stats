# Port Authority Stats

Free, open-source ultimate frisbee stats for **Port Authority** (club Mixed), built around **game film**.
Paste a YouTube link, watch the game beside a stat panel, and every stat you enter is stamped with the video time.

**Try it:** https://jakepmurray.github.io/port-authority-stats/

- Local-first PWA: data lives in your browser (IndexedDB). Installable, works offline (the video itself needs a connection).
- Free tools only. MIT licensed. See [PLAN.md](PLAN.md) for the roadmap.

## How to use

1. **Roster:** add players with number and gender match (WMP/MMP).
2. **New game:** opponent, tournament, first-point ratio (ABBA), whether you start on O or D, caps preset
   (USAU 2026 pool play 45′/90′/105′ or semis/finals 52′/105′), and the YouTube link.
3. **Start each point:** tap the 7 players. The app checks the ABBA ratio and the majority-pull rule.
   "Last O line" / "Last D line" copy a previous line.
4. **Enter stats while the film plays.** Every event stores the current video time.

| Key | Does |
|---|---|
| `0–9` | Player number. First touch = pickup; next numbers = completed passes (thrower is implied). Ambiguous numbers (`1` when `12` exists) wait ~1 s or take `Enter`. |
| `G` | Goal. Ours: then the scorer's number (Quick mode: assist, then scorer). Theirs: just `G`. |
| `T` / `D` / `S` / `X` | Throwaway / drop (then receiver) / stall / other turnover, by whoever has the disc. |
| `B` | Block. On their possession: then our defender's number. |
| `C` | Callahan. |
| `P` | Pull (in). OB / brick buttons on screen. |
| `-` | Unknown player for the current slot. |
| `U`, `Backspace`, `Ctrl+Z` | Undo. `Esc` cancels a half-typed command. |
| `Space`, `←`/`→` (`Shift` = 1 s), `[` / `]` | Play/pause, seek ±5 s, 0.5× / 1× speed. |

- **Layouts:** *Video* (side by side), *Collapse* (video hidden but still playing), *Pop out* (video in its own window for a
  second screen, kept in sync), *Stats only* (no video; type a timestamp or leave it blank).
- **Full / Quick:** Full is pass-by-pass. Quick is goals, assists, Ds and turns only.
- **Play-by-play:** click a time to jump the film there (3 s before). Edit, insert (`+`) or delete any event; edit any point
  (line, O/D, ratio, puller). Deletes are soft and can be restored ("show deleted"). Hand edits are marked *edited*.
- **Caps:** set the game start with *Set game start*; the game clock warns when a cap is due. Press *half/soft/hard cap*
  during the point when it goes on; the app finishes the point and sets the new target (higher score + 1).
- **Data:** download a JSON backup after each game; restore (merge or replace) on any device. CSV export for player stats,
  games, points and events (with YouTube links to each moment).

## Stat definitions

- Completion: a catch or goal thrown by the player. Attempts = completions + throwaways + drops on their throws.
- Hockey assist: the pass right before the assist, in the same possession.
- Turnovers: throwaways + drops (charged to the receiver) + stalls + other turns.
- +/-: goals + assists + Ds − turnovers.
- O conversion: holds ÷ finished O points. D break %: breaks ÷ finished D points.
- The opponent is tracked at team level only.

## Develop

```bash
npm ci
npm run dev        # http://localhost:5173/port-authority-stats/
npm test           # Vitest
npm run lint       # oxlint
npm run typecheck  # tsc
npm run build
```

Code layout: `src/domain` (pure logic: schema, ABBA, game derivation, stats, entry, exports — all unit-tested),
`src/db` (Dexie + actions), `src/ui` (React). Pushes to `main` run CI (lint, typecheck, tests) and deploy to GitHub Pages.
