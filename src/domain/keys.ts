export type NumberMatch = { status: 'match'; id: string } | { status: 'wait'; exact: string | null } | { status: 'none' }

/**
 * Resolve a typed jersey-number buffer against candidate players. Commits as
 * soon as the number is unambiguous: with #1 and #12 on the line, "1" waits
 * (Enter picks #1) and "12" commits; with only #3 and #12, "3" commits at once.
 */
export function resolveNumber(buffer: string, candidates: { id: string; number: string }[]): NumberMatch {
  if (!buffer) return { status: 'none' }
  const exact = candidates.find((c) => c.number === buffer) ?? null
  const longer = candidates.some((c) => c.number.length > buffer.length && c.number.startsWith(buffer))
  if (exact && !longer) return { status: 'match', id: exact.id }
  if (longer && buffer.length < 2) return { status: 'wait', exact: exact?.id ?? null }
  if (exact) return { status: 'match', id: exact.id }
  return { status: 'none' }
}
