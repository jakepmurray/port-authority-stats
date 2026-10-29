
/**
 * Team view: a read-only copy of the writer's data, loaded from the Apps Script
 * (GET ?action=snapshot, no token). Link format:
 *   https://jakepmurray.github.io/port-authority-stats/#/team?src=<encodeURIComponent(web app /exec URL)>
 * The web app URL is not a secret (it is useless for writing without the token).
 */
export const TEAM_ROUTE = 'team'
const SRC_KEY = 'pa:team:src'

export const isTeamHash = (hash: string) => /^#\/?team(\/|\?|$)/.test(hash)

/** The shareable link for a script URL. `appUrl` is the app's address without the hash. */
export function teamLink(appUrl: string, scriptUrl: string) {
  return `${appUrl.split('#')[0]}#/${TEAM_ROUTE}?src=${encodeURIComponent(scriptUrl.trim())}`
}

/** Only an Apps Script web app (or localhost, for testing) can be a team view source. */
export function validSrc(src: string): boolean {
  try {
    const u = new URL(src)
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && /^https?:$/.test(u.protocol)) return true
    return u.protocol === 'https:' && u.hostname === 'script.google.com' && /^\/macros\/(a\/[^/]+\/)?s\/[^/]+\/exec$/.test(u.pathname)
  } catch {
    return false
  }
}

/**
 * The source from the hash query: `src` (the shared link) or `team_src` (kept in team-view
 * dashboard links, where `src` is already the dashboard's film/live/import filter).
 * The first valid Apps Script URL wins.
 */
export function srcFromHash(hash: string): string | null {
  const q = hash.split('?')[1]
  if (!q) return null
  const p = new URLSearchParams(q)
  return [...p.getAll('team_src'), ...p.getAll('src')].map((v) => v.trim()).find(validSrc) ?? null
}

/** Built-in default (optional): set VITE_TEAM_SRC at build time to make plain #/team work. */
const builtIn = (): string | null => (import.meta.env.VITE_TEAM_SRC as string | undefined)?.trim() || null

/**
 * Where to load the snapshot from: the link's ?src=, else the one remembered from an
 * earlier visit, else the build default. A new ?src= is remembered for next time.
 */
export function resolveSrc(hash: string, storage: Storage | null = safeStorage()): string | null {
  const fromLink = srcFromHash(hash)
  if (fromLink) {
    try {
      storage?.setItem(SRC_KEY, fromLink)
    } catch {
      /* private mode */
    }
    return fromLink
  }
  let saved: string | null = null
  try {
    saved = storage?.getItem(SRC_KEY) ?? null
  } catch {
    saved = null
  }
  const fallback = saved || builtIn()
  return fallback && validSrc(fallback) ? fallback : null
}

/** GET URL for the snapshot. */
export function snapshotUrl(src: string) {
  const u = new URL(src)
  u.searchParams.set('action', 'snapshot')
  return u.toString()
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
