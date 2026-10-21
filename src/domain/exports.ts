import { toCsv } from './csv'
import { liveOnly } from './game'
import type { Game, GameEvent, Player, Point } from './schema'
import { computeGameStats, type PlayerStats } from './stats'

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
  const { player_id, comp_pct, ...rest } = s
  return { player_id, number: p?.number ?? '', name: p?.name ?? '', gender_match: p?.gender_match ?? '', ...rest, comp_pct: r3(comp_pct) }
}

export function gamesCsv(d: AllData) {
  const rows = liveOnly(d.games).map((g) => {
    const s = computeGameStats(g, d.points, d.events)
    return {
      game_id: g.id, date: g.date, tournament: g.tournament, opponent: g.opponent,
      score_us: s.state.score.us, score_them: s.state.score.them,
      result: s.state.over ? (s.state.winner === 'us' ? 'W' : s.state.winner === 'them' ? 'L' : 'T') : 'in progress',
      holds: s.team.holds, breaks: s.team.breaks, o_conversion: r3(s.team.o_conversion), d_break_pct: r3(s.team.d_break_pct),
      turnovers: s.team.turnovers, opp_turnovers: s.opponent.turnovers, youtube: g.video.youtube_id ? `https://youtu.be/${g.video.youtube_id}` : '',
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
        x: e.x, y: e.y, x_end: e.x_end, y_end: e.y_end, tags: e.tags, note: e.note, source: e.source,
        edited: e.edited_at ? 'yes' : '',
      }
    })
  return toCsv(rows)
}
