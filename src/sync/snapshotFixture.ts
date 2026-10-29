/** Test data for the team-view snapshot: two games (ids unique across games), a roster, a team. */
import { builder } from '../domain/fixtures'
import { opponentId } from '../domain/opponents'
import { OpponentSchema, PlayerSchema, TeamSchema, type GameEvent, type Point } from '../domain/schema'
import type { SyncData } from './payload'

export function teamData(): Required<SyncData> {
  const players = ['a', 'b', 'c'].map((id, i) =>
    PlayerSchema.parse({ id, team_id: 't1', name: id.toUpperCase(), number: String(i + 1), gender_match: i ? 'M' : 'W', created_at: 1, updated_at: 1 }),
  )
  players.push(PlayerSchema.parse({ id: 'z', team_id: 't1', name: 'Zed (left)', number: '99', gender_match: 'M', deleted: true, created_at: 1, updated_at: 1 }))
  const g1 = builder({ id: 'g1', opponent: 'Alpha', tournament: 'T1', date: '2026-06-01', game_to: 2 })
  g1.point('O', ['a', 'b', 'c']).pass('a', 'b').ev('throwaway', 'us', { actor_id: 'b', tags: ['wind'] }).ev('D', 'us', { defender_id: 'z' }).goal('a', 'c')
  g1.point('D', ['a', 'b', 'c']).ev('pull', 'us', { actor_id: 'a' }).goal('c', 'a')
  const g2 = builder({ id: 'g2', opponent: 'Bravo', date: '2026-06-02' })
  g2.point('O', ['a', 'b']).pass('a', 'b').goal('b', 'a')
  const uniq = (gid: string, pts: Point[], evs: GameEvent[]) => ({
    points: pts.map((p) => ({ ...p, id: `${gid}-${p.id}` })),
    events: evs.map((e) => ({ ...e, id: `${gid}-${e.id}`, point_id: `${gid}-${e.point_id}` })),
  })
  const a = uniq('g1', g1.points, g1.events)
  const b = uniq('g2', g2.points, g2.events)
  // Soft-deleted rows the team view must never show.
  a.events.push({ ...a.events[0], id: 'g1-gone', deleted: true, type: 'drop' })
  const gone = builder({ id: 'g3', opponent: 'Deleted Opp', deleted: true })
  gone.point('O', ['a']).goal('a', 'b')
  const c = uniq('g3', gone.points, gone.events)
  return {
    teams: [TeamSchema.parse({ id: 't1', name: 'Port Authority', custom_tags: ['wind'], created_at: 1, updated_at: 1 })],
    players,
    opponents: [OpponentSchema.parse({ id: opponentId('Alpha', '2026'), team_id: 't1', name: 'Alpha', season: '2026', rank: 12, created_at: 1, updated_at: 1 })],
    games: [g1.game, g2.game, gone.game],
    points: [...a.points, ...b.points, ...c.points],
    events: [...a.events, ...b.events, ...c.events],
  }
}
