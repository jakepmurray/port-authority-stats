import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { actions } from '../db/actions'
import { db } from '../db/db'
import { deriveGame } from '../domain/game'
import type { Game } from '../domain/schema'
import { GameControls } from './GameEnd'
import type { VideoController } from './video/controller'
import { Transport } from './video/VideoPane'

function Harness({ id }: { id: string }) {
  const data = useLiveQuery(async () => ({ g: await db.games.get(id), p: await db.points.toArray(), e: await db.events.toArray() }), [id])
  if (!data?.g) return null
  const st = deriveGame(data.g, data.p, data.e)
  return (
    <div>
      <span data-testid="score">{st.score.us}–{st.score.them} target {st.target} {st.result ?? 'open'}</span>
      <GameControls game={data.g} state={st} stamp={() => ({ video_time: 754, time_source: 'auto' })} onError={(m) => { throw new Error(m) }} />
    </div>
  )
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 60)))
const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }))

beforeEach(async () => {
  await Promise.all([db.games.clear(), db.points.clear(), db.events.clear()])
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('End game and Cap went off controls', () => {
  it('K opens the cap menu, 2 marks a soft cap at the film time; E asks, then ends; Reopen undoes', async () => {
    const g = await actions.createGame({ opponent: 'Rival', ratio_first: 'W4', start_on: 'O', game_to: 15 })
    const p = await actions.startPoint(g.id, { line: [] })
    await actions.addEvent(p.id, { type: 'goal', team: 'us', actor_id: null, receiver_id: null, defender_id: null, tags: [] }, { video_time: 700, time_source: 'auto' })
    render(<Harness id={g.id} />)
    await flush()
    expect(screen.getByTestId('score').textContent).toBe('1–0 target 15 open')

    key('k')
    expect(screen.getByTestId('cap-menu').textContent).toContain('after point 1')
    expect(screen.getByTestId('cap-menu').textContent).toContain('12:34')
    key('2')
    await flush()
    expect(screen.queryByTestId('cap-menu')).toBeNull()
    expect(screen.getByTestId('score').textContent).toBe('1–0 target 2 open')
    const cap = (await db.events.toArray()).find((e) => e.type === 'cap')!
    expect(cap).toMatchObject({ tags: ['soft'], video_time: 754 })

    const no = vi.spyOn(window, 'confirm').mockReturnValue(false)
    key('e')
    await flush()
    expect(no).toHaveBeenCalledOnce()
    expect((await db.games.get(g.id))!.ended_at).toBeNull()

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    key('E')
    await flush()
    expect(screen.getByTestId('game-ended').textContent).toContain('Ended · W')
    expect(screen.getByTestId('score').textContent).toBe('1–0 target 2 W')

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await flush()
    expect((await db.games.get(g.id))!.ended_at).toBeNull()
    expect(screen.getByRole('button', { name: /End game/ })).toBeTruthy()
  })
})

describe('game clock toggle', () => {
  const status = { ready: true, time: 3000, playing: false, rate: 1, duration: 4000 }
  const c = {
    subscribe: () => () => {},
    getStatus: () => status,
  } as unknown as VideoController
  const game = (use_clock: boolean) =>
    ({ id: 'g', video: { kind: 'youtube', youtube_id: 'abc', url: null, offset_s: 300 }, use_clock }) as unknown as Game
  it('shows the game clock and Set game start only when the clock is on', () => {
    render(<Transport c={c} game={game(false)} />)
    expect(screen.queryByText(/Game clock/)).toBeNull()
    cleanup()
    render(<Transport c={c} game={game(true)} />)
    expect(screen.getByText(/Game clock 45′/)).toBeTruthy()
  })
})
