import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { db } from '../../db/db'
import {
  buildGameRows, byRatio, callStacks, DEFAULT_FILTER, drillEvents, filterToQuery, footnotes, gameLabel, hasCoordinates, heatmap, holdBreakTrend,
  kpis, leaderboard, parseFilter, rankFitText as fitText, rankScatter, selectGames, tagsInUse, turnoverStacks, TURN_LABEL, UNTAGGED,
  type DashData, type DashFilter, type Drill, type HeatMode, type SourceKind, type StackRow, type TurnKind,
} from '../../domain/dashboard'
import type { CallKind, CallOutcome } from '../../domain/schema'
import { DrillPanel } from '../dashboard/Drill'
import { Filters } from '../dashboard/Filters'
import { Heatmap, KpiCard, PlayerScatter, RankChart, RatioChart, StackedBars, TrendChart, type ScatterMode } from '../dashboard/Charts'
import { rankLookup } from '../../domain/opponents'
import { ConnectionsCard } from '../dashboard/Connections'
import { Leaderboard } from '../dashboard/Leaderboard'
import { usePlayers } from '../hooks'
import { useView } from '../view'
import { Btn, Card } from '../kit'
import { CALL_KIND_LABEL, CALL_OUTCOME_LABEL } from '../labels'

const readHash = () => parseFilter(window.location.hash.split('?')[1] ?? '')

/** Filters live in the hash ("#/dashboard?tags=wind"), so a view can be bookmarked or shared. */
function useHashFilter(): [DashFilter, (f: DashFilter) => void] {
  const { base, src } = useView()
  const [f, setF] = useState<DashFilter>(readHash)
  useEffect(() => {
    const on = () => setF(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const set = (nf: DashFilter) => {
    setF(nf)
    const q = [filterToQuery(nf), src ? `team_src=${encodeURIComponent(src)}` : ''].filter(Boolean).join('&')
    history.replaceState(null, '', `#/${base}dashboard${q ? `?${q}` : ''}`)
  }
  return [f, set]
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-slate-700">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`px-2 py-0.5 text-xs ${value === v ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

const Hint = ({ children }: { children: ReactNode }) => <p className="mt-1 text-[11px] leading-snug text-slate-500">{children}</p>
const Empty = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-sm text-slate-500">{children}</p>

function drillTitle(d: Drill, byName: (id: string) => string, gameName: (id: string) => string) {
  if (d.kind === 'turnover') return `${d.team === 'us' ? 'Our' : 'Their'} turnovers${d.turn ? ` · ${TURN_LABEL[d.turn]}` : ''}${d.tag ? ` · ${d.tag}` : ''}`
  if (d.kind === 'call') return `${d.team === 'us' ? 'Our' : 'Their'} calls${d.callKind ? ` · ${CALL_KIND_LABEL[d.callKind as CallKind] ?? d.callKind}` : ''}${d.outcome ? ` · ${CALL_OUTCOME_LABEL[d.outcome as CallOutcome] ?? d.outcome}` : ''}`
  if (d.kind === 'player') return `${byName(d.id)} · plays`
  if (d.kind === 'pair') return `${d.thrower ? byName(d.thrower) : 'Anyone'} → ${d.receiver ? byName(d.receiver) : 'anyone'} · ${d.outcome === 'completion' ? 'completions' : d.outcome === 'turnover' ? 'turnovers' : 'all throws'}`
  return `Goals · ${gameName(d.id)}${d.side ? ` · ${d.side}-line points` : ''}`
}

function Skeleton() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-3 md:p-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-12 animate-pulse rounded-xl bg-slate-900" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-900" />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl bg-slate-900" />
        <div className="h-64 animate-pulse rounded-xl bg-slate-900" />
      </div>
    </div>
  )
}

export function Dashboard() {
  const { readOnly } = useView()
  const [filter, setFilter] = useHashFilter()
  const [turnTeam, setTurnTeam] = useState<'us' | 'them'>('us')
  const [callTeam, setCallTeam] = useState<'us' | 'them'>('us')
  const [scatter, setScatter] = useState<ScatterMode>('usage')
  const [heat, setHeat] = useState<HeatMode>('turnovers')
  const [minPoints, setMinPoints] = useState(0)
  const [rankTrend, setRankTrend] = useState(true)
  const [drill, setDrill] = useState<Drill | null>(null)
  const drillRef = useRef<HTMLDivElement>(null)
  const players = usePlayers(true)
  const data = useLiveQuery(async (): Promise<DashData> => {
    const [games, points, events, opponents] = await Promise.all([db.games.toArray(), db.points.toArray(), db.events.toArray(), db.opponents.toArray()])
    return { games, points, events, opponents }
  })
  const byId = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players])

  const all = useMemo(() => (data ? selectGames(data, DEFAULT_FILTER) : []), [data])
  const tournaments = useMemo(() => [...new Set(all.map((g) => g.game.tournament).filter(Boolean))].sort(), [all])
  const sources = useMemo(() => [...new Set(all.map((g) => g.source))] as SourceKind[], [all])
  const tags = useMemo(() => {
    const ids = new Set(all.map((g) => g.game.id))
    return tagsInUse((data?.events ?? []).filter((e) => ids.has(e.game_id)))
  }, [data, all])
  const rows = useMemo(() => (data ? buildGameRows(data, filter) : []), [data, filter])
  const v = useMemo(() => {
    // With "only tagged events", completions are almost never tagged, so completion % would read ~0%: hide it.
    const tagOnly = filter.tags.length > 0 && filter.tagScope === 'only'
    const leaders = leaderboard(rows, minPoints).map((r) => (tagOnly ? { ...r, comp_pct: null } : r))
    const k = kpis(rows).map((x) =>
      tagOnly && x.key === 'comp' ? { ...x, value: null, display: '–', series: x.series.map(() => null), delta: null, hint: 'Not shown while counting only tagged events (passes are rarely tagged).' } : x,
    )
    return {
      kpis: k,
      trend: holdBreakTrend(rows),
      ranks: rankScatter(rows, rankLookup(data?.opponents ?? [])),
      turns: turnoverStacks(rows, turnTeam),
      calls: callStacks(rows, callTeam),
      ratio: byRatio(rows),
      leaders,
      coords: hasCoordinates(rows),
      heat: heatmap(rows, heat),
      notes: footnotes(rows, filter),
    }
  }, [rows, minPoints, turnTeam, callTeam, heat, filter, data])
  const drillRows = useMemo(() => (drill ? drillEvents(rows, drill) : []), [rows, drill])

  const open = (d: Drill) => {
    setDrill(d)
    requestAnimationFrame(() => drillRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }))
  }

  if (!data || !players) return <Skeleton />

  if (!all.length)
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 p-8 text-center" data-testid="dash-empty">
        <h1 className="text-xl font-bold">Dashboard</h1>
        {readOnly ? (
          <p className="text-slate-400">No games in the team view yet.</p>
        ) : (
          <>
            <p className="text-slate-400">No games yet. Track a game (live or from film), or import past games, and the season stats show up here.</p>
            <div className="flex gap-2">
              <a href="#/new" className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white">New game</a>
              <a href="#/data" className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm">Import games</a>
            </div>
          </>
        )}
      </div>
    )

  const gameName = (id: string) => rows.find((r) => r.game.id === id)?.label ?? 'game'
  const callLabel = (s: string) => CALL_OUTCOME_LABEL[s as CallOutcome] ?? s
  const callRows: StackRow[] = v.calls.rows.map((r) => ({ ...r, label: (CALL_KIND_LABEL[r.key as CallKind] ?? r.key).replace(/ \(.*\)/, '') }))
  const ratioShown = v.ratio.skippedGames < rows.length
  const pointsWithEvents = rows.reduce((n, r) => n + r.stats.state.points.length, 0)

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-3 md:p-4" data-testid="dashboard">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <span className="text-xs text-slate-400" data-testid="dash-summary">
          {rows.length} of {all.length} game{all.length === 1 ? '' : 's'}{filter.tournament ? ` · ${filter.tournament}` : ''} · {pointsWithEvents} points
        </span>
      </div>

      <Filters
        filter={filter}
        setFilter={(f) => {
          setFilter(f)
          setDrill(null)
        }}
        tournaments={tournaments}
        games={all.map((g) => ({ game: g.game, label: gameLabel(g.game) }))}
        sources={sources}
        tags={tags}
      />

      {!rows.length ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-6 text-center" data-testid="dash-nomatch">
            <p className="text-slate-300">No games match these filters.</p>
            <Btn size="sm" onClick={() => setFilter(DEFAULT_FILTER)}>Reset filters</Btn>
          </div>
        </Card>
      ) : (
        <>
          {rows.length < 3 && (
            <p className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200" data-testid="dash-lowdata">
              Only {rows.length} game{rows.length === 1 ? '' : 's'} in view, so trends and per-point rates are noisy. Trend arrows appear from 4 games.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" data-testid="kpis">
            {v.kpis.map((k) => (
              <KpiCard key={k.key} k={k} className={k.key === 'record' ? 'col-span-2 sm:col-span-1' : ''} onClick={k.key === 'turns_pp' ? () => open({ kind: 'turnover', team: 'us' }) : k.key === 'ds_pp' ? () => open({ kind: 'turnover', team: 'them', turn: 'block' }) : undefined} />
            ))}
          </div>

          <div ref={drillRef} className="scroll-mt-2">
            {drill && (
              <DrillPanel
                title={drillTitle(drill, (id) => byId.get(id)?.name ?? 'Player', gameName)}
                rows={drillRows}
                byId={byId}
                onClose={() => setDrill(null)}
                onFilterTag={
                  drill.kind === 'turnover' && drill.tag && drill.tag !== UNTAGGED
                    ? () => {
                        setFilter({ ...filter, tags: [drill.tag!], tagScope: 'only' })
                        setDrill(null)
                      }
                    : undefined
                }
              />
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Hold % and break % by game">
              {v.trend.length < 2 ? (
                <Empty>Needs two or more games.</Empty>
              ) : (
                <TrendChart data={v.trend} onPick={(id, side) => open({ kind: 'game', id, side })} />
              )}
              <Hint>Hold = we score after starting on O. Break = we score after starting on D. Tap a dot to see that game's goals.</Hint>
            </Card>

            <Card
              title="Hold % and break % vs opponent rank"
              actions={
                <label className="flex items-center gap-1 text-xs text-slate-300">
                  <input type="checkbox" checked={rankTrend} onChange={(e) => setRankTrend(e.target.checked)} /> Trend line
                </label>
              }
            >
              <div data-testid="rank-chart">
                {v.ranks.points.length < 1 ? (
                  <Empty>No opponent ranks yet. {readOnly ? 'The stat keeper adds them on the Season page.' : 'Add them on the Season page (type them, or paste the USAU rankings).'}</Empty>
                ) : (
                  <RankChart points={v.ranks.points} trend={rankTrend} onPick={(id, side) => open({ kind: 'game', id, side })} />
                )}
              </div>
              <Hint>
                One dot per game: left = stronger opponents. Tap a dot for that game's goals.
                {rankTrend && v.ranks.points.length > 1 ? ` ${[fitText(v.ranks.points, 'hold'), fitText(v.ranks.points, 'break')].filter(Boolean).join('. ')}.` : ''}
                {v.ranks.unranked ? ` ${v.ranks.unranked} game${v.ranks.unranked === 1 ? '' : 's'} without a rank left out.` : ''} Filters (tags too) apply.
              </Hint>
            </Card>

            <Card
              title="Turnovers by type and tag"
              actions={<Seg label="Whose turnovers" value={turnTeam} onChange={setTurnTeam} options={[['us', 'Ours'], ['them', 'Theirs']]} />}
            >
              {!v.turns.rows.length ? (
                <Empty>No turnovers in view.</Empty>
              ) : (
                <div data-testid="turnover-chart">
                  <StackedBars rows={v.turns.rows} stacks={v.turns.stacks} onPick={(kind, tag) => open({ kind: 'turnover', team: turnTeam, turn: kind as TurnKind, tag })} />
                </div>
              )}
              <Hint>Each turnover is stacked under its first tag. Tap a segment to list those plays and jump to the film.</Hint>
            </Card>

            <Card title="Player leaderboard" className="lg:col-span-2">
              {!v.leaders.length ? <Empty>No player stats in view (imported games only track names that match the roster).</Empty> : (
                <Leaderboard rows={v.leaders} byId={byId} minPoints={minPoints} setMinPoints={setMinPoints} onPick={(id) => open({ kind: 'player', id })} />
              )}
            </Card>

            <Card title="Who throws to whom" className="lg:col-span-2">
              <ConnectionsCard rows={rows} byId={byId} onPick={open} />
              <Hint>
                Rows are throwers, columns receivers, most-used first. Completions = catches and goals; turnovers = drops, and throwaways where the intended
                receiver was recorded. Tap a cell (or a name) for those throws and jump to the film. The filters above (games, O/D points, tags) apply.
              </Hint>
            </Card>

            <Card
              title="Players"
              actions={<Seg label="Scatter view" value={scatter} onChange={setScatter} options={[['usage', 'Usage vs comp %'], ['pm', '+/- per point']]} />}
            >
              {v.leaders.length < 2 ? <Empty>Needs two or more players.</Empty> : (
                <PlayerScatter rows={v.leaders} mode={scatter} byId={byId} onPick={(id) => open({ kind: 'player', id })} />
              )}
              <Hint>
                {scatter === 'usage' ? 'Right = more throws per point; up = more completions. ' : 'Right = more points played; up = more goals + assists + Ds − turns per point. '}
                Dot size = points played. Pink = WMP, blue = MMP. Tap a dot for that player's plays.
              </Hint>
            </Card>

            {ratioShown ? (
              <Card title="Hold and break by gender ratio">
                <RatioChart rows={v.ratio.rows} />
                <Hint>
                  4 WMP vs 4 MMP points ({v.ratio.rows.map((r) => `${r.label}: ${r.points} pts`).join(', ')}).
                  {v.ratio.skippedGames ? ` ${v.ratio.skippedGames} imported game${v.ratio.skippedGames === 1 ? '' : 's'} left out (no ratio recorded).` : ''}
                </Hint>
              </Card>
            ) : (
              <Card title="Hold and break by gender ratio">
                <Empty>Imported games don't record the gender ratio, so this needs at least one game tracked here.</Empty>
              </Card>
            )}

            <Card
              title="Calls"
              actions={<Seg label="Whose calls" value={callTeam} onChange={setCallTeam} options={[['us', 'Ours'], ['them', 'Theirs']]} />}
            >
              {!callRows.length ? <Empty>No calls recorded in view.</Empty> : (
                <StackedBars rows={callRows} stacks={v.calls.stacks} label={callLabel} onPick={(kind, outcome) => open({ kind: 'call', team: callTeam, callKind: kind, outcome })} />
              )}
              <Hint>By call type, stacked by outcome. Tap a segment for the plays.</Hint>
            </Card>

            {v.coords && (
              <Card
                title="Where on the field"
                actions={<Seg label="Heatmap" value={heat} onChange={setHeat} options={[['turnovers', 'Our turnovers'], ['completions', 'Our catches']]} />}
              >
                {v.heat ? <Heatmap grid={v.heat.grid} max={v.heat.max} label={`${heat} by field zone`} /> : <Empty>No {heat} with a field position.</Empty>}
                <Hint>{v.heat?.n ?? 0} events with a field position, in 8-yard by 10-yard zones. Dashed lines are the end-zone lines.</Hint>
              </Card>
            )}
          </div>

          <footer className="flex flex-col gap-1 text-[11px] leading-snug text-slate-500" data-testid="dash-footnotes">
            {v.notes.tagNote && <p>• {v.notes.tagNote}</p>}
            {v.notes.sideNote && <p>• {v.notes.sideNote}</p>}
            {v.notes.missedPoints > 0 && <p>• {v.notes.missedPoints} point{v.notes.missedPoints === 1 ? ' was' : 's were'} marked missed on film: they count for the score and points played, but no plays are counted from them.</p>}
            {v.notes.importedGames > 0 && <p>• {v.notes.importedGames} imported game{v.notes.importedGames === 1 ? '' : 's'}: no gender ratio or video links, and the line for each point is only what UltiAnalytics recorded.</p>}
            <p>• Record (W–L) always uses whole games. Trend arrows compare the last 3 games with the earlier ones.</p>
          </footer>
        </>
      )}
    </div>
  )
}
