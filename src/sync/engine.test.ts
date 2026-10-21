import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncOp } from '../domain/schema'
import { SyncError } from './client'
import { backoffMs, DEBOUNCE_MS, SyncEngine, type EngineDeps, type SyncConfig } from './engine'

const op = (id: string, t = 1): SyncOp => ({ op_id: `events:${id}`, table: 'events', row_id: id, payload: { id, updated_at: t }, attempts: 0, last_error: null })

function rig(cfg: SyncConfig | null = { url: 'https://x/exec', token: 't', auto: true }) {
  let queue: SyncOp[] = []
  let online = true
  const pushes: { ops: string[]; full: boolean }[] = []
  let fail: Error | null = null
  const deps: EngineDeps = {
    config: () => cfg,
    pendingOps: async () => [...queue],
    push: vi.fn(async (_c: SyncConfig, ops: SyncOp[], full: boolean) => {
      pushes.push({ ops: ops.map((o) => o.row_id), full })
      if (fail) throw fail
    }),
    ack: async (ops) => {
      queue = queue.filter((q) => !ops.some((o) => o.op_id === q.op_id && (o.payload as { updated_at: number }).updated_at === (q.payload as { updated_at: number }).updated_at))
    },
    online: () => online,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  }
  const engine = new SyncEngine(deps)
  return {
    engine, pushes,
    write: async (...ops: SyncOp[]) => {
      for (const o of ops) queue = [...queue.filter((q) => q.op_id !== o.op_id), o]
      await engine.notifyChange()
    },
    queue: () => queue,
    setOnline: (v: boolean) => (online = v),
    setFail: (e: Error | null) => (fail = e),
  }
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms)

describe('SyncEngine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces a burst of edits into one push, then clears the queue', async () => {
    const r = rig()
    await r.write(op('a'))
    await tick(2000)
    await r.write(op('b'))
    await tick(2000)
    await r.write(op('a', 2))
    expect(r.engine.get().status).toBe('pending')
    expect(r.pushes).toHaveLength(0)
    await tick(DEBOUNCE_MS)
    expect(r.pushes).toEqual([{ ops: ['b', 'a'], full: false }])
    expect(r.queue()).toEqual([])
    expect(r.engine.get()).toMatchObject({ status: 'idle', pending: 0, lastError: null })
    expect(r.engine.get().lastSyncedAt).not.toBeNull()
  })

  it('keeps a row edited during the push queued for the next push', async () => {
    const r = rig()
    let release!: () => void
    const first = new Promise<void>((res) => (release = res))
    const push = vi.fn(async () => first)
    ;(r.engine as unknown as { d: EngineDeps }).d.push = push
    await r.write(op('a', 1))
    await tick(DEBOUNCE_MS)
    expect(r.engine.get().status).toBe('syncing')
    await r.write(op('a', 2)) // edited while in flight
    release()
    await tick(0)
    expect(r.queue().map((q) => (q.payload as { updated_at: number }).updated_at)).toEqual([2])
    await tick(DEBOUNCE_MS)
    expect(push).toHaveBeenCalledTimes(2)
    expect(r.queue()).toEqual([])
  })

  it('queues while offline and pushes on reconnect', async () => {
    const r = rig()
    r.setOnline(false)
    await r.write(op('a'))
    await tick(DEBOUNCE_MS * 3)
    expect(r.pushes).toHaveLength(0)
    expect(r.engine.get()).toMatchObject({ status: 'offline', pending: 1 })
    r.setOnline(true)
    await r.engine.onOnline()
    await tick(1000)
    expect(r.pushes).toHaveLength(1)
    expect(r.engine.get().status).toBe('idle')
  })

  it('retries network errors with exponential backoff', async () => {
    const r = rig()
    r.setFail(new SyncError({ kind: 'unreachable', message: 'down' }))
    await r.write(op('a'))
    await tick(DEBOUNCE_MS)
    expect(r.engine.get()).toMatchObject({ status: 'error', lastError: 'down' })
    expect(r.pushes).toHaveLength(1)
    await tick(backoffMs(1))
    expect(r.pushes).toHaveLength(2)
    await tick(backoffMs(2) - 1)
    expect(r.pushes).toHaveLength(2)
    r.setFail(null)
    await tick(1)
    expect(r.pushes).toHaveLength(3)
    expect(r.engine.get()).toMatchObject({ status: 'idle', lastError: null, pending: 0 })
    expect(backoffMs(20)).toBe(5 * 60 * 1000)
  })

  it('does not auto-retry a rejected token; the queue is kept', async () => {
    const r = rig()
    r.setFail(new SyncError({ kind: 'script', error: 'bad_token', message: 'Token rejected' }))
    await r.write(op('a'))
    await tick(DEBOUNCE_MS)
    await tick(MAX)
    expect(r.pushes).toHaveLength(1)
    expect(r.engine.get()).toMatchObject({ status: 'error', nextRetryAt: null, pending: 1 })
    expect(r.queue()).toHaveLength(1)
  })

  it('manual mode and unconfigured: no auto push; Sync now works / explains', async () => {
    const manual = rig({ url: 'https://x/exec', token: 't', auto: false })
    await manual.write(op('a'))
    await tick(DEBOUNCE_MS * 2)
    expect(manual.pushes).toHaveLength(0)
    expect(manual.engine.get().status).toBe('off')
    expect(await manual.engine.syncNow()).toEqual({ ok: true })
    expect(manual.pushes).toHaveLength(1)
    expect(await manual.engine.syncNow(true)).toEqual({ ok: true })
    expect(manual.pushes.at(-1)).toEqual({ ops: [], full: true })

    const none = rig(null)
    await none.write(op('a'))
    expect(none.engine.get().status).toBe('unconfigured')
    expect((await none.engine.syncNow()).ok).toBe(false)
    expect(none.pushes).toHaveLength(0)
  })
})

const MAX = 10 * 60 * 1000
