import { checkLine, type LineIssue } from './abba'
import type { GameEvent, Player, Ratio } from './schema'

/** Mid-point substitutions: actor = player coming off, receiver = player coming on. */
export const SUB_TYPES = new Set<GameEvent['type']>(['sub', 'injury'])
export const isSub = (e: GameEvent) => SUB_TYPES.has(e.type) && e.team === 'us'

export interface LineTimeline {
  /** Who is on the field after the last event. */
  final: string[]
  /** Line in force when each event happened (before a sub takes effect, for the sub itself). */
  at: Map<string, string[]>
  /** Everyone who was on the field at some point. */
  everOn: string[]
  /** Players who came on or went off mid-point. */
  partial: Set<string>
  subs: number
}

/**
 * Replay subs in order (live events only) to find who is on the line at every
 * event. Because it is derived, editing or deleting a sub fixes every later event.
 */
export function lineTimeline(start: string[], events: GameEvent[]): LineTimeline {
  let line = [...new Set(start)]
  const at = new Map<string, string[]>()
  const ever = new Set(line)
  const partial = new Set<string>()
  let subs = 0
  const live = events.filter((e) => !e.deleted).sort((a, b) => a.seq - b.seq)
  for (const e of live) {
    at.set(e.id, line)
    if (!isSub(e)) continue
    subs++
    const off = e.actor_id
    const on = e.receiver_id
    const next = off ? line.filter((id) => id !== off) : [...line]
    if (off && next.length !== line.length) partial.add(off)
    if (on && !next.includes(on)) {
      next.push(on)
      ever.add(on)
      partial.add(on)
    }
    line = next
  }
  return { final: line, at, everOn: [...ever], partial, subs }
}

/** Ratio problems a sub creates (warn only: what happened on film is what gets recorded). */
export function subRatioIssues(line: string[], players: Pick<Player, 'id' | 'gender_match' | 'active' | 'name'>[], ratio: Ratio): LineIssue[] {
  return checkLine(line, players, ratio).issues.filter((i) => i.code === 'over_ratio' || i.code === 'too_many' || i.code === 'duplicate')
}

export function lineAfterSub(line: string[], off: string | null, on: string | null): string[] {
  const next = off ? line.filter((id) => id !== off) : [...line]
  if (on && !next.includes(on)) next.push(on)
  return next
}
