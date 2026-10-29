import { SCHEMA_VERSION, type Game, type GameEvent, type Player, type Point, type SyncOp, type Team } from '../domain/schema'
import { gameRow, gameSnapshot, playerRow, type SheetRow } from './sheetRows'
import { snapshotBase, snapshotGame, type SnapshotPush } from './snapshot'

export interface SyncData {
  teams?: Team[]
  players: Player[]
  games: Game[]
  points: Point[]
  events: GameEvent[]
}

export interface PushBody {
  action: 'push'
  schema_version: number
  upsert: {
    Players?: { rows: SheetRow[]; delete: string[] }
    Games?: { rows: SheetRow[]; delete: string[] }
  }
  replace: { game_ids: string[]; tabs: Record<'Points' | 'Events' | 'Player Stats' | 'Game Stats', SheetRow[]> }
  /** Team-view snapshot of the same changes (script v3+; older scripts ignore it). */
  snapshot?: SnapshotPush
  /** Script v4: the rev each pushed game's copy is based on (only games this device knows a rev for). Older scripts ignore it. */
  games_base?: Record<string, number>
}

export interface PushOptions {
  /**
   * May this device write the game? Games pulled from someone else are only sent
   * when a queued change touches them (the script then explains the rejection);
   * they are never swept in by "Push everything" or a player change.
   */
  canWrite?: (gameId: string) => boolean
  /** The rev each game's local copy is based on (from the last pull or push). */
  bases?: Record<string, number>
}

/** The game a queued op belongs to (undefined for players and teams). */
export function opGame(op: Pick<SyncOp, 'table' | 'row_id' | 'payload'>, pointGame?: Map<string, string>): string | undefined {
  const row = (op.payload ?? {}) as { game_id?: string; point_id?: string }
  if (op.table === 'games') return op.row_id
  if (op.table === 'points') return row.game_id ?? pointGame?.get(op.row_id)
  if (op.table === 'events') return row.game_id ?? (row.point_id ? pointGame?.get(row.point_id) : undefined)
  return undefined
}

/**
 * Turn queued row changes into one idempotent push:
 * - Players: upsert by id, soft-deleted ones included (deleted: true) so they can be restored.
 * - Games: upsert by id; soft-deleted games are deleted from the Sheet.
 * - Points, Events, Player Stats, Game Stats: a full snapshot of each touched game
 *   replaces that game's rows (so deleted points/events disappear and stats are
 *   always consistent). A player change touches every game (names appear in stats).
 * - Team-view snapshot: the raw rows of each touched game, plus all players and teams;
 *   `full` replaces the stored snapshot completely.
 * `full` pushes everything (first sync, or after a restore from backup).
 */
export function buildPush(data: SyncData, ops: Pick<SyncOp, 'table' | 'row_id' | 'payload'>[], full = false, opts: PushOptions = {}): PushBody {
  const canWrite = opts.canWrite ?? (() => true)
  const byId = new Map(data.players.map((p) => [p.id, p]))
  const gamesById = new Map(data.games.map((g) => [g.id, g]))
  const pointGame = new Map(data.points.map((p) => [p.id, p.game_id]))
  const touchedPlayers = new Set<string>()
  const touchedGames = new Set<string>()
  for (const op of ops) {
    if (op.table === 'players') touchedPlayers.add(op.row_id)
    const gid = opGame(op, pointGame)
    if (gid) touchedGames.add(gid)
  }
  if (full) data.players.forEach((p) => touchedPlayers.add(p.id))
  // A player change refreshes every game's stats (names appear there), but only games this device may write.
  if (full || touchedPlayers.size) data.games.forEach((g) => canWrite(g.id) && touchedGames.add(g.id))

  const body: PushBody = {
    action: 'push',
    schema_version: SCHEMA_VERSION,
    upsert: {},
    replace: { game_ids: [], tabs: { Points: [], Events: [], 'Player Stats': [], 'Game Stats': [] } },
  }
  if (touchedPlayers.size) {
    const list = [...touchedPlayers].map((id) => byId.get(id))
    body.upsert.Players = {
      rows: list.filter((p): p is Player => !!p).map(playerRow),
      delete: [...touchedPlayers].filter((id) => !byId.get(id)),
    }
  }
  if (touchedGames.size) {
    const ids = [...touchedGames].sort()
    body.upsert.Games = {
      rows: ids.map((id) => gamesById.get(id)).filter((g): g is Game => !!g && !g.deleted).map(gameRow),
      delete: ids.filter((id) => !gamesById.get(id) || gamesById.get(id)!.deleted),
    }
    body.replace.game_ids = ids
    for (const id of ids) {
      const g = gamesById.get(id)
      if (!g || g.deleted) continue // deleted game: its rows are removed, nothing added
      const snap = gameSnapshot(g, data.points, data.events, byId)
      for (const k of Object.keys(snap) as (keyof typeof snap)[]) body.replace.tabs[k].push(...snap[k])
    }
  }
  if (full || touchedPlayers.size || touchedGames.size) {
    const ids = [...touchedGames].sort()
    const live = ids.map((id) => gamesById.get(id)).filter((g): g is Game => !!g && !g.deleted)
    body.snapshot = {
      full,
      base: snapshotBase(data.teams ?? [], data.players),
      games: live.map((g) => snapshotGame(g, data.points, data.events)),
      delete: ids.filter((id) => !gamesById.get(id) || gamesById.get(id)!.deleted),
    }
  }
  // Only games whose rev this device knows: a game it has never pulled or pushed (new here, or pushed by
  // an older app before the script tracked revs) has no base, so the script checks ownership only.
  if (opts.bases && body.replace.game_ids.length) {
    body.games_base = Object.fromEntries(body.replace.game_ids.filter((id) => typeof opts.bases![id] === 'number').map((id) => [id, opts.bases![id]]))
  }
  return body
}

/** Nothing to send (e.g. only team settings changed; the snapshot picks those up with the next push). */
export const isEmptyPush = (b: PushBody) => !b.upsert.Players && !b.upsert.Games && b.replace.game_ids.length === 0 && !b.snapshot
