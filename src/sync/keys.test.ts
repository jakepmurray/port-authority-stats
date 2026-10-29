import { describe, expect, it } from 'vitest'
import { addTaker, get, loadGas, post } from './gasMock'
import { buildPush } from './payload'
import { hex, sha256 } from './sha256'
import { teamData } from './snapshotFixture'

const ready = () => {
  const gas = loadGas()
  gas.setup()
  return { gas, admin: gas.logs.at(-1)! }
}
const reg = (gas: ReturnType<typeof loadGas>) => Object.fromEntries(gas.ss.getSheetByName('_Games')!.objects().map((r) => [r.game_id, r]))
const d = teamData()
const gamePush = (id: string, base?: number) => {
  const b = buildPush(d, [{ table: 'games', row_id: id, payload: d.games.find((g) => g.id === id)! }])
  return base === undefined ? b : { ...b, games_base: { [id]: base } }
}

describe('Apps Script v4: keys and roles', () => {
  it('the old plain token keeps working as the admin key and is replaced by its hash', () => {
    const gas = loadGas()
    gas.props.set('PA_TOKEN', 'legacy-token-123')
    expect(post(gas, { action: 'ping', token: 'legacy-token-123' })).toMatchObject({ ok: true, version: 4, who: { role: 'admin', id: 'admin' } })
    expect(gas.props.has('PA_TOKEN')).toBe(false)
    expect(gas.props.get('PA_ADMIN_HASH')).toBe(hex(sha256('legacy-token-123')))
    expect(post(gas, { action: 'ping', token: 'legacy-token-123' }).who.role).toBe('admin')
  })

  it('addStatTaker prints a key once and stores only its hash; list never shows keys', () => {
    const { gas, admin } = ready()
    gas.setAdminName('Jacob')
    const sam = addTaker(gas, 'Sam')
    expect(sam.key).toMatch(/^[0-9a-f]{64}$/)
    expect(sam.key).not.toBe(admin)
    const stored = JSON.parse(gas.props.get(`PA_KEY_${sam.id}`)!)
    expect(stored).toMatchObject({ name: 'Sam', hash: hex(sha256(sam.key)), revoked: false })
    expect([...gas.props.values()].join(' ')).not.toContain(sam.key)
    expect(post(gas, { action: 'ping', token: sam.key }).who).toEqual({ role: 'taker', id: sam.id, name: 'Sam' })
    expect(post(gas, { action: 'ping', token: admin }).who).toEqual({ role: 'admin', id: 'admin', name: 'Jacob' })
    gas.listStatTakers()
    const listed = gas.logs.slice(-1).join('\n')
    expect(listed).toContain('Sam')
    expect(listed).not.toContain(sam.key)
    expect(() => gas.addStatTaker('')).toThrow(/name/)
  })

  it('the Sheet menu adds, lists and revokes stat-takers, showing a key once in a dialog', () => {
    const { gas, admin } = ready()
    gas.onOpen()
    expect(gas.ui.menu).toEqual(['Port Authority Stats', 'Add stat-taker…=menuAddStatTaker', 'List stat-takers=menuListStatTakers', 'Revoke stat-taker…=menuRevokeStatTaker', 'Set admin name…=menuSetAdminName'])
    gas.ui.answers.push('Jacob')
    gas.menuSetAdminName()
    gas.ui.answers.push('Kim')
    gas.menuAddStatTaker()
    const shown = gas.ui.alerts.at(-1)!
    const key = /\b([0-9a-f]{64})\b/.exec(shown)![1]
    const id = /id: (st_[0-9a-f]+)/.exec(shown)![1]
    expect(shown).toMatch(/privately.*shown only once/s)
    expect(post(gas, { action: 'ping', token: key }).who).toEqual({ role: 'taker', id, name: 'Kim' })
    gas.menuListStatTakers()
    expect(gas.ui.alerts.at(-1)).toContain('Kim')
    expect(gas.ui.alerts.at(-1)).not.toContain(key)
    gas.menuAddStatTaker() // cancelled: nothing happens
    expect([...gas.props.keys()].filter((k) => k.startsWith('PA_KEY_'))).toHaveLength(1)
    gas.ui.answers.push(id)
    gas.menuRevokeStatTaker()
    expect(post(gas, { action: 'ping', token: key }).error).toBe('revoked_key')
    expect(post(gas, { action: 'pull', token: admin }).people.map((p: { name: string }) => p.name)).toEqual(['Jacob'])
  })

  it('revoking a key stops it and releases that person’s games', () => {
    const { gas } = ready()
    const sam = addTaker(gas, 'Sam')
    expect(post(gas, { ...gamePush('g2'), token: sam.key }).ok).toBe(true)
    expect(reg(gas).g2).toMatchObject({ owner_id: sam.id, owner_name: 'Sam' })
    gas.revokeStatTaker(sam.id)
    expect(post(gas, { action: 'ping', token: sam.key })).toMatchObject({ ok: false, error: 'revoked_key' })
    expect(reg(gas).g2).toMatchObject({ owner_id: '' })
    expect(() => gas.revokeStatTaker('st_nope')).toThrow(/listStatTakers/)
    expect(post(gas, { action: 'ping', token: 'made-up' })).toMatchObject({ ok: false, error: 'bad_token' })
  })
})

describe('Apps Script v4: owners, revs and audit', () => {
  it('existing games migrate to the admin on the first push; the pusher owns new games', () => {
    const { gas, admin } = ready()
    // a v3-era sheet: games pushed before keys existed
    post(gas, { ...buildPush(d, [], true), token: admin })
    gas.ss.sheets = gas.ss.sheets.filter((s) => s.name !== '_Games')
    const sam = addTaker(gas, 'Sam')
    const r = post(gas, { action: 'pull', token: sam.key })
    expect(r.registry.map((x: { game_id: string; owner_id: string }) => [x.game_id, x.owner_id])).toEqual([['g1', 'admin'], ['g2', 'admin']])
    expect(r.people.map((p: { name: string }) => p.name)).toEqual(['Admin', 'Sam'])
    expect(r.games.map((g: { id: string }) => g.id).sort()).toEqual(['g1', 'g2'])
  })

  it('only the owner can push a game; others are rejected per game while the rest goes through', () => {
    const { gas, admin } = ready()
    post(gas, { ...buildPush(d, [], true), token: admin })
    const sam = addTaker(gas, 'Sam')
    const r = post(gas, { ...buildPush(d, [{ table: 'games', row_id: 'g1', payload: d.games[0] }, { table: 'players', row_id: 'a', payload: d.players[0] }]), token: sam.key })
    expect(r.ok).toBe(true)
    // g1 directly, g2 and the deleted g3 because a player change refreshes every game's stats (no canWrite filter here)
    expect(r.rejected.map((x: { game_id: string; reason: string }) => `${x.game_id}:${x.reason}`)).toEqual(['g1:not_owner', 'g2:not_owner', 'g3:not_owner'])
    expect(r.rejected[0]).toMatchObject({ owner_name: 'Admin', owner_id: 'admin' })
    expect(r.counts.Players.upserted).toBe(1) // players are shared: Sam's change goes through
    expect(gas.ss.getSheetByName('Players')!.objects()[0]).toMatchObject({ edited_by: 'Sam' })
    expect(reg(gas).g1.rev).toBe('1') // unchanged
  })

  it('stale copies are rejected; the owner’s up-to-date push raises the rev', () => {
    const { gas, admin } = ready()
    expect(post(gas, { ...gamePush('g1', 0), token: admin }).games.g1.rev).toBe(1)
    expect(post(gas, { ...gamePush('g1', 1), token: admin }).games.g1.rev).toBe(2)
    const stale = post(gas, { ...gamePush('g1', 1), token: admin })
    expect(stale.rejected).toEqual([expect.objectContaining({ game_id: 'g1', reason: 'stale', rev: 2 })])
    expect(gas.ss.getSheetByName('Games')!.objects()[0]).toMatchObject({ id: 'g1', edited_by: 'Admin' })
  })

  it('claim, release and reassign follow the rules', () => {
    const { gas, admin } = ready()
    post(gas, { ...gamePush('g1'), token: admin })
    const sam = addTaker(gas, 'Sam')
    const kim = addTaker(gas, 'Kim')
    const act = (token: string, action: string, extra: Record<string, string> = {}) => post(gas, { action, token, game_id: 'g1', ...extra })
    expect(act(sam.key, 'claim')).toMatchObject({ ok: false, error: 'not_owner' })
    expect(act(sam.key, 'release')).toMatchObject({ ok: false, error: 'not_owner' })
    expect(act(admin, 'release').game).toMatchObject({ owner_id: '' })
    expect(post(gas, { ...gamePush('g1'), token: admin }).rejected[0].reason).toBe('unowned') // claim first, even the admin
    expect(act(sam.key, 'claim').game).toMatchObject({ owner_id: sam.id, owner_name: 'Sam' })
    expect(act(kim.key, 'claim')).toMatchObject({ ok: false, error: 'not_owner' }) // only the admin takes games away
    expect(act(sam.key, 'reassign', { to_id: kim.id })).toMatchObject({ ok: false, error: 'admin_only' })
    expect(act(admin, 'reassign', { to_id: 'st_nobody' })).toMatchObject({ ok: false, error: 'unknown_person' })
    expect(act(admin, 'reassign', { to_id: kim.id }).game).toMatchObject({ owner_id: kim.id })
    expect(act(admin, 'claim').game).toMatchObject({ owner_id: 'admin' })
    expect(post(gas, { action: 'claim', token: sam.key, game_id: 'nope' })).toMatchObject({ ok: false, error: 'unknown_game' })
    const audit = gas.ss.getSheetByName('_Audit')!.objects().map((r) => `${r.who}:${r.action}`)
    expect(audit).toEqual(['Admin:push', 'Admin:release', 'Admin:push', 'Sam:claim', 'Admin:reassign to Kim', 'Admin:claim'])
  })

  it('players merge by updated_at (an older copy never wins) and soft deletes are kept', () => {
    const { gas, admin } = ready()
    const sam = addTaker(gas, 'Sam')
    const p = d.players[0]
    const at = (t: number, extra = {}) => ({ teams: [], players: [{ ...p, updated_at: t, ...extra }], games: [], points: [], events: [] })
    post(gas, { ...buildPush(at(10, { name: 'Ava New' }), [{ table: 'players', row_id: p.id, payload: null }]), token: admin })
    post(gas, { ...buildPush(at(5, { name: 'Ava Old' }), [{ table: 'players', row_id: p.id, payload: null }]), token: sam.key })
    expect(gas.ss.getSheetByName('Players')!.objects()[0]).toMatchObject({ name: 'Ava New', edited_by: 'Admin' })
    post(gas, { ...buildPush(at(20, { deleted: true }), [{ table: 'players', row_id: p.id, payload: null }]), token: sam.key })
    expect(gas.ss.getSheetByName('Players')!.objects()[0]).toMatchObject({ deleted: true, edited_by: 'Sam' })
    expect(get(gas, { action: 'snapshot' }).ok).toBe(true)
  })

  it('flags a likely duplicate player in the audit log', () => {
    const { gas, admin } = ready()
    post(gas, { ...buildPush(d, [], true), token: admin })
    const twin = { ...d.players[0], id: 'a2', number: '42' }
    const sam = addTaker(gas, 'Sam')
    post(gas, { ...buildPush({ ...d, players: [twin] }, [{ table: 'players', row_id: 'a2', payload: null }], false, { canWrite: () => false }), token: sam.key })
    expect(gas.ss.getSheetByName('_Audit')!.objects().at(-1)!.detail).toMatch(/possible duplicate player A #42/)
  })

  it('keeps the push log to the last 5,000 entries', () => {
    const { gas, admin } = ready()
    post(gas, { action: 'release', token: admin, game_id: 'x' }) // unknown game: no entry
    const sheet = gas.ss.getSheetByName('_Audit') ?? gas.ss.insertSheet('_Audit')
    sheet.cells = [['at', 'who_id', 'who', 'action', 'games', 'detail'], ...Array.from({ length: 5000 }, (_, i) => ['t', 'admin', 'Admin', `old${i}`, '', ''])]
    sheet.maxRows = 6000
    post(gas, { ...gamePush('g1'), token: admin })
    const rows = sheet.objects()
    expect(rows).toHaveLength(5000)
    expect(rows[0].action).toBe('old1')
    expect(rows.at(-1)!.action).toBe('push')
  })
})
