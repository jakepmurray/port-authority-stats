import type { z } from 'zod'
import { fresh, newId, now } from '../domain/ids'
import {
  EventSchema,
  GameSchema,
  PlayerSchema,
  PointSchema,
  TeamSchema,
  type GameEvent,
  type Game,
  type Player,
  type Point,
  type Team,
} from '../domain/schema'
import { db as defaultDb, type StatsDB } from './db'

export type TableName = 'teams' | 'players' | 'games' | 'points' | 'events'

type RowOf = { teams: Team; players: Player; games: Game; points: Point; events: GameEvent }

const schemas = {
  teams: TeamSchema,
  players: PlayerSchema,
  games: GameSchema,
  points: PointSchema,
  events: EventSchema,
} as const

type Schemas = typeof schemas

/** Input for a new row: everything except id/metadata (defaults are filled by Zod). */
export type NewRow<K extends TableName> = Omit<
  z.input<Schemas[K]>,
  'id' | 'created_at' | 'updated_at' | 'edited_at' | 'deleted'
> & { id?: string }

const parse = <K extends TableName>(name: K, v: unknown): RowOf[K] => schemas[name].parse(v) as RowOf[K]

/** Thin, validated data access over Dexie. Every write also lands in the sync queue. */
export class Repo {
  readonly db: StatsDB
  /** Called after every committed write (the sync engine listens here). */
  onWrite: (() => void) | null = null
  constructor(db: StatsDB = defaultDb) {
    this.db = db
  }

  private table<K extends TableName>(name: K) {
    return this.db.table(name) as unknown as import('dexie').Table<RowOf[K], string>
  }

  private async enqueue(table: TableName, row: { id: string }) {
    await this.db.syncQueue.put({
      op_id: `${table}:${row.id}`, // latest write per row wins
      table,
      row_id: row.id,
      payload: row,
      attempts: 0,
      last_error: null,
    })
  }

  async create<K extends TableName>(name: K, input: NewRow<K>): Promise<RowOf[K]> {
    const row = parse(name, { ...input, id: input.id ?? newId(), ...fresh() })
    await this.db.transaction('rw', this.table(name), this.db.syncQueue, async () => {
      await this.table(name).add(row)
      await this.enqueue(name, row as { id: string })
    })
    this.onWrite?.()
    return row
  }

  async bulkCreate<K extends TableName>(name: K, inputs: NewRow<K>[]): Promise<RowOf[K][]> {
    const rows = inputs.map((i) => parse(name, { ...i, id: i.id ?? newId(), ...fresh() }))
    await this.db.transaction('rw', this.table(name), this.db.syncQueue, async () => {
      await this.table(name).bulkAdd(rows)
      for (const r of rows) await this.enqueue(name, r as { id: string })
    })
    this.onWrite?.()
    return rows
  }

  /**
   * Update a row. `byHand` marks a manual edit (sets edited_at) — use it for
   * edits made in the tables / play-by-play rather than app-driven updates.
   */
  async update<K extends TableName>(
    name: K,
    id: string,
    patch: Partial<RowOf[K]>,
    opts: { byHand?: boolean } = {},
  ): Promise<RowOf[K]> {
    const out = await this.db.transaction('rw', this.table(name), this.db.syncQueue, async () => {
      const cur = await this.table(name).get(id)
      if (!cur) throw new Error(`${name} ${id} not found`)
      const t = now()
      const next = parse(name, {
        ...cur,
        ...patch,
        id,
        created_at: cur.created_at,
        updated_at: t,
        edited_at: opts.byHand ? t : (cur as { edited_at: number | null }).edited_at,
      })
      await this.table(name).put(next)
      await this.enqueue(name, next as { id: string })
      return next
    })
    this.onWrite?.()
    return out
  }

  softDelete<K extends TableName>(name: K, id: string, byHand = true) {
    return this.update(name, id, { deleted: true } as Partial<RowOf[K]>, { byHand })
  }

  restore<K extends TableName>(name: K, id: string) {
    return this.update(name, id, { deleted: false } as Partial<RowOf[K]>, { byHand: true })
  }

  get<K extends TableName>(name: K, id: string) {
    return this.table(name).get(id)
  }

  /** All rows (including soft-deleted). */
  all<K extends TableName>(name: K) {
    return this.table(name).toArray()
  }

  async live<K extends TableName>(name: K): Promise<RowOf[K][]> {
    return (await this.table(name).toArray()).filter((r) => !(r as { deleted: boolean }).deleted)
  }

  playersOfTeam(teamId: string) {
    return this.db.players.where('team_id').equals(teamId).toArray()
  }
  pointsOfGame(gameId: string) {
    return this.db.points.where('game_id').equals(gameId).sortBy('idx')
  }
  eventsOfGame(gameId: string) {
    return this.db.events.where('game_id').equals(gameId).toArray()
  }
}

export const repo = new Repo()
