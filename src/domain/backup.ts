import { z } from 'zod'
import { EventSchema, GameSchema, PlayerSchema, PointSchema, SCHEMA_VERSION, TeamSchema } from './schema'

export const BackupSchema = z.object({
  app: z.literal('port-authority-stats'),
  schema_version: z.number().int(),
  exported_at: z.number(),
  teams: z.array(TeamSchema),
  players: z.array(PlayerSchema),
  games: z.array(GameSchema),
  points: z.array(PointSchema),
  events: z.array(EventSchema),
})
export type Backup = z.infer<typeof BackupSchema>
export type BackupTables = Omit<Backup, 'app' | 'schema_version' | 'exported_at'>

export function makeBackup(t: BackupTables, exportedAt = Date.now()): Backup {
  return { app: 'port-authority-stats', schema_version: SCHEMA_VERSION, exported_at: exportedAt, ...t }
}

export function parseBackup(json: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Not a JSON file')
  }
  const r = BackupSchema.safeParse(raw)
  if (!r.success) throw new Error(`Not a valid backup: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`)
  if (r.data.schema_version > SCHEMA_VERSION) throw new Error('Backup is from a newer app version')
  if (r.data.schema_version < 2) {
    // Before v2 there was no "ended" flag: games imported from UltiAnalytics are finished games.
    for (const g of r.data.games) if (g.ended_at === null && g.notes.includes('[ultianalytics:')) g.ended_at = g.updated_at
  }
  return r.data
}

/** Merge rows by id: the newer updated_at wins. Returns rows to write. */
export function mergeRows<T extends { id: string; updated_at: number }>(existing: T[], incoming: T[]): T[] {
  const cur = new Map(existing.map((r) => [r.id, r]))
  return incoming.filter((r) => {
    const c = cur.get(r.id)
    return !c || r.updated_at > c.updated_at
  })
}
