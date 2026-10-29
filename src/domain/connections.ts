import type { DrillRow, GameRow } from './dashboard'
import type { GameEvent, GenderMatch } from './schema'

/**
 * Who throws to whom (like UltiAnalytics' passing matrix). Counted from our events in
 * the rows the dashboard filters already produced (games, O/D points, tags), plus
 * an opponent and an on-the-line filter here:
 * - completion: a catch or a goal (thrower = actor, receiver = receiver)
 * - turnover on the pair: a drop (receiver = who dropped it), or a throwaway with an
 *   intended receiver recorded. Throwaways without one count for the thrower only.
 */
export type PairOutcome = 'completion' | 'turnover'

export function pairOf(e: GameEvent): { thrower: string; receiver: string; outcome: PairOutcome } | null {
  if (e.team !== 'us' || !e.actor_id || !e.receiver_id || e.actor_id === e.receiver_id) return null
  if (e.type === 'catch' || e.type === 'goal') return { thrower: e.actor_id, receiver: e.receiver_id, outcome: 'completion' }
  if (e.type === 'drop' || e.type === 'throwaway') return { thrower: e.actor_id, receiver: e.receiver_id, outcome: 'turnover' }
  return null
}

export interface ConnFilter {
  /** Normalized opponent name match ('' = all). */
  opponent: string
  /** Only points that started with all of these players on the line. */
  line: string[]
  /** Leave out throws by these players (they still count as receivers). */
  exThrowers?: string[]
  /** Leave out throws to these players (they still count as throwers). */
  exReceivers?: string[]
  /** Leave out these players entirely: throws by them and to them. */
  exPlayers?: string[]
}
export const DEFAULT_CONN: ConnFilter = { opponent: '', line: [], exThrowers: [], exReceivers: [], exPlayers: [] }

/** Is this pair left out by the filter's exclusions? */
export function excluded(f: ConnFilter, thrower: string, receiver: string): boolean {
  const all = f.exPlayers ?? []
  return (f.exThrowers ?? []).includes(thrower) || (f.exReceivers ?? []).includes(receiver) || all.includes(thrower) || all.includes(receiver)
}

const hasExclusions = (f: ConnFilter) => !!(f.exThrowers?.length || f.exReceivers?.length || f.exPlayers?.length)

/**
 * The rows narrowed to an opponent, to points with the chosen players on the line, and
 * without the excluded throwers' / receivers' throws (so every view, metric and drill-down agrees).
 */
export function connRows(rows: GameRow[], f: ConnFilter): GameRow[] {
  const ex = hasExclusions(f)
  return rows
    .filter((r) => !f.opponent || r.game.opponent.trim().toLowerCase() === f.opponent.trim().toLowerCase())
    .map((r) => {
      if (!f.line.length && !ex) return r
      const pts = f.line.length ? r.points.filter((p) => f.line.every((id) => p.line.includes(id))) : r.points
      const ids = new Set(pts.map((p) => p.id))
      const events = r.events.filter((e) => {
        if (!ids.has(e.point_id)) return false
        const p = ex ? pairOf(e) : null
        return !p || !excluded(f, p.thrower, p.receiver)
      })
      return { ...r, points: pts, events }
    })
}

/** The card's own settings, kept in the dashboard link next to the dashboard filters. */
export type ConnMetric = 'completions' | 'turnovers' | 'pct'
export type ConnView = 'matrix' | 'top' | 'gender'
export interface ConnState extends Required<ConnFilter> {
  view: ConnView
  metric: ConnMetric
  min: number
}
export const DEFAULT_CONN_STATE: ConnState = { view: 'matrix', metric: 'completions', min: 1, opponent: '', line: [], exThrowers: [], exReceivers: [], exPlayers: [] }
/** URL params (all start with "c", none clash with the dashboard's t, g, side, src, tags, tm, ts, team_src). */
export const CONN_KEYS = ['cv', 'cm', 'co', 'cl', 'cmin', 'cxt', 'cxr', 'cxp']

const ids = (v: string | null) => (v ? [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))] : [])

export function parseConnState(query: string): ConnState {
  const q = new URLSearchParams(query.replace(/^\?/, ''))
  const view = q.get('cv')
  const metric = q.get('cm')
  const min = Number(q.get('cmin'))
  return {
    view: view === 'top' || view === 'gender' ? view : 'matrix',
    metric: metric === 'turnovers' || metric === 'pct' ? metric : 'completions',
    min: Number.isInteger(min) && min >= 1 ? Math.min(min, 999) : 1,
    opponent: q.get('co') ?? '',
    line: ids(q.get('cl')),
    exThrowers: ids(q.get('cxt')),
    exReceivers: ids(q.get('cxr')),
    exPlayers: ids(q.get('cxp')),
  }
}

/** Only non-default values, so the plain dashboard link stays clean. */
export function connStateToQuery(s: ConnState): string {
  const q = new URLSearchParams()
  if (s.view !== 'matrix') q.set('cv', s.view)
  if (s.metric !== 'completions') q.set('cm', s.metric)
  if (s.opponent) q.set('co', s.opponent)
  if (s.line.length) q.set('cl', s.line.join(','))
  if (s.min !== 1) q.set('cmin', String(s.min))
  if (s.exThrowers.length) q.set('cxt', s.exThrowers.join(','))
  if (s.exReceivers.length) q.set('cxr', s.exReceivers.join(','))
  if (s.exPlayers.length) q.set('cxp', s.exPlayers.join(','))
  return q.toString()
}

/** "Excluding receivers: Kit · Excluding throwers: Sam, Ana" (empty when nothing is excluded). */
export function exclusionNote(f: ConnFilter, name: (id: string) => string): string {
  const part = (label: string, list: string[] | undefined) => (list?.length ? `${label}: ${list.map(name).join(', ')}` : '')
  return [part('Excluding throwers', f.exThrowers), part('Excluding receivers', f.exReceivers), part('Excluding entirely', f.exPlayers)].filter(Boolean).join(' · ')
}

export interface PairStat {
  thrower: string
  receiver: string
  completions: number
  turnovers: number
  attempts: number
  pct: number | null
}

export interface Matrix {
  pairs: PairStat[]
  /** Throwers / receivers by volume (attempts), most first. */
  throwers: { id: string; n: number }[]
  receivers: { id: string; n: number }[]
  max: { completions: number; turnovers: number }
}

export function passMatrix(rows: GameRow[]): Matrix {
  const m = new Map<string, PairStat>()
  for (const r of rows) for (const e of r.events) {
    const p = pairOf(e)
    if (!p) continue
    const k = `${p.thrower}>${p.receiver}`
    const s = m.get(k) ?? { thrower: p.thrower, receiver: p.receiver, completions: 0, turnovers: 0, attempts: 0, pct: null }
    if (p.outcome === 'completion') s.completions++
    else s.turnovers++
    s.attempts++
    m.set(k, s)
  }
  const pairs = [...m.values()].map((s) => ({ ...s, pct: s.attempts ? s.completions / s.attempts : null }))
  const vol = (key: 'thrower' | 'receiver') => {
    const n = new Map<string, number>()
    for (const s of pairs) n.set(s[key], (n.get(s[key]) ?? 0) + s.attempts)
    return [...n.entries()].map(([id, v]) => ({ id, n: v })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))
  }
  return {
    pairs,
    throwers: vol('thrower'),
    receivers: vol('receiver'),
    max: { completions: Math.max(0, ...pairs.map((p) => p.completions)), turnovers: Math.max(0, ...pairs.map((p) => p.turnovers)) },
  }
}

/** Strongest pairs: most completions, then best %, among pairs with at least `min` throws. */
export function topConnections(m: Matrix, n = 10, min = 1): PairStat[] {
  return m.pairs
    .filter((p) => p.attempts >= min && p.completions > 0)
    .sort((a, b) => b.completions - a.completions || (b.pct ?? 0) - (a.pct ?? 0) || a.thrower.localeCompare(b.thrower))
    .slice(0, n)
}

export interface GenderCell {
  key: string
  from: GenderMatch
  to: GenderMatch
  completions: number
  turnovers: number
  attempts: number
  pct: number | null
  /** Share of all pair throws. */
  share: number | null
}

/** WMP→WMP, WMP→MMP, MMP→WMP, MMP→MMP (players without a gender match are left out). */
export function genderSplit(m: Matrix, genderOf: (id: string) => GenderMatch | undefined): GenderCell[] {
  const order: [GenderMatch, GenderMatch][] = [['W', 'W'], ['W', 'M'], ['M', 'W'], ['M', 'M']]
  const cells = order.map(([from, to]) => ({ key: `${from}${to}`, from, to, completions: 0, turnovers: 0, attempts: 0, pct: null as number | null, share: null as number | null }))
  for (const p of m.pairs) {
    const c = cells.find((x) => x.from === genderOf(p.thrower) && x.to === genderOf(p.receiver))
    if (!c) continue
    c.completions += p.completions
    c.turnovers += p.turnovers
    c.attempts += p.attempts
  }
  const total = cells.reduce((s, c) => s + c.attempts, 0)
  return cells.map((c) => ({ ...c, pct: c.attempts ? c.completions / c.attempts : null, share: total ? c.attempts / total : null }))
}

/** The throws behind one matrix cell (or a whole thrower row / receiver column when one side is null). */
export function pairEvents(rows: GameRow[], thrower: string | null, receiver: string | null, outcome?: PairOutcome): DrillRow[] {
  const out: DrillRow[] = []
  for (const r of rows) {
    const pts = new Map(r.points.map((p) => [p.id, p]))
    for (const e of [...r.events].sort((a, b) => (pts.get(a.point_id)?.idx ?? 0) - (pts.get(b.point_id)?.idx ?? 0) || a.seq - b.seq)) {
      const p = pairOf(e)
      if (!p || (thrower && p.thrower !== thrower) || (receiver && p.receiver !== receiver) || (outcome && p.outcome !== outcome)) continue
      out.push({ event: e, game: r.game, point: pts.get(e.point_id) })
    }
  }
  return out
}
