# Port Authority Stats: Product & Technical Plan
*For Jacob Murray · v2.1, approved 2026-10-20 · Free/OSS only · All decisions locked (§9)*
*Repo: [jakepmurray/port-authority-stats](https://github.com/jakepmurray/port-authority-stats) (MIT) · App: https://jakepmurray.github.io/port-authority-stats/*
*Status (2026-10-21): Phase 0 scaffold and Phase 1 film-entry MVP live; Phase 2 Google Sheet sync built (Apps Script in `apps-script/`, set up under Settings); import from UltiAnalytics (CSV or public team link, Data page). Live sideline entry is next.*
*Update (2026-10-29): season Dashboard live; read-only **team view** (`#/team?src=<web app URL>`, script v3) lets teammates browse games, stats and the dashboard from Jacob's last push.*

## 1. Goal
A free, open-source stat app for Port Authority (Mixed) that you use **while watching game film**.
- Paste a YouTube link and the game plays beside a stat panel.
- Every event you enter captures the video timestamp, so each stat links back to its moment in the film.
- Stats sync to a Google Sheet that teammates can view.
- All records can be edited by hand.
- Live sideline entry (later) and the assisted film tagger (later) write the **same events**.

## 2. Users & moments
| Who | When | Mode |
|---|---|---|
| Jacob (primary) | After games, on a desktop or laptop (often with two screens) | Film entry: YouTube embed plus stat panel, or a stats-only layout |
| Teammates | Any time | Read-only team view link in the app (games, stats, dashboard), plus the Sheet published to the web |
| Sideline stat-keeper | Live, Phase 2 | Fast tap entry on an Android phone, offline |

## 3. What exists (brief)
- **UltiAnalytics / iUltimate** ([support](https://www.ultianalytics.com/ios/support.html)): open source and iOS-only. It covered passes, drops, Ds, Callahans, undo and corrections. It was reported unmaintained in 2018 ([Reddit](https://www.reddit.com/r/ultimate/comments/1jfw08r/)), but ultianalytics.com and its read API are still up (checked 2026-10-21), so this app can import its games (see the README).
- **Statto** ([Ultiworld, Jul 2026](https://ultiworld.com/2026/07/07/welcome-to-statto-by-ultiworld/)): pitch-level tracking, play-by-play and heatmaps. It is iOS-only and needs a **paid** Ultiworld subscription; Android is promised.
- **OSS references:** [Ulti Game Tracker](https://github.com/ben-duivenvoorden/Ulti-Game-Tracker) is a React PWA with an append-only event log and a derived state machine. This is the model to copy. Also [U-Stat](https://github.com/DanLang1/ultimatestats) (Expo) and [Ulti Stats](https://github.com/DerrykBoyd/ulti-stats) (PWA).
- **Gap this fills:** none of these is built around film-first entry with events linked to the video. This app also adds free sheet sharing, a desktop and Android PWA, and a built-in path to the assisted tagger.

## 4. MVP (Phase 1): film entry
- **Responsive PWA:**
  - Desktop/PC: two panes, video on the left and the stat panel on the right.
  - Tablet or narrow window: stacked.
  - Phone: usable, but not the main target.
  - Installable, offline-capable.
- **Video pane** ([YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), free):
  - Paste a YouTube URL and it embeds.
  - Each event stores `player.getCurrentTime()` as `video_time`.
  - Hotkeys: play/pause, ±5 s, and 0.5×/1× speed.
  - The pane can be **collapsed** or **popped out** into a separate window synced through BroadcastChannel, for dual-screen setups.
  - **Stats-only layout:** timestamps are entered by hand (mm:ss) or left blank.
- **Film-entry default: pass-by-pass with the keyboard.**
  - Type a jersey number to record a catch by that player; the throw from the previous holder is implied.
  - Keys `t` / `d` / `b` / `g` / `c` mark throwaway, drop, block, goal and Callahan.
  - The video can be paused, so full detail is realistic, and pass-by-pass gives completion % and hockey assists.
  - **Quick mode** (goals, assists, Ds, turns only) is also available, for a fast first pass.
- **Game and point flow:**
  - Roster, with gender match (WMP/MMP) per player.
  - Game setup: game-to score of 15; caps of half 45′ / soft 90′ / hard 105′ ([USAU Nationals rules](https://play.usaultimate.org/events/2026-USA-Ultimate-Club-Nationals/Rules/)); timeouts.
  - Line entry each point, with **ABBA ratio** (A, B, B, A, A…; halftime doesn't reset it) and majority-pull checks.
  - Pulls, timeouts, half and caps.
- **Click to seek:** any event in the play-by-play jumps the film to its timestamp. "Clips" are YouTube segments from `video_time − 4 s` to `+3 s`, so no download is needed.
- **Editing:** undo, plus insert, edit or delete anywhere in the play-by-play. Players, games and points are editable as tables.
- **Stats:**
  - Per player: points played (O/D), goals, assists, hockey assists, completions/attempts, comp%, throwaways, drops, Ds, Callahans and +/-. Yards once x/y exist.
  - Per team: holds/breaks, O conversion %, D break %, turnovers per point.
  - Opponent: **team totals only**.
- **Data:** local-first storage (IndexedDB). JSON backup/restore and generic CSV export. The sync queue table exists from day one; the Sheet sync itself ships in Phase 2 (see §7).

## 5. Phases (in order)
0. **Scaffold:** public MIT repo, React + TS + Vite PWA, Tailwind, Dexie + Zod schemas (§6), responsive shell, Vitest, CI (lint + typecheck + tests), deploy to GitHub Pages.
1. **MVP: film entry**, as described in §4 (pass-by-pass and Quick mode).
2. **Google Sheet sync and live sideline entry.**
   - Live push to a Sheet published to the web for teammates, through the Apps Script web app (§7).
   - Live sideline entry: phone layout with big tap targets, Quick mode, offline queue for fields without signal.
   - **Optional tap on a field diagram for x/y**, mainly for live use.
   - Season and tournament dashboards, plus line-combo stats.
3. **Later: assisted tagger**, running inside the same video pane.
   - The local Python helper gets the footage: a local file, or a download of Port Authority's own uploads with yt-dlp, if YouTube's terms allow it. It runs detection and tracking (YOLO + ByteTrack via `supervision`) and a field homography (4 tapped corners).
   - It returns per-frame player boxes and field x/y. The PWA draws them as an overlay synced to `getCurrentTime()`.
   - An embedded YouTube player can't expose its pixels, so all analysis happens in the helper.
   - When you tap an event, the app suggests the likely players involved.
4. **Later: learning from corrections.** Each accepted or changed suggestion is saved as a Correction. A small ranker (scikit-learn/LightGBM) is retrained after each game, and the detector is fine-tuned now and then.
5. **Later: custom domain + access control.** Serve the app at `stats.portauthorityultimate.com` with Cloudflare Access in front (free for up to 50 users; sign in with an emailed one-time code or Google), so no password lives in the public code.
   - GitHub Pages alone can't password-protect a site without GitHub Enterprise.
   - Needs the domain's DNS on Cloudflare (free), or only the `stats` subdomain hosted there, or a move to Cloudflare Pages.
   - The code stays public; the protection matters for the shared stats view.
6. **Optional:**
   - A private Sheet behind Google sign-in.
   - A Capacitor Android APK.

## 6. Data model (shared by film, live and tagger)
```
Team(id, name, division)
Player(id, team_id, name, number, gender_match[W|M], role, active, updated_at)
Game(id, team_id, opponent, tournament, date, game_to, caps{half,soft,hard}, ratio_first[W4|M4],
     start_on[O|D], video{kind[youtube|file|none], youtube_id?, url?, offset_s}, use_clock, ended_at?, notes, updated_at)
Point(id, game_id, idx, score_us, score_them, start_on[O|D], ratio, line[player_id×7], pulled_by,
      outcome[hold|break|...], video_start?, video_end?, updated_at)
Possession(id, point_id, idx, team[us|them])     -- derived from events and cached; editable
Event(id(uuid), game_id, point_id, possession_id, seq,
      type[pull|catch|throw|turnover|drop|throwaway|stall|D|callahan|goal|timeout|sub|injury|half|cap|end|note],
      actor_id?, receiver_id?, defender_id?, team[us|them],
      x?, y?, x_end?, y_end?,           -- field yards: 40 wide × 110 long (70 + 2×20 endzones)
      video_time?, time_source[auto|manual|none], wall_time?,
      source[film|live|tagger|import], confidence?, suggested_player_ids?, corrected:bool,
      tags[], updated_at, deleted:bool)
Correction(id, event_id, field, suggested, chosen, created_at)   -- training data for the learning phase
SyncQueue(op_id, table, row_id, payload, attempts, last_error)   -- local only
```
- **Stats are pure functions over events.** Any edit recomputes them.
- UUIDs and `updated_at` make syncs idempotent upserts (last write wins).
- Deletes are soft, so they sync too.

## 7. Stack & Google Sheet sync
| Layer | Pick | Why |
|---|---|---|
| App | **PWA:** React + TypeScript + Vite, Tailwind (responsive, desktop-first for film) | One codebase for PC and Android. No store, no fees. |
| Video | YouTube IFrame Player API; HTML5 `<video>` for local files | Free, and gives the current timestamp. |
| Local storage | **Dexie (IndexedDB)** and Zod schemas | Offline-first, typed and fast. |
| Sharing | **Google Sheet + Apps Script web app** (free) | Teammates already know Sheets. No server to run. |
| CV helper | Local **Python FastAPI**: ffmpeg, OpenCV, YOLO (Ultralytics is AGPL, fine for personal use; RT-DETR as an alternative), `supervision`/ByteTrack, scikit-learn | No paid APIs, and it runs on your laptop. |
| Android APK | Capacitor wrap (optional) | Reuses the PWA as-is. |

PocketBase is dropped because the Sheet covers sharing.

**Public sheet (Phase 2):**
1. One Sheet with tabs `Players`, `Games`, `Points`, `Events`, `Player Stats`, `Game Stats` and `Meta` (schema version).
2. An Apps Script `doPost(e)`, deployed as a web app with *Execute as: me* and *Access: anyone*. It:
   - receives `{token, ops:[{table, rows[]}]}`;
   - checks a shared token stored in Script Properties;
   - takes `LockService`;
   - upserts Players and Games by `id`, and replaces each pushed game's Points, Events and stats rows with the app's snapshot, in batched `setValues`;
   - returns the ids it accepted.
3. The PWA sends `fetch(url, {method:'POST', body: JSON.stringify(batch)})` as `text/plain`, which avoids the CORS preflight. It pushes the queue on each change (debounced about 5 s) and on reconnect, with exponential backoff. The queue is cleared only for acknowledged ids.
4. The stats tabs are computed by the PWA and pushed as snapshots, so the app stays the single source of truth.
5. **File → Share → Publish to web** publishes only the `Player Stats`, `Game Stats` and `Events` tabs as the read-only link for teammates.
6. Treat the token as obscurity, not real security. Accepted risk: the data is non-sensitive stats.
7. **Team view (script v3):** each push also stores a JSON snapshot of the domain rows (deleted games/points/events left out) in a hidden `_Snapshot` tab, chunked under the 50k-char cell limit; *Push everything* rewrites it. `doGet(?action=snapshot)` serves it with no token. The app's `#/team?src=<encoded /exec URL>` route loads it into a separate read-only IndexedDB (`port-authority-stats-team-view`), never mixing with the visitor's data; no editing or sync there. Jacob's browser (with the token) stays the only writer.

**Private sheet (optional, later):** Google Identity Services sign-in, and the PWA calls the Sheets API directly with the `drive.file` scope (free). The Sheet is shared only with the team. Apps Script is no longer needed.

## 8. Effort (part-time, about 6–8 h/week, built by a builder bot with Jacob reviewing)
| Phase | Scope | Weeks |
|---|---|---|
| 0 | Scaffold: repo, PWA, Tailwind, Dexie/Zod schemas, responsive shell, Vitest, CI, GitHub Pages | 1 |
| 1 | MVP film entry: YouTube pane (collapse/pop-out/stats-only), pass-by-pass and Quick hotkeys, ABBA, caps, editing, seek-to-event, stats, JSON/CSV export | 6–7 |
| 2 | Apps Script sync and published Sheet; live sideline entry (phone UI, offline, field-tap x/y); season dashboards | 4–6 |
| 3 | Assisted tagger: helper, detection, tracking, homography, overlay, suggestions | 6–8 |
| 4 | Learning from corrections, retrain loop | 3–4 |
| 5 | Private Sheet with Google sign-in (1–2); Capacitor APK (1) | 2–3 |
| **Total** | MVP in about 7–8 weeks; Sheet sharing and live entry by about week 14; full vision in about 22–29 weeks | |

## 9. Decisions: LOCKED (2026-10-20)
1. **Platform:** PWA, responsive and good on desktop/PC browsers as well as Android. Capacitor wrap is optional later.
2. **MVP focus:** film entry beside an embedded YouTube player, with auto timestamps. The player can be collapsed or popped out, and there is a stats-only layout. Default entry is keyboard pass-by-pass, with Quick mode available. Live sideline entry comes in Phase 2.
3. **Coordinates:** optional tap on a field diagram, added with live sideline entry (Phase 2). The tagger fills x/y automatically.
4. **Opponent:** team totals only.
5. **Storage and sharing:** local-first with an offline queue and retry, live-synced to a Google Sheet through an Apps Script web app. The Sheet is published to the web (read-only) first; a private Sheet with Google sign-in comes later. No PocketBase.
6. **Export:** generic JSON backup/restore and CSV only; the Google Sheet is the only integration.
7. **Film CV:** local Python helper.
8. **Builder:** a dedicated builder bot, public MIT-licensed GitHub repo.

## 10. DRAFT (not approved, not built): trusted stat-takers with their own keys
*Drafted 2026-10-29 for Jacob's review. Nothing here is built yet.*

**Goal:** a few trusted people can add and edit stats from their own devices with their own keys. Jacob stays admin, the team view stays as it is, and two people never overwrite each other's work.

**Keys and roles (Apps Script v4)**
- Run from the editor, so keys never pass through the app, chat or git:
  - `addStatTaker('Sam')` prints a new random key **once** in the Execution log.
  - `listStatTakers()` shows names, ids, created and last-used times, and revoked status. It never shows keys.
  - `revokeStatTaker('<id>')` and `rotateAdminKey()`.
- Only a SHA-256 hash of each key is stored, in Script Properties (`PA_KEY_<id>` = `{name, hash, created_at, revoked}`). Keys are 256-bit random, so no salt is needed.
- The existing `PA_TOKEN` becomes the **admin key**, so Jacob's device keeps working.
- Every POST is matched to a person: `admin`, or a stat-taker with an id and name. `ping` returns `{role, name, id}` and the app shows it in Settings.
- A revoked key gets `revoked_key` and can never write again.

**Who owns what**
- The server keeps a game registry in a hidden `_Games` tab: `game_id, owner_id, rev, updated_by, updated_at`.
  - A game's first push makes the pusher its owner.
  - The owner can **release** it. Anyone can **claim** an unowned game. Admin can **reassign** or force-claim any game.
- The server rejects game pushes (Games row, per-game tabs, snapshot entry) from anyone but the owner: `not_owner`, naming the owner.
- **Stale edits:** each game has a `rev` that goes up on every accepted push. The app sends the `base_rev` it last pulled or pushed. If the server is newer, the push is rejected (`stale`). This covers one person on two devices, or a reassign. The app then offers *Pull and retry*: the server copy loads, then the app re-applies the local queued changes for games the person still owns.
  - Within an owned, up-to-date game, the app's copy replaces the server's, same as today.
- **Players are shared:**
  - Upsert by id, newest `updated_at` wins. Client clocks decide ties, which is acceptable for names and numbers.
  - Stat-takers can add players and edit them. Deleting players is up to Jacob (question 1).
  - No duplicate players:
    - Roster import already matches existing players.
    - Adding a player whose normalized name **or** jersey number matches a live player asks "use #7 Ava?" first.
    - The server logs suspected duplicates in the audit log rather than rejecting them, because rejecting would strand events that reference the player.
- **Team settings** (custom tags) can only be changed by admin.
- **Stats after a name change:** when a player's name changes, the stats rows of games the editor doesn't own refresh on the owner's next push, or when admin clicks *Push everything*.

**Pull (stat-takers and admin)**
- `POST {action:'pull', key}`, or the existing public snapshot, plus the registry.
- Merged into the person's **real** local database by id:
  - Games they don't own: the server copy always wins.
  - Their own games: queued local changes win.
  - Players: newest `updated_at` wins.
- Pulled rows are **not** queued for pushing back.
- A new local table `remote` (Dexie v3) caches `game_id → owner, rev`, outside the game rows, so ownership can't be edited by hand.
- Games owned by others open read-only, with a *Request / Claim* hint.
- There is a Pull button, and the app pulls automatically on start and before claiming.

**Push changes**
- A stat-taker's *Push everything* means "all games I own plus players", **never** a full wipe of the snapshot. Only admin's *Push everything* rebuilds the whole `_Snapshot` and Sheet.
- The snapshot stores players per record (merged), not as one replaced block.

**Audit**
- The server stamps `edited_by` (the pusher's name) on Games, Points and Events rows, and in the snapshot.
- A hidden `_Audit` tab gets one row per accepted push: time, who, game ids, counts, and any rejections.
- `_Audit` is trimmed to the last 5,000 rows.

**App screens**
- **Settings:**
  - "Your key" replaces "Token" and shows the role (admin or stat-taker, with name).
  - Pull now.
  - Admin only: a read-only list of stat-takers. Keys are still made and revoked in the editor.
- **Games list:** ownership badges ("You", "Sam", "Unowned"), plus Claim, Release, and for admin, Reassign.
- **Conflict messages in plain words:**
  - "Sam is editing this game. Ask Sam to release it or ask Jacob."
  - "This game changed on another device. Pull and retry."
  - "Your key was revoked."

**Limits**
- **One push at a time:** Apps Script handles pushes one by one (the existing lock). Others wait up to 30 s, then get `busy` and retry with backoff (already built).
- **Rewrites grow with data:** each push rewrites whole tabs. That's fine for a season, since pushes take under 30 s of the 6-minute limit. Several active stat-takers at once mean more `busy` retries, so stat-takers' sync wait goes from 5 s to 15 s.
- **Quotas:** a free account gets about 20,000 web-app runs a day and 90 minutes a day of triggers, which aren't used here. Enough.
- **Offline:** edits queue locally as now. On reconnect, a push to a game the person still owns goes through. If it was reassigned meanwhile, they see a conflict and their copy stays local, with *Export JSON* so Jacob can merge it. Nothing is lost silently.
- **Security:** keys are still bearer secrets in each person's browser. Reading the snapshot stays public (team view).

**Migration**
- **Script v4:** existing games have no owner. On Jacob's first admin push, they all become **admin-owned** with `rev 1`, and the snapshot is rebuilt.
- **App:** older app versions with only the admin token keep working. Stat-takers need the new app, which is automatic through the PWA update prompt.
- **Local database:** Dexie v3 adds the `remote` table. Existing rows are unchanged.

**Tests (Vitest)**
- **gasMock:**
  - Key add, list and revoke, and hash-only storage.
  - Roles from `ping`.
  - Ownership: first push claims; `not_owner`, `stale`, release, claim, reassign.
  - A stat-taker's full push doesn't wipe others' games.
  - Audit rows and `edited_by`.
  - Revoked keys.
  - A v3 admin push still works.
- **Client:**
  - The merge rules (pulled rows not queued; own queued changes win).
  - Pull and retry.
  - Read-only games owned by others.
  - Duplicate-player prompt.
- **UI:** badges and conflict messages.
- **Scenario:** two simulated devices against one mock script.

**Size:** about 7 commits:
1. Script keys and roles.
2. Registry, ownership and rev.
3. Audit.
4. App role and pull/merge (Dexie v3).
5. Ownership in push, plus conflict handling.
6. UI badges, claim and duplicate guard.
7. Docs.

Roughly 2–3 build sessions.

**Jacob's steps after it's built**
1. Paste the new Code.gs, then Deploy > Manage deployments > Edit > New version > Deploy (same URL).
2. In the app, click Test connection (it should say admin), then Push everything once.
3. For each person, run `addStatTaker('Name')` and copy the key from the Execution log. **Send it to them yourself, privately** (not in a group chat).
4. They open the app, go to Settings, paste the URL and their key, then Test connection and Pull.
5. To remove someone, run `revokeStatTaker('<id>')`. Their pending changes are rejected, and nothing they already pushed changes.

**Open questions (recommended answer first)**
1. *Can stat-takers delete players?* **No.** They can add players and fix names and numbers; only Jacob deletes or merges players.
2. *Can a stat-taker take a game nobody holds?* **Yes, claim it if it's unowned; only Jacob can take a game from someone.** No automatic expiry.
3. *One key per person, used on several devices?* **Yes.** The rev check stops two devices from overwriting each other, and revoking one key cuts off all of that person's devices.
