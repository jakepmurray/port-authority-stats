import type { SyncOp } from '../domain/schema'
import { SyncError } from './client'

export interface SyncConfig {
  url: string
  token: string
  /** Push automatically after edits. */
  auto: boolean
}

export type SyncStatus = 'unconfigured' | 'off' | 'idle' | 'pending' | 'syncing' | 'offline' | 'error'

export interface SyncState {
  status: SyncStatus
  pending: number
  lastSyncedAt: number | null
  lastError: string | null
  nextRetryAt: number | null
}

export interface EngineDeps {
  config: () => SyncConfig | null
  /** Queued row changes (one per row; the latest write wins). */
  pendingOps: () => Promise<SyncOp[]>
  /** Send the push for these ops; resolves when the script acknowledged it. */
  push: (cfg: SyncConfig, ops: SyncOp[], full: boolean) => Promise<void>
  /** Remove acknowledged ops (only those not rewritten since they were read). */
  ack: (ops: SyncOp[]) => Promise<void>
  online: () => boolean
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (t: unknown) => void
  saveLastSynced?: (t: number) => void
  lastSynced?: number | null
}

export const DEBOUNCE_MS = 5000
export const MAX_BACKOFF_MS = 5 * 60 * 1000
export const backoffMs = (attempt: number) => Math.min(DEBOUNCE_MS * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS)

/**
 * Sync loop: edits are debounced (5 s) and pushed while online; offline edits stay
 * queued and go out on reconnect; failures retry with exponential backoff (5 s … 5 min).
 * Only ops the script acknowledged are removed from the queue.
 */
export class SyncEngine {
  private d: EngineDeps
  private state: SyncState
  private listeners = new Set<() => void>()
  private timer: unknown = null
  private running = false
  private again = false
  private againFull = false
  private attempt = 0

  constructor(deps: EngineDeps) {
    this.d = deps
    this.state = { status: 'idle', pending: 0, lastSyncedAt: deps.lastSynced ?? null, lastError: null, nextRetryAt: null }
    this.state.status = this.baseStatus()
  }

  get = () => this.state
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  private set(p: Partial<SyncState>) {
    this.state = { ...this.state, ...p }
    this.listeners.forEach((f) => f())
  }

  private configured() {
    const c = this.d.config()
    return c && c.url.trim() && c.token.trim() ? c : null
  }
  private baseStatus(): SyncStatus {
    const c = this.configured()
    if (!c) return 'unconfigured'
    if (!this.d.online()) return 'offline'
    if (!c.auto) return 'off'
    return this.state.pending > 0 ? 'pending' : 'idle'
  }

  private schedule(ms: number) {
    if (this.timer !== null) this.d.clearTimer(this.timer)
    this.timer = this.d.setTimer(() => {
      this.timer = null
      void this.run(false)
    }, ms)
  }

  /** Call after every local write. */
  async notifyChange() {
    const ops = await this.d.pendingOps()
    this.set({ pending: ops.length })
    const c = this.configured()
    if (!c || !c.auto || !this.d.online() || ops.length === 0) {
      if (this.state.status !== 'error' && this.state.status !== 'syncing') this.set({ status: this.baseStatus() })
      return
    }
    if (this.state.status === 'error' && this.state.nextRetryAt) return // a backoff retry is already scheduled
    if (this.state.status !== 'syncing') this.set({ status: 'pending' })
    this.schedule(DEBOUNCE_MS)
  }

  /** Back online: push whatever queued up. */
  async onOnline() {
    this.attempt = 0
    this.set({ nextRetryAt: null })
    await this.notifyChange()
    if (this.configured()?.auto && this.state.pending > 0) this.schedule(500)
  }
  onOffline() {
    if (this.timer !== null) this.d.clearTimer(this.timer)
    this.timer = null
    if (this.state.status !== 'syncing') this.set({ status: this.baseStatus() })
  }
  /** Settings changed (URL, token or auto). */
  reconfigured() {
    this.attempt = 0
    this.set({ lastError: null, nextRetryAt: null, status: this.baseStatus() })
    void this.notifyChange()
  }

  /** Sync now (button). `full` re-sends everything. Resolves with the outcome. */
  syncNow(full = false) {
    if (this.timer !== null) this.d.clearTimer(this.timer)
    this.timer = null
    this.attempt = 0
    return this.run(full)
  }

  private async run(full: boolean): Promise<{ ok: boolean; error?: string }> {
    const c = this.configured()
    if (!c) {
      this.set({ status: 'unconfigured' })
      return { ok: false, error: 'Add the script URL and token in Settings first.' }
    }
    if (!this.d.online()) {
      this.set({ status: 'offline' })
      return { ok: false, error: 'Offline. Changes are queued and will sync when you are back online.' }
    }
    if (this.running) {
      this.again = true
      this.againFull ||= full
      return { ok: true }
    }
    this.running = true
    this.set({ status: 'syncing', nextRetryAt: null })
    let result: { ok: boolean; error?: string }
    try {
      const ops = await this.d.pendingOps()
      if (ops.length || full) await this.d.push(c, ops, full)
      await this.d.ack(ops)
      const left = (await this.d.pendingOps()).length
      const t = this.d.now()
      this.attempt = 0
      this.d.saveLastSynced?.(t)
      this.set({ lastSyncedAt: t, lastError: null, pending: left, status: 'idle' })
      this.set({ status: this.baseStatus() })
      if (left > 0 && c.auto) this.schedule(DEBOUNCE_MS)
      result = { ok: true }
    } catch (e) {
      const err = e instanceof SyncError ? e : null
      const msg = err ? err.message : (e as Error).message || 'Sync failed'
      const retry = err ? err.retryable : true
      this.attempt++
      const wait = backoffMs(this.attempt)
      if (retry && this.d.online()) {
        this.set({ status: 'error', lastError: msg, nextRetryAt: this.d.now() + wait })
        this.schedule(wait)
      } else this.set({ status: this.d.online() ? 'error' : 'offline', lastError: msg, nextRetryAt: null })
      result = { ok: false, error: msg }
    } finally {
      this.running = false
    }
    if (this.again) {
      const f = this.againFull
      this.again = false
      this.againFull = false
      return this.run(f)
    }
    return result
  }
}
