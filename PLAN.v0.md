# Port Authority Stats: Product & Technical Plan
*For Jacob Murray · Draft 2026-10-20 · Free/OSS only*

## 1. Goal
A free, open-source, offline-first ultimate stat app for Port Authority (Mixed). It records games point by point, computes standard player and team stats, and lets you edit any record by hand. Everything is stored as **one event log**, so live sideline entry and the future **assisted film tagger** write the same events. The tagger only adds `video_time`, `x/y` and suggestions, and needs no second data model.

## 2. Users & moments
| Who | When | Mode |
|---|---|---|
| Sideline stat-keeper (injured/off-line teammate, coach) | Live, during games | Fast tap entry on an Android phone, works offline in a field with bad signal |
| Jacob | After games, at home | Review, fix records, film tagging (Phase 3+), dashboards |
| Teammates | Any time | Read-only stats or shared links (Phase 2) |

Jacob plays, so he usually can't stat live himself. **Film is his main source of stats**, and live entry is for whoever is on the sideline.

## 3. What exists (brief)
- **UltiAnalytics / iUltimate** ([support](https://www.ultianalytics.com/ios/support.html)): open source and iOS-only. It tracked passes, drops, Ds, Callahans (long-press), stalls, subs, undo and event correction, and published team sites. It is no longer maintained (last update 2018; [Reddit](https://www.reddit.com/r/ultimate/comments/1jfw08r/)).
- **Statto** ([Ultiworld, Jul 2026](https://ultiworld.com/2026/07/07/welcome-to-statto-by-ultiworld/)): the best current tool. It has pitch-level tap tracking, play-by-play, heatmaps and CSV export. It is iOS-only and needs a **paid** Ultiworld subscription. Version 2.0 with Android support is promised for late 2026.
- **OSS references:** [Ulti Game Tracker](https://github.com/ben-duivenvoorden/Ulti-Game-Tracker) is a React PWA. It uses an append-only event log, a derived state machine and enforced mixed ratios. This is the closest model to copy. [U-Stat](https://github.com/DanLang1/ultimatestats) is an Expo app. [Ulti Stats](https://github.com/DerrykBoyd/ulti-stats) is a PWA on Firebase.
- **What's different here:** free, Android/PWA, editable records, and a film tagger designed in from the start.

## 4. MVP (Phase 1)
- **Roster:** players with name, number, gender match (WMP/MMP), handler/cutter tag and active flag.
- **Game setup:** opponent, tournament, game-to score (15), caps (half 45′ / soft 90′ / hard 105′ for Nationals pool play; [USAU rules](https://play.usaultimate.org/events/2026-USA-Ultimate-Club-Nationals/Rules/)), timeouts (2 per half), starting O/D and the first-point ratio.
- **Point flow:** the app suggests a 7-player line and checks the **ABBA ratio** (pattern A, B, B, A, A…; halftime doesn't reset it) and **majority pull**. It also handles the pull (in/OB/brick), subs and injuries, timeouts, half, and caps (cap timer from game start; the new target score is computed automatically).
- **Live entry, in two modes:**
  - *Full:* tap the thrower, then the receiver, for each pass. Turnovers are throwaway, drop, stall or other. Also D (block/intercept), Callahan and goal.
  - *Quick:* goals, assists, Ds and turns only.
  - Both modes have an optional tap on a field diagram to record x/y.
- **Undo and edit anywhere:** a play-by-play list where you can insert, edit or delete any event, plus inline table editing for players, games and points.
- **Stats:**
  - Per player: points played (O/D), goals, assists, hockey assists, completions/attempts, comp%, throwaways, drops, Ds, Callahans, plus/minus, and throwing/receiving yards when coordinates exist.
  - Per team: holds/breaks, O-line conversion %, D-line break %, turnovers per point, and pull stats.
- **Export:** JSON backup/restore and CSV (players, points, events). The CSV can be imported straight into Notion databases.

## 5. Later phases
- **Phase 2 – Season & sharing:** season and tournament dashboards, line-combo stats (which pairs score together), heatmaps, a read-only share link or static site, multi-device sync, and Notion API sync (nice-to-have).
- **Phase 3 – Manual film tagger:** load a local game video. Hotkeys and taps mark catch, throw, turn, D and goal at `video_time`, and you tap the field to set x/y. Events are auto-linked to points. A ±4 s clip is cut per event with ffmpeg.
- **Phase 4 – Assisted tagger:** detect and track players (YOLO + ByteTrack via `supervision`). Map pixels to field coordinates with a homography from 4 tapped field corners or cones. When Jacob taps an event, the app ranks likely players by distance to the disc and the tracked identity. Jersey/identity assignment starts manual, with one tap per track per point.
- **Phase 5 – Learning:** every accepted or corrected suggestion is saved as a labelled example. A small ranker (scikit-learn/LightGBM) is retrained after each game, and the detector is fine-tuned on corrected frames now and then.
- **Optional:** a Capacitor wrap for a Play Store APK, which reuses the work toward the Android app on Jacob's wish list.

## 6. Data model (shared by live and film)
```
Team(id, name, division)
Player(id, team_id, name, number, gender_match[W|M], role, active)
Game(id, team_id, opponent, tournament, date, game_to, caps{half,soft,hard}, ratio_first[W4|M4],
     start_on[O|D], video_sources[{id, file, offset_s}], notes)
Point(id, game_id, idx, score_us, score_them, start_on[O|D], ratio, line[player_id×7],
      pulled_by, outcome[hold|break|...], started_at, ended_at, video_start, video_end)
Possession(id, point_id, idx, team[us|them])        -- derived from events and cached; editable
Event(id, game_id, point_id, possession_id, seq,
      type[pull|catch|throw|turnover|drop|throwaway|stall|D|callahan|goal|timeout|sub|injury|half|cap|note],
      actor_id, receiver_id?, defender_id?, team,
      x?, y?, x_end?, y_end?,          -- canonical field yards: 40 wide × 110 long (70 + 2×20 endzones)
      wall_time?, video_time?, video_source_id?, clip_path?,
      source[live|film|import], confidence?, suggested_player_ids?, corrected:bool,
      tags[], created_at, edited_at, deleted:bool)
Correction(id, event_id, field, suggested, chosen, created_at)   -- training data for Phase 5
```
- **Stats are pure functions over events**, and they are never stored as truth. Editing any event recomputes everything.
- Edits keep an audit trail through `edited_at` and soft delete.
- A film pass can **merge into** a live-tracked game: events are matched by point and sequence, and the film pass adds video_time and x/y.

## 7. Recommended stack
| Layer | Pick | Why |
|---|---|---|
| App | **PWA:** React + TypeScript + Vite, Tailwind | Installable on Android with no store or fees. Works on a laptop for film work. One codebase. |
| Local storage | **Dexie (IndexedDB)** and Zod schemas | Offline-first, fast and typed. Backup is a JSON file. |
| Sync (Phase 2) | **PocketBase** (OSS, one binary, self-host on a free tier or home box) | Free, with auth and a REST API. Optional; the app works without it. |
| Charts | Recharts / Observable Plot | Free and simple. |
| Film / CV (Phase 3–5) | Local **Python FastAPI** sidecar: ffmpeg, OpenCV, Ultralytics YOLO (AGPL, fine for personal use) or RT-DETR, ByteTrack via `supervision`, scikit-learn | CV runs well on a laptop, optionally with a GPU. The PWA calls it over localhost. No paid APIs. |
| Android native | **Capacitor** wrap, later | Reuses 100% of the PWA. Adds an APK only if needed. |

**PWA vs native vs web:**
- Native Android (Kotlin) would double the work, and you still need a desktop UI for film.
- A plain web app without offline support fails at fields with no signal.
- A PWA is offline, installable and cross-device, and can later be wrapped with Capacitor.

## 8. Effort (part-time, about 6–8 h/week, AI-assisted coding)
| Phase | Scope | Weeks |
|---|---|---|
| 0 | Event schema, stat definitions, wireframes, paper test on one game | 1 |
| 1 | MVP: roster, game flow, ABBA, live entry, editing, stats, export | 5–6 |
| 2 | Season dashboards, sharing, PocketBase sync, Notion CSV/API | 3–4 |
| 3 | Manual film tagger, video player, clips, field taps | 3 |
| 4 | Detection, tracking, homography, suggestions | 5–7 |
| 5 | Learning from corrections, retrain loop | 3–4 |
| — | Capacitor APK (optional) | 1 |
| **Total** | MVP in about 7 weeks; full vision in about 22–27 weeks | |

## 9. Open decisions (recommended pick in **bold**)
1. **Platform:** PWA, native Android or web → **PWA, with a Capacitor wrap later.**
2. **Live detail:** pass-by-pass, quick (goals/assists/Ds/turns) or both → **both, defaulting to Full; use Quick when the stat-keeper is also subbing.**
3. **Coordinates live:** always, optional or never → **optional field tap. Film is the reliable source of x/y.**
4. **Opponent tracking:** per player or team only → **team-level only (opponent turns, scores and Ds as a team).**
5. **Storage/sharing:** local-only or synced → **local-first plus JSON export for MVP; add self-hosted PocketBase in Phase 2.**
6. **Notion:** none, CSV or API sync → **CSV export in MVP; one-way API push in Phase 2 if still wanted.**
7. **Film CV runtime:** in-browser (ONNX/WebGPU) or local Python sidecar → **local Python sidecar.**
8. **Who builds and maintains it:** Jacob with AI coding help, or recruit a teammate → **Jacob plus AI help on a public MIT-licensed GitHub repo, so teammates can contribute.**
