import { useState } from 'react'
import { useNumberBuffer, usePickerKeys } from './pickerKeys'
import type { LineIssue } from '../domain/abba'
import type { Player } from '../domain/schema'
import { Btn } from './kit'
import { playerLabel } from './labels'

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
