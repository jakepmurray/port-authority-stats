import { describe, expect, it } from 'vitest'
import { builder } from './fixtures'
import { capsDue, deriveGame, outcomeOf, replayPoint } from './game'

describe('replayPoint', () => {
  it('tracks holder through pickups and catches', () => {
    const b = builder().point('O').ev('pickup', 'us', { actor_id: 'a' }).pass('a', 'b').pass('b', 'c')
    const s = replayPoint('O', b.events)
    expect(s.offense).toBe('us')
    expect(s.holder).toBe('c')
    expect(s.over).toBe(false)
  })
  it('flips possession on turnovers and Ds', () => {
    const b = builder().point('O').pass('a', 'b').ev('throwaway', 'us', { actor_id: 'b' })
    let s = replayPoint('O', b.events)
    expect(s.offense).toBe('them')
    expect(s.holder).toBeNull()
    b.ev('D', 'us', { defender_id: 'c' })
    s = replayPoint('O', b.events)
    expect(s.offense).toBe('us')
    expect(s.possessions).toEqual({ us: 2, them: 1 })
  })
  it('ignores meta and deleted events', () => {
    const b = builder().point('D').ev('timeout', 'them').ev('throwaway', 'them', { deleted: true })
    expect(replayPoint('D', b.events).offense).toBe('them')
  })
  it('ends on goal or callahan', () => {
    const b = builder().point('D').ev('callahan', 'us', { defender_id: 'x' })
    const s = replayPoint('D', b.events)
    expect(s.over).toBe(true)
    expect(s.scorer).toBe('us')
  })
})

describe('outcomeOf', () => {
  it('labels holds and breaks from our side', () => {
    expect(outcomeOf('O', 'us')).toBe('hold')
    expect(outcomeOf('O', 'them')).toBe('broken')
    expect(outcomeOf('D', 'us')).toBe('break')
    expect(outcomeOf('D', 'them')).toBe('them_hold')
    expect(outcomeOf('O', null)).toBe('none')
  })
})

describe('deriveGame', () => {
  it('scores points and picks the next point setup', () => {
    const b = builder().point('O').goal('a', 'b')
    let g = deriveGame(b.game, b.points, b.events)
    expect(g.score).toEqual({ us: 1, them: 0 })
    expect(g.next).toEqual({ idx: 2, ratio: 'M4', start_on: 'D' })
    expect(g.current).toBeNull()
    b.point('D').themGoal()
    g = deriveGame(b.game, b.points, b.events)
    expect(g.score).toEqual({ us: 1, them: 1 })
    expect(g.next.start_on).toBe('O')
    expect(g.points.map((p) => p.outcome)).toEqual(['hold', 'them_hold'])
  })

  it('reports the in-progress point', () => {
    const b = builder().point('O').pass('a', 'b')
    const g = deriveGame(b.game, b.points, b.events)
    expect(g.current?.point.id).toBe('p1')
    expect(g.next.idx).toBe(2)
  })

  it('takes halftime at 8 and flips who receives', () => {
    const b = builder({ start_on: 'O' })
    for (let i = 0; i < 8; i++) b.point(i === 0 ? 'O' : 'D').goal('a', 'b')
    const g = deriveGame(b.game, b.points, b.events)
    expect(g.score.us).toBe(8)
    expect(g.halfReached).toBe(true)
    expect(g.points.at(-1)!.halfAfter).toBe(true)
    // We received to start the game, so we pull to start the second half.
    expect(g.next.start_on).toBe('D')
    expect(g.next.ratio).toBe('W4') // point 9 = A; halftime doesn't reset ABBA
  })

  it('ends the game at 15', () => {
    const b = builder()
    for (let i = 0; i < 15; i++) b.point('O').goal('a', 'b')
    const g = deriveGame(b.game, b.points, b.events)
    expect(g.over).toBe(true)
    expect(g.winner).toBe('us')
  })

  it('soft cap: finish the point, then target = higher score + 1', () => {
    const b = builder()
    for (let i = 0; i < 10; i++) b.point('O').goal('a', 'b') // 10-0
    b.point('D').ev('cap', 'us', { tags: ['soft'] }).themGoal() // 10-1, cap on during point 11
    const g = deriveGame(b.game, b.points, b.events)
    expect(g.capsCalled.soft).toBe(true)
    expect(g.target).toBe(11)
    expect(g.over).toBe(false)
    b.point('O').goal('a', 'b')
    expect(deriveGame(b.game, b.points, b.events).over).toBe(true)
  })

  it('soft cap never raises the target above game-to', () => {
    const b = builder({ game_to: 15 })
    for (let i = 0; i < 14; i++) b.point('O').goal('a', 'b')
    b.point('D').ev('cap', 'us', { tags: ['soft'] }).themGoal() // 14-1 → 15 stays
    expect(deriveGame(b.game, b.points, b.events).target).toBe(15)
  })

  it('hard cap: game ends after the point unless tied', () => {
    const b = builder()
    b.point('O').goal('a', 'b').point('D').ev('cap', 'us', { tags: ['hard'] }).themGoal() // 1-1 tied
    let g = deriveGame(b.game, b.points, b.events)
    expect(g.over).toBe(false)
    expect(g.target).toBe(2)
    b.point('O').goal('a', 'b')
    g = deriveGame(b.game, b.points, b.events)
    expect(g.over).toBe(true)
    expect(g.score).toEqual({ us: 2, them: 1 })

    const c = builder()
    c.point('O').goal('a', 'b').point('D').ev('cap', 'us', { tags: ['hard'] }).goal('a', 'b') // 2-0
    expect(deriveGame(c.game, c.points, c.events).over).toBe(true)
  })

  it('half cap lowers the half target', () => {
    const b = builder()
    for (let i = 0; i < 5; i++) b.point('O').goal('a', 'b') // 5-0
    b.point('D').ev('cap', 'us', { tags: ['half'] }).themGoal() // 5-1, half target → 6
    let g = deriveGame(b.game, b.points, b.events)
    expect(g.halfTarget).toBe(6)
    expect(g.halfReached).toBe(false)
    b.point('O').goal('a', 'b') // 6-1 → half
    g = deriveGame(b.game, b.points, b.events)
    expect(g.halfReached).toBe(true)
  })

  it('counts timeouts per half and team', () => {
    const b = builder().point('O').ev('timeout', 'us').ev('timeout', 'them').goal('a', 'b')
    const g = deriveGame(b.game, b.points, b.events)
    expect(g.timeouts[1]).toEqual({ us: 1, them: 1 })
    expect(g.timeouts[2]).toEqual({ us: 0, them: 0 })
  })

  it('ignores deleted points and events from other games', () => {
    const b = builder().point('O').goal('a', 'b').point('D', [], { deleted: true })
    b.events.push({ ...b.events[0], id: 'other', game_id: 'g2' })
    const g = deriveGame(b.game, b.points, b.events)
    expect(g.points).toHaveLength(1)
    expect(g.score.us).toBe(1)
  })
})

describe('capsDue', () => {
  it('compares the game clock to caps', () => {
    expect(capsDue({ half: 45, soft: 90, hard: 105 }, 50)).toEqual({ half: true, soft: false, hard: false })
    expect(capsDue({ half: 52, soft: 105, hard: null }, 200)).toEqual({ half: true, soft: true, hard: false })
  })
})
