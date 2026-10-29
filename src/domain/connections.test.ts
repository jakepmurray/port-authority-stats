import { describe, expect, it } from 'vitest'
import { connRows, genderSplit, passMatrix, pairEvents, topConnections } from './connections'
import { buildGameRows, DEFAULT_FILTER, drillEvents, type DashFilter } from './dashboard'
import { builder } from './fixtures'

function data() {
  const g1 = builder({ id: 'g1', opponent: 'Alpha', date: '2026-06-01', game_to: 3 })
  g1.point('O', ['a', 'b', 'c']).pass('a', 'b').goal('b', 'c')
  g1.point('D', ['a', 'b', 'd']).ev('pull', 'us', { actor_id: 'a' }).pass('a', 'b').ev('throwaway', 'us', { actor_id: 'b', receiver_id: 'd', tags: ['wind'] }).ev('D', 'us', { defender_id: 'd' }).goal('a', 'd')
  g1.point('O', ['a', 'b', 'c']).ev('throwaway', 'us', { actor_id: 'b' }).themGoal() // no intended receiver: not a pair
  const g2 = builder({ id: 'g2', opponent: 'Beta', date: '2026-06-08', game_to: 1 })
  g2.point('O', ['a', 'd']).ev('drop', 'us', { actor_id: 'a', receiver_id: 'd' }).ev('goal', 'them')
  const uniq = (gid: string, b: ReturnType<typeof builder>) => ({
    points: b.points.map((p) => ({ ...p, id: `${gid}-${p.id}` })),
    events: b.events.map((e) => ({ ...e, id: `${gid}-${e.id}`, point_id: `${gid}-${e.point_id}` })),
  })
  const a = uniq('g1', g1)
  const b = uniq('g2', g2)
  return { games: [g1.game, g2.game], points: [...a.points, ...b.points], events: [...a.events, ...b.events] }
}
const F = (f: Partial<DashFilter> = {}) => ({ ...DEFAULT_FILTER, ...f })
const cells = (m: ReturnType<typeof passMatrix>) => m.pairs.map((p) => `${p.thrower}>${p.receiver} ${p.completions}/${p.attempts}`).sort()

describe('who throws to whom', () => {
  it('counts completions and turnovers per pair, sorted by volume', () => {
    const m = passMatrix(buildGameRows(data(), F()))
    expect(cells(m)).toEqual(['a>b 2/2', 'a>d 1/2', 'b>c 1/1', 'b>d 0/1'])
    expect(m.throwers).toEqual([{ id: 'a', n: 4 }, { id: 'b', n: 2 }])
    expect(m.receivers[0]).toEqual({ id: 'd', n: 3 })
    expect(m.max).toEqual({ completions: 2, turnovers: 1 })
    expect(m.pairs.find((p) => p.thrower === 'a' && p.receiver === 'd')!.pct).toBe(0.5)
  })

  it('applies the dashboard filters (O/D, tags) and its own (opponent, line)', () => {
    const rows = buildGameRows(data(), F())
    expect(cells(passMatrix(buildGameRows(data(), F({ side: 'D' }))))).toEqual(['a>b 1/1', 'a>d 1/1', 'b>d 0/1'])
    expect(cells(passMatrix(buildGameRows(data(), F({ tags: ['wind'], tagScope: 'without' }))))).toEqual(['a>b 2/2', 'a>d 1/2', 'b>c 1/1'])
    expect(cells(passMatrix(connRows(rows, { opponent: 'beta', line: [] })))).toEqual(['a>d 0/1'])
    expect(cells(passMatrix(connRows(rows, { opponent: '', line: ['c'] })))).toEqual(['a>b 1/1', 'b>c 1/1'])
  })

  it('top pairs honour the minimum, gender split sums the pairs', () => {
    const m = passMatrix(buildGameRows(data(), F()))
    expect(topConnections(m, 10, 1).map((p) => `${p.thrower}>${p.receiver}`)).toEqual(['a>b', 'b>c', 'a>d']) // ties: better % first
    expect(topConnections(m, 10, 2).map((p) => `${p.thrower}>${p.receiver}`)).toEqual(['a>b', 'a>d'])
    const g = genderSplit(m, (id) => (id === 'a' || id === 'd' ? 'W' : 'M'))
    expect(g.map((c) => [c.key, c.completions, c.attempts])).toEqual([['WW', 1, 2], ['WM', 2, 2], ['MW', 0, 1], ['MM', 1, 1]])
    expect(g[0].share).toBe(2 / 6)
  })

  it('drills into a cell, a thrower row or a receiver column, in play order', () => {
    const rows = buildGameRows(data(), F())
    expect(pairEvents(rows, 'a', 'd').map((r) => r.event.type)).toEqual(['goal', 'drop'])
    expect(pairEvents(rows, 'a', 'd', 'turnover').map((r) => r.game.id)).toEqual(['g2'])
    expect(pairEvents(rows, null, 'd')).toHaveLength(3)
    expect(drillEvents(rows, { kind: 'pair', thrower: 'a', receiver: null, outcome: 'completion', conn: { opponent: 'Alpha', line: [] } })).toHaveLength(3)
  })
})
