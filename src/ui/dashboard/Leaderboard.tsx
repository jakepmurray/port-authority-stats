import { useState } from 'react'
import type { LeaderRow } from '../../domain/dashboard'
import type { Player } from '../../domain/schema'
import { Select } from '../kit'

type Key = 'points' | 'goals' | 'assists' | 'ds' | 'turns' | 'plus_minus' | 'comp_pct' | 'throw_attempts'
const COLS: { key: Key; label: string; title: string; rate: boolean }[] = [
  { key: 'points', label: 'Pts', title: 'Points played', rate: false },
  { key: 'goals', label: 'G', title: 'Goals', rate: true },
  { key: 'assists', label: 'A', title: 'Assists', rate: true },
  { key: 'ds', label: 'D', title: 'Blocks (incl. Callahans)', rate: true },
  { key: 'turns', label: 'Turns', title: 'Turnovers charged (throwaways, drops, stalls, other, calls)', rate: true },
  { key: 'plus_minus', label: '+/-', title: 'Goals + assists + Ds − turnovers', rate: true },
  { key: 'comp_pct', label: 'Cmp%', title: 'Completion %', rate: false },
  { key: 'throw_attempts', label: 'Thr', title: 'Throw attempts', rate: false },
]
const LOWER_IS_BETTER = new Set<Key>(['turns'])

const value = (r: LeaderRow, k: Key, perPoint: boolean): number | null => {
  if (k === 'comp_pct') return r.comp_pct
  if (perPoint && k in r.per_point) return r.per_point[k as keyof LeaderRow['per_point']]
  return r[k] as number
}
const show = (v: number | null, k: Key, perPoint: boolean) =>
  v === null ? '–' : k === 'comp_pct' ? `${Math.round(v * 100)}%` : perPoint && k !== 'points' && k !== 'throw_attempts' ? v.toFixed(2) : String(v)

export function Leaderboard({
  rows, byId, minPoints, setMinPoints, onPick,
}: { rows: LeaderRow[]; byId: Map<string, Player>; minPoints: number; setMinPoints: (n: number) => void; onPick: (id: string) => void }) {
  const [sort, setSort] = useState<Key>('plus_minus')
  const [perPoint, setPerPoint] = useState(false)
  const [all, setAll] = useState(false)
  const sorted = [...rows].sort((a, b) => {
    const va = value(a, sort, perPoint) ?? -Infinity
    const vb = value(b, sort, perPoint) ?? -Infinity
    return LOWER_IS_BETTER.has(sort) ? va - vb : vb - va
  })
  const shown = all ? sorted : sorted.slice(0, 15)
  const best = new Map(COLS.map((c) => [c.key, sorted.length ? value(sorted.slice().sort((a, b) => (LOWER_IS_BETTER.has(c.key) ? (value(a, c.key, perPoint) ?? Infinity) - (value(b, c.key, perPoint) ?? Infinity) : (value(b, c.key, perPoint) ?? -Infinity) - (value(a, c.key, perPoint) ?? -Infinity)))[0], c.key, perPoint) : null]))
  return (
    <div className="flex flex-col gap-2" data-testid="leaderboard">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <div role="group" aria-label="Totals or per point" className="inline-flex overflow-hidden rounded-lg border border-slate-700">
          {[false, true].map((p) => (
            <button key={String(p)} type="button" aria-pressed={perPoint === p} onClick={() => setPerPoint(p)} className={`px-2.5 py-1 ${perPoint === p ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-300'}`}>
              {p ? 'Per point' : 'Totals'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1">
          Min points
          <Select aria-label="Minimum points" value={minPoints} onChange={(e) => setMinPoints(Number(e.target.value))} className="py-0.5 text-xs">
            {[0, 5, 10, 20, 40].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </label>
        <span>{rows.length} players · click a column to sort, a player for their plays</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-900 p-1.5 text-left md:static">Player</th>
              {COLS.map((c) => (
                <th key={c.key} title={c.title} className="p-1.5 text-right">
                  <button type="button" onClick={() => setSort(c.key)} className={sort === c.key ? 'text-sky-300' : 'hover:text-slate-200'}>
                    {c.label}{perPoint && c.rate ? '/pt' : ''}{sort === c.key ? (LOWER_IS_BETTER.has(c.key) ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const p = byId.get(r.player_id)
              return (
                <tr key={r.player_id} className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/50" onClick={() => onPick(r.player_id)}>
                  <td className="sticky left-0 z-10 max-w-[9rem] truncate bg-slate-950 p-1.5 text-left md:static md:max-w-none md:bg-transparent">
                    <span className="text-slate-500">{p ? `#${p.number} ` : ''}</span>
                    {p?.name ?? 'Unknown'}
                  </td>
                  {COLS.map((c) => {
                    const v = value(r, c.key, perPoint)
                    const top = v !== null && v === best.get(c.key) && c.key !== 'points' && c.key !== 'throw_attempts' && rows.length > 1
                    return (
                      <td key={c.key} className={`p-1.5 text-right ${sort === c.key ? 'text-slate-50' : 'text-slate-300'} ${top ? 'font-semibold text-emerald-300' : ''}`}>
                        {show(v, c.key, perPoint)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > 15 && (
        <button type="button" className="self-start text-xs text-sky-300 underline" onClick={() => setAll((a) => !a)}>
          {all ? 'Show top 15' : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  )
}
