/**
 * Scenario: Jacob (admin) and stat-takers on their own devices, each with its own
 * IndexedDB, talking to one mock Apps Script through fetch.
 */
import { describe, expect, it } from 'vitest'
import { Actions } from '../db/actions'
import { StatsDB } from '../db/db'
import { Repo } from '../db/repo'
import type { FetchFn, Person, Who } from './client'
import { addTaker, get, loadGas, type Gas } from './gasMock'
import { ackOps, canWriteGame, conflictsOf, discardChanges, ownership, pendingOps, pull, pullAndRetry, pushChanges, type Env } from './remote'

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfyc_shared/exec'
const T = { video_time: null, time_source: 'none' as const }
const ev = (type: 'catch' | 'goal' | 'throwaway', actor: string | null, receiver: string | null = null) => ({ type, team: 'us' as const, actor_id: actor, receiver_id: receiver, defender_id: null, tags: [] })

function viaGas(gas: Gas): FetchFn {
  return async (url, init) => {
    if ((init.method ?? 'GET') === 'GET') return new Response(JSON.stringify(get(gas, Object.fromEntries(new URL(url).searchParams))))
    return new Response(gas.doPost({ postData: { contents: init.body as string } }).text)
  }
}

function device(gas: Gas, key: string) {
  const db = new StatsDB(`dev-${crypto.randomUUID()}`)
  const repo = new Repo(db)
  const actions = new Actions(repo)
  let me: Who | null = null
  let people: Person[] = []
  const env: Env = { db, fetchFn: viaGas(gas), cfg: { url: SCRIPT_URL, token: key, auto: true }, who: { get: () => me, set: (w) => (me = w), people: (p) => (people = p) } }
  return {
    db, repo, actions, env,
    get me() { return me },
    get people() { return people },
    /** What the sync engine does: push pending ops, acknowledge what was accepted. */
    async push(full = false) {
      const ops = await pendingOps(db)
      const acked = await pushChanges(env, ops, full)
      await ackOps(db, acked)
      return { sent: ops.length, acked: acked.length }
    },
    pull: () => pull(env),
    remote: (id: string) => db.remote.get(id),
    canWrite: async (id: string) => canWriteGame(await db.remote.get(id), me),
  }
}

async function newGame(d: ReturnType<typeof device>, opponent: string, players: string[]) {
  const g = await d.actions.createGame({ opponent, ratio_first: 'W4', start_on: 'O' })
  const p = await d.actions.startPoint(g.id, { line: players })
  await d.actions.addEvent(p.id, ev('catch', players[0], players[1]), T)
  return { game: g, point: p }
}

describe('two devices, one script', () => {
  it('admin and a stat-taker share games, roster and ownership', async () => {
    const gas = loadGas()
    gas.setup()
    const adminKey = gas.logs.at(-1)!
    gas.setAdminName('Jacob')
    const sam = addTaker(gas, 'Sam')

    // Jacob: roster + a game, pushed. He owns it.
    const jacob = device(gas, adminKey)
    await jacob.actions.ensureTeam()
    const team = (await jacob.db.teams.toArray())[0]
    const ava = await jacob.repo.create('players', { team_id: team.id, name: 'Ava', number: '7', gender_match: 'W' })
    const bo = await jacob.repo.create('players', { team_id: team.id, name: 'Bo', number: '12', gender_match: 'M' })
    const alpha = await newGame(jacob, 'Alpha', [ava.id, bo.id])
    await jacob.push(true)
    expect(jacob.me).toMatchObject({ role: 'admin', name: 'Jacob' })
    expect(await jacob.remote(alpha.game.id)).toMatchObject({ owner_id: 'admin', rev: 1 })
    expect(await jacob.db.syncQueue.count()).toBe(0)

    // Sam: fresh device (it made its own team on first run), pulls everything.
    const samDev = device(gas, sam.key)
    await samDev.actions.ensureTeam()
    const r = await samDev.pull()
    expect(r.games).toBe(1)
    expect(samDev.me).toMatchObject({ role: 'taker', name: 'Sam' })
    expect(samDev.people.map((p) => p.name)).toEqual(['Jacob', 'Sam'])
    expect((await samDev.db.teams.toArray()).map((t) => t.id)).toEqual([team.id]) // folded into the shared team
    expect((await samDev.db.games.get(alpha.game.id))!.opponent).toBe('Alpha')
    expect((await samDev.db.players.toArray()).map((p) => p.name).sort()).toEqual(['Ava', 'Bo'])
    expect(await samDev.db.syncQueue.count()).toBe(0) // pulled rows are never queued
    expect(await samDev.canWrite(alpha.game.id)).toBe(false) // Jacob's game: read only for Sam

    // Sam edits the roster (shared) and starts his own game.
    await samDev.repo.update('players', bo.id, { name: 'Bo B' }, { byHand: true })
    const bravo = await newGame(samDev, 'Bravo', [ava.id, bo.id])
    const pushed = await samDev.push()
    expect(pushed.acked).toBe(pushed.sent)
    expect(await samDev.remote(bravo.game.id)).toMatchObject({ owner_name: 'Sam', rev: 1 })
    // his player change did not touch Jacob's game (he can't write it)
    expect(gas.ss.getSheetByName('_Games')!.objects().find((x) => x.game_id === alpha.game.id)!.rev).toBe('1')

    // Jacob pulls: sees Sam's game and the renamed player; Bravo is read only for him.
    await jacob.pull()
    expect((await jacob.db.games.get(bravo.game.id))!.opponent).toBe('Bravo')
    expect((await jacob.db.players.get(bo.id))!.name).toBe('Bo B')
    expect(await jacob.canWrite(bravo.game.id)).toBe(false)

    // Sam deletes a player (soft): kept, flagged, still named in old games; Jacob restores it.
    await samDev.repo.softDelete('players', ava.id)
    await samDev.push()
    await jacob.pull()
    expect((await jacob.db.players.get(ava.id))!.deleted).toBe(true)
    await jacob.repo.restore('players', ava.id)
    await jacob.push()
    await samDev.pull()
    expect((await samDev.db.players.get(ava.id))!.deleted).toBe(false)

    // Jacob tries to edit Sam's game anyway (say, offline before his pull): held as a conflict, not lost.
    await jacob.actions.addEvent(bravo.point.id, ev('throwaway', bo.id), T)
    const j = await jacob.push()
    expect(j.acked).toBe(j.sent - 1)
    const held = await conflictsOf(jacob.db, bravo.game.id)
    expect(held).toHaveLength(1)
    expect(held[0].last_error).toBe('conflict:not_owner:Sam')
    expect(await pendingOps(jacob.db)).toHaveLength(0) // not retried in a loop
    // Admin takes the game, and the held change goes through.
    await ownership(jacob.env, 'claim', bravo.game.id)
    await jacob.push()
    expect(await jacob.db.syncQueue.count()).toBe(0)
    expect(await jacob.remote(bravo.game.id)).toMatchObject({ owner_id: 'admin', rev: 3 }) // Sam pushed it twice, then Jacob once
    expect(gas.ss.getSheetByName('Events')!.objects().filter((e) => e.game_id === bravo.game.id && e.type === 'throwaway')[0]).toMatchObject({ edited_by: 'Jacob' })

    // Sam's now-stale edit to Bravo is held; Discard takes Jacob's copy.
    await samDev.actions.addEvent(bravo.point.id, ev('goal', ava.id, bo.id), T)
    await samDev.push()
    expect((await conflictsOf(samDev.db, bravo.game.id))[0].last_error).toBe('conflict:not_owner:Jacob')
    await discardChanges(samDev.env, bravo.game.id)
    const evs = (await samDev.db.events.where('game_id').equals(bravo.game.id).toArray()).filter((e) => !e.deleted)
    expect(evs.map((e) => e.type).sort()).toEqual(['catch', 'throwaway'])
    expect(await samDev.db.syncQueue.count()).toBe(0)

    // Team view still works and shows everyone's games.
    expect(get(gas, { action: 'snapshot' }).games.map((g: { opponent: string }) => g.opponent).sort()).toEqual(['Alpha', 'Bravo'])
  })

  it('one key on two devices: a stale copy is held, Pull and retry merges both by record', async () => {
    const gas = loadGas()
    gas.setup()
    const sam = addTaker(gas, 'Sam')
    const laptop = device(gas, sam.key)
    await laptop.actions.ensureTeam()
    const team = (await laptop.db.teams.toArray())[0]
    const a = await laptop.repo.create('players', { team_id: team.id, name: 'Ava', number: '7', gender_match: 'W' })
    const b = await laptop.repo.create('players', { team_id: team.id, name: 'Bo', number: '12', gender_match: 'M' })
    const g = await newGame(laptop, 'Charlie', [a.id, b.id])
    await laptop.push(true)

    const phone = device(gas, sam.key)
    await phone.pull()
    expect(await phone.canWrite(g.game.id)).toBe(true) // same person, same key

    // Both add a play to the same point; the laptop pushes first.
    await laptop.actions.addEvent(g.point.id, ev('catch', b.id, a.id), T)
    await laptop.push()
    await phone.actions.addEvent(g.point.id, ev('goal', a.id, b.id), T)
    await phone.push()
    const held = await conflictsOf(phone.db, g.game.id)
    expect(new Set(held.map((o) => o.last_error))).toEqual(new Set(['conflict:stale:Sam'])) // the event and its point

    // Pull and retry: the laptop's play comes in, the phone's stays, then both go up.
    await pullAndRetry(phone.env, g.game.id)
    await phone.push()
    expect(await phone.db.syncQueue.count()).toBe(0)
    await laptop.pull()
    const types = (await laptop.db.events.where('game_id').equals(g.game.id).toArray()).filter((e) => !e.deleted).map((e) => e.type)
    expect(types.sort()).toEqual(['catch', 'catch', 'goal'])
    expect(await laptop.remote(g.game.id)).toMatchObject({ rev: 3 })
  })

  it('upgrading: games Jacob pushed with the old script become his, and his first push goes through', async () => {
    const gas = loadGas()
    gas.setup()
    const adminKey = gas.logs.at(-1)!
    const jacob = device(gas, adminKey)
    await jacob.actions.ensureTeam()
    const team = (await jacob.db.teams.toArray())[0]
    const a = await jacob.repo.create('players', { team_id: team.id, name: 'Ava', number: '7', gender_match: 'W' })
    const g = await newGame(jacob, 'Echo', [a.id, a.id])
    // as the version 3 app did: no revs, no owners
    const ops = await pendingOps(jacob.db)
    const { buildPush } = await import('./payload')
    const [players, games, points, events] = await Promise.all([jacob.db.players.toArray(), jacob.db.games.toArray(), jacob.db.points.toArray(), jacob.db.events.toArray()])
    gas.doPost({ postData: { contents: JSON.stringify({ ...buildPush({ players, games, points, events }, ops, true), token: adminKey }) } })
    gas.ss.sheets = gas.ss.sheets.filter((s) => s.name !== '_Games') // the v3 sheet had no registry
    await jacob.db.syncQueue.clear()

    // the new app, before any pull: Push everything is accepted (no stale rejections)
    await jacob.actions.addEvent(g.point.id, ev('goal', a.id, a.id), T)
    const r = await jacob.push(true)
    expect(r.acked).toBe(r.sent)
    expect(await conflictsOf(jacob.db, g.game.id)).toHaveLength(0)
    expect(await jacob.remote(g.game.id)).toMatchObject({ owner_id: 'admin', rev: 2 })
  })

  it('released games can be claimed by a stat-taker; a revoked key can no longer push', async () => {
    const gas = loadGas()
    gas.setup()
    const adminKey = gas.logs.at(-1)!
    const kim = addTaker(gas, 'Kim')
    const jacob = device(gas, adminKey)
    await jacob.actions.ensureTeam()
    const team = (await jacob.db.teams.toArray())[0]
    const a = await jacob.repo.create('players', { team_id: team.id, name: 'Ava', number: '7', gender_match: 'W' })
    const g = await newGame(jacob, 'Delta', [a.id, a.id])
    await jacob.push(true)
    await ownership(jacob.env, 'release', g.game.id)

    const k = device(gas, kim.key)
    await k.pull()
    expect(await k.remote(g.game.id)).toMatchObject({ owner_id: '' })
    expect(await k.canWrite(g.game.id)).toBe(false) // unowned: claim first
    await ownership(k.env, 'claim', g.game.id)
    expect(await k.canWrite(g.game.id)).toBe(true)
    await k.actions.addEvent(g.point.id, ev('goal', a.id, a.id), T)
    await k.push()
    expect(await k.db.syncQueue.count()).toBe(0)

    gas.revokeStatTaker(kim.id)
    await k.actions.addEvent(g.point.id, ev('catch', a.id, a.id), T)
    await expect(k.push()).rejects.toThrow(/revoked/)
    expect(await k.db.syncQueue.count()).toBe(1) // kept locally, nothing lost
  })
})
