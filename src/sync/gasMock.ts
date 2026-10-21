/** A small in-memory stand-in for SpreadsheetApp & co, enough to run apps-script/Code.gs in tests. */
import code from '../../apps-script/Code.gs?raw'

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
  getRange(row: number, col: number, nr = 1, nc = 1) {
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
  doGet: () => { text: string; mime: string }
  setup: () => void
  rotateToken: () => void
  TABS: Record<string, string[]>
  locks: number
}

/** Evaluate Code.gs with mocked Google services. */
export function loadGas(ss: MockSpreadsheet | null = new MockSpreadsheet()): Gas {
  const props = new Map<string, string>()
  const logs: string[] = []
  let uuid = 0
  const state = { locks: 0 }
  const services = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => void props.set(k, v),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => (state.locks++, true), releaseLock: () => undefined }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => {
        const o = { text, mime: 'text/plain', setMimeType: (m: string) => ((o.mime = m), o) }
        return o
      },
    },
    Utilities: { getUuid: () => `0000000${++uuid}-aaaa-bbbb-cccc-dddddddddddd`.slice(-36) },
    Logger: { log: (s: unknown) => void logs.push(String(s)) },
  }
  const names = Object.keys(services)
  const fn = new Function(...names, `${code}\nreturn { doPost, doGet, setup, rotateToken, TABS };`)
  const api = fn(...names.map((n) => services[n as keyof typeof services]))
  return { ss: ss as MockSpreadsheet, props, logs, ...api, get locks() { return state.locks } }
}

export const post = (gas: Gas, body: unknown) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(body), type: 'text/plain' } }).text)
