// Minimal types for the YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference)
declare namespace YT {
  const PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 }
  interface PlayerEvent {
    target: Player
    data: number
  }
  interface PlayerOptions {
    videoId?: string
    width?: string | number
    height?: string | number
    playerVars?: Record<string, string | number>
    events?: {
      onReady?: (e: PlayerEvent) => void
      onStateChange?: (e: PlayerEvent) => void
      onPlaybackRateChange?: (e: PlayerEvent) => void
      onError?: (e: PlayerEvent) => void
    }
  }
  class Player {
    constructor(el: HTMLElement | string, opts: PlayerOptions)
    playVideo(): void
    pauseVideo(): void
    seekTo(seconds: number, allowSeekAhead: boolean): void
    getCurrentTime(): number
    getDuration(): number
    getPlayerState(): number
    getPlaybackRate(): number
    setPlaybackRate(r: number): void
    cueVideoById(id: string, start?: number): void
    loadVideoById(id: string, start?: number): void
    destroy(): void
  }
}
interface Window {
  YT?: typeof YT
  onYouTubeIframeAPIReady?: () => void
}
