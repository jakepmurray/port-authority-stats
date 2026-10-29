import { z } from 'zod'
import { EventSchema, GameSchema, PlayerSchema, PointSchema, TeamSchema, type Game, type GameEvent, type Player, type Point, type Team } from '../domain/schema'

/**
 * The read-only team-view snapshot. The writer's app sends it with every push; the
 * Apps Script stores it (hidden _Snapshot tab) and serves it on GET ?action=snapshot.
 * Raw domain rows, so the team view runs the same stats code. Never holds the token.
 * Deleted games, points and events are left out; deleted players are kept (flagged
 * deleted: true) because old games still name them.
 */
export interface SnapshotGame {
  id: string
  game: Game
  points: Point[]
  events: GameEvent[]
}
export interface SnapshotBase {
  teams: Team[]
  players: Player[]
}
export interface SnapshotPush {
  /** Replace the whole stored snapshot (Push everything). */
  full: boolean
  base: SnapshotBase
  games: SnapshotGame[]
  /** Game ids to drop (deleted on the writer's device). */
  delete: string[]
}

export function snapshotBase(teams: Team[], players: Player[]): SnapshotBase {
  return { teams: teams.filter((t) => !t.deleted), players: [...players] }
}

/** One game's live rows: deleted points, and events of deleted points, are left out. */
export function snapshotGame(game: Game, points: Point[], events: GameEvent[]): SnapshotGame {
  const pts = points.filter((p) => p.game_id === game.id && !p.deleted)
  const live = new Set(pts.map((p) => p.id))
  const evs = events.filter((e) => e.game_id === game.id && !e.deleted && (!e.point_id || live.has(e.point_id)))
  return { id: game.id, game, points: pts, events: evs }
}

// ---------- reading it back (team view) ----------

export interface TeamSnapshot {
  version: number | null
  /** When the writer last pushed (ms). */
  updatedAt: number | null
  /** When the writer last pushed everything (ms); null means some games may be missing. */
  fullAt: number | null
  teams: Team[]
  players: Player[]
  games: Game[]
  points: Point[]
  events: GameEvent[]
  /** Rows that failed validation and were skipped. */
  skipped: number
}

const Reply = z.object({
  ok: z.literal(true),
  kind: z.literal('snapshot'),
  version: z.number().nullish(),
  updated_at: z.string().nullish(),
  full_at: z.string().nullish(),
  teams: z.array(z.unknown()).default([]),
  players: z.array(z.unknown()).default([]),
  games: z.array(z.unknown()).default([]),
  points: z.array(z.unknown()).default([]),
  events: z.array(z.unknown()).default([]),
})

const ms = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : NaN
  return Number.isFinite(t) ? t : null
}

/** Validate a GET ?action=snapshot reply. Bad rows are skipped (counted), never trusted blindly. */
export function parseSnapshot(raw: unknown): TeamSnapshot {
  const r = Reply.safeParse(raw)
  if (!r.success) throw new Error('not_snapshot')
  let skipped = 0
  const rows = <T,>(schema: z.ZodType<T>, list: unknown[]): T[] =>
    list.flatMap((x) => {
      const p = schema.safeParse(x)
      if (!p.success) skipped++
      return p.success ? [p.data] : []
    })
  const games = rows(GameSchema, r.data.games).filter((g) => !g.deleted)
  const ids = new Set(games.map((g) => g.id))
  return {
    version: r.data.version ?? null,
    updatedAt: ms(r.data.updated_at),
    fullAt: ms(r.data.full_at),
    teams: rows(TeamSchema, r.data.teams),
    players: rows(PlayerSchema, r.data.players),
    games,
    points: rows(PointSchema, r.data.points).filter((p) => ids.has(p.game_id) && !p.deleted),
    events: rows(EventSchema, r.data.events).filter((e) => ids.has(e.game_id) && !e.deleted),
    skipped,
  }
}
