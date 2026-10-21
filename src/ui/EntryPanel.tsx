import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TimeStamp } from '../db/actions'
import { buildEvent, HOTKEYS, slotsFor, type Command, type CommandKind, type EntryMode, type EventDraft } from '../domain/entry'
import { replayPoint, type PointInfo } from '../domain/game'
import { resolveNumber } from '../domain/keys'
import type { Game, GameEvent, Player } from '../domain/schema'
import { Btn } from './kit'
import { EVENT_LABEL, playerLabel } from './labels'
import { MiniStore } from './store'
import type { VideoController } from './video/controller'

interface Pending {
  kind: CommandKind
  slots: string[]
  filled: (string | null)[]
  time: TimeStamp
  extra?: Partial<Command>
}

const SLOT_LABEL: Record<string, string> = {
  player: 'Player', scorer: 'Scorer', thrower: 'Thrower / assist', receiver: 'Receiver', defender: 'Defender',
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

/**
 * Keyboard-first stat entry for the current point. Type a jersey number to
 * record a catch (the thrower is the previous holder), or a letter for an
 * action (G goal, T throwaway, D drop, B block, C Callahan, S stall, X other, P pull).
 */
export function EntryPanel({
  game,
  current,
  players,
  mode,
  stamp,
  video,
  onEvent,
  onUndo,
}: {
  game: Game
  current: PointInfo
  players: Player[]
  mode: EntryMode
  stamp: () => TimeStamp
  video: VideoController | null
  onEvent: (d: EventDraft & { note?: string; id?: string }, t: TimeStamp) => Promise<void>
  onUndo: () => Promise<void>
}) {
  // Entry state lives in a ref so fast typing never reads a stale render.
  const [store] = useState(
    () => new MiniStore<{ buffer: string; bufferTime: TimeStamp | null; pending: Pending | null; optimistic: GameEvent[] }>({
      buffer: '',
      bufferTime: null,
      pending: null,
      optimistic: [],
    }),
  )
  const snap = useSyncExternalStore(store.subscribe, store.get)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const waitTimer = useRef<number | null>(null)

  const byId = new Map(players.map((p) => [p.id, p]))
  const lineSet = new Set(current.point.line)
  const linePlayers = current.point.line.map((id) => byId.get(id)).filter((p): p is Player => !!p)
  const candidates = (linePlayers.length ? linePlayers : players.filter((p) => !p.deleted && p.active)).map((p) => ({ id: p.id, number: p.number }))
  const allNumbers = players.filter((p) => !p.deleted).map((p) => ({ id: p.id, number: p.number }))

  // Drop optimistic events once they are in the database.
  const merge = (saved: GameEvent[], opt: GameEvent[]) => {
    const known = new Set(saved.map((e) => e.id))
    return [...saved, ...opt.filter((e) => !known.has(e.id))]
  }
  // Handlers read the latest saved events through a ref (never a stale render).
  const saved = useRef(current.events)
  const eventsNow = () => merge(saved.current, store.get().optimistic)
  const stateNow = () => replayPoint(current.point.start_on, eventsNow())
  const st = replayPoint(current.point.start_on, merge(current.events, snap.optimistic))
  useEffect(() => {
    saved.current = current.events
    const known = new Set(current.events.map((e) => e.id))
    const opt = store.get().optimistic
    if (opt.some((e) => known.has(e.id))) store.set({ optimistic: opt.filter((e) => !known.has(e.id)) })
  }, [current.events, store])

  const say = (text: string, bad = false) => setMsg({ text, bad })
  const queue = (fn: () => Promise<unknown>) => {
    chain.current = chain.current.then(fn).catch((e: Error) => say(e.message, true))
    return chain.current
  }

  const record = (draft: EventDraft & { note?: string }, time: TimeStamp) => {
    const id = crypto.randomUUID()
    const seq = (eventsNow().at(-1)?.seq ?? 0) + 1
    const now = Date.now()
    store.set({ optimistic: [
      ...store.get().optimistic,
      { id, game_id: game.id, point_id: current.point.id, possession_id: null, seq, x: null, y: null, x_end: null, y_end: null,
        video_time: time.video_time, time_source: time.time_source, wall_time: now, source: 'film', confidence: null,
        suggested_player_ids: [], corrected: false, note: '', created_at: now, updated_at: now, edited_at: null, deleted: false, ...draft },
    ] })
    void queue(() => onEvent({ ...draft, id }, time))
  }

  const commit = (cmd: Command, time: TimeStamp) => {
    const r = buildEvent(cmd, stateNow())
    if (!r.ok) return say(r.error, true)
    record(r.event, time)
    const who = r.event.receiver_id ?? r.event.defender_id ?? r.event.actor_id
    say(`${EVENT_LABEL[r.event.type]}${who ? ` · ${playerLabel(byId.get(who))}` : ''}${r.event.team === 'them' ? ` · ${game.opponent}` : ''}`)
  }

  const clearBuffer = () => {
    store.set({ buffer: '' })
    store.set({ bufferTime: null })
    if (waitTimer.current) window.clearTimeout(waitTimer.current)
    waitTimer.current = null
  }

  const start = (kind: CommandKind, extra?: Partial<Command>) => {
    // A half-typed number ("2" while #23 exists) is taken as-is before the action.
    const buf = store.get().buffer
    if (buf) {
      const r = resolveNumber(buf, candidates)
      const id = r.status === 'match' ? r.id : r.status === 'wait' ? r.exact : null
      if (id) fill(id)
    }
    const time = store.get().bufferTime ?? stamp()
    clearBuffer()
    const slots = slotsFor(kind, mode, stateNow())
    if (slots.length === 0) {
      store.set({ pending: null })
      commit({ kind, ...extra } as Command, time)
    } else store.set({ pending: { kind, slots, filled: [], time, extra } })
  }

  const fill = (id: string | null) => {
    const time = store.get().bufferTime
    clearBuffer()
    const pending = store.get().pending
    if (!pending) {
      if (!id) return
      if (mode === 'quick') return say('Quick mode: press an action first (G, T, B…)', true)
      return commit({ kind: 'touch', player: id }, time ?? stamp())
    }
    const filled = [...pending.filled, id]
    if (filled.length < pending.slots.length) {
      store.set({ pending: { ...pending, filled } })
      return
    }
    const args: Record<string, string | null> = {}
    pending.slots.forEach((s, i) => (args[s] = filled[i]))
    store.set({ pending: null })
    commit({ kind: pending.kind, ...pending.extra, ...args } as Command, pending.time)
  }

  const typeDigit = (d: string) => {
    const next = store.get().buffer + d
    if (!store.get().buffer) store.set({ bufferTime: store.get().pending?.time ?? stamp() })
    let r = resolveNumber(next, candidates)
    if (r.status === 'none') r = resolveNumber(next, allNumbers)
    if (waitTimer.current) window.clearTimeout(waitTimer.current)
    if (r.status === 'match') {
      if (!lineSet.has(r.id) && linePlayers.length) say(`${playerLabel(byId.get(r.id))} is not on this point's line`, true)
      fill(r.id)
    } else if (r.status === 'wait') {
      store.set({ buffer: next })
      // "1" with #1 and #12 on the line: pause briefly, then take #1.
      if (r.exact) {
        const exact = r.exact
        waitTimer.current = window.setTimeout(() => store.get().buffer === next && h.current.fill(exact), 900)
      }
    } else {
      clearBuffer()
      say(`No player #${next}`, true)
    }
  }

  const enter = () => {
    const buffer = store.get().buffer
    if (buffer) {
      const r = resolveNumber(buffer, candidates)
      const id = r.status === 'match' ? r.id : r.status === 'wait' ? r.exact : null
      if (id) fill(id)
      else {
        clearBuffer()
        say(`No player #${buffer}`, true)
      }
    } else if (store.get().pending) fill(null) // skip slot: unknown player
  }

  const cancel = () => {
    store.set({ pending: null })
    clearBuffer()
  }

  const undo = () => {
    cancel()
    const opt = store.get().optimistic
    void queue(onUndo)
    if (opt.length) store.set({ optimistic: opt.slice(0, -1) })
  }

  // Keep the latest handlers for the window listener.
  const h = useRef({ typeDigit, enter, start, fill, undo, cancel, video })
  useEffect(() => {
    h.current = { typeDigit, enter, start, fill, undo, cancel, video }
  })
  useEffect(() => () => {
    if (waitTimer.current) window.clearTimeout(waitTimer.current)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const c = h.current
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        return c.undo()
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key
      // Enter/Space must not also "click" a focused button (e.g. a player tile).
      if ((k === 'Enter' || k === ' ') && e.target instanceof HTMLButtonElement) e.preventDefault()
      if (/^\d$/.test(k)) return c.typeDigit(k)
      if (k === 'Enter') return c.enter()
      if (k === 'Escape') return c.cancel()
      if (k === '-') return c.fill(null)
      if (k === 'Backspace') {
        e.preventDefault()
        if (store.get().buffer) return store.set({ buffer: store.get().buffer.slice(0, -1) })
        if (store.get().pending) return c.cancel()
        return c.undo()
      }
      if (k === 'u' || k === 'U') return c.undo()
      if (k === ' ' && c.video) {
        e.preventDefault()
        return c.video.toggle()
      }
      if (k === 'ArrowLeft' && c.video) return c.video.nudge(e.shiftKey ? -1 : -5)
      if (k === 'ArrowRight' && c.video) return c.video.nudge(e.shiftKey ? 1 : 5)
      if (k === '[' && c.video) return c.video.setRate(0.5)
      if (k === ']' && c.video) return c.video.setRate(1)
      const hk = HOTKEYS.find((x) => x.key === k.toLowerCase())
      if (hk) {
        e.preventDefault()
        c.start(hk.kind, hk.kind === 'pull' ? { puller: current.point.pulled_by, result: 'in' } : undefined)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current.point.pulled_by, store])

  const { buffer, pending } = snap

  const holder = st.holder ? byId.get(st.holder) : null
  const promptText = pending
    ? `${HOTKEYS.find((x) => x.kind === pending.kind)?.label ?? pending.kind}: ${SLOT_LABEL[pending.slots[pending.filled.length]]} #${buffer}▌`
    : buffer
      ? `#${buffer}▌ (Enter)`
      : mode === 'full'
        ? st.offense === 'us'
          ? 'Type the next receiver’s number, or an action key'
          : 'Their disc: T/D/S for their turnover, B + number for our block, G for their goal'
        : 'Quick: G goal · T/D/S turn · B block · C Callahan'

  const act = (kind: CommandKind, label: string, key?: string, extra?: Partial<Command>, tone: 'default' | 'good' | 'bad' = 'default') => (
    <Btn key={label} tone={tone} onClick={() => start(kind, extra)} title={key ? `Key: ${key.toUpperCase()}` : undefined}>
      {label}
      {key && <kbd className="ml-1 rounded bg-black/30 px-1 text-[10px] text-slate-300">{key.toUpperCase()}</kbd>}
    </Btn>
  )
  const pullTime = merge(current.events, snap.optimistic).some((e) => e.type === 'pull')

  return (
    <div className="flex flex-col gap-2">
      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${st.offense === 'us' ? 'bg-emerald-950/60 text-emerald-200' : 'bg-rose-950/60 text-rose-200'}`}>
        <span className="font-semibold">{st.offense === 'us' ? 'Our disc' : `${game.opponent}’s disc`}</span>
        {holder && <span>· {playerLabel(holder)} has it</span>}
        <span className="ml-auto text-xs opacity-70">
          Point {current.point.idx} · {current.point.start_on} · {current.point.ratio}
        </span>
      </div>
      <div className="min-h-9 rounded-lg border border-slate-800 bg-black/40 px-3 py-2 font-mono text-sm text-sky-200" aria-live="polite">
        {promptText}
      </div>
      {msg && <div className={`text-xs ${msg.bad ? 'text-rose-300' : 'text-slate-400'}`}>{msg.text}</div>}
      {linePlayers.length > 0 && (
        <div className="grid grid-cols-4 gap-1 sm:grid-cols-7 lg:grid-cols-4 xl:grid-cols-7">
          {linePlayers.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => fill(p.id)}
              className={`truncate rounded-lg border px-1 py-2 text-center text-sm ${p.id === st.holder ? 'border-amber-400 bg-amber-900/50' : p.gender_match === 'W' ? 'border-fuchsia-900 bg-fuchsia-950/50 hover:bg-fuchsia-900/50' : 'border-sky-900 bg-sky-950/50 hover:bg-sky-900/50'}`}
              title={p.name}
            >
              <div className="font-mono text-base font-semibold">{p.number}</div>
              <div className="truncate text-[11px] text-slate-300">{p.name}</div>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {act('goal', 'Goal', 'g', undefined, 'good')}
        {act('throwaway', 'Throwaway', 't')}
        {act('drop', 'Drop', 'd')}
        {act('block', 'Block', 'b')}
        {act('callahan', 'Callahan', 'c')}
        {act('stall', 'Stall', 's')}
        {act('turnover', 'Other turn', 'x')}
        {pending && (
          <Btn tone="ghost" onClick={() => fill(null)} title="Key: -">
            Unknown player
          </Btn>
        )}
        {(pending || buffer) && (
          <Btn tone="ghost" onClick={cancel} title="Esc">
            Cancel
          </Btn>
        )}
      </div>
      <div className="flex flex-wrap gap-1 text-xs">
        {!pullTime && (
          <>
            {act('pull', 'Pull in', 'p', { result: 'in', puller: current.point.pulled_by } as Partial<Command>)}
            {act('pull', 'Pull OB', undefined, { result: 'ob', puller: current.point.pulled_by } as Partial<Command>)}
            {act('pull', 'Brick', undefined, { result: 'brick', puller: current.point.pulled_by } as Partial<Command>)}
          </>
        )}
        <Btn size="sm" onClick={() => record({ type: 'timeout', team: 'us', actor_id: null, receiver_id: null, defender_id: null, tags: [] }, stamp())}>
          Timeout us
        </Btn>
        <Btn size="sm" onClick={() => record({ type: 'timeout', team: 'them', actor_id: null, receiver_id: null, defender_id: null, tags: [] }, stamp())}>
          Timeout them
        </Btn>
        {(['half', 'soft', 'hard'] as const).map((k) => (
          <Btn key={k} size="sm" tone="ghost" onClick={() => record({ type: 'cap', team: 'us', actor_id: null, receiver_id: null, defender_id: null, tags: [k] }, stamp())}>
            {k} cap
          </Btn>
        ))}
        <Btn
          size="sm"
          tone="ghost"
          onClick={() => {
            const note = window.prompt('Note for this moment:')
            if (note) record({ type: 'note', team: 'us', actor_id: null, receiver_id: null, defender_id: null, tags: [], note }, stamp())
          }}
        >
          Note
        </Btn>
        <Btn size="sm" tone="bad" className="ml-auto" onClick={undo} title="U, Backspace or Ctrl+Z">
          Undo
        </Btn>
      </div>
    </div>
  )
}
