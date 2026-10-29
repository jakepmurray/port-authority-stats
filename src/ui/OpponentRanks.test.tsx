import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { GameSchema, type Game } from '../domain/schema'
import { SyncError, type UsauFetch } from '../sync/client'
import { OpponentRanks, type FetchRanks } from './OpponentRanks'
import { hashWith } from './queryFilter'

const game = (id: string, opponent: string, date: string): Game =>
  GameSchema.parse({ id, team_id: 't1', opponent, date, ratio_first: 'W4', start_on: 'O', created_at: 1, updated_at: 1 })
const games = [game('g1', 'Disco', '2026-07-01'), game('g2', 'Shame', '2026-08-01'), game('g3', 'Odysee', '2026-08-02'), game('g4', 'Pickup Crew', '2026-08-03'), game('g5', 'Toro', '2025-08-01')]

const PASTE = [
  'Rank\tTeam\tPower Rating\tGender Division',
  '4\tAustin Disco Club\t1981\tMixed',
  '13\tshame.\t1767\tMixed',
  '19\tOdyssée\t1684\tMixed',
  '20\tMischief\t1683\tMixed',
].join('\n')

/** As on the Season page: ranks read live from the database. */
function Live() {
  const opponents = useLiveQuery(() => db.opponents.toArray(), [])
  return opponents ? <OpponentRanks games={games} opponents={opponents} /> : null
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 50)))

beforeEach(async () => {
  await Promise.all([db.opponents.clear(), db.syncQueue.clear(), db.teams.clear()])
  localStorage.setItem('pa:sync:who', JSON.stringify({ role: 'taker', id: 'st_1', name: 'Sam' }))
})
afterEach(cleanup)

describe('opponent ranks', () => {
  it('paste the USAU page, review fuzzy matches, confirm, and only then save', async () => {
    render(<OpponentRanks games={games} opponents={[]} />)
    expect(screen.getByLabelText('Rank season')).toHaveProperty('value', '2026')
    act(() => screen.getByRole('button', { name: 'Paste USAU rankings' }).click())
    fireEvent.change(screen.getByLabelText('Pasted USAU rankings'), { target: { value: PASTE } })
    act(() => screen.getByRole('button', { name: 'Read rankings' }).click())
    const review = screen.getByTestId('rank-review')
    const row = (name: string) => [...review.querySelectorAll('tbody tr')].find((tr) => (tr as HTMLTableRowElement).cells[1].textContent!.startsWith(name)) as HTMLElement
    expect(within(row('Disco')).getByRole('checkbox')).toHaveProperty('checked', true)
    expect(row('Disco').textContent).toMatch(/likely/)
    expect(row('Shame').textContent).toMatch(/exact/)
    expect(row('Pickup Crew').textContent).toMatch(/no match/)
    expect(within(row('Pickup Crew')).getByRole('checkbox')).toHaveProperty('disabled', true)
    expect(review.textContent).not.toMatch(/Toro/) // 2025 game: not in the 2026 list
    expect(await db.opponents.count()).toBe(0) // nothing saved yet

    // Untick Odysee, pick Mischief for Pickup Crew by hand.
    act(() => within(row('Odysee')).getByRole('checkbox').click())
    fireEvent.change(within(row('Pickup Crew')).getByLabelText('USAU team for Pickup Crew'), { target: { value: 'Mischief' } })
    act(() => screen.getByRole('button', { name: 'Save 3 ranks' }).click())
    await flush()
    const saved = (await db.opponents.toArray()).map((o) => [o.name, o.season, o.rank, o.usau_name, o.edited_by]).sort()
    expect(saved).toEqual([
      ['Disco', '2026', 4, 'Austin Disco Club', 'Sam'],
      ['Pickup Crew', '2026', 20, 'Mischief', 'Sam'],
      ['Shame', '2026', 13, 'shame.', 'Sam'],
    ])
    expect((await db.syncQueue.toArray()).filter((o) => o.table === 'opponents')).toHaveLength(3) // queued for the Sheet
  })

  it('says so when the paste has no rankings', () => {
    render(<OpponentRanks games={games} opponents={[]} />)
    act(() => screen.getByRole('button', { name: 'Paste USAU rankings' }).click())
    fireEvent.change(screen.getByLabelText('Pasted USAU rankings'), { target: { value: 'just some text' } })
    act(() => screen.getByRole('button', { name: 'Read rankings' }).click())
    expect(screen.getByRole('status').textContent).toMatch(/No rankings found/)
  })

  it('a rank can be typed by hand, and cleared', async () => {
    render(<Live />)
    await flush()
    expect(screen.queryByLabelText('Rank of Toro')).toBeNull() // Toro played in 2025 only
    fireEvent.change(screen.getByLabelText('Rank of Disco'), { target: { value: '5' } })
    fireEvent.blur(screen.getByLabelText('Rank of Disco'))
    await flush()
    expect(await db.opponents.toArray()).toEqual([expect.objectContaining({ id: 'opp:2026:disco', rank: 5, edited_by: 'Sam' })])
    fireEvent.change(screen.getByLabelText('Rank of Disco'), { target: { value: 'x' } })
    fireEvent.blur(screen.getByLabelText('Rank of Disco'))
    await flush()
    expect((await db.opponents.get('opp:2026:disco'))!.rank).toBe(5) // invalid input is not saved
    fireEvent.change(screen.getByLabelText('Rank of Disco'), { target: { value: '' } })
    fireEvent.blur(screen.getByLabelText('Rank of Disco'))
    await flush()
    expect((await db.opponents.get('opp:2026:disco'))!.rank).toBeNull()
  })

  it('read only (team view): no inputs, no paste, no fetch', () => {
    render(<OpponentRanks games={games} opponents={[]} readOnly />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText('Paste USAU rankings')).toBeNull()
    expect(screen.queryByText('Fetch ranks')).toBeNull()
  })

  it('Fetch ranks: one fetch per click, into the same review, then save', async () => {
    const fetched: UsauFetch = {
      teams: [{ rank: 4, name: 'Austin Disco Club', rating: 1981 }, { rank: 13, name: 'shame.', rating: 1767 }, { rank: 19, name: 'Odyssée', rating: 1684 }],
      total: 214, fetchedAt: '2026-10-29T19:00:00Z', cached: false, sourceUrl: 'https://play.usaultimate.org/teams/events/team_rankings/?RankSet=Club-Mixed',
    }
    const fetchRanks = vi.fn<FetchRanks>(async () => fetched)
    render(<OpponentRanks games={games} opponents={[]} fetchRanks={fetchRanks} />)
    act(() => screen.getByRole('button', { name: 'Fetch ranks' }).click())
    await flush()
    expect(fetchRanks).toHaveBeenCalledTimes(1)
    expect(fetchRanks).toHaveBeenCalledWith('Mixed') // Mixed by default
    expect(screen.getByRole('status').textContent).toMatch(/Fetched from USAU \(Club Mixed.*3 ranked teams/)
    const review = screen.getByTestId('rank-review')
    expect(review.textContent).toMatch(/Austin Disco Club/)
    act(() => screen.getByRole('button', { name: 'Save 3 ranks' }).click())
    await flush()
    expect((await db.opponents.toArray()).map((o) => [o.name, o.rank, o.usau_name]).sort()).toEqual([
      ['Disco', 4, 'Austin Disco Club'], ['Odysee', 19, 'Odyssée'], ['Shame', 13, 'shame.'],
    ])
    // Another division from the panel.
    act(() => screen.getByRole('button', { name: 'Fetch ranks' }).click())
    await flush()
    fireEvent.change(screen.getByLabelText('USAU division'), { target: { value: 'Women' } })
    act(() => screen.getByRole('button', { name: 'Fetch again' }).click())
    await flush()
    expect(fetchRanks.mock.calls.map((c) => c[0])).toEqual(['Mixed', 'Mixed', 'Women'])
  })

  it('Fetch ranks failing (old script) points to paste, and paste still works', async () => {
    const fetchRanks: FetchRanks = async () => {
      throw new SyncError({ kind: 'script', error: 'unknown_action', message: 'old' })
    }
    render(<OpponentRanks games={games} opponents={[]} fetchRanks={fetchRanks} />)
    act(() => screen.getByRole('button', { name: 'Fetch ranks' }).click())
    await flush()
    const status = screen.getByRole('status').textContent!
    expect(status).toMatch(/Couldn’t fetch the ranks: Your Sheet script is older than version 6/)
    expect(status).toMatch(/You can still paste them/)
    expect(screen.queryByTestId('rank-review')).toBeNull()
    expect(screen.getByText(/Backup: open/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Pasted USAU rankings'), { target: { value: PASTE } })
    act(() => screen.getByRole('button', { name: 'Read rankings' }).click())
    expect(screen.getByRole('status').textContent).toMatch(/^Pasted: 4 ranked teams/)
    expect(screen.getByTestId('rank-review')).toBeTruthy()
  })

  it('Fetch ranks without Sheet sync set up says so', async () => {
    localStorage.removeItem('pa:sync')
    render(<OpponentRanks games={games} opponents={[]} />) // the real fetch (no config saved)
    act(() => screen.getByRole('button', { name: 'Fetch ranks' }).click())
    await flush()
    expect(screen.getByRole('status').textContent).toMatch(/needs Sheet sync set up first.*You can still paste/)
  })
})

describe('filter links', () => {
  it('keeps the path and other params, adds the team source in team view', () => {
    const f = { tournament: '', tags: ['wind punt'], tagMode: 'any' as const, tagScope: 'without' as const }
    expect(hashWith('#/season', f)).toBe('#/season?tags=wind+punt&ts=without')
    expect(hashWith('#/team/game/g1?team_src=x&tags=old', f)).toBe('#/team/game/g1?tags=wind+punt&ts=without&team_src=x')
    expect(hashWith('#/team/season', f, 'https://s')).toBe('#/team/season?tags=wind+punt&ts=without&team_src=https%3A%2F%2Fs')
    expect(hashWith('#/season?tags=wind', { ...f, tags: [] })).toBe('#/season')
  })
})
