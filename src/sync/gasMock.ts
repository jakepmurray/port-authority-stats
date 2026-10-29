/** A small in-memory stand-in for SpreadsheetApp & co, enough to run apps-script/Code.gs in tests. */
import code from '../../apps-script/Code.gs?raw'
import { sha256 } from './sha256'

type V = string | number | boolean | Date

export class MockSheet {
  name: string
  cells: V[][] = []
  frozen = 0
  formats = new Map<number, string>() // column → number format
  maxRows = 1000
  constructor(name: string) {
    this.name = name
  }
  getName() {
    return this.name
  }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) if ((this.cells[r] ?? []).some((v) => v !== '' && v !== undefined)) return r + 1
    return 0
  }
  getLastColumn() {
    let m = 0
    for (const row of this.cells) for (let c = (row ?? []).length - 1; c >= 0; c--) if (row[c] !== '' && row[c] !== undefined) { m = Math.max(m, c + 1); break }
    return m
  }
  getMaxRows() {
    return this.maxRows
  }
  setFrozenRows(n: number) {
    this.frozen = n
  }
  hidden = false
  hideSheet() {
    this.hidden = true
  }
  insertRowsAfter(_after: number, n: number) {
    this.maxRows += n
  }
  getRange(row: number, col: number, nr = 1, nc = 1) {
    // Like Sheets: a range past the last row throws.
    if (row - 1 + nr > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.')
    const cells = this.cells
    const formats = this.formats
    return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cells[row - 1 + i]?.[col - 1 + j] ?? '')),
      setValues: (vals: V[][]) => {
        if (vals.length !== nr || vals.some((r) => r.length !== nc)) throw new Error(`setValues: size mismatch ${vals.length}x${vals[0]?.length} vs ${nr}x${nc}`)
        vals.forEach((r, i) => r.forEach((v, j) => {
          const R = row - 1 + i
          cells[R] ??= []
          cells[R][col - 1 + j] = v
        }))
      },
      clearContent: () => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (cells[row - 1 + i]) cells[row - 1 + i][col - 1 + j] = ''
      },
      setNumberFormat: (f: string) => {
        for (let j = 0; j < nc; j++) formats.set(col + j, f)
      },
    }
  }
  /** Data rows as objects keyed by the header row. */
  objects(): Record<string, V>[] {
    const header = (this.cells[0] ?? []).filter((h) => h !== '') as string[]
    const out: Record<string, V>[] = []
    for (let r = 1; r < this.getLastRow(); r++) {
      const row = this.cells[r] ?? []
      out.push(Object.fromEntries(header.map((h, i) => [h, row[i] ?? ''])))
    }
    return out
  }
}

export class MockSpreadsheet {
  sheets: MockSheet[] = [new MockSheet('Sheet1')]
  getSheetByName(n: string) {
    return this.sheets.find((s) => s.name === n) ?? null
  }
  insertSheet(n: string) {
    const s = new MockSheet(n)
    this.sheets.push(s)
    return s
  }
}

export interface Gas {
  ss: MockSpreadsheet
  props: Map<string, string>
  logs: string[]
  doPost: (e: unknown) => { text: string; mime: string }
  doGet: (e?: { parameter?: Record<string, string> }) => { text: string; mime: string }
  setup: () => void
  rotateToken: () => void
  addStatTaker: (name: string) => void
  listStatTakers: () => void
  revokeStatTaker: (id: string) => void
  setAdminName: (name: string) => void
  onOpen: () => void
  menuAddStatTaker: () => void
  menuListStatTakers: () => void
  menuRevokeStatTaker: () => void
  menuSetAdminName: () => void
  testUsauRanks: () => { ok: boolean; teams?: unknown[] }
  /** The Sheet's dialogs: queue answers for prompts; alerts and the menu are recorded. */
  ui: { answers: string[]; alerts: string[]; menu: string[] }
  TABS: Record<string, string[]>
  locks: number
  /** Make the next tryLock fail (another sync holds the lock). */
  busy: boolean
  /** UrlFetchApp: queue responses (or throw) for the next fetches; every call is recorded. */
  http: { queue: (MockHttp | Error)[]; calls: { url: string; options: MockFetchOptions }[] }
  /** CacheService.getScriptCache(): key → { value, seconds }. */
  cache: Map<string, { value: string; seconds: number }>
}

export interface MockHttp {
  code?: number
  body: string
  cookies?: string[]
}

export interface MockFetchOptions {
  method?: string
  headers?: Record<string, string>
  payload?: string
  contentType?: string
  muteHttpExceptions?: boolean
  followRedirects?: boolean
}

/** Evaluate Code.gs with mocked Google services. */
export function loadGas(ss: MockSpreadsheet | null = new MockSpreadsheet()): Gas {
  const props = new Map<string, string>()
  const logs: string[] = []
  let uuid = 0
  const state = { locks: 0, busy: false }
  const ui = { answers: [] as string[], alerts: [] as string[], menu: [] as string[] }
  const http: Gas['http'] = { queue: [], calls: [] }
  const cache: Gas['cache'] = new Map()
  const services = {
    UrlFetchApp: {
      fetch: (url: string, options: MockFetchOptions = {}) => {
        http.calls.push({ url, options })
        const next = http.queue.shift()
        if (!next) throw new Error('Address unavailable: ' + url)
        if (next instanceof Error) throw next
        return {
          getResponseCode: () => next.code ?? 200,
          getContentText: () => next.body,
          getAllHeaders: () => (next.cookies ? { 'Set-Cookie': next.cookies.length === 1 ? next.cookies[0] : next.cookies } : {}),
        }
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => cache.get(k)?.value ?? null,
        put: (k: string, value: string, seconds = 600) => {
          if (value.length > 100 * 1024) throw new Error('Argument too large: value')
          cache.set(k, { value, seconds })
        },
      }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => {
        const btn = { OK: 'ok', CANCEL: 'cancel' }
        const menu = { addItem: (label: string, fn: string) => (ui.menu.push(`${label}=${fn}`), menu), addToUi: () => undefined }
        return {
          Button: btn,
          ButtonSet: { OK: 'ok', OK_CANCEL: 'ok_cancel' },
          createMenu: (title: string) => (ui.menu.push(title), menu),
          prompt: () => {
            const v = ui.answers.shift()
            return { getSelectedButton: () => (v === undefined ? btn.CANCEL : btn.OK), getResponseText: () => v ?? '' }
          },
          alert: (...a: string[]) => void ui.alerts.push(a.filter((x) => !['ok', 'ok_cancel'].includes(x)).join('\n')),
        }
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => void props.set(k, v),
        deleteProperty: (k: string) => void props.delete(k),
        getProperties: () => Object.fromEntries(props),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => (state.busy ? false : (state.locks++, true)), releaseLock: () => undefined }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => {
        const o = { text, mime: 'text/plain', setMimeType: (m: string) => ((o.mime = m), o) }
        return o
      },
    },
    Utilities: {
      getUuid: () => `0000000${++uuid}-aaaa-bbbb-cccc-dddddddddddd`.slice(-36),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Like Apps Script: signed bytes (-128..127).
      computeDigest: (_alg: string, s: string) => [...sha256(s)].map((b) => (b > 127 ? b - 256 : b)),
    },
    Logger: { log: (s: unknown) => void logs.push(String(s)) },
  }
  const names = Object.keys(services)
  const fn = new Function(...names, `${code}\nreturn { doPost, doGet, setup, rotateToken, addStatTaker, listStatTakers, revokeStatTaker, setAdminName, onOpen, menuAddStatTaker, menuListStatTakers, menuRevokeStatTaker, menuSetAdminName, testUsauRanks, TABS };`)
  const api = fn(...names.map((n) => services[n as keyof typeof services]))
  return {
    ss: ss as MockSpreadsheet, props, logs, ui, http, cache, ...api,
    get locks() { return state.locks },
    get busy() { return state.busy },
    set busy(v: boolean) { state.busy = v },
  }
}

export const post = (gas: Gas, body: unknown) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(body), type: 'text/plain' } }).text)

/** GET /exec?<params>, parsed. */
export const get = (gas: Gas, parameter: Record<string, string> = {}) => JSON.parse(gas.doGet({ parameter }).text)

/** Run addStatTaker in the "editor" and return the key it printed once, plus the id. */
export function addTaker(gas: Gas, name: string) {
  gas.addStatTaker(name)
  const key = gas.logs.at(-1)!
  const id = /\(id (st_[0-9a-f]+)\)/.exec(gas.logs.at(-2)!)![1]
  return { key, id }
}
