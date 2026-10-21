import type { SyncConfig } from './engine'

/**
 * Sync settings live only in this browser's localStorage (never in the repo,
 * never sent anywhere but the script URL itself, never logged).
 */
const KEY = 'pa:sync'
const LAST = 'pa:sync:last'

export function loadConfig(storage: Storage | null = safeStorage()): SyncConfig | null {
  try {
    const raw = storage?.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<SyncConfig>
    return { url: String(v.url ?? ''), token: String(v.token ?? ''), auto: v.auto !== false }
  } catch {
    return null
  }
}

export function saveConfig(c: SyncConfig, storage: Storage | null = safeStorage()) {
  storage?.setItem(KEY, JSON.stringify({ url: c.url.trim(), token: c.token.trim(), auto: c.auto }))
}

export function clearConfig(storage: Storage | null = safeStorage()) {
  storage?.removeItem(KEY)
}

export const loadLastSynced = (storage: Storage | null = safeStorage()) => {
  const v = Number(storage?.getItem(LAST))
  return Number.isFinite(v) && v > 0 ? v : null
}
export const saveLastSynced = (t: number, storage: Storage | null = safeStorage()) => storage?.setItem(LAST, String(t))

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
