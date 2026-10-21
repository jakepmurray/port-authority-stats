import { useState } from 'react'
import { useNumberBuffer, usePickerKeys } from './pickerKeys'
import type { LineIssue } from '../domain/abba'
import { CallKind, CallOutcome, type Player, type TeamSide } from '../domain/schema'
import { Btn } from './kit'
import { CALL_KIND_LABEL, CALL_OUTCOME_LABEL, playerLabel } from './labels'

const chip = (on: boolean) =>
  `rounded-lg border px-2 py-1 text-left text-xs ${on ? 'border-amber-400 bg-amber-700/60 text-white' : 'border-slate-700 bg-slate-800/60 hover:bg-slate-700'}`

/** Mid-point sub: who comes off (from the current line), who comes on (from the bench), injury or regular. */
export function SubPicker({
  line, bench, holder, issuesFor, onSave, onCancel,
}: {
  line: Player[]
  bench: Player[]
  holder: string | null
  issuesFor: (off: string | null, on: string | null) => LineIssue[]
  onSave: (s: { off: string | null; on: string | null; injury: boolean }) => void
  onCancel: () => void
}) {
  const [off, setOff] = useState<string | null | undefined>(undefined) // undefined = not chosen yet, null = unknown
  const [on, setOn] = useState<string | null | undefined>(undefined)
  const [injury, setInjury] = useState(false)
  const step: 'off' | 'on' | 'confirm' = off === undefined ? 'off' : on === undefined ? 'on' : 'confirm'
  const nb = useNumberBuffer(step === 'off' ? line : bench, (id) => (step === 'off' ? setOff(id) : setOn(id)))
  const issues = step === 'confirm' ? issuesFor(off ?? null, on ?? null) : []
  const save = () => onSave({ off: off ?? null, on: on ?? null, injury })

  usePickerKeys((e) => {
    const k = e.key
    if (k === 'Escape') return onCancel()
    if (k === 'i' || k === 'I') return setInjury((v) => !v)
    if (/^\d$/.test(k) && step !== 'confirm') return void nb.digit(k)
    if (k === '-' && step !== 'confirm') return step === 'off' ? setOff(null) : setOn(null)
    if (k === 'Backspace') {
      if (nb.back()) return
      if (step === 'confirm') return setOn(undefined)
      if (step === 'on') return setOff(undefined)
      return onCancel()
    }
    if (k === 'Enter') {
      if (nb.enter()) return
      if (step === 'confirm') return save()
      return step === 'off' ? setOff(null) : setOn(null)
    }
    return false
  })

  const pick = (list: Player[], value: string | null | undefined, set: (id: string) => void) => (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
      {list.map((p) => (
        <button type="button" key={p.id} className={chip(value === p.id)} onClick={() => set(p.id)}>
          <span className="font-mono">#{p.number}</span> {p.name}
          {p.id === holder && ' (disc)'}
        </button>
      ))}
    </div>
  )
  const name = (list: Player[], id: string | null | undefined) =>
    id === undefined ? '…' : id === null ? 'unknown' : playerLabel(list.find((p) => p.id === id))

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-sky-800 bg-sky-950/40 p-2 text-xs" role="dialog" aria-label="Substitution">
      <div className="flex flex-wrap items-center gap-2 font-mono text-sm text-sky-200">
        <span>Sub: off {name(line, off)}{step === 'off' && nb.buf ? ` #${nb.buf}▌` : ''}</span>
        <span>→ on {name(bench, on)}{step === 'on' && nb.buf ? ` #${nb.buf}▌` : ''}</span>
        <label className="ml-auto flex items-center gap-1 font-sans text-xs text-slate-300">
          <input type="checkbox" checked={injury} onChange={(e) => setInjury(e.target.checked)} /> Injury <kbd>I</kbd>
        </label>
      </div>
      <div className="text-slate-400">
        {step === 'off' && 'Who comes off? Type the number or tap (− or Enter = unknown).'}
        {step === 'on' && 'Who comes on? Type the number or tap (− or Enter = unknown).'}
        {step === 'confirm' && 'Enter to save · I injury · Backspace to change · Esc cancel'}
      </div>
      {step === 'off' && pick(line, off, setOff)}
      {step === 'on' && (bench.length ? pick(bench, on, setOn) : <p className="text-slate-500">No one on the bench in the active roster.</p>)}
      {issues.map((i, n) => (
        <p key={n} className="text-amber-300">! {i.message} (ratio warning: recorded anyway)</p>
      ))}
      <div className="flex gap-1">
        {step === 'confirm' && (
          <Btn size="sm" tone="primary" onClick={save}>
            Save {injury ? 'injury sub' : 'sub'}
          </Btn>
        )}
        <Btn size="sm" tone="ghost" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </div>
  )
}

const KINDS = CallKind.options
const OUTCOMES = CallOutcome.options

export interface CallPick {
  kind: CallKind
  team: TeamSide
  player: string | null
  outcome: CallOutcome
}

/**
 * Call picker, keyboard-first: 1–8 call type, U/T who called it, our player's number
 * (Enter skips), then 1–5 outcome, which saves.
 */
export function CallPicker({
  line, opponent, onSave, onCancel,
}: {
  line: Player[]
  opponent: string
  onSave: (c: CallPick) => void
  onCancel: () => void
}) {
  const [kind, setKind] = useState<CallKind | null>(null)
  const [team, setTeam] = useState<TeamSide | null>(null)
  const [player, setPlayer] = useState<string | null | undefined>(undefined)
  const step: 'kind' | 'team' | 'player' | 'outcome' = !kind ? 'kind' : !team ? 'team' : player === undefined ? 'player' : 'outcome'
  const nb = useNumberBuffer(line, (id) => setPlayer(id))
  const save = (outcome: CallOutcome) => {
    if (kind && team) onSave({ kind, team, player: player ?? null, outcome })
  }

  usePickerKeys((e) => {
    const k = e.key
    if (k === 'Escape') return onCancel()
    if (k === 'Backspace') {
      if (nb.back()) return
      if (step === 'outcome') return setPlayer(undefined)
      if (step === 'player') return setTeam(null)
      if (step === 'team') return setKind(null)
      return onCancel()
    }
    if (step === 'kind' && /^[1-8]$/.test(k)) return setKind(KINDS[Number(k) - 1])
    if (step === 'team' && /^[ut]$/i.test(k)) return setTeam(k.toLowerCase() === 'u' ? 'us' : 'them')
    if (step === 'player') {
      if (/^\d$/.test(k)) return void nb.digit(k)
      if (k === 'Enter') return nb.enter() ? undefined : setPlayer(null)
      if (k === '-') return setPlayer(null)
    }
    if (step === 'outcome' && /^[1-5]$/.test(k)) return save(OUTCOMES[Number(k) - 1])
    return false
  })

  const opt = (key: string, label: string, on: boolean, click: () => void) => (
    <button type="button" key={key} className={chip(on)} onClick={click}>
      <kbd className="mr-1 font-mono text-[10px] text-slate-400">{key}</kbd>
      {label}
    </button>
  )
  const playerQ = team === 'us' ? 'Which of our players called it?' : `Called on which of our players?`
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-violet-800 bg-violet-950/40 p-2 text-xs" role="dialog" aria-label="Call">
      <div className="font-mono text-sm text-violet-200">
        Call: {kind ? CALL_KIND_LABEL[kind] : '…'} · by {team ? (team === 'us' ? 'us' : opponent) : '…'}
        {team && ` · ${team === 'us' ? 'caller' : 'on'} ${player === undefined ? (nb.buf ? `#${nb.buf}▌` : '…') : player ? playerLabel(line.find((p) => p.id === player)) : 'unknown'}`}
      </div>
      {step === 'kind' && (
        <div className="flex flex-wrap gap-1">{KINDS.map((c, i) => opt(String(i + 1), CALL_KIND_LABEL[c], kind === c, () => setKind(c)))}</div>
      )}
      {step === 'team' && (
        <div className="flex flex-wrap gap-1">
          {opt('U', 'We called it', false, () => setTeam('us'))}
          {opt('T', `${opponent} called it`, false, () => setTeam('them'))}
        </div>
      )}
      {step === 'player' && (
        <>
          <div className="text-slate-400">{playerQ} Type the number or tap; Enter to skip.</div>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
            {line.map((p) => (
              <button type="button" key={p.id} className={chip(false)} onClick={() => setPlayer(p.id)}>
                <span className="font-mono">#{p.number}</span> {p.name}
              </button>
            ))}
            <button type="button" className={chip(false)} onClick={() => setPlayer(null)}>
              Skip
            </button>
          </div>
        </>
      )}
      {step === 'outcome' && (
        <>
          <div className="text-slate-400">Outcome (saves). Only “turnover” changes possession; don’t also press T.</div>
          <div className="flex flex-wrap gap-1">{OUTCOMES.map((o, i) => opt(String(i + 1), CALL_OUTCOME_LABEL[o], false, () => save(o)))}</div>
        </>
      )}
      <div className="flex gap-1 text-slate-500">
        Backspace back · Esc cancel
        <Btn size="sm" tone="ghost" className="ml-auto" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </div>
  )
}
