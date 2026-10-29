import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../db/db'
import { saveWho } from '../sync/identity'
import { teamData } from '../sync/snapshotFixture'
import { Home } from './pages/Home'
import { Roster } from './pages/Roster'
import { Settings } from './pages/Settings'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
const flush = () => act(() => new Promise((r) => setTimeout(r, 60)))
const reg = (game_id: string, owner_id: string, owner_name: string) => ({ game_id, owner_id, owner_name, rev: 1, updated_by: owner_name, updated_at: '', deleted: false })

beforeEach(async () => {
  localStorage.clear()
  const d = teamData()
  await Promise.all([db.teams.clear(), db.players.clear(), db.games.clear(), db.points.clear(), db.events.clear(), db.syncQueue.clear(), db.remote.clear()])
  await db.teams.bulkPut(d.teams)
  await db.players.bulkPut(d.players)
  await db.games.bulkPut(d.games)
  await db.points.bulkPut(d.points)
  await db.events.bulkPut(d.events)
  await db.remote.bulkPut([reg('g1', 'admin', 'Jacob'), reg('g2', 'st_sam', 'Sam')])
  saveWho({ role: 'taker', id: 'st_sam', name: 'Sam' })
})
afterEach(cleanup)

describe('shared editing UI', () => {
  it('games list shows who has each game, with Claim / Release for a stat-taker', async () => {
    await db.remote.put(reg('g1', '', ''))
    render(<Home />)
    await flush()
    const badges = screen.getAllByTestId('owner-badge').map((b) => b.textContent)
    expect(badges.sort()).toEqual(['Unowned', 'You'])
    expect(screen.getAllByRole('button', { name: 'Claim' })).toHaveLength(1) // only the unowned game
    expect(screen.getAllByRole('button', { name: 'Release' })).toHaveLength(1) // only his own
    expect(screen.queryByLabelText('Reassign game')).toBeNull() // admin only
  })

  it('a game someone else owns opens read only', async () => {
    window.location.hash = '#/game/g1'
    render(<App />)
    expect((await screen.findByTestId('locked-banner')).textContent).toMatch(/Jacob is editing this game.*ask Jacob to reassign/)
    await screen.findByTestId('team-game')
    expect(document.querySelectorAll('input, textarea').length).toBe(0)
    window.location.hash = '#/'
  })

  it('Settings shows the role and explains a held change with what to do', async () => {
    const d = teamData()
    const e = d.events.find((x) => x.game_id === 'g1')!
    await db.syncQueue.put({ op_id: `events:${e.id}`, table: 'events', row_id: e.id, payload: e, attempts: 0, last_error: 'conflict:not_owner:Jacob' })
    render(<Settings />)
    await flush()
    expect(screen.getByTestId('who').textContent).toMatch(/stat-taker key: Sam/)
    const c = screen.getByTestId('conflicts').textContent!
    expect(c).toMatch(/vs Alpha.*1 change held/)
    expect(c).toMatch(/Jacob is editing this game/)
    expect(screen.getByRole('button', { name: 'Discard my changes' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Claim and retry' })).toBeNull() // Jacob owns it; only he can hand it over
    expect(screen.getByLabelText('Key')).toBeTruthy()
  })

  it('adding a player who is already on the shared roster asks first', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Roster />)
    await flush()
    fireEvent.change(screen.getByPlaceholderText(/name/i), { target: { value: 'a' } })
    fireEvent.change(screen.getByPlaceholderText('#'), { target: { value: '55' } })
    fireEvent.submit(screen.getByPlaceholderText(/name/i).closest('form')!)
    await flush()
    expect(ask).toHaveBeenCalledWith(expect.stringMatching(/A \(#1\) is already on the roster/))
    expect((await db.players.toArray()).length).toBe(4) // nothing added
    // a deleted player with the same number: offer to restore instead
    ask.mockReturnValue(true)
    fireEvent.change(screen.getByPlaceholderText(/name/i), { target: { value: 'Zee' } })
    fireEvent.change(screen.getByPlaceholderText('#'), { target: { value: '99' } })
    fireEvent.submit(screen.getByPlaceholderText(/name/i).closest('form')!)
    await flush()
    expect(ask).toHaveBeenLastCalledWith(expect.stringMatching(/Zed \(left\) \(#99\) was deleted\. Restore/))
    expect((await db.players.get('z'))!.deleted).toBe(false)
    ask.mockRestore()
  })
})
