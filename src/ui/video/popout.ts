import type { Game } from '../../domain/schema'
import { useExternal } from '../hooks'
import type { VideoController } from './controller'

export type Layout = 'video' | 'collapsed' | 'popout' | 'stats'

export function useVideoStatus(c: VideoController) {
  return useExternal(c.subscribe, c.getStatus)
}

export function openPopout(game: Game, c: VideoController) {
  const t = c.getTime() ?? game.video.offset_s ?? 0
  c.pause()
  const url = `${location.pathname}#/popout/${game.id}?t=${Math.floor(t)}`
  const w = window.open(url, `pa-video-${game.id}`, 'popup,width=1100,height=660')
  return w !== null
}

