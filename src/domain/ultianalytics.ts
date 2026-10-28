import { ratioForPoint } from './abba'
import { parseCsv } from './csv'
import { replayPoint, outcomeOf } from './game'
import { newId } from './ids'
import { normalizeName } from './rosterImport'
import type { GameEvent, GenderMatch, Player, Point, Side, TeamSide } from './schema'
import { EventSchema, GameSchema, PointSchema } from './schema'

/**
 * Import from UltiAnalytics (the iUltimate / UltiAnalytics stats apps).
 *
 * Two source formats, both produced by ultianalytics.com (source: github.com/ultianalytics/UltimateWeb):
 *  - The raw stats CSV ("Download raw statistics in CSV format" on the team website, or
 *    /rest/view/team/<id>/stats/export). One row per event; the point's players are listed in
 *    Player 0..27 but who subbed when is not in it.
 *  - The game JSON (/rest/view/team/<id>/gamesdata, or an admin-site .iexport file). Each point has
 *    its line (as it ended), its substitutions and its events, so subs are exact.
 *
 * UltiAnalytics has no gender match, no video times and no opponent players, so imported games have
 * placeholder ratios (flagged in the game notes), no video times, and opponent team totals only.
 */

export const UA_ANON = 'Anonymous'
export const UA_HOST = 'https://www.ultianalytics.com'

export interface UAEvent {
  type: string // Offense | Defense | Cessation
  action: string
  passer: string | null
  receiver: string | null
  defender: string | null
  /** Seconds (UltiAnalytics clock), JSON only: used to place subs. */
  ts: number | null
  hang: number | null
}

export interface UASub {
  from: string | null
  to: string | null
  injury: boolean
  ts: number | null
}

export interface UAPoint {
  line: Side
  /** Score at the end of the point. */
  ours: number
  theirs: number
  elapsed: number | null
  /** The starting line when `exact`; otherwise everyone listed for the point (CSV: subs included). */
  players: string[]
  exact: boolean
  subs: UASub[]
  events: UAEvent[]
}

export interface UAGame {
  /** Stable key for this game in its source (UltiAnalytics game id, or the CSV's date/time + opponent). */
  key: string
  ua_id: string | null
  opponent: string
  tournament: string
  timestamp: string
  date: string
  game_to: number | null
  final: { ours: number; theirs: number } | null
  timeouts_per_half: number | null
  points: UAPoint[]
  source: 'csv' | 'json'
}

export interface UAPlayer {
  name: string
  number: string | null
  gender: GenderMatch | null
}

export interface UAParse {
  format: 'csv' | 'json' | 'iexport'
  team: string | null
  games: UAGame[]
  players: UAPlayer[]
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim())
const who = (v: unknown) => {
  const s = str(v)
  return s ? s : null
}
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(str(v))
  return Number.isFinite(n) ? n : null
}

/** "2026-10-20 2:40 PM" (with a narrow no-break space) or "2026-03-29 09:53" → "2026-10-20". */
export function uaDate(ts: string): string {
  const m = ts.match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}
const cleanTs = (ts: string) => ts.replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim()

/** Points made only of Cessation events (period ends, game over) fold into the point before them. */
function foldCessations(points: UAPoint[]): UAPoint[] {
  const out: UAPoint[] = []
  for (const p of points) {
    if (p.events.length && p.events.every((e) => e.type === 'Cessation')) {
      const prev = out.at(-1)
      if (prev) prev.events.push(...p.events)
      continue
    }
    out.push(p)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// CSV

const CSV_REQUIRED = ['Event Type', 'Action', 'Our Score - End of Point', 'Their Score - End of Point', 'Line']

export function isUltiCsvHeader(cells: string[]) {
  const h = new Set(cells.map((c) => c.trim()))
  return CSV_REQUIRED.every((c) => h.has(c))
}

/** Parse the UltiAnalytics raw stats CSV (one team, one or many games). */
export function parseUltiCsv(text: string): UAParse {
  const rows = parseCsv(text)
  if (!rows.length || !isUltiCsvHeader(rows[0])) {
    throw new Error('Not an UltiAnalytics stats CSV (expected columns like "Event Type", "Action", "Our Score - End of Point").')
  }
  const head = rows[0].map((c) => c.trim())
  const col = (name: string) => head.indexOf(name)
  const C = {
    team: col('Team'),
    date: col('Date/Time'),
    tour: col('Tournamemnt') >= 0 ? col('Tournamemnt') : col('Tournament'), // sic: the export misspells it
    opp: col('Opponent'),
    elapsed: col('Point Elapsed Seconds'),
    line: col('Line'),
    ours: col('Our Score - End of Point'),
    theirs: col('Their Score - End of Point'),
    type: col('Event Type'),
    action: col('Action'),
    passer: col('Passer'),
    receiver: col('Receiver'),
    defender: col('Defender'),
    hang: col('Hang Time (secs)'),
  }
  const playerCols = head.map((h, i) => (/^Player \d+$/.test(h) ? i : -1)).filter((i) => i >= 0)
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')

  const games: UAGame[] = []
  let game: UAGame | null = null
  let point: UAPoint | null = null
  let pointKey = ''
  let team: string | null = null
  for (const r of rows.slice(1)) {
    const ts = cleanTs(get(r, C.date))
    const opp = get(r, C.opp)
    const tour = get(r, C.tour)
    const gk = `${ts}|${tour}|${opp}`
    if (!team && C.team >= 0) team = get(r, C.team) || null
    if (!game || game.key !== gk) {
      game = { key: gk, ua_id: null, opponent: opp, tournament: tour, timestamp: ts, date: uaDate(ts), game_to: null, final: null, timeouts_per_half: null, points: [], source: 'csv' }
      games.push(game)
      point = null
    }
    const line: Side = get(r, C.line).toUpperCase() === 'D' ? 'D' : 'O'
    const ours = num(get(r, C.ours)) ?? 0
    const theirs = num(get(r, C.theirs)) ?? 0
    const elapsed = num(get(r, C.elapsed))
    const pk = `${line}|${ours}|${theirs}|${elapsed}`
    if (!point || pk !== pointKey) {
      const players = [...new Set(playerCols.map((i) => get(r, i)).filter((n) => n && n !== UA_ANON))]
      point = { line, ours, theirs, elapsed, players, exact: false, subs: [], events: [] }
      pointKey = pk
      game.points.push(point)
    }
    point.events.push({
      type: get(r, C.type),
      action: get(r, C.action),
      passer: who(get(r, C.passer)),
      receiver: who(get(r, C.receiver)),
      defender: who(get(r, C.defender)),
      ts: null,
      hang: num(get(r, C.hang)) || null,
    })
  }
  for (const g of games) {
    g.points = foldCessations(g.points)
    const last = g.points.at(-1)
    g.final = last ? { ours: last.ours, theirs: last.theirs } : null
  }
  return { format: 'csv', team, games, players: [] }
}

// ---------------------------------------------------------------------------------------------
// JSON (team website API / .iexport)

interface RawGame {
  gameId?: string
  opponentName?: string
  tournamentName?: string
  timestamp?: string
  gamePoint?: number
  ours?: number
  theirs?: number
  pointsJson?: string
  points?: unknown[]
  timeoutDetailsJson?: string
  deleted?: boolean
}

interface RawPoint {
  line?: string[]
  substitutions?: { fromPlayer?: string; toPlayer?: string; reason?: string; timestamp?: number }[]
  events?: { type?: string; action?: string; passer?: string; receiver?: string; defender?: string; timestamp?: number; details?: { hangtime?: number } }[]
  summary?: { lineType?: string; score?: { ours?: number; theirs?: number }; elapsedTime?: number }
}

const asJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)

export function uaGameFromJson(g: RawGame): UAGame {
  const raw = (g.pointsJson ? asJson(g.pointsJson) : g.points ?? []) as RawPoint[]
  const points: UAPoint[] = raw.map((p) => {
    const endLine = (p.line ?? []).map(str).filter((n) => n && n !== UA_ANON)
    const subs: UASub[] = (p.substitutions ?? [])
      .map((s) => ({ from: who(s.fromPlayer), to: who(s.toPlayer), injury: str(s.reason).toLowerCase() === 'injury', ts: num(s.timestamp) }))
      .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
    // `line` is the line as the point ended: undo the subs (newest first) to get who started.
    let start = [...endLine]
    for (const s of [...subs].reverse()) {
      if (s.to) start = start.filter((n) => n !== s.to)
      if (s.from && !start.includes(s.from)) start.push(s.from)
    }
    return {
      line: str(p.summary?.lineType).toUpperCase() === 'D' ? 'D' : 'O',
      ours: num(p.summary?.score?.ours) ?? 0,
      theirs: num(p.summary?.score?.theirs) ?? 0,
      elapsed: num(p.summary?.elapsedTime),
      players: start,
      exact: true,
      subs,
      events: (p.events ?? []).map((e) => ({
        type: str(e.type),
        action: str(e.action),
        passer: who(e.passer),
        receiver: who(e.receiver),
        defender: who(e.defender),
        ts: num(e.timestamp),
        hang: e.details?.hangtime ? e.details.hangtime / 1000 : null,
      })),
    }
  })
  let tph: number | null = null
  try {
    tph = num(asJson(g.timeoutDetailsJson ?? 'null')?.quotaPerHalf)
  } catch {
    tph = null
  }
  const ts = cleanTs(str(g.timestamp))
  const gp = num(g.gamePoint)
  return {
    key: str(g.gameId) || `${ts}|${str(g.tournamentName)}|${str(g.opponentName)}`,
    ua_id: str(g.gameId) || null,
    opponent: str(g.opponentName),
    tournament: str(g.tournamentName),
    timestamp: ts,
    date: uaDate(ts),
    game_to: gp && gp >= 3 && gp <= 50 ? gp : null, // 1000 = no game point set
    final: g.ours !== undefined && g.theirs !== undefined ? { ours: num(g.ours) ?? 0, theirs: num(g.theirs) ?? 0 } : null,
    timeouts_per_half: tph,
    points: foldCessations(points),
    source: 'json',
  }
}

interface RawPlayer {
  name?: string
  number?: string
  male?: boolean
}

export function uaPlayersFromJson(list: unknown, mixed: boolean): UAPlayer[] {
  if (!Array.isArray(list)) return []
  return (list as RawPlayer[])
    .map((p) => ({
      name: str(p.name),
      number: /^\d{1,2}$/.test(str(p.number)) ? str(p.number) : null,
      // `male` defaults to true in UltiAnalytics; it only means something on a mixed team.
      gender: mixed && typeof p.male === 'boolean' ? ((p.male ? 'M' : 'W') as GenderMatch) : null,
    }))
    .filter((p) => p.name && p.name !== UA_ANON)
}

/** Parse UltiAnalytics JSON: a gamesdata array, one game, or a .iexport file ({teamJson, gameJson}). */
export function parseUltiJson(text: string): UAParse {
  const v = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (v && typeof v === 'object' && !Array.isArray(v) && 'gameJson' in v) {
    const x = v as { gameJson: unknown; teamJson?: unknown }
    const team = (x.teamJson ? asJson(x.teamJson) : null) as { name?: string; players?: unknown; mixed?: boolean } | null
    return {
      format: 'iexport',
      team: team?.name ?? null,
      games: [uaGameFromJson(asJson(x.gameJson) as RawGame)],
      players: uaPlayersFromJson(team?.players, team?.mixed ?? false),
    }
  }
  const list = (Array.isArray(v) ? v : [v]) as RawGame[]
  if (!list.every((g) => g && typeof g === 'object' && ('pointsJson' in g || 'points' in g))) {
    throw new Error('Not UltiAnalytics game data (expected games with "pointsJson").')
  }
  return { format: 'json', team: null, games: list.filter((g) => !g.deleted).map(uaGameFromJson), players: [] }
}

/** Parse whatever the user gave us: the CSV export, game JSON, or an .iexport file. */
export function parseUltiInput(text: string): UAParse {
  const t = text.trim()
  if (!t) throw new Error('Nothing to import.')
  if (t.startsWith('{') || t.startsWith('[')) return parseUltiJson(t)
  return parseUltiCsv(t)
}

/**
 * Team website link or ID → the numeric team ID. Accepts
 * https://www.ultianalytics.com/app/#/5629499534213120/games, …/team/5629499534213120/main, or the number.
 */
export function uaTeamId(input: string): string | null {
  const s = input.trim()
  if (/^\d{4,20}$/.test(s)) return s
  if (!/ultianalytics\.com|iultimate/i.test(s)) return null
  const m = s.match(/(?:#\/|\/team\/|\/app\/)(\d{4,20})(?:\b|\/|$)/) ?? s.match(/\b(\d{8,20})\b/)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------------------------
// Fetch from the team website (public teams only)

export interface UATeamInfo {
  name: string
  mixed: boolean
  numberOfGames: number | null
}

export class UAFetchError extends Error {
  readonly kind: 'unreachable' | 'not_found' | 'password' | 'http'
  constructor(kind: UAFetchError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

async function getJson(fetchFn: FetchFn, url: string): Promise<unknown> {
  let r: Response
  try {
    r = await fetchFn(url, { credentials: 'omit', cache: 'no-store' })
  } catch {
    throw new UAFetchError('unreachable', 'Could not reach ultianalytics.com (offline, or the site is down). Use the CSV instead.')
  }
  if (r.status === 401 || r.status === 403) {
    throw new UAFetchError('password', 'This team website has a password, so other apps cannot read it. Download the CSV from the team website instead (see How to get the file).')
  }
  if (r.status === 404 || r.status === 500) throw new UAFetchError('not_found', 'No UltiAnalytics team with that ID. Check the link from the Website tab of the app.')
  if (!r.ok) throw new UAFetchError('http', `UltiAnalytics answered HTTP ${r.status}. Try again later or use the CSV.`)
  const text = await r.text()
  if (!text.trim() || text.trim() === 'null') throw new UAFetchError('not_found', 'No UltiAnalytics team with that ID.')
  return JSON.parse(text)
}

/** Read a public team straight from the UltiAnalytics API (it allows cross-site reads). */
export async function fetchUltiTeam(teamId: string, fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<UAParse & { info: UATeamInfo }> {
  const base = `${UA_HOST}/rest/view/team/${encodeURIComponent(teamId)}`
  const t = (await getJson(fetchFn, base)) as { name?: string; mixed?: boolean; numberOfGames?: number }
  const [players, games] = await Promise.all([getJson(fetchFn, `${base}/players`), getJson(fetchFn, `${base}/gamesdata`)])
  const parsed = parseUltiJson(JSON.stringify(games ?? []))
  const info: UATeamInfo = { name: str(t.name), mixed: !!t.mixed, numberOfGames: num(t.numberOfGames) }
  return { ...parsed, team: info.name || null, players: uaPlayersFromJson(players, info.mixed), info }
}

export const uaCsvUrl = (teamId: string) => `${UA_HOST}/rest/view/team/${encodeURIComponent(teamId)}/stats/export`
export const uaWebsiteUrl = (teamId: string) => `${UA_HOST}/app/#/${encodeURIComponent(teamId)}/download`

// ---------------------------------------------------------------------------------------------
// Players

/** Every player name in the games, with how many events/points mention them. */
export function collectNames(games: UAGame[]): Map<string, number> {
  const m = new Map<string, number>()
  const add = (n: string | null) => {
    if (n && n !== UA_ANON) m.set(n, (m.get(n) ?? 0) + 1)
  }
  for (const g of games) {
    for (const p of g.points) {
      p.players.forEach(add)
      for (const s of p.subs) {
        add(s.from)
        add(s.to)
      }
      for (const e of p.events) {
        add(e.passer)
        add(e.receiver)
        add(e.defender)
      }
    }
  }
  return m
}

/** What an UltiAnalytics name maps to: a roster player, a new player, or nobody (left blank). */
export type NameChoice = { kind: 'player'; id: string } | { kind: 'new' } | { kind: 'none' }

/**
 * Suggest a roster player for each name: a remembered choice, then an exact name match, then a
 * unique first-name, last-name or no-spaces match (UltiAnalytics names are often nicknames).
 */
export function suggestMatches(names: string[], roster: Pick<Player, 'id' | 'name' | 'deleted'>[], remembered: Record<string, string> = {}): Map<string, NameChoice> {
  const live = roster.filter((p) => !p.deleted)
  const norm = (s: string) => normalizeName(s)
  const unique = (f: (p: (typeof live)[number]) => boolean) => {
    const hits = live.filter(f)
    return hits.length === 1 ? hits[0] : null
  }
  const out = new Map<string, NameChoice>()
  for (const name of names) {
    const n = norm(name)
    const rem = remembered[name]
    const hit =
      (rem && live.find((p) => p.id === rem)) ||
      unique((p) => norm(p.name) === n) ||
      unique((p) => norm(p.name).split(' ')[0] === n) ||
      unique((p) => norm(p.name).split(' ').at(-1) === n) ||
      unique((p) => norm(p.name).replace(/[^a-z0-9]/g, '') === n.replace(/[^a-z0-9]/g, ''))
    out.set(name, hit ? { kind: 'player', id: hit.id } : { kind: 'new' })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Conversion to our event log

type EventRow = GameEvent
type Mapper = (name: string | null) => string | null

export interface GamePlan {
  ua: UAGame
  game: import('./schema').Game
  points: Point[]
  events: EventRow[]
  score: { us: number; them: number }
  warnings: string[]
  /** Unmapped UltiAnalytics actions → count. */
  skipped: Record<string, number>
}

type Draft = Pick<GameEvent, 'type' | 'team'> & Partial<Pick<GameEvent, 'actor_id' | 'receiver_id' | 'defender_id' | 'tags' | 'note'>>

const PERIOD_NOTES: Record<string, string> = {
  EndOfFirstQuarter: 'End of 1st quarter',
  EndOfThirdQuarter: 'End of 3rd quarter',
  EndOfFourthQuarter: 'End of 4th quarter',
  EndOfOvertime: 'End of overtime',
}

/** One UltiAnalytics event → our event draft; null = nothing to record; 'unknown' = not mapped. */
export function mapUAEvent(e: UAEvent, P: Mapper): Draft | null | 'unknown' {
  const us: TeamSide = 'us'
  const them: TeamSide = 'them'
  const hang = e.hang ? `Hang time ${Math.round(e.hang * 10) / 10}s` : undefined
  switch (`${e.type}:${e.action}`) {
    case 'Offense:Catch':
      return { type: 'catch', team: us, actor_id: P(e.passer), receiver_id: P(e.receiver) }
    case 'Offense:Drop':
      return { type: 'drop', team: us, actor_id: P(e.passer), receiver_id: P(e.receiver) }
    case 'Offense:Goal':
      return { type: 'goal', team: us, actor_id: P(e.passer), receiver_id: P(e.receiver) }
    case 'Offense:Throwaway':
      return { type: 'throwaway', team: us, actor_id: P(e.passer) }
    case 'Offense:Stall':
      return { type: 'stall', team: us, actor_id: P(e.passer) }
    case 'Offense:MiscPenalty':
      return { type: 'turnover', team: us, actor_id: P(e.passer), note: 'Misc. penalty (UltiAnalytics)' }
    case 'Offense:Callahan': // our thrower was Callahan'd
      return { type: 'callahan', team: them, actor_id: P(e.passer) }
    case 'Offense:PickupDisc':
      return { type: 'pickup', team: us, actor_id: P(e.passer) }
    case 'Offense:OpponentPull':
      return { type: 'pull', team: them, note: hang }
    case 'Offense:OpponentPullOb':
      return { type: 'pull', team: them, tags: ['ob'], note: hang }
    case 'Offense:PullBegin':
      return null
    case 'Defense:Pull':
      return { type: 'pull', team: us, actor_id: P(e.defender), note: hang }
    case 'Defense:PullOb':
      return { type: 'pull', team: us, actor_id: P(e.defender), tags: ['ob'], note: hang }
    case 'Defense:D':
      return { type: 'D', team: us, defender_id: P(e.defender) }
    case 'Defense:Callahan':
      return { type: 'callahan', team: us, defender_id: P(e.defender) }
    case 'Defense:Throwaway':
      return { type: 'throwaway', team: them }
    case 'Defense:Goal':
      return { type: 'goal', team: them }
    case 'Defense:OpponentCatch':
      return { type: 'catch', team: them }
    case 'Defense:PickupDisc':
      return { type: 'pickup', team: them }
    case 'Cessation:Timeout': // UltiAnalytics only tracks the stat-keeping team's timeouts
      return { type: 'timeout', team: us }
    case 'Cessation:Halftime':
      return { type: 'half', team: us }
    case 'Cessation:GameOver':
      return null
  }
  if (e.type === 'Cessation' && PERIOD_NOTES[e.action]) return { type: 'note', team: us, note: PERIOD_NOTES[e.action] }
  return 'unknown'
}

const sameOpp = (a: string, b: string) => normalizeName(a) === normalizeName(b)

export const importMarker = (ua: UAGame) => `[ultianalytics:${ua.ua_id ?? ua.key}]`

/**
 * Turn one UltiAnalytics game into our rows (not saved). `P` maps names to player ids
 * (null = unknown player). Events are source 'import' with no video time.
 */
export function planGame(ua: UAGame, P: Mapper, opts: { team_id: string; now?: number; today?: string }): GamePlan {
  const now = opts.now ?? Date.now()
  const meta = { created_at: now, updated_at: now, edited_at: null, deleted: false }
  const warnings: string[] = []
  const skipped: Record<string, number> = {}
  const gameId = newId()
  const points: Point[] = []
  const events: EventRow[] = []
  const score = { us: 0, them: 0 }

  ua.points.forEach((up, i) => {
    const idx = i + 1
    const pointId = newId()
    const ids = (names: string[]) => [...new Set(names.map(P).filter((x): x is string => !!x))]
    // Starting line. The CSV lists everyone who played the point (subs too, in no order): keep
    // the first seven to touch the disc as the line and record the rest as coming on.
    let start = ids(up.players)
    const extra: string[] = []
    if (!up.exact && start.length > 7) {
      const order: string[] = []
      for (const e of up.events) for (const n of [e.passer, e.receiver, e.defender]) {
        const id = P(n)
        if (id && start.includes(id) && !order.includes(id)) order.push(id)
      }
      const ranked = [...order, ...start.filter((id) => !order.includes(id))]
      start = ranked.slice(0, 7)
      extra.push(...ranked.slice(7))
      warnings.push(`Point ${idx}: ${up.players.length} players listed (subs). The CSV doesn't say who came off or when, so ${extra.length} ${extra.length === 1 ? 'is' : 'are'} recorded as subbing on at the start. Import from the team link for exact subs.`)
    } else if (start.length > 7) {
      start = start.slice(0, 7)
      warnings.push(`Point ${idx}: more than 7 players on the line; kept the first 7.`)
    }

    const drafts: { d: Draft; ts: number | null }[] = []
    for (const id of extra) drafts.push({ d: { type: 'sub', team: 'us', actor_id: null, receiver_id: id, note: 'Listed in UltiAnalytics; sub timing unknown' }, ts: Number.NEGATIVE_INFINITY })
    for (const e of up.events) {
      const d = mapUAEvent(e, P)
      if (d === 'unknown') {
        const k = `${e.type} ${e.action}`.trim()
        skipped[k] = (skipped[k] ?? 0) + 1
        continue
      }
      if (d) drafts.push({ d, ts: e.ts })
    }
    // Exact subs (JSON): place each before the first event that happened after it.
    for (const s of up.subs) {
      const d: Draft = { type: s.injury ? 'injury' : 'sub', team: 'us', actor_id: P(s.from), receiver_id: P(s.to) }
      const at = s.ts === null ? -1 : drafts.findIndex((x) => x.ts !== null && x.ts > s.ts!)
      drafts.splice(at < 0 ? drafts.length : at, 0, { d, ts: s.ts })
    }

    const evs: EventRow[] = drafts.map(({ d }, k) =>
      EventSchema.parse({
        id: newId(), game_id: gameId, point_id: pointId, seq: k + 1, source: 'import', time_source: 'none', video_time: null,
        actor_id: null, receiver_id: null, defender_id: null, tags: [], ...d, ...meta,
        note: d.note ?? '',
      }),
    )
    const st = replayPoint(up.line, evs)
    const before = { ...score }
    if (st.scorer) score[st.scorer]++
    // Compare who scored this point (not the running score, so one bad point is one warning).
    const prev = i ? ua.points[i - 1] : { ours: 0, theirs: 0 }
    const uaScorer: TeamSide | null = up.ours > prev.ours ? 'us' : up.theirs > prev.theirs ? 'them' : null
    if (uaScorer !== st.scorer) {
      const say = (t: TeamSide | null) => (t === 'us' ? 'our goal' : t === 'them' ? 'their goal' : 'no goal')
      warnings.push(`Point ${idx}: the events give ${say(st.scorer)}, but UltiAnalytics scores it as ${say(uaScorer)} (${up.ours}–${up.theirs}).`)
    }
    const puller = evs.find((e) => e.type === 'pull' && e.team === 'us')?.actor_id ?? null
    points.push(
      PointSchema.parse({
        id: pointId, game_id: gameId, idx, score_us: before.us, score_them: before.them, start_on: up.line,
        ratio: ratioForPoint('W4', idx), line: start, pulled_by: puller, outcome: outcomeOf(up.line, st.scorer),
        video_start: null, video_end: null, missed_on_film: false, manual_result: null, ...meta,
      }),
    )
    events.push(...evs)
  })

  if (ua.final && (ua.final.ours !== score.us || ua.final.theirs !== score.them)) {
    warnings.push(`Final score here is ${score.us}–${score.them}, UltiAnalytics says ${ua.final.ours}–${ua.final.theirs}.`)
  }
  const nSkipped = Object.values(skipped).reduce((a, b) => a + b, 0)
  if (nSkipped) warnings.push(`Skipped ${nSkipped} event${nSkipped > 1 ? 's' : ''} with no equivalent here: ${Object.entries(skipped).map(([k, v]) => `${k} ×${v}`).join(', ')}.`)
  if (!ua.points.length) warnings.push('No points in this game.')

  const hi = Math.max(score.us, score.them)
  const game = GameSchema.parse({
    id: gameId, team_id: opts.team_id, opponent: ua.opponent || 'Unknown opponent', tournament: ua.tournament, date: ua.date,
    game_to: ua.game_to ?? (hi >= 1 && score.us !== score.them ? hi : Math.max(hi + 1, 1)),
    caps: { half: null, soft: null, hard: null },
    // A finished game in UltiAnalytics: ended here too, at the recorded score.
    ended_at: now,
    timeouts_per_half: ua.timeouts_per_half ?? 2,
    ratio_first: 'W4',
    start_on: ua.points[0]?.line ?? 'O',
    notes:
      `Imported from UltiAnalytics (${ua.source === 'csv' ? 'stats CSV' : 'team website'}) on ${opts.today ?? new Date(now).toISOString().slice(0, 10)}, ` +
      `played ${ua.timestamp || ua.date}. UltiAnalytics has no gender match, so point ratios are placeholders and the ratio is not checked. ${importMarker(ua)}`,
    ...meta,
  })
  return { ua, game, points, events, score, warnings, skipped }
}

/** A game already in the app with the same opponent, date and final score (or the same import marker). */
export function findDuplicate(
  plan: Pick<GamePlan, 'ua' | 'score'>,
  existing: { game: Pick<import('./schema').Game, 'id' | 'opponent' | 'date' | 'notes' | 'deleted'>; score: { us: number; them: number } }[],
) {
  const marker = importMarker(plan.ua)
  return (
    existing.find(
      ({ game, score }) =>
        !game.deleted &&
        (game.notes.includes(marker) ||
          (sameOpp(game.opponent, plan.ua.opponent || 'Unknown opponent') && game.date === plan.ua.date && score.us === plan.score.us && score.them === plan.score.them)),
    )?.game ?? null
  )
}
