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
- **End game (key `E`):** closes the game whatever the score or clock, after a confirmation. The final score is what you
  recorded (a point in progress stays unscored) and the result is W, L or T from it. It also adds a *Game ended* marker
  with the film time to the play-by-play. To undo, use *Reopen*, Undo (`U`) or delete the marker. An ended game can
  still be edited like any record. Reaching the game-to (or a capped target) shows *Target reached* and counts as
  final, but never locks the game: *End game* closes it, or *Play another point* if play went on.
- **Cap went off (key `K`, then `1` half / `2` soft / `3` hard):** marks the cap at the current film time, during a
  point or between points. When that cap is set on the game, the new target follows USAU rules:
  - **Soft:** the higher score + 1, set after the point in progress.
  - **Hard:** the point in progress is the last one, plus one more if tied. Between points, the game is final unless
    it is tied.
  - **Half:** halftime at the higher score + 1.

  Nothing is forced. The header shows the target, and you can edit the marker (*Which cap*) or delete it in the
  play-by-play. If the cap is not set on the game, the marker is a note only.
- **Game clock (optional, off by default):** turn it on per game (*Game clock* in the workspace or game settings). It
  shows the game clock (video time − *Set game start*) and warns when a cap is due. It is off by default because film
  often starts late or cuts, which makes the clock wrong. Mark caps by hand instead. When it is off, the clock, the
  cap timers and the warnings are hidden.
- **Import from UltiAnalytics:** see [Import from UltiAnalytics](#import-from-ultianalytics) below; it's on the *Data* page.
- **Sheet sync:** see [Google Sheet sync](#google-sheet-sync-free) below; set it up under *Settings*.
- **Data:** download a JSON backup after each game; restore (merge or replace) on any device. CSV export for player stats,
  games, points and events (with YouTube links to each moment).

## Dashboard

**Dashboard** (top bar) shows the season at a glance. It works on a phone (one column, filters fold away) and on a laptop (several columns).

- **Headline cards:** record, point diff, hold %, break %, turnovers per point, blocks per point and completion %. Each has a small per-game line, and an arrow comparing the last 3 games with the earlier ones (from 4 games).
- **Charts:**
  - hold % and break % by game;
  - turnovers by type, stacked by tag (ours or theirs);
  - player leaderboard (totals or per point, sortable, with a minimum-points setting);
  - player scatter (throws per point vs completion %, or +/- per point vs points played);
  - hold and break by gender ratio (4 WMP vs 4 MMP);
  - calls by type and outcome;
  - a field heatmap, shown only when events have field positions.
- **Drill-down:** tap a bar segment, dot, player or the turnovers card to list the plays behind it. Each play links to its game, and film plays have a ▶ link that opens YouTube at that moment.
- **Filters:** tournament, games, O-line or D-line points, source (film, live, imported) and tags. They are saved in the link (for example `#/dashboard?tags=wind`), so **Copy link** shares the exact view.
- **How tag filters work:** you can pick several tags and match **any** or **all** of them, then choose a mode:
  - **Count only events with these tags** or **Count only events without them:** these narrow the event counts (turnovers, Ds, passes, goals, calls). The score, holds, breaks and points played still use every play.
  - **Leave out points that contain them:** this drops those whole points, so holds and breaks change too.
- **Limits:**
  - The record always uses whole games.
  - In the stacked turnover chart, a turnover with several tags is counted under its first tag only.
  - Completion % is hidden while counting only tagged events, because passes are rarely tagged.
  - Imported games have no gender ratio, so they are left out of the ratio chart.
  - Points missed on film count for the score but add no plays.

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
  **Events** readable by anyone with the link; **Players**, **Games** and **Points** stay unpublished. With script
  version 3, anyone who has the Web app URL can also *read* the team-view snapshot (all games, points, events and
  player names), but never write.
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

Script version 2 (October 2026) adds the `game_clock` and `ended_at` columns to the Games tab. The new script adds them to an existing Sheet on the next sync, and *Test connection* says when the script is older than the app. The **Game Stats** `result` column (W / L / T / in progress) uses the manual end.

Script version 3 (October 2026) adds the read-only team view (below). After updating, click *Push everything* once.

### Team view (read-only link for teammates)

Teammates can open your games, game stats and season dashboard in the app itself, without your data in their browser
and without the token:

```
https://jakepmurray.github.io/port-authority-stats/#/team?src=<the Web app /exec URL, URL-encoded>
```

*Settings > Team view link > Copy team view link* builds it for you. The address is remembered, so later visits to
`#/team` work without it; dashboard links shared from the team view carry it as `team_src=` (on the dashboard `src=`
is already the film/live/import filter). Only a `script.google.com/macros/s/…/exec` address is accepted.

- Every push also stores a snapshot of the app's data (teams, players, games, points, events; deleted games, points and
  events left out; deleted players kept, marked deleted, because old games name them) in a hidden **_Snapshot** tab, as
  JSON split into 45,000-character chunks (a cell holds at most 50,000). *Push everything* rewrites it completely.
- The team view loads it with a plain `GET /exec?action=snapshot` (no token, no custom headers, so no CORS preflight)
  into its **own** IndexedDB database (`port-authority-stats-team-view`) that refuses every write. The visitor's own
  games and sync settings are never touched, and the team view never syncs.
- A banner shows *Team view — read only, updated <time>* and a Refresh button. If the script is older, has no snapshot
  yet, or the network is down, it says so in plain words and keeps showing the last copy it loaded.
- Only the browser that has the token can write. If the token was ever shared, run `rotateToken()` in the Apps Script
  editor and paste the new token into Settings on your own device only.

## Import from UltiAnalytics

Games tracked with the UltiAnalytics (iUltimate) app can be imported on the **Data** page. Nothing is saved until you have reviewed the games and players.

### Get the CSV (works for every team)

1. In the UltiAnalytics app on your phone, open the Website tab and upload your games: turn on Game Uploading, or tap Upload, pick the games and tap Upload. Sign in with Google if it asks.
2. On a computer (the Download page is turned off on phone-sized screens), open your team website: www.ultianalytics.com/app/#/<your team number>/players. The Website tab in the app links to it, or search for your team at www.ultianalytics.com.
3. If the team website has a password, enter it.
4. Click Download in the menu bar, then click "Download raw statistics in CSV format". You get one file (e.g. PortAuthority-stats.csv) with every game.
5. In this app, open Data > Import from UltiAnalytics, click Choose file and pick that CSV (or paste its contents). Review the games and players, then click Import.

### Or use the team link (teams without a website password)

1. Copy your team website link (or just the long number in it) and paste it into the team link box here, then click Load team.
2. This only works when the team website has no password. It reads the games straight from UltiAnalytics and includes exact mid-point subs, which the CSV does not have.

### What gets imported

- **Games:** opponent, tournament and date. The game-to is UltiAnalytics' game point if set, otherwise the winning score. There are no caps. Imported games are marked ended at their recorded score (earlier imports are marked ended when the app updates).
- **Points:** O/D from UltiAnalytics' Line column, the line, and the score. The outcome (hold, break…) is worked out from the events and checked against UltiAnalytics' score; any point that disagrees is flagged in the preview.
- **Events:** pulls (OB pulls tagged `ob`, hang time in the note), catches, goals, throwaways, drops, stalls, Ds, Callahans (both ways), misc. penalties (as an other turnover), timeouts (ours: UltiAnalytics only tracks the stat-keeping team's), halftime, and subs/injuries (team link only). Quarter ends become notes; "game over" is dropped. Every event is marked source `import` with no video time.
- **Opponent:** team totals only, as for every game here.
- **Players:** each UltiAnalytics name (often a nickname) is matched to the roster by full name, first name, last name or a previous import. You can change each match, add unmatched names as new players (they need a jersey number and a gender match), or leave them blank. "Anonymous" is always blank.
- **De-dupe:** a game already here with the same opponent, date and score (or imported before) is unticked in the preview.

### Limits

- **No gender match in UltiAnalytics:** imported points get placeholder ABBA ratios and the game notes say so. Ratio warnings on those games mean nothing.
- **CSV subs:** the CSV lists everyone who played a point but not who came off or when. If more than 7 are listed, the first 7 to touch the disc are the line and the rest are recorded as subbing on at the start of the point (flagged in the preview). The team link has exact subs.
- **Points played:** UltiAnalytics counts its halftime and quarter-end markers as extra "points" and gives half a point for a sub. Here those markers are not points, and a sub gets the point, flagged as partial.
- **Not imported:** field positions and throw distances, wind, and UltiAnalytics' own +/- and efficiency numbers (they are recomputed here). Video times are left empty.
- **Team link:** only works for public team websites. A password-protected team returns an error; use the CSV.
- **Other files:** a single-game `.iexport` file from the UltiAnalytics admin site (Games tab, Export) and the team website's game JSON also import.

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
