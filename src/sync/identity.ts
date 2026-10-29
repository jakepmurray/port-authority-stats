import type { Person, Who } from './client'

/**
 * Who this browser's key belongs to, and the people who can own games, as the
 * script last said (localStorage only; never contains the key).
 */
const WHO = 'pa:sync:who'
const PEOPLE = 'pa:sync:people'

const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
const read = <T,>(k: string, s: Storage | null): T | null => {
  try {
    const raw = s?.getItem(k)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()
let cache: Who | null | undefined
export const loadWho = (s: Storage | null = store()): Who | null => (s === store() ? (cache === undefined ? (cache = read<Who>(WHO, s)) : cache) : read<Who>(WHO, s))
export function saveWho(w: Who | null, s: Storage | null = store()) {
  if (w) s?.setItem(WHO, JSON.stringify({ role: w.role, id: w.id, name: w.name }))
  else s?.removeItem(WHO)
  if (s === store()) cache = w ? { role: w.role, id: w.id, name: w.name } : null
  listeners.forEach((f) => f())
}
export const subscribeWho = (f: () => void) => {
  listeners.add(f)
  return () => void listeners.delete(f)
}
export const loadPeople = (s: Storage | null = store()): Person[] => read<Person[]>(PEOPLE, s) ?? []
export const savePeople = (p: Person[], s: Storage | null = store()) => s?.setItem(PEOPLE, JSON.stringify(p))
