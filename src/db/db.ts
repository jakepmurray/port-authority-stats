import Dexie, { type EntityTable } from 'dexie'
import { isTeamHash } from '../team/link'
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
    // v2: games gained ended_at / use_clock. Games imported from UltiAnalytics are finished
    // games, so mark them ended (and queue them so the Sheet gets the new status).
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        const now = Date.now()
        const games = tx.table<Game, string>('games')
        const queue = tx.table<SyncOp, string>('syncQueue')
        await games.toCollection().modify((g) => {
          g.use_clock ??= false
          if (g.ended_at === undefined) g.ended_at = null
          if (g.ended_at === null && !g.deleted && g.notes.includes('[ultianalytics:')) {
            g.ended_at = now
            g.updated_at = now
          }
        })
        const ended = (await games.toArray()).filter((g) => g.ended_at === now)
        await queue.bulkPut(ended.map((g) => ({ op_id: `games:${g.id}`, table: 'games' as const, row_id: g.id, payload: g, attempts: 0, last_error: null })))
      })
  }
}

/** The team view's own database: a read-only copy of the writer's snapshot, never mixed with local data. */
export const TEAM_DB_NAME = 'port-authority-stats-team-view'

export class ReadOnlyError extends Error {
  constructor() {
    super('Team view is read only')
    this.name = 'ReadOnlyError'
  }
}

/**
 * Block every write through this Dexie instance (schema upgrades excepted). The team
 * view's pages read through it; only refreshTeamView writes, via its own instance.
 */
export function readOnly<T extends StatsDB>(d: T): T {
  d.use({
    stack: 'dbcore',
    name: 'readOnly',
    create: (down) => ({
      ...down,
      table: (name) => {
        const t = down.table(name)
        return {
          ...t,
          mutate: (req) => ((req.trans as unknown as IDBTransaction).mode === 'versionchange' ? t.mutate(req) : Promise.reject(new ReadOnlyError())),
        }
      },
    }),
  })
  return d
}

/** Opened in team view (#/team…)? Decided once at load; switching modes reloads the page. */
export const TEAM_MODE = typeof window !== 'undefined' && isTeamHash(window.location.hash)

export const db = TEAM_MODE ? readOnly(new StatsDB(TEAM_DB_NAME)) : new StatsDB()
