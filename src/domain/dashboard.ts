import { liveOnly, other } from './game'
import type { Game, GameEvent, Point, Ratio, TeamSide } from './schema'
import { computeGameStats, sumPlayerStats, type GameStats, type PlayerStats } from './stats'
import { userTags } from './tags'

/**
 * Season dashboard: filters plus aggregations, all pure functions over the event log.
 * Per-game numbers come from the stats module (computeGameStats); this file only chooses
 * which games/points/events go in and sums the results.
 */

export type SourceKind = GameEvent['source']
export const SOURCES: SourceKind[] = ['film', 'live', 'tagger', 'import']

/**
 * Tag filter scope:
 *  - 'only': count only events that have the tag(s) (e.g. turnovers tagged "wind").
 *  - 'without': count only events that don't.
 *  - 'drop_points': leave out whole points that contain a tagged event (affects holds/breaks too).
 */
export type TagScope = 'only' | 'without' | 'drop_points'

export interface DashFilter {
  tournament: string
  games: string[]
  side: 'all' | 'O' | 'D'
  sources: SourceKind[]
  tags: string[]
  tagMode: 'any' | 'all'
  tagScope: TagScope
}

export const DEFAULT_FILTER: DashFilter = { tournament: '', games: [], side: 'all', sources: [], tags: [], tagMode: 'any', tagScope: 'only' }

const list = (v: string | null) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : [])

/** Read filters from the query part of the hash ("#/dashboard?t=…&tags=wind"). Unknown values fall back to defaults. */
export function parseFilter(query: string): DashFilter {
  const q = new URLSearchParams(query.replace(/^\?/, ''))
  const side = q.get('side')
  const mode = q.get('tm')
  const scope = q.get('ts')
  return {
    tournament: q.get('t') ?? '',
    games: list(q.get('g')),
    side: side === 'O' || side === 'D' ? side : 'all',
    sources: list(q.get('src')).filter((s): s is SourceKind => (SOURCES as string[]).includes(s)),
    tags: list(q.get('tags')),
    tagMode: mode === 'all' ? 'all' : 'any',
    tagScope: scope === 'without' || scope === 'drop_points' ? scope : 'only',
  }
}

/** Only non-default values are written, so the plain dashboard link stays "#/dashboard". */
export function filterToQuery(f: DashFilter): string {
  const q = new URLSearchParams()
  if (f.tournament) q.set('t', f.tournament)
  if (f.games.length) q.set('g', f.games.join(','))
  if (f.side !== 'all') q.set('side', f.side)
  if (f.sources.length) q.set('src', f.sources.join(','))
  if (f.tags.length) {
    q.set('tags', f.tags.join(','))
    if (f.tagMode !== 'any') q.set('tm', f.tagMode)
    if (f.tagScope !== 'only') q.set('ts', f.tagScope)
  }
  return q.toString()
}

export const activeFilterCount = (f: DashFilter) =>
  (f.tournament ? 1 : 0) + (f.games.length ? 1 : 0) + (f.side !== 'all' ? 1 : 0) + (f.sources.length ? 1 : 0) + (f.tags.length ? 1 : 0)

const lc = (t: string) => t.toLowerCase()

/** Does an event carry the filter's tags (any or all, case-insensitive)? */
export function hasTags(e: Pick<GameEvent, 'tags'>, tags: string[], mode: 'any' | 'all'): boolean {
  if (!tags.length) return true
  const mine = new Set(userTags(e.tags).map(lc))
  return mode === 'all' ? tags.every((t) => mine.has(lc(t))) : tags.some((t) => mine.has(lc(t)))
}

/** The event predicate for counted stats, or undefined when the tag filter doesn't limit events. */
export function eventPredicate(f: DashFilter): ((e: GameEvent) => boolean) | undefined {
  if (!f.tags.length || f.tagScope === 'drop_points') return undefined
  return f.tagScope === 'only' ? (e) => hasTags(e, f.tags, f.tagMode) : (e) => !hasTags(e, f.tags, f.tagMode)
}

export interface DashData {
  games: Game[]
  points: Point[]
  events: GameEvent[]
}

/** How a game was entered: the most common source of its events ('import' for UltiAnalytics games). */
export function gameSource(game: Game, events: GameEvent[]): SourceKind {
  const n = new Map<SourceKind, number>()
  for (const e of events) if (!e.deleted) n.set(e.source, (n.get(e.source) ?? 0) + 1)
  if (!n.size) return game.notes.includes('[ultianalytics:') ? 'import' : 'film'
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/** Imported games have no gender match, so their point ratios are placeholders. */
export const noGender = (game: Game, source: SourceKind) => source === 'import' || game.notes.includes('[ultianalytics:')

export interface GameRow {
  game: Game
  label: string
  source: SourceKind
  noGender: boolean
  /** Whole game, no point/tag filters (record, final score). */
  full: GameStats
  /** With the point and tag filters applied. */
  stats: GameStats
  /** Points and events that pass the point filters (events in missed-on-film points excluded). */
  points: Point[]
  events: GameEvent[]
}

export const shortDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '')
export const gameLabel = (g: Pick<Game, 'date' | 'opponent'>) => `${shortDate(g.date) ? `${shortDate(g.date)} ` : ''}${g.opponent}`

/** Games matching the game-level filters (tournament, picked games, source), oldest first. */
export function selectGames(d: DashData, f: DashFilter): { game: Game; source: SourceKind }[] {
  const evByGame = new Map<string, GameEvent[]>()
  for (const e of d.events) (evByGame.get(e.game_id) ?? evByGame.set(e.game_id, []).get(e.game_id)!).push(e)
  return liveOnly(d.games)
    .filter((g) => !f.tournament || g.tournament === f.tournament)
    .filter((g) => !f.games.length || f.games.includes(g.id))
    .map((g) => ({ game: g, source: gameSource(g, evByGame.get(g.id) ?? []) }))
    .filter((x) => !f.sources.length || f.sources.includes(x.source))
    .sort((a, b) => a.game.date.localeCompare(b.game.date) || a.game.created_at - b.game.created_at)
}

export function buildGameRows(d: DashData, f: DashFilter): GameRow[] {
  const pred = eventPredicate(f)
  return selectGames(d, f).map(({ game, source }) => {
    const pts = liveOnly(d.points).filter((p) => p.game_id === game.id)
    const evs = liveOnly(d.events).filter((e) => e.game_id === game.id)
    const dropped = new Set<string>()
    if (f.tags.length && f.tagScope === 'drop_points') for (const e of evs) if (hasTags(e, f.tags, f.tagMode)) dropped.add(e.point_id)
    const keep = pts.filter((p) => (f.side === 'all' || p.start_on === f.side) && !dropped.has(p.id))
    const keepIds = new Set(keep.map((p) => p.id))
    const missed = new Set(keep.filter((p) => p.missed_on_film).map((p) => p.id))
    const keptEvents = evs.filter((e) => keepIds.has(e.point_id))
    return {
      game, source, label: gameLabel(game), noGender: noGender(game, source),
      full: computeGameStats(game, pts, evs),
      stats: computeGameStats(game, keep, keptEvents, pred),
      points: keep,
      events: keptEvents.filter((e) => !missed.has(e.point_id) && (!pred || pred(e))),
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Turnovers and calls

export type TurnKind = 'throwaway' | 'drop' | 'stall' | 'other' | 'call' | 'block' | 'callahan'
export const TURN_KINDS: TurnKind[] = ['throwaway', 'drop', 'stall', 'other', 'call', 'block', 'callahan']
export const TURN_LABEL: Record<TurnKind, string> = {
  throwaway: 'Throwaway', drop: 'Drop', stall: 'Stall', other: 'Other', call: 'Call', block: 'Blocked', callahan: 'Callahan',
}

/** Which team lost the disc on this event, and how (null if it isn't a turnover). */
export function turnoverOf(e: GameEvent): { lost: TeamSide; kind: TurnKind } | null {
  switch (e.type) {
    case 'throwaway':
    case 'drop':
    case 'stall':
      return { lost: e.team, kind: e.type }
    case 'turnover':
      return { lost: e.team, kind: 'other' }
    case 'D':
      return { lost: other(e.team), kind: 'block' }
    case 'callahan':
      return { lost: other(e.team), kind: 'callahan' }
    case 'call':
      return e.call?.outcome === 'turnover' ? { lost: e.call.turnover_team ?? other(e.team), kind: 'call' } : null
    default:
      return null
  }
}

export const UNTAGGED = '(untagged)'
/** The stack an event goes in: its first user tag (events with several tags are stacked once). */
export const primaryTag = (e: GameEvent) => userTags(e.tags)[0] ?? UNTAGGED

export interface StackRow {
  key: string
  label: string
  total: number
  [stack: string]: number | string
}

/** Turnovers lost by `team`, one row per kind, stacked by tag. */
export function turnoverStacks(rows: GameRow[], team: TeamSide): { rows: StackRow[]; stacks: string[] } {
  const out = new Map<TurnKind, StackRow>()
  const stacks = new Set<string>()
  for (const r of rows) for (const e of r.events) {
    const t = turnoverOf(e)
    if (!t || t.lost !== team) continue
    const tag = primaryTag(e)
    stacks.add(tag)
    const row = out.get(t.kind) ?? { key: t.kind, label: TURN_LABEL[t.kind], total: 0 }
    row[tag] = ((row[tag] as number | undefined) ?? 0) + 1
    row.total++
    out.set(t.kind, row)
  }
  const ordered = [...stacks].sort((a, b) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b)))
  return { rows: TURN_KINDS.filter((k) => out.has(k)).map((k) => out.get(k)!), stacks: ordered }
}

/** Calls made by `team`, one row per kind, stacked by outcome. */
export function callStacks(rows: GameRow[], team: TeamSide): { rows: StackRow[]; stacks: string[] } {
  const out = new Map<string, StackRow>()
  const stacks = new Set<string>()
  for (const r of rows) for (const e of r.events) {
    if (e.type !== 'call' || !e.call || e.team !== team) continue
    stacks.add(e.call.outcome)
    const row = out.get(e.call.kind) ?? { key: e.call.kind, label: e.call.kind, total: 0 }
    row[e.call.outcome] = ((row[e.call.outcome] as number | undefined) ?? 0) + 1
    row.total++
    out.set(e.call.kind, row)
  }
  return { rows: [...out.values()].sort((a, b) => b.total - a.total), stacks: [...stacks].sort() }
}

// ---------------------------------------------------------------------------------------------
// Headline numbers

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

export interface Totals {
  games: number
  /** Finished games (ended by hand or target reached) by result; `other` = still open. */
  record: { w: number; l: number; t: number; other: number }
  points: number
  eventPoints: number
  missedPoints: number
  scored: number
  allowed: number
  holds: number
  oFinished: number
  breaks: number
  dFinished: number
  turnovers: number
  ds: number
  completions: number
  attempts: number
}

/** Our completions / throws, counted from events (thrower unknown is fine). */
function throwCounts(events: GameEvent[]) {
  let completions = 0
  let attempts = 0
  for (const e of events) {
    if (e.team === 'us' && (e.type === 'catch' || e.type === 'goal')) {
      completions++
      attempts++
    } else if (e.team === 'us' && (e.type === 'throwaway' || e.type === 'drop')) attempts++
    else if (e.team === 'them' && e.type === 'callahan') attempts++ // our throw, caught for their Callahan
  }
  return { completions, attempts }
}

export function totals(rows: GameRow[]): Totals {
  const t: Totals = { games: rows.length, record: { w: 0, l: 0, t: 0, other: 0 }, points: 0, eventPoints: 0, missedPoints: 0, scored: 0, allowed: 0, holds: 0, oFinished: 0, breaks: 0, dFinished: 0, turnovers: 0, ds: 0, completions: 0, attempts: 0 }
  for (const r of rows) {
    const res = r.full.state.result
    if (res === 'W') t.record.w++
    else if (res === 'L') t.record.l++
    else if (res === 'T') t.record.t++
    else t.record.other++
    const s = r.stats
    t.points += s.team.points
    t.missedPoints += s.team.points_missed
    t.eventPoints += s.team.points - s.team.points_missed
    for (const p of s.state.points) {
      if (!p.state.over) continue
      if (p.state.scorer === 'us') t.scored++
      else t.allowed++
      if (p.point.start_on === 'O') t.oFinished++
      else t.dFinished++
    }
    t.holds += s.team.holds
    t.breaks += s.team.breaks
    t.turnovers += s.team.turnovers
    t.ds += s.team.ds
    const tc = throwCounts(r.events)
    t.completions += tc.completions
    t.attempts += tc.attempts
  }
  return t
}

/** "6–2", "6–2–1" with ties, plus "(+1 open)" for games not finished yet. */
export const recordText = (r: Totals['record']) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}${r.other ? ` (+${r.other} open)` : ''}`

export type KpiKey = 'record' | 'diff' | 'hold' | 'break' | 'turns_pp' | 'ds_pp' | 'comp'

export interface Kpi {
  key: KpiKey
  label: string
  value: number | null
  display: string
  /** One value per game (null when the game has no data for it), oldest first. */
  series: (number | null)[]
  /** Recent games vs earlier ones (needs 4+ games with data): positive = up. */
  delta: number | null
  /** true if a higher value is better. */
  higherIsBetter: boolean
  format: 'pct' | 'num' | 'int' | 'record'
  hint: string
}

const kpiValue = (k: KpiKey, t: Totals): number | null => {
  switch (k) {
    case 'record':
      // Win share: a tie counts as half a win.
      return t.record.w + t.record.l + t.record.t ? (t.record.w + t.record.t / 2) / (t.record.w + t.record.l + t.record.t) : null
    case 'diff':
      return t.points ? t.scored - t.allowed : null
    case 'hold':
      return ratio(t.holds, t.oFinished)
    case 'break':
      return ratio(t.breaks, t.dFinished)
    case 'turns_pp':
      return ratio(t.turnovers, t.eventPoints)
    case 'ds_pp':
      return ratio(t.ds, t.eventPoints)
    case 'comp':
      return ratio(t.completions, t.attempts)
  }
}

/** Mean of the last `n` games with data vs the mean of the games before them. */
export function recentDelta(series: (number | null)[], n = 3): number | null {
  const vals = series.filter((v): v is number => v !== null)
  if (vals.length < n + 1) return null
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  return mean(vals.slice(-n)) - mean(vals.slice(0, -n))
}

const fmtPct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`)
const fmtNum = (v: number | null) => (v === null ? '–' : v.toFixed(2))

export function kpis(rows: GameRow[]): Kpi[] {
  const t = totals(rows)
  const per = rows.map((r) => totals([r]))
  const mk = (key: KpiKey, label: string, format: Kpi['format'], higherIsBetter: boolean, hint: string, display: string): Kpi => {
    const series = per.map((p) => kpiValue(key, p))
    return { key, label, value: kpiValue(key, t), display, series, delta: key === 'record' ? null : recentDelta(series), higherIsBetter, format, hint }
  }
  const diff = kpiValue('diff', t)
  return [
    mk('record', 'Record', 'record', true, 'Wins–losses(–ties) in finished games: ended by hand or the target reached, at the recorded score. Whole games, not affected by point or tag filters.', recordText(t.record)),
    mk('diff', 'Point diff', 'int', true, 'Points we scored minus points they scored, in the filtered points.', diff === null ? '–' : `${diff > 0 ? '+' : ''}${diff}`),
    mk('hold', 'Hold %', 'pct', true, 'O-line conversion: holds ÷ finished points we started on offense.', fmtPct(kpiValue('hold', t))),
    mk('break', 'Break %', 'pct', true, 'Breaks ÷ finished points we started on defense.', fmtPct(kpiValue('break', t))),
    mk('turns_pp', 'Turns / point', 'num', false, 'Our turnovers per point (points missed on film left out).', fmtNum(kpiValue('turns_pp', t))),
    mk('ds_pp', 'Ds / point', 'num', true, 'Our blocks (incl. Callahans) per point (points missed on film left out).', fmtNum(kpiValue('ds_pp', t))),
    mk('comp', 'Completion %', 'pct', true, 'Completed passes (incl. goals) ÷ throws (completions, throwaways, drops, Callahans thrown).', fmtPct(kpiValue('comp', t))),
  ]
}

/** Hold % and break % per game, for the trend chart. */
export function holdBreakTrend(rows: GameRow[]) {
  return rows.map((r) => {
    const t = totals([r])
    return { id: r.game.id, label: r.label, hold: ratio(t.holds, t.oFinished), break: ratio(t.breaks, t.dFinished), o: t.oFinished, d: t.dFinished }
  })
}

// ---------------------------------------------------------------------------------------------
// Players

export interface LeaderRow extends PlayerStats {
  turns: number
  per_point: { goals: number; assists: number; ds: number; turns: number; plus_minus: number }
  /** Throw attempts per point played (how much the disc goes through them). */
  usage: number
}

export function leaderboard(rows: GameRow[], minPoints = 0): LeaderRow[] {
  const sum = sumPlayerStats(rows.map((r) => [...r.stats.players.values()]))
  return [...sum.values()]
    .filter((s) => s.points >= minPoints && s.points > 0)
    .map((s) => {
      const pp = (v: number) => v / s.points
      return {
        ...s,
        turns: s.turnovers,
        per_point: { goals: pp(s.goals), assists: pp(s.assists), ds: pp(s.ds), turns: pp(s.turnovers), plus_minus: pp(s.plus_minus) },
        usage: pp(s.throw_attempts),
      }
    })
}

// ---------------------------------------------------------------------------------------------
// Mixed: by gender ratio of the point

export function byRatio(rows: GameRow[]) {
  const out: Record<Ratio, { holds: number; o: number; breaks: number; d: number; points: number }> = {
    W4: { holds: 0, o: 0, breaks: 0, d: 0, points: 0 },
    M4: { holds: 0, o: 0, breaks: 0, d: 0, points: 0 },
  }
  let skipped = 0
  for (const r of rows) {
    if (r.noGender) {
      skipped++
      continue
    }
    for (const p of r.stats.state.points) {
      const b = out[p.point.ratio]
      b.points++
      if (!p.state.over) continue
      if (p.point.start_on === 'O') {
        b.o++
        if (p.outcome === 'hold') b.holds++
      } else {
        b.d++
        if (p.outcome === 'break') b.breaks++
      }
    }
  }
  const view = (k: Ratio) => ({ ratio: k, label: k === 'W4' ? '4 WMP' : '4 MMP', hold: ratio(out[k].holds, out[k].o), break: ratio(out[k].breaks, out[k].d), ...out[k] })
  return { rows: [view('W4'), view('M4')], skippedGames: skipped }
}

// ---------------------------------------------------------------------------------------------
// Field heatmap (only when events have coordinates)

export type HeatMode = 'turnovers' | 'completions'

/** Counts per field zone (field is 40 wide × 110 long, in yards); null when no event has coordinates. */
export function heatmap(rows: GameRow[], mode: HeatMode, cols = 5, rowsN = 11) {
  const grid = Array.from({ length: rowsN }, () => Array<number>(cols).fill(0))
  let n = 0
  for (const r of rows) for (const e of r.events) {
    const t = turnoverOf(e)
    const want = mode === 'turnovers' ? !!t && t.lost === 'us' : e.team === 'us' && (e.type === 'catch' || e.type === 'goal')
    if (!want) continue
    const x = e.x_end ?? e.x
    const y = e.y_end ?? e.y
    if (x === null || y === null) continue
    const c = Math.min(cols - 1, Math.max(0, Math.floor((x / 40) * cols)))
    const rr = Math.min(rowsN - 1, Math.max(0, Math.floor((y / 110) * rowsN)))
    grid[rr][c]++
    n++
  }
  return n ? { grid, n, max: Math.max(...grid.flat()) } : null
}

export const hasCoordinates = (rows: GameRow[]) => rows.some((r) => r.events.some((e) => e.x !== null && e.y !== null))

// ---------------------------------------------------------------------------------------------
// Drill-down: the events behind a chart element

export type Drill =
  | { kind: 'turnover'; team: TeamSide; turn?: TurnKind; tag?: string }
  | { kind: 'call'; team: TeamSide; callKind?: string; outcome?: string }
  | { kind: 'player'; id: string }
  | { kind: 'game'; id: string; side?: 'O' | 'D' }

export interface DrillRow {
  event: GameEvent
  game: Game
  point: Point | undefined
}

const involves = (e: GameEvent, id: string) => e.actor_id === id || e.receiver_id === id || e.defender_id === id || e.call?.charged_id === id

export function drillEvents(rows: GameRow[], d: Drill): DrillRow[] {
  const out: DrillRow[] = []
  for (const r of rows) {
    if (d.kind === 'game' && r.game.id !== d.id) continue
    const pts = new Map(r.points.map((p) => [p.id, p]))
    for (const e of [...r.events].sort((a, b) => (pts.get(a.point_id)?.idx ?? 0) - (pts.get(b.point_id)?.idx ?? 0) || a.seq - b.seq)) {
      let ok = false
      if (d.kind === 'turnover') {
        const t = turnoverOf(e)
        ok = !!t && t.lost === d.team && (!d.turn || t.kind === d.turn) && (!d.tag || primaryTag(e) === d.tag)
      } else if (d.kind === 'call') {
        ok = e.type === 'call' && !!e.call && e.team === d.team && (!d.callKind || e.call.kind === d.callKind) && (!d.outcome || e.call.outcome === d.outcome)
      } else if (d.kind === 'player') {
        ok = involves(e, d.id) && !['sub', 'injury', 'note', 'half', 'cap', 'timeout'].includes(e.type)
      } else {
        ok = (e.type === 'goal' || e.type === 'callahan') && (!d.side || pts.get(e.point_id)?.start_on === d.side)
      }
      if (ok) out.push({ event: e, game: r.game, point: pts.get(e.point_id) })
    }
  }
  return out
}

/** Every user tag used in the given events, most used first. */
export function tagsInUse(events: GameEvent[]): { tag: string; n: number }[] {
  const m = new Map<string, { tag: string; n: number }>()
  for (const e of events) if (!e.deleted) for (const t of userTags(e.tags)) {
    const k = lc(t)
    const v = m.get(k) ?? { tag: t, n: 0 }
    v.n++
    m.set(k, v)
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
}

export interface Footnotes {
  missedPoints: number
  importedGames: number
  tagNote: string | null
  sideNote: string | null
}

export function footnotes(rows: GameRow[], f: DashFilter): Footnotes {
  const t = totals(rows)
  const tags = f.tags.map((x) => `“${x}”`).join(f.tagMode === 'all' ? ' and ' : ' or ')
  return {
    missedPoints: t.missedPoints,
    importedGames: rows.filter((r) => r.noGender).length,
    tagNote: !f.tags.length
      ? null
      : f.tagScope === 'drop_points'
        ? `Points containing an event tagged ${tags} are left out entirely (scores, holds and breaks too).`
        : `Event counts (goals, assists, passes, turnovers, blocks, pulls, calls) only include events ${f.tagScope === 'only' ? 'tagged' : 'not tagged'} ${tags}. Points played, holds, breaks, the score and the record use every event.`,
    sideNote: f.side === 'all' ? null : `Only points we started on ${f.side === 'O' ? 'offense (O-line)' : 'defense (D-line)'}. The record still uses whole games.`,
  }
}
