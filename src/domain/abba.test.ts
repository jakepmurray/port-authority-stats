import { describe, expect, it } from 'vitest'
import { checkLine, checkPuller, majorityOf, ratioForPoint } from './abba'

const mk = (n: number, g: 'W' | 'M', active = true) =>
  Array.from({ length: n }, (_, i) => ({ id: `${g}${i}`, name: `${g}${i}`, gender_match: g, active }))
const roster = [...mk(6, 'W'), ...mk(6, 'M')]
const ids = (w: number, m: number) => [...roster.slice(0, w), ...roster.slice(6, 6 + m)].map((p) => p.id)

describe('ratioForPoint (ABBA)', () => {
  it('follows A B B A A B B … from W4', () => {
    const seq = Array.from({ length: 12 }, (_, i) => ratioForPoint('W4', i + 1))
    expect(seq).toEqual(['W4', 'M4', 'M4', 'W4', 'W4', 'M4', 'M4', 'W4', 'W4', 'M4', 'M4', 'W4'])
  })
  it('mirrors when starting M4', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => ratioForPoint('M4', n))).toEqual(['M4', 'W4', 'W4', 'M4', 'M4', 'W4'])
  })
  it('is not reset by halftime (point 9 = A, point 10 = B)', () => {
    expect(ratioForPoint('W4', 9)).toBe('W4')
    expect(ratioForPoint('W4', 10)).toBe('M4')
    expect(ratioForPoint('W4', 29)).toBe('W4')
  })
  it('rejects invalid indexes', () => {
    expect(() => ratioForPoint('W4', 0)).toThrow()
    expect(() => ratioForPoint('W4', 1.5)).toThrow()
  })
  it('majority gender', () => {
    expect(majorityOf('W4')).toBe('W')
    expect(majorityOf('M4')).toBe('M')
  })
})

describe('checkLine', () => {
  it('accepts 4W/3M on a W4 point', () => {
    const r = checkLine(ids(4, 3), roster, 'W4')
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.counts).toEqual({ W: 4, M: 3 })
  })
  it('rejects 3W/4M on a W4 point', () => {
    const r = checkLine(ids(3, 4), roster, 'W4')
    expect(r.ok).toBe(false)
    expect(r.issues.map((i) => i.code)).toContain('over_ratio')
  })
  it('allows a short-handed line that does not exceed the ratio', () => {
    const r = checkLine(ids(4, 2), roster, 'W4')
    expect(r.ok).toBe(true)
    expect(r.issues.map((i) => i.code)).toEqual(['short_handed'])
  })
  it('rejects fewer than 5', () => {
    expect(checkLine(ids(2, 2), roster, 'W4').issues.map((i) => i.code)).toContain('too_few')
  })
  it('rejects 8 players and duplicates', () => {
    expect(checkLine(ids(5, 3), roster, 'W4').ok).toBe(false)
    const dup = [...ids(4, 3).slice(0, 6), 'W0']
    expect(checkLine(dup, roster, 'W4').issues.map((i) => i.code)).toContain('duplicate')
  })
  it('flags unknown and inactive players', () => {
    const r = checkLine([...ids(4, 2), 'ghost'], roster, 'W4')
    expect(r.issues.map((i) => i.code)).toContain('unknown_player')
    const benched = roster.map((p) => (p.id === 'W0' ? { ...p, active: false } : p))
    const r2 = checkLine(ids(4, 3), benched, 'W4')
    expect(r2.ok).toBe(true)
    expect(r2.issues.map((i) => i.code)).toEqual(['inactive'])
  })
})

describe('checkPuller (majority pull)', () => {
  const line = ids(4, 3)
  it('accepts a woman-matching puller on W4', () => {
    expect(checkPuller('W1', line, roster, 'W4')).toEqual([])
  })
  it('rejects a man-matching puller on W4', () => {
    expect(checkPuller('M0', line, roster, 'W4').map((i) => i.code)).toEqual(['wrong_puller'])
  })
  it('accepts a man-matching puller on M4 and warns if not on the line', () => {
    expect(checkPuller('M5', line, roster, 'M4').map((i) => i.code)).toEqual(['puller_not_on_line'])
  })
  it('no puller → no issues', () => {
    expect(checkPuller(null, line, roster, 'W4')).toEqual([])
  })
})
