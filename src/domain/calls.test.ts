import { describe, expect, it } from 'vitest'
import { builder } from './fixtures'
import { replayPoint } from './game'
import type { Call } from './schema'
import { computeGameStats, sumPlayerStats } from './stats'
import { eventsCsv, playerStatsCsv } from './exports'

const line = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const call = (c: Partial<Call>): Call => ({ kind: 'foul', outcome: 'contested', turnover_team: null, charged_id: null, ...c })

function callGame() {
  const b = builder()
  b.point('O', line)
    .ev('pickup', 'us', { actor_id: 'a' })
    .ev('call', 'us', { actor_id: 'a', call: call({ kind: 'foul', outcome: 'contested' }) }) // a fouled on the mark
    .pass('a', 'b')
    .ev('call', 'them', { receiver_id: 'b', call: call({ kind: 'travel', outcome: 'uncontested' }) })
    .ev('call', 'them', { receiver_id: 'b', call: call({ kind: 'travel', outcome: 'turnover', turnover_team: 'us', charged_id: 'b' }), tags: ['miscommunication'] })
    .ev('call', 'us', { actor_id: 'c', call: call({ kind: 'pick', outcome: 'retracted' }) })
    .ev('call', 'them', { call: call({ kind: 'stall', outcome: 'turnover', turnover_team: 'them' }) }) // their stall call stands: they lose it
    .pass('c', 'd')
    .goal('d', 'e')
  return b
}

describe('calls', () => {
  it('only turnover calls change possession', () => {
    const b = callGame()
    const at = (n: number) => replayPoint('O', b.events.slice(0, n))
    expect(at(2).offense).toBe('us')
    expect(at(2).holder).toBe('a') // a non-turnover call keeps the disc with the thrower
    expect(at(4).offense).toBe('us')
    expect(at(5).offense).toBe('them')
    expect(at(6).offense).toBe('them')
    expect(at(7).offense).toBe('us')
    expect(at(7).possessions).toEqual({ us: 2, them: 1 })
  })

  it('a turnover call counts once: team turnovers, charged player, tags', () => {
    const g = callGame()
    const s = computeGameStats(g.game, g.points, g.events)
    expect(s.team.turnovers).toBe(1)
    expect(s.opponent.turnovers).toBe(1)
    const b = s.players.get('b')!
    expect(b).toMatchObject({ turnovers: 1, call_turns: 1, throwaways: 0, other_turns: 0, plus_minus: -1 })
    expect(b.turnover_tags).toEqual({ miscommunication: { call: 1 } })
    expect(s.state.score).toEqual({ us: 1, them: 0 })
  })

  it('counts calls per player and team, by kind and outcome', () => {
    const b = callGame()
    const s = computeGameStats(b.game, b.points, b.events)
    expect(s.team).toMatchObject({ calls_made: 2, calls_against: 3 })
    expect(s.opponent).toMatchObject({ calls_made: 3, calls_against: 2 })
    expect(s.team.calls_made_by).toEqual({ foul: { contested: 1 }, pick: { retracted: 1 } })
    expect(s.team.calls_against_by).toEqual({ travel: { uncontested: 1, turnover: 1 }, stall: { turnover: 1 } })
    expect(s.players.get('a')).toMatchObject({ calls_made: 1, calls_made_by: { foul: { contested: 1 } } })
    expect(s.players.get('b')).toMatchObject({ calls_against: 2, calls_against_by: { travel: { uncontested: 1, turnover: 1 } } })
    const sum = sumPlayerStats([[s.players.get('b')!], [s.players.get('b')!]]).get('b')!
    expect(sum.calls_against_by).toEqual({ travel: { uncontested: 2, turnover: 2 } })
  })

  it('a deleted turnover call gives the disc back', () => {
    const b = callGame()
    b.events[4] = { ...b.events[4], deleted: true }
    const s = computeGameStats(b.game, b.points, b.events)
    expect(s.team.turnovers).toBe(0)
    expect(s.players.get('b')!.call_turns).toBe(0)
  })

  it('exports call columns', () => {
    const b = callGame()
    const d = { players: [], games: [b.game], points: b.points, events: b.events }
    const csv = eventsCsv(d)
    expect(csv.split('\n')[0]).toContain('call_kind,call_outcome,call_turnover_by,call_charged_number')
    expect(csv).toContain('travel,turnover,us')
    expect(playerStatsCsv(d)).toContain('travel: 2 (uncontested 1, turnover 1)')
  })
})
