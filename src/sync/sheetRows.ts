import { formatTagBreakdown, computeGameStats, type GameStats, type PlayerStats } from '../domain/stats'
import { liveOnly } from '../domain/game'
import { lineTimeline } from '../domain/subs'
import type { Game, GameEvent, Player, Point } from '../domain/schema'
import { ytLink } from '../domain/exports'

/**
 * Sheet tabs and their headers. Must match TABS in apps-script/Code.gs
 * (a test checks this). Rows are sent as objects keyed by header name.
 */
export const SHEET_TABS = {
  Players: ['id', 'number', 'name', 'gender_match', 'role', 'active', 'deleted', 'updated_at', 'edited_by'],
  Games: ['id', 'date', 'tournament', 'opponent', 'game_to', 'ratio_first', 'start_on', 'timeouts_per_half',
    'cap_half', 'cap_soft', 'cap_hard', 'youtube', 'notes', 'updated_at', 'game_clock', 'ended_at', 'edited_by'],
  Points: ['id', 'game_id', 'opponent', 'idx', 'score_us', 'score_them', 'start_on', 'ratio', 'outcome', 'line',
    'line_end', 'subs', 'pulled_by', 'missed_on_film', 'manual_result', 'video_start', 'video_end', 'edited', 'updated_at', 'edited_by'],
  Events: ['id', 'game_id', 'opponent', 'point', 'seq', 'type', 'team', 'actor_number', 'actor', 'receiver_number',
    'receiver', 'defender_number', 'defender', 'call_kind', 'call_outcome', 'call_turnover_by', 'call_charged_number',
    'tags', 'note', 'video_time', 'video_link', 'x', 'y', 'x_end', 'y_end', 'source', 'edited', 'updated_at', 'edited_by'],
  'Player Stats': ['id', 'game_id', 'date', 'tournament', 'opponent', 'player_id', 'number', 'name', 'gender_match',
    'points', 'o_points', 'd_points', 'partial_points', 'points_missed', 'goals', 'assists', 'hockey_assists', 'catches',
    'completions', 'throw_attempts', 'comp_pct', 'throwaways', 'drops', 'stalls', 'other_turns', 'call_turns', 'turnovers',
    'ds', 'callahans', 'pulls', 'plus_minus', 'throw_yards', 'recv_yards', 'calls_made', 'calls_against',
    'calls_made_by', 'calls_against_by', 'turnover_tags'],
  'Game Stats': ['id', 'game_id', 'date', 'tournament', 'opponent', 'score_us', 'score_them', 'result', 'points',
    'holds', 'breaks', 'broken', 'them_holds', 'o_conversion', 'd_break_pct', 'turnovers', 'turnovers_per_point', 'ds',
    'possessions', 'scoring_efficiency', 'opp_turnovers', 'opp_ds', 'pulls', 'subs', 'injury_subs', 'points_missed_on_film',
    'calls_by_us', 'calls_by_them', 'calls_by_us_detail', 'calls_by_them_detail', 'turnover_tags', 'opp_turnover_tags',
    'youtube'],
  Meta: ['key', 'value'],
} as const

export type TabName = keyof typeof SHEET_TABS
export type Cell = string | number | boolean | null
export type SheetRow = Record<string, Cell>

/** Tabs teammates see through File > Share > Publish to web. The rest stay unpublished. */
export const PUBLISHED_TABS: TabName[] = ['Player Stats', 'Game Stats', 'Events']

const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000)
const iso = (t: number) => new Date(t).toISOString()
const num = (byId: Map<string, Player>, id: string | null) => (id ? (byId.get(id)?.number ?? '') : '')
const nm = (byId: Map<string, Player>, id: string | null) => (id ? (byId.get(id)?.name ?? '') : '')
const youtube = (g: Game) => (g.video.youtube_id ? `https://youtu.be/${g.video.youtube_id}` : '')

export function playerRow(p: Player): SheetRow {
  return { id: p.id, number: p.number, name: p.name, gender_match: p.gender_match, role: p.role, active: p.active, deleted: p.deleted, updated_at: iso(p.updated_at), edited_by: '' }
}

export function gameRow(g: Game): SheetRow {
  return {
    id: g.id, date: g.date, tournament: g.tournament, opponent: g.opponent, game_to: g.game_to, ratio_first: g.ratio_first,
    start_on: g.start_on, timeouts_per_half: g.timeouts_per_half, cap_half: g.caps.half, cap_soft: g.caps.soft, cap_hard: g.caps.hard,
    youtube: youtube(g), notes: g.notes, updated_at: iso(g.updated_at), edited_by: '',
    game_clock: g.use_clock === true, ended_at: g.ended_at ? iso(g.ended_at) : '',
  }
}

export function pointRow(g: Game, p: Point, events: GameEvent[], byId: Map<string, Player>): SheetRow {
  const tl = lineTimeline(p.line, events.filter((e) => e.point_id === p.id))
  const nums = (ids: string[]) => ids.map((id) => num(byId, id)).join(' ')
  return {
    id: p.id, game_id: p.game_id, opponent: g.opponent, idx: p.idx, score_us: p.score_us, score_them: p.score_them,
    start_on: p.start_on, ratio: p.ratio, outcome: p.outcome, line: nums(p.line), line_end: tl.subs ? nums(tl.final) : '',
    subs: tl.subs, pulled_by: num(byId, p.pulled_by), missed_on_film: !!p.missed_on_film,
    manual_result: p.missed_on_film ? (p.manual_result ?? '') : '', video_start: p.video_start, video_end: p.video_end,
    edited: !!p.edited_at, updated_at: iso(p.updated_at), edited_by: '',
  }
}

export function eventRow(g: Game, pointIdx: number, e: GameEvent, byId: Map<string, Player>): SheetRow {
  return {
    id: e.id, game_id: e.game_id, opponent: g.opponent, point: pointIdx, seq: e.seq, type: e.type, team: e.team,
    actor_number: num(byId, e.actor_id), actor: nm(byId, e.actor_id),
    receiver_number: num(byId, e.receiver_id), receiver: nm(byId, e.receiver_id),
    defender_number: num(byId, e.defender_id), defender: nm(byId, e.defender_id),
    call_kind: e.call?.kind ?? '', call_outcome: e.call?.outcome ?? '', call_turnover_by: e.call?.turnover_team ?? '',
    call_charged_number: num(byId, e.call?.charged_id ?? null),
    tags: e.tags.join('; '), note: e.note,
    video_time: e.video_time === null ? null : Math.round(e.video_time * 10) / 10, video_link: ytLink(g, e.video_time),
    x: e.x, y: e.y, x_end: e.x_end, y_end: e.y_end, source: e.source, edited: !!e.edited_at, updated_at: iso(e.updated_at), edited_by: '',
  }
}

export function playerStatsRow(g: Game, s: PlayerStats, p: Player | undefined): SheetRow {
  return {
    id: `${g.id}:${s.player_id}`, game_id: g.id, date: g.date, tournament: g.tournament, opponent: g.opponent,
    player_id: s.player_id, number: p?.number ?? '', name: p?.name ?? '', gender_match: p?.gender_match ?? '',
    points: s.points, o_points: s.o_points, d_points: s.d_points, partial_points: s.partial_points, points_missed: s.points_missed,
    goals: s.goals, assists: s.assists, hockey_assists: s.hockey_assists, catches: s.catches, completions: s.completions,
    throw_attempts: s.throw_attempts, comp_pct: r3(s.comp_pct), throwaways: s.throwaways, drops: s.drops, stalls: s.stalls,
    other_turns: s.other_turns, call_turns: s.call_turns, turnovers: s.turnovers, ds: s.ds, callahans: s.callahans,
    pulls: s.pulls, plus_minus: s.plus_minus, throw_yards: s.throw_yards, recv_yards: s.recv_yards,
    calls_made: s.calls_made, calls_against: s.calls_against,
    calls_made_by: formatTagBreakdown(s.calls_made_by), calls_against_by: formatTagBreakdown(s.calls_against_by),
    turnover_tags: formatTagBreakdown(s.turnover_tags),
  }
}

export function gameStatsRow(g: Game, s: GameStats): SheetRow {
  const st = s.state
  return {
    id: g.id, game_id: g.id, date: g.date, tournament: g.tournament, opponent: g.opponent,
    score_us: st.score.us, score_them: st.score.them,
    result: st.result ?? 'in progress',
    points: s.team.points, holds: s.team.holds, breaks: s.team.breaks, broken: s.team.broken, them_holds: s.team.them_holds,
    o_conversion: r3(s.team.o_conversion), d_break_pct: r3(s.team.d_break_pct), turnovers: s.team.turnovers,
    turnovers_per_point: r3(s.team.turnovers_per_point), ds: s.team.ds, possessions: s.team.possessions,
    scoring_efficiency: r3(s.team.scoring_efficiency), opp_turnovers: s.opponent.turnovers, opp_ds: s.opponent.ds,
    pulls: s.team.pulls, subs: s.team.subs, injury_subs: s.team.injury_subs, points_missed_on_film: s.team.points_missed,
    calls_by_us: s.team.calls_made, calls_by_them: s.team.calls_against,
    calls_by_us_detail: formatTagBreakdown(s.team.calls_made_by), calls_by_them_detail: formatTagBreakdown(s.team.calls_against_by),
    turnover_tags: formatTagBreakdown(s.team.turnover_tags), opp_turnover_tags: formatTagBreakdown(s.opponent.turnover_tags),
    youtube: youtube(g),
  }
}

export interface GameSnapshot {
  Points: SheetRow[]
  Events: SheetRow[]
  'Player Stats': SheetRow[]
  'Game Stats': SheetRow[]
}

/** Everything the Sheet holds for one game (live rows only; deleted rows simply drop out). */
export function gameSnapshot(g: Game, allPoints: Point[], allEvents: GameEvent[], byId: Map<string, Player>): GameSnapshot {
  const points = liveOnly(allPoints).filter((p) => p.game_id === g.id).sort((a, b) => a.idx - b.idx)
  const live = new Set(points.map((p) => p.id))
  const idx = new Map(points.map((p) => [p.id, p.idx]))
  const events = liveOnly(allEvents)
    .filter((e) => e.game_id === g.id && live.has(e.point_id))
    .sort((a, b) => idx.get(a.point_id)! - idx.get(b.point_id)! || a.seq - b.seq)
  const stats = computeGameStats(g, allPoints, allEvents)
  return {
    Points: points.map((p) => pointRow(g, p, events, byId)),
    Events: events.map((e) => eventRow(g, idx.get(e.point_id)!, e, byId)),
    'Player Stats': [...stats.players.values()]
      .sort((a, b) => Number(byId.get(a.player_id)?.number ?? 999) - Number(byId.get(b.player_id)?.number ?? 999))
      .map((s) => playerStatsRow(g, s, byId.get(s.player_id))),
    'Game Stats': [gameStatsRow(g, stats)],
  }
}
