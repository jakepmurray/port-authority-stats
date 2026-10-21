import type { GenderMatch, Player, Ratio } from './schema'

/**
 * USAU prescribed ratio (ABBA): point 1 uses the chosen ratio (A), points 2–3
 * the other (B), points 4–5 A again, and so on. Halftime does not reset it.
 */
export function ratioForPoint(ratioFirst: Ratio, pointIdx: number): Ratio {
  if (!Number.isInteger(pointIdx) || pointIdx < 1) throw new Error('pointIdx is 1-based')
  const isA = Math.floor(pointIdx / 2) % 2 === 0
  return isA ? ratioFirst : flip(ratioFirst)
}

export const flip = (r: Ratio): Ratio => (r === 'W4' ? 'M4' : 'W4')

/** Gender match with four players on the field for this ratio. */
export const majorityOf = (r: Ratio): GenderMatch => (r === 'W4' ? 'W' : 'M')

/** Required counts for a full line of 7. */
export const required = (r: Ratio) => (r === 'W4' ? { W: 4, M: 3 } : { W: 3, M: 4 })

export type LineIssue =
  | { level: 'error'; code: 'too_many'; message: string }
  | { level: 'error'; code: 'duplicate'; message: string }
  | { level: 'error'; code: 'unknown_player'; message: string }
  | { level: 'error'; code: 'too_few'; message: string }
  | { level: 'error'; code: 'over_ratio'; message: string }
  | { level: 'warn'; code: 'short_handed'; message: string }
  | { level: 'warn'; code: 'inactive'; message: string }
  | { level: 'error'; code: 'wrong_puller'; message: string }
  | { level: 'warn'; code: 'puller_not_on_line'; message: string }

export interface LineCheck {
  ok: boolean // no errors (warnings allowed)
  counts: { W: number; M: number }
  need: { W: number; M: number }
  issues: LineIssue[]
}

/**
 * Check a 7-player line against the point's ratio. Teams may play short (5–6)
 * if they can't match the ratio, but must match it "with as many players as
 * possible" — so no gender may exceed its required count.
 */
export function checkLine(
  lineIds: string[],
  players: Pick<Player, 'id' | 'gender_match' | 'active' | 'name'>[],
  ratio: Ratio,
): LineCheck {
  const byId = new Map(players.map((p) => [p.id, p]))
  const need = required(ratio)
  const counts = { W: 0, M: 0 }
  const issues: LineIssue[] = []
  const seen = new Set<string>()
  for (const id of lineIds) {
    if (seen.has(id)) {
      issues.push({ level: 'error', code: 'duplicate', message: `${byId.get(id)?.name ?? id} is listed twice` })
      continue
    }
    seen.add(id)
    const p = byId.get(id)
    if (!p) {
      issues.push({ level: 'error', code: 'unknown_player', message: `Unknown player ${id}` })
      continue
    }
    if (!p.active) issues.push({ level: 'warn', code: 'inactive', message: `${p.name} is marked inactive` })
    counts[p.gender_match]++
  }
  const total = counts.W + counts.M
  if (total > 7) issues.push({ level: 'error', code: 'too_many', message: `${total} players on the line (max 7)` })
  for (const g of ['W', 'M'] as const) {
    if (counts[g] > need[g]) {
      issues.push({
        level: 'error',
        code: 'over_ratio',
        message: `${counts[g]} ${g === 'W' ? 'woman' : 'man'}-matching players; ${ratio} allows ${need[g]}`,
      })
    }
  }
  if (total < 5) issues.push({ level: 'error', code: 'too_few', message: `${total} players (need at least 5)` })
  else if (total < 7) {
    issues.push({ level: 'warn', code: 'short_handed', message: `Playing ${total} (short-handed)` })
  }
  return { ok: !issues.some((i) => i.level === 'error'), counts, need, issues }
}

/** Majority pull rule: the puller must be of the gender match with four on the field. */
export function checkPuller(
  pullerId: string | null,
  lineIds: string[],
  players: Pick<Player, 'id' | 'gender_match' | 'name'>[],
  ratio: Ratio,
): LineIssue[] {
  if (!pullerId) return []
  const p = players.find((x) => x.id === pullerId)
  if (!p) return [{ level: 'error', code: 'unknown_player', message: `Unknown puller ${pullerId}` }]
  const issues: LineIssue[] = []
  if (!lineIds.includes(pullerId)) {
    issues.push({ level: 'warn', code: 'puller_not_on_line', message: `${p.name} is pulling but not on the line` })
  }
  const maj = majorityOf(ratio)
  if (p.gender_match !== maj) {
    issues.push({
      level: 'error',
      code: 'wrong_puller',
      message: `Majority pull: a ${maj === 'W' ? 'woman' : 'man'}-matching player must pull on a ${ratio} point`,
    })
  }
  return issues
}
