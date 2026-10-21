import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { db } from '../db/db'
import { computeGameStats } from '../domain/stats'
import type { Player, Team } from '../domain/schema'
import { tagChoices } from '../domain/tags'

/** Hash routing: "#/game/abc/stats" → ['game', 'abc', 'stats']. */
export function useRoute(): string[] {
  const get = () => window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean)
  const [route, setRoute] = useState(get)
  useEffect(() => {
    const on = () => setRoute(get())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (path: string) => {
  window.location.hash = `#/${path.replace(/^\//, '')}`
}

export function usePlayers(includeDeleted = false): Player[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.players.toArray()
    return (includeDeleted ? all : all.filter((p) => !p.deleted)).sort(
      (a, b) => Number(a.number) - Number(b.number) || a.name.localeCompare(b.name),
    )
  }, [includeDeleted])
}

export function useGameData(gameId: string) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId])
  const points = useLiveQuery(() => db.points.where('game_id').equals(gameId).toArray(), [gameId])
  const events = useLiveQuery(() => db.events.where('game_id').equals(gameId).toArray(), [gameId])
  const players = usePlayers(true)
  const stats = useMemo(
    () => (game && points && events ? computeGameStats(game, points, events) : null),
    [game, points, events],
  )
  const playerById = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players])
  return { game, points, events, players, stats, playerById, loading: game === undefined || !points || !events || !players }
}

export function useExternal<T>(subscribe: (cb: () => void) => () => void, get: () => T): T {
  return useSyncExternalStore(subscribe, get, get)
}

/** Persisted UI preference. */
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(`pa:${key}`)
      return s === null ? initial : (JSON.parse(s) as T)
    } catch {
      return initial
    }
  })
  const set = (nv: T) => {
    setV(nv)
    try {
      localStorage.setItem(`pa:${key}`, JSON.stringify(nv))
    } catch {
      /* private mode */
    }
  }
  return [v, set]
}

/** The tracked team (first live one) and its tag choices: presets + custom tags. */
export function useTeam(): { team: Team | undefined; tags: string[] } {
  const team = useLiveQuery(async () => (await db.teams.toArray()).find((t) => !t.deleted), [])
  const tags = useMemo(() => tagChoices(team?.custom_tags), [team])
  return { team, tags }
}
