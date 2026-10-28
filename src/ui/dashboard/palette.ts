import { UNTAGGED } from '../../domain/dashboard'

/** Colour-blind-friendly-ish set on a dark background (Tableau 10, slightly lifted). */
export const SERIES = ['#4e9fe5', '#f5a03a', '#59c27a', '#e86a6a', '#a98be0', '#43c3c0', '#f08bc0', '#c7c055', '#b59a83', '#9aa7b8']
export const HOLD = '#4e9fe5'
export const BREAK = '#f5a03a'
export const GRID = '#1e293b'
export const AXIS = '#94a3b8'

export function stackColor(stack: string, i: number) {
  return stack === UNTAGGED ? '#475569' : SERIES[i % SERIES.length]
}

export const tooltipStyle = {
  contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12, color: '#e2e8f0' },
  labelStyle: { color: '#e2e8f0', fontWeight: 600 },
  itemStyle: { padding: 0 },
  cursor: { fill: 'rgba(148,163,184,0.08)' },
}

export const pctTick = (v: number) => `${Math.round(v * 100)}%`
