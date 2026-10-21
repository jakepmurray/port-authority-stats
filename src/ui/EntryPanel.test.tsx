import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveGame } from '../domain/game'
import { builder } from '../domain/fixtures'
import { PlayerSchema } from '../domain/schema'
import { EntryPanel } from './EntryPanel'

const players = [
  ['a', '1', 'W'], ['b', '2', 'W'], ['c', '3', 'W'], ['d', '4', 'W'], ['e', '12', 'M'], ['f', '17', 'M'], ['g', '23', 'M'],
].map(([id, number, g]) => PlayerSchema.parse({ id, team_id: 't1', name: id.toUpperCase(), number, gender_match: g, created_at: 1, updated_at: 1 }))

afterEach(cleanup)

function setup(mode: 'full' | 'quick' = 'full') {
  const b = builder().point('O', players.map((p) => p.id))
  const current = deriveGame(b.game, b.points, b.events).current!
  const onEvent = vi.fn(async () => {})
  const onUndo = vi.fn(async () => {})
  render(
    <EntryPanel
      game={b.game}
      current={current}
      players={players}
      mode={mode}
      stamp={() => ({ video_time: 42, time_source: 'auto' })}
      video={null}
      onEvent={onEvent}
      onUndo={onUndo}
    />,
  )
  const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }))
  const flush = () => act(async () => {})
  return { onEvent, onUndo, key, flush }
}

const types = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => (c as unknown[])[0] as { type: string; actor_id: string | null; receiver_id: string | null })

describe('EntryPanel keyboard flow', () => {
  it('records pickup, passes and a goal from fast typing, with video time', async () => {
    const { onEvent, key, flush } = setup()
    // "1" waits (#12, #17 exist) and "2" waits (#23) → Enter; "3" and "12" commit at once; then G + 23.
    for (const k of ['1', 'Enter', '2', 'Enter', '3', '1', '2', 'g', '2', '3']) key(k)
    await flush()
    const ev = types(onEvent)
    expect(ev.map((e) => e.type)).toEqual(['pickup', 'catch', 'catch', 'catch', 'goal'])
    expect(ev[3]).toMatchObject({ actor_id: 'c', receiver_id: 'e' })
    expect(ev[4]).toMatchObject({ actor_id: 'e', receiver_id: 'g' })
    expect((onEvent.mock.calls[0] as unknown[])[1]).toEqual({ video_time: 42, time_source: 'auto' })
  })

  it('a half-typed number is taken before an action; turnover flips possession for B + number', async () => {
    const { onEvent, key, flush } = setup()
    for (const k of ['2', 't', 'b', '4']) key(k)
    await flush()
    const ev = types(onEvent)
    expect(ev.map((e) => e.type)).toEqual(['pickup', 'throwaway', 'D'])
    expect(ev[1]).toMatchObject({ actor_id: 'b' })
    expect((ev[2] as unknown as { defender_id: string }).defender_id).toBe('d')
  })

  it('quick mode: G asks for assist then scorer; bare numbers are ignored', async () => {
    const { onEvent, key, flush } = setup('quick')
    for (const k of ['3', 'g', '3', '1', '7']) key(k)
    await flush()
    expect(types(onEvent)).toEqual([expect.objectContaining({ type: 'goal', actor_id: 'c', receiver_id: 'f' })])
  })

  it('U undoes; typing in an input is ignored', async () => {
    const { onUndo, onEvent, key, flush } = setup()
    key('u')
    await flush()
    expect(onUndo).toHaveBeenCalledTimes(1)
    const input = document.createElement('input')
    document.body.appendChild(input)
    act(() => void fireEvent.keyDown(input, { key: '2' }))
    await flush()
    expect(onEvent).not.toHaveBeenCalled()
  })
})
