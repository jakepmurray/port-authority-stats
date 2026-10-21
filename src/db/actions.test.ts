import { beforeEach, describe, expect, it } from 'vitest'
import { deriveGame } from '../domain/game'
import { StatsDB } from './db'
import { Actions } from './actions'
import { Repo } from './repo'

let a: Actions
const T = { video_time: 12.5, time_source: 'auto' as const }
beforeEach(() => {
  a = new Actions(new Repo(new StatsDB(`t-${crypto.randomUUID()}`)))
})

async function setup() {
  const g = await a.createGame({ opponent: 'Rival', ratio_first: 'W4', start_on: 'O' })
  const p = await a.startPoint(g.id, { line: ['x'], video_time: 3 })
  return { g, p }
}

describe('Actions', () => {
  it('creates one team and starts points with ABBA ratio', async () => {
    const { g, p } = await setup()
    expect((await a.repo.live('teams')).length).toBe(1)
    await a.ensureTeam()
    expect((await a.repo.live('teams')).length).toBe(1)
    expect(p).toMatchObject({ idx: 1, ratio: 'W4', start_on: 'O', video_start: 3 })
    await expect(a.startPoint(g.id, { line: [] })).rejects.toThrow('Finish the current point')
    await a.addEvent(p.id, { type: 'goal', team: 'us', actor_id: 'x', receiver_id: 'y', defender_id: null, tags: [] }, T)
    const p2 = await a.startPoint(g.id, { line: [] })
    expect(p2).toMatchObject({ idx: 2, ratio: 'M4', start_on: 'D', score_us: 1, score_them: 0 })
    expect((await a.repo.get('points', p.id))!.outcome).toBe('hold')
    expect((await a.repo.get('points', p.id))!.video_end).toBe(12.5)
  })

  it('appends, inserts between and stamps time', async () => {
    const { p } = await setup()
    const d = (type: 'pickup' | 'catch') => ({ type, team: 'us' as const, actor_id: 'x', receiver_id: null, defender_id: null, tags: [] })
    const e1 = await a.addEvent(p.id, d('pickup'), T)
    const e2 = await a.addEvent(p.id, d('catch'), { video_time: null, time_source: 'auto' })
    const mid = await a.addEvent(p.id, d('catch'), T, { afterId: e1.id })
    expect(e1.seq).toBe(1)
    expect(e2.seq).toBe(2)
    expect(mid.seq).toBe(1.5)
    expect(e2.time_source).toBe('none')
    expect(e1).toMatchObject({ video_time: 12.5, time_source: 'auto', source: 'film' })
  })

  it('undo removes the last event, then the empty point', async () => {
    const { g, p } = await setup()
    await a.addEvent(p.id, { type: 'goal', team: 'them', actor_id: null, receiver_id: null, defender_id: null, tags: [] }, T)
    expect(await a.undo(g.id)).toBe('event')
    expect((await a.repo.get('points', p.id))!.outcome).toBe('none')
    expect(await a.undo(g.id)).toBe('point')
    expect(await a.undo(g.id)).toBeNull()
  })

  it('hand edits mark edited_at and refresh the outcome', async () => {
    const { g, p } = await setup()
    const e = await a.addEvent(p.id, { type: 'goal', team: 'us', actor_id: 'x', receiver_id: 'y', defender_id: null, tags: [] }, T)
    const edited = await a.editEvent(e.id, { team: 'them', actor_id: null, receiver_id: null })
    expect(edited.edited_at).not.toBeNull()
    expect((await a.repo.get('points', p.id))!.outcome).toBe('broken')
    await a.deleteEvent(e.id)
    const st = deriveGame((await a.repo.get('games', g.id))!, await a.repo.pointsOfGame(g.id), await a.repo.eventsOfGame(g.id))
    expect(st.score).toEqual({ us: 0, them: 0 })
    await a.restoreEvent(e.id)
    expect((await a.repo.get('points', p.id))!.outcome).toBe('broken')
  })

  it('backup → replace / merge restore', async () => {
    const { p } = await setup()
    await a.addEvent(p.id, { type: 'goal', team: 'them', actor_id: null, receiver_id: null, defender_id: null, tags: [] }, T)
    const json = JSON.stringify(await a.exportBackup())
    const b = new Actions(new Repo(new StatsDB(`t-${crypto.randomUUID()}`)))
    const c = await b.importBackup(json, 'replace')
    expect(c).toMatchObject({ games: 1, points: 1, events: 1, teams: 1 })
    const again = await b.importBackup(json, 'merge')
    expect(again).toMatchObject({ games: 0, points: 0, events: 0 })
    await expect(b.importBackup('{"app":"nope"}', 'merge')).rejects.toThrow()
  })
})
