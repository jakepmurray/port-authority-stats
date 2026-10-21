import { describe, expect, it } from 'vitest'
import { EventSchema, GameSchema, PlayerSchema, USAU_2026_CAPS } from './schema'

const meta = { created_at: 1, updated_at: 1 }

describe('schemas', () => {
  it('fills game defaults with USAU 2026 settings', () => {
    const g = GameSchema.parse({ id: 'g', team_id: 't', opponent: 'X', ratio_first: 'W4', start_on: 'O', ...meta })
    expect(g.game_to).toBe(15)
    expect(g.caps).toEqual(USAU_2026_CAPS)
    expect(g.timeouts_per_half).toBe(2)
    expect(g.deleted).toBe(false)
    expect(g.edited_at).toBeNull()
  })

  it('rejects bad jersey numbers', () => {
    const base = { id: 'p', team_id: 't', name: 'A', gender_match: 'W', ...meta }
    expect(PlayerSchema.safeParse({ ...base, number: '7' }).success).toBe(true)
    expect(PlayerSchema.safeParse({ ...base, number: '100' }).success).toBe(false)
    expect(PlayerSchema.safeParse({ ...base, number: 'x' }).success).toBe(false)
  })

  it('validates event types', () => {
    const base = { id: 'e', game_id: 'g', point_id: 'p', seq: 1, team: 'us', ...meta }
    expect(EventSchema.parse({ ...base, type: 'goal' }).time_source).toBe('none')
    expect(EventSchema.safeParse({ ...base, type: 'bogus' }).success).toBe(false)
  })
})
