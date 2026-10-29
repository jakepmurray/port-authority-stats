import { describe, expect, it } from 'vitest'
import { buildPush } from './payload'
import { parseSnapshot, snapshotGame } from './snapshot'
import { teamData } from './snapshotFixture'

describe('team-view snapshot in the push', () => {
  const d = teamData()

  it('Push everything sends every live game, all players and the team, full: true', () => {
    const s = buildPush(d, [], true).snapshot!
    expect(s.full).toBe(true)
    expect(s.games.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(s.delete).toEqual(['g3']) // soft-deleted game: dropped, not sent
    expect(s.base.teams.map((t) => t.id)).toEqual(['t1'])
    expect(s.base.players.find((p) => p.id === 'z')).toMatchObject({ deleted: true, name: 'Zed (left)' }) // kept for old games, flagged
    const g1 = s.games[0]
    expect(g1.events.some((e) => e.id === 'g1-gone')).toBe(false)
    expect(g1.points.every((p) => p.game_id === 'g1')).toBe(true)
    expect(JSON.stringify(s)).not.toMatch(/token/i)
  })

  it('an edit sends only its game (not full); a player change resends all games', () => {
    const one = buildPush(d, [{ table: 'events', row_id: 'g2-e1', payload: d.events.find((e) => e.id === 'g2-e1')! }]).snapshot!
    expect(one.full).toBe(false)
    expect(one.games.map((g) => g.id)).toEqual(['g2'])
    const p = buildPush(d, [{ table: 'players', row_id: 'a', payload: d.players[0] }]).snapshot!
    expect(p.games.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(buildPush(d, [{ table: 'teams', row_id: 't1', payload: {} }]).snapshot).toBeUndefined()
  })

  it('a deleted point takes its events with it', () => {
    const pts = d.points.map((p) => (p.id === 'g1-p1' ? { ...p, deleted: true } : p))
    const g = snapshotGame(d.games[0], pts, d.events)
    expect(g.points.map((p) => p.id)).toEqual(['g1-p2'])
    expect(g.events.every((e) => e.point_id === 'g1-p2')).toBe(true)
  })

  it('parseSnapshot validates rows, skips bad ones and drops anything deleted', () => {
    const r = parseSnapshot({
      ok: true, kind: 'snapshot', version: 3, updated_at: '2026-10-29T16:00:00.000Z', full_at: null,
      teams: d.teams, players: d.players, games: [...d.games, { id: 'bad' }], points: d.points, events: d.events,
    })
    expect(r.games.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(r.skipped).toBe(1)
    expect(r.events.some((e) => e.deleted || e.game_id === 'g3')).toBe(false)
    expect(r.updatedAt).toBe(Date.parse('2026-10-29T16:00:00.000Z'))
    expect(r.fullAt).toBeNull()
    expect(() => parseSnapshot({ ok: true, app: 'port-authority-stats', version: 2 })).toThrow()
  })
})
