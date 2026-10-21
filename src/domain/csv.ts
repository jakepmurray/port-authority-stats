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

/** Parse RFC 4180 CSV (quoted fields, "" escapes, CRLF or LF, optional BOM) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}
