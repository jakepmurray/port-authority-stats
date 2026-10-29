import { describe, expect, it } from 'vitest'
import { opponentId } from '../domain/opponents'
import { OpponentSchema } from '../domain/schema'
import { addTaker, get, loadGas, post } from './gasMock'
import { buildPush, isEmptyPush } from './payload'
import { teamData } from './snapshotFixture'

const opp = (name: string, season: string, rank: number | null, updated_at = 1) =>
  OpponentSchema.parse({ id: opponentId(name, season), team_id: 't1', name, season, rank, created_at: 1, updated_at })

describe('opponent ranks in the push', () => {
  it('a rank change is its own upsert; Game Stats carry opp_rank; the snapshot carries the ranks', () => {
    const d = teamData()
    const body = buildPush(d, [{ table: 'opponents', row_id: d.opponents[0].id, payload: d.opponents[0] }])
    expect(isEmptyPush(body)).toBe(false)
    expect(body.upsert.Opponents!.rows).toEqual([expect.objectContaining({ id: 'opp:2026:alpha', name: 'Alpha', season: '2026', rank: 12 })])
    expect(body.replace.game_ids).toEqual([]) // no game rows are re-sent for a rank change
    expect(body.snapshot!.base.opponents).toHaveLength(1)
    const full = buildPush(d, [], true)
    expect(full.replace.tabs['Game Stats'].map((r) => [r.opponent, r.opp_rank])).toEqual([['Alpha', 12], ['Bravo', null]])
  })
})

describe('Apps Script v5: Opponents tab', () => {
  const ready = () => {
    const gas = loadGas()
    gas.setup()
    const admin = gas.logs.at(-1)!
    return { gas, admin }
  }
  const sheet = (gas: ReturnType<typeof loadGas>, name: string) => {
    const s = gas.ss.getSheetByName(name)!
    const h = s.cells[0]
    return s.cells.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])))
  }

  it('fills Game Stats ranks (season first, then all seasons) and refreshes them when ranks change', () => {
    const { gas, admin } = ready()
    const d = teamData()
    d.opponents.push(opp('bravo', '', 30))
    post(gas, { ...buildPush(d, [], true), token: admin })
    expect(sheet(gas, 'Game Stats').map((r) => [r.opponent, r.opp_rank])).toEqual([['Alpha', 12], ['Bravo', 30]])
    expect(sheet(gas, 'Opponents').map((r) => [r.id, r.rank, r.edited_by])).toEqual([['opp:2026:alpha', 12, 'Admin'], ['opp:all:bravo', 30, 'Admin']])

    // A stat-taker (owning no games) adds a 2026 rank for Bravo: it wins over the all-seasons one.
    const sam = addTaker(gas, 'Sam')
    const b26 = opp('Bravo', '2026', 7, 5)
    const r = post(gas, { ...buildPush({ ...d, opponents: [...d.opponents, b26] }, [{ table: 'opponents', row_id: b26.id, payload: b26 }]), token: sam.key })
    expect(r).toMatchObject({ ok: true, rejected: [], counts: { Opponents: { upserted: 1 }, ranks_refreshed: 1 } })
    expect(sheet(gas, 'Game Stats').map((x) => x.opp_rank)).toEqual([12, 7])
    expect(sheet(gas, 'Opponents').find((x) => x.id === b26.id)!.edited_by).toBe('Sam')

    // Clearing a rank falls back to the all-seasons one.
    const cleared = { ...b26, rank: null, updated_at: 9 }
    post(gas, { ...buildPush({ ...d, opponents: [...d.opponents, cleared] }, [{ table: 'opponents', row_id: b26.id, payload: cleared }]), token: sam.key })
    expect(sheet(gas, 'Game Stats').map((x) => x.opp_rank)).toEqual([12, 30])
  })

  it('an older copy never overwrites a newer rank; re-sending an unchanged rank keeps its editor', () => {
    const { gas, admin } = ready()
    const sam = addTaker(gas, 'Sam')
    const d = teamData()
    post(gas, { ...buildPush(d, [], true), token: admin })
    const newer = { ...d.opponents[0], rank: 3, updated_at: 50 }
    post(gas, { ...buildPush({ ...d, opponents: [newer] }, [{ table: 'opponents', row_id: newer.id, payload: newer }]), token: sam.key })
    // Jacob's device still has the old copy and pushes everything.
    const r = post(gas, { ...buildPush(d, [], true), token: admin })
    expect(r.counts.Opponents).toMatchObject({ upserted: 0, skipped: 1 })
    expect(sheet(gas, 'Opponents')[0]).toMatchObject({ rank: 3, edited_by: 'Sam' })
    expect(get(gas, { action: 'snapshot' }).opponents).toEqual([expect.objectContaining({ rank: 3, edited_by: 'Sam' })])
    // Sam re-sends the same copy (e.g. Push everything): no new edit.
    post(gas, { ...buildPush({ ...d, opponents: [newer] }, [], true), token: sam.key })
    expect(sheet(gas, 'Opponents')[0]).toMatchObject({ rank: 3, edited_by: 'Sam' })
  })

  it('a v4 sheet gets the Opponents tab and the opp_rank column on the next ping', () => {
    const { gas, admin } = ready()
    gas.ss.sheets = gas.ss.sheets.filter((s) => s.name !== 'Opponents')
    const gs = gas.ss.getSheetByName('Game Stats')!
    gs.cells[0] = gs.cells[0].filter((h) => h !== 'opp_rank')
    const r = post(gas, { action: 'ping', token: admin })
    expect(r.tabs.find((t: { name: string }) => t.name === 'Opponents').status).toBe('created')
    expect(r.tabs.find((t: { name: string }) => t.name === 'Game Stats')).toMatchObject({ status: 'headers_added', missing: ['opp_rank'] })
  })
})
