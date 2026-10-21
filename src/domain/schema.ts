import { z } from 'zod'

/**
 * Data model (PLAN.md §6). One event log is shared by film entry, live entry
 * and the future tagger. Every record carries created_at / updated_at,
 * an optional edited_at (set when a person hand-edits it) and a soft-delete flag.
 */

const id = z.string().min(1)
const ts = z.number().int().nonnegative() // epoch ms

const meta = {
  created_at: ts,
  updated_at: ts,
  edited_at: ts.nullable().default(null),
  deleted: z.boolean().default(false),
}

export const GenderMatch = z.enum(['W', 'M'])
export type GenderMatch = z.infer<typeof GenderMatch>

/** W4 = four woman-matching + three man-matching players; M4 the reverse. */
export const Ratio = z.enum(['W4', 'M4'])
export type Ratio = z.infer<typeof Ratio>

export const Side = z.enum(['O', 'D'])
export type Side = z.infer<typeof Side>

export const TeamSide = z.enum(['us', 'them'])
export type TeamSide = z.infer<typeof TeamSide>

export const TeamSchema = z.object({
  id,
  name: z.string().min(1),
  division: z.string().default('Mixed'),
  /** Team-defined event tags, reusable across games (presets live in tags.ts). */
  custom_tags: z.array(z.string()).default([]),
  ...meta,
})
export type Team = z.infer<typeof TeamSchema>

export const PlayerRole = z.enum(['handler', 'cutter', 'hybrid'])
export type PlayerRole = z.infer<typeof PlayerRole>

export const PlayerSchema = z.object({
  id,
  team_id: id,
  name: z.string().min(1),
  number: z.string().regex(/^\d{1,2}$/, 'Jersey number must be 0–99'),
  gender_match: GenderMatch,
  role: PlayerRole.default('hybrid'),
  active: z.boolean().default(true),
  ...meta,
})
export type Player = z.infer<typeof PlayerSchema>

export const CapsSchema = z.object({
  half: z.number().positive().nullable(), // minutes from game start
  soft: z.number().positive().nullable(),
  hard: z.number().positive().nullable(),
})
export type Caps = z.infer<typeof CapsSchema>

/** USAU 2026 Club Nationals pool play: half 45′, soft 90′, hard 105′. */
export const USAU_2026_CAPS: Caps = { half: 45, soft: 90, hard: 105 }
/** USAU 2026 semifinals and finals: half 52′, soft 105′, no hard cap. */
export const USAU_2026_BRACKET_CAPS: Caps = { half: 52, soft: 105, hard: null }

export const VideoSchema = z.object({
  kind: z.enum(['youtube', 'file', 'none']).default('none'),
  youtube_id: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  /** Video time (s) at which the game starts (first pull). Used for the cap clock. */
  offset_s: z.number().nonnegative().default(0),
})
export type Video = z.infer<typeof VideoSchema>

export const GameSchema = z.object({
  id,
  team_id: id,
  opponent: z.string().min(1),
  tournament: z.string().default(''),
  date: z.string().default(''), // YYYY-MM-DD
  game_to: z.number().int().positive().default(15),
  caps: CapsSchema.default(USAU_2026_CAPS),
  timeouts_per_half: z.number().int().nonnegative().default(2),
  ratio_first: Ratio,
  start_on: Side, // our side on point 1
  video: VideoSchema.default({ kind: 'none', youtube_id: null, url: null, offset_s: 0 }),
  notes: z.string().default(''),
  ...meta,
})
export type Game = z.infer<typeof GameSchema>

export const PointOutcome = z.enum(['hold', 'break', 'broken', 'them_hold', 'none'])
export type PointOutcome = z.infer<typeof PointOutcome>

export const PointSchema = z.object({
  id,
  game_id: id,
  idx: z.number().int().positive(), // 1-based
  score_us: z.number().int().nonnegative(), // score at the start of the point
  score_them: z.number().int().nonnegative(),
  start_on: Side,
  ratio: Ratio,
  line: z.array(id).max(7),
  pulled_by: id.nullable().default(null),
  outcome: PointOutcome.default('none'), // cache; derived from events
  video_start: z.number().nonnegative().nullable().default(null),
  video_end: z.number().nonnegative().nullable().default(null),
  /** Point not on the video (camera cut, late start): result is entered by hand, no events. */
  missed_on_film: z.boolean().default(false),
  /** Who scored, for points missed on film. */
  manual_result: TeamSide.nullable().default(null),
  ...meta,
})
export type Point = z.infer<typeof PointSchema>

export const EventType = z.enum([
  'pull',
  'pickup', // a player picks up the disc to start a possession (no pass)
  'catch', // completed pass: actor = thrower, receiver = catcher
  'throw', // reserved for the tagger (release moment)
  'turnover', // other turnover
  'drop', // actor = thrower, receiver = dropper
  'throwaway', // actor = thrower
  'stall', // actor = player stalled
  'D', // defender = our blocker / interceptor (opponent turnover)
  'callahan', // us: defender scores; them: actor is our thrower
  'goal', // us: actor = assist, receiver = scorer
  'timeout',
  'sub',
  'injury',
  'half',
  'cap',
  'note',
])
export type EventType = z.infer<typeof EventType>

export const EventSchema = z.object({
  id,
  game_id: id,
  point_id: id,
  possession_id: id.nullable().default(null),
  seq: z.number(), // ordering within the point (float allows inserts)
  type: EventType,
  team: TeamSide,
  actor_id: id.nullable().default(null),
  receiver_id: id.nullable().default(null),
  defender_id: id.nullable().default(null),
  x: z.number().nullable().default(null), // field yards: 40 wide x 110 long
  y: z.number().nullable().default(null),
  x_end: z.number().nullable().default(null),
  y_end: z.number().nullable().default(null),
  video_time: z.number().nonnegative().nullable().default(null),
  time_source: z.enum(['auto', 'manual', 'none']).default('none'),
  wall_time: ts.nullable().default(null),
  source: z.enum(['film', 'live', 'tagger', 'import']).default('film'),
  confidence: z.number().min(0).max(1).nullable().default(null),
  suggested_player_ids: z.array(id).default([]),
  corrected: z.boolean().default(false),
  /** Free-form tags, e.g. pull result ('in'|'ob'|'brick'), cap kind ('half'|'soft'|'hard'). */
  tags: z.array(z.string()).default([]),
  note: z.string().default(''),
  ...meta,
})
export type GameEvent = z.infer<typeof EventSchema>

export const CorrectionSchema = z.object({
  id,
  event_id: id,
  field: z.string(),
  suggested: z.unknown(),
  chosen: z.unknown(),
  created_at: ts,
})
export type Correction = z.infer<typeof CorrectionSchema>

export const SyncQueueSchema = z.object({
  op_id: id,
  table: z.enum(['teams', 'players', 'games', 'points', 'events']),
  row_id: id,
  payload: z.unknown(),
  attempts: z.number().int().nonnegative().default(0),
  last_error: z.string().nullable().default(null),
})
export type SyncOp = z.infer<typeof SyncQueueSchema>

export const SCHEMA_VERSION = 1
