import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef } from 'react'
import { db } from '../../db/db'
import { channelName, type VideoMessage } from '../video/controller'
import { YouTubeEmbed } from '../video/YouTubeEmbed'

/** Pop-out video window for dual-screen setups. Syncs time with the main window over BroadcastChannel. */
export function Popout({ gameId }: { gameId: string }) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId])
  const player = useRef<YT.Player | null>(null)
  const startAt = Number(new URLSearchParams(location.hash.split('?')[1] ?? '').get('t') ?? 0)

  useEffect(() => {
    const ch = new BroadcastChannel(channelName(gameId))
    const post = (m: VideoMessage) => ch.postMessage(m)
    ch.onmessage = (ev: MessageEvent<VideoMessage>) => {
      const p = player.current
      const m = ev.data
      if (!p) return
      if (m.type === 'seek') p.seekTo(m.t, true)
      if (m.type === 'toggle') {
        if (p.getPlayerState() === 1) p.pauseVideo()
        else p.playVideo()
      }
      if (m.type === 'pause') p.pauseVideo()
      if (m.type === 'rate') p.setPlaybackRate(m.rate)
    }
    const timer = window.setInterval(() => {
      const p = player.current
      if (!p) return
      try {
        post({ type: 'state', t: p.getCurrentTime(), playing: p.getPlayerState() === 1, rate: p.getPlaybackRate(), duration: p.getDuration() || null })
      } catch {
        /* not ready */
      }
    }, 250)
    const bye = () => post({ type: 'closed' })
    window.addEventListener('pagehide', bye)
    return () => {
      bye()
      window.clearInterval(timer)
      window.removeEventListener('pagehide', bye)
      ch.close()
    }
  }, [gameId])

  const onPlayer = useCallback((p: YT.Player | null) => {
    player.current = p
  }, [])

  useEffect(() => {
    if (game) document.title = `Film · vs ${game.opponent}`
  }, [game])

  if (game === undefined) return <p className="p-4 text-slate-400">Loading…</p>
  if (!game?.video.youtube_id) return <p className="p-4 text-slate-400">This game has no YouTube link.</p>
  return (
    <div className="h-full w-full bg-black">
      <YouTubeEmbed videoId={game.video.youtube_id} start={startAt} onPlayer={onPlayer} />
    </div>
  )
}
