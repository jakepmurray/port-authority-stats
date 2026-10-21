/** Extract an 11-char YouTube video id from a URL or a bare id. Returns null if none. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  let url: URL
  try {
    url = new URL(s.startsWith('http') ? s : `https://${s}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else {
      const m = url.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})/)
      if (m) id = m[2]
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null
}

/** Start time from a YouTube URL (?t=90, ?t=1m30s, &start=90), in seconds. */
export function parseYouTubeStart(input: string): number | null {
  try {
    const url = new URL(input.trim())
    const t = url.searchParams.get('t') ?? url.searchParams.get('start')
    if (!t) return null
    if (/^\d+$/.test(t)) return Number(t)
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
    if (!m || !m[0]) return null
    return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  } catch {
    return null
  }
}
