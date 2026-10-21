import { describe, expect, it } from 'vitest'
import { builder } from './fixtures'
import { computeGameStats, formatTagBreakdown, sumPlayerStats, tagTotals } from './stats'
import { deriveGame } from './game'
import { tagChoices, toggleTag, userTags } from './tags'

const line = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

describe('tag helpers', () => {
  it('lists presets then custom tags, deduped and without system tags', () => {
    const c = tagChoices(['Layout', 'wind', 'ob', ' '])
    expect(c.slice(0, 6)).toEqual(['receiver error', 'difficult throw', 'great D', 'wind', 'miscommunication', 'hammer/huck'])
    expect(c.slice(6)).toEqual(['Layout'])
  })
  it('toggles case-insensitively and hides system tags', () => {
    expect(toggleTag(['wind'], 'Wind')).toEqual([])
    expect(toggleTag([], 'wind')).toEqual(['wind'])
    expect(userTags(['ob', 'wind', 'soft'])).toEqual(['wind'])
  })
})

describe('turnover tags', () => {
  const b = builder()
  b.point('O', line)
    .ev('pickup', 'us', { actor_id: 'a' })
    .ev('throwaway', 'us', { actor_id: 'a', tags: ['receiver error', 'wind'] })
    .ev('D', 'us', { defender_id: 'b', tags: ['great D'] })
    .ev('pickup', 'us', { actor_id: 'b' })
    .ev('drop', 'us', { actor_id: 'b', receiver_id: 'c', tags: ['difficult throw'] })
    .ev('D', 'us', { defender_id: 'd' })
    .ev('pickup', 'us', { actor_id: 'd' })
    .ev('throwaway', 'us', { actor_id: 'd', tags: ['receiver error'] })
    .ev('D', 'them', { tags: ['great D'] })
    .ev('pickup', 'us', { actor_id: 'd' })
    .goal('d', 'e')
  const s = computeGameStats(b.game, b.points, b.events)
  const p = (id: string) => s.players.get(id)!

  it('tags never change who is charged', () => {
    expect(p('a')).toMatchObject({ throwaways: 1, turnovers: 1 })
    expect(p('c')).toMatchObject({ drops: 1, turnovers: 1 })
    expect(p('b')).toMatchObject({ drops: 0, turnovers: 0, throw_attempts: 1 })
    expect(s.team.turnovers).toBe(4)
  })

  it('breaks down player turnovers by tag and type', () => {
    expect(p('a').turnover_tags).toEqual({ 'receiver error': { throwaway: 1 }, wind: { throwaway: 1 } })
    expect(p('c').turnover_tags).toEqual({ 'difficult throw': { drop: 1 } })
    expect(p('b').turnover_tags).toEqual({})
  })

  it('breaks down team and opponent turnovers by tag', () => {
    expect(s.team.turnover_tags).toEqual({
      'receiver error': { throwaway: 2 }, wind: { throwaway: 1 }, 'difficult throw': { drop: 1 }, 'great D': { D: 1 },
    })
    expect(s.opponent.turnover_tags).toEqual({ 'great D': { D: 1 } })
    expect(tagTotals(s.team.turnover_tags)[0]).toEqual(['receiver error', 2])
    expect(formatTagBreakdown(p('a').turnover_tags)).toBe('receiver error: 1 (throwaway 1); wind: 1 (throwaway 1)')
  })

  it('ignores system tags like pull results', () => {
    const c = builder()
    c.point('D', line).ev('pull', 'us', { actor_id: 'a', tags: ['ob'] }).ev('stall', 'them', { tags: ['wind'] })
    const t = computeGameStats(c.game, c.points, c.events)
    expect(t.opponent.turnover_tags).toEqual({ wind: { stall: 1 } })
    expect(t.team.turnover_tags).toEqual({})
  })

  it('sums tag breakdowns across games', () => {
    const sum = sumPlayerStats([[p('a')], [p('a')]])
    expect(sum.get('a')!.turnover_tags).toEqual({ 'receiver error': { throwaway: 2 }, wind: { throwaway: 2 } })
    expect(p('a').turnover_tags['receiver error'].throwaway).toBe(1) // inputs untouched
  })
})

describe('points missed on film', () => {
  const b = builder()
  b.point('O', line).ev('pickup', 'us', { actor_id: 'a' }).ev('throwaway', 'us', { actor_id: 'a' }).goal('b', 'c')
  b.point('O', line, { missed_on_film: true, manual_result: 'them' })
  b.point('D', [], { missed_on_film: true, manual_result: 'us' })
  b.point('O', line).themGoal()
  const s = computeGameStats(b.game, b.points, b.events)

  it('scores from the hand-entered result and keeps the point order', () => {
    expect(s.state.score).toEqual({ us: 2, them: 2 })
    expect(s.state.points.map((p) => p.outcome)).toEqual(['hold', 'broken', 'break', 'broken'])
    expect(deriveGame(b.game, b.points, b.events).next.start_on).toBe('O')
  })

  it('counts at team level, not toward per-player points', () => {
    expect(s.team).toMatchObject({ points: 4, points_missed: 2, holds: 1, breaks: 1, broken: 2 })
    expect(s.players.get('a')).toMatchObject({ points: 2, points_missed: 1 })
    expect(s.team.turnovers_per_point).toBe(0.5) // 1 turnover over 2 filmed points
    expect(s.team.possessions).toBe(2)
  })

  it('a missed point with no result is still in progress', () => {
    const c = builder()
    c.point('O', [], { missed_on_film: true })
    const st = deriveGame(c.game, c.points, c.events)
    expect(st.current?.point.id).toBe('p1')
    expect(st.score).toEqual({ us: 0, them: 0 })
  })

  it('ignores events left on a missed point', () => {
    const c = builder()
    c.point('O', line, { missed_on_film: true, manual_result: 'us' }).ev('pickup', 'us', { actor_id: 'a' }).ev('throwaway', 'us', { actor_id: 'a' })
    const t = computeGameStats(c.game, c.points, c.events)
    expect(t.state.score).toEqual({ us: 1, them: 0 })
    expect(t.players.get('a')).toMatchObject({ throwaways: 0, points: 0, points_missed: 1 })
  })
})

describe('CSV exports', () => {
  it('include tags, tag breakdowns and missed points', async () => {
    const { eventsCsv, playerStatsCsv, pointsCsv, gamesCsv } = await import('./exports')
    const b = builder()
    b.point('O', ['a']).ev('pickup', 'us', { actor_id: 'a' }).ev('throwaway', 'us', { actor_id: 'a', tags: ['receiver error', 'wind'] })
    b.point('O', [], { missed_on_film: true, manual_result: 'us' })
    const d = { players: [], games: [b.game], points: b.points, events: b.events }
    expect(eventsCsv(d)).toContain('receiver error; wind')
    expect(playerStatsCsv(d)).toContain('receiver error: 1 (throwaway 1); wind: 1 (throwaway 1)')
    expect(pointsCsv(d).split('\n')[0]).toContain('missed_on_film,manual_result')
    expect(pointsCsv(d)).toContain(',yes,us,')
    expect(gamesCsv(d)).toContain('points_missed_on_film')
  })
})
