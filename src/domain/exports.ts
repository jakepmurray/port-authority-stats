import { toCsv } from './csv'
import { liveOnly } from './game'
import type { Game, GameEvent, Player, Point } from './schema'
import { computeGameStats, formatTagBreakdown, type PlayerStats } from './stats'

export interface AllData {
  players: Player[]
  games: Game[]
  points: Point[]
  events: GameEvent[]
}

const num = (byId: Map<string, Player>, id: string | null) => (id ? (byId.get(id)?.number ?? '') : '')
const nm = (byId: Map<string, Player>, id: string | null) => (id ? (byId.get(id)?.name ?? '') : '')
const r3 = (v: number | null) => (v === null ? '' : Math.round(v * 1000) / 1000)

export const ytLink = (g: Game, t: number | null) =>
  g.video.youtube_id && t !== null ? `https://youtu.be/${g.video.youtube_id}?t=${Math.floor(t)}` : ''

export function playerStatRow(p: Player | undefined, s: PlayerStats) {
  const { player_id, comp_pct, turnover_tags, calls_made_by, calls_against_by, ...rest } = s
  return {
    player_id, number: p?.number ?? '', name: p?.name ?? '', gender_match: p?.gender_match ?? '', ...rest,
    comp_pct: r3(comp_pct), turnover_tags: formatTagBreakdown(turnover_tags),
    calls_made_by: formatTagBreakdown(calls_made_by), calls_against_by: formatTagBreakdown(calls_against_by),
  }
}

export function gamesCsv(d: AllData) {
  const rows = liveOnly(d.games).map((g) => {
    const s = computeGameStats(g, d.points, d.events)
    return {
      game_id: g.id, date: g.date, tournament: g.tournament, opponent: g.opponent,
      score_us: s.state.score.us, score_them: s.state.score.them,
      result: s.state.result ?? 'in progress', ended_by_hand: s.state.ended ? 'yes' : '',
      holds: s.team.holds, breaks: s.team.breaks, o_conversion: r3(s.team.o_conversion), d_break_pct: r3(s.team.d_break_pct),
      turnovers: s.team.turnovers, opp_turnovers: s.opponent.turnovers, points_missed_on_film: s.team.points_missed, subs: s.team.subs, injury_subs: s.team.injury_subs,
      turnover_tags: formatTagBreakdown(s.team.turnover_tags),
      calls_by_us: s.team.calls_made, calls_by_them: s.team.calls_against,
      calls_by_us_detail: formatTagBreakdown(s.team.calls_made_by), calls_by_them_detail: formatTagBreakdown(s.team.calls_against_by), opp_turnover_tags: formatTagBreakdown(s.opponent.turnover_tags), youtube: g.video.youtube_id ? `https://youtu.be/${g.video.youtube_id}` : '',
    }
  })
  return toCsv(rows)
}

export function playerStatsCsv(d: AllData) {
  const byId = new Map(d.players.map((p) => [p.id, p]))
  const rows = liveOnly(d.games).flatMap((g) => {
    const s = computeGameStats(g, d.points, d.events)
    return [...s.players.values()].map((ps) => ({ game_id: g.id, date: g.date, opponent: g.opponent, tournament: g.tournament, ...playerStatRow(byId.get(ps.player_id), ps) }))
  })
  return toCsv(rows)
}

export function pointsCsv(d: AllData) {
  const byId = new Map(d.players.map((p) => [p.id, p]))
  const games = new Map(d.games.map((g) => [g.id, g]))
  const rows = liveOnly(d.points)
    .filter((p) => games.get(p.game_id) && !games.get(p.game_id)!.deleted)
    .sort((a, b) => a.game_id.localeCompare(b.game_id) || a.idx - b.idx)
    .map((p) => ({
      point_id: p.id, game_id: p.game_id, opponent: games.get(p.game_id)!.opponent, idx: p.idx,
      score_us: p.score_us, score_them: p.score_them, start_on: p.start_on, ratio: p.ratio, outcome: p.outcome,
      line: p.line.map((id) => num(byId, id)).join(' '), pulled_by: num(byId, p.pulled_by),
      missed_on_film: p.missed_on_film ? 'yes' : '', manual_result: p.missed_on_film ? (p.manual_result ?? '') : '',
      video_start: p.video_start, video_end: p.video_end, edited: p.edited_at ? 'yes' : '',
    }))
  return toCsv(rows)
}

export function eventsCsv(d: AllData) {
  const byId = new Map(d.players.map((p) => [p.id, p]))
  const games = new Map(d.games.map((g) => [g.id, g]))
  const points = new Map(d.points.map((p) => [p.id, p]))
  const rows = liveOnly(d.events)
    .filter((e) => points.get(e.point_id) && !points.get(e.point_id)!.deleted && games.get(e.game_id) && !games.get(e.game_id)!.deleted)
    .sort((a, b) => a.game_id.localeCompare(b.game_id) || points.get(a.point_id)!.idx - points.get(b.point_id)!.idx || a.seq - b.seq)
    .map((e) => {
      const g = games.get(e.game_id)!
      return {
        event_id: e.id, game_id: e.game_id, opponent: g.opponent, point: points.get(e.point_id)!.idx, seq: e.seq,
        type: e.type, team: e.team,
        actor_number: num(byId, e.actor_id), actor: nm(byId, e.actor_id),
        receiver_number: num(byId, e.receiver_id), receiver: nm(byId, e.receiver_id),
        defender_number: num(byId, e.defender_id), defender: nm(byId, e.defender_id),
        video_time: e.video_time === null ? '' : Math.round(e.video_time * 10) / 10, video_link: ytLink(g, e.video_time),
        call_kind: e.call?.kind ?? '', call_outcome: e.call?.outcome ?? '',
        call_turnover_by: e.call?.turnover_team ?? '', call_charged_number: num(byId, e.call?.charged_id ?? null),
        x: e.x, y: e.y, x_end: e.x_end, y_end: e.y_end, tags: e.tags.join('; '), note: e.note, source: e.source,
        edited: e.edited_at ? 'yes' : '',
      }
    })
  return toCsv(rows)
}
