import { db, TEAM_MODE } from '../db/db'
import { repo } from '../db/repo'
import { MiniStore } from '../ui/store'
import { SyncEngine } from './engine'
import { ackOps, discardChanges, ownership, pendingOps, pull, pullAndRetry, pushChanges, type Env, type OwnershipAction } from './remote'
import { fetchUsauRanks, type UsauDivision, type UsauFetch } from './client'
import { loadConfig, loadLastSynced, saveLastSynced } from './settings'

const browserFetch: Env['fetchFn'] = (u, i) => fetch(u, i)
const env = (cfg = loadConfig()): Env | null => (cfg && cfg.url.trim() && cfg.token.trim() ? { db, fetchFn: browserFetch, cfg } : null)

/** The app's one sync engine, wired to IndexedDB and fetch. */
export const sync = new SyncEngine({
  config: loadConfig,
  pendingOps: () => pendingOps(db),
  push: (cfg, ops, full) => pushChanges({ db, fetchFn: browserFetch, cfg }, ops, full),
  ack: (ops) => ackOps(db, ops),
  online: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  saveLastSynced: (t) => saveLastSynced(t),
  lastSynced: loadLastSynced(),
})

/** Pull state for the UI. */
export const pullState = new MiniStore<{ busy: boolean; at: number | null; error: string | null; note: string | null }>({ busy: false, at: null, error: null, note: null })

const guard = async <T,>(fn: (e: Env) => Promise<T>): Promise<T> => {
  const e = env()
  if (!e) throw new Error('Add the script URL and your key in Settings first.')
  return fn(e)
}

/** Pull everyone's games into this device (keeps your unsent changes). */
export async function pullNow() {
  if (pullState.get().busy) return
  pullState.set({ busy: true, error: null })
  try {
    const r = await guard(pull)
    pullState.set({ busy: false, at: Date.now(), note: `Pulled ${r.games} game${r.games === 1 ? '' : 's'}${r.kept ? ` (kept your unsent changes in ${r.kept})` : ''}.` })
  } catch (e) {
    pullState.set({ busy: false, error: (e as Error).message })
  }
}

export async function changeOwner(action: OwnershipAction, gameId: string, toId?: string) {
  const g = await guard((e) => ownership(e, action, gameId, toId))
  void sync.notifyChange()
  return g
}
export async function retryGame(gameId: string) {
  await guard((e) => pullAndRetry(e, gameId))
  return sync.syncNow()
}
export async function discardGame(gameId: string) {
  await guard((e) => discardChanges(e, gameId))
  void sync.notifyChange()
}

let started = false
/** Start listening for writes and connectivity. Called once by the app shell. */
export function startSync() {
  if (started || typeof window === 'undefined' || TEAM_MODE) return
  started = true
  repo.onWrite = () => void sync.notifyChange()
  window.addEventListener('online', () => void sync.onOnline())
  window.addEventListener('offline', () => sync.onOffline())
  // Bring in everyone's latest games first (needs script v4; older scripts just say so).
  if (env() && navigator.onLine) void pullNow().finally(() => void sync.notifyChange())
  else void sync.notifyChange()
}

/** "Fetch ranks": the Sheet script reads USAU's current club rankings (needs sync set up, script v6). */
export async function fetchUsau(division: UsauDivision = 'Mixed'): Promise<UsauFetch> {
  const cfg = loadConfig()
  if (!cfg || !cfg.url.trim() || !cfg.token.trim()) throw new Error('Fetch ranks goes through your Sheet script, so it needs Sheet sync set up first (Settings: script URL and your key).')
  return fetchUsauRanks(browserFetch, cfg.url.trim(), cfg.token.trim(), division)
}
