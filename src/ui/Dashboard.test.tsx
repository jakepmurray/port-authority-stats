import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { builder } from '../domain/fixtures'
import { OpponentSchema, PlayerSchema } from '../domain/schema'
import { Dashboard } from './pages/Dashboard'

beforeAll(() => {
  // Recharts measures its container; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const players = ['a', 'b', 'c'].map((id, i) =>
  PlayerSchema.parse({ id, team_id: 't1', name: id.toUpperCase(), number: String(i + 1), gender_match: i ? 'M' : 'W', created_at: 1, updated_at: 1 }),
)

async function seed() {
  const g = builder({ id: 'g1', opponent: 'Alpha', tournament: 'T1', date: '2026-06-01', game_to: 2 })
  g.point('O', ['a', 'b', 'c']).pass('a', 'b').ev('throwaway', 'us', { actor_id: 'b', tags: ['wind'] }).ev('D', 'us', { defender_id: 'c' }).goal('a', 'c')
  g.point('D', ['a', 'b', 'c']).ev('pull', 'us', { actor_id: 'a' }).ev('throwaway', 'them', { tags: ['wind'] }).goal('c', 'a')
  await db.players.bulkPut(players)
  await db.games.put(g.game)
  await db.points.bulkPut(g.points)
  await db.events.bulkPut(g.events)
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 50)))

beforeEach(async () => {
  await Promise.all([db.players.clear(), db.games.clear(), db.points.clear(), db.events.clear(), db.opponents.clear()])
  window.location.hash = '#/dashboard'
})
afterEach(cleanup)

describe('Dashboard', () => {
  it('who throws to whom: matrix, drill into a pair, top pairs and the gender split', async () => {
    await seed()
    render(<Dashboard />)
    await screen.findByTestId('connections')
    await flush()
    const matrix = screen.getByTestId('pass-matrix')
    expect(matrix.textContent).toMatch(/#1 A/)
    fireEvent.click(screen.getByRole('button', { name: 'A to B: 1 of 1' }))
    await flush()
    expect(screen.getByTestId('drill-title').textContent).toBe('A → B · completions · 1 event')
    fireEvent.click(screen.getByRole('button', { name: 'Comp %' }))
    expect(screen.getByRole('button', { name: 'A to C: 1 of 1' }).textContent).toBe('100%')
    fireEvent.click(screen.getByRole('button', { name: 'Top pairs' }))
    expect(screen.getByTestId('top-connections').textContent).toMatch(/A → B1\/1100%/)
    fireEvent.click(screen.getByRole('button', { name: 'By gender' }))
    const split = screen.getByTestId('gender-split')
    expect(split.textContent).toMatch(/WMP → MMP2/) // A (W) to B and C (M)
    expect(split.textContent).toMatch(/MMP → WMP1/)
    // Min throws hides pairs below it.
    fireEvent.click(screen.getByRole('button', { name: 'Matrix' }))
    fireEvent.change(screen.getByLabelText('Min throws'), { target: { value: '2' } })
    expect(screen.queryByRole('button', { name: 'A to B: 1 of 1' })).toBeNull()
  })

  it('who throws to whom: exclude throwers / receivers / players, shown in a note and kept in the link', async () => {
    await seed()
    render(<Dashboard />)
    await screen.findByTestId('connections')
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'By gender' }))
    const split = () => screen.getByTestId('gender-split').textContent
    expect(split()).toMatch(/WMP → MMP2/)
    // Exclude receiver B: search, pick.
    const recv = screen.getByLabelText('Exclude receivers')
    fireEvent.focus(recv)
    fireEvent.change(recv, { target: { value: 'b' } })
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Exclude receivers options' })).getByRole('button', { name: '#2 B' }))
    expect(split()).toMatch(/WMP → MMP1/) // only A → C left
    expect(split()).toMatch(/MMP → WMP1/)
    expect(screen.getByTestId('conn-exclusions').textContent).toMatch(/^Excluding receivers: B\./)
    expect(window.location.hash).toBe('#/dashboard?cv=gender&cxr=b')
    // Exclude thrower C (by number, Enter picks the first match).
    const thr = screen.getByLabelText('Exclude throwers')
    fireEvent.focus(thr)
    fireEvent.change(thr, { target: { value: '#3' } })
    fireEvent.keyDown(thr, { key: 'Enter' })
    expect(split()).toMatch(/MMP → WMP0/)
    expect(screen.getByTestId('conn-exclusions').textContent).toMatch(/Excluding throwers: C · Excluding receivers: B/)
    // Every view agrees: the matrix no longer has A → B.
    fireEvent.click(screen.getByRole('button', { name: 'Matrix' }))
    expect(screen.queryByRole('button', { name: 'A to B: 1 of 1' })).toBeNull()
    expect(screen.getByRole('button', { name: 'A to C: 1 of 1' })).toBeTruthy()
    // A dashboard filter change keeps the card's settings in the link.
    fireEvent.click(screen.getByRole('button', { name: /wind/ }))
    await flush()
    expect(window.location.hash).toBe('#/dashboard?tags=wind&cxt=c&cxr=b')
    // Chips remove; "exclude entirely" drops both directions.
    fireEvent.click(screen.getByRole('button', { name: 'Stop excluding B (not receiver)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear exclusions' }))
    expect(screen.queryByTestId('conn-exclusions')).toBeNull()
    const any = screen.getByLabelText('Exclude player')
    fireEvent.focus(any)
    fireEvent.change(any, { target: { value: 'A' } })
    fireEvent.keyDown(any, { key: 'Enter' })
    expect(screen.getByText('No throws with both thrower and receiver in view.')).toBeTruthy() // every pair involves A
  })

  it('who throws to whom: opens with the settings from a shared link', async () => {
    await seed()
    window.location.hash = '#/dashboard?cv=gender&cm=pct&cmin=1&co=Alpha&cxr=b'
    render(<Dashboard />)
    await screen.findByTestId('connections')
    await flush()
    expect(screen.getByRole('button', { name: 'By gender' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Comp %' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Opponent')).toHaveProperty('value', 'Alpha')
    expect(screen.getByTestId('conn-exclusions').textContent).toMatch(/Excluding receivers: B/)
    expect(screen.getByTestId('gender-split').textContent).toMatch(/WMP → MMP1/)
  })

  it('hold/break vs opponent rank: asks for ranks, then plots ranked games', async () => {
    await seed()
    render(<Dashboard />)
    await screen.findByTestId('kpis')
    await flush()
    expect(screen.getByTestId('rank-chart').textContent).toMatch(/No opponent ranks yet.*Season page/)
    await db.opponents.put(OpponentSchema.parse({ id: 'opp:all:alpha', team_id: 't1', name: 'alpha', rank: 8, created_at: 1, updated_at: 1 }))
    await flush()
    expect(screen.getByTestId('rank-chart').textContent).not.toMatch(/No opponent ranks/)
    expect(screen.getByText(/left = stronger opponents/)).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /Trend line/ })).toHaveProperty('checked', true)
  })

  it('shows the empty state with no games', async () => {
    render(<Dashboard />)
    expect(await screen.findByTestId('dash-empty')).toBeTruthy()
  })

  it('renders KPIs and writes tag filters into the hash', async () => {
    await seed()
    render(<Dashboard />)
    await screen.findByTestId('kpis')
    await flush()
    expect(screen.getByTestId('kpi-record').textContent).toContain('1–0')
    expect(screen.getByTestId('kpi-hold').textContent).toContain('100%')
    expect(screen.getByTestId('kpi-break').textContent).toContain('100%')
    expect(screen.getByTestId('dash-lowdata')).toBeTruthy()

    // Tag chip: only "wind" events counted → 1 of our turns, 0 Ds.
    fireEvent.click(screen.getByRole('button', { name: /wind/ }))
    await flush()
    expect(window.location.hash).toBe('#/dashboard?tags=wind')
    expect(screen.getByTestId('kpi-ds_pp').textContent).toContain('0.00')
    expect(screen.getByTestId('dash-footnotes').textContent).toContain('only include events tagged “wind”')

    // KPI drill-down lists the tagged turnover.
    fireEvent.click(screen.getByTestId('kpi-turns_pp'))
    await flush()
    expect(screen.getByTestId('drill-title').textContent).toContain('1 event')
    expect(screen.getByTestId('drill-list').textContent).toContain('wind')
  })

  it('reads filters from the hash and shows the no-match state', async () => {
    await seed()
    window.location.hash = '#/dashboard?t=Nope'
    render(<Dashboard />)
    expect(await screen.findByTestId('dash-nomatch')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    await flush()
    expect(window.location.hash).toBe('#/dashboard')
    expect(screen.getByTestId('kpis')).toBeTruthy()
  })
})
