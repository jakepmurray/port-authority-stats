
let apiPromise: Promise<typeof YT> | null = null

/** Load the YouTube IFrame API script once. */
export function loadYouTubeApi(): Promise<typeof YT> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(window.YT!)
    }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => {
      apiPromise = null
      reject(new Error('Could not load YouTube (offline?)'))
    }
    document.head.appendChild(s)
  })
  return apiPromise
}

export interface VideoStatus {
  ready: boolean
  time: number | null
  playing: boolean
  rate: number
  duration: number | null
}

export type VideoMessage =
  | { type: 'state'; t: number; playing: boolean; rate: number; duration: number | null }
  | { type: 'closed' }
  | { type: 'hello' }
  | { type: 'seek'; t: number }
  | { type: 'toggle' }
  | { type: 'pause' }
  | { type: 'rate'; rate: number }

export const channelName = (gameId: string) => `pa-video-${gameId}`

/**
 * One interface over the video, wherever it plays: an embedded player in this
 * window, a pop-out window (synced with BroadcastChannel), or none.
 */
export class VideoController {
  private player: YT.Player | null = null
  private remote: { t: number; playing: boolean; rate: number; at: number; duration: number | null } | null = null
  private listeners = new Set<() => void>()
  private channel: BroadcastChannel | null = null
  private timer: number | null = null
  status: VideoStatus = { ready: false, time: null, playing: false, rate: 1, duration: null }
  private closedListeners = new Set<() => void>()

  /** Called when the pop-out window closes. Returns an unsubscribe function. */
  onRemoteClosed(fn: () => void) {
    this.closedListeners.add(fn)
    return () => void this.closedListeners.delete(fn)
  }

  readonly gameId: string
  constructor(gameId: string) {
    this.gameId = gameId
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(channelName(gameId))
      this.channel.onmessage = (ev: MessageEvent<VideoMessage>) => this.onMessage(ev.data)
    }
    this.timer = window.setInterval(() => this.tick(), 250)
  }

  dispose() {
    if (this.timer) window.clearInterval(this.timer)
    this.channel?.close()
    this.listeners.clear()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getStatus = () => this.status

  attach(p: YT.Player | null) {
    this.player = p
    this.tick()
  }

  get hasRemote() {
    return this.remote !== null
  }

  private onMessage(m: VideoMessage) {
    if (m.type === 'state') {
      this.remote = { t: m.t, playing: m.playing, rate: m.rate, at: performance.now(), duration: m.duration }
      this.tick()
    } else if (m.type === 'closed') {
      this.remote = null
      this.tick()
      this.closedListeners.forEach((f) => f())
    }
  }

  private send(m: VideoMessage) {
    this.channel?.postMessage(m)
  }

  /** Current video time in seconds, or null if no video is playing anywhere. */
  getTime(): number | null {
    if (this.player) {
      try {
        return this.player.getCurrentTime()
      } catch {
        return null
      }
    }
    if (this.remote) {
      const r = this.remote
      return r.t + (r.playing ? ((performance.now() - r.at) / 1000) * r.rate : 0)
    }
    return null
  }

  seek(t: number) {
    const to = Math.max(0, t)
    if (this.player) this.player.seekTo(to, true)
    else if (this.remote) {
      this.send({ type: 'seek', t: to })
      this.remote = { ...this.remote, t: to, at: performance.now() }
    }
    this.tick()
  }
  nudge(dt: number) {
    const t = this.getTime()
    if (t !== null) this.seek(t + dt)
  }
  toggle() {
    if (this.player) {
      if (this.player.getPlayerState() === 1) this.player.pauseVideo()
      else this.player.playVideo()
    } else this.send({ type: 'toggle' })
  }
  pause() {
    if (this.player) this.player.pauseVideo()
    else this.send({ type: 'pause' })
  }
  setRate(rate: number) {
    if (this.player) this.player.setPlaybackRate(rate)
    else this.send({ type: 'rate', rate })
  }

  private tick() {
    let next: VideoStatus
    if (this.player) {
      let playing = false
      let rate = 1
      let duration: number | null = null
      try {
        playing = this.player.getPlayerState() === 1
        rate = this.player.getPlaybackRate()
        duration = this.player.getDuration() || null
      } catch {
        /* player not ready */
      }
      next = { ready: true, time: this.getTime(), playing, rate, duration }
    } else if (this.remote) {
      next = { ready: true, time: this.getTime(), playing: this.remote.playing, rate: this.remote.rate, duration: this.remote.duration }
    } else next = { ready: false, time: null, playing: false, rate: 1, duration: null }
    const s = this.status
    if (s.ready !== next.ready || s.playing !== next.playing || s.rate !== next.rate || s.duration !== next.duration || Math.floor(s.time ?? -1) !== Math.floor(next.time ?? -1)) {
      this.status = next
      this.listeners.forEach((l) => l())
    }
  }
}
