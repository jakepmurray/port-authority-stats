import { deriveGame, META_TYPES, type GameState } from './game'
import type { Game, GameEvent, Player, Point } from './schema'
import { userTags } from './tags'

/**
 * Stats are pure functions over the event log (PLAN.md §6). Definitions:
 * - Completion: a catch or goal thrown by the player. Attempts = completions +
 *   throwaways + drops on their throws (+ their thrown Callahans).
 * - Hockey assist: the pass right before the assist, within the same possession.
 * - Turnovers: throwaways + drops (charged to the receiver) + stalls + other turns.
 * - Plus/minus: goals + assists + Ds − turnovers.
 * - Yards: (y_end − y) for completions when coordinates exist, toward the attacking end zone.
 * - Tags add context only: a throwaway tagged "receiver error" is still the thrower's
 *   throwaway. turnover_tags counts charged turnovers by tag, then by type.
 * - Points missed on film count toward the score and team hold/break numbers, but not
 *   toward per-player points or any event-based rate (they are listed as points_missed).
 */
/** tag → turnover type → count */
export type TagBreakdown = Record<string, Record<string, number>>
export interface PlayerStats {
  player_id: string
  points: number
  o_points: number
  d_points: number
  goals: number
  assists: number
  hockey_assists: number
  catches: number
  completions: number
  throw_attempts: number
  comp_pct: number | null
  throwaways: number
  drops: number
  stalls: number
  other_turns: number
  turnovers: number
  ds: number
  callahans: number
  pulls: number
  plus_minus: number
  throw_yards: number
  recv_yards: number
  /** On the line for points missed on film (not counted in `points`). */
  points_missed: number
  turnover_tags: TagBreakdown
}

export const emptyPlayerStats = (player_id: string): PlayerStats => ({
  player_id,
  points: 0,
  o_points: 0,
  d_points: 0,
  goals: 0,
  assists: 0,
  hockey_assists: 0,
  catches: 0,
  completions: 0,
  throw_attempts: 0,
  comp_pct: null,
  throwaways: 0,
  drops: 0,
  stalls: 0,
  other_turns: 0,
  turnovers: 0,
  ds: 0,
  callahans: 0,
  pulls: 0,
  plus_minus: 0,
  throw_yards: 0,
  recv_yards: 0,
  points_missed: 0,
  turnover_tags: {},
})

export interface TeamStats {
  points: number
  o_points: number
  d_points: number
  holds: number
  breaks: number
  broken: number
  them_holds: number
  /** Holds / finished O points. */
  o_conversion: number | null
  /** Breaks / finished D points. */
  d_break_pct: number | null
  goals: number
  completions: number
  turnovers: number
  turnovers_per_point: number | null
  ds: number
  callahans: number
  possessions: number
  /** Goals / possessions. */
  scoring_efficiency: number | null
  pulls: number
  pulls_in: number
  pulls_ob: number
  pulls_brick: number
  /** Points with a hand-entered result and no film (included in `points`). */
  points_missed: number
  /** Our turnovers by tag. */
  turnover_tags: TagBreakdown
}

/** Opponent tracked at team totals only. */
export interface OpponentStats {
  goals: number
  turnovers: number
  ds: number
  callahans: number
  holds: number
  breaks: number
  possessions: number
  /** Their turnovers (incl. our Ds) by tag. */
  turnover_tags: TagBreakdown
}

export interface GameStats {
  state: GameState
  players: Map<string, PlayerStats>
  team: TeamStats
  opponent: OpponentStats
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
/** Add an event's user tags to a breakdown under the given turnover type. */
export function addTags(b: TagBreakdown, e: GameEvent, type: string = e.type, n = 1) {
  for (const t of userTags(e.tags)) {
    const row = (b[t] ??= {})
    row[type] = (row[type] ?? 0) + n
  }
}

/** Total per tag (all turnover types). */
export const tagTotals = (b: TagBreakdown): [string, number][] =>
  Object.entries(b)
    .map(([t, row]) => [t, Object.values(row).reduce((a, c) => a + c, 0)] as [string, number])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

export const formatTagBreakdown = (b: TagBreakdown) =>
  tagTotals(b)
    .map(([t, n]) => `${t}: ${n} (${Object.entries(b[t]).map(([k, v]) => `${k} ${v}`).join(', ')})`)
    .join('; ')

export function mergeTags(into: TagBreakdown, from: TagBreakdown) {
  for (const [t, row] of Object.entries(from)) for (const [k, v] of Object.entries(row)) ((into[t] ??= {})[k] = (into[t][k] ?? 0) + v)
  return into
}

const dy = (e: GameEvent) => (e.y !== null && e.y_end !== null ? e.y_end - e.y : 0)

export function computeGameStats(game: Game, points: Point[], events: GameEvent[]): GameStats {
  const state = deriveGame(game, points, events)
  const players = new Map<string, PlayerStats>()
  const P = (id: string | null) => {
    if (!id) return null
    let s = players.get(id)
    if (!s) players.set(id, (s = emptyPlayerStats(id)))
    return s
  }
  const team: TeamStats = {
    points: 0, o_points: 0, d_points: 0, holds: 0, breaks: 0, broken: 0, them_holds: 0,
    o_conversion: null, d_break_pct: null, goals: 0, completions: 0, turnovers: 0,
    turnovers_per_point: null, ds: 0, callahans: 0, possessions: 0, scoring_efficiency: null,
    pulls: 0, pulls_in: 0, pulls_ob: 0, pulls_brick: 0, points_missed: 0, turnover_tags: {},
  }
  const opp: OpponentStats = { goals: 0, turnovers: 0, ds: 0, callahans: 0, holds: 0, breaks: 0, possessions: 0, turnover_tags: {} }
  /** Charge one of our turnovers: team breakdown always, player breakdown when known. */
  const ourTurn = (e: GameEvent, s: PlayerStats | null, type: string = e.type) => {
    team.turnovers++
    addTags(team.turnover_tags, e, type)
    if (s) addTags(s.turnover_tags, e, type)
  }
  const theirTurn = (e: GameEvent, type: string = e.type) => {
    opp.turnovers++
    addTags(opp.turnover_tags, e, type)
  }
  let finishedO = 0
  let finishedD = 0

  for (const info of state.points) {
    const { point, events: evs, outcome } = info
    const missed = point.missed_on_film === true
    const counted = evs.length > 0 || info.state.over
    if (!counted) continue
    team.points++
    if (missed) team.points_missed++
    if (point.start_on === 'O') team.o_points++
    else team.d_points++
    for (const id of new Set(point.line)) {
      const s = P(id)!
      if (missed) {
        s.points_missed++
        continue
      }
      s.points++
      if (point.start_on === 'O') s.o_points++
      else s.d_points++
    }
    if (info.state.over) {
      if (point.start_on === 'O') finishedO++
      else finishedD++
    }
    if (outcome === 'hold') team.holds++
    if (outcome === 'break') team.breaks++
    if (outcome === 'broken') {
      team.broken++
      opp.breaks++
    }
    if (outcome === 'them_hold') {
      team.them_holds++
      opp.holds++
    }
    team.possessions += info.state.possessions.us
    opp.possessions += info.state.possessions.them

    if (missed) continue // no event stats from points missed on film
    const play = evs.filter((e) => !META_TYPES.has(e.type))
    play.forEach((e, i) => {
      const us = e.team === 'us'
      switch (e.type) {
        case 'pull':
          if (us) {
            team.pulls++
            if (e.tags.includes('ob')) team.pulls_ob++
            else if (e.tags.includes('brick')) team.pulls_brick++
            else team.pulls_in++
            const s = P(e.actor_id ?? point.pulled_by)
            if (s) s.pulls++
          }
          break
        case 'catch':
          if (us) {
            team.completions++
            const t = P(e.actor_id)
            const r = P(e.receiver_id)
            if (t) {
              t.completions++
              t.throw_attempts++
              t.throw_yards += dy(e)
            }
            if (r) {
              r.catches++
              r.recv_yards += dy(e)
            }
          }
          break
        case 'goal':
          if (us) {
            team.goals++
            team.completions++
            const t = P(e.actor_id)
            const r = P(e.receiver_id)
            if (t) {
              t.assists++
              t.completions++
              t.throw_attempts++
              t.throw_yards += dy(e)
            }
            if (r) {
              r.goals++
              r.catches++
              r.recv_yards += dy(e)
            }
            // Hockey assist: the previous play is a catch by the assister.
            const prev = play[i - 1]
            if (prev && prev.type === 'catch' && prev.team === 'us' && e.actor_id && prev.receiver_id === e.actor_id) {
              const h = P(prev.actor_id)
              if (h && prev.actor_id !== e.receiver_id) h.hockey_assists++
            }
          } else opp.goals++
          break
        case 'throwaway':
          if (us) {
            const t = P(e.actor_id)
            ourTurn(e, t)
            if (t) {
              t.throwaways++
              t.throw_attempts++
            }
          } else theirTurn(e)
          break
        case 'drop':
          if (us) {
            const t = P(e.actor_id)
            const r = P(e.receiver_id)
            ourTurn(e, r)
            if (t) t.throw_attempts++
            if (r) r.drops++
          } else theirTurn(e)
          break
        case 'stall':
        case 'turnover':
          if (us) {
            const s = P(e.actor_id)
            ourTurn(e, s)
            if (s && e.type === 'stall') s.stalls++
            else if (s) s.other_turns++
          } else theirTurn(e)
          break
        case 'D':
          if (us) {
            team.ds++
            theirTurn(e)
            const s = P(e.defender_id)
            if (s) s.ds++
          } else {
            opp.ds++
            ourTurn(e, null)
          }
          break
        case 'callahan':
          if (us) {
            team.goals++
            team.ds++
            team.callahans++
            theirTurn(e)
            const s = P(e.defender_id)
            if (s) {
              s.goals++
              s.ds++
              s.callahans++
            }
          } else {
            opp.goals++
            opp.callahans++
            const t = P(e.actor_id)
            ourTurn(e, t)
            if (t) {
              t.throwaways++
              t.throw_attempts++
            }
          }
          break
        default:
          break
      }
    })
  }

  for (const s of players.values()) {
    s.turnovers = s.throwaways + s.drops + s.stalls + s.other_turns
    s.comp_pct = ratio(s.completions, s.throw_attempts)
    s.plus_minus = s.goals + s.assists + s.ds - s.turnovers
  }
  team.o_conversion = ratio(team.holds, finishedO)
  team.d_break_pct = ratio(team.breaks, finishedD)
  team.turnovers_per_point = ratio(team.turnovers, team.points - team.points_missed)
  team.scoring_efficiency = ratio(team.goals, team.possessions)
  return { state, players, team, opponent: opp }
}

/** Sum player stats across games (e.g. a tournament or season). */
export function sumPlayerStats(list: PlayerStats[][]): Map<string, PlayerStats> {
  const out = new Map<string, PlayerStats>()
  for (const game of list) {
    for (const s of game) {
      const acc = out.get(s.player_id) ?? emptyPlayerStats(s.player_id)
      for (const k of Object.keys(acc) as (keyof PlayerStats)[]) {
        if (k === 'player_id' || k === 'comp_pct') continue
        if (k === 'turnover_tags') {
          mergeTags(acc.turnover_tags, s.turnover_tags)
          continue
        }
        ;(acc[k] as number) += s[k] as number
      }
      out.set(s.player_id, acc)
    }
  }
  for (const s of out.values()) s.comp_pct = ratio(s.completions, s.throw_attempts)
  return out
}

export type { Player }
