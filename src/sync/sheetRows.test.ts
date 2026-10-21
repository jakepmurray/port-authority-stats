import { describe, expect, it } from 'vitest'
import { builder } from '../domain/fixtures'
import { PlayerSchema, type Call } from '../domain/schema'
import { buildPush, isEmptyPush } from './payload'
import { gameRow, gameSnapshot, playerRow, SHEET_TABS } from './sheetRows'

const roster = [['a', '1', 'W'], ['b', '2', 'W'], ['c', '3', 'W'], ['d', '4', 'W'], ['e', '07', 'M'], ['f', '17', 'M'], ['g', '23', 'M'], ['h', '8', 'M']].map(
  ([id, number, g]) => PlayerSchema.parse({ id, team_id: 't1', name: id.toUpperCase(), number, gender_match: g, created_at: 1, updated_at: 1 }),
)
const byId = new Map(roster.map((p) => [p.id, p]))
const line = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const call = (c: Partial<Call>): Call => ({ kind: 'foul', outcome: 'contested', turnover_team: null, charged_id: null, ...c })

function game() {
  const b = builder({ video: { kind: 'youtube', youtube_id: 'abc', url: null, offset_s: 0 } })
  b.point('O', line)
    .ev('pickup', 'us', { actor_id: 'a', video_time: 10.04 })
    .ev('injury', 'us', { actor_id: 'g', receiver_id: 'h' })
    .pass('a', 'h')
    .ev('call', 'them', { receiver_id: 'h', call: call({ kind: 'travel', outcome: 'turnover', turnover_team: 'us', charged_id: 'h' }), tags: ['wind'] })
    .ev('D', 'us', { defender_id: 'e' })
    .ev('pickup', 'us', { actor_id: 'e' })
    .ev('call', 'us', { actor_id: 'e', call: call({ kind: 'foul', outcome: 'contested' }) })
    .goal('e', 'a')
  b.point('D', line, { missed_on_film: true, manual_result: 'them' })
  return b
}

const keysOk = (tab: keyof typeof SHEET_TABS, row: Record<string, unknown>) => expect(Object.keys(row).sort()).toEqual([...SHEET_TABS[tab]].sort())

describe('sheet row mapping', () => {
  const b = game()
  const snap = gameSnapshot(b.game, b.points, b.events, byId)

  it('every row has exactly its tab’s columns', () => {
    keysOk('Players', playerRow(roster[0]))
    keysOk('Games', gameRow(b.game))
    for (const tab of ['Points', 'Events', 'Player Stats', 'Game Stats'] as const) for (const r of snap[tab]) keysOk(tab, r)
  })

  it('maps sub and call events', () => {
    const ev = snap.Events
    expect(ev.map((e) => e.type)).toEqual(['pickup', 'injury', 'catch', 'call', 'D', 'pickup', 'call', 'goal'])
    expect(ev[0]).toMatchObject({ video_time: 10, video_link: 'https://youtu.be/abc?t=10', point: 1 })
    expect(ev[1]).toMatchObject({ actor_number: '23', receiver_number: '8', receiver: 'H' })
    expect(ev[3]).toMatchObject({ team: 'them', call_kind: 'travel', call_outcome: 'turnover', call_turnover_by: 'us', call_charged_number: '8', receiver_number: '8', tags: 'wind' })
    expect(ev[6]).toMatchObject({ call_kind: 'foul', call_outcome: 'contested', call_turnover_by: '', actor_number: '07' })
  })

  it('points show the line after subs and missed-on-film results', () => {
    expect(snap.Points[0]).toMatchObject({ line: '1 2 3 4 07 17 23', line_end: '1 2 3 4 07 17 8', subs: 1, outcome: 'none' })
    expect(snap.Points[1]).toMatchObject({ missed_on_film: true, manual_result: 'them', line_end: '', subs: 0 })
  })

  it('player and game stats include sub and call columns', () => {
    const h = snap['Player Stats'].find((r) => r.player_id === 'h')!
    expect(h).toMatchObject({ id: 'g1:h', number: '8', partial_points: 1, call_turns: 1, turnovers: 1, calls_against: 1, calls_against_by: 'travel: 1 (turnover 1)' })
    const e = snap['Player Stats'].find((r) => r.player_id === 'e')!
    expect(e).toMatchObject({ calls_made: 1, calls_made_by: 'foul: 1 (contested 1)', ds: 1, assists: 1 })
    expect(snap['Game Stats'][0]).toMatchObject({
      id: 'g1', score_us: 1, score_them: 1, subs: 1, injury_subs: 1, points_missed_on_film: 1, calls_by_us: 1, calls_by_them: 1,
      calls_by_them_detail: 'travel: 1 (turnover 1)', turnover_tags: 'wind: 1 (call 1)', youtube: 'https://youtu.be/abc',
    })
  })
})

describe('buildPush', () => {
  const data = () => {
    const b = game()
    const g2 = builder({ id: 'g2', opponent: 'Other' })
    g2.point('O', line).goal('a', 'b')
    // fixture ids collide between builders; give the second game unique ids
    const points = g2.points.map((p) => ({ ...p, id: 'g2' + p.id, game_id: 'g2' }))
    const events = g2.events.map((e) => ({ ...e, id: 'g2' + e.id, game_id: 'g2', point_id: 'g2' + e.point_id }))
    return { players: roster, games: [b.game, g2.game], points: [...b.points, ...points], events: [...b.events, ...events] }
  }

  it('an event change pushes only its game, as a full snapshot', () => {
    const d = data()
    const body = buildPush(d, [{ table: 'events', row_id: 'e3', payload: d.events[2] }])
    expect(body.replace.game_ids).toEqual(['g1'])
    expect(body.upsert.Games!.rows.map((r) => r.id)).toEqual(['g1'])
    expect(body.upsert.Players).toBeUndefined()
    expect(body.replace.tabs.Events).toHaveLength(8)
    expect(body.replace.tabs['Game Stats']).toHaveLength(1)
  })

  it('soft-deleted rows drop out; deleted games and players are deleted', () => {
    const d = data()
    d.events = d.events.map((e) => (e.id === 'e2' ? { ...e, deleted: true } : e))
    d.games = d.games.map((g) => (g.id === 'g2' ? { ...g, deleted: true } : g))
    d.players = d.players.map((p) => (p.id === 'f' ? { ...p, deleted: true } : p))
    const body = buildPush(d, [
      { table: 'events', row_id: 'e2', payload: d.events[1] },
      { table: 'games', row_id: 'g2', payload: d.games[1] },
      { table: 'players', row_id: 'f', payload: d.players[5] },
    ])
    expect(body.upsert.Players).toEqual({ rows: [], delete: ['f'] })
    expect(body.upsert.Games!.delete).toEqual(['g2'])
    expect(body.replace.game_ids).toEqual(['g1', 'g2']) // a player change refreshes every game's stats
    expect(body.replace.tabs.Events.map((e) => e.type)).not.toContain('injury')
    expect(body.replace.tabs.Events.every((e) => e.game_id === 'g1')).toBe(true)
  })

  it('a point op finds its game; full pushes everything; team-only ops push nothing', () => {
    const d = data()
    expect(buildPush(d, [{ table: 'points', row_id: 'g2p1', payload: null }]).replace.game_ids).toEqual(['g2'])
    const full = buildPush(d, [], true)
    expect(full.upsert.Players!.rows).toHaveLength(8)
    expect(full.replace.game_ids).toEqual(['g1', 'g2'])
    expect(isEmptyPush(buildPush(d, [{ table: 'teams', row_id: 't1', payload: {} }]))).toBe(true)
  })
})
