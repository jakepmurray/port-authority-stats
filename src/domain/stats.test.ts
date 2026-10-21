import { describe, expect, it } from 'vitest'
import { builder } from './fixtures'
import { computeGameStats, sumPlayerStats } from './stats'

const line = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

/**
 * Point 1 (O): a picks up, a→b, b→c, c→d goal.  (hold)
 * Point 2 (D): they throw it away, we pick up (e), e→f, f drops from... f→g dropped by g,
 *              they score.  (them_hold)
 * Point 3 (O): a→b, b throws away; we block (c D), c picks up, c→a, a→b goal. (hold)
 * Point 4 (D): Callahan by e. (break)
 */
function sample() {
  const b = builder()
  b.point('O', line)
    .ev('pickup', 'us', { actor_id: 'a' })
    .pass('a', 'b', { y: 20, y_end: 35 })
    .pass('b', 'c')
    .goal('c', 'd')
  b.point('D', line, { pulled_by: 'a' })
    .ev('pull', 'us', { actor_id: 'a', tags: ['ob'] })
    .ev('throwaway', 'them')
    .ev('pickup', 'us', { actor_id: 'e' })
    .pass('e', 'f')
    .ev('drop', 'us', { actor_id: 'f', receiver_id: 'g' })
    .ev('timeout', 'them')
    .themGoal()
  b.point('O', line)
    .ev('pickup', 'us', { actor_id: 'a' })
    .pass('a', 'b')
    .ev('throwaway', 'us', { actor_id: 'b' })
    .ev('D', 'us', { defender_id: 'c' })
    .ev('pickup', 'us', { actor_id: 'c' })
    .pass('c', 'a')
    .goal('a', 'b')
  b.point('D', line.slice(0, 6), { pulled_by: 'b' })
    .ev('pull', 'us', { actor_id: 'b' })
    .ev('callahan', 'us', { defender_id: 'e' })
  return b
}

describe('computeGameStats', () => {
  const b = sample()
  const s = computeGameStats(b.game, b.points, b.events)
  const p = (id: string) => s.players.get(id)!

  it('scores the game', () => {
    expect(s.state.score).toEqual({ us: 3, them: 1 })
  })

  it('counts points played on O and D', () => {
    expect(p('a')).toMatchObject({ points: 4, o_points: 2, d_points: 2 })
    expect(p('g')).toMatchObject({ points: 3, o_points: 2, d_points: 1 })
  })

  it('goals, assists, hockey assists', () => {
    expect(p('d')).toMatchObject({ goals: 1 })
    expect(p('c')).toMatchObject({ assists: 1 })
    expect(p('b')).toMatchObject({ hockey_assists: 1, goals: 1 }) // b→c before c→d; scores in pt 3
    expect(p('a')).toMatchObject({ assists: 1 })
    expect(p('c').hockey_assists).toBe(1) // c→a before a→b
  })

  it('completions, attempts and comp%', () => {
    // a: a→b (pt1), a→b (pt3), a→b goal (pt3) = 3/3
    expect(p('a')).toMatchObject({ completions: 3, throw_attempts: 3, comp_pct: 1 })
    // b: b→c (1) + throwaway (1) = 1/2
    expect(p('b')).toMatchObject({ completions: 1, throw_attempts: 2, throwaways: 1, comp_pct: 0.5 })
    // f: one throw dropped by g = 0/1, not a throwaway
    expect(p('f')).toMatchObject({ completions: 0, throw_attempts: 1, throwaways: 0, comp_pct: 0 })
    expect(p('g')).toMatchObject({ drops: 1, turnovers: 1 })
  })

  it('Ds, Callahans, plus/minus', () => {
    expect(p('c')).toMatchObject({ ds: 1 })
    expect(p('e')).toMatchObject({ callahans: 1, goals: 1, ds: 1 })
    // b: goal 1 + assist 0 + D 0 − turnovers 1 = 0
    expect(p('b').plus_minus).toBe(0)
    // c: assist 1 + D 1 = 2
    expect(p('c').plus_minus).toBe(2)
    expect(p('g').plus_minus).toBe(-1)
  })

  it('yards when coordinates exist', () => {
    expect(p('a').throw_yards).toBe(15)
    expect(p('b').recv_yards).toBe(15)
  })

  it('pull stats', () => {
    expect(p('a').pulls).toBe(1)
    expect(p('b').pulls).toBe(1)
    expect(s.team).toMatchObject({ pulls: 2, pulls_ob: 1, pulls_in: 1, pulls_brick: 0 })
  })

  it('team totals', () => {
    expect(s.team).toMatchObject({
      points: 4, o_points: 2, d_points: 2, holds: 2, breaks: 1, them_holds: 1, broken: 0,
      o_conversion: 1, d_break_pct: 0.5, goals: 3, ds: 2, callahans: 1,
    })
    // Our turnovers: g drop (pt2), b throwaway (pt3)
    expect(s.team.turnovers).toBe(2)
    expect(s.team.turnovers_per_point).toBe(0.5)
    // Our possessions: pt1 1, pt2 1, pt3 2, pt4 1 (Callahan gains it)
    expect(s.team.possessions).toBe(5)
    expect(s.team.scoring_efficiency).toBeCloseTo(3 / 5)
  })

  it('opponent at team totals only', () => {
    // Their turnovers: throwaway (pt2), our D (pt3), our Callahan (pt4)
    expect(s.opponent).toMatchObject({ goals: 1, turnovers: 3, ds: 0, callahans: 0, holds: 1, breaks: 0 })
    expect([...s.players.keys()].every((k) => 'abcdefg'.includes(k))).toBe(true)
  })

  it('recomputes after an edit / soft delete', () => {
    const c = sample()
    const goal = c.events.find((e) => e.type === 'goal' && e.receiver_id === 'd')!
    goal.receiver_id = 'e'
    c.events.find((e) => e.type === 'drop')!.deleted = true
    const s2 = computeGameStats(c.game, c.points, c.events)
    expect(s2.players.get('d')!.goals).toBe(0)
    expect(s2.players.get('e')!.goals).toBe(2)
    expect(s2.players.get('g')!.drops).toBe(0)
  })
})

describe('edge cases', () => {
  it('their Callahan charges our thrower', () => {
    const b = builder().point('O', line).ev('pickup', 'us', { actor_id: 'a' }).ev('callahan', 'them', { actor_id: 'a' })
    const s = computeGameStats(b.game, b.points, b.events)
    expect(s.players.get('a')).toMatchObject({ throwaways: 1, throw_attempts: 1, turnovers: 1 })
    expect(s.opponent).toMatchObject({ goals: 1, callahans: 1 })
    expect(s.state.points[0].outcome).toBe('broken')
    expect(s.team.o_conversion).toBe(0)
  })

  it('their D counts as our turnover and their D', () => {
    const b = builder().point('O', line).ev('pickup', 'us', { actor_id: 'a' }).ev('D', 'them')
    const s = computeGameStats(b.game, b.points, b.events)
    expect(s.team.turnovers).toBe(1)
    expect(s.opponent.ds).toBe(1)
  })

  it('quick-mode goal without a catch chain gives no hockey assist', () => {
    const b = builder().point('O', line).goal('a', 'b')
    const s = computeGameStats(b.game, b.points, b.events)
    expect(s.players.get('a')!.hockey_assists).toBe(0)
    expect(s.players.get('a')!.assists).toBe(1)
  })

  it('unfinished points count as played but not in conversion %', () => {
    const b = builder().point('O', line).pass('a', 'b')
    const s = computeGameStats(b.game, b.points, b.events)
    expect(s.team.points).toBe(1)
    expect(s.team.o_conversion).toBeNull()
  })

  it('sums stats across games', () => {
    const one = computeGameStats(sample().game, sample().points, sample().events)
    const tot = sumPlayerStats([[...one.players.values()], [...one.players.values()]])
    expect(tot.get('a')!.completions).toBe(6)
    expect(tot.get('b')!.comp_pct).toBe(0.5)
  })
})
