import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { changeOwner, discardGame, retryGame } from '../sync'
import type { RemoteGame, Who } from '../sync/client'
import { loadPeople } from '../sync/identity'
import { Badge, Btn, Card, Select } from './kit'
import { ownerLabel, useConflicts, useRemote, useWho, type GameConflict } from './sharingHooks'
import { TeamGame } from './team/TeamView'

export function OwnerBadge({ remote, who }: { remote: RemoteGame | undefined; who: Who | null }) {
  const l = ownerLabel(remote, who)
  if (!l) return null
  return (
    <span data-testid="owner-badge" title={remote?.updated_by ? `Last pushed by ${remote.updated_by}` : undefined}>
      <Badge tone={l === 'You' ? 'good' : l === 'Unowned' ? 'warn' : 'info'}>{l === 'You' || l === 'Unowned' ? l : `🔒 ${l}`}</Badge>
    </span>
  )
}

/** Claim / Release, and (admin) Reassign, for one game. */
export function OwnerControls({ remote, who }: { remote: RemoteGame | undefined; who: Who | null }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!remote || !who) return null
  const admin = who.role === 'admin'
  const mine = remote.owner_id === who.id
  const run = async (action: 'claim' | 'release' | 'reassign', to?: string) => {
    setBusy(true)
    setErr(null)
    try {
      await changeOwner(action, remote.game_id, to)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const people = admin ? loadPeople() : []
  return (
    <span className="flex flex-wrap items-center gap-1">
      {(!remote.owner_id || (admin && !mine)) && (
        <Btn size="sm" disabled={busy} onClick={() => void run('claim')} title={remote.owner_id ? `Take this game from ${remote.owner_name}` : 'Become this game’s editor'}>
          Claim
        </Btn>
      )}
      {remote.owner_id && (mine || admin) && (
        <Btn size="sm" tone="ghost" disabled={busy} onClick={() => void run('release')} title="Let someone else claim it">
          Release
        </Btn>
      )}
      {admin && people.length > 1 && (
        <Select
          aria-label="Reassign game"
          className="!py-0.5 text-xs"
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && void run('reassign', e.target.value)}
        >
          <option value="">Reassign…</option>
          {people.filter((p) => p.id !== remote.owner_id).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      )}
      {err && <span className="text-xs text-rose-300" role="alert">{err}</span>}
    </span>
  )
}

const REASON: Record<GameConflict['reason'], (owner: string) => string> = {
  not_owner: (o) => `${o || 'Someone else'} is editing this game, so your changes were not saved to the Sheet. Ask ${o || 'them'} to release it, or ask Jacob to reassign it.`,
  unowned: () => 'Nobody is editing this game right now. Claim it to send your changes.',
  stale: () => 'This game changed on another device since you last pulled. Pull and retry merges both copies (your changes stay).',
}

/** Games whose changes the script refused, with what can be done about each. */
export function ConflictsCard() {
  const conflicts = useConflicts()
  const games = useLiveQuery(() => db.games.toArray(), [])
  const remote = useRemote()
  const who = useWho()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  if (!conflicts.length) return null
  const name = (id: string) => {
    const g = games?.find((x) => x.id === id)
    return g ? `vs ${g.opponent}${g.date ? ` (${g.date})` : ''}` : id
  }
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card title={`Not saved: ${conflicts.length} game${conflicts.length === 1 ? '' : 's'}`}>
      <ul className="flex flex-col gap-3 text-sm" data-testid="conflicts">
        {conflicts.map((c) => {
          const r = remote.get(c.gameId)
          const canClaim = !r?.owner_id || who?.role === 'admin'
          return (
            <li key={c.gameId} className="flex flex-col gap-1">
              <span className="font-medium">{name(c.gameId)} · {c.ops} change{c.ops === 1 ? '' : 's'} held on this device</span>
              <span className="text-amber-200">{REASON[c.reason](c.owner)}</span>
              <span className="flex flex-wrap gap-2">
                {c.reason === 'stale' && <Btn size="sm" tone="primary" disabled={busy !== null} onClick={() => void act(c.gameId, () => retryGame(c.gameId))}>Pull and retry</Btn>}
                {c.reason !== 'stale' && canClaim && <Btn size="sm" tone="primary" disabled={busy !== null} onClick={() => void act(c.gameId, () => changeOwner('claim', c.gameId))}>Claim and retry</Btn>}
                <Btn size="sm" tone="bad" disabled={busy !== null} onClick={() => confirm('Throw away your unsaved changes to this game and take the shared copy?') && void act(c.gameId, () => discardGame(c.gameId))}>Discard my changes</Btn>
              </span>
            </li>
          )
        })}
      </ul>
      {msg && <p className="mt-2 text-sm text-rose-300">{msg}</p>}
    </Card>
  )
}

/** A game this device can't edit: the read-only page, with who has it and Claim. */
export function LockedGame({ gameId, remote }: { gameId: string; remote: RemoteGame | undefined }) {
  const who = useWho()
  return (
    <div className="flex flex-col">
      <div role="status" data-testid="locked-banner" className="flex flex-wrap items-center gap-2 border-b border-sky-900/60 bg-sky-950/40 px-3 py-1.5 text-sm text-sky-100">
        <span className="font-semibold">Read only</span>
        <span>
          {remote?.owner_id ? `${remote.owner_name} is editing this game. Ask them to release it${who?.role === 'admin' ? ', or take it.' : ', or ask Jacob to reassign it.'}` : 'Nobody is editing this game. Claim it to make changes.'}
        </span>
        <span className="ml-auto">
          <OwnerControls remote={remote} who={who} />
        </span>
      </div>
      <TeamGame gameId={gameId} back="#/" />
    </div>
  )
}
