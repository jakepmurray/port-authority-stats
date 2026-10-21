/** 75.4 → "1:15"; 3725 → "1:02:05". */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–'
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Parse "1:15", "1:02:05", "75" or "75.5" into seconds. Empty → null. Invalid → NaN. */
export function parseClock(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  const parts = t.split(':')
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}
