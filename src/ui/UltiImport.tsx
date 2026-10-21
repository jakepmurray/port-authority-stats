import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { actions } from '../db/actions'
import { db } from '../db/db'
import { deriveGame } from '../domain/game'
import type { GenderMatch } from '../domain/schema'
import {
  collectNames, fetchUltiTeam, findDuplicate, parseUltiInput, planGame, suggestMatches, uaTeamId, uaWebsiteUrl,
  UA_ANON, UAFetchError, type NameChoice, type UAParse, type UAPlayer,
} from '../domain/ultianalytics'
import { Badge, Btn, Card, Input, Select } from './kit'
import { UA_CSV_STEPS, UA_LINK_STEPS } from './ultiSteps'

const REMEMBER_KEY = 'pa:ua-names'
const remembered = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

interface NewPlayer {
  name: string
  number: string
  gender_match: GenderMatch | ''
}

/** Preview with names standing in for players, so line-size warnings show before matching. */
const previewPlan = (g: UAParse['games'][number]) => planGame(g, (n) => (n && n !== UA_ANON ? n : null), { team_id: 'preview' })

const choiceValue = (c: NameChoice | undefined) => (!c ? 'new' : c.kind === 'player' ? `p:${c.id}` : c.kind)
const parseChoice = (v: string): NameChoice => (v.startsWith('p:') ? { kind: 'player', id: v.slice(2) } : v === 'none' ? { kind: 'none' } : { kind: 'new' })

/**
 * Import games from UltiAnalytics: the raw stats CSV (any team), game JSON / .iexport, or a
 * public team link. Nothing is saved until the user reviews games and players and clicks Import.
 */
export function UltiImport() {
  const [text, setText] = useState('')
  const [link, setLink] = useState('')
  const [parsed, setParsed] = useState<(UAParse & { label: string }) | null>(null)
  const [status, setStatus] = useState<{ text: string; bad?: boolean; teamId?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [choices, setChoices] = useState<Map<string, NameChoice>>(new Map())
  const [fresh, setFresh] = useState<Map<string, NewPlayer>>(new Map())
  const [help, setHelp] = useState(false)

  const data = useLiveQuery(async () => {
    const [players, games, points, events] = await Promise.all([db.players.toArray(), db.games.toArray(), db.points.toArray(), db.events.toArray()])
    const existing = games.filter((g) => !g.deleted).map((g) => ({ game: g, score: deriveGame(g, points, events).score }))
    return { players: players.filter((p) => !p.deleted).sort((a, b) => Number(a.number) - Number(b.number)), existing }
  }, [])

  const previews = useMemo(() => {
    if (!parsed || !data) return []
    return parsed.games.map((g) => {
      const plan = previewPlan(g)
      return { g, plan, dup: findDuplicate(plan, data.existing) }
    })
  }, [parsed, data])

  const chosenGames = useMemo(() => previews.filter((p) => selected.has(p.g.key)).map((p) => p.g), [previews, selected])
  const names = useMemo(() => [...collectNames(chosenGames).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), [chosenGames])

  const load = (p: UAParse, label: string) => {
    if (!p.games.length) {
      setParsed(null)
      return setStatus({ text: 'No games found in that.', bad: true })
    }
    const existing = data?.existing ?? []
    const keys = new Set<string>()
    for (const g of p.games) {
      const plan = previewPlan(g)
      if (!findDuplicate(plan, existing)) keys.add(g.key)
    }
    const all = [...collectNames(p.games).keys()]
    const sug = suggestMatches(all, data?.players ?? [], remembered())
    const byName = new Map<string, UAPlayer>(p.players.map((x) => [x.name, x]))
    setParsed({ ...p, label })
    setSelected(keys)
    setChoices(sug)
    setFresh(new Map(all.map((n) => [n, { name: n, number: byName.get(n)?.number ?? '', gender_match: byName.get(n)?.gender ?? '' }])))
    const dups = p.games.length - keys.size
    setStatus({ text: `Found ${p.games.length} game${p.games.length > 1 ? 's' : ''}${dups ? ` (${dups} already here, unticked)` : ''}. Review below, then import.` })
  }

  const fromText = (t: string, label: string) => {
    try {
      load(parseUltiInput(t), label)
    } catch (e) {
      setParsed(null)
      setStatus({ text: (e as Error).message, bad: true })
    }
  }

  const fromLink = async () => {
    const id = uaTeamId(link)
    if (!id) return setStatus({ text: 'That is not an UltiAnalytics team link. It looks like www.ultianalytics.com/app/#/1234567890123456/players.', bad: true })
    setBusy(true)
    setStatus({ text: 'Reading the team from UltiAnalytics…' })
    try {
      const t = await fetchUltiTeam(id)
      load(t, `team website: ${t.info.name || id}`)
    } catch (e) {
      setParsed(null)
      setStatus({ text: e instanceof UAFetchError ? e.message : `Could not read that team: ${(e as Error).message}`, bad: true, teamId: id })
    } finally {
      setBusy(false)
    }
  }

  const newNames = names.filter(([n]) => choices.get(n)?.kind === 'new').map(([n]) => n)
  const problems = newNames.filter((n) => {
    const f = fresh.get(n)
    return !f || !/^\d{1,2}$/.test(f.number) || !f.gender_match || !f.name.trim()
  })
  const setNew = (n: string, patch: Partial<NewPlayer>) => setFresh((m) => new Map(m).set(n, { ...m.get(n)!, ...patch }))

  const fillNumbers = () => {
    const used = new Set([...(data?.players ?? []).map((p) => p.number), ...newNames.map((n) => fresh.get(n)?.number ?? '')])
    const free = Array.from({ length: 100 }, (_, i) => String(i)).filter((x) => !used.has(x)).reverse() // high numbers first: easy to spot
    setFresh((m) => {
      const out = new Map(m)
      for (const n of newNames) if (!/^\d{1,2}$/.test(out.get(n)?.number ?? '') && free.length) out.set(n, { ...out.get(n)!, number: free.shift()! })
      return out
    })
  }

  const commit = async () => {
    if (!parsed || problems.length || !chosenGames.length) return
    setBusy(true)
    try {
      const used = new Map(names.map(([n]) => [n, choices.get(n) ?? ({ kind: 'new' } as NameChoice)]))
      const np = new Map(newNames.map((n) => [n, { ...fresh.get(n)!, gender_match: fresh.get(n)!.gender_match as GenderMatch }]))
      const r = await actions.importUltiAnalytics(chosenGames, used, np)
      // Remember name → player for next time (matched and newly created players).
      const mem = remembered()
      const players = await db.players.toArray()
      for (const [n, c] of used) {
        if (c.kind === 'player') mem[n] = c.id
        if (c.kind === 'new') {
          const p = players.find((x) => x.name === np.get(n)!.name.trim() && x.number === np.get(n)!.number)
          if (p) mem[n] = p.id
        }
      }
      localStorage.setItem(REMEMBER_KEY, JSON.stringify(mem))
      setStatus({ text: `Imported ${r.games.length} game${r.games.length > 1 ? 's' : ''}${r.playersCreated ? ` and added ${r.playersCreated} player${r.playersCreated > 1 ? 's' : ''}` : ''}. They are on the Games and Season pages and go to the Sheet like any other game.` })
      setParsed(null)
      setText('')
    } catch (e) {
      setStatus({ text: `Import failed: ${(e as Error).message}`, bad: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Import from UltiAnalytics" actions={<Btn size="sm" tone="ghost" onClick={() => setHelp((h) => !h)}>{help ? 'Hide steps' : 'How to get the file'}</Btn>}>
      <div className="flex flex-col gap-2 text-sm" data-testid="ua-import">
        <p className="text-slate-400">
          Bring in games tracked with the UltiAnalytics (iUltimate) app: upload its <b>raw statistics CSV</b> (one game or the whole team), or paste a
          public team website link. You review every game and player before anything is saved.
        </p>
        {help && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-xs text-slate-300" data-testid="ua-steps">
            <p className="mb-1 font-semibold">Get the CSV (works for every team)</p>
            <ol className="ml-5 list-decimal space-y-1">{UA_CSV_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
            <p className="mb-1 mt-2 font-semibold">Or use the team link (teams without a website password)</p>
            <ol className="ml-5 list-decimal space-y-1">{UA_LINK_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-sky-500 bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500">
            Choose file
            <input
              type="file"
              aria-label="UltiAnalytics file"
              accept=".csv,.json,.iexport,.txt,text/csv,application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) fromText(await f.text(), f.name)
              }}
            />
          </label>
          <span className="text-xs text-slate-500">CSV from Download, or an .iexport / JSON file</span>
        </div>
        <textarea
          aria-label="Paste UltiAnalytics CSV"
          className="min-h-16 rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-xs"
          placeholder="…or paste the CSV here (Date/Time,Tournamemnt,Opponent,…)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Btn disabled={!text.trim()} onClick={() => fromText(text, 'pasted text')}>Read pasted CSV</Btn>
          <Input aria-label="UltiAnalytics team link" className="min-w-0 flex-1" placeholder="Team link: www.ultianalytics.com/app/#/1234567890123456/…" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void fromLink()} />
          <Btn disabled={!link.trim() || busy} onClick={() => void fromLink()}>Load team</Btn>
        </div>
        {status && (
          <p className={`text-xs ${status.bad ? 'text-rose-300' : 'text-emerald-300'}`} data-testid="ua-status">
            {status.text}{' '}
            {status.bad && status.teamId && (
              <a className="text-sky-300 underline" href={uaWebsiteUrl(status.teamId)} target="_blank" rel="noreferrer">Open that team's Download page</a>
            )}
            {status.bad && !status.teamId && !help && (
              <button type="button" className="text-sky-300 underline" onClick={() => setHelp(true)}>How to get the CSV</button>
            )}
          </p>
        )}

        {parsed && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <Badge tone="info">{parsed.format === 'csv' ? 'CSV' : parsed.format === 'iexport' ? '.iexport' : 'team website'}</Badge>
              <span>{parsed.label}</span>
              <Btn size="sm" onClick={() => setSelected(new Set(previews.map((p) => p.g.key)))}>Select all</Btn>
              <Btn size="sm" onClick={() => setSelected(new Set())}>None</Btn>
            </div>
            <div className="max-h-[40vh] overflow-auto rounded-lg border border-slate-800">
              <table className="w-full min-w-[640px] text-xs" data-testid="ua-games">
                <thead className="sticky top-0 bg-slate-900 text-left text-slate-400">
                  <tr>
                    <th className="p-1"></th>
                    <th className="p-1">Date</th>
                    <th className="p-1">Game</th>
                    <th className="p-1">Score</th>
                    <th className="p-1">Points</th>
                    <th className="p-1">Events</th>
                    <th className="p-1">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {previews.map(({ g, plan, dup }) => (
                    <tr key={g.key} className={`border-t border-slate-800 align-top ${selected.has(g.key) ? '' : 'opacity-50'}`}>
                      <td className="p-1">
                        <input
                          type="checkbox"
                          aria-label={`Import ${g.opponent} ${g.date}`}
                          checked={selected.has(g.key)}
                          onChange={(e) => setSelected((s) => {
                            const n = new Set(s)
                            if (e.target.checked) n.add(g.key)
                            else n.delete(g.key)
                            return n
                          })}
                        />
                      </td>
                      <td className="p-1 whitespace-nowrap">{g.date || '—'}</td>
                      <td className="p-1">
                        vs <b>{g.opponent || 'Unknown'}</b>
                        {g.tournament && <span className="text-slate-500"> · {g.tournament}</span>}
                      </td>
                      <td className="p-1 whitespace-nowrap">{plan.score.us}–{plan.score.them}</td>
                      <td className="p-1">{plan.points.length}</td>
                      <td className="p-1">{plan.events.length}</td>
                      <td className="p-1">
                        {dup && (
                          <div className="text-amber-300">
                            Already here: <a className="underline" href={`#/game/${dup.id}`}>vs {dup.opponent} {dup.date}</a>
                          </div>
                        )}
                        {plan.warnings.map((w) => <div key={w} className="text-amber-300">{w}</div>)}
                        {!dup && !plan.warnings.length && <span className="text-emerald-300">OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {names.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span>
                    <b className="text-slate-200">Players</b> ({names.length}): match each UltiAnalytics name to your roster, add them as new players, or leave them blank
                    (their stats stay on the team totals). UltiAnalytics has no gender match, so new players need one.
                  </span>
                  {newNames.length > 0 && (
                    <>
                      <Btn size="sm" onClick={fillNumbers} title="Gives players without a number an unused jersey number (from 99 down). Change them later on the Roster page.">Fill blank numbers</Btn>
                      <Btn size="sm" onClick={() => setChoices((m) => new Map([...m].map(([k, v]) => [k, v.kind === 'new' ? ({ kind: 'none' } as NameChoice) : v])))}>Leave unmatched blank</Btn>
                    </>
                  )}
                </div>
                <div className="max-h-[40vh] overflow-auto rounded-lg border border-slate-800">
                  <table className="w-full min-w-[640px] text-xs" data-testid="ua-players">
                    <thead className="sticky top-0 bg-slate-900 text-left text-slate-400">
                      <tr>
                        <th className="p-1">UltiAnalytics name</th>
                        <th className="p-1">Uses</th>
                        <th className="p-1">In this app</th>
                        <th className="p-1">New player: name · # · match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {names.map(([n, count]) => {
                        const c = choices.get(n)
                        const f = fresh.get(n)
                        const isNew = c?.kind === 'new'
                        return (
                          <tr key={n} className="border-t border-slate-800">
                            <td className="p-1 font-medium">{n}</td>
                            <td className="p-1 text-slate-400">{count}</td>
                            <td className="p-1">
                              <Select aria-label={`Match for ${n}`} value={choiceValue(c)} onChange={(e) => setChoices((m) => new Map(m).set(n, parseChoice(e.target.value)))}>
                                <option value="new">Add as new player</option>
                                <option value="none">Leave blank (unknown player)</option>
                                {(data?.players ?? []).map((p) => (
                                  <option key={p.id} value={`p:${p.id}`}>#{p.number} {p.name}</option>
                                ))}
                              </Select>
                            </td>
                            <td className="p-1">
                              {isNew && f && (
                                <div className="flex items-center gap-1">
                                  <Input aria-label={`New name for ${n}`} className="w-36" value={f.name} onChange={(e) => setNew(n, { name: e.target.value })} />
                                  <Input aria-label={`Number for ${n}`} className="w-12" inputMode="numeric" placeholder="#" value={f.number} onChange={(e) => setNew(n, { number: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                                  <Select aria-label={`Gender match for ${n}`} value={f.gender_match} onChange={(e) => setNew(n, { gender_match: e.target.value as NewPlayer['gender_match'] })}>
                                    <option value="">—</option>
                                    <option value="W">WMP</option>
                                    <option value="M">MMP</option>
                                  </Select>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Btn tone="good" disabled={busy || problems.length > 0 || !chosenGames.length} onClick={() => void commit()}>
                Import {chosenGames.length} game{chosenGames.length === 1 ? '' : 's'}
                {newNames.length ? ` + ${newNames.length} new player${newNames.length > 1 ? 's' : ''}` : ''}
              </Btn>
              {problems.length > 0 && (
                <span className="text-xs text-rose-300" data-testid="ua-problems">
                  {problems.length} new player{problems.length > 1 ? 's need' : ' needs'} a number and a gender match (or match them to the roster / leave them blank).
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
