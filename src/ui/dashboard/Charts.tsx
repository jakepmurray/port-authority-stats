import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import { rankFitLine as fitLine, type Kpi, type LeaderRow, type RankPoint, type StackRow } from '../../domain/dashboard'
import type { Player } from '../../domain/schema'
import { AXIS, BREAK, GRID, HOLD, pctTick, stackColor, tooltipStyle } from './palette'

const fmtVal = (k: Kpi, v: number | null) =>
  v === null ? '–' : k.format === 'pct' || k.format === 'record' ? `${Math.round(v * 100)}%` : k.format === 'int' ? `${v > 0 ? '+' : ''}${v}` : v.toFixed(2)

/** Tiny inline trend line (no axes), one dot per game. */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null)
  if (pts.length < 2) return <div className="h-6" />
  const w = 96
  const h = 24
  const min = Math.min(...pts.map((p) => p.v))
  const max = Math.max(...pts.map((p) => p.v))
  const x = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 4) + 2)
  const y = (v: number) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6))
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const last = pts.at(-1)!
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <path d={d} fill="none" stroke="#7dd3fc" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.5} fill="#7dd3fc" />
    </svg>
  )
}

export function KpiCard({ k, onClick, className = '' }: { k: Kpi; onClick?: () => void; className?: string }) {
  const up = k.delta !== null && k.delta > 0.0001
  const down = k.delta !== null && k.delta < -0.0001
  const better = (up && k.higherIsBetter) || (down && !k.higherIsBetter)
  const worse = (down && k.higherIsBetter) || (up && !k.higherIsBetter)
  const deltaText =
    k.delta === null ? null : k.format === 'pct' ? `${k.delta > 0 ? '+' : ''}${Math.round(k.delta * 100)} pts` : `${k.delta > 0 ? '+' : ''}${k.format === 'int' ? k.delta.toFixed(1) : k.delta.toFixed(2)}`
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={k.hint}
      data-testid={`kpi-${k.key}`}
      className={`${className} flex min-w-0 flex-col gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-left ${onClick ? 'hover:border-slate-600' : ''}`}
    >
      <span className="text-xs text-slate-400">{k.label}</span>
      <span className="text-2xl font-bold tabular-nums text-slate-50">{k.display}</span>
      <div className="flex items-end justify-between gap-1">
        <Sparkline values={k.series} />
        {deltaText && (
          <span className={`text-[11px] tabular-nums ${better ? 'text-emerald-300' : worse ? 'text-rose-300' : 'text-slate-400'}`} title="Last 3 games vs the games before">
            {up ? '▲' : down ? '▼' : '•'} {deltaText}
          </span>
        )}
      </div>
      <span className="sr-only">Per game: {k.series.map((v) => fmtVal(k, v)).join(', ')}</span>
    </Tag>
  )
}

export function TrendChart({ data, onPick }: { data: { id: string; label: string; hold: number | null; break: number | null; o: number; d: number }[]; onPick: (id: string, side: 'O' | 'D') => void }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
        <YAxis domain={[0, 1]} tickFormatter={pctTick} tick={{ fill: AXIS, fontSize: 11 }} ticks={[0, 0.25, 0.5, 0.75, 1]} />
        <Tooltip {...tooltipStyle} formatter={(v, name, item) => [`${pctTick(Number(v))} (${name === 'Hold %' ? item.payload.o : item.payload.d} pts)`, name]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" name="Hold %" dataKey="hold" stroke={HOLD} strokeWidth={2} connectNulls dot={{ r: 3 }}
          activeDot={{ r: 6, cursor: 'pointer', onClick: (_e: unknown, p: unknown) => onPick((p as { payload: { id: string } }).payload.id, 'O') }} />
        <Line type="monotone" name="Break %" dataKey="break" stroke={BREAK} strokeWidth={2} connectNulls dot={{ r: 3 }}
          activeDot={{ r: 6, cursor: 'pointer', onClick: (_e: unknown, p: unknown) => onPick((p as { payload: { id: string } }).payload.id, 'D') }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Horizontal stacked bars (one row per category), each segment clickable. */
export function StackedBars({ rows, stacks, label, onPick, height }: { rows: StackRow[]; stacks: string[]; label?: (s: string) => string; onPick: (row: string, stack: string) => void; height?: number }) {
  const h = height ?? Math.max(120, rows.length * 34 + 56)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} />
        <YAxis type="category" dataKey="label" width={84} tick={{ fill: AXIS, fontSize: 11 }} />
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (label ? label(String(v)) : v)} />
        {stacks.map((s, i) => (
          <Bar key={s} dataKey={s} name={s} stackId="a" fill={stackColor(s, i)} cursor="pointer" onClick={(d) => onPick(String((d as unknown as { payload: StackRow }).payload.key), s)}>
            {i === stacks.length - 1 && <LabelList dataKey="total" position="right" fill={AXIS} fontSize={11} />}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function RatioChart({ rows }: { rows: { label: string; hold: number | null; break: number | null; o: number; d: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows} margin={{ top: 16, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 12 }} />
        <YAxis domain={[0, 1]} tickFormatter={pctTick} tick={{ fill: AXIS, fontSize: 11 }} ticks={[0, 0.5, 1]} />
        <Tooltip {...tooltipStyle} formatter={(v, name, item) => [v === null || v === undefined ? '–' : `${pctTick(Number(v))} of ${name === 'Hold %' ? item.payload.o : item.payload.d}`, name]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="hold" name="Hold %" fill={HOLD} radius={[4, 4, 0, 0]}>
          <LabelList dataKey="hold" position="top" formatter={(v: unknown) => (v === null || v === undefined ? '' : pctTick(Number(v)))} fill={AXIS} fontSize={11} />
        </Bar>
        <Bar dataKey="break" name="Break %" fill={BREAK} radius={[4, 4, 0, 0]}>
          <LabelList dataKey="break" position="top" formatter={(v: unknown) => (v === null || v === undefined ? '' : pctTick(Number(v)))} fill={AXIS} fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Hold % and break % per game against the opponent's USAU rank (1 = strongest, on the left), with optional trend lines. */
export function RankChart({ points, trend, onPick }: { points: RankPoint[]; trend: boolean; onPick: (id: string, side: 'O' | 'D') => void }) {
  const hold = points.filter((p) => p.hold !== null).map((p) => ({ ...p, x: p.rank, y: p.hold as number, n: p.o, side: 'O' as const }))
  const brk = points.filter((p) => p.break !== null).map((p) => ({ ...p, x: p.rank, y: p.break as number, n: p.d, side: 'D' as const }))
  const hl = trend ? fitLine(points, 'hold') : null
  const bl = trend ? fitLine(points, 'break') : null
  const pick = (d: unknown) => {
    const p = ((d as { payload?: { id: string; side: 'O' | 'D' } }).payload ?? d) as { id: string; side: 'O' | 'D' }
    onPick(p.id, p.side)
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: -10 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis type="number" dataKey="x" name="Opponent rank" domain={[1, 'dataMax']} allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }}
          label={{ value: 'Opponent USAU rank (1 = strongest)', position: 'insideBottom', offset: -10, fill: AXIS, fontSize: 11 }} />
        <YAxis type="number" dataKey="y" domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={pctTick} tick={{ fill: AXIS, fontSize: 11 }} allowDataOverflow />
        <Tooltip
          {...tooltipStyle}
          cursor={{ strokeDasharray: '3 3' }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as (typeof hold)[number] | undefined
            if (!p || !('label' in p)) return null
            return (
              <div style={tooltipStyle.contentStyle} className="px-2 py-1">
                <b>{p.label}</b> (#{p.rank})
                <div>{p.side === 'O' ? 'Hold' : 'Break'}: {pctTick(p.y)} of {p.n} pts</div>
              </div>
            )
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Scatter name="Hold %" data={hold} fill={HOLD} cursor="pointer" onClick={pick} />
        <Scatter name="Break %" data={brk} fill={BREAK} shape="diamond" cursor="pointer" onClick={pick} />
        {hl && <Scatter name="Hold trend" data={hl.line} line={{ stroke: HOLD, strokeDasharray: '5 4' }} shape={() => <g />} legendType="none" isAnimationActive={false} />}
        {bl && <Scatter name="Break trend" data={bl.line} line={{ stroke: BREAK, strokeDasharray: '5 4' }} shape={() => <g />} legendType="none" isAnimationActive={false} />}
      </ScatterChart>
    </ResponsiveContainer>
  )
}

export type ScatterMode = 'usage' | 'pm'

export function PlayerScatter({ rows, mode, byId, onPick }: { rows: LeaderRow[]; mode: ScatterMode; byId: Map<string, Player>; onPick: (id: string) => void }) {
  const data = rows
    .filter((r) => (mode === 'usage' ? r.throw_attempts > 0 : true))
    .map((r) => ({
      id: r.player_id,
      name: byId.get(r.player_id)?.name ?? '?',
      x: mode === 'usage' ? r.usage : r.points,
      y: mode === 'usage' ? (r.comp_pct ?? 0) : r.per_point.plus_minus,
      z: r.points,
      g: byId.get(r.player_id)?.gender_match,
    }))
  const xLabel = mode === 'usage' ? 'Throws per point' : 'Points played'
  const yLabel = mode === 'usage' ? 'Completion %' : '+/- per point'
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: -10 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis type="number" dataKey="x" name={xLabel} tick={{ fill: AXIS, fontSize: 11 }} tickFormatter={(v) => (mode === 'usage' ? Number(v).toFixed(1) : String(v))}
          label={{ value: xLabel, position: 'insideBottom', offset: -10, fill: AXIS, fontSize: 11 }} />
        <YAxis type="number" dataKey="y" name={yLabel} tick={{ fill: AXIS, fontSize: 11 }} tickFormatter={(v) => (mode === 'usage' ? pctTick(Number(v)) : Number(v).toFixed(1))}
          domain={mode === 'usage' ? [(min: number) => Math.max(0, Math.floor(min * 10) / 10), 1] : ['auto', 'auto']} />
        <ZAxis type="number" dataKey="z" range={[30, 220]} name="Points" />
        <Tooltip
          {...tooltipStyle}
          cursor={{ strokeDasharray: '3 3' }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as (typeof data)[number] | undefined
            if (!p) return null
            return (
              <div style={tooltipStyle.contentStyle} className="px-2 py-1">
                <b>{p.name}</b>
                <div>{xLabel}: {mode === 'usage' ? p.x.toFixed(2) : p.x}</div>
                <div>{yLabel}: {mode === 'usage' ? pctTick(p.y) : p.y.toFixed(2)}</div>
                <div>{p.z} points</div>
              </div>
            )
          }}
        />
        <Scatter data={data} cursor="pointer" onClick={(d) => onPick(String((d as unknown as { payload: { id: string } }).payload?.id ?? (d as unknown as { id: string }).id))}>
          {data.map((d) => <Cell key={d.id} fill={d.g === 'W' ? '#f08bc0' : '#4e9fe5'} fillOpacity={0.8} />)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  )
}

/** Field zones (110 yd long, drawn with y = 110 at the top), end-zone lines dashed. */
export function Heatmap({ grid, max, label }: { grid: number[][]; max: number; label: string }) {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  return (
    <svg viewBox={`0 0 ${cols * 20} ${rows * 20}`} className="mx-auto h-72 w-auto" role="img" aria-label={label}>
      {[...grid].reverse().map((r, i) =>
        r.map((v, j) => (
          <g key={`${i}-${j}`}>
            <rect x={j * 20} y={i * 20} width={20} height={20} fill={v ? `rgba(78,159,229,${0.15 + 0.85 * (v / max)})` : '#0f172a'} stroke="#1e293b" />
            {v > 0 && <text x={j * 20 + 10} y={i * 20 + 13} textAnchor="middle" fontSize={8} fill="#e2e8f0">{v}</text>}
          </g>
        )),
      )}
      <line x1={0} x2={cols * 20} y1={rows * 20 * (20 / 110)} y2={rows * 20 * (20 / 110)} stroke="#64748b" strokeDasharray="3 2" />
      <line x1={0} x2={cols * 20} y1={rows * 20 * (90 / 110)} y2={rows * 20 * (90 / 110)} stroke="#64748b" strokeDasharray="3 2" />
    </svg>
  )
}
