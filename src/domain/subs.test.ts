import { describe, expect, it } from 'vitest'
import { builder } from './fixtures'
import { deriveGame, replayPoint } from './game'
import { PlayerSchema } from './schema'
import { computeGameStats } from './stats'
import { lineAfterSub, lineTimeline, subRatioIssues } from './subs'

const players = [
  ['a', 'W'], ['b', 'W'], ['c', 'W'], ['d', 'W'], ['e', 'M'], ['f', 'M'], ['g', 'M'], ['h', 'M'], ['i', 'W'],
].map(([id, g]) => PlayerSchema.parse({ id, team_id: 't1', name: id, number: String(id.charCodeAt(0) - 96), gender_match: g, created_at: 1, updated_at: 1 }))
const line = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] // W4

function subGame() {
  const b = builder()
  b.point('O', line)
    .ev('pickup', 'us', { actor_id: 'a' })
    .pass('a', 'g')
    .ev('injury', 'us', { actor_id: 'g', receiver_id: 'h' }) // g hurt while holding the disc
    .pass('h', 'b')
    .ev('sub', 'us', { actor_id: 'c', receiver_id: 'i' })
    .goal('b', 'i')
  return b
}

describe('lineTimeline', () => {
  it('applies subs in order and records the line at each event', () => {
    const b = subGame()
    const tl = lineTimeline(line, b.events)
    expect(tl.final.sort()).toEqual(['a', 'b', 'd', 'e', 'f', 'h', 'i'])
    expect(tl.at.get('e4')).toContain('h') // pass after the injury sub
    expect(tl.at.get('e3')).toContain('g') // the sub itself sees the old line
    expect([...tl.partial].sort()).toEqual(['c', 'g', 'h', 'i'])
    expect(tl.subs).toBe(2)
  })

  it('recomputes when a sub is edited or deleted', () => {
    const b = subGame()
    b.events[4] = { ...b.events[4], receiver_id: 'h' } // second sub now brings on h (already on): just c off
    expect(lineTimeline(line, b.events).final).not.toContain('c')
    b.events[2] = { ...b.events[2], deleted: true }
    const tl = lineTimeline(line, b.events)
    expect(tl.final).toContain('g')
    expect(tl.final).toContain('h')
    expect(tl.partial.has('g')).toBe(false)
  })

  it('ignores their subs and unknown players', () => {
    const b = builder()
    b.point('O', line).ev('sub', 'them').ev('sub', 'us', { actor_id: null, receiver_id: 'h' })
    expect(lineTimeline(line, b.events).final).toHaveLength(8)
  })
})

describe('sub ratio warning', () => {
  it('warns when the sub breaks the ratio, not for like-for-like', () => {
    expect(subRatioIssues(lineAfterSub(line, 'e', 'h'), players, 'W4')).toEqual([])
    const bad = subRatioIssues(lineAfterSub(line, 'a', 'h'), players, 'W4') // W out, M in: 3W 4M on a W4 point
    expect(bad.map((i) => i.code)).toEqual(['over_ratio'])
  })
})

describe('subs and possession / stats', () => {
  it('the incoming player takes the disc from an injured holder', () => {
    const b = subGame()
    const st = replayPoint('O', b.events.slice(0, 3))
    expect(st.holder).toBe('h')
    expect(b.events[3]).toMatchObject({ actor_id: 'h', receiver_id: 'b' })
  })

  it('both players get the point played plus a partial point', () => {
    const b = subGame()
    const s = computeGameStats(b.game, b.points, b.events)
    const p = (id: string) => s.players.get(id)!
    expect(deriveGame(b.game, b.points, b.events).score).toEqual({ us: 1, them: 0 })
    expect(p('g')).toMatchObject({ points: 1, partial_points: 1, catches: 1 })
    expect(p('h')).toMatchObject({ points: 1, partial_points: 1, completions: 1 })
    expect(p('i')).toMatchObject({ points: 1, partial_points: 1, goals: 1 })
    expect(p('a')).toMatchObject({ points: 1, partial_points: 0 })
    expect(s.team).toMatchObject({ subs: 2, injury_subs: 1, points: 1 })
  })
})
