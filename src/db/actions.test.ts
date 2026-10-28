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

describe('importUltiAnalytics', () => {
  it('creates new players, the games, points and events, all queued for sync', async () => {
    const { parseUltiCsv, suggestMatches, collectNames } = await import('../domain/ultianalytics')
    const csv = (await import('../domain/__fixtures__/ultianalytics/edge-cases.csv?raw')).default
    const { games } = parseUltiCsv(csv)
    const team = await a.ensureTeam()
    const ann = await a.repo.create('players', { team_id: team.id, name: 'Ann Lee', number: '1', gender_match: 'W' })
    const names = [...collectNames(games).keys()]
    const choices = suggestMatches(names, [ann])
    choices.set('Hal', { kind: 'none' })
    const fresh = new Map(names.filter((n) => choices.get(n)!.kind === 'new').map((n, i) => [n, { name: n, number: String(10 + i), gender_match: 'M' as const }]))
    const r = await a.importUltiAnalytics(games, choices, fresh)
    expect(r.playersCreated).toBe(6) // Bea, Cal, Dee, Eve, Fox, Gus
    const players = await a.repo.live('players')
    expect(players).toHaveLength(7)
    const [g] = r.games
    const points = await a.repo.pointsOfGame(g.id)
    const events = await a.repo.eventsOfGame(g.id)
    expect(points).toHaveLength(4)
    expect(points[0].line).toContain(ann.id)
    expect(points[0].line).toHaveLength(7) // 8 listed, Hal left blank: no guessed sub needed
    expect(events.filter((e) => e.point_id === points[0].id && e.type === 'sub')).toHaveLength(0)
    expect(events.filter((e) => e.source === 'import')).toHaveLength(events.length)
    const st = deriveGame((await a.repo.get('games', g.id))!, points, events)
    expect(st.score).toEqual({ us: 2, them: 2 })
    const q = await a.repo.db.syncQueue.toArray()
    expect(q.filter((o) => o.table === 'events')).toHaveLength(events.length)
    expect(q.some((o) => o.table === 'games' && o.row_id === g.id)).toBe(true)
  })
})

describe('End game, reopen and cap markers', () => {
  const goal = { type: 'goal' as const, team: 'us' as const, actor_id: 'x', receiver_id: 'y', defender_id: null, tags: [] }
  it('ends with an end marker (video time), blocks new points, and reopens', async () => {
    const { g, p } = await setup()
    await a.addEvent(p.id, goal, T)
    const ended = await a.endGame(g.id, { video_time: 61, time_source: 'auto' })
    expect(ended.ended_at).toBeGreaterThan(0)
    const evs = await a.repo.eventsOfGame(g.id)
    expect(evs.filter((e) => e.type === 'end')).toHaveLength(1)
    expect(evs.find((e) => e.type === 'end')!.video_time).toBe(61)
    let st = deriveGame((await a.repo.get('games', g.id))!, await a.repo.pointsOfGame(g.id), await a.repo.eventsOfGame(g.id))
    expect(st).toMatchObject({ ended: true, result: 'W', score: { us: 1, them: 0 } })
    await expect(a.startPoint(g.id, { line: [] })).rejects.toThrow('ended')

    await a.reopenGame(g.id)
    expect((await a.repo.get('games', g.id))!.ended_at).toBeNull()
    expect((await a.repo.eventsOfGame(g.id)).filter((e) => e.type === 'end' && !e.deleted)).toHaveLength(0)
    st = deriveGame((await a.repo.get('games', g.id))!, await a.repo.pointsOfGame(g.id), await a.repo.eventsOfGame(g.id))
    expect(st.ended).toBe(false)
    await a.startPoint(g.id, { line: [] })
  })

  it('undo or deleting the end marker reopens; restoring it ends again', async () => {
    const { g } = await setup()
    await a.endGame(g.id, T)
    expect(await a.undo(g.id)).toBe('event')
    expect((await a.repo.get('games', g.id))!.ended_at).toBeNull()
    await a.endGame(g.id, T)
    const end = (await a.repo.eventsOfGame(g.id)).find((e) => e.type === 'end' && !e.deleted)!
    await a.deleteEvent(end.id)
    expect((await a.repo.get('games', g.id))!.ended_at).toBeNull()
    await a.restoreEvent(end.id)
    expect((await a.repo.get('games', g.id))!.ended_at).not.toBeNull()
  })

  it('a game with no points can still be ended', async () => {
    const g = await a.createGame({ opponent: 'Nobody', ratio_first: 'W4', start_on: 'O' })
    expect((await a.endGame(g.id)).ended_at).not.toBeNull()
  })

  it('marks caps mid-point or between points with the film time', async () => {
    const { g, p } = await setup()
    const mid = await a.markCap(g.id, 'soft', { video_time: 300, time_source: 'auto' })
    expect(mid).toMatchObject({ point_id: p.id, type: 'cap', tags: ['soft'], video_time: 300 })
    await a.addEvent(p.id, goal, T)
    const between = await a.markCap(g.id, 'hard', T)
    expect(between.point_id).toBe(p.id) // on the last finished point
    const st = deriveGame((await a.repo.get('games', g.id))!, await a.repo.pointsOfGame(g.id), await a.repo.eventsOfGame(g.id))
    expect(st).toMatchObject({ target: 2, over: true, result: 'W', ended: false }) // soft → 2; hard, not tied → final
    const empty = await a.createGame({ opponent: 'E', ratio_first: 'W4', start_on: 'O' })
    await expect(a.markCap(empty.id, 'soft', T)).rejects.toThrow('first point')
  })
})
