/**
 * Shared editing (script v4): push with ownership and revs, pull and merge into the
 * real local database, claim / release / reassign, and conflict handling.
 * Every function takes the database and fetch, so two "devices" can be tested
 * against one mock script.
 */
import type { StatsDB } from '../db/db'
import type { SyncOp } from '../domain/schema'
import { callScript, type FetchFn, type Person, type Rejection, type RemoteGame, type ScriptOk, type Who } from './client'
import type { SyncConfig } from './engine'
import { loadWho, savePeople, saveWho } from './identity'
import { buildPush, isEmptyPush, opGame } from './payload'
import { parseSnapshot } from './snapshot'

export interface Env {
  db: StatsDB
  fetchFn: FetchFn
  cfg: SyncConfig
  /** Where "who am I" is remembered (defaults to this browser's localStorage). */
  who?: { get: () => Who | null; set: (w: Who) => void; people?: (p: Person[]) => void }
}

const CONFLICT = 'conflict:'
export const isConflict = (op: SyncOp) => typeof op.last_error === 'string' && op.last_error.startsWith(CONFLICT)
export const conflictReason = (op: SyncOp) => (isConflict(op) ? (op.last_error!.slice(CONFLICT.length).split(':')[0] as Rejection['reason']) : null)

const whoOf = (env: Env) => env.who ?? { get: () => loadWho(), set: (w: Who) => saveWho(w), people: (p: Person[]) => savePeople(p) }
const remember = (env: Env, r: ScriptOk) => {
  if (r.who) whoOf(env).set(r.who)
  if (r.people) whoOf(env).people?.(r.people)
}
const call = async (env: Env, body: Record<string, unknown>) => {
  const r = await callScript(env.fetchFn, env.cfg.url, env.cfg.token, body)
  remember(env, r)
  return r
}

/** Can this device write the game? Unknown to the script (new here) or owned by me. */
export function canWriteGame(remote: RemoteGame | undefined, me: Who | null) {
  if (!remote || !me) return true
  return remote.owner_id === me.id
}

/** Queued ops that are waiting to be pushed (conflicts wait for the person to decide). */
export const pendingOps = async (db: StatsDB) => (await db.syncQueue.toArray()).filter((o) => !isConflict(o))

const stamp = (op: SyncOp) => (op.payload as { updated_at?: number } | null)?.updated_at ?? 0

/** Remove acknowledged ops, unless the row was written again while the push was in flight. */
export const ackOps = (db: StatsDB, ops: SyncOp[]) =>
  db.transaction('rw', db.syncQueue, async () => {
    const cur = await db.syncQueue.bulkGet(ops.map((o) => o.op_id))
    const done = ops.filter((o, i) => cur[i] && stamp(cur[i]!) === stamp(o) && !isConflict(cur[i]!)).map((o) => o.op_id)
    await db.syncQueue.bulkDelete(done)
  })

/**
 * One push. Returns the ops to acknowledge: everything except the ops of games the
 * script rejected, which stay queued and are marked as conflicts.
 */
export async function pushChanges(env: Env, ops: SyncOp[], full: boolean): Promise<SyncOp[]> {
  const { db } = env
  const [teams, players, games, points, events, remote, opponents] = await Promise.all([
    db.teams.toArray(), db.players.toArray(), db.games.toArray(), db.points.toArray(), db.events.toArray(), db.remote.toArray(), db.opponents.toArray(),
  ])
  const me = whoOf(env).get()
  const byGame = new Map(remote.map((r) => [r.game_id, r]))
  const body = buildPush({ teams, players, games, points, events, opponents }, ops, full, {
    canWrite: (id) => canWriteGame(byGame.get(id), me),
    bases: Object.fromEntries(remote.map((r) => [r.game_id, r.rev])),
  })
  // Nothing for the Sheet (e.g. only team settings changed): still check the URL and key.
  const r = await call(env, isEmptyPush(body) ? { action: 'ping' } : (body as unknown as Record<string, unknown>))
  if (r.games) await db.remote.bulkPut(Object.values(r.games))
  const rejected = new Map((r.rejected ?? []).map((x) => [x.game_id, x]))
  if (rejected.size) {
    // The script also tells us who owns games we merely swept in: remember that.
    for (const x of rejected.values()) {
      const cur = byGame.get(x.game_id)
      if (x.reason !== 'stale') await db.remote.put({ ...(cur ?? { updated_by: '', updated_at: '', deleted: false }), game_id: x.game_id, owner_id: x.owner_id, owner_name: x.owner_name, rev: x.rev })
    }
    const pointGame = new Map(points.map((p) => [p.id, p.game_id]))
    const held = ops.filter((o) => {
      const g = opGame(o, pointGame)
      return g !== undefined && rejected.has(g)
    })
    await db.transaction('rw', db.syncQueue, async () => {
      for (const o of held) {
        const x = rejected.get(opGame(o, pointGame)!)!
        await db.syncQueue.update(o.op_id, { last_error: `${CONFLICT}${x.reason}:${x.owner_name}` })
      }
    })
    const heldIds = new Set(held.map((o) => o.op_id))
    return ops.filter((o) => !heldIds.has(o.op_id))
  }
  return ops
}

export interface PullResult {
  games: number
  players: number
  opponents: number
  kept: number
}

/**
 * Pull everyone's data and merge it into this device's real database, by record id.
 * - A row with a queued local change is kept (it goes out with the next push).
 * - Otherwise the script's copy wins; a row the script no longer has was deleted
 *   elsewhere and is marked deleted here. Players: the newer updated_at wins.
 * - Pulled rows are written straight to the database, so they are never queued.
 * - Local-only games (not pushed yet) are left alone.
 */
export async function pull(env: Env): Promise<PullResult> {
  const r = await call(env, { action: 'pull' })
  const snap = parseSnapshot(r)
  const registry = r.registry ?? []
  return mergePull(env.db, snap, registry)
}

export async function mergePull(db: StatsDB, snap: ReturnType<typeof parseSnapshot>, registry: RemoteGame[]): Promise<PullResult> {
  const res: PullResult = { games: 0, players: 0, opponents: 0, kept: 0 }
  await db.transaction('rw', [db.teams, db.players, db.games, db.points, db.events, db.opponents, db.syncQueue, db.remote], async () => {
    const queue = await db.syncQueue.toArray()
    const pending = new Set(queue.map((o) => o.op_id))
    const localPoints = await db.points.toArray()
    const pointGame = new Map(localPoints.map((p) => [p.id, p.game_id]))
    const pendingGames = new Set(queue.map((o) => opGame(o, pointGame)).filter((g): g is string => !!g))

    // Team: one shared team. A team made on this device before its first pull is folded into the shared one.
    if (snap.teams.length) {
      const shared = snap.teams[0]
      for (const t of snap.teams) {
        const cur = await db.teams.get(t.id)
        if (!pending.has(`teams:${t.id}`) && (!cur || t.updated_at >= cur.updated_at)) await db.teams.put(t)
      }
      const ids = new Set(snap.teams.map((t) => t.id))
      for (const t of await db.teams.toArray()) {
        if (ids.has(t.id)) continue
        await db.games.where('team_id').equals(t.id).modify({ team_id: shared.id })
        await db.players.where('team_id').equals(t.id).modify({ team_id: shared.id })
        await db.teams.delete(t.id)
        await db.syncQueue.delete(`teams:${t.id}`)
      }
    }

    for (const p of snap.players) {
      const cur = await db.players.get(p.id)
      if (pending.has(`players:${p.id}`)) continue
      if (!cur || p.updated_at >= cur.updated_at) {
        await db.players.put(p)
        res.players++
      }
    }

    // Opponent ranks: shared like players (the newer edit wins; my unsent edit stays).
    for (const o of snap.opponents) {
      const cur = await db.opponents.get(o.id)
      if (pending.has(`opponents:${o.id}`)) continue
      if (!cur || o.updated_at >= cur.updated_at) {
        await db.opponents.put(o)
        res.opponents++
      }
    }

    const serverGames = new Set(snap.games.map((g) => g.id))
    for (const g of snap.games) {
      res.games++
      if (pendingGames.has(g.id)) res.kept++
      if (!pending.has(`games:${g.id}`)) await db.games.put(g)
      for (const [table, rows] of [['points', snap.points.filter((p) => p.game_id === g.id)], ['events', snap.events.filter((e) => e.game_id === g.id)]] as const) {
        const t = db.table(table)
        const theirs = new Map(rows.map((x) => [x.id, x]))
        const mine = (await t.where('game_id').equals(g.id).toArray()) as { id: string; deleted: boolean }[]
        for (const x of rows) if (!pending.has(`${table}:${x.id}`)) await t.put(x)
        for (const x of mine) if (!theirs.has(x.id) && !x.deleted && !pending.has(`${table}:${x.id}`)) await t.put({ ...x, deleted: true })
      }
    }
    // Games deleted elsewhere.
    for (const reg of registry) {
      if (!reg.deleted || serverGames.has(reg.game_id) || pendingGames.has(reg.game_id)) continue
      const cur = await db.games.get(reg.game_id)
      if (cur && !cur.deleted) await db.games.put({ ...cur, deleted: true })
    }
    await db.remote.clear()
    await db.remote.bulkPut(registry)
  })
  return res
}

export type OwnershipAction = 'claim' | 'release' | 'reassign'

/** Claim, release or (admin) reassign a game; on a successful claim, held changes are retried. */
export async function ownership(env: Env, action: OwnershipAction, gameId: string, toId?: string): Promise<RemoteGame> {
  const r = await call(env, { action, game_id: gameId, ...(toId ? { to_id: toId } : {}) })
  if (r.game) await env.db.remote.put(r.game)
  if (action === 'claim') await releaseConflicts(env.db, gameId)
  return r.game!
}

/** Ops of one game that are held as conflicts. */
export async function conflictsOf(db: StatsDB, gameId: string) {
  const [queue, points] = await Promise.all([db.syncQueue.toArray(), db.points.toArray()])
  const pointGame = new Map(points.map((p) => [p.id, p.game_id]))
  return queue.filter((o) => isConflict(o) && opGame(o, pointGame) === gameId)
}

/** Put a game's held changes back in line for the next push. */
export async function releaseConflicts(db: StatsDB, gameId: string) {
  const held = await conflictsOf(db, gameId)
  await db.transaction('rw', db.syncQueue, async () => {
    for (const o of held) await db.syncQueue.update(o.op_id, { last_error: null })
  })
  return held.length
}

/** "Pull and retry": merge the latest copy (my queued changes stay), then queue my changes again. */
export async function pullAndRetry(env: Env, gameId: string) {
  await pull(env)
  return releaseConflicts(env.db, gameId)
}

/** "Discard my changes": drop the held changes and take the script's copy. */
export async function discardChanges(env: Env, gameId: string) {
  const held = await conflictsOf(env.db, gameId)
  await env.db.syncQueue.bulkDelete(held.map((o) => o.op_id))
  await pull(env)
  return held.length
}
