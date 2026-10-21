import { useMemo, useState } from 'react'
import { actions, TEAM_NAME } from '../db/actions'
import { repo } from '../db/repo'
import {
  classifyLink, genderFromPronouns, parseRosterInput, pickCandidate, planImport, rowIssues,
  type PlanRow, type RosterCandidate, type RowAction,
} from '../domain/rosterImport'
import type { Player } from '../domain/schema'
import { Badge, Btn, Card, Input, Select } from './kit'

const SOURCE_LABEL = { usau: 'USA Ultimate', ultirzr: 'UltiRZR', table: 'table', text: 'list' } as const

async function tryFetch(url: string): Promise<string> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 8000)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.text()
  } finally {
    clearTimeout(t)
  }
}

/**
 * Import a roster from a USAU or UltiRZR page (or any roster table/list).
 * Browsers block reading those sites directly (no CORS), so the reliable path is
 * paste: open the page, Ctrl+A, Ctrl+C, paste here. Nothing is written until the
 * user reviews the preview and confirms.
 */
export function RosterImport({ existing, onClose }: { existing: Player[]; onClose: () => void }) {
  const [input, setInput] = useState('')
  const [html, setHtml] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null)
  const [cands, setCands] = useState<RosterCandidate[]>([])
  const [pick, setPick] = useState(0)
  const [rows, setRows] = useState<PlanRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  const linkKind = link ? classifyLink(link) : null

  const load = (found: RosterCandidate[], lk: string | null) => {
    if (!found.length) {
      setRows(null)
      setCands([])
      return setStatus({ text: 'No roster found in that. Paste the copied page (Ctrl+A, Ctrl+C on the roster page) or a list like "12 Jane Doe W".', bad: true })
    }
    const i = pickCandidate(found, lk ? classifyLink(lk) : null, TEAM_NAME)
    setCands(found)
    setPick(i)
    setRows(planImport(found[i].players, existing))
    setStatus({ text: `Found ${found[i].players.length} players${found.length > 1 ? ` (${found.length} rosters on that page)` : ''}. Review below, then import.` })
  }

  const parse = async () => {
    const text = input.trim()
    const kind = classifyLink(text)
    if (kind && !text.includes('\n')) {
      setLink(text)
      setBusy(true)
      setStatus({ text: 'Trying to read the page…' })
      try {
        const page = await tryFetch(text)
        load(parseRosterInput({ text: page }), text)
      } catch {
        setStatus({
          text: `${kind.site === 'usau' ? 'USA Ultimate' : kind.site === 'ultirzr' ? 'UltiRZR' : 'That site'} doesn't let other apps read its pages. Open the page, press Ctrl+A then Ctrl+C (⌘A, ⌘C on Mac), and paste it into the box.`,
          bad: true,
        })
      } finally {
        setBusy(false)
      }
      return
    }
    load(parseRosterInput({ text: input, html: html ?? undefined }), link)
  }

  const setRow = (key: string, patch: Partial<PlanRow>) => setRows((rs) => rs && rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const issues = useMemo(() => new Map((rows ?? []).map((r) => [r.key, rowIssues(r, rows!, existing)])), [rows, existing])
  const counts = { add: 0, update: 0, skip: 0 }
  for (const r of rows ?? []) counts[r.action]++
  const errors = [...issues.values()].flat().filter((i) => i.level === 'error').length
  const blankGender = (rows ?? []).filter((r) => r.action === 'add' && !r.gender_match)
  const pronounFill = blankGender.filter((r) => genderFromPronouns(r.pronouns)).length

  const commit = async () => {
    if (!rows || errors) return
    setBusy(true)
    try {
      const team = await actions.ensureTeam()
      for (const r of rows) {
        if (r.action === 'add') {
          await repo.create('players', { team_id: team.id, name: r.name.trim(), number: r.number!, gender_match: r.gender_match!, role: r.role ?? 'hybrid' })
        } else if (r.action === 'update' && r.existingId) {
          const patch: Partial<Player> = { name: r.name.trim() }
          if (r.number !== null) patch.number = r.number
          if (r.gender_match) patch.gender_match = r.gender_match
          if (r.role) patch.role = r.role
          await repo.update('players', r.existingId, patch, { byHand: true })
        }
      }
      setStatus({ text: `Imported: ${counts.add} added, ${counts.update} updated, ${counts.skip} skipped.` })
      setRows(null)
      setCands([])
      setInput('')
      setHtml(null)
    } catch (e) {
      setStatus({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Import roster" actions={<Btn size="sm" tone="ghost" onClick={onClose}>Close</Btn>}>
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-slate-400">
          From a <b>USA Ultimate</b> team page (play.usaultimate.org) or an <b>UltiRZR</b> team/game page (ultirzr.app):
          open the page, press <kbd>Ctrl+A</kbd> then <kbd>Ctrl+C</kbd>, and paste here. You can also paste the page source, a CSV
          (Name, Number, Gender…), or one player per line (“12 Jane Doe W”). Pasting just a link tries to read it directly, but those
          sites usually block that.
        </p>
        <textarea
          aria-label="Roster link or pasted page"
          className="min-h-28 rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-xs"
          placeholder="Paste the link, the copied page, or a list…"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            if (!e.target.value) setHtml(null)
          }}
          onPaste={(e) => {
            const h = e.clipboardData.getData('text/html')
            const t = e.clipboardData.getData('text/plain')
            setHtml(h || null)
            if (h || t.includes('\n')) {
              // Parse right away; keep the plain text visible in the box.
              e.preventDefault()
              setInput(t)
              load(parseRosterInput({ text: t, html: h || undefined }), link)
            } else if (classifyLink(t.trim())) setLink(t.trim())
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Btn tone="primary" disabled={!input.trim() || busy} onClick={() => void parse()}>
            {classifyLink(input.trim()) && !input.includes('\n') ? 'Read link' : 'Find players'}
          </Btn>
          {linkKind && link && (
            <a className="text-xs text-sky-300 underline" href={link} target="_blank" rel="noreferrer">
              Open {linkKind.site === 'usau' ? 'USA Ultimate' : linkKind.site === 'ultirzr' ? 'UltiRZR' : 'the'} page in a new tab
            </a>
          )}
          {status && <span className={`text-xs ${status.bad ? 'text-rose-300' : 'text-emerald-300'}`}>{status.text}</span>}
        </div>

        {cands.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Roster
            <Select
              value={pick}
              onChange={(e) => {
                const i = Number(e.target.value)
                setPick(i)
                setRows(planImport(cands[i].players, existing))
              }}
            >
              {cands.map((c, i) => (
                <option key={i} value={i}>
                  {c.team ?? 'Unknown team'} {c.year ?? ''} · {c.players.length} players
                </option>
              ))}
            </Select>
          </label>
        )}

        {rows && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="info">{SOURCE_LABEL[cands[pick]?.source ?? 'text']}</Badge>
              {cands[pick]?.team && <span className="text-slate-300">{cands[pick].team}</span>}
              <span className="text-slate-400">
                {counts.add} to add · {counts.update} to update · {counts.skip} skipped
              </span>
              {blankGender.length > 0 && (
                <>
                  <span className="text-amber-300">{blankGender.length} need a gender match (not listed on these sites)</span>
                  {pronounFill > 0 && (
                    <Btn
                      size="sm"
                      title="Suggests WMP for she/her (S) and MMP for he/him (H). Pronouns are not gender match: check each one."
                      onClick={() =>
                        setRows((rs) => rs && rs.map((r) => (r.action === 'add' && !r.gender_match ? { ...r, gender_match: genderFromPronouns(r.pronouns) } : r)))
                      }
                    >
                      Suggest from pronouns ({pronounFill})
                    </Btn>
                  )}
                  <Btn size="sm" onClick={() => setRows((rs) => rs && rs.map((r) => (r.action === 'add' && !r.gender_match ? { ...r, action: 'skip' } : r)))}>
                    Skip those
                  </Btn>
                </>
              )}
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-800">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="sticky top-0 bg-slate-900 text-left text-slate-400">
                  <tr>
                    <th className="p-1">Action</th>
                    <th className="p-1">#</th>
                    <th className="p-1">Name</th>
                    <th className="p-1">Match</th>
                    <th className="p-1">Role</th>
                    <th className="p-1">Pronouns · position</th>
                    <th className="p-1">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const iss = issues.get(r.key) ?? []
                    return (
                      <tr key={r.key} className={`border-t border-slate-800 ${r.action === 'skip' ? 'opacity-50' : ''}`}>
                        <td className="p-1">
                          <Select aria-label="Action" value={r.action} onChange={(e) => setRow(r.key, { action: e.target.value as RowAction })}>
                            <option value="add">Add</option>
                            {r.existingId && <option value="update">Update existing</option>}
                            <option value="skip">Skip</option>
                          </Select>
                        </td>
                        <td className="p-1">
                          <Input aria-label="Number" className="w-12" inputMode="numeric" value={r.number ?? ''} onChange={(e) => setRow(r.key, { number: e.target.value.replace(/\D/g, '').slice(0, 2) || null })} />
                        </td>
                        <td className="p-1">
                          <Input aria-label="Name" className="w-44" value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} />
                        </td>
                        <td className="p-1">
                          <Select aria-label="Gender match" value={r.gender_match ?? ''} onChange={(e) => setRow(r.key, { gender_match: (e.target.value || null) as PlanRow['gender_match'] })}>
                            <option value="">—</option>
                            <option value="W">WMP</option>
                            <option value="M">MMP</option>
                          </Select>
                        </td>
                        <td className="p-1">
                          <Select aria-label="Role" value={r.role ?? ''} onChange={(e) => setRow(r.key, { role: (e.target.value || null) as PlanRow['role'] })}>
                            <option value="">—</option>
                            <option value="handler">Handler</option>
                            <option value="cutter">Cutter</option>
                            <option value="hybrid">Hybrid</option>
                          </Select>
                        </td>
                        <td className="p-1 text-slate-400">{[r.pronouns, r.position].filter(Boolean).join(' · ')}</td>
                        <td className="p-1">
                          {[...r.notes.map((n) => ({ level: 'info', message: n })), ...iss].map((i, k) => (
                            <div key={k} className={i.level === 'error' ? 'text-rose-300' : i.level === 'warn' ? 'text-amber-300' : 'text-slate-400'}>
                              {i.message}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2">
              <Btn tone="good" disabled={busy || errors > 0 || counts.add + counts.update === 0} onClick={() => void commit()}>
                Import {counts.add} new{counts.update ? `, update ${counts.update}` : ''}
              </Btn>
              {errors > 0 && <span className="text-xs text-rose-300">Fix {errors} problem{errors > 1 ? 's' : ''} (or skip those rows) first.</span>}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
