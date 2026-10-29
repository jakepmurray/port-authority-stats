import { useEffect, useMemo, useRef, useState } from 'react'
import { actions } from '../db/actions'
import { matchRanks, normOpp, opponentsOf, parseUsauRankings, seasonsOf, USAU_RANKINGS_URL, type RankMatch, type UsauRank } from '../domain/opponents'
import type { Game, Opponent } from '../domain/schema'
import { fetchUsau } from '../sync'
import { USAU_DIVISIONS, usauFetchMessage, type UsauDivision, type UsauFetch } from '../sync/client'
import { loadWho } from '../sync/identity'
import { Badge, Btn, Card, Input, Select } from './kit'


const editor = () => loadWho()?.name ?? ''
export type FetchRanks = (division: UsauDivision) => Promise<UsauFetch>
const findRec = (opponents: Opponent[], name: string, season: string) =>
  opponents.find((o) => !o.deleted && o.season === season && normOpp(o.name) === normOpp(name))

/** One opponent's rank, typed by hand (saved on blur or Enter; empty clears it). */
function RankInput({ name, season, rec }: { name: string; season: string; rec: Opponent | undefined }) {
  const [v, setV] = useState(rec?.rank === null || rec?.rank === undefined ? '' : String(rec.rank))
  const [err, setErr] = useState(false)
  const save = () => {
    const t = v.trim()
    const rank = t === '' ? null : Number(t)
    if (rank !== null && (!Number.isInteger(rank) || rank < 1)) return setErr(true)
    setErr(false)
    if (rank === (rec?.rank ?? null)) return
    void actions.setRanks([{ name, season, rank }], editor())
  }
  return (
    <Input
      aria-label={`Rank of ${name}`}
      inputMode="numeric"
      className={`w-16 py-0.5 text-right ${err ? 'border-rose-500' : ''}`}
      value={v}
      placeholder="–"
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/**
 * Opponents' end-of-season USAU ranks: typed per opponent, or filled from USAU's
 * rankings, fetched by the Sheet script or pasted (fuzzy name match, reviewed before
 * anything is saved).
 * Shared team data: anyone with a key can change it; the newer edit wins.
 */
export function OpponentRanks({ games, opponents, readOnly, fetchRanks = fetchUsau }: { games: Game[]; opponents: Opponent[]; readOnly?: boolean; fetchRanks?: FetchRanks }) {
  const seasons = useMemo(() => seasonsOf(games), [games])
  const [season, setSeason] = useState(seasons[0] ?? '')
  // The import panel: closed, opened by "Fetch ranks" (fetches at once), or by "Paste".
  const [panel, setPanel] = useState<{ fetch: boolean; n: number } | null>(null)
  const paste = !!panel
  const list = useMemo(() => opponentsOf(games, season), [games, season])

  return (
    <Card
      title="Opponent ranks (USAU)"
      actions={
        <>
          <Select aria-label="Rank season" value={season} onChange={(e) => setSeason(e.target.value)} className="py-1 text-xs">
            {seasons.map((s) => <option key={s} value={s}>{s} season</option>)}
            <option value="">All seasons (fallback)</option>
          </Select>
          {!readOnly && (
            <>
              <Btn size="sm" tone="primary" onClick={() => setPanel((p) => ({ fetch: true, n: (p?.n ?? 0) + 1 }))}>Fetch ranks</Btn>
              <Btn size="sm" onClick={() => setPanel((p) => (p ? null : { fetch: false, n: 0 }))} aria-expanded={paste}>
                {paste ? 'Close' : 'Paste USAU rankings'}
              </Btn>
            </>
          )}
        </>
      }
    >
      <div data-testid="opponent-ranks">
        {panel && !readOnly && (
          <RankPaste key={panel.n} season={season} opponents={opponents} games={games} autoFetch={panel.fetch} fetchRanks={fetchRanks} onDone={() => setPanel(null)} />
        )}
        {!list.length ? (
          <p className="text-xs text-slate-500">No games {season ? `in ${season}` : 'yet'}.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="p-1 text-left">Opponent</th>
                <th className="p-1 text-right">Games</th>
                <th className="p-1 text-right">Rank</th>
                <th className="p-1 text-left">USAU team</th>
                <th className="p-1 text-left">Last edit</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => {
                const rec = findRec(opponents, o.name, season)
                const fallback = season && !rec ? findRec(opponents, o.name, '') : undefined
                return (
                  <tr key={o.name} className="border-t border-slate-800">
                    <td className="p-1">{o.name}</td>
                    <td className="p-1 text-right tabular-nums">{o.games}</td>
                    <td className="p-1 text-right tabular-nums">
                      {readOnly ? (rec?.rank ?? '–') : <RankInput key={`${rec?.id}:${rec?.updated_at}`} name={o.name} season={season} rec={rec} />}
                      {fallback?.rank && <div className="text-[10px] text-slate-500">all seasons: {fallback.rank}</div>}
                    </td>
                    <td className="p-1 text-slate-400">{rec?.usau_name || ''}</td>
                    <td className="p-1 text-slate-500">{rec?.edited_by || ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          A season’s rank is used for that year’s games; “All seasons” is the fallback when a year has none. Ranks are shared with everyone who syncs (the newest edit wins).
        </p>
      </div>
    </Card>
  )
}

interface Choice {
  usau: string
  apply: boolean
}

const when = (iso: string | null) => {
  const d = iso ? new Date(iso) : null
  return d && !isNaN(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'just now'
}

/** Fetch (or paste) → review matches → save. Nothing is written until "Save ranks". */
export function RankPaste({
  season, opponents, games, onDone, autoFetch = false, fetchRanks = fetchUsau,
}: { season: string; opponents: Opponent[]; games: Game[]; onDone: () => void; autoFetch?: boolean; fetchRanks?: FetchRanks }) {
  const [text, setText] = useState('')
  const [teams, setTeams] = useState<UsauRank[] | null>(null)
  const [matches, setMatches] = useState<RankMatch[]>([])
  const [choice, setChoice] = useState<Record<string, Choice>>({})
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [division, setDivision] = useState<UsauDivision>('Mixed')
  const [fetching, setFetching] = useState(false)
  const [failed, setFailed] = useState(false)

  /** Both sources end here: the same match-and-confirm review. */
  const load = (found: UsauRank[], from: string) => {
    const m = matchRanks(opponentsOf(games, season), found)
    setTeams(found)
    setMatches(m)
    setChoice(Object.fromEntries(m.map((x) => [x.opponent, { usau: x.best?.name ?? '', apply: x.quality === 'exact' || x.quality === 'likely' }])))
    setMsg({ text: `${from}: ${found.length} ranked teams (#${found[0].rank}–#${found.at(-1)!.rank}). Check the matches, then save.` })
  }

  const read = () => {
    const found = parseUsauRankings(text)
    if (!found.length) {
      setTeams(null)
      return setMsg({ text: 'No rankings found. On the USAU rankings page, select the whole page (Ctrl+A / ⌘A), copy, and paste it here.', bad: true })
    }
    load(found, 'Pasted')
  }

  const fetchNow = async (div: UsauDivision = division) => {
    setFetching(true)
    setMsg({ text: `Fetching the USAU Club ${div} rankings…` })
    try {
      const r = await fetchRanks(div)
      setFailed(false)
      load(r.teams, `Fetched from USAU (Club ${div}, ${r.cached ? 'saved copy from ' : ''}${when(r.fetchedAt)})`)
    } catch (e) {
      setFailed(true)
      setTeams(null)
      setMsg({ text: `Couldn’t fetch the ranks: ${usauFetchMessage(e)} You can still paste them: open the USAU page, copy it all, and paste below.`, bad: true })
    } finally {
      setFetching(false)
    }
  }

  // "Fetch ranks" in the card header: one fetch per click.
  const started = useRef(false)
  useEffect(() => {
    if (!autoFetch || started.current) return
    started.current = true
    void fetchNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const byName = new Map((teams ?? []).map((t) => [t.name, t]))
  const chosen = matches.filter((m) => choice[m.opponent]?.apply && byName.has(choice[m.opponent].usau))

  const save = async () => {
    setBusy(true)
    try {
      const saved = await actions.setRanks(
        chosen.map((m) => {
          const t = byName.get(choice[m.opponent].usau)!
          return { name: m.opponent, season, rank: t.rank, usau_name: t.name }
        }),
        editor(),
      )
      setMsg({ text: `Saved ${chosen.length} rank${chosen.length === 1 ? '' : 's'}${saved.length < chosen.length ? ` (${chosen.length - saved.length} unchanged)` : ''}.` })
      onDone()
    } finally {
      setBusy(false)
    }
  }

  const qualityBadge = (m: RankMatch, usau: string) => {
    if (!usau) return <Badge>no match</Badge>
    if (usau !== m.best?.name) return <Badge tone="info">picked</Badge>
    return m.quality === 'exact' ? <Badge tone="good">exact</Badge> : m.quality === 'likely' ? <Badge tone="info">likely</Badge> : <Badge tone="warn">check</Badge>
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-slate-700 p-2" data-testid="rank-paste">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="USAU division" value={division} onChange={(e) => setDivision(e.target.value as UsauDivision)} className="py-1 text-xs">
          {USAU_DIVISIONS.map((d) => <option key={d} value={d}>Club {d}</option>)}
        </Select>
        <Btn size="sm" tone={autoFetch ? 'default' : 'primary'} onClick={() => void fetchNow()} disabled={fetching}>
          {fetching ? 'Fetching…' : teams && autoFetch ? 'Fetch again' : 'Fetch from USAU'}
        </Btn>
        <span className="text-[11px] text-slate-500">
          Ranks are saved for: <b>{season ? `${season} season` : 'all seasons'}</b>. USAU only publishes its current list, so fetch at the end of the season.
        </span>
      </div>
      <p className={`text-xs ${failed ? 'text-amber-200' : 'text-slate-400'}`}>
        {failed ? 'Backup: open' : 'Or paste: open'} the{' '}
        <a className="text-sky-300 underline" href={USAU_RANKINGS_URL} target="_blank" rel="noreferrer">USAU club rankings</a>{' '}
        (pick the division, click “View All”), select the whole page (Ctrl+A / ⌘A), copy, and paste below.
      </p>
      <textarea
        aria-label="Pasted USAU rankings"
        className="h-28 rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Rank\tTeam\tPower Rating\t…\n1\tHybrid\t2163\tMixed\t…'}
      />
      <div className="flex gap-2">
        <Btn size="sm" tone="primary" onClick={read} disabled={!text.trim()}>Read rankings</Btn>
        <Btn size="sm" tone="ghost" onClick={onDone}>Cancel</Btn>
      </div>
      {msg && <p role="status" className={`text-xs ${msg.bad ? 'text-rose-300' : 'text-slate-300'}`}>{msg.text}</p>}
      {teams && (
        <>
          <table className="w-full text-xs" data-testid="rank-review">
            <thead className="text-slate-400">
              <tr>
                <th className="p-1 text-left">Use</th>
                <th className="p-1 text-left">Our opponent</th>
                <th className="p-1 text-left">USAU team</th>
                <th className="p-1 text-right">Rank</th>
                <th className="p-1 text-right">Now</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => {
                const c = choice[m.opponent] ?? { usau: '', apply: false }
                const t = byName.get(c.usau)
                const now = findRec(opponents, m.opponent, season)?.rank
                const set = (p: Partial<Choice>) => setChoice({ ...choice, [m.opponent]: { ...c, ...p } })
                return (
                  <tr key={m.opponent} className="border-t border-slate-800">
                    <td className="p-1">
                      <input type="checkbox" aria-label={`Use rank for ${m.opponent}`} checked={c.apply && !!t} disabled={!t} onChange={(e) => set({ apply: e.target.checked })} />
                    </td>
                    <td className="p-1">{m.opponent} <span className="text-slate-500">({m.games})</span></td>
                    <td className="p-1">
                      <span className="flex items-center gap-1">
                        <Select aria-label={`USAU team for ${m.opponent}`} value={c.usau} onChange={(e) => set({ usau: e.target.value, apply: !!e.target.value })} className="max-w-[14rem] py-0.5 text-xs">
                          <option value="">— not ranked / skip —</option>
                          <optgroup label="Closest names">
                            {m.options.filter((o) => o.score >= 0.3).map((o) => <option key={`c-${o.name}`} value={o.name}>#{o.rank} {o.name}</option>)}
                          </optgroup>
                          <optgroup label="All teams">
                            {teams.map((o) => <option key={`a-${o.name}`} value={o.name}>#{o.rank} {o.name}</option>)}
                          </optgroup>
                        </Select>
                        {qualityBadge(m, c.usau)}
                      </span>
                    </td>
                    <td className="p-1 text-right tabular-nums">{t ? t.rank : '–'}</td>
                    <td className="p-1 text-right tabular-nums text-slate-500">{now ?? '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex items-center gap-2">
            <Btn size="sm" tone="good" onClick={() => void save()} disabled={busy || !chosen.length}>
              Save {chosen.length} rank{chosen.length === 1 ? '' : 's'}
            </Btn>
            <span className="text-[11px] text-slate-500">“Likely” and “check” are fuzzy matches: make sure it’s the same team. Unticked rows are left as they are.</span>
          </div>
        </>
      )}
    </div>
  )
}
