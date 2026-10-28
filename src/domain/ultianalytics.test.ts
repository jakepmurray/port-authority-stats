import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'
import { computeGameStats } from './stats'
import {
  collectNames, fetchUltiTeam, findDuplicate, mapUAEvent, parseUltiCsv, parseUltiInput, parseUltiJson, planGame, suggestMatches,
  uaDate, uaTeamId, UAFetchError, type UAEvent, type UAGame,
} from './ultianalytics'

const files = import.meta.glob('./__fixtures__/ultianalytics/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fx = (f: string) => files[`./__fixtures__/ultianalytics/${f}`]

/** Identity mapping: the player id is the UltiAnalytics name (so stats can be compared by name). */
const ID = (n: string | null) => (n && n !== 'Anonymous' ? n : null)
const plan = (g: UAGame) => planGame(g, ID, { team_id: 't1', now: 1, today: '2026-10-21' })
const stats = (g: UAGame) => {
  const p = plan(g)
  return { p, s: computeGameStats(p.game, p.points, p.events) }
}

interface UAStat { playerName: string; goals: number; assists: number; ds: number; drops: number; throwaways: number; catches: number; pulls: number; pullsOB: number; callahans: number; stalls: number; pointsPlayed: number }

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and a BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\nlast,\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['last', '']])
  })
})

describe('UltiAnalytics CSV', () => {
  const csv = parseUltiCsv(fx('ua-export.csv'))
  it('splits games and points, folding period-end rows into the point before', () => {
    expect(csv.format).toBe('csv')
    expect(csv.games.map((g) => [g.opponent, g.tournament, g.date, g.final])).toEqual([
      ['River City', 'Fall Classic', '2026-10-20', { ours: 10, theirs: 7 }],
      ['Harbor Town', 'Fall Classic', '2026-10-20', { ours: 8, theirs: 14 }],
    ])
    const g1 = csv.games[0]
    expect(g1.timestamp).toBe('2026-10-20 2:40 PM') // narrow no-break space normalised
    expect(g1.points).toHaveLength(17) // 21 in UltiAnalytics, 4 of them only period ends
    expect(g1.points[0]).toMatchObject({ line: 'D', ours: 0, theirs: 1, exact: false })
    expect(g1.points.at(-1)!.events.map((e) => e.action).slice(-3)).toEqual(['Halftime', 'EndOfThirdQuarter', 'GameOver'])
    // The sub point lists both the injured player and the replacement.
    expect(g1.points[2].players).toHaveLength(8)
  })

  it('rejects other CSVs with a clear message', () => {
    expect(() => parseUltiCsv('Name,Number\nAnn,1')).toThrow(/Not an UltiAnalytics stats CSV/)
    expect(() => parseUltiInput('')).toThrow(/Nothing to import/)
  })

  it('maps every event type in the edge-case export', () => {
    const [g] = parseUltiCsv(fx('edge-cases.csv')).games
    const p = plan(g)
    expect(p.points).toHaveLength(4)
    expect(p.score).toEqual({ us: 2, them: 2 })
    expect(p.points.map((x) => x.outcome)).toEqual(['hold', 'them_hold', 'broken', 'break'])
    const types = (i: number) => p.events.filter((e) => e.point_id === p.points[i].id).map((e) => `${e.team}:${e.type}`)
    expect(types(0)).toEqual(['us:sub', 'them:pull', 'us:pickup', 'us:catch', 'us:drop', 'us:D', 'us:stall', 'them:throwaway', 'us:turnover', 'us:callahan'])
    expect(types(1)).toEqual(['us:pull', 'them:catch', 'us:timeout', 'them:goal'])
    expect(types(2)).toEqual(['them:pull', 'us:catch', 'them:callahan', 'us:half'])
    expect(types(3)).toEqual(['us:pull', 'them:throwaway', 'us:catch', 'us:goal'])
    // 8 players listed: the seven who touched the disc first start; Gus is recorded as coming on.
    expect(p.points[0].line).toEqual(['Ann', 'Bea', 'Cal', 'Hal', 'Dee', 'Eve', 'Fox'])
    expect(p.events[0]).toMatchObject({ type: 'sub', actor_id: null, receiver_id: 'Gus' })
    expect(p.points[1].pulled_by).toBe('Gus')
    expect(p.events.find((e) => e.type === 'pull' && e.team === 'us')!.note).toBe('Hang time 4.2s')
    expect(p.events.every((e) => e.source === 'import' && e.video_time === null && e.time_source === 'none')).toBe(true)
    expect(p.skipped).toEqual({ 'Offense Bogus': 1 })
    expect(p.warnings.join(' ')).toMatch(/Point 1: 8 players listed/)
    expect(p.warnings.join(' ')).toMatch(/Skipped 1 event .*Offense Bogus ×1/)
    expect(p.warnings.join(' ')).not.toMatch(/score/i)
    expect(p.game).toMatchObject({ opponent: 'Test U', tournament: 'Edge Open', date: '2026-09-12', start_on: 'O', ratio_first: 'W4', game_to: 3 })
    expect(p.game.notes).toMatch(/no gender match/)

    const s = computeGameStats(p.game, p.points, p.events)
    expect(s.state.score).toEqual({ us: 2, them: 2 })
    expect(s.state.points[2].halfAfter).toBe(true)
    expect(s.players.get('Fox')).toMatchObject({ callahans: 1, goals: 1, ds: 1 })
    expect(s.players.get('Bea')).toMatchObject({ throwaways: 1, completions: 0, throw_attempts: 2 }) // drop attempt + Callahan'd throw
    expect(s.players.get('Cal')).toMatchObject({ drops: 1, assists: 1 })
    expect(s.players.get('Dee')).toMatchObject({ stalls: 1, goals: 1 })
    expect(s.players.get('Eve')).toMatchObject({ other_turns: 1 })
    expect(s.players.get('Gus')).toMatchObject({ pulls: 2, partial_points: 1 })
    expect(s.team).toMatchObject({ pulls: 2, pulls_ob: 1, callahans: 1, subs: 1 })
    expect(s.opponent).toMatchObject({ goals: 2, callahans: 1 })
    expect(s.state.timeouts[1].us).toBe(1)
  })
})

describe('UltiAnalytics game JSON', () => {
  const json = parseUltiJson(fx('ua-gamesdata.json'))
  const csv = parseUltiCsv(fx('ua-export.csv'))
  it('reads games with exact lines and subs', () => {
    expect(json.format).toBe('json')
    const g1 = json.games.find((g) => g.opponent === 'River City')!
    expect(g1).toMatchObject({ ua_id: 'game-6E528915-B3D4-4AA0-86C8-0C2A150126D8', date: '2026-10-20', final: { ours: 10, theirs: 7 }, game_to: null, timeouts_per_half: 2 })
    const sp = g1.points[2]
    expect(sp.subs).toEqual([expect.objectContaining({ injury: true })])
    // `line` in UltiAnalytics is the line at the end; the start has the injured player instead.
    expect(sp.players).toHaveLength(7)
    expect(sp.players).toContain(sp.subs[0].from)
    expect(sp.players).not.toContain(sp.subs[0].to)
  })

  it('agrees with the CSV export point by point', () => {
    for (const opp of ['River City', 'Harbor Town']) {
      const j = json.games.find((g) => g.opponent === opp)!
      const c = csv.games.find((g) => g.opponent === opp)!
      expect(j.points.map((p) => [p.line, p.ours, p.theirs, p.events.length])).toEqual(c.points.map((p) => [p.line, p.ours, p.theirs, p.events.length]))
      for (const [i, p] of j.points.entries()) {
        const all = new Set([...p.players, ...p.subs.map((s) => s.to)])
        expect([...all].sort()).toEqual([...c.points[i].players].sort())
      }
    }
  })

  it('places a sub before the first event after it', () => {
    const g1 = json.games.find((g) => g.opponent === 'River City')!
    const p = plan(g1)
    const pt = p.points[2]
    const evs = p.events.filter((e) => e.point_id === pt.id)
    const i = evs.findIndex((e) => e.type === 'injury')
    const sub = g1.points[2].subs[0]
    expect(evs[i]).toMatchObject({ actor_id: sub.from, receiver_id: sub.to })
    expect(evs[i - 1]).toMatchObject({ type: 'throwaway', team: 'us' }) // the injured player's last possession ended
    expect(evs[i + 1]).toMatchObject({ type: 'throwaway', team: 'them' })
    expect(p.warnings).toEqual([])
  })

  it('reads an admin-site .iexport file', () => {
    const raw = JSON.parse(fx('ua-gamesdata.json'))[0]
    const team = { name: 'Fixture Team', mixed: true, players: [{ name: 'Pine', number: '7', male: false }, { name: 'Rowan', number: '', male: true }] }
    const r = parseUltiInput(JSON.stringify({ teamJson: JSON.stringify(team), gameJson: JSON.stringify(raw), hash: 'x' }))
    expect(r).toMatchObject({ format: 'iexport', team: 'Fixture Team' })
    expect(r.games).toHaveLength(1)
    expect(r.players).toEqual([{ name: 'Pine', number: '7', gender: 'W' }, { name: 'Rowan', number: null, gender: 'M' }])
  })
})

describe('stats parity with UltiAnalytics', () => {
  const json = parseUltiJson(fx('ua-gamesdata.json'))
  const csv = parseUltiCsv(fx('ua-export.csv'))
  const cases: [string, string][] = [['River City', 'ua-stats-g1.json'], ['Harbor Town', 'ua-stats-g2.json']]
  // UltiAnalytics also counts its period-end "points" (no play, e.g. Halftime) as points played.
  const raw = JSON.parse(fx('ua-gamesdata.json')) as { opponentName: string; pointsJson: string }[]
  const periodPoints = (opp: string, name: string) =>
    (JSON.parse(raw.find((g) => g.opponentName === opp)!.pointsJson) as { line: string[]; events: { type: string }[] }[])
      .filter((p) => p.events.every((e) => e.type === 'Cessation') && p.line.includes(name)).length
  for (const [opp, file] of cases) {
    const ua = JSON.parse(fx(file)) as UAStat[]
    it(`matches UltiAnalytics' own player stats for ${opp} (team-link import)`, () => {
      const { p, s } = stats(json.games.find((g) => g.opponent === opp)!)
      expect(p.warnings).toEqual([])
      for (const u of ua) {
        const m = s.players.get(u.playerName)
        if (!m) {
          expect(u.pointsPlayed - periodPoints(opp, u.playerName)).toBe(0)
          continue
        }
        expect({ n: u.playerName, goals: m.goals, assists: m.assists, ds: m.ds, drops: m.drops, catches: m.catches, pulls: m.pulls, callahans: m.callahans, stalls: m.stalls, throwaways: m.throwaways })
          .toEqual({ n: u.playerName, goals: u.goals, assists: u.assists, ds: u.ds, drops: u.drops, catches: u.catches, pulls: u.pulls + u.pullsOB, /* their pulls exclude OB pulls */ callahans: u.callahans, stalls: u.stalls, throwaways: u.throwaways })
        // UltiAnalytics credits half a point for a sub in or out; we count the point and flag it partial.
        expect(m.points - m.partial_points / 2).toBe(u.pointsPlayed - periodPoints(opp, u.playerName))
      }
    })
    it(`matches goals, assists and Ds for ${opp} (CSV import)`, () => {
      const { s } = stats(csv.games.find((g) => g.opponent === opp)!)
      for (const u of ua) {
        const m = s.players.get(u.playerName)
        expect([u.playerName, m?.goals ?? 0, m?.assists ?? 0, m?.ds ?? 0]).toEqual([u.playerName, u.goals, u.assists, u.ds])
      }
    })
  }
})

describe('event mapping', () => {
  it('knows every action UltiAnalytics can export', () => {
    const e = (type: string, action: string): UAEvent => ({ type, action, passer: 'A', receiver: 'B', defender: 'C', ts: null, hang: null })
    const known = {
      Offense: ['Catch', 'Drop', 'Goal', 'Throwaway', 'Stall', 'MiscPenalty', 'Callahan', 'PickupDisc', 'PullBegin', 'OpponentPull', 'OpponentPullOb'],
      Defense: ['Pull', 'PullOb', 'D', 'Callahan', 'Throwaway', 'Goal', 'OpponentCatch', 'PickupDisc'],
      Cessation: ['Timeout', 'Halftime', 'GameOver', 'EndOfFirstQuarter', 'EndOfThirdQuarter', 'EndOfFourthQuarter', 'EndOfOvertime'],
    }
    for (const [t, list] of Object.entries(known)) for (const a of list) expect(mapUAEvent(e(t, a), ID), `${t} ${a}`).not.toBe('unknown')
    expect(mapUAEvent(e('Offense', 'Teleport'), ID)).toBe('unknown')
    expect(mapUAEvent(e('Offense', 'Goal'), ID)).toMatchObject({ type: 'goal', team: 'us', actor_id: 'A', receiver_id: 'B' })
    expect(mapUAEvent(e('Defense', 'Callahan'), ID)).toMatchObject({ type: 'callahan', team: 'us', defender_id: 'C' })
    expect(mapUAEvent(e('Offense', 'Callahan'), ID)).toMatchObject({ type: 'callahan', team: 'them', actor_id: 'A' })
    expect(mapUAEvent({ ...e('Offense', 'Throwaway'), receiver: 'Anonymous' }, ID)).toMatchObject({ type: 'throwaway', actor_id: 'A' })
  })

  it('flags score mismatches', () => {
    const [g] = parseUltiCsv(fx('edge-cases.csv')).games
    const bad = { ...g, points: g.points.map((p, i) => (i === 0 ? { ...p, events: p.events.filter((e) => e.action !== 'Callahan') } : p)) }
    const w = plan(bad).warnings.join(' ')
    expect(w).toMatch(/Point 1: the events give no goal, but UltiAnalytics scores it as our goal \(1–0\)/)
    expect(w).not.toMatch(/Point 2:.*goal/) // one bad point is one warning
    expect(w).toMatch(/Final score here is 1–2, UltiAnalytics says 2–2/)
  })
})

describe('players', () => {
  it('collects names (not Anonymous) and suggests roster matches', () => {
    const [g] = parseUltiCsv(fx('edge-cases.csv')).games
    const names = collectNames([g])
    expect([...names.keys()].sort()).toEqual(['Ann', 'Bea', 'Cal', 'Dee', 'Eve', 'Fox', 'Gus', 'Hal'])
    const roster = [
      { id: 'p1', name: 'Ann Lee', deleted: false },
      { id: 'p2', name: 'Bea', deleted: false },
      { id: 'p3', name: 'Cal Smith', deleted: false },
      { id: 'p4', name: 'Cal Jones', deleted: false },
      { id: 'p5', name: 'Mary Dee', deleted: false },
      { id: 'p6', name: 'Fox', deleted: true },
    ]
    const m = suggestMatches(['Ann', 'bea', 'Cal', 'Dee', 'Fox', 'Gus', 'Hal'], roster, { Hal: 'p4' })
    expect(Object.fromEntries(m)).toEqual({
      Ann: { kind: 'player', id: 'p1' }, // first name
      bea: { kind: 'player', id: 'p2' }, // exact, any case
      Cal: { kind: 'new' }, // two Cals: ambiguous
      Dee: { kind: 'player', id: 'p5' }, // last name
      Fox: { kind: 'new' }, // deleted players don't match
      Gus: { kind: 'new' },
      Hal: { kind: 'player', id: 'p4' }, // remembered from a previous import
    })
  })
})

describe('de-dupe', () => {
  const [g] = parseUltiCsv(fx('edge-cases.csv')).games
  const p = plan(g)
  const base = { id: 'x', opponent: ' test u ', date: '2026-09-12', notes: '', deleted: false }
  it('matches the same opponent, date and score', () => {
    expect(findDuplicate(p, [{ game: base, score: { us: 2, them: 2 } }])?.id).toBe('x')
    expect(findDuplicate(p, [{ game: base, score: { us: 3, them: 2 } }])).toBeNull()
    expect(findDuplicate(p, [{ game: { ...base, date: '2026-09-13' }, score: { us: 2, them: 2 } }])).toBeNull()
    expect(findDuplicate(p, [{ game: { ...base, deleted: true }, score: { us: 2, them: 2 } }])).toBeNull()
  })
  it('matches a game imported earlier by its marker even if edited since', () => {
    expect(findDuplicate(p, [{ game: { ...base, opponent: 'Renamed', notes: p.game.notes }, score: { us: 9, them: 9 } }])?.id).toBe('x')
  })
})

describe('team link', () => {
  it('pulls the team ID out of links', () => {
    expect(uaTeamId('https://www.ultianalytics.com/app/#/5629499534213120/games')).toBe('5629499534213120')
    expect(uaTeamId('www.ultianalytics.com/team/5629499534213120/main')).toBe('5629499534213120')
    expect(uaTeamId(' 5629499534213120 ')).toBe('5629499534213120')
    expect(uaTeamId('https://example.com/app/#/5629499534213120')).toBeNull()
    expect(uaTeamId('Date/Time,Tournamemnt')).toBeNull()
    expect(uaDate('2026-03-29 09:53')).toBe('2026-03-29')
  })

  const res = (body: string, status = 200) => new Response(body, { status })
  it('reads a public team from the API', async () => {
    const urls: string[] = []
    const f = async (u: string, init?: RequestInit) => {
      urls.push(u)
      expect(init?.credentials).toBe('omit')
      if (u.endsWith('/players')) return res(fx('ua-players.json'))
      if (u.endsWith('/gamesdata')) return res(fx('ua-gamesdata.json'))
      return res(fx('ua-team.json'))
    }
    const t = await fetchUltiTeam('1234567890123456', f)
    expect(urls.sort()).toEqual([
      'https://www.ultianalytics.com/rest/view/team/1234567890123456',
      'https://www.ultianalytics.com/rest/view/team/1234567890123456/gamesdata',
      'https://www.ultianalytics.com/rest/view/team/1234567890123456/players',
    ])
    expect(t.team).toBe('Fixture Team 2026')
    expect(t.games).toHaveLength(2)
    expect(t.players.length).toBeGreaterThan(5)
    expect(t.players.every((p) => p.gender === null)).toBe(true) // not a mixed team: `male` means nothing
  })

  it('explains password-protected, missing and unreachable teams', async () => {
    const err = async (f: () => Promise<Response>) => {
      try {
        await fetchUltiTeam('1', f)
      } catch (e) {
        return e as UAFetchError
      }
      throw new Error('expected a failure')
    }
    expect((await err(async () => res('', 401))).kind).toBe('password')
    expect((await err(async () => res('<html>404</html>', 404))).kind).toBe('not_found')
    expect((await err(async () => { throw new TypeError('Failed to fetch') })).kind).toBe('unreachable')
    expect((await err(async () => res('', 503))).message).toMatch(/HTTP 503/)
  })
})

describe('imported games are ended', () => {
  it('marks every planned UltiAnalytics game ended at the recorded score', () => {
    for (const g of parseUltiCsv(fx('ua-export.csv')).games) {
      const { p, s } = stats(g)
      expect(p.game.ended_at).toBe(1)
      expect(s.state.ended).toBe(true)
      expect(s.state.result).toBe(s.state.score.us > s.state.score.them ? 'W' : s.state.score.us < s.state.score.them ? 'L' : 'T')
    }
  })
})
