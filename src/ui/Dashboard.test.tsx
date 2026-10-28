import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { builder } from '../domain/fixtures'
import { PlayerSchema } from '../domain/schema'
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
  await Promise.all([db.players.clear(), db.games.clear(), db.points.clear(), db.events.clear()])
  window.location.hash = '#/dashboard'
})
afterEach(cleanup)

describe('Dashboard', () => {
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
