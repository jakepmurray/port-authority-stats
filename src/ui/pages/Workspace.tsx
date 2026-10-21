import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { actions, type TimeStamp } from '../../db/actions'
import type { EntryMode } from '../../domain/entry'
import { capsDue } from '../../domain/game'
import { parseClock } from '../../domain/time'
import { EntryPanel } from '../EntryPanel'
import { EventLog } from '../EventLog'
import { useGameData, usePref, useTeam } from '../hooks'
import { Badge, Btn } from '../kit'
import { PointStarter } from '../PointStarter'
import { PlayerStatsTable, TagBreakdownTable, TeamSummary } from '../StatsTables'
import { VideoController } from '../video/controller'
import { openPopout, useVideoStatus, type Layout } from '../video/popout'
import { VideoPane } from '../video/VideoPane'

const SEEK_LEAD_S = 3

export function Workspace({ gameId }: { gameId: string }) {
  const { game, points, events, players, stats, loading } = useGameData(gameId)
  const [layoutPref, setLayout] = usePref<Layout>('layout', 'video')
  const [mode, setMode] = usePref<EntryMode>('mode', 'full')
  const [askTags, setAskTags] = usePref<boolean>('askTags', true)
  const { tags: tagChoices } = useTeam()
  const [tab, setTab] = useState<'entry' | 'stats'>('entry')
  const [manualTime, setManualTime] = useState('')
  const [video] = useState(() => new VideoController(gameId))
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => () => video.dispose(), [video])

  const hasVideo = !!game?.video.youtube_id
  const layout: Layout = hasVideo ? layoutPref : 'stats'
  const setLayoutRef = useRef(setLayout)
  useEffect(() => {
    setLayoutRef.current = setLayout
  })
  useEffect(() => video.onRemoteClosed(() => setLayoutRef.current('video')), [video])

  const status = useVideoStatus(video)
  const stamp = useCallback((): TimeStamp => {
    if (layout === 'stats') {
      const t = parseClock(manualTime)
      return t === null || Number.isNaN(t) ? { video_time: null, time_source: 'none' } : { video_time: t, time_source: 'manual' }
    }
    const t = video.getTime()
    return t === null ? { video_time: null, time_source: 'none' } : { video_time: Math.round(t * 10) / 10, time_source: 'auto' }
  }, [layout, manualTime, video])

  const seek = useMemo(() => (layout === 'stats' ? null : (t: number) => video.seek(t - SEEK_LEAD_S)), [layout, video])

  // Video keys when there is no point in progress (the entry panel handles them otherwise).
  const current = stats?.state.current ?? null
  useEffect(() => {
    if (current || layout === 'stats') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key === ' ') {
        e.preventDefault()
        video.toggle()
      } else if (e.key === 'ArrowLeft') video.nudge(e.shiftKey ? -1 : -5)
      else if (e.key === 'ArrowRight') video.nudge(e.shiftKey ? 1 : 5)
      else if (e.key === 'u' || ((e.ctrlKey || e.metaKey) && e.key === 'z')) void actions.undo(gameId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, layout, video, gameId])

  if (loading) return <p className="p-4 text-slate-400">Loading…</p>
  if (!game || !stats || !points || !events || !players) return <p className="p-4 text-slate-400">Game not found.</p>
  const st = stats.state
  const clockMin = status.time !== null && layout !== 'stats' ? (status.time - game.video.offset_s) / 60 : null
  const due = clockMin !== null ? capsDue(game.caps, clockMin) : { half: false, soft: false, hard: false }
  const half = st.halfReached ? 2 : 1
  const toLeft = (t: 'us' | 'them') => game.timeouts_per_half - st.timeouts[half][t]
  const activePlayers = players.filter((p) => !p.deleted)
  const wide = layout !== 'video'
  const run = (p: Promise<unknown>) => p.catch((e: Error) => setErr(e.message))

  const layoutBtn = (l: Layout, label: string, title: string) => (
    <Btn
      size="sm"
      tone={layout === l ? 'primary' : 'ghost'}
      disabled={!hasVideo && l !== 'stats'}
      title={title}
      onClick={() => {
        if (l === 'popout') {
          if (!openPopout(game, video)) return setErr('Pop-up blocked. Allow pop-ups for this site.')
        }
        setLayout(l)
      }}
    >
      {label}
    </Btn>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1.5">
        <span className="font-semibold">vs {game.opponent}</span>
        <span className="text-xl font-bold tabular-nums">
          {st.score.us}–{st.score.them}
        </span>
        <Badge>to {st.target}{st.target < game.game_to ? ' (capped)' : ''}</Badge>
        <Badge>{st.halfReached ? '2nd half' : `1st half · to ${st.halfTarget}`}</Badge>
        {st.over && <Badge tone={st.winner === 'us' ? 'good' : 'bad'}>Final</Badge>}
        <span className="text-xs text-slate-400" title="Timeouts left this half">
          TO us {toLeft('us')} · them {toLeft('them')}
        </span>
        {(['half', 'soft', 'hard'] as const).map((k) =>
          due[k] && !st.capsCalled[k] && !(k === 'half' && st.halfReached) && !st.over ? (
            <Badge key={k} tone="warn">
              {k} cap time ({game.caps[k]}′) — press “{k} cap”
            </Badge>
          ) : null,
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {layoutBtn('video', 'Video', 'Video beside the stat panel')}
          {layoutBtn('collapsed', 'Collapse', 'Hide the video, keep it playing (controls stay)')}
          {layoutBtn('popout', 'Pop out', 'Move the video to its own window (for a second screen)')}
          {layoutBtn('stats', 'Stats only', 'No video; type timestamps by hand or leave them blank')}
          <span className="mx-1 h-5 w-px bg-slate-700" />
          <Btn size="sm" tone={mode === 'full' ? 'primary' : 'ghost'} onClick={() => setMode('full')} title="Every pass">
            Full
          </Btn>
          <Btn size="sm" tone={mode === 'quick' ? 'primary' : 'ghost'} onClick={() => setMode('quick')} title="Goals, assists, Ds and turns only">
            Quick
          </Btn>
          <label className="ml-1 flex items-center gap-1 text-xs text-slate-300" title="After a turnover, offer a quick tag step (receiver error, wind…)">
            <input type="checkbox" checked={askTags} onChange={(e) => setAskTags(e.target.checked)} /> Tag turns
          </label>
          <a className="ml-1 text-xs text-sky-300 underline" href={`#/game/${game.id}/edit`}>
            Game settings
          </a>
        </div>
      </div>
      {err && (
        <div className="flex items-center gap-2 bg-rose-950 px-3 py-1 text-sm text-rose-200">
          {err}
          <Btn size="sm" tone="ghost" onClick={() => setErr(null)}>
            ✕
          </Btn>
        </div>
      )}
      <div className={`flex min-h-0 flex-1 flex-col ${layout === 'video' ? 'lg:flex-row' : ''}`}>
        <div className={`${layout === 'video' ? 'lg:flex-[3]' : ''} flex min-h-0 flex-col lg:min-w-0`}>
          <VideoPane game={game} c={video} layout={layout} setLayout={setLayout} manualTime={manualTime} setManualTime={setManualTime} />
        </div>
        <aside
          className={`flex min-h-0 flex-1 flex-col border-slate-800 ${layout === 'video' ? 'lg:max-w-[560px] lg:flex-[2] lg:border-l' : ''}`}
        >
          <div className="flex gap-1 border-b border-slate-800 px-2 py-1">
            <Btn size="sm" tone={tab === 'entry' ? 'primary' : 'ghost'} onClick={() => setTab('entry')}>
              Entry &amp; log
            </Btn>
            <Btn size="sm" tone={tab === 'stats' ? 'primary' : 'ghost'} onClick={() => setTab('stats')}>
              Stats
            </Btn>
            <span className="ml-auto hidden self-center text-[11px] text-slate-500 sm:inline">
              Keys: 0–9 player · G T D B C S X P · U undo · Space play · ←/→ 5 s
            </span>
          </div>
          {tab === 'entry' ? (
            <div className={`flex min-h-0 flex-1 flex-col ${wide ? 'lg:flex-row' : ''}`}>
              <div className={`border-b border-slate-800 p-2 ${wide ? 'lg:w-[600px] lg:shrink-0 lg:overflow-auto lg:border-r lg:border-b-0' : ''}`}>
                {current ? (
                  <EntryPanel
                    key={current.point.id}
                    game={game}
                    current={current}
                    players={activePlayers}
                    mode={mode}
                    stamp={stamp}
                    video={layout === 'stats' ? null : video}
                    onEvent={(d, t) => run(actions.addEvent(current.point.id, d, t)).then(() => undefined)}
                    onUndo={() => run(actions.undo(game.id)).then(() => undefined)}
                    tagChoices={tagChoices}
                    askTags={askTags}
                    onTag={(id, tags) => run(actions.tagEvent(id, tags)).then(() => undefined)}
                    onAddTag={(t) => run(actions.addCustomTag(t)).then(() => undefined)}
                    onMissed={(r) => run(actions.setPointMissed(current.point.id, true, r)).then(() => undefined)}
                  />
                ) : (
                  <PointStarter
                    key={st.next.idx}
                    game={game}
                    state={st}
                    players={activePlayers}
                    onStart={(o) => void run(actions.startPoint(game.id, { ...o, video_time: o.missed ? null : stamp().video_time }))}
                  />
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <EventLog
                  game={game}
                  state={st}
                  allPoints={points}
                  allEvents={events}
                  players={players}
                  onSeek={seek}
                  stamp={stamp}
                  tagChoices={tagChoices}
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-2">
              <TeamSummary team={stats.team} opp={stats.opponent} opponent={game.opponent} />
              <TagBreakdownTable team={stats.team} opp={stats.opponent} players={[...stats.players.values()]} byId={new Map(players.map((p) => [p.id, p]))} opponent={game.opponent} />
              <PlayerStatsTable
                stats={[...stats.players.values()]}
                byId={new Map(players.map((p) => [p.id, p]))}
                showYards={events.some((e) => e.y !== null)}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
