import { describe, expect, it } from 'vitest'
import getPage from '../domain/__fixtures__/usau/rankings-club-mixed-get.html?raw'
import viewAll from '../domain/__fixtures__/usau/rankings-club-mixed-viewall.html?raw'
import { fetchUsauRanks, SyncError, usauFetchMessage, type FetchFn } from './client'
import { addTaker, loadGas, post } from './gasMock'

/** Real USAU responses (Club Mixed, Oct 2026): the first page (20 rows) and the "View All" postback (214 rows). */
const ready = () => {
  const gas = loadGas()
  gas.setup()
  return { gas, admin: gas.logs.at(-1)! }
}
const usau = (gas: ReturnType<typeof loadGas>) => {
  gas.http.queue.push({ body: getPage, cookies: ['ASP.NET_SessionId=abc123; path=/; HttpOnly; SameSite=Lax'] }, { body: viewAll })
}

describe('Apps Script v6: usau_ranks (Fetch ranks)', () => {
  it('GETs the page, POSTs it back as "View All", and parses every ranked team', () => {
    const { gas, admin } = ready()
    usau(gas)
    const locks = gas.locks
    const r = post(gas, { action: 'usau_ranks', token: admin })
    expect(r).toMatchObject({ ok: true, version: 6, kind: 'usau_ranks', division: 'Mixed', rank_set: 'Club-Mixed', cached: false, total: 214 })
    expect(r.source_url).toBe('https://play.usaultimate.org/teams/events/team_rankings/?RankSet=Club-Mixed')
    expect(r.teams).toHaveLength(214)
    expect(r.teams.slice(0, 5).map((t: { rank: number; team: string; rating: number }) => `${t.rank} ${t.team} ${t.rating}`)).toEqual([
      '1 Hybrid 2163', '2 XIST 2101', '3 Slow 1994', '4 Austin Disco Club 1981', '5 AMP 1918',
    ])
    expect(r.teams[0]).toEqual({ rank: 1, team: 'Hybrid', rating: 2163, gender: 'Mixed', level: 'Pro', city: 'Ann Arbor', state: 'MI', region: 'Great Lakes', section: 'East Plains', wins: 25, losses: 3 })
    expect(r.teams.map((t: { team: string }) => t.team)).toContain('Odyssée') // &#233; decoded
    expect(r.teams.map((t: { rank: number }) => t.rank)).toEqual(Array.from({ length: 214 }, (_, i) => i + 1))
    expect(gas.locks).toBe(locks) // a web fetch never holds the Sheet lock

    const [g, p] = gas.http.calls
    expect(gas.http.calls).toHaveLength(2)
    expect(g.options.method).toBe('get')
    expect(g.options.headers!['User-Agent']).toMatch(/^Mozilla\/5\.0/)
    expect(p.options.method).toBe('post')
    expect(p.url).toBe(g.url)
    expect(p.options.contentType).toBe('application/x-www-form-urlencoded')
    expect(p.options.headers!.Cookie).toBe('ASP.NET_SessionId=abc123')
    const form = new URLSearchParams(p.options.payload)
    expect(form.get('__EVENTTARGET')).toBe('CT_Main_0$lnkViewAll')
    expect(form.get('__VIEWSTATE')).toBe('VIEWSTATE_FIXTURE')
    expect(form.get('__EVENTVALIDATION')).toBe('EVENTVALIDATION_FIXTURE')
    expect(form.get('CT_Main_0$F_CompetitionDivisionId')).toBe('') // no filter: every team
  })

  it('caches the list for 6 hours: the next click does not touch USAU', () => {
    const { gas, admin } = ready()
    usau(gas)
    post(gas, { action: 'usau_ranks', token: admin })
    expect(gas.cache.get('usau_ranks:Club-Mixed')!.seconds).toBe(21600)
    const again = post(gas, { action: 'usau_ranks', token: admin })
    expect(again).toMatchObject({ ok: true, cached: true, total: 214 })
    expect(again.teams).toHaveLength(214)
    expect(gas.http.calls).toHaveLength(2)
  })

  it('any valid key works (stat-takers too); bad keys and divisions fetch nothing', () => {
    const { gas } = ready()
    const sam = addTaker(gas, 'Sam')
    expect(post(gas, { action: 'usau_ranks', token: 'nope' })).toMatchObject({ ok: false, error: 'bad_token' })
    expect(post(gas, { action: 'usau_ranks', token: sam.key, division: 'Open' })).toMatchObject({ ok: false, error: 'bad_division' })
    expect(gas.http.calls).toHaveLength(0)
    gas.http.queue.push({ body: viewAll }) // a page that already shows every row: one request
    expect(post(gas, { action: 'usau_ranks', token: sam.key, division: 'Women' })).toMatchObject({ ok: true, rank_set: 'Club-Women', total: 214 })
    expect(gas.http.calls.map((c) => c.url)).toEqual(['https://play.usaultimate.org/teams/events/team_rankings/?RankSet=Club-Women'])
  })

  it('reports fetch and parse failures (nothing cached)', () => {
    const { gas, admin } = ready()
    gas.http.queue.push({ code: 503, body: 'down' })
    expect(post(gas, { action: 'usau_ranks', token: admin })).toMatchObject({ ok: false, error: 'usau_fetch', message: expect.stringContaining('HTTP 503') })
    gas.http.queue.push(new Error('You do not have permission to call UrlFetchApp.fetch'))
    expect(post(gas, { action: 'usau_ranks', token: admin })).toMatchObject({ ok: false, error: 'usau_fetch', message: expect.stringContaining('permission') })
    gas.http.queue.push({ body: '<html><body>New site!</body></html>' })
    expect(post(gas, { action: 'usau_ranks', token: admin })).toMatchObject({ ok: false, error: 'usau_parse' })
    expect(gas.cache.size).toBe(0)
  })

  it('testUsauRanks() (editor / menu) fetches and logs the top teams', () => {
    const { gas } = ready()
    usau(gas)
    expect(gas.testUsauRanks()).toMatchObject({ ok: true })
    expect(gas.logs.at(-1)).toMatch(/read 214 of 214 teams\.\n1\. Hybrid \(2163\)\n2\. XIST/)
    gas.onOpen()
    expect(gas.ui.menu).toContain('Test USAU ranks fetch=testUsauRanks')
  })
})

describe('client: fetchUsauRanks', () => {
  const URL_OK = 'https://script.google.com/macros/s/AKfyc_test/exec'
  const viaGas = (gas: ReturnType<typeof loadGas>): FetchFn => async (_u, init) =>
    new Response(gas.doPost({ postData: { contents: init.body as string, type: 'text/plain' } }).text)

  it('returns the teams for the review, end to end through the script', async () => {
    const { gas, admin } = ready()
    usau(gas)
    const r = await fetchUsauRanks(viaGas(gas), URL_OK, admin, 'Mixed')
    expect(r.teams).toHaveLength(214)
    expect(r.teams[3]).toEqual({ rank: 4, name: 'Austin Disco Club', rating: 1981 })
    expect(r).toMatchObject({ total: 214, cached: false, sourceUrl: expect.stringContaining('Club-Mixed') })
  })

  it('explains an older script, a missing permission, and a parse failure', async () => {
    const old: FetchFn = async () => new Response(JSON.stringify({ ok: false, error: 'unknown_action', message: 'Unknown action: usau_ranks' }))
    const e1 = await fetchUsauRanks(old, URL_OK, 'k').catch((e) => e)
    expect(e1).toBeInstanceOf(SyncError)
    expect(usauFetchMessage(e1)).toMatch(/older than version 6/)
    const { gas, admin } = ready()
    gas.http.queue.push(new Error('You do not have permission to call UrlFetchApp.fetch'))
    expect(usauFetchMessage(await fetchUsauRanks(viaGas(gas), URL_OK, admin).catch((e) => e))).toMatch(/testUsauRanks\(\)/)
    const html: FetchFn = async () => new Response('<!DOCTYPE html><html>Authorization is needed</html>')
    expect(usauFetchMessage(await fetchUsauRanks(html, URL_OK, 'k').catch((e) => e))).toMatch(/approve the new permission/)
    gas.http.queue.push({ body: '<html></html>' })
    expect(usauFetchMessage(await fetchUsauRanks(viaGas(gas), URL_OK, admin).catch((e) => e))).toMatch(/no ranking rows/)
  })
})
