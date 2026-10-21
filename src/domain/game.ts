import { ratioForPoint } from './abba'
import type { Game, GameEvent, Point, PointOutcome, Ratio, Side, TeamSide } from './schema'

export const other = (t: TeamSide): TeamSide => (t === 'us' ? 'them' : 'us')
export const flipSide = (s: Side): Side => (s === 'O' ? 'D' : 'O')

/** Events that are bookkeeping only and never change possession. */
export const META_TYPES = new Set<GameEvent['type']>(['timeout', 'sub', 'injury', 'half', 'cap', 'note', 'throw'])
/** Events that turn the disc over from the team that had it (team = the team that lost it). */
export const TURNOVER_TYPES = new Set<GameEvent['type']>(['throwaway', 'drop', 'stall', 'turnover'])

export const liveOnly = <T extends { deleted: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)

/** Live events grouped by point, each list sorted by seq. */
export function eventsByPoint(events: GameEvent[]): Map<string, GameEvent[]> {
  const m = new Map<string, GameEvent[]>()
  for (const e of liveOnly(events)) {
    const list = m.get(e.point_id) ?? []
    list.push(e)
    m.set(e.point_id, list)
  }
  for (const list of m.values()) list.sort((a, b) => a.seq - b.seq || a.created_at - b.created_at)
  return m
}

export interface PossessionState {
  /** Team with the disc (after the pull, the receiving team). */
  offense: TeamSide
  /** Our player holding the disc, if known. */
  holder: string | null
  /** Point finished (goal or Callahan). */
  over: boolean
  scorer: TeamSide | null
  /** Number of possessions each team has had so far this point. */
  possessions: { us: number; them: number }
}

/** Replay a point's events to find who has the disc. */
export function replayPoint(startOn: Side, events: GameEvent[]): PossessionState {
  const s: PossessionState = {
    offense: startOn === 'O' ? 'us' : 'them',
    holder: null,
    over: false,
    scorer: null,
    possessions: { us: 0, them: 0 },
  }
  s.possessions[s.offense] = 1
  const gain = (t: TeamSide) => {
    s.offense = t
    s.holder = null
    s.possessions[t]++
  }
  for (const e of events) {
    if (e.deleted || s.over || META_TYPES.has(e.type)) continue
    switch (e.type) {
      case 'pull':
        break
      case 'pickup':
        if (e.team === 'us') s.holder = e.actor_id
        break
      case 'catch':
        if (e.team === 'us') s.holder = e.receiver_id
        break
      case 'throwaway':
      case 'drop':
      case 'stall':
      case 'turnover':
        gain(other(e.team))
        break
      case 'D':
        gain(e.team)
        break
      case 'goal':
      case 'callahan':
        if (e.type === 'callahan') s.possessions[e.team]++ // a Callahan is a (one-touch) scoring possession
        s.over = true
        s.scorer = e.team
        s.holder = null
        break
    }
  }
  return s
}

export function outcomeOf(startOn: Side, scorer: TeamSide | null): PointOutcome {
  if (!scorer) return 'none'
  if (startOn === 'O') return scorer === 'us' ? 'hold' : 'broken'
  return scorer === 'us' ? 'break' : 'them_hold'
}

export interface PointInfo {
  point: Point
  events: GameEvent[]
  state: PossessionState
  outcome: PointOutcome
  before: { us: number; them: number }
  after: { us: number; them: number }
  half: 1 | 2
  /** Halftime falls right after this point. */
  halfAfter: boolean
}

export interface GameState {
  points: PointInfo[]
  score: { us: number; them: number }
  /** Current game-to target (lowered by soft/hard caps). */
  target: number
  halfTarget: number
  halfReached: boolean
  over: boolean
  winner: TeamSide | null
  capsCalled: { half: boolean; soft: boolean; hard: boolean }
  /** Point currently being played (not over), if any. */
  current: PointInfo | null
  next: { idx: number; ratio: Ratio; start_on: Side }
  timeouts: { 1: { us: number; them: number }; 2: { us: number; them: number } }
}

const capKind = (e: GameEvent) => (e.type === 'cap' ? (e.tags.find((t) => t === 'half' || t === 'soft' || t === 'hard') ?? null) : null)

/**
 * Derive everything about a game from its points and events (pure).
 * USAU caps: when a cap goes on during a point, finish that point, then the
 * target becomes (higher score + 1) — never above the original target. On a hard
 * cap the game ends after the current point, unless tied (then one more point).
 */
export function deriveGame(game: Game, allPoints: Point[], allEvents: GameEvent[]): GameState {
  const points = liveOnly(allPoints).filter((p) => p.game_id === game.id).sort((a, b) => a.idx - b.idx)
  const byPoint = eventsByPoint(allEvents.filter((e) => e.game_id === game.id))
  let target = game.game_to
  let halfTarget = Math.ceil(game.game_to / 2)
  let halfReached = false
  let over = false
  let hardPending = false
  let softApplied = false
  const capsCalled = { half: false, soft: false, hard: false }
  const score = { us: 0, them: 0 }
  const timeouts = { 1: { us: 0, them: 0 }, 2: { us: 0, them: 0 } }
  const infos: PointInfo[] = []

  for (const point of points) {
    const events = byPoint.get(point.id) ?? []
    const half: 1 | 2 = halfReached ? 2 : 1
    const state = replayPoint(point.start_on, events)
    const before = { ...score }
    if (state.scorer) score[state.scorer]++
    const after = { ...score }
    let halfCapNow = false
    let manualHalf = false
    for (const e of events) {
      if (e.type === 'timeout') timeouts[half][e.team]++
      if (e.type === 'half') manualHalf = true
      const k = capKind(e)
      if (k === 'half' && !halfReached) {
        capsCalled.half = true
        halfCapNow = true
      }
      if (k === 'soft') capsCalled.soft = true
      if (k === 'hard') {
        capsCalled.hard = true
        hardPending = true
      }
    }
    const hi = Math.max(after.us, after.them)
    let halfAfter = false
    if (state.over) {
      if (halfCapNow) halfTarget = Math.min(halfTarget, hi + 1)
      if (capsCalled.soft && !softApplied) {
        softApplied = true
        target = Math.min(target, hi + 1)
      }
      if (hardPending) {
        hardPending = false
        if (after.us !== after.them) over = true
        else target = Math.min(target, hi + 1)
      }
      if (hi >= target) over = true
      if (!halfReached && !over && (manualHalf || hi >= halfTarget)) {
        halfReached = true
        halfAfter = true
      }
    } else if (manualHalf && !halfReached) {
      // A 'half' marker on an unfinished point: treat as halftime after it.
      halfReached = true
      halfAfter = true
    }
    if (halfCapNow && !state.over) halfTarget = Math.min(halfTarget, hi + 1)
    infos.push({ point, events, state, outcome: outcomeOf(point.start_on, state.scorer), before, after, half, halfAfter })
  }

  const last = infos.at(-1)
  const current = last && !last.state.over && !over ? last : null
  const idx = (points.at(-1)?.idx ?? 0) + 1
  let start_on: Side = game.start_on
  if (last) {
    if (last.halfAfter) start_on = flipSide(game.start_on) // team that pulled first receives second half
    else if (last.state.scorer) start_on = last.state.scorer === 'us' ? 'D' : 'O'
    else start_on = last.point.start_on
  }
  return {
    points: infos,
    score,
    target,
    halfTarget,
    halfReached,
    over,
    winner: over ? (score.us > score.them ? 'us' : score.them > score.us ? 'them' : null) : null,
    capsCalled,
    current,
    next: { idx, ratio: ratioForPoint(game.ratio_first, idx), start_on },
    timeouts,
  }
}

/** Which caps have passed at a given game-clock minute. */
export function capsDue(caps: Game['caps'], minutes: number) {
  return {
    half: caps.half !== null && minutes >= caps.half,
    soft: caps.soft !== null && minutes >= caps.soft,
    hard: caps.hard !== null && minutes >= caps.hard,
  }
}
