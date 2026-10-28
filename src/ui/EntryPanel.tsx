import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TimeStamp } from '../db/actions'
import { buildEvent, HOTKEYS, slotsFor, type Command, type CommandKind, type EntryMode, type EventDraft } from '../domain/entry'
import { replayPoint, type PointInfo } from '../domain/game'
import { resolveNumber } from '../domain/keys'
import type { Game, GameEvent, Player } from '../domain/schema'
import { Btn } from './kit'
import { EVENT_LABEL, playerLabel } from './labels'
import { MiniStore } from './store'
import { TAGGABLE_TURNOVERS, toggleTag } from '../domain/tags'
import { lineAfterSub, lineTimeline, subRatioIssues } from '../domain/subs'
import { CallPicker, SubPicker, type CallPick } from './Pickers'
import type { VideoController } from './video/controller'

interface Pending {
  kind: CommandKind
  slots: string[]
  filled: (string | null)[]
  time: TimeStamp
  extra?: Partial<Command>
}

/** A picker that owns the keyboard while open; time is stamped when it opens. */
interface Modal {
  kind: 'sub' | 'call'
  time: TimeStamp
}

/** The quick tag step after a turnover. */
interface Tagging {
  id: string
  type: GameEvent['type']
  tags: string[]
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
  tagChoices = [],
  askTags = false,
  onTag,
  onAddTag,
  onMissed,
}: {
  game: Game
  current: PointInfo
  players: Player[]
  mode: EntryMode
  stamp: () => TimeStamp
  video: VideoController | null
  onEvent: (d: EventDraft & { note?: string; id?: string }, t: TimeStamp) => Promise<void>
  onUndo: () => Promise<void>
  /** Tags offered in the quick tag step (presets + team custom tags). */
  tagChoices?: string[]
  /** Offer the quick tag step right after a turnover. */
  askTags?: boolean
  onTag?: (eventId: string, tags: string[]) => Promise<void>
  onAddTag?: (tag: string) => Promise<void>
  /** The rest of this point is not on the film: record who scored by hand. */
  onMissed?: (result: 'us' | 'them') => Promise<void>
}) {
  // Entry state lives in a ref so fast typing never reads a stale render.
  const [store] = useState(
    () => new MiniStore<{ buffer: string; bufferTime: TimeStamp | null; pending: Pending | null; optimistic: GameEvent[]; tagging: Tagging | null; modal: Modal | null }>({
      buffer: '',
      bufferTime: null,
      pending: null,
      optimistic: [],
      tagging: null,
      modal: null,
    }),
  )
  const snap = useSyncExternalStore(store.subscribe, store.get)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [missedAsk, setMissedAsk] = useState(false)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const waitTimer = useRef<number | null>(null)

  const byId = new Map(players.map((p) => [p.id, p]))
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
  const shown = merge(current.events, snap.optimistic)
  const st = replayPoint(current.point.start_on, shown)
  // Who is on the field now, after any mid-point subs (derived, so edits and deletes flow through).
  const lineIds = lineTimeline(current.point.line, shown).final
  const lineSet = new Set(lineIds)
  const linePlayers = lineIds.map((id) => byId.get(id)).filter((p): p is Player => !!p)
  const candidates = (linePlayers.length ? linePlayers : players.filter((p) => !p.deleted && p.active)).map((p) => ({ id: p.id, number: p.number }))
  const bench = players.filter((p) => !p.deleted && p.active && !lineSet.has(p.id))
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
        suggested_player_ids: [], corrected: false, note: '', created_at: now, updated_at: now, edited_at: null, deleted: false, ...draft, call: draft.call ?? null },
    ] })
    void queue(() => onEvent({ ...draft, id }, time))
    const turnoverCall = draft.type === 'call' && draft.call?.outcome === 'turnover'
    if (askTags && onTag && (TAGGABLE_TURNOVERS.has(draft.type) || turnoverCall)) store.set({ tagging: { id, type: draft.type, tags: [...draft.tags] } })
    else store.set({ tagging: null })
  }

  /** Finish the tag step: save what was picked (Enter / next action) or drop it (Esc). */
  const finishTags = (save: boolean) => {
    const t = store.get().tagging
    if (!t) return
    store.set({ tagging: null })
    if (!save || !onTag) return
    const opt = store.get().optimistic
    if (opt.some((e) => e.id === t.id)) store.set({ optimistic: opt.map((e) => (e.id === t.id ? { ...e, tags: t.tags } : e)) })
    if (t.tags.length) {
      void queue(() => onTag(t.id, t.tags))
      say(`Tagged: ${t.tags.join(', ')}`)
    }
  }
  const toggleChoice = (tag: string) => {
    const t = store.get().tagging
    if (t) store.set({ tagging: { ...t, tags: toggleTag(t.tags, tag) } })
  }
  const addCustom = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, ' ')
    if (!tag) return
    const t = store.get().tagging
    if (t && !t.tags.some((x) => x.toLowerCase() === tag.toLowerCase())) store.set({ tagging: { ...t, tags: [...t.tags, tag] } })
    if (onAddTag) void onAddTag(tag)
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
    finishTags(true)
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
    finishTags(true)
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

  const openModal = (kind: Modal['kind']) => {
    finishTags(true)
    // Take a half-typed number first, as action keys do.
    const buf = store.get().buffer
    if (buf && !store.get().pending) {
      const r = resolveNumber(buf, candidates)
      const id = r.status === 'match' ? r.id : r.status === 'wait' ? r.exact : null
      if (id) fill(id)
    }
    cancel()
    store.set({ modal: { kind, time: stamp() } })
  }
  const closeModal = () => store.set({ modal: null })
  const saveSub = ({ off, on, injury }: { off: string | null; on: string | null; injury: boolean }) => {
    const m = store.get().modal
    closeModal()
    const now = lineTimeline(current.point.line, eventsNow()).final
    record({ type: injury ? 'injury' : 'sub', team: 'us', actor_id: off, receiver_id: on, defender_id: null, tags: [] }, m?.time ?? stamp())
    const issues = subRatioIssues(lineAfterSub(now, off, on), players, current.point.ratio)
    const label = `${injury ? 'Injury sub' : 'Sub'}: ${off ? playerLabel(byId.get(off)) : 'unknown'} off, ${on ? playerLabel(byId.get(on)) : 'unknown'} on`
    say(issues.length ? `${label}. Ratio warning: ${issues.map((i) => i.message).join('; ')}` : label, issues.length > 0)
  }

  const saveCall = (c: CallPick) => {
    const m = store.get().modal
    closeModal()
    const s = stateNow()
    if (c.outcome === 'turnover' && s.over) return say('Point is over — a call cannot turn it over now', true)
    const turnover = c.outcome === 'turnover'
    record(
      {
        type: 'call', team: c.team, defender_id: null, tags: [],
        actor_id: c.team === 'us' ? c.player : null,
        receiver_id: c.team === 'them' ? c.player : null,
        call: {
          kind: c.kind, outcome: c.outcome,
          turnover_team: turnover ? s.offense : null,
          charged_id: turnover && s.offense === 'us' ? s.holder : null,
        },
      },
      m?.time ?? stamp(),
    )
    say(turnover ? `Call → ${s.offense === 'us' ? 'our' : `${game.opponent}’s`} turnover (counted once; don’t also press T)` : `Call: ${c.kind}, ${c.outcome.replace(/_/g, ' ')}`)
  }

  const undo = () => {
    store.set({ tagging: null })
    cancel()
    const opt = store.get().optimistic
    void queue(onUndo)
    if (opt.length) store.set({ optimistic: opt.slice(0, -1) })
  }

  // Keep the latest handlers for the window listener.
  const h = useRef({ typeDigit, enter, start, fill, undo, cancel, video, finishTags, toggleChoice, tagChoices, openModal })
  useEffect(() => {
    h.current = { typeDigit, enter, start, fill, undo, cancel, video, finishTags, toggleChoice, tagChoices, openModal }
  })
  useEffect(() => () => {
    if (waitTimer.current) window.clearTimeout(waitTimer.current)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const c = h.current
      // While a picker is open it owns the keys; only video controls pass through.
      if (store.get().modal && !(c.video && [' ', 'ArrowLeft', 'ArrowRight'].includes(e.key))) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        return c.undo()
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key
      // Enter/Space must not also "click" a focused button (e.g. a player tile).
      if ((k === 'Enter' || k === ' ') && e.target instanceof HTMLButtonElement) e.preventDefault()
      if (store.get().tagging) {
        // Quick tag step: 1–9, 0 toggle tags; Enter saves; Esc skips; any action key saves and goes on.
        if (/^\d$/.test(k)) {
          const tag = c.tagChoices[k === '0' ? 9 : Number(k) - 1]
          if (tag) c.toggleChoice(tag)
          return
        }
        if (k === 'Enter') return c.finishTags(true)
        if (k === 'Escape') return c.finishTags(false)
        if (k === '-') return
      }
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
      if (k === 'r' || k === 'R') {
        e.preventDefault()
        return c.openModal('sub')
      }
      if (k === 'f' || k === 'F') {
        e.preventDefault()
        return c.openModal('call')
      }
      const hk = HOTKEYS.find((x) => x.key === k.toLowerCase())
      if (hk) {
        e.preventDefault()
        c.start(hk.kind, hk.kind === 'pull' ? { puller: current.point.pulled_by, result: 'in' } : undefined)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current.point.pulled_by, store])

  const { buffer, pending, tagging, modal } = snap

  const holder = st.holder ? byId.get(st.holder) : null
  const promptText = tagging
    ? `Tag this ${EVENT_LABEL[tagging.type].toLowerCase()}? Number keys toggle · Enter done · Esc skip`
    : pending
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
      {modal?.kind === 'sub' && (
        <SubPicker
          line={linePlayers}
          bench={bench}
          holder={st.holder}
          issuesFor={(off, on) => subRatioIssues(lineAfterSub(lineIds, off, on), players, current.point.ratio)}
          onSave={saveSub}
          onCancel={closeModal}
        />
      )}
      {modal?.kind === 'call' && <CallPicker line={linePlayers} opponent={game.opponent} onSave={saveCall} onCancel={closeModal} />}
      {tagging && (
        <TagStep tagging={tagging} choices={tagChoices} onToggle={toggleChoice} onAdd={addCustom} onDone={() => finishTags(true)} onSkip={() => finishTags(false)} />
      )}
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
        <Btn size="sm" onClick={() => openModal('call')} title="Key: F. Foul / violation call">
          Call <kbd className="ml-1 rounded bg-black/30 px-1 text-[10px] text-slate-300">F</kbd>
        </Btn>
        <Btn size="sm" onClick={() => openModal('sub')} title="Key: R. Mid-point sub (regular or injury)">
          Sub <kbd className="ml-1 rounded bg-black/30 px-1 text-[10px] text-slate-300">R</kbd>
        </Btn>
        <Btn size="sm" onClick={() => record({ type: 'timeout', team: 'us', actor_id: null, receiver_id: null, defender_id: null, tags: [] }, stamp())}>
          Timeout us
        </Btn>
        <Btn size="sm" onClick={() => record({ type: 'timeout', team: 'them', actor_id: null, receiver_id: null, defender_id: null, tags: [] }, stamp())}>
          Timeout them
        </Btn>
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
        {onMissed && !missedAsk && (
          <Btn size="sm" tone="ghost" onClick={() => setMissedAsk(true)} title="Camera cut or film ended: enter the result by hand">
            Not on film…
          </Btn>
        )}
        {onMissed && missedAsk && (
          <span className="flex items-center gap-1 rounded border border-amber-800 px-1">
            <span className="text-amber-200">Rest of point missed. Who scored?</span>
            <Btn size="sm" tone="good" onClick={() => void onMissed('us')}>Us</Btn>
            <Btn size="sm" tone="bad" onClick={() => void onMissed('them')}>{game.opponent}</Btn>
            <Btn size="sm" tone="ghost" onClick={() => setMissedAsk(false)}>✕</Btn>
          </span>
        )}
        <Btn size="sm" tone="bad" className="ml-auto" onClick={undo} title="U, Backspace or Ctrl+Z">
          Undo
        </Btn>
      </div>
    </div>
  )
}

/** Chip row for the quick tag step. Context only: tags never change who is charged. */
function TagStep({
  tagging, choices, onToggle, onAdd, onDone, onSkip,
}: {
  tagging: Tagging
  choices: string[]
  onToggle: (t: string) => void
  onAdd: (t: string) => void
  onDone: () => void
  onSkip: () => void
}) {
  const [custom, setCustom] = useState('')
  const on = (t: string) => tagging.tags.some((x) => x.toLowerCase() === t.toLowerCase())
  const extra = tagging.tags.filter((t) => !choices.some((c) => c.toLowerCase() === t.toLowerCase()))
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-amber-800/70 bg-amber-950/30 p-2 text-xs" role="group" aria-label="Turnover tags">
      {choices.map((t, i) => (
        <button
          type="button"
          key={t}
          onClick={() => onToggle(t)}
          aria-pressed={on(t)}
          className={`rounded-full border px-2 py-1 ${on(t) ? 'border-amber-400 bg-amber-700/60 text-white' : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700'}`}
        >
          {i < 10 && <kbd className="mr-1 font-mono text-[10px] text-slate-400">{(i + 1) % 10}</kbd>}
          {t}
        </button>
      ))}
      {extra.map((t) => (
        <button type="button" key={t} aria-pressed onClick={() => onToggle(t)} className="rounded-full border border-amber-400 bg-amber-700/60 px-2 py-1 text-white">
          {t}
        </button>
      ))}
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          onAdd(custom)
          setCustom('')
          ;(document.activeElement as HTMLElement | null)?.blur()
        }}
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLElement).blur()
          }}
          placeholder="+ new tag"
          aria-label="New tag"
          className="w-24 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs"
        />
      </form>
      <span className="ml-auto flex gap-1">
        <Btn size="sm" tone="primary" onClick={onDone} title="Enter">
          Done
        </Btn>
        <Btn size="sm" tone="ghost" onClick={onSkip} title="Esc">
          Skip
        </Btn>
      </span>
    </div>
  )
}
