import { useState } from 'react'
import type { Player } from '../domain/schema'
import type { OpponentStats, PlayerStats, TeamStats } from '../domain/stats'
import { pct } from './format'

type Col = { key: keyof PlayerStats; label: string; title: string; fmt?: (v: number | null) => string }
const COLS: Col[] = [
  { key: 'points', label: 'Pts', title: 'Points played' },
  { key: 'o_points', label: 'O', title: 'O points' },
  { key: 'd_points', label: 'D', title: 'D points' },
  { key: 'goals', label: 'G', title: 'Goals' },
  { key: 'assists', label: 'A', title: 'Assists' },
  { key: 'hockey_assists', label: 'HA', title: 'Hockey assists' },
  { key: 'ds', label: 'Ds', title: 'Blocks (incl. Callahans)' },
  { key: 'completions', label: 'Cmp', title: 'Completions (incl. assists)' },
  { key: 'throw_attempts', label: 'Att', title: 'Throw attempts' },
  { key: 'comp_pct', label: 'Cmp%', title: 'Completion %', fmt: pct },
  { key: 'catches', label: 'Rec', title: 'Catches (incl. goals)' },
  { key: 'throwaways', label: 'TA', title: 'Throwaways' },
  { key: 'drops', label: 'Drp', title: 'Drops' },
  { key: 'stalls', label: 'Stl', title: 'Stalls' },
  { key: 'callahans', label: 'Cal', title: 'Callahans' },
  { key: 'pulls', label: 'Pul', title: 'Pulls' },
  { key: 'plus_minus', label: '+/-', title: 'Goals + assists + Ds − turnovers' },
]

export function PlayerStatsTable({ stats, byId, showYards }: { stats: PlayerStats[]; byId: Map<string, Player>; showYards?: boolean }) {
  const [sort, setSort] = useState<keyof PlayerStats>('plus_minus')
  const cols = showYards
    ? [...COLS, { key: 'throw_yards', label: 'TYd', title: 'Throwing yards' } as Col, { key: 'recv_yards', label: 'RYd', title: 'Receiving yards' } as Col]
    : COLS
  const rows = [...stats].sort((a, b) => ((b[sort] as number) ?? -1) - ((a[sort] as number) ?? -1))
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="sticky top-0 bg-slate-900 text-slate-400">
          <tr>
            <th className="p-1 text-left">Player</th>
            {cols.map((c) => (
              <th key={c.key} title={c.title} className={`cursor-pointer p-1 text-right ${sort === c.key ? 'text-sky-300' : ''}`} onClick={() => setSort(c.key)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const p = byId.get(s.player_id)
            return (
              <tr key={s.player_id} className="border-t border-slate-800">
                <td className="whitespace-nowrap p-1">
                  <span className="text-slate-500">#{p?.number ?? '?'}</span> {p?.name ?? 'Unknown'}
                </td>
                {cols.map((c) => (
                  <td key={c.key} className="p-1 text-right">
                    {c.fmt ? c.fmt(s[c.key] as number | null) : (s[c.key] as number)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-2 text-xs text-slate-500">No stats yet.</p>}
    </div>
  )
}

export function TeamSummary({ team, opp, opponent }: { team: TeamStats; opp: OpponentStats; opponent: string }) {
  const cell = (label: string, v: string | number, title?: string) => (
    <div title={title} className="rounded-lg bg-slate-800/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{v}</div>
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {cell('Holds', `${team.holds}/${team.o_points}`, 'Holds / O points')}
        {cell('O conv.', pct(team.o_conversion))}
        {cell('Breaks', `${team.breaks}/${team.d_points}`, 'Breaks / D points')}
        {cell('D break %', pct(team.d_break_pct))}
        {cell('Turns', team.turnovers)}
        {cell('Turns/pt', team.turnovers_per_point === null ? '–' : team.turnovers_per_point.toFixed(2))}
        {cell('Ds', team.ds)}
        {cell('Goals/poss', pct(team.scoring_efficiency), 'Scoring efficiency: goals per possession')}
        {cell('Pulls', `${team.pulls_in}/${team.pulls}`, `In / total (OB ${team.pulls_ob}, brick ${team.pulls_brick})`)}
      </div>
      <div className="text-xs text-slate-400">
        <span className="font-semibold text-slate-300">{opponent}</span> (team totals): {opp.goals} goals · {opp.turnovers} turns · {opp.ds} Ds ·{' '}
        {opp.callahans} Callahans · {opp.holds} holds · {opp.breaks} breaks · {opp.possessions} possessions
      </div>
    </div>
  )
}
