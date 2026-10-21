import { describe, expect, it } from 'vitest'
import { PlayerSchema } from './schema'
import {
  classifyLink, genderFromPronouns, parseRosterInput, parseRosterText, pickCandidate, planImport, roleFromPosition, rowIssues,
} from './rosterImport'

const files = import.meta.glob('./__fixtures__/roster/*.{html,txt}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fx = (f: string) => files[`./__fixtures__/roster/${f}`]

describe('classifyLink', () => {
  it('recognises USAU and UltiRZR links', () => {
    expect(classifyLink('https://play.usaultimate.org/events/teams/?EventTeamId=1380841')).toEqual({ site: 'usau', teamId: '1380841', year: null })
    expect(classifyLink('https://www.ultirzr.app/team/761828719/roster?year=2026')).toEqual({ site: 'ultirzr', teamId: '761828719', year: '2026' })
    expect(classifyLink('https://ultirzr.app/team/pittsburgh-port-authority?year=2026')?.teamId).toBe('pittsburgh-port-authority')
    expect(classifyLink('https://example.com/x')?.site).toBe('other')
    expect(classifyLink('12 Jane')).toBeNull()
  })
})

describe('USAU team page', () => {
  it('parses the page source (26 players, numbers, pronouns, positions)', () => {
    const [c] = parseRosterInput({ text: fx('usau-sectionals.html') })
    expect(c.source).toBe('usau')
    expect(c.team).toBe('Pittsburgh Port Authority')
    expect(c.players).toHaveLength(26)
    expect(c.players[0]).toMatchObject({ name: 'Kristin Dudley', number: '0', gender_match: null })
    const max = c.players.find((p) => p.name === 'Max Sheppard')!
    expect(max).toMatchObject({ number: '1', role: 'hybrid', position: 'Handler/Cutter' })
    expect(c.players.find((p) => p.name === 'Kailey Rugani')!.pronouns).toBe('S')
    expect(c.players.find((p) => p.name === 'Jake Murray')!.number).toBe('10')
  })
  it('season page: picks the roster table (with numbers) over the goals table', () => {
    const [c] = parseRosterInput({ text: fx('usau-season.html') })
    expect(c.players).toHaveLength(29)
    expect(c.players.every((p) => p.number !== null)).toBe(true)
  })
  it('clipboard HTML and clipboard text give the same roster', () => {
    const a = parseRosterInput({ html: fx('usau-clip.html'), text: fx('usau-clip.txt') })[0]
    const b = parseRosterInput({ text: fx('usau-clip.txt') })[0]
    expect(a.players.map((p) => `${p.number} ${p.name}`)).toEqual(b.players.map((p) => `${p.number} ${p.name}`))
    expect(b.players).toHaveLength(26)
    expect(b.source).toBe('usau')
    expect(b.team).toBe('Pittsburgh Port Authority')
  })
})

describe('UltiRZR', () => {
  it('page source: all rosters on the page, picks the 2026 team from the link', () => {
    const cands = parseRosterInput({ text: fx('ultirzr-source.html') })
    expect(cands.length).toBeGreaterThan(3)
    const i = pickCandidate(cands, classifyLink('https://www.ultirzr.app/team/761828719/roster?year=2026'), 'Port Authority')
    const c = cands[i]
    expect(c).toMatchObject({ source: 'ultirzr', team: 'Pittsburgh Port Authority', year: '2026', teamId: '761828719' })
    expect(c.players).toHaveLength(29) // coaches excluded
    expect(c.players.find((p) => p.name === 'Sarah Kingsley-Hart')).toBeTruthy() // double space collapsed
    expect(c.players.some((p) => /Duffy/.test(p.name))).toBe(false)
  })
  it('without a link, prefers our team name and the newest year', () => {
    const cands = parseRosterInput({ text: fx('ultirzr-source.html') })
    const c = cands[pickCandidate(cands, null, 'Port Authority')]
    expect(c.team).toBe('Pittsburgh Port Authority')
    expect(c.year).toBe('2026')
  })
  it('clipboard HTML: rendered roster table (names + numbers)', () => {
    const [c] = parseRosterInput({ html: fx('ultirzr-clip.html'), text: '' })
    expect(c.source).toBe('ultirzr')
    expect(c.players.length).toBe(29)
    expect(c.players.find((p) => p.name === 'Vivian Shen')!.number).toBe('8')
  })
})

describe('plain text and lists', () => {
  it('CSV with header incl. gender', () => {
    const [c] = parseRosterText('Name,Number,Gender,Position\n"Doe, Jane",7,WMP,Handler\nSam Lee,12,MMP,Cutter\n')
    expect(c.players).toEqual([
      expect.objectContaining({ name: 'Doe, Jane', number: '7', gender_match: 'W', role: 'handler' }),
      expect.objectContaining({ name: 'Sam Lee', number: '12', gender_match: 'M', role: 'cutter' }),
    ])
  })
  it('one per line, number first or last, optional gender', () => {
    const [c] = parseRosterText('12 Jane Doe W\n#3 Al Smith\nBo Jones 45 MMP\n\nnot a player line')
    expect(c.players.map((p) => [p.number, p.name, p.gender_match])).toEqual([
      ['12', 'Jane Doe', 'W'], ['3', 'Al Smith', null], ['45', 'Bo Jones', 'M'],
    ])
  })
  it('returns nothing for junk', () => {
    expect(parseRosterInput({ text: 'hello world' })).toEqual([])
  })
})

describe('helpers', () => {
  it('maps positions and pronouns', () => {
    expect(roleFromPosition('Handler/Cutter')).toBe('hybrid')
    expect(roleFromPosition('Defense (Cutter)')).toBe('cutter')
    expect(roleFromPosition('Deep')).toBe('cutter')
    expect(roleFromPosition('')).toBeNull()
    expect(genderFromPronouns('S')).toBe('W')
    expect(genderFromPronouns('he/they')).toBe('M')
    expect(genderFromPronouns('T')).toBeNull()
    expect(genderFromPronouns('')).toBeNull()
  })
})

describe('planImport / rowIssues', () => {
  const existing = [
    PlayerSchema.parse({ id: 'x', team_id: 't', name: 'Jake Murray', number: '10', gender_match: 'M', created_at: 1, updated_at: 1 }),
    PlayerSchema.parse({ id: 'y', team_id: 't', name: 'Old Timer', number: '7', gender_match: 'M', created_at: 1, updated_at: 1 }),
  ]
  const imp = [
    { name: 'jake  murray', number: '10', gender_match: null, role: null, pronouns: '', position: '' },
    { name: 'Ryan Kindell', number: '7', gender_match: null, role: null, pronouns: '', position: '' },
    { name: 'Ryan Kindell', number: '7', gender_match: null, role: null, pronouns: '', position: '' },
    { name: 'Kristin Dudley', number: null, gender_match: 'W' as const, role: null, pronouns: '', position: '' },
  ]
  it('matches existing players by name, skips duplicates', () => {
    const plan = planImport(imp, existing)
    expect(plan.map((r) => r.action)).toEqual(['skip', 'add', 'skip', 'add'])
    expect(plan[0].existingId).toBe('x')
    expect(plan[2].notes).toContain('Listed twice in the import')
  })
  it('flags missing gender/number and number clashes', () => {
    const plan = planImport(imp, existing)
    expect(rowIssues(plan[1], plan, existing).map((i) => i.level)).toEqual(['error', 'warn']) // no gender; #7 taken
    expect(rowIssues(plan[3], plan, existing).map((i) => i.message)).toEqual(['Jersey number 0–99 needed'])
    expect(rowIssues(plan[0], plan, existing)).toEqual([])
  })
})
