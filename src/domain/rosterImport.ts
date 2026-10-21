import type { GenderMatch, Player, PlayerRole } from './schema'

/**
 * Roster import from USA Ultimate team pages, UltiRZR team/game pages, or any
 * pasted roster table / list. Pure parsing — no network. Gender match is never
 * guessed silently: it comes only from an explicit column; pronouns are kept so
 * the user can opt in to "fill from pronouns".
 */

export interface ImportedPlayer {
  name: string
  number: string | null
  gender_match: GenderMatch | null
  role: PlayerRole | null
  pronouns: string
  position: string
}

export type RosterSource = 'usau' | 'ultirzr' | 'table' | 'text'

export interface RosterCandidate {
  source: RosterSource
  team: string | null
  year: string | null
  teamId: string | null
  players: ImportedPlayer[]
}

export type LinkKind = { site: 'usau' | 'ultirzr' | 'other'; teamId: string | null; year: string | null }

export function classifyLink(input: string): LinkKind | null {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol)) return null
  const host = u.hostname.replace(/^www\./, '')
  if (host.endsWith('usaultimate.org')) {
    return { site: 'usau', teamId: u.searchParams.get('EventTeamId') ?? u.searchParams.get('TeamId'), year: null }
  }
  if (host === 'ultirzr.app' || host.endsWith('.ultirzr.app')) {
    const m = u.pathname.match(/^\/team\/([^/]+)/)
    return { site: 'ultirzr', teamId: m ? decodeURIComponent(m[1]) : null, year: u.searchParams.get('year') }
  }
  return { site: 'other', teamId: null, year: null }
}

const clean = (s: string) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

export function normalizeName(s: string) {
  return clean(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .toLowerCase()
}

export function roleFromPosition(pos: string): PlayerRole | null {
  const p = pos.toLowerCase()
  if (!p.trim()) return null
  const h = /handler|thrower/.test(p)
  const c = /cutter|deep|mid|receiver/.test(p)
  if (h && c) return 'hybrid'
  if (h) return 'handler'
  if (c) return 'cutter'
  if (/hybrid|utility/.test(p)) return 'hybrid'
  return null
}

export function genderFromText(g: string): GenderMatch | null {
  const t = g.trim().toLowerCase()
  if (/^(w|wmp|f|female|woman|women|woman[- ]matching|fmp)$/.test(t)) return 'W'
  if (/^(m|mmp|male|man|men|man[- ]matching)$/.test(t)) return 'M'
  return null
}

/** Opt-in helper: USAU shows pronouns as S (she), H (he), T (they). Only she/he map. */
export function genderFromPronouns(p: string): GenderMatch | null {
  const t = p.trim().toLowerCase()
  if (/^(s|she|she\/her|she\/hers)$/.test(t) || t.startsWith('she/')) return 'W'
  if (/^(h|he|he\/him|he\/his)$/.test(t) || t.startsWith('he/')) return 'M'
  return null
}

const numberOf = (s: string): string | null => {
  const m = clean(s).replace(/^#/, '').match(/^\d{1,2}$/)
  return m ? m[0] : null
}

function player(name: string, number: string, pronouns = '', position = '', gender = ''): ImportedPlayer | null {
  const n = clean(name)
  if (!n || /^(name|player|players)$/i.test(n)) return null
  return {
    name: n,
    number: numberOf(number),
    gender_match: genderFromText(gender),
    role: roleFromPosition(position),
    pronouns: clean(pronouns).replace(/\s*mere info\s*/i, ''),
    position: clean(position),
  }
}

// ---------- column mapping shared by HTML tables and text tables ----------

type Cols = { name: number; number: number; pronouns: number; position: number; gender: number }

function mapHeader(cells: string[]): Cols | null {
  const find = (re: RegExp) => cells.findIndex((c) => re.test(clean(c).toLowerCase()))
  const cols: Cols = {
    name: find(/^(player|players|name|full ?name|player name)$/),
    number: find(/^(no\.?|#|num|number|jersey|jersey ?(no\.?|#|number))$/),
    pronouns: find(/^pronouns/),
    position: find(/^(position|pos\.?|role)$/),
    gender: find(/^(gender|gender ?match|match|g)$/),
  }
  return cols.name >= 0 ? cols : null
}

function rowsToPlayers(rows: string[][], cols: Cols) {
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '') : '')
  return rows
    .map((r) => player(at(r, cols.name), at(r, cols.number), at(r, cols.pronouns), at(r, cols.position), at(r, cols.gender)))
    .filter((p): p is ImportedPlayer => !!p)
}

// ---------- HTML ----------

function parseTables(doc: Document): ImportedPlayer[] {
  let best: ImportedPlayer[] = []
  let bestScore = -1
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    const trs = Array.from(table.querySelectorAll('tr'))
    if (trs.length < 2) continue
    const cellsOf = (tr: Element) => Array.from(tr.querySelectorAll('th,td')).map((c) => c.textContent ?? '')
    const hi = trs.findIndex((tr) => mapHeader(cellsOf(tr)))
    if (hi < 0) continue
    const cols = mapHeader(cellsOf(trs[hi]))!
    const players = rowsToPlayers(trs.slice(hi + 1).map(cellsOf), cols)
    const score = players.length + (cols.number >= 0 ? 1000 : 0) // prefer tables with jersey numbers
    if (players.length && score > bestScore) {
      best = players
      bestScore = score
    }
  }
  return best
}

/** Next.js (UltiRZR) pages carry data in self.__next_f.push([1,"..."]) scripts. */
function nextFlightText(html: string): string {
  let out = ''
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  for (let m = re.exec(html); m; m = re.exec(html)) {
    try {
      out += JSON.parse(m[1]) as string
    } catch {
      /* skip malformed chunk */
    }
  }
  return out
}

function bracketSlice(s: string, start: number): string | null {
  let depth = 0
  let inStr = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[') depth++
    else if (ch === ']' && --depth === 0) return s.slice(start, i + 1)
  }
  return null
}

interface Personnel {
  FullName?: string
  JerseyNumber?: string
  Pronouns?: string
  Position?: string
  Role?: string
}

function parseUltirzrData(text: string): RosterCandidate[] {
  const out: RosterCandidate[] = []
  const seen = new Set<string>()
  const re = /"Personnel":\[/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const arr = bracketSlice(text, m.index + m[0].length - 1)
    if (!arr) continue
    let list: Personnel[]
    try {
      list = JSON.parse(arr) as Personnel[]
    } catch {
      continue
    }
    const pre = text.slice(Math.max(0, m.index - 3000), m.index)
    const last = (r: RegExp) => {
      const all = [...pre.matchAll(r)]
      return all.length ? all[all.length - 1][1] : null
    }
    const team = last(/"TeamName":"([^"]+)"/g)
    const year = last(/"Year":"?(\d{4})/g)
    const teamId = last(/"TeamId":(\d+)/g)
    const players = list
      .filter((p) => p && typeof p.FullName === 'string' && (p.Role ?? 'Player') !== 'Coach')
      .map((p) => player(p.FullName!, p.JerseyNumber ?? '', p.Pronouns ?? '', p.Position ?? ''))
      .filter((p): p is ImportedPlayer => !!p)
    if (!players.length) continue
    const key = `${team}|${year}|${teamId}|${players.length}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ source: 'ultirzr', team, year, teamId, players })
  }
  return out
}

function teamNameFromDoc(doc: Document): string | null {
  const usau = doc.querySelector('[id$="lnkTeamName"]')
  if (usau?.textContent) return clean(usau.textContent)
  const h = doc.querySelector('h3, h4, h1')
  return h?.textContent ? clean(h.textContent) || null : null
}

export function parseRosterHtml(html: string): RosterCandidate[] {
  const flight = nextFlightText(html)
  const fromData = flight ? parseUltirzrData(flight) : []
  if (fromData.length) return fromData
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const players = parseTables(doc)
  if (!players.length) {
    const text = doc.body?.innerText ?? doc.body?.textContent ?? ''
    return text ? parseRosterText(text) : []
  }
  const isUsau = /usaultimate|ucTeamDetails/i.test(html)
  const isRzr = /ultirzr/i.test(html)
  return [{ source: isRzr ? 'ultirzr' : isUsau ? 'usau' : 'table', team: teamNameFromDoc(doc), year: null, teamId: null, players }]
}

// ---------- plain text ----------

export function parseRosterText(text: string): RosterCandidate[] {
  const lines = text.replace(/\r/g, '').split('\n')
  // 1) A table copied from a web page (tab separated) or CSV, with a header row.
  for (const sep of ['\t', ',', ';']) {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(sep)) continue
      const cols = mapHeader(splitRow(lines[i], sep))
      if (!cols) continue
      const rows: string[][] = []
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]
        if (!l.trim()) {
          if (rows.length) break
          continue
        }
        if (!l.includes(sep)) break
        rows.push(splitRow(l, sep))
      }
      const players = rowsToPlayers(rows, cols)
      if (players.length) {
        const team = /Player Roster/.test(text) ? usauTeamFromText(lines, i) : null
        return [{ source: /USA Ultimate|Player Roster/.test(text) ? 'usau' : 'table', team, year: null, teamId: null, players }]
      }
    }
  }
  // 2) One player per line: "12 Jane Doe", "#12 Jane Doe W", "Jane Doe 12", "Jane Doe, 12, MMP".
  const players: ImportedPlayer[] = []
  for (const raw of lines) {
    const l = clean(raw)
    if (!l) continue
    let m = l.match(/^#?(\d{1,2})[\s.,:-]+(.+?)(?:[\s,]+(WMP|MMP|W|M))?$/i)
    if (m) {
      const p = player(m[2], m[1], '', '', m[3] ?? '')
      if (p) players.push(p)
      continue
    }
    m = l.match(/^(.+?)[\s,]+#?(\d{1,2})(?:[\s,]+(WMP|MMP|W|M))?$/i)
    if (m && /[a-z]/i.test(m[1])) {
      const p = player(m[1].replace(/,$/, ''), m[2], '', '', m[3] ?? '')
      if (p) players.push(p)
    }
  }
  return players.length >= 2 ? [{ source: 'text', team: null, year: null, teamId: null, players }] : []
}

function splitRow(line: string, sep: string): string[] {
  if (sep !== ',') return line.split(sep)
  // minimal CSV with quotes
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    }
    else cur += ch
  }
  out.push(cur)
  return out
}

function usauTeamFromText(lines: string[], headerIdx: number): string | null {
  // On USAU pages the team name sits a few lines above "Competition Level:".
  const cl = lines.findIndex((l, i) => i < headerIdx && /^Competition Level:/.test(l.trim()))
  for (let i = cl - 1; i >= 0 && i > cl - 6; i--) {
    const t = clean(lines[i])
    if (t && !/^(Club|College|Youth)\s*-/.test(t) && !/,/.test(t)) return t
  }
  return null
}

/** Parse anything the user pasted: page source/clipboard HTML, copied text, or a list. */
export function parseRosterInput(input: { text?: string; html?: string }): RosterCandidate[] {
  if (input.html && input.html.trim()) {
    const r = parseRosterHtml(input.html)
    if (r.length) return r
  }
  const t = input.text ?? ''
  if (/<\s*(html|table|tr|script)[\s>]/i.test(t)) {
    const r = parseRosterHtml(t)
    if (r.length) return r
  }
  return parseRosterText(t)
}

/** Choose the best candidate: matches the link's team id/year, else our team name, else the biggest. */
export function pickCandidate(cands: RosterCandidate[], link: LinkKind | null, teamName: string): number {
  if (!cands.length) return -1
  const score = (c: RosterCandidate) => {
    let s = 0
    if (link?.teamId && c.teamId === link.teamId) s += 100
    if (link?.year && c.year === link.year) s += 20
    if (c.team && normalizeName(c.team).includes(normalizeName(teamName))) s += 50
    if (c.year) s += Math.max(0, Number(c.year) - 2000) // newer first
    return s + c.players.filter((p) => p.number !== null).length / 1000
  }
  let best = 0
  cands.forEach((c, i) => {
    if (score(c) > score(cands[best])) best = i
  })
  return best
}

// ---------- merge planning ----------

export type RowAction = 'add' | 'update' | 'skip'

export interface PlanRow extends ImportedPlayer {
  key: string
  action: RowAction
  existingId: string | null
  /** Why this row needs attention. */
  notes: string[]
}

export function planImport(players: ImportedPlayer[], existing: Player[]): PlanRow[] {
  const live = existing.filter((p) => !p.deleted)
  const byName = new Map(live.map((p) => [normalizeName(p.name), p]))
  const seenNames = new Set<string>()
  return players.map((p, i) => {
    const notes: string[] = []
    const nn = normalizeName(p.name)
    const match = byName.get(nn) ?? null
    let action: RowAction = 'add'
    if (seenNames.has(nn)) {
      notes.push('Listed twice in the import')
      action = 'skip'
    }
    seenNames.add(nn)
    if (match && action !== 'skip') {
      const diff =
        (p.number !== null && p.number !== match.number) ||
        (p.role !== null && p.role !== match.role) ||
        (p.gender_match !== null && p.gender_match !== match.gender_match)
      action = 'skip'
      notes.push(diff ? `Already on roster as #${match.number}; choose Update to apply changes` : 'Already on roster')
    }
    return { ...p, key: `r${i}`, action, existingId: match?.id ?? null, notes }
  })
}

export interface RowIssue {
  level: 'error' | 'warn'
  message: string
}

/** Validation for one plan row against the others and the existing roster. */
export function rowIssues(row: PlanRow, rows: PlanRow[], existing: Player[]): RowIssue[] {
  if (row.action === 'skip') return []
  const out: RowIssue[] = []
  if (!clean(row.name)) out.push({ level: 'error', message: 'Name is required' })
  if (row.action === 'add') {
    if (row.number === null || !/^\d{1,2}$/.test(row.number)) out.push({ level: 'error', message: 'Jersey number 0–99 needed' })
    if (!row.gender_match) out.push({ level: 'error', message: 'Pick WMP or MMP' })
  }
  if (row.number !== null) {
    const clashImport = rows.some((r) => r !== row && r.action !== 'skip' && r.number === row.number)
    const clashRoster = existing.some((p) => !p.deleted && p.number === row.number && p.id !== row.existingId && !rows.some((r) => r.action === 'update' && r.existingId === p.id && r.number !== row.number))
    if (clashImport || clashRoster) out.push({ level: 'warn', message: `#${row.number} is used by someone else (keyboard entry needs unique numbers)` })
  }
  return out
}
