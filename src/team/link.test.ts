import { describe, expect, it } from 'vitest'
import { isTeamHash, resolveSrc, snapshotUrl, srcFromHash, teamLink } from './link'

const SRC = 'https://script.google.com/macros/s/AKfyc_x/exec'
const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage
}

describe('team view link', () => {
  it('has the format <app>/#/team?src=<encoded /exec URL> and round-trips', () => {
    const link = teamLink('https://jakepmurray.github.io/port-authority-stats/', SRC)
    expect(link).toBe('https://jakepmurray.github.io/port-authority-stats/#/team?src=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2FAKfyc_x%2Fexec')
    expect(srcFromHash(new URL(link).hash)).toBe(SRC)
    expect(snapshotUrl(SRC)).toBe(`${SRC}?action=snapshot`)
  })

  it('recognises team routes only', () => {
    for (const h of ['#/team', '#/team?src=x', '#/team/dashboard', '#team']) expect(isTeamHash(h)).toBe(true)
    for (const h of ['', '#/', '#/teams', '#/dashboard', '#/game/team']) expect(isTeamHash(h)).toBe(false)
  })

  it('remembers the source from the link; ignores anything but an Apps Script /exec URL', () => {
    const s = mem()
    expect(resolveSrc(`#/team?src=${encodeURIComponent(SRC)}`, s)).toBe(SRC)
    expect(resolveSrc('#/team/dashboard', s)).toBe(SRC)
    expect(resolveSrc(`#/team?src=${encodeURIComponent('http://evil.example/x')}`, s)).toBe(SRC)
    expect(resolveSrc(`#/team?src=${encodeURIComponent('https://evil.example/macros/s/x/exec')}`, s)).toBe(SRC)
    expect(resolveSrc('#/team', mem())).toBeNull()
    // dashboard links: `src` is the film/live/import filter there, the source rides in team_src
    expect(srcFromHash(`#/team/dashboard?src=film&team_src=${encodeURIComponent(SRC)}`)).toBe(SRC)
    expect(srcFromHash('#/team/dashboard?src=film')).toBeNull()
  })
})
