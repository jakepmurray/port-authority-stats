import { useSyncExternalStore } from 'react'
import { sync } from '../sync'
import type { SyncState } from '../sync/engine'
import { useConflicts, useWho } from './sharingHooks'

const LABEL: Record<SyncState['status'], string> = {
  unconfigured: 'Sheet: not set up',
  off: 'Sheet: manual',
  idle: 'Synced',
  pending: 'Sync pending',
  syncing: 'Syncing…',
  offline: 'Offline',
  error: 'Sync error',
}
const TONE: Record<SyncState['status'], string> = {
  unconfigured: 'text-slate-500',
  off: 'text-slate-400',
  idle: 'text-emerald-300',
  pending: 'text-amber-300',
  syncing: 'text-sky-300',
  offline: 'text-amber-300',
  error: 'text-rose-300',
}

/** Small sync status link for the header. */
export function SyncBadge() {
  const s = useSyncExternalStore(sync.subscribe, sync.get)
  const held = useConflicts().length
  const who = useWho()
  const when = s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null
  const title = [s.lastError, s.pending ? `${s.pending} waiting` : null, when ? `Last synced ${when}` : null].filter(Boolean).join(' · ')
  return (
    <a href="#/settings" className={`text-xs ${TONE[s.status]} hover:underline`} title={title || 'Google Sheet sync'} data-testid="sync-badge">
      {LABEL[s.status]}
      {s.status === 'idle' && when ? ` ${when}` : ''}
      {(s.status === 'pending' || s.status === 'offline' || s.status === 'off') && s.pending ? ` (${s.pending})` : ''}
      {held ? <span className="ml-1 text-rose-300">· {held} not saved</span> : null}
      {who && who.role !== 'admin' ? <span className="ml-1 text-slate-400">· {who.name}</span> : null}
    </a>
  )
}
