import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { StatsDB } from './db'

describe('db upgrade to v2', () => {
  it('ends games imported from UltiAnalytics and queues them for the Sheet', async () => {
    const name = `up-${crypto.randomUUID()}`
    const v1 = new Dexie(name)
    v1.version(1).stores({
      teams: 'id, updated_at', players: 'id, team_id, number, updated_at', games: 'id, team_id, date, updated_at',
      points: 'id, game_id, [game_id+idx], updated_at', events: 'id, game_id, point_id, [point_id+seq], updated_at',
      corrections: 'id, event_id', syncQueue: 'op_id, table, row_id',
    })
    const base = { team_id: 't', ratio_first: 'W4', start_on: 'O', game_to: 15, deleted: false, created_at: 1, updated_at: 1 }
    await v1.table('games').bulkPut([
      { ...base, id: 'ua', opponent: 'A', notes: 'Imported [ultianalytics:x]' },
      { ...base, id: 'film', opponent: 'B', notes: '' },
    ])
    v1.close()
    const db = new StatsDB(name)
    const ua = await db.games.get('ua')
    const film = await db.games.get('film')
    expect(ua!.ended_at).toBeGreaterThan(1)
    expect(film!.ended_at).toBeNull()
    expect(film!.use_clock).toBe(false)
    expect((await db.syncQueue.toArray()).map((o) => o.op_id)).toEqual(['games:ua'])
    db.close()
  })
})
