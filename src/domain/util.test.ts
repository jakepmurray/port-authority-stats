import { describe, expect, it } from 'vitest'
import { makeBackup, mergeRows, parseBackup } from './backup'
import { toCsv } from './csv'
import { builder } from './fixtures'
import { formatClock, parseClock } from './time'
import { parseYouTubeId, parseYouTubeStart } from './youtube'

describe('parseYouTubeId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=42', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ&list=x', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('%s', (url, id) => expect(parseYouTubeId(url)).toBe(id))
  it('rejects non-YouTube input', () => {
    expect(parseYouTubeId('https://vimeo.com/123')).toBeNull()
    expect(parseYouTubeId('hello world')).toBeNull()
    expect(parseYouTubeId('https://www.youtube.com/watch?v=short')).toBeNull()
  })
  it('reads start times', () => {
    expect(parseYouTubeStart('https://youtu.be/dQw4w9WgXcQ?t=90')).toBe(90)
    expect(parseYouTubeStart('https://youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toBe(90)
    expect(parseYouTubeStart('https://youtu.be/dQw4w9WgXcQ')).toBeNull()
  })
})

describe('clock', () => {
  it('formats and parses', () => {
    expect(formatClock(75.4)).toBe('1:15')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(null)).toBe('–')
    expect(parseClock('1:15')).toBe(75)
    expect(parseClock('1:02:05')).toBe(3725)
    expect(parseClock('75.5')).toBe(75.5)
    expect(parseClock('')).toBeNull()
    expect(parseClock('a:b')).toBeNaN()
  })
})

describe('csv', () => {
  it('quotes and joins', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"', c: null, d: ['p', 'q'] }])).toBe('a,b,c,d\n"x,y","say ""hi""",,p;q\n')
    expect(toCsv([{ a: 1, b: 2 }], ['b'])).toBe('b\n2\n')
  })
})

describe('backup', () => {
  it('round-trips and validates', () => {
    const b = builder().point('O').goal('a', 'b')
    const bk = makeBackup({ teams: [], players: [], games: [b.game], points: b.points, events: b.events }, 5)
    const back = parseBackup(JSON.stringify(bk))
    expect(back.events).toHaveLength(1)
    expect(() => parseBackup('{')).toThrow('Not a JSON file')
    expect(() => parseBackup(JSON.stringify({ ...bk, app: 'other' }))).toThrow('Not a valid backup')
    expect(() => parseBackup(JSON.stringify({ ...bk, schema_version: 99 }))).toThrow('newer')
  })
  it('merge keeps the newer row', () => {
    const old = [{ id: 'a', updated_at: 5 }, { id: 'b', updated_at: 5 }]
    const inc = [{ id: 'a', updated_at: 4 }, { id: 'b', updated_at: 6 }, { id: 'c', updated_at: 1 }]
    expect(mergeRows(old, inc).map((r) => r.id)).toEqual(['b', 'c'])
  })
})

import { eventsCsv, gamesCsv, playerStatsCsv, pointsCsv } from './exports'
import { PlayerSchema } from './schema'

describe('CSV exports', () => {
  const b = builder({ video: { kind: 'youtube', youtube_id: 'dQw4w9WgXcQ', url: null, offset_s: 0 } })
  const players = ['a', 'b'].map((id, i) =>
    PlayerSchema.parse({ id, team_id: 't1', name: id.toUpperCase(), number: String(i + 1), gender_match: 'W', created_at: 1, updated_at: 1 }),
  )
  b.point('O', ['a', 'b']).ev('pickup', 'us', { actor_id: 'a', video_time: 61.2 }).goal('a', 'b')
  b.ev('note', 'us', { deleted: true })
  const d = { players, games: [b.game], points: b.points, events: b.events }

  it('exports events with names and YouTube deep links, skipping deleted', () => {
    const csv = eventsCsv(d)
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('https://youtu.be/dQw4w9WgXcQ?t=61')
    expect(lines[2]).toContain('goal,us,1,A,2,B')
  })
  it('exports games, points and player stats', () => {
    expect(gamesCsv(d)).toContain(',1,0,in progress,')
    expect(pointsCsv(d).split('\n')[1]).toContain('1 2')
    const ps = playerStatsCsv(d).split('\n')
    expect(ps[0]).toContain('goals')
    expect(ps).toHaveLength(4)
  })
})

describe('backup from schema v1', () => {
  it('marks UltiAnalytics imports ended, leaves other games open', () => {
    const ua = builder({ id: 'ua', notes: 'Imported [ultianalytics:x]', updated_at: 77 }).game
    const film = builder({ id: 'film' }).game
    const bk = { ...makeBackup({ teams: [], players: [], games: [ua, film], points: [], events: [] }, 5), schema_version: 1 }
    const back = parseBackup(JSON.stringify(bk))
    expect(back.games.find((g) => g.id === 'ua')!.ended_at).toBe(77)
    expect(back.games.find((g) => g.id === 'film')!.ended_at).toBeNull()
  })
})
