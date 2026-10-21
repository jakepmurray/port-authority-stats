import { describe, expect, it } from 'vitest'
import { buildEvent, slotsFor } from './entry'
import type { PossessionState } from './game'

const st = (o: Partial<PossessionState> = {}): PossessionState => ({
  offense: 'us', holder: null, over: false, scorer: null, possessions: { us: 1, them: 0 }, ...o,
})

describe('buildEvent', () => {
  it('first touch is a pickup, then catches imply the thrower', () => {
    expect(buildEvent({ kind: 'touch', player: 'a' }, st())).toMatchObject({ ok: true, event: { type: 'pickup', actor_id: 'a' } })
    expect(buildEvent({ kind: 'touch', player: 'b' }, st({ holder: 'a' }))).toMatchObject({
      ok: true, event: { type: 'catch', team: 'us', actor_id: 'a', receiver_id: 'b' },
    })
  })
  it('rejects a pass to yourself and touches on their possession', () => {
    expect(buildEvent({ kind: 'touch', player: 'a' }, st({ holder: 'a' })).ok).toBe(false)
    expect(buildEvent({ kind: 'touch', player: 'a' }, st({ offense: 'them' })).ok).toBe(false)
  })
  it('goal uses holder as assist; quick mode passes the thrower', () => {
    expect(buildEvent({ kind: 'goal', scorer: 'b' }, st({ holder: 'a' }))).toMatchObject({
      event: { type: 'goal', actor_id: 'a', receiver_id: 'b' },
    })
    expect(buildEvent({ kind: 'goal', thrower: 'c', scorer: 'b' }, st())).toMatchObject({
      event: { actor_id: 'c', receiver_id: 'b' },
    })
    expect(buildEvent({ kind: 'goal', scorer: 'a' }, st({ holder: 'a' })).ok).toBe(false)
    expect(buildEvent({ kind: 'goal' }, st()).ok).toBe(false)
  })
  it('their goal needs no players', () => {
    expect(buildEvent({ kind: 'goal' }, st({ offense: 'them' }))).toMatchObject({ event: { type: 'goal', team: 'them' } })
  })
  it('turnovers go to the team with the disc', () => {
    expect(buildEvent({ kind: 'throwaway' }, st({ holder: 'a' }))).toMatchObject({ event: { team: 'us', actor_id: 'a' } })
    expect(buildEvent({ kind: 'throwaway' }, st({ offense: 'them' }))).toMatchObject({ event: { team: 'them', actor_id: null } })
    expect(buildEvent({ kind: 'drop', receiver: 'b' }, st({ holder: 'a' }))).toMatchObject({
      event: { type: 'drop', actor_id: 'a', receiver_id: 'b' },
    })
    expect(buildEvent({ kind: 'stall' }, st({ holder: 'a' }))).toMatchObject({ event: { type: 'stall', actor_id: 'a' } })
  })
  it('blocks and callahans depend on who has the disc', () => {
    expect(buildEvent({ kind: 'block', defender: 'd' }, st({ offense: 'them' }))).toMatchObject({
      event: { type: 'D', team: 'us', defender_id: 'd' },
    })
    expect(buildEvent({ kind: 'block' }, st())).toMatchObject({ event: { type: 'D', team: 'them' } })
    expect(buildEvent({ kind: 'callahan', defender: 'd' }, st({ offense: 'them' }))).toMatchObject({
      event: { type: 'callahan', team: 'us', defender_id: 'd' },
    })
    expect(buildEvent({ kind: 'callahan' }, st({ holder: 'a' }))).toMatchObject({
      event: { type: 'callahan', team: 'them', actor_id: 'a' },
    })
  })
  it('pull is by the team on defense', () => {
    expect(buildEvent({ kind: 'pull', puller: 'p', result: 'ob' }, st({ offense: 'them' }))).toMatchObject({
      event: { type: 'pull', team: 'us', actor_id: 'p', tags: ['ob'] },
    })
    expect(buildEvent({ kind: 'pull' }, st())).toMatchObject({ event: { team: 'them', actor_id: null } })
  })
  it('refuses play after the point is over, but allows timeouts', () => {
    expect(buildEvent({ kind: 'touch', player: 'a' }, st({ over: true })).ok).toBe(false)
    expect(buildEvent({ kind: 'timeout', team: 'us' }, st({ over: true })).ok).toBe(true)
  })
})

describe('slotsFor', () => {
  it('full mode with a holder needs only the receiver/scorer', () => {
    expect(slotsFor('goal', 'full', st({ holder: 'a' }))).toEqual(['scorer'])
    expect(slotsFor('drop', 'full', st({ holder: 'a' }))).toEqual(['receiver'])
    expect(slotsFor('throwaway', 'full', st({ holder: 'a' }))).toEqual([])
  })
  it('quick mode asks for assist and scorer', () => {
    expect(slotsFor('goal', 'quick', st())).toEqual(['thrower', 'scorer'])
    expect(slotsFor('throwaway', 'quick', st())).toEqual(['thrower'])
  })
  it('defense asks for our defender', () => {
    expect(slotsFor('block', 'full', st({ offense: 'them' }))).toEqual(['defender'])
    expect(slotsFor('goal', 'full', st({ offense: 'them' }))).toEqual([])
  })
})
