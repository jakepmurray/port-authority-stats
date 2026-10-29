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
}
export const DEFAULT_CONN: ConnFilter = { opponent: '', line: [] }

/** The rows narrowed to an opponent and to points with the chosen players on the line. */
export function connRows(rows: GameRow[], f: ConnFilter): GameRow[] {
  return rows
    .filter((r) => !f.opponent || r.game.opponent.trim().toLowerCase() === f.opponent.trim().toLowerCase())
    .map((r) => {
      if (!f.line.length) return r
      const pts = r.points.filter((p) => f.line.every((id) => p.line.includes(id)))
      const ids = new Set(pts.map((p) => p.id))
      return { ...r, points: pts, events: r.events.filter((e) => ids.has(e.point_id)) }
    })
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
