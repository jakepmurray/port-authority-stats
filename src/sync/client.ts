/**
 * Talking to the Apps Script web app from the browser.
 *
 * CORS: Apps Script can't answer an OPTIONS preflight, so every request must be a
 * "simple" request: POST, no custom headers, Content-Type text/plain. The JSON goes
 * in the body as text. Apps Script answers with a 302 to a one-time
 * script.googleusercontent.com URL that serves the JSON with
 * Access-Control-Allow-Origin: *, so fetch must follow redirects (the default).
 * The token travels in the body, never in the URL.
 */
import type { UsauRank } from '../domain/opponents'

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>

/** Who the script says this key belongs to (version 4+). */
export interface Who {
  role: 'admin' | 'taker'
  id: string
  name: string
}
/** One game's owner and revision, as the script keeps them. */
export interface RemoteGame {
  game_id: string
  owner_id: string
  owner_name: string
  rev: number
  updated_by: string
  updated_at: string
  deleted: boolean
}
export type RejectReason = 'not_owner' | 'unowned' | 'stale'
export interface Rejection {
  game_id: string
  reason: RejectReason
  owner_id: string
  owner_name: string
  rev: number
}
export interface Person {
  id: string
  name: string
  role: 'admin' | 'taker'
}

export interface ScriptOk {
  ok: true
  version?: number
  tabs?: { name: string; status: 'ok' | 'created' | 'headers_added'; missing: string[] }[]
  counts?: Record<string, unknown>
  who?: Who
  /** push: accepted games with their new rev. */
  games?: Record<string, RemoteGame>
  /** push: games left out because someone else owns them, nobody does, or the copy was stale. */
  rejected?: Rejection[]
  /** claim / release / reassign */
  game?: RemoteGame
  /** pull */
  registry?: RemoteGame[]
  people?: Person[]
  /** usau_ranks (version 6) */
  teams?: { rank: number; team: string; rating: number | null }[]
  total?: number
  fetched_at?: string
  cached?: boolean
  source_url?: string
}
export interface ScriptErr {
  ok: false
  error: string
  message?: string
}
export type ScriptResponse = ScriptOk | ScriptErr

export type CallFailure =
  | { kind: 'unreachable'; message: string }
  | { kind: 'http'; status: number; message: string }
  | { kind: 'not_json'; message: string }
  | { kind: 'script'; error: string; message: string }

export class SyncError extends Error {
  readonly failure: CallFailure
  constructor(f: CallFailure) {
    super(f.message)
    this.failure = f
  }
  /** Retrying later can help (network, Google hiccup, busy lock). Bad config can't. */
  get retryable() {
    const f = this.failure
    if (f.kind === 'unreachable') return true
    if (f.kind === 'http') return f.status >= 500 || f.status === 429
    if (f.kind === 'script') return f.error === 'busy' || f.error === 'script_error'
    return false
  }
}

/**
 * 2: Games tab gained game_clock and ended_at. 3: team-view snapshot (GET ?action=snapshot).
 * 4: per-person keys, game owners and revs, pull, audit.
 */
export const EXPECTED_SCRIPT_VERSION = 6

/** Build the fetch options. Exported so a test can pin the exact request format. */
export function requestInit(body: Record<string, unknown>, token: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, token }),
    redirect: 'follow',
    credentials: 'omit',
    cache: 'no-store',
  }
}

export function checkUrl(url: string): { ok: boolean; warning: string | null } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, warning: 'That is not a URL. Paste the Web app URL from Deploy > Manage deployments.' }
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return { ok: false, warning: 'The URL must start with https://' }
  if (u.hostname === 'script.google.com') {
    if (u.pathname.endsWith('/dev')) return { ok: true, warning: 'This is the /dev test URL; it only works for you while signed in. Use the /exec URL.' }
    if (!/^\/macros\/s\/[^/]+\/exec$/.test(u.pathname)) return { ok: true, warning: 'Expected a URL like https://script.google.com/macros/s/…/exec' }
    return { ok: true, warning: null }
  }
  return { ok: true, warning: 'This is not a script.google.com URL. That is fine only for testing.' }
}

export async function callScript(fetchFn: FetchFn, url: string, token: string, body: Record<string, unknown>, timeoutMs = 60000): Promise<ScriptOk> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  let res: Response
  try {
    res = await fetchFn(url, { ...requestInit(body, token), signal: ctrl?.signal })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    throw new SyncError({
      kind: 'unreachable',
      message: aborted
        ? 'The script did not answer in time.'
        : 'Could not reach the script (offline, wrong URL, or the deployment is not shared with "Anyone").',
    })
  } finally {
    if (timer) clearTimeout(timer)
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new SyncError({ kind: 'http', status: res.status, message: `The script URL answered HTTP ${res.status}.` })
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    const html = /<html|<!doctype/i.test(text)
    throw new SyncError({
      kind: 'not_json',
      message: html
        ? 'The URL returned a web page instead of the script’s reply. Check it is the /exec Web app URL and access is “Anyone”.'
        : 'The URL did not return JSON. Is it the Web app URL?',
    })
  }
  const r = data as ScriptResponse
  if (!r || typeof r !== 'object' || typeof (r as { ok?: unknown }).ok !== 'boolean') {
    throw new SyncError({ kind: 'not_json', message: 'Unexpected reply. Is this the Port Authority Stats script?' })
  }
  if (!r.ok) throw new SyncError({ kind: 'script', error: r.error, message: scriptMessage(r) })
  return r
}

function scriptMessage(r: ScriptErr) {
  switch (r.error) {
    case 'bad_token':
      return 'The script rejected your key. Check it was pasted in full (ask Jacob for a new one if needed).'
    case 'revoked_key':
      return 'Your key was revoked, so nothing more can be sent. Ask Jacob if this is a mistake.'
    case 'no_token_configured':
      return 'The script has no admin key yet. Run setup() in the Apps Script editor.'
    case 'unknown_action':
      return 'The script is older than this app. Paste the new Code.gs and deploy a new version (Manage deployments > Edit > New version).'
    case 'not_owner':
    case 'admin_only':
    case 'unknown_game':
    case 'unknown_person':
      return r.message ?? r.error
    case 'busy':
      return 'The Sheet is busy with another sync. Will retry.'
    default:
      return r.message ? `Script error: ${r.message}` : `Script error: ${r.error}`
  }
}

export interface ConnectionReport {
  url: { ok: boolean; note: string | null }
  reachable: boolean | null
  token: boolean | null
  tabs: ScriptOk['tabs'] | null
  version: number | null
  who?: Who | null
  summary: string
  ok: boolean
}

/** Test connection: URL shape, reachability, token, tabs/headers (missing ones are created by the script). */
export async function testConnection(fetchFn: FetchFn, url: string, token: string): Promise<ConnectionReport> {
  const u = checkUrl(url.trim())
  const base: ConnectionReport = { url: { ok: u.ok, note: u.warning }, reachable: null, token: null, tabs: null, version: null, summary: '', ok: false }
  if (!u.ok) return { ...base, summary: u.warning ?? 'Bad URL' }
  if (!token.trim()) return { ...base, summary: 'Enter your key (Jacob’s admin key from the Execution log, or the stat-taker key Jacob sent you).' }
  try {
    const r = await callScript(fetchFn, url.trim(), token.trim(), { action: 'ping' })
    const tabs = r.tabs ?? []
    const fixed = tabs.filter((t) => t.status !== 'ok')
    const old = (r.version ?? 0) < EXPECTED_SCRIPT_VERSION
    return {
      ...base,
      reachable: true,
      token: true,
      tabs,
      version: r.version ?? null,
      who: r.who ?? null,
      ok: !old,
      summary: old
        ? 'Connected, but the script is older than this app. Paste the new Code.gs and redeploy (Manage deployments > Edit > New version).'
        : fixed.length
          ? `Connected. Set up ${fixed.map((t) => `${t.name} (${t.status === 'created' ? 'created' : `added ${t.missing.join(', ')}`})`).join('; ')}.`
          : `Connected${r.who ? ` as ${r.who.role === 'admin' ? 'admin' : 'stat-taker'} (${r.who.name})` : ''}. Key accepted and all tabs and headers are in place.`,
    }
  } catch (e) {
    if (!(e instanceof SyncError)) throw e
    const f = e.failure
    if (f.kind === 'script') return { ...base, reachable: true, token: ['bad_token', 'revoked_key', 'no_token_configured'].includes(f.error) ? false : null, summary: f.message }
    return { ...base, reachable: f.kind === 'not_json', summary: f.message }
  }
}

export type UsauDivision = 'Mixed' | 'Men' | 'Women'
export const USAU_DIVISIONS: UsauDivision[] = ['Mixed', 'Men', 'Women']

export interface UsauFetch {
  teams: UsauRank[]
  total: number
  fetchedAt: string | null
  cached: boolean
  sourceUrl: string | null
}

/** Why "Fetch ranks" failed, in words that point to the paste fallback. */
export function usauFetchMessage(e: unknown): string {
  if (!(e instanceof SyncError)) return e instanceof Error ? e.message : String(e)
  const f = e.failure
  if (f.kind === 'script' && f.error === 'unknown_action') return 'Your Sheet script is older than version 6, so it can’t fetch ranks yet (paste Code.gs v6 and deploy a new version).'
  if (f.kind === 'script' && /permission|authoriz/i.test(f.message)) return 'The Sheet script hasn’t been allowed to reach USAU yet: run testUsauRanks() once in the Apps Script editor and approve the prompt.'
  if (f.kind === 'not_json') return 'The Sheet script didn’t answer properly. If you just pasted version 6, run testUsauRanks() once in the Apps Script editor to approve the new permission.'
  if (f.kind === 'script' && (f.error === 'usau_fetch' || f.error === 'usau_parse')) return f.message.replace(/^Script error: /, '')
  return f.message
}

/** The current USAU club rankings for a division, read by the Sheet script (version 6). */
export async function fetchUsauRanks(fetchFn: FetchFn, url: string, token: string, division: UsauDivision = 'Mixed'): Promise<UsauFetch> {
  const r = await callScript(fetchFn, url, token, { action: 'usau_ranks', division })
  const teams = (r.teams ?? [])
    .filter((t) => Number.isInteger(t.rank) && t.rank > 0 && typeof t.team === 'string' && t.team.trim())
    .map((t) => ({ rank: t.rank, name: t.team.trim(), rating: typeof t.rating === 'number' ? t.rating : null }))
  if (!teams.length) throw new SyncError({ kind: 'script', error: 'usau_parse', message: 'The script returned no USAU teams.' })
  return { teams, total: r.total ?? teams.length, fetchedAt: r.fetched_at ?? null, cached: !!r.cached, sourceUrl: r.source_url ?? null }
}
