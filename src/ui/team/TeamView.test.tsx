import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The database is chosen at load from the hash, exactly like opening a team view link.
const SRC = 'https://script.google.com/macros/s/AKfyc_team/exec'
vi.hoisted(() => {
  window.location.hash = `#/team?src=${encodeURIComponent('https://script.google.com/macros/s/AKfyc_team/exec')}`
})

import { db, StatsDB, TEAM_DB_NAME, TEAM_MODE } from '../../db/db'
import { repo } from '../../db/repo'
import { get, loadGas, post } from '../../sync/gasMock'
import { buildPush } from '../../sync/payload'
import { teamData } from '../../sync/snapshotFixture'
import { teamLink } from '../../team/link'
import type { FetchFn } from '../../team/load'
import { TeamLinkCard } from '../pages/Settings'
import { TeamView } from './TeamView'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

/** A deployed v3 script with Jacob's data pushed, reached through fetch (GET). */
function liveScript() {
  const gas = loadGas()
  gas.setup()
  const token = gas.logs.at(-1)!
  post(gas, { ...buildPush(teamData(), [], true), token })
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(get(gas, Object.fromEntries(new URL(url).searchParams))), { status: 200 })
  }
  return { gas, token, fetchFn, calls }
}

const mainDb = new StatsDB() // the visitor's own data
const flush = () => act(() => new Promise((r) => setTimeout(r, 60)))
/** Wait until the fetch finished and the copy is stored. */
const loaded = async () => {
  await screen.findByText(/updated/, {}, { timeout: 3000 })
  await flush()
}

beforeEach(async () => {
  localStorage.clear()
  window.location.hash = `#/team?src=${encodeURIComponent(SRC)}`
  await Promise.all([mainDb.games.clear(), mainDb.syncQueue.clear()])
  await mainDb.games.put({ ...teamData().games[0], id: 'mine', opponent: 'My Own Local Game' })
})
afterEach(cleanup)

describe('team view (read only)', () => {
  it('opens the team view database, not the visitor’s own', () => {
    expect(TEAM_MODE).toBe(true)
    expect(db.name).toBe(TEAM_DB_NAME)
    expect(db.name).not.toBe(mainDb.name)
  })

  it('loads the snapshot with a plain GET (no token) and shows games, banner and no edit controls', async () => {
    const { fetchFn, calls, token } = liveScript()
    render(<TeamView route={['team']} fetchFn={fetchFn} />)
    await loaded()
    const list = screen.getByTestId('team-games')
    expect(within(list).getByText('vs Alpha')).toBeTruthy()
    expect(within(list).getByText('vs Bravo')).toBeTruthy()
    expect(screen.queryByText(/Deleted Opp/)).toBeNull()
    expect(screen.queryByText(/My Own Local Game/)).toBeNull()
    expect(screen.getByTestId('team-banner').textContent).toMatch(/Team view — read only.*updated/)
    await act(() => new Promise((r) => setTimeout(r, 300)))
    expect(calls).toHaveLength(1) // one fetch per visit (no refresh loop)
    expect(calls[0].url).toBe(`${SRC}?action=snapshot`)
    expect(calls[0].init.method).toBe('GET')
    expect(calls[0].init.credentials).toBe('omit')
    expect(calls[0].init.headers).toBeUndefined() // simple request: no CORS preflight
    expect(calls[0].url + JSON.stringify(calls[0].init)).not.toContain(token)
    // no editing or sync controls anywhere
    expect(screen.queryByText(/New game/)).toBeNull()
    expect(screen.queryByText(/Settings/)).toBeNull()
    expect(screen.queryByTestId('sync-badge')).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Refresh'])
  })

  it('game page shows stats and the play-by-play, read only', async () => {
    const { fetchFn } = liveScript()
    render(<TeamView route={['team', 'game', 'g1']} fetchFn={fetchFn} />)
    await loaded()
    await screen.findByTestId('team-game')
    expect(screen.getByRole('heading', { name: 'vs Alpha' })).toBeTruthy()
    expect(screen.getByTestId('team-pbp').textContent).toMatch(/Point 1/)
    expect(document.querySelectorAll('input, textarea, select').length).toBe(0)
    // only view controls: refresh, and the (closed) tag filter with its share link
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Refresh', 'Tag filter ▾', 'Copy link'])
  })

  it('game page tag filter comes from the link and changes the numbers', async () => {
    const { fetchFn } = liveScript()
    window.location.hash = `#/team/game/g1?tags=wind&ts=without&team_src=${encodeURIComponent(SRC)}`
    render(<TeamView route={['team', 'game', 'g1']} fetchFn={fetchFn} />)
    await loaded()
    await screen.findByTestId('team-game')
    const turns = () => screen.getByText('Turns').parentElement!.textContent
    expect(turns()).toBe('Turns0') // the wind throwaway is left out
    expect(screen.getByTestId('table-filter-note').textContent).toMatch(/not tagged “wind”/)
    act(() => screen.getByRole('button', { name: /^Clear$/ }).click())
    await flush()
    expect(turns()).toBe('Turns1')
    expect(window.location.hash).toBe(`#/team/game/g1?team_src=${encodeURIComponent(SRC)}`)
  })

  it('season page: games table with opponent rank, read-only ranks, shareable tag filter', async () => {
    const { fetchFn } = liveScript()
    window.location.hash = `#/team/season?team_src=${encodeURIComponent(SRC)}`
    render(<TeamView route={['team', 'season']} fetchFn={fetchFn} />)
    await loaded()
    const table = await screen.findByTestId('game-stats-table')
    const alpha = within(table).getByText(/Alpha/).closest('tr')!
    expect(alpha.textContent).toMatch(/Alpha12/) // USAU #12 in 2026
    expect(within(table).getByText(/Bravo/).closest('tr')!.textContent).toMatch(/Bravo–/)
    const ranks = screen.getByTestId('opponent-ranks')
    expect(within(ranks).queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryByText(/Paste USAU rankings/)).toBeNull()
    act(() => screen.getByRole('button', { name: /Tag filter/ }).click())
    act(() => screen.getByRole('button', { name: /wind/ }).click())
    await flush()
    expect(window.location.hash).toBe(`#/team/season?tags=wind&team_src=${encodeURIComponent(SRC)}`)
    expect(screen.getByTestId('table-filter-note').textContent).toMatch(/only include events tagged “wind”/)
  })

  it('dashboard renders from the snapshot and keeps filter links under #/team', async () => {
    const { fetchFn } = liveScript()
    render(<TeamView route={['team', 'dashboard']} fetchFn={fetchFn} />)
    await loaded()
    await screen.findByTestId('kpis', {}, { timeout: 3000 })
    await flush()
    expect(screen.getByTestId('kpi-record').textContent).toContain('1–0')
    expect(screen.getByRole('button', { name: /^A to B: 2 of 2/ })).toBeTruthy() // who throws to whom works read-only
    expect(screen.getByTestId('rank-chart')).toBeTruthy()
    act(() => screen.getByRole('button', { name: /wind/ }).click())
    await flush()
    // the shared dashboard link keeps the source, so it opens for a teammate who never visited
    expect(window.location.hash).toBe(`#/team/dashboard?tags=wind&team_src=${encodeURIComponent(SRC)}`)
  })

  it('every write is refused, and the visitor’s own data and sync queue are untouched', async () => {
    const { fetchFn } = liveScript()
    render(<TeamView route={['team']} fetchFn={fetchFn} />)
    await loaded()
    await expect(repo.create('players', { team_id: 't1', name: 'Hacker', number: '0', gender_match: 'M' })).rejects.toThrow(/read only/)
    await expect(db.games.put({ ...teamData().games[0], opponent: 'x' })).rejects.toThrow(/read only/)
    await expect(db.games.clear()).rejects.toThrow(/read only/)
    expect((await db.games.toArray()).map((g) => g.id).sort()).toEqual(['g1', 'g2'])
    expect((await mainDb.games.toArray()).map((g) => g.opponent)).toEqual(['My Own Local Game'])
    expect(await mainDb.syncQueue.count()).toBe(0)
  })

  it('an older script without the snapshot says so in plain words', async () => {
    const old: FetchFn = async () => new Response(JSON.stringify({ ok: true, app: 'port-authority-stats', version: 2, message: 'Sync endpoint is up.' }))
    render(<TeamView route={['team']} fetchFn={old} />)
    expect((await screen.findByTestId('team-error')).textContent).toMatch(/older version.*paste the new Code\.gs/)
  })

  it('a network failure keeps the last copy and says so', async () => {
    const { fetchFn } = liveScript()
    const first = render(<TeamView route={['team']} fetchFn={fetchFn} />)
    await loaded()
    first.unmount()
    const down: FetchFn = () => Promise.reject(new TypeError('Failed to fetch'))
    render(<TeamView route={['team']} fetchFn={down} />)
    const err = await screen.findByTestId('team-error')
    expect(err.textContent).toMatch(/Could not reach.*Showing the copy from/)
    expect(await screen.findByText('vs Alpha')).toBeTruthy()
  })

  it('no snapshot yet → tells the stat keeper to Push everything', async () => {
    const gas = loadGas()
    gas.setup()
    const f: FetchFn = async (url) => new Response(JSON.stringify(get(gas, Object.fromEntries(new URL(url).searchParams))))
    window.location.hash = '#/team'
    localStorage.setItem('pa:team:src', SRC) // remembered from an earlier visit
    render(<TeamView route={['team']} fetchFn={f} />)
    expect((await screen.findByTestId('team-error')).textContent).toMatch(/Push everything/)
  })
})

describe('Settings: Copy team view link', () => {
  it('builds the link from the web app URL only (never the token)', async () => {
    const write = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    render(<TeamLinkCard url={SRC} />)
    const box = screen.getByLabelText('Team view link') as HTMLInputElement
    const expected = teamLink(window.location.origin + window.location.pathname, SRC)
    expect(box.value).toBe(expected)
    expect(expected).toMatch(/#\/team\?src=https%3A%2F%2Fscript\.google\.com%2Fmacros%2Fs%2FAKfyc_team%2Fexec$/)
    act(() => screen.getByRole('button', { name: 'Copy team view link' }).click())
    await flush()
    expect(write).toHaveBeenCalledWith(expected)
  })
})
