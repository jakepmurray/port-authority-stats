import { useMemo, useState } from 'react'
import type { Drill, GameRow } from '../../domain/dashboard'
import { connRows, DEFAULT_CONN, genderSplit, passMatrix, topConnections, type ConnFilter, type PairStat } from '../../domain/connections'
import type { Player } from '../../domain/schema'
import { Btn, Input, Select } from '../kit'

export type ConnMetric = 'completions' | 'turnovers' | 'pct'
type ConnView = 'matrix' | 'top' | 'gender'

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`)
const GENDER = { W: 'WMP', M: 'MMP' } as const

/** Cell colour: blue by count (completions), red by count (turnovers), red→green for completion %. */
function shade(p: PairStat, metric: ConnMetric, max: { completions: number; turnovers: number }) {
  if (metric === 'pct') {
    const v = p.pct ?? 0
    return `hsla(${Math.round(v * 120)}, 70%, 40%, ${0.35 + 0.5 * Math.min(1, p.attempts / 6)})`
  }
  const n = metric === 'completions' ? p.completions : p.turnovers
  const m = metric === 'completions' ? max.completions : max.turnovers
  if (!n || !m) return 'transparent'
  return metric === 'completions' ? `rgba(78,159,229,${0.15 + 0.85 * (n / m)})` : `rgba(232,106,106,${0.2 + 0.8 * (n / m)})`
}
const cellText = (p: PairStat, metric: ConnMetric) => (metric === 'completions' ? p.completions || '' : metric === 'turnovers' ? p.turnovers || '' : pct(p.pct))

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-slate-700">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`px-2 py-0.5 text-xs ${value === v ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

const SMALL = () => typeof window !== 'undefined' && window.innerWidth < 640

/**
 * Who throws to whom: thrower × receiver matrix (most-used first), top connections and
 * a gender-match split. The dashboard filters (games, O/D points, tags) apply; this card
 * adds opponent, players on the line and a minimum number of throws. Tap a cell for the throws.
 */
export function ConnectionsCard({ rows, byId, onPick }: { rows: GameRow[]; byId: Map<string, Player>; onPick: (d: Drill) => void }) {
  const [metric, setMetric] = useState<ConnMetric>('completions')
  const [view, setView] = useState<ConnView>('matrix')
  const [conn, setConn] = useState<ConnFilter>(DEFAULT_CONN)
  const [min, setMin] = useState(1)
  const [all, setAll] = useState(() => !SMALL())
  const opponents = useMemo(() => [...new Set(rows.map((r) => r.game.opponent.trim()))].sort(), [rows])
  const onLine = useMemo(() => {
    const ids = new Set(rows.flatMap((r) => r.points.flatMap((p) => p.line)))
    return [...ids].map((id) => byId.get(id)).filter((p): p is Player => !!p).sort((a, b) => Number(a.number) - Number(b.number))
  }, [rows, byId])
  const m = useMemo(() => passMatrix(connRows(rows, conn)), [rows, conn])
  const N = all ? Infinity : 8
  const throwers = m.throwers.slice(0, N)
  const receivers = m.receivers.slice(0, N)
  const cell = new Map(m.pairs.map((p) => [`${p.thrower}>${p.receiver}`, p]))
  const name = (id: string) => byId.get(id)?.name ?? '?'
  const short = (id: string) => {
    const p = byId.get(id)
    return p ? `#${p.number} ${p.name.split(' ')[0]}` : '?'
  }
  const outcome = metric === 'completions' ? ('completion' as const) : metric === 'turnovers' ? ('turnover' as const) : undefined
  const pick = (thrower: string | null, receiver: string | null) => onPick({ kind: 'pair', thrower, receiver, outcome, conn })
  const top = topConnections(m, 10, min)
  const split = genderSplit(m, (id) => byId.get(id)?.gender_match)
  const hidden = m.throwers.length - throwers.length + (m.receivers.length - receivers.length)

  return (
    <div className="flex flex-col gap-2" data-testid="connections">
      <div className="flex flex-wrap items-center gap-2">
        <Seg label="Connections view" value={view} onChange={setView} options={[['matrix', 'Matrix'], ['top', 'Top pairs'], ['gender', 'By gender']]} />
        <Seg label="Show" value={metric} onChange={setMetric} options={[['completions', 'Completions'], ['turnovers', 'Turnovers'], ['pct', 'Comp %']]} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Select aria-label="Opponent" value={conn.opponent} onChange={(e) => setConn({ ...conn, opponent: e.target.value })} className="max-w-[10rem] py-0.5 text-xs">
          <option value="">All opponents</option>
          {opponents.map((o) => <option key={o}>{o}</option>)}
        </Select>
        <Select
          aria-label="On the line"
          value=""
          onChange={(e) => e.target.value && setConn({ ...conn, line: [...conn.line, e.target.value] })}
          className="max-w-[10rem] py-0.5 text-xs"
        >
          <option value="">{conn.line.length ? 'Add player…' : 'Any line'}</option>
          {onLine.filter((p) => !conn.line.includes(p.id)).map((p) => <option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
        </Select>
        {conn.line.map((id) => (
          <button key={id} type="button" className="rounded-full border border-sky-400 bg-sky-500/20 px-2 py-0.5 text-sky-100" onClick={() => setConn({ ...conn, line: conn.line.filter((x) => x !== id) })} title="Remove">
            on line: {short(id)} ✕
          </button>
        ))}
        <label className="flex items-center gap-1 text-slate-400">
          Min throws
          <Input aria-label="Min throws" type="number" min={1} value={min} onChange={(e) => setMin(Math.max(1, Number(e.target.value) || 1))} className="w-14 py-0.5 text-xs" />
        </label>
      </div>

      {!m.pairs.length ? (
        <p className="py-6 text-center text-sm text-slate-500">No throws with both thrower and receiver in view.</p>
      ) : view === 'matrix' ? (
        <>
          <div className="max-h-[60vh] overflow-auto" data-testid="pass-matrix">
            <table className="border-separate border-spacing-0.5 text-[11px] tabular-nums">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 bg-slate-900 p-1 text-left text-slate-500">Thrower ↓ / to →</th>
                  {receivers.map((r) => (
                    <th key={r.id} className="sticky top-0 z-10 bg-slate-900 p-1 font-normal text-slate-400" title={`${name(r.id)}: ${r.n} throws to`}>
                      <button type="button" className="whitespace-nowrap hover:text-sky-300" onClick={() => pick(null, r.id)}>{short(r.id)}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {throwers.map((t) => (
                  <tr key={t.id}>
                    <th className="sticky left-0 z-10 bg-slate-900 p-1 text-left font-normal text-slate-300" title={`${name(t.id)}: ${t.n} throws`}>
                      <button type="button" className="whitespace-nowrap hover:text-sky-300" onClick={() => pick(t.id, null)}>{short(t.id)}</button>
                    </th>
                    {receivers.map((r) => {
                      const p = cell.get(`${t.id}>${r.id}`)
                      if (!p || p.attempts < min) return <td key={r.id} className="h-7 min-w-9 rounded bg-slate-950/60" />
                      return (
                        <td key={r.id} className="p-0">
                          <button
                            type="button"
                            className="h-7 w-full min-w-9 rounded px-1 text-slate-50 hover:ring-1 hover:ring-sky-300"
                            style={{ background: shade(p, metric, m.max) }}
                            title={`${name(t.id)} → ${name(r.id)}: ${p.completions}/${p.attempts} complete (${pct(p.pct)}), ${p.turnovers} turnover${p.turnovers === 1 ? '' : 's'}`}
                            aria-label={`${name(t.id)} to ${name(r.id)}: ${p.completions} of ${p.attempts}`}
                            onClick={() => pick(t.id, r.id)}
                          >
                            {cellText(p, metric)}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(hidden > 0 || all) && m.throwers.length + m.receivers.length > 16 && (
            <Btn size="sm" tone="ghost" onClick={() => setAll(!all)}>{all ? 'Show top 8 only' : `Show everyone (${hidden} more)`}</Btn>
          )}
        </>
      ) : view === 'top' ? (
        <ol className="flex flex-col divide-y divide-slate-800 text-sm" data-testid="top-connections">
          {top.map((p, i) => (
            <li key={`${p.thrower}>${p.receiver}`}>
              <button type="button" className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-slate-800/50" onClick={() => onPick({ kind: 'pair', thrower: p.thrower, receiver: p.receiver, conn })}>
                <span className="w-5 text-right text-xs text-slate-500">{i + 1}</span>
                <span className="flex-1">{name(p.thrower)} → {name(p.receiver)}</span>
                <span className="tabular-nums text-slate-300">{p.completions}/{p.attempts}</span>
                <span className="w-10 text-right tabular-nums text-slate-400">{pct(p.pct)}</span>
              </button>
            </li>
          ))}
          {!top.length && <li className="py-2 text-xs text-slate-500">No pair with {min}+ throws.</li>}
        </ol>
      ) : (
        <table className="w-full text-sm tabular-nums" data-testid="gender-split">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="p-1 text-left">Throw</th>
              <th className="p-1 text-right">Cmp</th>
              <th className="p-1 text-right">TO</th>
              <th className="p-1 text-right">Cmp %</th>
              <th className="p-1 text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {split.map((c) => (
              <tr key={c.key} className="border-t border-slate-800">
                <td className="p-1">{GENDER[c.from]} → {GENDER[c.to]}</td>
                <td className="p-1 text-right">{c.completions}</td>
                <td className="p-1 text-right">{c.turnovers}</td>
                <td className="p-1 text-right">{pct(c.pct)}</td>
                <td className="p-1 text-right">{pct(c.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
