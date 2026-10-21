import { useEffect, useRef, useState } from 'react'
import { loadYouTubeApi } from './controller'

/** Embeds a YouTube video with the IFrame Player API and hands the player back. */
export function YouTubeEmbed({
  videoId,
  start,
  onPlayer,
}: {
  videoId: string
  start?: number
  onPlayer: (p: YT.Player | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const onPlayerRef = useRef(onPlayer)
  const startRef = useRef(start)
  useEffect(() => {
    onPlayerRef.current = onPlayer
  })

  useEffect(() => {
    let player: YT.Player | null = null
    let cancelled = false
    const box = host.current
    loadYouTubeApi()
      .then((api) => {
        if (cancelled || !box) return
        const el = document.createElement('div')
        box.appendChild(el)
        player = new api.Player(el, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(startRef.current ?? 0) },
          events: {
            onReady: (e) => !cancelled && onPlayerRef.current(e.target),
            onError: (e) => setError(`YouTube error ${e.data}: the video may be private or not embeddable`),
          },
        })
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      cancelled = true
      onPlayerRef.current(null)
      try {
        player?.destroy()
      } catch {
        /* already gone */
      }
      if (box) box.innerHTML = ''
    }
  }, [videoId])

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={host} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
      {error && <div className="absolute inset-x-0 bottom-0 bg-red-900/90 p-2 text-sm">{error}</div>}
    </div>
  )
}
