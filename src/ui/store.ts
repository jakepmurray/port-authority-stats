/** Tiny synchronous store for useSyncExternalStore: reads are always fresh in event handlers. */
export class MiniStore<T extends object> {
  private state: T
  private listeners = new Set<() => void>()
  constructor(initial: T) {
    this.state = initial
  }
  get = (): T => this.state
  set = (patch: Partial<T>) => {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
}
