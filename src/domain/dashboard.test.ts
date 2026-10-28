import { describe, expect, it } from 'vitest'
import {
  buildGameRows, byRatio, callStacks, DEFAULT_FILTER, drillEvents, filterToQuery, footnotes, hasTags, heatmap, holdBreakTrend,
  kpis, leaderboard, parseFilter, recentDelta, tagsInUse, totals, turnoverStacks, UNTAGGED, type DashFilter,
} from './dashboard'
import { builder } from './fixtures'
import { computeGameStats } from './stats'

/** Game 1 (film, T1): won 3–1, with tagged turnovers and a call. Game 2 (imported, T2): lost 0–1. */
function season() {
  const g1 = builder({ id: 'g1', opponent: 'Alpha', tournament: 'T1', date: '2026-06-01', game_to: 3 })
  g1.point('O', ['a', 'b', 'c']).pass('a', 'b').goal('b', 'c') // hold
  g1.point('D', ['a', 'b', 'c'])
    .ev('pull', 'us', { actor_id: 'a' })
    .ev('throwaway', 'them', { tags: ['wind'] })
    .pass('a', 'b')
    .ev('throwaway', 'us', { actor_id: 'b', tags: ['wind', 'difficult throw'] })
    .ev('D', 'us', { defender_id: 'c', tags: ['great D'] })
    .ev('call', 'them', { receiver_id: 'a', call: { kind: 'foul', outcome: 'contested', turnover_team: null, charged_id: null } })
    .goal('a', 'c') // break
  g1.point('O', ['a', 'b', 'c']).ev('throwaway', 'us', { actor_id: 'b', tags: ['receiver error'] }).themGoal() // broken
  g1.point('O', ['a', 'b', 'c'], { missed_on_film: true, manual_result: 'us' }) // hold, no film
  const g2 = builder({ id: 'g2', opponent: 'Beta', tournament: 'T2', date: '2026-06-08', game_to: 1, notes: 'Imported [ultianalytics:x]' })
  g2.point('O', ['a', 'd']).ev('drop', 'us', { actor_id: 'a', receiver_id: 'd', source: 'import' }).ev('goal', 'them', { source: 'import' })
  // pts ids repeat across builders (p1…): rows must keep games apart
  return { games: [g1.game, g2.game], points: [...g1.points, ...g2.points], events: [...g1.events, ...g2.events] }
}
const F = (f: Partial<DashFilter> = {}): DashFilter => ({ ...DEFAULT_FILTER, ...f })

describe('filter in the URL', () => {
  it('round-trips and stays empty by default', () => {
    expect(filterToQuery(DEFAULT_FILTER)).toBe('')
    const f = F({ tournament: 'Club Nationals', games: ['g1', 'g2'], side: 'D', sources: ['film', 'import'], tags: ['wind', 'great D'], tagMode: 'all', tagScope: 'drop_points' })
    expect(parseFilter(filterToQuery(f))).toEqual(f)
    expect(parseFilter('?side=X&src=film,bogus&tm=x&ts=nope')).toEqual(F({ sources: ['film'] }))
  })
  it('matches tags any/all, ignoring case and system tags', () => {
    const e = { tags: ['Wind', 'ob'] }
    expect(hasTags(e, ['wind'], 'any')).toBe(true)
    expect(hasTags(e, ['wind', 'great D'], 'any')).toBe(true)
    expect(hasTags(e, ['wind', 'great D'], 'all')).toBe(false)
    expect(hasTags(e, ['ob'], 'any')).toBe(false)
    expect(hasTags(e, [], 'all')).toBe(true)
  })
})

describe('stats count predicate', () => {
  it('filters tallies but keeps the score and holds', () => {
    const d = season()
    const all = computeGameStats(d.games[0], d.points, d.events)
    const wind = computeGameStats(d.games[0], d.points, d.events, (e) => e.tags.includes('wind'))
    expect(all.team.turnovers).toBe(2)
    expect(wind.team.turnovers).toBe(1)
    expect(wind.team.goals).toBe(0)
    expect(wind.state.score).toEqual(all.state.score)
    expect(wind.team.holds).toBe(all.team.holds)
    expect(wind.players.get('b')!.points).toBe(all.players.get('b')!.points)
  })
})

describe('game and point filters', () => {
  const d = season()
  it('selects games by tournament, id and source, oldest first', () => {
    expect(buildGameRows(d, F()).map((r) => [r.label, r.source, r.noGender])).toEqual([['6/1 Alpha', 'film', false], ['6/8 Beta', 'import', true]])
    expect(buildGameRows(d, F({ tournament: 'T2' })).map((r) => r.game.id)).toEqual(['g2'])
    expect(buildGameRows(d, F({ games: ['g1'] })).map((r) => r.game.id)).toEqual(['g1'])
    expect(buildGameRows(d, F({ sources: ['import'] })).map((r) => r.game.id)).toEqual(['g2'])
  })
  it('O/D filter keeps only those points', () => {
    const t = totals(buildGameRows(d, F({ side: 'D' })))
    expect(t).toMatchObject({ points: 1, holds: 0, breaks: 1, dFinished: 1, oFinished: 0, scored: 1, allowed: 0 })
    expect(t.record).toEqual({ w: 1, l: 1, other: 0 }) // whole games
  })
  it('tag scopes: only, without, drop points', () => {
    const only = totals(buildGameRows(d, F({ tags: ['wind'] })))
    expect(only).toMatchObject({ turnovers: 1, holds: 2, breaks: 1, ds: 0, completions: 0 })
    const without = totals(buildGameRows(d, F({ tags: ['wind'], tagScope: 'without' })))
    expect(without).toMatchObject({ turnovers: 2, ds: 1 }) // receiver-error throwaway + game 2 drop; the great-D block
    const drop = totals(buildGameRows(d, F({ tags: ['great D'], tagScope: 'drop_points' })))
    expect(drop).toMatchObject({ breaks: 0, points: 4, scored: 2, allowed: 2 })
    const all = totals(buildGameRows(d, F({ tags: ['wind', 'difficult throw'], tagMode: 'all' })))
    expect(all.turnovers).toBe(1)
  })
})

describe('headline numbers', () => {
  const rows = buildGameRows(season(), F())
  it('computes the KPIs', () => {
    const k = Object.fromEntries(kpis(rows).map((x) => [x.key, x]))
    expect(k.record.display).toBe('1–1')
    expect(k.diff.display).toBe('+1') // 3–1 and 0–1
    expect(k.hold.value).toBeCloseTo(2 / 4) // holds: p1, missed p4; broken p3, g2 p1
    expect(k.break.value).toBe(1)
    expect(k.turns_pp.value).toBeCloseTo(3 / 4) // 4 points with film (1 missed on film)
    expect(k.ds_pp.value).toBeCloseTo(1 / 4)
    expect(k.comp.value).toBeCloseTo(4 / 7) // 2 passes + 2 goals of 7 throws (2 throwaways, 1 drop)
    expect(k.hold.series).toEqual([2 / 3, 0])
    expect(k.hold.delta).toBeNull() // needs 4+ games
  })
  it('compares the last games to the earlier ones', () => {
    expect(recentDelta([0.5, 0.5, 0.6, 0.7, 0.8])).toBeCloseTo(0.7 - 0.5)
    expect(recentDelta([0.5, null, 0.6, 0.7])).toBeNull()
  })
  it('gives a per-game hold/break trend', () => {
    expect(holdBreakTrend(rows).map((r) => [r.label, r.hold, r.break])).toEqual([['6/1 Alpha', 2 / 3, 1], ['6/8 Beta', 0, null]])
  })
  it('footnotes missed points, imported games and the tag rule', () => {
    const n = footnotes(rows, F({ tags: ['wind', 'great D'] }))
    expect(n).toMatchObject({ missedPoints: 1, importedGames: 1, sideNote: null })
    expect(n.tagNote).toMatch(/only include events tagged “wind” or “great D”/)
  })
})

describe('breakdowns', () => {
  const rows = buildGameRows(season(), F())
  it('stacks turnovers by kind and first tag', () => {
    const us = turnoverStacks(rows, 'us')
    expect(us.rows.map((r) => [r.key, r.total, r.wind ?? 0, r['receiver error'] ?? 0, r[UNTAGGED] ?? 0])).toEqual([['throwaway', 2, 1, 1, 0], ['drop', 1, 0, 0, 1]])
    expect(us.stacks).toEqual(['receiver error', 'wind', UNTAGGED])
    const them = turnoverStacks(rows, 'them')
    expect(them.rows.map((r) => [r.key, r.total])).toEqual([['throwaway', 1], ['block', 1]])
  })
  it('summarises calls by kind and outcome', () => {
    expect(callStacks(rows, 'them').rows).toEqual([{ key: 'foul', label: 'foul', total: 1, contested: 1 }])
    expect(callStacks(rows, 'us').rows).toEqual([])
  })
  it('ranks players with per-point rates and a minimum', () => {
    const lb = leaderboard(rows)
    const c = lb.find((r) => r.player_id === 'c')!
    expect(c).toMatchObject({ goals: 2, ds: 1, points: 3 })
    expect(c.per_point.goals).toBeCloseTo(2 / 3)
    expect(leaderboard(rows, 4).map((r) => r.player_id).sort()).toEqual(['a'])
  })
  it('splits hold/break by ratio, leaving out imported games', () => {
    const r = byRatio(rows)
    expect(r.skippedGames).toBe(1)
    expect(r.rows.reduce((a, b) => a + b.points, 0)).toBe(4)
  })
  it('hides the heatmap without coordinates', () => {
    expect(heatmap(rows, 'turnovers')).toBeNull()
    const withXY = rows.map((r) => ({ ...r, events: r.events.map((e) => (e.type === 'throwaway' && e.team === 'us' ? { ...e, x: 20, y: 100 } : e)) }))
    const h = heatmap(withXY, 'turnovers')!
    expect(h.n).toBe(2)
    expect(h.grid[10][2]).toBe(2)
  })
})

describe('drill-down', () => {
  const rows = buildGameRows(season(), F())
  it('lists the events behind a chart element', () => {
    expect(drillEvents(rows, { kind: 'turnover', team: 'us', turn: 'throwaway', tag: 'wind' }).map((r) => r.event.actor_id)).toEqual(['b'])
    expect(drillEvents(rows, { kind: 'turnover', team: 'us' })).toHaveLength(3)
    expect(drillEvents(rows, { kind: 'call', team: 'them', outcome: 'contested' })).toHaveLength(1)
    expect(drillEvents(rows, { kind: 'player', id: 'c' }).map((r) => r.event.type)).toEqual(['goal', 'D', 'goal'])
    const g = drillEvents(rows, { kind: 'game', id: 'g1', side: 'O' })
    expect(g.map((r) => r.point?.idx)).toEqual([1, 3])
  })
  it('lists tags in use, most used first', () => {
    expect(tagsInUse(season().events).map((t) => t.tag)).toEqual(['wind', 'difficult throw', 'great D', 'receiver error'])
  })
})
