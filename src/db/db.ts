import Dexie, { type EntityTable } from 'dexie'
import type { Correction, Game, GameEvent, Player, Point, SyncOp, Team } from '../domain/schema'

export class StatsDB extends Dexie {
  teams!: EntityTable<Team, 'id'>
  players!: EntityTable<Player, 'id'>
  games!: EntityTable<Game, 'id'>
  points!: EntityTable<Point, 'id'>
  events!: EntityTable<GameEvent, 'id'>
  corrections!: EntityTable<Correction, 'id'>
  syncQueue!: EntityTable<SyncOp, 'op_id'>

  constructor(name = 'port-authority-stats') {
    super(name)
    this.version(1).stores({
      teams: 'id, updated_at',
      players: 'id, team_id, number, updated_at',
      games: 'id, team_id, date, updated_at',
      points: 'id, game_id, [game_id+idx], updated_at',
      events: 'id, game_id, point_id, [point_id+seq], updated_at',
      corrections: 'id, event_id',
      syncQueue: 'op_id, table, row_id',
    })
  }
}

export const db = new StatsDB()
