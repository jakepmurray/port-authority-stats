import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../../db/db'
import { ytLink } from '../../domain/exports'
import { computeGameStats } from '../../domain/stats'
import { userTags } from '../../domain/tags'
import { resolveSrc } from '../../team/link'
import { loadInfo, refreshTeamView, TeamViewError, type FetchFn, type TeamInfo } from '../../team/load'
import { useGameData, usePlayers } from '../hooks'
import { Badge, Btn, Card } from '../kit'
import { describeEvent } from '../labels'
import { Season } from '../pages/Season'
import { CallsTable, PlayerStatsTable, TagBreakdownTable, TeamSummary } from '../StatsTables'
import { UpdatePrompt } from '../UpdatePrompt'
import { ViewContext } from '../view'

const Dashboard = lazy(() => import('../pages/Dashboard').then((m) => ({ default: m.Dashboard })))

const when = (t: number | null) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown')
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

/**
 * Read-only team view (#/team?src=<web app URL>). Loads the writer's snapshot from the
 * Apps Script into its own IndexedDB database. No editing, no sync, no token.
 */
const browserFetch: FetchFn = (u, i) => fetch(u, i)

export function TeamView({ route, fetchFn = browserFetch }: { route: string[]; fetchFn?: FetchFn }) {
  const [src] = useState(() => resolveSrc(window.location.hash))
  const [info, setInfo] = useState<TeamInfo | null>(() => loadInfo())
  const [busy, setBusy] = useState(!!src)
  const [error, setError] = useState<string | null>(null)
  const view = useMemo(() => ({ readOnly: true, base: 'team/', src }), [src])
  const [gen, setGen] = useState(0) // remount pages after a refresh so they re-read the new copy

  // Fetch, store, then update the banner; state changes only after the fetch settles.
  const load = useCallback(
    () =>
      src
        ? refreshTeamView(fetchFn, src).then(
            (next) => {
              setInfo(next)
              setError(null)
              setGen((g) => g + 1)
              setBusy(false)
            },
            (e: unknown) => {
              setError(e instanceof TeamViewError ? e.message : 'Could not load the team stats. Tap Refresh to try again.')
              setBusy(false)
            },
          )
        : Promise.resolve(),
    [fetchFn, src],
  )
  const refresh = () => {
    setBusy(true)
    setError(null)
    void load()
  }

  useEffect(() => {
    void load()
  }, [load])

  const [, a, b] = route
  let page
  if (a === 'dashboard')
    page = (
      <Suspense fallback={<p className="p-4 text-slate-400">Loading dashboard…</p>}>
        <Dashboard />
      </Suspense>
    )
  else if (a === 'season') page = <Season />
  else if (a === 'game' && b) page = <TeamGame gameId={b} />
  else page = <TeamGames />

  const link = (href: string, label: string, active: boolean) => (
    <a href={href} className={`rounded-md px-2 py-1 text-sm ${active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}>
      {label}
    </a>
  )
  const cached = info && info.src === src
  return (
    <ViewContext.Provider value={view}>
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-center gap-1 border-b border-slate-800 px-3 py-1.5">
          <a href="#/team" className="mr-2 flex items-center gap-2 font-bold text-sky-300">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-6 w-6" />
            <span className="hidden sm:inline">Port Authority Stats</span>
          </a>
          {link('#/team', 'Games', !a || a === 'game')}
          {link('#/team/dashboard', 'Dashboard', a === 'dashboard')}
          {link('#/team/season', 'Season', a === 'season')}
        </header>
        <div role="status" data-testid="team-banner" className="flex flex-wrap items-center gap-2 border-b border-amber-900/60 bg-amber-950/40 px-3 py-1.5 text-sm text-amber-100">
          <span className="font-semibold">Team view — read only</span>
          <span className="text-amber-200/80">
            {cached ? `updated ${when(info.updatedAt)}` : busy ? 'loading…' : 'not loaded'}
          </span>
          {cached && !info.fullAt && <span className="text-xs text-amber-300">(some games may be missing until the stat keeper clicks Push everything)</span>}
          <span className="ml-auto flex items-center gap-2">
            {src && (
              <Btn size="sm" onClick={refresh} disabled={busy}>
                {busy ? 'Refreshing…' : 'Refresh'}
              </Btn>
            )}
            <a href="#/" className="text-xs text-amber-200/70 underline hover:text-amber-100" title="Leave the team view (your own data in this browser is separate)">
              Exit
            </a>
          </span>
        </div>
        {(error || !src) && (
          <p role="alert" data-testid="team-error" className="border-b border-rose-900/60 bg-rose-950/40 px-3 py-1.5 text-sm text-rose-200">
            {src ? error : 'This team view link is missing its source (or it is not an Apps Script /exec address). Ask the stat keeper for the link from Settings > Team view link.'}
            {error && cached ? ` Showing the copy from ${when(info.updatedAt)}.` : ''}
          </p>
        )}
        <UpdatePrompt />
        <main key={gen} className="flex min-h-0 flex-1 flex-col overflow-auto">
          {page}
        </main>
      </div>
    </ViewContext.Provider>
  )
}

function TeamGames() {
  const data = useLiveQuery(async () => {
    const [games, points, events] = await Promise.all([db.games.toArray(), db.points.toArray(), db.events.toArray()])
    return games
      .filter((g) => !g.deleted)
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at)
      .map((g) => ({ g, s: computeGameStats(g, points, events).state }))
  })
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <Card title="Games">
        <ul className="divide-y divide-slate-800" data-testid="team-games">
          {(data ?? []).map(({ g, s }) => (
            <li key={g.id}>
              <a href={`#/team/game/${g.id}`} className="flex items-center gap-3 py-2 hover:bg-slate-900/50">
                <span className="flex flex-1 flex-col">
                  <span className="font-medium">vs {g.opponent}</span>
                  <span className="text-xs text-slate-400">
                    {[g.date, g.tournament].filter(Boolean).join(' · ')} {g.video.youtube_id ? '· 🎬 film' : ''}
                  </span>
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {s.score.us}–{s.score.them}
                </span>
                {s.result ? <Badge tone={s.result === 'W' ? 'good' : s.result === 'L' ? 'bad' : 'default'}>{s.result}</Badge> : <Badge>{s.points.length ? 'in progress' : 'new'}</Badge>}
              </a>
            </li>
          ))}
        </ul>
        {data && data.length === 0 && <p className="py-3 text-sm text-slate-500">No games yet.</p>}
      </Card>
    </div>
  )
}

/** A read-only game page: score, stats and play-by-play. Used by the team view and for games someone else owns. */
export function TeamGame({ gameId, back = '#/team' }: { gameId: string; back?: string }) {
  const { game, points, events, stats, loading } = useGameData(gameId)
  const players = usePlayers(true)
  const byId = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players])
  if (loading) return <p className="p-4 text-slate-400">Loading…</p>
  if (!game || game.deleted || !stats || !points || !events) return <p className="p-4 text-slate-400">Game not found.</p>
  const st = stats.state
  const film = game.video.youtube_id ? `https://youtu.be/${game.video.youtube_id}` : null
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-3 md:p-4" data-testid="team-game">
      <div className="flex flex-wrap items-baseline gap-3">
        <a href={back} className="text-sm text-slate-400 hover:text-white">← Games</a>
        <h1 className="text-xl font-bold">vs {game.opponent}</h1>
        <span className="text-sm text-slate-400">{[game.date, game.tournament].filter(Boolean).join(' · ')}</span>
        <span className="text-2xl font-semibold tabular-nums">
          {st.score.us}–{st.score.them}
        </span>
        {st.result && <Badge tone={st.result === 'W' ? 'good' : st.result === 'L' ? 'bad' : 'default'}>{st.result}</Badge>}
        {film && (
          <a className="ml-auto text-sm text-emerald-300 underline" href={film} target="_blank" rel="noreferrer">
            ▶ Watch the film
          </a>
        )}
      </div>
      <TeamSummary team={stats.team} opp={stats.opponent} opponent={game.opponent} />
      <PlayerStatsTable stats={[...stats.players.values()]} byId={byId} showYards={events.some((e) => e.y !== null)} />
      <CallsTable team={stats.team} players={[...stats.players.values()]} byId={byId} opponent={game.opponent} />
      <TagBreakdownTable team={stats.team} opp={stats.opponent} players={[...stats.players.values()]} byId={byId} opponent={game.opponent} />
      <Card title="Play-by-play">
        <ol className="flex flex-col gap-3 text-sm" data-testid="team-pbp">
          {st.points.map((pi) => (
            <li key={pi.point.id}>
              <div className="text-xs font-semibold text-slate-400">
                Point {pi.point.idx} · {pi.point.start_on} · {pi.before.us}–{pi.before.them} → {pi.after.us}–{pi.after.them}
              </div>
              <ul className="mt-1 flex flex-col gap-0.5 pl-3">
                {[...pi.events]
                  .filter((e) => !e.deleted)
                  .map((e) => {
                    const yt = e.source !== 'import' ? ytLink(game, e.video_time) : ''
                    return (
                      <li key={e.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-200">{describeEvent(e, byId, game.opponent)}</span>
                        {userTags(e.tags).map((t) => <Badge key={t}>{t}</Badge>)}
                        {yt && (
                          <a className="text-xs text-emerald-300 underline" href={yt} target="_blank" rel="noreferrer">
                            ▶ {mmss(e.video_time!)}
                          </a>
                        )}
                      </li>
                    )
                  })}
              </ul>
            </li>
          ))}
        </ol>
        {!st.points.length && <p className="text-sm text-slate-500">No points recorded.</p>}
      </Card>
    </div>
  )
}
