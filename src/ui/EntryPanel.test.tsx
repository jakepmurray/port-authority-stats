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

function setup(mode: 'full' | 'quick' = 'full', askTags = false) {
  const b = builder().point('O', players.map((p) => p.id))
  const current = deriveGame(b.game, b.points, b.events).current!
  const onEvent = vi.fn(async () => {})
  const onUndo = vi.fn(async () => {})
  const onTag = vi.fn(async (_id: string, _tags: string[]) => {})
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
      askTags={askTags}
      tagChoices={['receiver error', 'difficult throw', 'great D', 'wind']}
      onTag={onTag}
    />,
  )
  const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }))
  const flush = () => act(async () => {})
  return { onEvent, onUndo, onTag, key, flush }
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

describe('quick tag step after a turnover', () => {
  const id = (fn: ReturnType<typeof vi.fn>, i: number) => ((fn.mock.calls[i] as unknown[])[0] as { id: string }).id

  it('number keys toggle tags, Enter saves them on that event, then numbers mean players again', async () => {
    const { onEvent, onTag, key, flush } = setup('full', true)
    for (const k of ['2', 't', '1', '4', '2', '2', 'Enter', 'b', '3']) key(k)
    await flush()
    const ev = types(onEvent)
    expect(ev.map((e) => e.type)).toEqual(['pickup', 'throwaway', 'D'])
    expect(ev[1]).toMatchObject({ actor_id: 'b' }) // still the thrower's throwaway
    expect(onTag).toHaveBeenCalledTimes(1)
    expect(onTag.mock.calls[0]).toEqual([id(onEvent, 1), ['receiver error', 'wind']])
  })

  it('Esc skips; an action key saves what was picked and carries on', async () => {
    const { onEvent, onTag, key, flush } = setup('full', true)
    for (const k of ['2', 't', '1', 'Escape']) key(k)
    await flush()
    expect(onTag).not.toHaveBeenCalled()
    // B 3 = our block → tag step; Enter with nothing picked saves nothing; then #3 picks up and hits #2.
    for (const k of ['b', '3', 'Enter', '3', '2', 'Enter']) key(k)
    await flush()
    expect(types(onEvent).map((e) => e.type)).toEqual(['pickup', 'throwaway', 'D', 'pickup', 'catch'])
    expect(onTag).not.toHaveBeenCalled()
    // Throwaway, then B 4 block, pick "great D" (3), then X: saved before the next action.
    for (const k of ['t', 'b', '4', '3', 'x']) key(k)
    await flush()
    expect(onTag).toHaveBeenCalledTimes(1) // the throwaway's step was left untouched by B; the block got 'great D'
    expect(onTag.mock.calls[0]).toEqual([id(onEvent, 6), ['great D']])
  })

  it('no prompt when turned off, and none for non-turnovers', async () => {
    const { onEvent, onTag, key, flush } = setup('full', false)
    for (const k of ['2', 't', '1']) key(k)
    await flush()
    expect(onTag).not.toHaveBeenCalled()
    expect(types(onEvent).map((e) => e.type)).toEqual(['pickup', 'throwaway'])
  })
})
