import type { Game, Opponent } from './schema'

/**
 * Opponent USAU ranks: name matching, the rank that applies to a game, and parsing a
 * pasted USAU rankings page. USAU blocks cross-site fetches, so (like roster import)
 * the person copies the page text and pastes it.
 */

/** Lowercase, no accents or punctuation, "&" as "and". The same rule runs in apps-script/Code.gs (normOpp_). */
export function normOpp(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Same opponent + season → same id on every device, so edits merge instead of duplicating. */
export const opponentId = (name: string, season: string) => `opp:${season || 'all'}:${normOpp(name).replace(/ /g, '-') || 'x'}`

/** A game's season: the year of its date ('' if it has no date). */
export const seasonOf = (date: string) => (/^\d{4}-/.test(date) ? date.slice(0, 4) : '')

/** The rank record for a game: this season's if there is one, else the all-seasons one. */
export function rankFor(game: Pick<Game, 'opponent' | 'date'>, opponents: Opponent[]): Opponent | null {
  const key = normOpp(game.opponent)
  const season = seasonOf(game.date)
  let any: Opponent | null = null
  for (const o of opponents) {
    if (o.deleted || o.rank === null || normOpp(o.name) !== key) continue
    if (season && o.season === season) return o
    if (!o.season) any = o
  }
  return any
}

/** Index for many lookups. */
export function rankLookup(opponents: Opponent[]) {
  return (game: Pick<Game, 'opponent' | 'date'>) => rankFor(game, opponents)?.rank ?? null
}

// ---------------------------------------------------------------------------------------------
// Pasted USAU rankings

/** Where to copy them from (the person picks the division and season there). */
export const USAU_RANKINGS_URL = 'https://play.usaultimate.org/teams/events/team_rankings/?RankSet=Club-Mixed'

export interface UsauRank {
  rank: number
  name: string
  rating: number | null
}

const RATING = /^\d{3,4}(\.\d+)?$/
const isRank = (s: string) => /^\d{1,4}\.?$/.test(s) && Number(s.replace('.', '')) > 0 && Number(s.replace('.', '')) <= 2000
const okName = (s: string) => !!s && /[a-z]/i.test(s) && !/[•@]/.test(s) && !/^(rank|team)$/i.test(s)

/**
 * Read the rankings table from pasted page text. Handles a copied table (tab-separated
 * cells, as browsers copy it), a "| 1 | Team |" table, "1 Team 2163 Mixed …" lines, and
 * one cell per line (rank, team, rating on separate lines, as phones often copy it).
 */
export function parseUsauRankings(text: string): UsauRank[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out: UsauRank[] = []
  const seen = new Set<number>()
  const add = (rank: string, name: string, rating: string | undefined) => {
    const r = Number(rank.replace('.', ''))
    const n = name.replace(/\s+/g, ' ').trim()
    if (seen.has(r) || !okName(n)) return
    seen.add(r)
    out.push({ rank: r, name: n, rating: rating && RATING.test(rating) ? Number(rating) : null })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const cells = line.includes('\t') ? line.split('\t') : line.includes('|') ? line.split('|') : null
    if (cells) {
      const c = cells.map((x) => x.trim())
      const at = c.findIndex((x) => x !== '')
      if (at >= 0 && isRank(c[at]) && c[at + 1] && !/^\d+$/.test(c[at + 1])) add(c[at], c[at + 1], c[at + 2])
      continue
    }
    const m = /^(\d{1,4})[.)]?\s+(.+?)\s+(\d{3,4}(?:\.\d+)?)(?:\s|$)/.exec(line)
    if (m && isRank(m[1])) {
      add(m[1], m[2], m[3])
      continue
    }
    // One cell per line: rank, then team, then (usually) the power rating.
    if (isRank(line) && lines[i + 1] && !/^\d+(\.\d+)?$/.test(lines[i + 1]) && okName(lines[i + 1]) && (!lines[i + 2] || RATING.test(lines[i + 2]))) {
      add(line, lines[i + 1], lines[i + 2])
      i += lines[i + 2] && RATING.test(lines[i + 2]) ? 2 : 1
    }
  }
  return out.sort((a, b) => a.rank - b.rank)
}

// ---------------------------------------------------------------------------------------------
// Fuzzy matching our opponent names to USAU team names

function lev(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}
const levRatio = (a: string, b: string) => (a.length || b.length ? 1 - lev(a, b) / Math.max(a.length, b.length) : 1)

/**
 * 0–1 likeness of two team names. Exact (after normalizing) = 1; one name's words all
 * inside the other ("Disco" in "Austin Disco Club", "Port Authority" in "Pittsburgh Port
 * Authority") ≈ 0.85–0.95; otherwise spelling similarity of the whole name and of its words.
 */
export function nameScore(a: string, b: string): number {
  const na = normOpp(a)
  const nb = normOpp(b)
  if (!na || !nb) return 0
  if (na === nb || na.replace(/ /g, '') === nb.replace(/ /g, '')) return 1
  const ta = na.split(' ')
  const tb = nb.split(' ')
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (short.every((t) => long.includes(t))) return 0.85 + 0.1 * (short.length / long.length)
  const words = short.reduce((s, t) => s + Math.max(...long.map((u) => levRatio(t, u))), 0) / short.length
  return Math.max(levRatio(na, nb), 0.8 * words)
}

export type MatchQuality = 'exact' | 'likely' | 'check' | 'none'

export interface RankMatch {
  /** Our opponent name (as on the games). */
  opponent: string
  games: number
  /** Best USAU candidate (null when nothing is close). */
  best: (UsauRank & { score: number }) | null
  /** Up to 5 closest USAU teams, best first (for the review dropdown). */
  options: (UsauRank & { score: number })[]
  quality: MatchQuality
}

export const MIN_SCORE = 0.6

export function matchRanks(opponents: { name: string; games: number }[], usau: UsauRank[]): RankMatch[] {
  return opponents.map(({ name, games }) => {
    const scored = usau.map((u) => ({ ...u, score: nameScore(name, u.name) })).sort((a, b) => b.score - a.score || a.rank - b.rank)
    const best = scored[0] && scored[0].score >= MIN_SCORE ? scored[0] : null
    const quality: MatchQuality = !best ? 'none' : best.score >= 0.99 ? 'exact' : best.score >= 0.8 ? 'likely' : 'check'
    return { opponent: name, games, best, options: scored.slice(0, 5), quality }
  })
}

/** Distinct opponents of live games (in a season, or all), with how many games each, by name. */
export function opponentsOf(games: Game[], season = ''): { name: string; games: number }[] {
  const m = new Map<string, { name: string; games: number }>()
  for (const g of games) {
    if (g.deleted || (season && seasonOf(g.date) !== season)) continue
    const k = normOpp(g.opponent)
    const v = m.get(k) ?? { name: g.opponent.trim(), games: 0 }
    v.games++
    m.set(k, v)
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Seasons (years) that have games, newest first. */
export const seasonsOf = (games: Game[]) => [...new Set(games.filter((g) => !g.deleted).map((g) => seasonOf(g.date)).filter(Boolean))].sort().reverse()
