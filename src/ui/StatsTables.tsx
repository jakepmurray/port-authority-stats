import { useState } from 'react'
import type { Player } from '../domain/schema'
import { tagTotals, type OpponentStats, type PlayerStats, type TagBreakdown, type TeamStats } from '../domain/stats'
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
  let cols = showYards
    ? [...COLS, { key: 'throw_yards', label: 'TYd', title: 'Throwing yards' } as Col, { key: 'recv_yards', label: 'RYd', title: 'Receiving yards' } as Col]
    : COLS
  if (stats.some((s) => s.points_missed > 0))
    cols = [...cols.slice(0, 3), { key: 'points_missed', label: 'Miss', title: 'Points on the line but missed on film (not in Pts)' } as Col, ...cols.slice(3)]
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
        {team.points_missed > 0 &&
          cell('Missed on film', team.points_missed, 'Points with a hand-entered result. In the score and holds/breaks; not in player stats or per-point rates.')}
      </div>
      <div className="text-xs text-slate-400">
        <span className="font-semibold text-slate-300">{opponent}</span> (team totals): {opp.goals} goals · {opp.turnovers} turns · {opp.ds} Ds ·{' '}
        {opp.callahans} Callahans · {opp.holds} holds · {opp.breaks} breaks · {opp.possessions} possessions
      </div>
    </div>
  )
}

const TYPE_SHORT: Record<string, string> = { throwaway: 'TA', drop: 'drop', stall: 'stall', turnover: 'other', D: 'their D', callahan: 'Callahan' }
const byType = (row: Record<string, number> | undefined, theirs = false) =>
  row ? Object.entries(row).map(([k, v]) => `${v} ${theirs && k === 'D' ? 'our D' : (TYPE_SHORT[k] ?? k)}`).join(', ') : ''

/** Turnovers broken down by tag: ours by type and player, theirs at team level. */
export function TagBreakdownTable({
  team, opp, players, byId, opponent,
}: { team: TeamStats; opp: OpponentStats; players: PlayerStats[]; byId: Map<string, Player>; opponent: string }) {
  const all: TagBreakdown = {}
  for (const b of [team.turnover_tags, opp.turnover_tags]) for (const t of Object.keys(b)) all[t] ??= {}
  const tags = Object.keys(all).sort(
    (a, b) => (tagTotals(team.turnover_tags).find((x) => x[0] === b)?.[1] ?? 0) - (tagTotals(team.turnover_tags).find((x) => x[0] === a)?.[1] ?? 0) || a.localeCompare(b),
  )
  if (tags.length === 0) return <p className="text-xs text-slate-500">No tagged turnovers yet. Tags (receiver error, wind…) add context; they don’t change who is charged.</p>
  const total = (row: Record<string, number> | undefined) => (row ? Object.values(row).reduce((a, c) => a + c, 0) : 0)
  return (
    <div className="overflow-x-auto">
      <div className="mb-1 text-xs text-slate-400">Turnovers by tag (context only; each turnover is still charged as usual)</div>
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-slate-900 text-slate-400">
          <tr>
            <th className="p-1 text-left">Tag</th>
            <th className="p-1 text-right">Our turns</th>
            <th className="p-1 text-left">By type</th>
            <th className="p-1 text-left">By player</th>
            <th className="p-1 text-right">{opponent} turns</th>
          </tr>
        </thead>
        <tbody>
          {tags.map((t) => {
            const who = players
              .filter((p) => total(p.turnover_tags[t]) > 0)
              .sort((a, b) => total(b.turnover_tags[t]) - total(a.turnover_tags[t]))
              .map((p) => `#${byId.get(p.player_id)?.number ?? '?'} ${byId.get(p.player_id)?.name ?? ''} ${byType(p.turnover_tags[t])}`)
            return (
              <tr key={t} className="border-t border-slate-800 align-top">
                <td className="whitespace-nowrap p-1">{t}</td>
                <td className="p-1 text-right">{total(team.turnover_tags[t])}</td>
                <td className="p-1">{byType(team.turnover_tags[t])}</td>
                <td className="p-1">{who.join(' · ')}</td>
                <td className="p-1 text-right" title={byType(opp.turnover_tags[t], true)}>{total(opp.turnover_tags[t])}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
