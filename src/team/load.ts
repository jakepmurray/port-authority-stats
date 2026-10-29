import { StatsDB, TEAM_DB_NAME } from '../db/db'
import { parseSnapshot, type TeamSnapshot } from '../sync/snapshot'
import { snapshotUrl } from './link'

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>

/** A plain-language reason the team view could not load. */
export class TeamViewError extends Error {
  readonly code: 'unreachable' | 'http' | 'not_json' | 'old_script' | 'no_snapshot' | 'busy' | 'bad_url' | 'script'
  constructor(code: TeamViewError['code'], message: string) {
    super(message)
    this.code = code
  }
}

/**
 * GET the snapshot. A simple GET (no custom headers, no credentials) needs no CORS
 * preflight; Apps Script answers 302 to script.googleusercontent.com, which sends
 * Access-Control-Allow-Origin: *, so fetch just follows the redirect.
 */
export async function fetchSnapshot(fetchFn: FetchFn, src: string, timeoutMs = 45000): Promise<TeamSnapshot> {
  let url: string
  try {
    url = snapshotUrl(src)
  } catch {
    throw new TeamViewError('bad_url', 'This team view link is broken (the src address is not a URL). Ask for the link again.')
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  let res: Response
  try {
    res = await fetchFn(url, { method: 'GET', redirect: 'follow', credentials: 'omit', cache: 'no-store', signal: ctrl?.signal })
  } catch {
    throw new TeamViewError('unreachable', 'Could not reach the team’s stats. Check your connection and tap Refresh.')
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (!res.ok) throw new TeamViewError('http', `The stats script answered HTTP ${res.status}. Try Refresh in a minute.`)
  const text = await res.text().catch(() => '')
  let data: { ok?: unknown; kind?: unknown; error?: unknown; message?: unknown; version?: unknown }
  try {
    data = JSON.parse(text)
  } catch {
    throw new TeamViewError('not_json', 'The link did not return team stats (got a web page). The script may not be shared with “Anyone”, or the link is wrong.')
  }
  if (data && data.ok === false) {
    if (data.error === 'no_snapshot') throw new TeamViewError('no_snapshot', 'No team view data yet. The stat keeper needs to open Settings and click “Push everything” once.')
    if (data.error === 'busy') throw new TeamViewError('busy', 'The stats are being updated right now. Tap Refresh in a moment.')
    throw new TeamViewError('script', `The stats script reported an error${typeof data.message === 'string' ? `: ${data.message}` : '.'}`)
  }
  if (data && data.ok === true && data.kind !== 'snapshot') {
    throw new TeamViewError('old_script', 'The team’s stats script is an older version without the team view. The stat keeper needs to paste the new Code.gs and deploy a new version.')
  }
  try {
    return parseSnapshot(data)
  } catch {
    throw new TeamViewError('not_json', 'Unexpected reply from the stats script.')
  }
}

/**
 * Replace the read-only team-view database with the snapshot. This is a separate
 * IndexedDB database: the visitor's own data (and sync queue) is never touched.
 */
export async function storeSnapshot(snap: TeamSnapshot, name = TEAM_DB_NAME) {
  if (name === new StatsDB().name) throw new Error('Refusing to write a team snapshot into the main database')
  const w = new StatsDB(name)
  try {
    await w.transaction('rw', [w.teams, w.players, w.games, w.points, w.events], async () => {
      await Promise.all([w.teams.clear(), w.players.clear(), w.games.clear(), w.points.clear(), w.events.clear()])
      await w.teams.bulkPut(snap.teams)
      await w.players.bulkPut(snap.players)
      await w.games.bulkPut(snap.games)
      await w.points.bulkPut(snap.points)
      await w.events.bulkPut(snap.events)
    })
  } finally {
    w.close()
  }
}

// ---------- what was loaded, and when (shown in the banner) ----------

export interface TeamInfo {
  src: string
  updatedAt: number | null
  fullAt: number | null
  loadedAt: number
  games: number
  skipped: number
}
const INFO_KEY = 'pa:team:info'

export function loadInfo(storage: Storage | null = safe()): TeamInfo | null {
  try {
    const raw = storage?.getItem(INFO_KEY)
    return raw ? (JSON.parse(raw) as TeamInfo) : null
  } catch {
    return null
  }
}
export function saveInfo(i: TeamInfo, storage: Storage | null = safe()) {
  try {
    storage?.setItem(INFO_KEY, JSON.stringify(i))
  } catch {
    /* private mode */
  }
}
function safe(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Fetch, validate and store; returns what the banner shows. */
export async function refreshTeamView(fetchFn: FetchFn, src: string, now = Date.now(), name = TEAM_DB_NAME): Promise<TeamInfo> {
  const snap = await fetchSnapshot(fetchFn, src)
  await storeSnapshot(snap, name)
  const info: TeamInfo = { src, updatedAt: snap.updatedAt, fullAt: snap.fullAt, loadedAt: now, games: snap.games.length, skipped: snap.skipped }
  saveInfo(info)
  return info
}
