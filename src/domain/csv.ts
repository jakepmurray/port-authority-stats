/** RFC 4180 CSV with a header row. */
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns?: (keyof T & string)[]): string {
  const cols = columns ?? (rows.length ? (Object.keys(rows[0]) as (keyof T & string)[]) : [])
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = Array.isArray(v) ? v.join(';') : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
}
