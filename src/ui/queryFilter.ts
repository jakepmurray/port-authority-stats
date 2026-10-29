import { useEffect, useState } from 'react'
import { DEFAULT_FILTER, filterToQuery, parseFilter, type DashFilter } from '../domain/dashboard'
import { useView } from './view'

/** The filter fields the stat tables use (the dashboard has its own, fuller filter). */
export type TableFilter = Pick<DashFilter, 'tournament' | 'tags' | 'tagMode' | 'tagScope'>
const KEYS = ['t', 'tags', 'tm', 'ts']

const read = (): TableFilter => {
  const f = parseFilter(window.location.hash.split('?')[1] ?? '')
  return { tournament: f.tournament, tags: f.tags, tagMode: f.tagMode, tagScope: f.tagScope }
}

/** The full dashboard filter for these fields (everything else default). */
export const asDash = (f: TableFilter, games: string[] = []): DashFilter => ({ ...DEFAULT_FILTER, ...f, games })

/**
 * The hash for the current page with this filter: same path, the filter's params
 * (t, tags, tm, ts; same names as the dashboard), other params kept. In the team view
 * the snapshot source rides along as team_src so the link opens for anyone.
 */
export function hashWith(hash: string, f: TableFilter, teamSrc?: string | null): string {
  const [path, qs = ''] = hash.split('?')
  const q = new URLSearchParams(filterToQuery(asDash(f)))
  new URLSearchParams(qs).forEach((v, k) => !KEYS.includes(k) && q.append(k, v))
  if (teamSrc && !q.has('team_src') && !q.has('src')) q.set('team_src', teamSrc)
  const s = q.toString()
  return `${path || '#/'}${s ? `?${s}` : ''}`
}

/** Tag (and tournament) filter kept in the page's hash, so the view can be bookmarked and shared. */
export function useQueryFilter(): { filter: TableFilter; setFilter: (f: TableFilter) => void; shareUrl: () => string } {
  const { src } = useView()
  const [filter, setF] = useState<TableFilter>(read)
  useEffect(() => {
    const on = () => setF(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const setFilter = (f: TableFilter) => {
    setF(f)
    history.replaceState(null, '', hashWith(window.location.hash, f, src))
  }
  const shareUrl = () => `${window.location.href.split('#')[0]}${hashWith(window.location.hash, filter, src)}`
  return { filter, setFilter, shareUrl }
}
