import { useEffect, useRef, useState } from 'react'
import { resolveNumber } from '../domain/keys'
import type { Player } from '../domain/schema'

/**
 * Keys for an open picker: listens in the capture phase and stops the event,
 * so the entry panel's own shortcuts never see it.
 */
export function usePickerKeys(handler: (e: KeyboardEvent) => boolean | void) {
  const h = useRef(handler)
  useEffect(() => {
    h.current = handler
  })
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (h.current(e) !== false) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [])
}

/** Typed jersey numbers for a picker step: commits when unambiguous, Enter takes an exact match. */
export function useNumberBuffer(candidates: Player[], onPick: (id: string) => void) {
  const [buf, setBuf] = useState('')
  const list = candidates.map((p) => ({ id: p.id, number: p.number }))
  const digit = (d: string) => {
    const next = buf + d
    const r = resolveNumber(next, list)
    if (r.status === 'match') {
      setBuf('')
      onPick(r.id)
    } else if (r.status === 'wait') setBuf(next)
    else setBuf('')
    return r.status !== 'none'
  }
  const enter = () => {
    if (!buf) return false
    const r = resolveNumber(buf, list)
    setBuf('')
    const id = r.status === 'match' ? r.id : r.status === 'wait' ? r.exact : null
    if (id) onPick(id)
    return true
  }
  const back = () => {
    if (!buf) return false
    setBuf(buf.slice(0, -1))
    return true
  }
  return { buf, digit, enter, back, clear: () => setBuf('') }
}

