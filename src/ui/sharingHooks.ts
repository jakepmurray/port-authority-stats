import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useSyncExternalStore } from 'react'
import { db } from '../db/db'
import type { RemoteGame, Who } from '../sync/client'
import { loadWho, subscribeWho } from '../sync/identity'
import { opGame } from '../sync/payload'
import { canWriteGame, conflictReason, isConflict } from '../sync/remote'

/** Who this browser's key belongs to (null until a script v4 answered). */
export const useWho = (): Who | null => useSyncExternalStore(subscribeWho, () => loadWho(), () => loadWho())

export function useRemote(): Map<string, RemoteGame> {
  const rows = useLiveQuery(() => db.remote.toArray(), [])
  return useMemo(() => new Map((rows ?? []).map((r) => [r.game_id, r])), [rows])
}

export interface GameConflict {
  gameId: string
  reason: 'not_owner' | 'unowned' | 'stale'
  owner: string
  ops: number
}
/** Changes the script refused, by game. */
export function useConflicts(): GameConflict[] {
  return (
    useLiveQuery(async () => {
      const [queue, points] = await Promise.all([db.syncQueue.toArray(), db.points.toArray()])
      const pg = new Map(points.map((p) => [p.id, p.game_id]))
      const by = new Map<string, GameConflict>()
      for (const o of queue) {
        if (!isConflict(o)) continue
        const g = opGame(o, pg)
        if (!g) continue
        const cur = by.get(g) ?? { gameId: g, reason: conflictReason(o)!, owner: o.last_error!.split(':').slice(2).join(':'), ops: 0 }
        cur.ops++
        by.set(g, cur)
      }
      return [...by.values()]
    }, []) ?? []
  )
}

/** Is this game read-only on this device (someone else owns it, or nobody does yet)? */
export function useGameLock(gameId: string): { locked: boolean; remote: RemoteGame | undefined; loading: boolean } {
  const who = useWho()
  const remote = useLiveQuery(() => db.remote.get(gameId).then((r) => r ?? null), [gameId])
  if (remote === undefined) return { locked: false, remote: undefined, loading: true }
  return { locked: !canWriteGame(remote ?? undefined, who), remote: remote ?? undefined, loading: false }
}

export function ownerLabel(r: RemoteGame | undefined, who: Who | null) {
  if (!r || !who) return null
  if (!r.owner_id) return 'Unowned'
  return r.owner_id === who.id ? 'You' : r.owner_name || r.owner_id
}

