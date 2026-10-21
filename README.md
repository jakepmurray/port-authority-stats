# Port Authority Stats

Free, open-source ultimate frisbee stats for **Port Authority** (club Mixed), built around **game film**.
Paste a YouTube link, watch the game beside a stat panel, and every stat you enter is stamped with the video time.

**Try it:** https://jakepmurray.github.io/port-authority-stats/

- Local-first PWA: data lives in your browser (IndexedDB). Installable, works offline (the video itself needs a connection). When a new version is deployed, a "New version available" bar appears: click Reload to switch (your data is kept).
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
| `R` | Mid-point sub: number of who comes off, then who comes on (`I` = injury sub, `Enter` saves, `-` unknown). |
| `F` | Call: `1–8` type (foul, travel, pick, strip, contact, stall, offside, other), `U`/`T` who called it, our player's number (`Enter` skips), then `1–5` outcome (contested, uncontested, retracted, disc back to thrower, turnover), which saves. |
| `-` | Unknown player for the current slot. |
| `U`, `Backspace`, `Ctrl+Z` | Undo. `Esc` cancels a half-typed command. |
| `Space`, `←`/`→` (`Shift` = 1 s), `[` / `]` | Play/pause, seek ±5 s, 0.5× / 1× speed. |

- **Layouts:** *Video* (side by side), *Collapse* (video hidden but still playing), *Pop out* (video in its own window for a
  second screen, kept in sync), *Stats only* (no video; type a timestamp or leave it blank).
- **Turnover tags:** right after a turnover (or block/Callahan), a chip row offers tags: *receiver error*, *difficult throw*,
  *great D*, *wind*, *miscommunication*, *hammer/huck*, plus your own (type a new one; it is saved for the team). Number keys
  toggle tags, `Enter` saves, `Esc` skips, and any action key saves and moves on. Turn the prompt off with *Tag turns*.
  Tags add context only: a throwaway tagged *receiver error* is still the thrower's throwaway. Edit tags on any event in the
  play-by-play, and filter the play-by-play by tag.
- **Missed on film:** if a point isn't on the video, record who scored with *We scored / They scored* under *Start point*
  (or *Not on film…* mid-point). Edit it like any point.
- **Full / Quick:** Full is pass-by-pass. Quick is goals, assists, Ds and turns only.
- **Play-by-play:** click a time to jump the film there (3 s before). Edit, insert (`+`) or delete any event; edit any point
  (line, O/D, ratio, puller). Deletes are soft and can be restored ("show deleted"). Hand edits are marked *edited*.
- **Caps:** set the game start with *Set game start*; the game clock warns when a cap is due. Press *half/soft/hard cap*
  during the point when it goes on; the app finishes the point and sets the new target (higher score + 1).
- **Sheet sync:** see [Google Sheet sync](#google-sheet-sync-free) below; set it up under *Settings*.
- **Data:** download a JSON backup after each game; restore (merge or replace) on any device. CSV export for player stats,
  games, points and events (with YouTube links to each moment).

## Google Sheet sync (free)

The app pushes your stats to a Google Sheet you own, through a small Apps Script web app
([`apps-script/Code.gs`](apps-script/Code.gs)). Tabs: **Players**, **Games**, **Points**, **Events**, **Player Stats**,
**Game Stats** (and a tiny **Meta**). Sub and call events and all call stats columns are included.

- **Live:** a few seconds after each change while you're online; changes made offline wait and go out when you're back;
  failures retry with backoff (5 s up to 5 min). *Settings > Sync now* pushes immediately; *Push everything* re-sends all
  games (use it once after restoring a backup on a new device). The header shows the status; Settings shows the last sync
  time and any error.
- **How rows are written:** Players and Games are upserted by id; each changed game's Points, Events, Player Stats and Game
  Stats rows are replaced with the app's current snapshot. Pushing twice gives the same Sheet. Deleted records disappear.
  The app is the source of truth: edits typed into the Sheet are overwritten.
- **Security:** a shared token. The script keeps it in Script Properties and rejects requests without it; the app keeps it
  in this browser only (Settings, a password field). It is never in the repo, the URL or logs. Treat it as a light lock,
  not strong security: the data is non-sensitive stats. "Publish to web" makes **Player Stats**, **Game Stats** and
  **Events** readable by anyone with the link; **Players**, **Games** and **Points** stay unpublished.
- **CORS:** the app sends a plain `POST` with `Content-Type: text/plain` (JSON in the body), so the browser sends no
  preflight (Apps Script can't answer one). Apps Script replies with a redirect to `script.googleusercontent.com`, which
  `fetch` follows.

### One-time setup

1. Create a new Google Sheet in your own Google account (sheets.new) and name it, e.g. "Port Authority Stats".
2. In the Sheet, click Extensions > Apps Script.
3. Delete the sample code in Code.gs, paste in all of apps-script/Code.gs from the repo (on GitHub, use the “Copy raw file” button), and click Save (the disk icon).
4. In the function menu at the top, pick setup and click Run. When Google asks, click Review permissions and pick your account. If you see "Google hasn’t verified this app", click Advanced > Go to (your project name) (unsafe), then Allow. It is your own script.
5. The Execution log at the bottom shows your sync token (a long string of letters and numbers). Copy it now; it is shown only once. If you lose it, run rotateToken the same way.
6. Click Deploy > New deployment. Click the gear next to "Select type" and choose Web app. Set Execute as: Me and Who has access: Anyone. Click Deploy and authorize again if asked.
7. Copy the Web app URL. It ends in /exec.
8. Back in the Sheet, click File > Share > Publish to web. Open "Published content and settings", untick "Entire document", tick only Player Stats, Game Stats and Events, then click Publish and OK. Anyone with that link can read those three tabs; Players, Games, Points and Meta stay private.
9. In this app, open Settings, paste the URL and the token, click Save, then click Test connection. It should say "Connected". Then click Sync now.

### After a script update (same URL)

1. Paste the new Code.gs over the old one in the Apps Script editor and click Save.
2. Click Deploy > Manage deployments, select the active Web app deployment, and click Edit (the pencil).
3. Under Version, choose New version, then click Deploy. The /exec URL stays the same, so nothing changes in the app.
4. Don’t use Deploy > New deployment for updates: that creates a new URL.

## Stat definitions

- Completion: a catch or goal thrown by the player. Attempts = completions + throwaways + drops on their throws.
- Hockey assist: the pass right before the assist, in the same possession.
- Turnovers: throwaways + drops (charged to the receiver) + stalls + other turns.
- +/-: goals + assists + Ds − turnovers.
- O conversion: holds ÷ finished O points. D break %: breaks ÷ finished D points.
- The opponent is tracked at team level only.
- Mid-point subs (regular or injury): both players get the point played (`Pts`, and O/D points), and both also get a
  partial point (`Part`), so you can tell full points from part points. Stats go to whoever made the play. If the player
  coming off had the disc, the player coming on takes it (same count). Who is on the line is recomputed from the subs,
  so editing or deleting a sub fixes every later event. A sub that breaks the point's ratio is recorded with a warning.
- Calls: counted per team and per player, by type and outcome. *Calls* = calls the player made, *CallOn* = calls made on
  the player (opponent players aren't on the roster, so their side is team-level only). A call only changes possession when
  its outcome is *turnover*: the call itself is the turnover event (the team with the disc loses it; ours is charged to the
  player holding the disc, shown as a call turnover in *Turns*). So don't also press `T`. Delete or edit the call and
  possession and stats follow.
- Turnovers by tag: each tagged turnover, by type, for the team and per player (and the opponent's turns by tag).
  Tags never move the turnover to someone else.
- Points missed on film count in the score and in holds/breaks, but not in per-player points or event stats, and not in
  turns per point. They are shown as *Missed on film* (team) and *Miss* (player).

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
