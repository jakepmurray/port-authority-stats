import type { GameEvent } from './schema'

/** Preset context tags for turnovers. Tags add context only; they never change who is charged. */
export const PRESET_TAGS = ['receiver error', 'difficult throw', 'great D', 'wind', 'miscommunication', 'hammer/huck'] as const

/** Tags the app uses internally (pull results, cap kinds); hidden from tag pickers and breakdowns. */
export const SYSTEM_TAGS = new Set(['in', 'ob', 'brick', 'half', 'soft', 'hard'])

/** Event types that turn the disc over; the quick tag prompt appears after these. */
export const TAGGABLE_TURNOVERS = new Set<GameEvent['type']>(['throwaway', 'drop', 'stall', 'turnover', 'D', 'callahan'])

export const normalizeTag = (t: string) => t.trim().replace(/\s+/g, ' ')

/** Presets first, then the team's custom tags (deduped, case-insensitive). */
export function tagChoices(custom: string[] | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of [...PRESET_TAGS, ...(custom ?? [])]) {
    const k = t.toLowerCase()
    if (!t.trim() || seen.has(k) || SYSTEM_TAGS.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

export const userTags = (tags: string[]) => tags.filter((t) => !SYSTEM_TAGS.has(t.toLowerCase()))

export function toggleTag(tags: string[], tag: string): string[] {
  const k = tag.toLowerCase()
  return tags.some((t) => t.toLowerCase() === k) ? tags.filter((t) => t.toLowerCase() !== k) : [...tags, tag]
}
