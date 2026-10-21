import { useCallback } from 'react'
import { repo } from '../../db/repo'
import type { Game } from '../../domain/schema'
import { formatClock, parseClock } from '../../domain/time'
import { Btn, Input } from '../kit'
import type { VideoController } from './controller'
import { openPopout, useVideoStatus } from './popout'
import { YouTubeEmbed } from './YouTubeEmbed'

export type { Layout } from './popout'
import type { Layout } from './popout'

/** Transport controls; work for the embedded player and the pop-out alike. */
export function Transport({ c, game, compact }: { c: VideoController; game: Game; compact?: boolean }) {
  const s = useVideoStatus(c)
  const clockMin = s.time !== null ? Math.max(0, (s.time - game.video.offset_s) / 60) : null
  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-slate-800 bg-slate-900 px-2 py-1.5 text-sm">
      <Btn size="sm" onClick={() => c.nudge(-5)} title="Back 5 s (←)">−5</Btn>
      <Btn size="sm" tone="primary" onClick={() => c.toggle()} title="Play / pause (Space)" className="w-16">
        {s.playing ? 'Pause' : 'Play'}
      </Btn>
      <Btn size="sm" onClick={() => c.nudge(5)} title="Forward 5 s (→)">+5</Btn>
      <span className="mx-1 font-mono tabular-nums" title="Video time">
        {s.ready ? formatClock(s.time) : '–:–'}
        {s.duration ? <span className="text-slate-500"> / {formatClock(s.duration)}</span> : null}
      </span>
      {[0.5, 1, 1.5, 2].map((r) => (
        <Btn key={r} size="sm" tone={s.rate === r ? 'primary' : 'ghost'} onClick={() => c.setRate(r)} title={r === 0.5 ? '[' : r === 1 ? ']' : ''}>
          {r}×
        </Btn>
      ))}
      {!compact && (
        <>
          <span className="ml-auto text-xs text-slate-400" title="Game clock = video time − game start. Used for caps.">
            Game clock {clockMin === null ? '–' : `${Math.floor(clockMin)}′`}
          </span>
          <Btn
            size="sm"
            tone="ghost"
            title="Mark the current video time as the start of the game (first pull)"
            onClick={() => {
              const t = c.getTime()
              if (t !== null) void repo.update('games', game.id, { video: { ...game.video, offset_s: Math.floor(t) } }, { byHand: true })
            }}
          >
            Set game start
          </Btn>
        </>
      )}
    </div>
  )
}

export function VideoPane({
  game,
  c,
  layout,
  setLayout,
  manualTime,
  setManualTime,
}: {
  game: Game
  c: VideoController
  layout: Layout
  setLayout: (l: Layout) => void
  manualTime: string
  setManualTime: (s: string) => void
}) {
  const onPlayer = useCallback((p: YT.Player | null) => c.attach(p), [c])
  const vid = game.video.youtube_id

  if (layout === 'stats' || !vid) {
    const bad = Number.isNaN(parseClock(manualTime))
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2 text-sm">
        <span className="text-slate-400">Stats-only{!vid ? ' (no video link)' : ''}. Video time for new events:</span>
        <Input
          aria-label="Manual video time"
          className={`w-24 font-mono ${bad ? 'border-rose-500' : ''}`}
          placeholder="mm:ss"
          value={manualTime}
          onChange={(e) => setManualTime(e.target.value)}
        />
        <span className="text-xs text-slate-500">Leave blank for no timestamp.</span>
        {vid && (
          <Btn size="sm" className="ml-auto" onClick={() => setLayout('video')}>
            Show video
          </Btn>
        )}
        {!vid && (
          <a className="ml-auto text-xs text-sky-300 underline" href={`#/game/${game.id}/edit`}>
            Add a YouTube link
          </a>
        )}
      </div>
    )
  }

  if (layout === 'popout') {
    return (
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-2 bg-slate-900 px-3 py-3 text-sm text-slate-300">
          <span>Video is playing in the pop-out window. Keep entering stats here.</span>
          <Btn size="sm" className="ml-auto" onClick={() => openPopout(game, c)}>
            Re-open pop-out
          </Btn>
          <Btn size="sm" onClick={() => setLayout('video')}>
            Bring video back
          </Btn>
        </div>
        <Transport c={c} game={game} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col lg:h-full">
      <div className={layout === 'collapsed' ? 'pointer-events-none h-0 overflow-hidden' : 'relative aspect-video w-full bg-black lg:aspect-auto lg:min-h-0 lg:flex-1'}>
        <YouTubeEmbed videoId={vid} start={game.video.offset_s} onPlayer={onPlayer} />
      </div>
      <Transport c={c} game={game} compact={layout === 'collapsed'} />
    </div>
  )
}
