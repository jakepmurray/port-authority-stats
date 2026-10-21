import { SCHEMA_VERSION, type Game, type GameEvent, type Player, type Point, type SyncOp } from '../domain/schema'
import { gameRow, gameSnapshot, playerRow, type SheetRow } from './sheetRows'

export interface SyncData {
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
}

/**
 * Turn queued row changes into one idempotent push:
 * - Players and Games: upsert by id; soft-deleted rows are deleted from the Sheet.
 * - Points, Events, Player Stats, Game Stats: a full snapshot of each touched game
 *   replaces that game's rows (so deleted points/events disappear and stats are
 *   always consistent). A player change touches every game (names appear in stats).
 * `full` pushes everything (first sync, or after a restore from backup).
 */
export function buildPush(data: SyncData, ops: Pick<SyncOp, 'table' | 'row_id' | 'payload'>[], full = false): PushBody {
  const byId = new Map(data.players.map((p) => [p.id, p]))
  const gamesById = new Map(data.games.map((g) => [g.id, g]))
  const pointGame = new Map(data.points.map((p) => [p.id, p.game_id]))
  const touchedPlayers = new Set<string>()
  const touchedGames = new Set<string>()
  for (const op of ops) {
    const row = (op.payload ?? {}) as { game_id?: string; point_id?: string }
    if (op.table === 'players') touchedPlayers.add(op.row_id)
    else if (op.table === 'games') touchedGames.add(op.row_id)
    else if (op.table === 'points') {
      const gid = row.game_id ?? pointGame.get(op.row_id)
      if (gid) touchedGames.add(gid)
    } else if (op.table === 'events') {
      const gid = row.game_id ?? (row.point_id ? pointGame.get(row.point_id) : undefined)
      if (gid) touchedGames.add(gid)
    }
  }
  if (full) {
    data.players.forEach((p) => touchedPlayers.add(p.id))
    data.games.forEach((g) => touchedGames.add(g.id))
  }
  if (touchedPlayers.size) data.games.forEach((g) => touchedGames.add(g.id))

  const body: PushBody = {
    action: 'push',
    schema_version: SCHEMA_VERSION,
    upsert: {},
    replace: { game_ids: [], tabs: { Points: [], Events: [], 'Player Stats': [], 'Game Stats': [] } },
  }
  if (touchedPlayers.size) {
    const list = [...touchedPlayers].map((id) => byId.get(id))
    body.upsert.Players = {
      rows: list.filter((p): p is Player => !!p && !p.deleted).map(playerRow),
      delete: [...touchedPlayers].filter((id) => !byId.get(id) || byId.get(id)!.deleted),
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
  return body
}

export const isEmptyPush = (b: PushBody) => !b.upsert.Players && !b.upsert.Games && b.replace.game_ids.length === 0
