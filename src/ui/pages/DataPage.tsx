import { useState } from 'react'
import { actions } from '../../db/actions'
import { db } from '../../db/db'
import { eventsCsv, gamesCsv, playerStatsCsv, pointsCsv, type AllData } from '../../domain/exports'
import { download } from '../format'
import { Btn, Card } from '../kit'
import { UltiImport } from '../UltiImport'

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')

async function all(): Promise<AllData> {
  const [players, games, points, events] = await Promise.all([db.players.toArray(), db.games.toArray(), db.points.toArray(), db.events.toArray()])
  return { players, games, points, events }
}

export function DataPage() {
  const [msg, setMsg] = useState<string | null>(null)
  const restore = async (file: File, mode: 'merge' | 'replace') => {
    if (mode === 'replace' && !confirm('Replace ALL data in this browser with the backup?')) return
    try {
      const counts = await actions.importBackup(await file.text(), mode)
      setMsg(`Restored (${mode}): ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`)
    } catch (e) {
      setMsg(`Restore failed: ${(e as Error).message}`)
    }
  }
  const picker = (mode: 'merge' | 'replace') => (
    <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700">
      {mode === 'merge' ? 'Restore (merge, newer wins)' : 'Restore (replace everything)'}
      <input
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void restore(f, mode)
          e.target.value = ''
        }}
      />
    </label>
  )
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Card title="Backup (JSON)">
        <p className="mb-3 text-sm text-slate-400">
          All data lives in this browser (IndexedDB). Download a backup after each game. Restore it here or on another device.
        </p>
        <div className="flex flex-wrap gap-2">
          <Btn tone="primary" onClick={async () => download(`pa-stats-backup-${stamp()}.json`, JSON.stringify(await actions.exportBackup(), null, 1), 'application/json')}>
            Download backup
          </Btn>
          {picker('merge')}
          {picker('replace')}
        </div>
      </Card>
      <Card title="Export (CSV)">
        <p className="mb-3 text-sm text-slate-400">Spreadsheet-friendly files. Deleted records are left out. Event rows include a YouTube link to the moment.</p>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={async () => download(`pa-player-stats-${stamp()}.csv`, playerStatsCsv(await all()), 'text/csv')}>Player stats per game</Btn>
          <Btn onClick={async () => download(`pa-games-${stamp()}.csv`, gamesCsv(await all()), 'text/csv')}>Games</Btn>
          <Btn onClick={async () => download(`pa-points-${stamp()}.csv`, pointsCsv(await all()), 'text/csv')}>Points</Btn>
          <Btn onClick={async () => download(`pa-events-${stamp()}.csv`, eventsCsv(await all()), 'text/csv')}>Events (play-by-play)</Btn>
        </div>
      </Card>
      <UltiImport />
      <Card title="Google Sheet sync">
        <p className="text-sm text-slate-400">
          Live push to your own Google Sheet: set it up on the <a className="text-sky-300 underline" href="#/settings">Settings</a> page.
        </p>
      </Card>
      {msg && <p className="text-sm text-sky-200">{msg}</p>}
    </div>
  )
}
