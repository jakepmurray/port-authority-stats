import { describe, expect, it } from 'vitest'
import { loadGas, MockSpreadsheet, post } from './gasMock'
import { SHEET_TABS } from './sheetRows'

const ready = () => {
  const gas = loadGas()
  gas.setup()
  const token = gas.logs.at(-1)!
  return { gas, token }
}

describe('Apps Script (Code.gs) with mocked SpreadsheetApp', () => {
  it('uses exactly the tabs and headers the app sends', () => {
    const gas = loadGas()
    expect(gas.TABS).toEqual(SHEET_TABS)
  })

  it('setup creates every tab with headers and prints a token once', () => {
    const { gas, token } = ready()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(gas.props.get('PA_TOKEN')).toBe(token)
    for (const [name, header] of Object.entries(SHEET_TABS)) {
      const s = gas.ss.getSheetByName(name)!
      expect(s.cells[0]).toEqual(header)
      expect(s.frozen).toBe(1)
    }
    gas.setup() // second run: keeps the token, doesn't print it
    expect(gas.props.get('PA_TOKEN')).toBe(token)
    expect(gas.logs.at(-1)).toContain('already set')
  })

  it('rejects missing or wrong tokens and requests before setup', () => {
    const fresh = loadGas()
    expect(post(fresh, { action: 'ping', token: 'x' })).toMatchObject({ ok: false, error: 'no_token_configured' })
    const { gas, token } = ready()
    expect(post(gas, { action: 'ping' })).toMatchObject({ ok: false, error: 'bad_token' })
    expect(post(gas, { action: 'ping', token: token.slice(0, -1) + 'x' })).toMatchObject({ ok: false, error: 'bad_token' })
    expect(gas.doPost({ postData: { contents: 'not json' } }).text).toContain('bad_request')
    expect(post(gas, { action: 'nope', token })).toMatchObject({ ok: false, error: 'unknown_action' })
  })

  it('answers JSON (ContentService) and doGet says the endpoint is up', () => {
    const { gas, token } = ready()
    const r = gas.doPost({ postData: { contents: JSON.stringify({ action: 'ping', token }) } })
    expect(r.mime).toBe('application/json')
    expect(JSON.parse(gas.doGet().text)).toMatchObject({ ok: true, app: 'port-authority-stats' })
  })

  it('ping creates missing tabs and adds missing header columns', () => {
    const { gas, token } = ready()
    gas.ss.sheets = gas.ss.sheets.filter((s) => s.name !== 'Events')
    const ev = gas.ss.getSheetByName('Player Stats')!
    ev.cells[0] = ev.cells[0].slice(0, 10) // an old sheet missing newer columns
    const r = post(gas, { action: 'ping', token })
    expect(r.ok).toBe(true)
    const by = Object.fromEntries(r.tabs.map((t: { name: string }) => [t.name, t]))
    expect(by.Events.status).toBe('created')
    expect(by['Player Stats'].status).toBe('headers_added')
    expect(by['Player Stats'].missing).toContain('calls_made_by')
    expect(by.Players.status).toBe('ok')
    expect(gas.ss.getSheetByName('Player Stats')!.cells[0]).toEqual(SHEET_TABS['Player Stats'])
  })

  it('push upserts by id, deletes, and is idempotent', () => {
    const { gas, token } = ready()
    const body = {
      action: 'push', token,
      upsert: { Players: { rows: [{ id: 'p1', number: '07', name: 'Ava' }, { id: 'p2', number: '12', name: 'Bo' }], delete: [] } },
    }
    expect(post(gas, body).ok).toBe(true)
    expect(post(gas, body).ok).toBe(true)
    const players = gas.ss.getSheetByName('Players')!
    expect(players.objects()).toHaveLength(2)
    post(gas, { action: 'push', token, upsert: { Players: { rows: [{ id: 'p1', number: '07', name: 'Ava K' }], delete: ['p2'] } } })
    expect(players.objects()).toEqual([expect.objectContaining({ id: 'p1', name: 'Ava K', number: '07' })])
    const col = SHEET_TABS.Players.indexOf('number') + 1
    expect(players.formats.get(col)).toBe('@') // jersey numbers kept as text
  })

  it('push replaces a game’s rows in the per-game tabs and leaves other games alone', () => {
    const { gas, token } = ready()
    const snap = (g: string, n: number) => ({
      Points: Array.from({ length: n }, (_, i) => ({ id: `${g}-pt${i}`, game_id: g, idx: i + 1 })),
      Events: Array.from({ length: n * 2 }, (_, i) => ({ id: `${g}-e${i}`, game_id: g, type: i === 0 ? 'call' : 'sub', call_kind: 'foul' })),
      'Player Stats': [{ id: `${g}:p1`, game_id: g, calls_made: 1 }],
      'Game Stats': [{ id: g, game_id: g, subs: 2 }],
    })
    post(gas, { action: 'push', token, replace: { game_ids: ['g1', 'g2'], tabs: merge(snap('g1', 3), snap('g2', 2)) } })
    expect(gas.ss.getSheetByName('Events')!.objects()).toHaveLength(10)
    post(gas, { action: 'push', token, replace: { game_ids: ['g1'], tabs: snap('g1', 1) } })
    const ev = gas.ss.getSheetByName('Events')!.objects()
    expect(ev.filter((e) => e.game_id === 'g1')).toHaveLength(2)
    expect(ev.filter((e) => e.game_id === 'g2')).toHaveLength(4)
    expect(ev[ev.length - 1]).toMatchObject({ call_kind: 'foul' })
    // a deleted game: listed with no rows → all its rows go
    post(gas, { action: 'push', token, replace: { game_ids: ['g2'], tabs: {} } })
    expect(gas.ss.getSheetByName('Game Stats')!.objects().map((r) => r.id)).toEqual(['g1'])
    expect(gas.ss.getSheetByName('Meta')!.objects().map((r) => r.key)).toContain('last_push_at')
  })

  it('stores formula-looking text as text', () => {
    const { gas, token } = ready()
    post(gas, { action: 'push', token, upsert: { Games: { rows: [{ id: 'g1', notes: '=IMPORTXML("http://x")', game_to: -1 }], delete: [] } } })
    expect(gas.ss.getSheetByName('Games')!.objects()[0]).toMatchObject({ notes: "'=IMPORTXML(\"http://x\")", game_to: -1 })
  })

  it('reports a script opened without a Sheet', () => {
    const gas = loadGas(null as unknown as MockSpreadsheet)
    gas.props.set('PA_TOKEN', 't')
    expect(post(gas, { action: 'ping', token: 't' })).toMatchObject({ ok: false, error: 'no_sheet' })
  })
})

function merge(a: Record<string, unknown[]>, b: Record<string, unknown[]>) {
  return Object.fromEntries(Object.keys(a).map((k) => [k, [...a[k], ...b[k]]]))
}
