import { describe, expect, it } from 'vitest'
import { buildGameRows, DEFAULT_FILTER, kpis, totals } from './dashboard'
import { builder } from './fixtures'
import { deriveGame, usesClock } from './game'
import { GameSchema } from './schema'
import { gameRow, gameStatsRow } from '../sync/sheetRows'
import { computeGameStats } from './stats'

const NO_CAPS = { half: null, soft: null, hard: null }

describe('manual end', () => {
  it('ends at the recorded score, any score or clock, with W/L/T', () => {
    const b = builder({ game_to: 15 }).point('O').goal('a', 'b').point('D').themGoal().point('O').goal('a', 'b') // 2–1
    expect(deriveGame(b.game, b.points, b.events)).toMatchObject({ over: false, ended: false, result: null })
    const ended = { ...b.game, ended_at: 1000 }
    expect(deriveGame(ended, b.points, b.events)).toMatchObject({ over: true, ended: true, reachedTarget: false, winner: 'us', result: 'W', score: { us: 2, them: 1 } })
    b.point('D').themGoal() // 2–2
    expect(deriveGame({ ...b.game, ended_at: 1 }, b.points, b.events)).toMatchObject({ result: 'T', winner: null })
  })

  it('ending mid-point leaves that point unscored and closes it', () => {
    const b = builder().point('O').goal('a', 'b').point('D').ev('pull', 'us')
    const open = deriveGame(b.game, b.points, b.events)
    expect(open.current?.point.idx).toBe(2)
    const st = deriveGame({ ...b.game, ended_at: 5 }, b.points, b.events)
    expect(st.current).toBeNull()
    expect(st.score).toEqual({ us: 1, them: 0 })
    expect(st.result).toBe('W')
  })

  it('reaching the target finishes the game but does not lock it', () => {
    const b = builder({ game_to: 2 }).point('O').goal('a', 'b').point('D').goal('a', 'b') // 2–0
    let st = deriveGame(b.game, b.points, b.events)
    expect(st).toMatchObject({ over: true, reachedTarget: true, ended: false, result: 'W' })
    b.point('O').themGoal().point('D') // played on: 2–1, point in progress
    st = deriveGame(b.game, b.points, b.events)
    expect(st.current?.point.idx).toBe(4)
    expect(st.score).toEqual({ us: 2, them: 1 })
  })

  it('legacy games (no ended_at / use_clock) are open and clockless', () => {
    const g = { ...builder().game } as Record<string, unknown>
    delete g.ended_at
    delete g.use_clock
    const game = g as unknown as ReturnType<typeof GameSchema.parse>
    expect(deriveGame(game, [], []).ended).toBe(false)
    expect(usesClock(game)).toBe(false)
    expect(GameSchema.parse({ id: 'x', team_id: 't', opponent: 'O', ratio_first: 'W4', start_on: 'O', created_at: 1, updated_at: 1 })).toMatchObject({ use_clock: false, ended_at: null })
  })
})

describe('cap went off markers', () => {
  it('soft cap between points (on the last finished point): target = higher score + 1 at once', () => {
    const b = builder({ game_to: 15 })
    for (let i = 0; i < 6; i++) b.point('O').goal('a', 'b') // 6–0
    b.point('D').themGoal().ev('cap', 'us', { tags: ['soft'] }) // 6–1, then cap between points
    const st = deriveGame(b.game, b.points, b.events)
    expect(st.target).toBe(7)
    expect(st.over).toBe(false)
    expect(st.pendingCap).toBeNull()
  })

  it('soft cap mid-point is pending until the point ends', () => {
    const b = builder({ game_to: 15 }).point('O').goal('a', 'b').point('D').ev('cap', 'us', { tags: ['soft'] })
    let st = deriveGame(b.game, b.points, b.events)
    expect(st.pendingCap).toBe('soft')
    expect(st.target).toBe(15)
    b.themGoal() // 1–1 → to 2
    st = deriveGame(b.game, b.points, b.events)
    expect(st.target).toBe(2)
    expect(st.pendingCap).toBeNull()
  })

  it('hard cap between points: over unless tied, then one more point', () => {
    const b = builder().point('O').goal('a', 'b').point('D').goal('a', 'b').ev('cap', 'us', { tags: ['hard'] }) // 2–0
    expect(deriveGame(b.game, b.points, b.events)).toMatchObject({ over: true, ended: false, result: 'W' })
    const t = builder().point('O').goal('a', 'b').point('D').themGoal().ev('cap', 'us', { tags: ['hard'] }) // 1–1
    const st = deriveGame(t.game, t.points, t.events)
    expect(st).toMatchObject({ over: false, target: 2 })
  })

  it('a cap that is not configured for the game is a marker only', () => {
    const b = builder({ caps: NO_CAPS, game_to: 15 }).point('O').goal('a', 'b').ev('cap', 'us', { tags: ['hard'] })
    const st = deriveGame(b.game, b.points, b.events)
    expect(st.capsCalled.hard).toBe(true)
    expect(st).toMatchObject({ over: false, target: 15 })
    expect(st.capsConfigured).toEqual({ half: false, soft: false, hard: false })
  })
})

describe('season record and Sheet rows with manual end', () => {
  function season() {
    const a = builder({ id: 'a', opponent: 'A', date: '2026-06-01', game_to: 15 }).point('O').goal('a', 'b').point('D').themGoal().point('O').goal('a', 'b') // 2–1 unfinished
    const t = builder({ id: 't', opponent: 'T', date: '2026-06-02', game_to: 15 }).point('O').goal('a', 'b').point('D').themGoal() // 1–1
    for (const p of t.points) p.id = `t-${p.id}`
    for (const e of t.events) e.point_id = `t-${e.point_id}`
    return { a, t }
  }
  it('unfinished games count once ended; ties are T', () => {
    const { a, t } = season()
    const data = (ended: boolean) => ({
      games: [{ ...a.game, ended_at: ended ? 1 : null }, { ...t.game, ended_at: ended ? 1 : null }],
      points: [...a.points, ...t.points],
      events: [...a.events, ...t.events],
    })
    expect(totals(buildGameRows(data(false), DEFAULT_FILTER)).record).toEqual({ w: 0, l: 0, t: 0, other: 2 })
    const rows = buildGameRows(data(true), DEFAULT_FILTER)
    expect(totals(rows).record).toEqual({ w: 1, l: 0, t: 1, other: 0 })
    expect(kpis(rows).find((k) => k.key === 'record')!.display).toBe('1–0–1')
    expect(kpis(buildGameRows(data(false), DEFAULT_FILTER)).find((k) => k.key === 'record')!.display).toBe('0–0 (+2 open)')
  })
  it('the Sheet Games tab carries ended_at and the clock flag; Game Stats the result', () => {
    const { t } = season()
    const g = { ...t.game, ended_at: Date.UTC(2026, 5, 2, 18), use_clock: false }
    expect(gameRow(g)).toMatchObject({ ended_at: '2026-06-02T18:00:00.000Z', game_clock: false })
    expect(gameRow({ ...g, ended_at: null })).toMatchObject({ ended_at: '' })
    expect(gameStatsRow(g, computeGameStats(g, t.points, t.events)).result).toBe('T')
    expect(gameStatsRow(t.game, computeGameStats(t.game, t.points, t.events)).result).toBe('in progress')
  })
})
