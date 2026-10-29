import { db } from '../db/db'
import { repo } from '../db/repo'
import type { SyncOp } from '../domain/schema'
import { callScript } from './client'
import { SyncEngine } from './engine'
import { buildPush, isEmptyPush } from './payload'
import { loadConfig, loadLastSynced, saveLastSynced } from './settings'

const stamp = (op: SyncOp) => (op.payload as { updated_at?: number } | null)?.updated_at ?? 0

/** The app's one sync engine, wired to IndexedDB and fetch. */
export const sync = new SyncEngine({
  config: loadConfig,
  pendingOps: () => db.syncQueue.toArray(),
  push: async (cfg, ops, full) => {
    const [teams, players, games, points, events] = await Promise.all([db.teams.toArray(), db.players.toArray(), db.games.toArray(), db.points.toArray(), db.events.toArray()])
    const body = buildPush({ teams, players, games, points, events }, ops, full)
    // Nothing for the Sheet (e.g. only team settings changed): still check the URL and token.
    await callScript((u, i) => fetch(u, i), cfg.url, cfg.token, isEmptyPush(body) ? { action: 'ping' } : (body as unknown as Record<string, unknown>))
  },
  // Remove only ops whose row was not written again while the push was in flight.
  ack: (ops) =>
    db.transaction('rw', db.syncQueue, async () => {
      const cur = await db.syncQueue.bulkGet(ops.map((o) => o.op_id))
      const done = ops.filter((o, i) => cur[i] && stamp(cur[i]!) === stamp(o)).map((o) => o.op_id)
      await db.syncQueue.bulkDelete(done)
    }),
  online: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  saveLastSynced: (t) => saveLastSynced(t),
  lastSynced: loadLastSynced(),
})

let started = false
/** Start listening for writes and connectivity. Called once by the app shell. */
export function startSync() {
  if (started || typeof window === 'undefined') return
  started = true
  repo.onWrite = () => void sync.notifyChange()
  window.addEventListener('online', () => void sync.onOnline())
  window.addEventListener('offline', () => sync.onOffline())
  void sync.notifyChange()
}
