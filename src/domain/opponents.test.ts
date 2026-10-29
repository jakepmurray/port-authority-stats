import { describe, expect, it } from 'vitest'
import { matchRanks, nameScore, normOpp, opponentId, opponentsOf, parseUsauRankings, rankFor, seasonOf, seasonsOf } from './opponents'
import { OpponentSchema, type Game } from './schema'

const opp = (name: string, season: string, rank: number | null, extra = {}) =>
  OpponentSchema.parse({ id: opponentId(name, season), team_id: 't', name, season, rank, created_at: 1, updated_at: 1, ...extra })

// What a browser copies from play.usaultimate.org/teams/events/team_rankings (tab-separated cells).
const TABBED = [
  'Teams & Rankings',
  'Rank\tTeam\tPower Rating\tGender Division\tCompetition Division\tCity\tState\tClub Region\tClub Section\tWins\tLosses',
  '1\tHybrid\t2163\tMixed\tPro\tAnn Arbor\tMI\tGreat Lakes\tEast Plains\t25\t3',
  '4\tAustin Disco Club\t1981\tMixed\tPro\tAustin\tTX\tSouth Central\tSouth Texas\t21\t8',
  "8\tDrag'n Thrust\t1832\tMixed\tPro\tMinneapolis\tMN\tNorth Central\tNorthwest Plains\t17\t12",
  '13\tshame.\t1767\tMixed\tPro\tFort Collins\tCO\tSouth Central\tRocky Mountain\t16\t14',
  '18\tPittsburgh Port Authority\t1695\tMixed\tTop Select\tPittsburgh\tPA\tMid-Atlantic\tCentral Appalachia\t22\t11',
  '19\tOdyssée\t1684\tMixed\t\tMontréal\tQC\tNortheast\tNorth New England\t12\t1',
  '3630 Sinton Road • Suite 103',
  'Colorado Springs, CO 80907',
].join('\n')

describe('parseUsauRankings', () => {
  it('reads a copied table (tabs) and skips headers and the footer address', () => {
    expect(parseUsauRankings(TABBED)).toEqual([
      { rank: 1, name: 'Hybrid', rating: 2163 },
      { rank: 4, name: 'Austin Disco Club', rating: 1981 },
      { rank: 8, name: "Drag'n Thrust", rating: 1832 },
      { rank: 13, name: 'shame.', rating: 1767 },
      { rank: 18, name: 'Pittsburgh Port Authority', rating: 1695 },
      { rank: 19, name: 'Odyssée', rating: 1684 },
    ])
  })

  it('reads space-separated lines, markdown tables and one cell per line', () => {
    expect(parseUsauRankings('1 Hybrid 2163 Mixed Pro Ann Arbor MI\n2 XIST 2101 Mixed Pro New York NY\n3630 Sinton Road • Suite 103')).toEqual([
      { rank: 1, name: 'Hybrid', rating: 2163 },
      { rank: 2, name: 'XIST', rating: 2101 },
    ])
    expect(parseUsauRankings('| Rank | Team | Power Rating |\n| --- | --- | --- |\n| 3 | Slow | 1994 |').map((r) => r.name)).toEqual(['Slow'])
    expect(parseUsauRankings('Rank\nTeam\n5\nAMP\n1918\nMixed\n6\nPolar Bears\n1915\nMixed')).toEqual([
      { rank: 5, name: 'AMP', rating: 1918 },
      { rank: 6, name: 'Polar Bears', rating: 1915 },
    ])
  })

  it('returns nothing for unrelated text', () => {
    expect(parseUsauRankings('hello\nworld')).toEqual([])
  })
})

describe('matching names', () => {
  it('normalizes accents, punctuation and "&"', () => {
    expect(normOpp('  Odyssée ')).toBe('odyssee')
    expect(normOpp("Drag'n Thrust")).toBe('dragn thrust')
    expect(normOpp('Salt & Pepper')).toBe('salt and pepper')
  })

  it('scores exact, contained and misspelled names', () => {
    expect(nameScore('shame', 'shame.')).toBe(1)
    expect(nameScore('Disco', 'Austin Disco Club')).toBeGreaterThan(0.85)
    expect(nameScore('Port Authority', 'Pittsburgh Port Authority')).toBeGreaterThan(0.9)
    expect(nameScore('Drag n Thrust', "Drag'n Thrust")).toBe(1)
    expect(nameScore('Odysee', 'Odyssée')).toBeGreaterThan(0.8)
    expect(nameScore('Hybrid', 'Polar Bears')).toBeLessThan(0.6)
  })

  it('suggests the best USAU team for each opponent with a quality', () => {
    const usau = parseUsauRankings(TABBED)
    const m = matchRanks([{ name: 'Disco', games: 2 }, { name: 'Shame', games: 1 }, { name: 'Odysee', games: 1 }, { name: 'Local Pickup', games: 1 }], usau)
    expect(m.map((x) => [x.opponent, x.best?.rank ?? null, x.quality])).toEqual([
      ['Disco', 4, 'likely'],
      ['Shame', 13, 'exact'],
      ['Odysee', 19, 'likely'],
      ['Local Pickup', null, 'none'],
    ])
    expect(m[0].options[0].name).toBe('Austin Disco Club')
  })
})

describe('rank for a game', () => {
  const g = (opponent: string, date: string) => ({ opponent, date }) as Pick<Game, 'opponent' | 'date'>
  it("prefers the game's season, falls back to the all-seasons rank, ignores deleted", () => {
    const list = [opp('AMP', '', 9), opp('AMP', '2025', 5), opp('Toro', '2026', 7, { deleted: true })]
    expect(rankFor(g('amp', '2025-08-01'), list)?.rank).toBe(5)
    expect(rankFor(g('AMP', '2026-08-01'), list)?.rank).toBe(9)
    expect(rankFor(g('AMP', ''), list)?.rank).toBe(9)
    expect(rankFor(g('Toro', '2026-08-01'), list)).toBeNull()
  })

  it('derives ids, seasons and the opponent list', () => {
    expect(opponentId('Austin Disco Club', '2026')).toBe('opp:2026:austin-disco-club')
    expect(opponentId('AMP', '')).toBe('opp:all:amp')
    expect(seasonOf('2026-09-01')).toBe('2026')
    expect(seasonOf('')).toBe('')
    const games = [
      { opponent: 'AMP', date: '2026-07-01', deleted: false },
      { opponent: 'amp ', date: '2026-08-01', deleted: false },
      { opponent: 'Toro', date: '2025-08-01', deleted: false },
      { opponent: 'Gone', date: '2026-08-01', deleted: true },
    ] as Game[]
    expect(opponentsOf(games)).toEqual([{ name: 'AMP', games: 2 }, { name: 'Toro', games: 1 }])
    expect(opponentsOf(games, '2025')).toEqual([{ name: 'Toro', games: 1 }])
    expect(seasonsOf(games)).toEqual(['2026', '2025'])
  })
})

describe('backups', () => {
  it('older backups have no opponents; new ones round-trip them', async () => {
    const { makeBackup, parseBackup } = await import('./backup')
    const old = { ...makeBackup({ teams: [], players: [], games: [], points: [], events: [] }, 5), schema_version: 2 } as Record<string, unknown>
    delete old.opponents
    expect(parseBackup(JSON.stringify(old)).opponents).toEqual([])
    const b = makeBackup({ teams: [], players: [], games: [], points: [], events: [], opponents: [opp('AMP', '2026', 5)] }, 5)
    expect(parseBackup(JSON.stringify(b)).opponents).toEqual([expect.objectContaining({ name: 'AMP', rank: 5 })])
  })
})
