import { describe, expect, it, vi } from 'vitest'
import { callScript, checkUrl, requestInit, SyncError, testConnection, type FetchFn } from './client'
import { loadGas } from './gasMock'

const URL_OK = 'https://script.google.com/macros/s/AKfyc_test/exec'
const reply = (body: string, status = 200) => Promise.resolve(new Response(body, { status }))

describe('request format (no CORS preflight)', () => {
  it('is a simple POST with text/plain JSON, follows redirects, token in the body', () => {
    const init = requestInit({ action: 'ping' }, 'tok')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' }) // the only header: CORS-safelisted
    expect(init.redirect).toBe('follow')
    expect(init.credentials).toBe('omit')
    expect(JSON.parse(init.body as string)).toEqual({ action: 'ping', token: 'tok' })
  })

  it('sends to the URL as-is (token never in the URL)', async () => {
    const f = vi.fn<FetchFn>(() => reply('{"ok":true}'))
    await callScript(f, URL_OK, 'secret', { action: 'ping' })
    expect(f.mock.calls[0][0]).toBe(URL_OK)
    expect(f.mock.calls[0][0]).not.toContain('secret')
  })
})

describe('callScript errors', () => {
  it('network failure → unreachable (retryable)', async () => {
    const err = await callScript(() => Promise.reject(new TypeError('Failed to fetch')), URL_OK, 't', {}).catch((e) => e)
    expect(err).toBeInstanceOf(SyncError)
    expect(err.failure.kind).toBe('unreachable')
    expect(err.retryable).toBe(true)
  })
  it('an HTML page (login / wrong URL) → not_json, not retryable', async () => {
    const err = await callScript(() => reply('<!DOCTYPE html><html>Sign in</html>'), URL_OK, 't', {}).catch((e) => e)
    expect(err.failure.kind).toBe('not_json')
    expect(err.message).toMatch(/Anyone/)
    expect(err.retryable).toBe(false)
  })
  it('bad token → script error, not retryable; busy → retryable; 5xx → retryable', async () => {
    const bad = await callScript(() => reply('{"ok":false,"error":"bad_token"}'), URL_OK, 't', {}).catch((e) => e)
    expect(bad.failure).toMatchObject({ kind: 'script', error: 'bad_token' })
    expect(bad.retryable).toBe(false)
    const busy = await callScript(() => reply('{"ok":false,"error":"busy"}'), URL_OK, 't', {}).catch((e) => e)
    expect(busy.retryable).toBe(true)
    const down = await callScript(() => reply('oops', 503), URL_OK, 't', {}).catch((e) => e)
    expect(down.failure).toMatchObject({ kind: 'http', status: 503 })
    expect(down.retryable).toBe(true)
  })
})

describe('checkUrl', () => {
  it('accepts /exec, warns on /dev and other hosts, rejects junk', () => {
    expect(checkUrl(URL_OK)).toEqual({ ok: true, warning: null })
    expect(checkUrl('https://script.google.com/macros/s/x/dev').warning).toMatch(/exec/)
    expect(checkUrl('https://example.com/x').warning).toMatch(/testing/)
    expect(checkUrl('http://script.google.com/macros/s/x/exec').ok).toBe(false)
    expect(checkUrl('not a url').ok).toBe(false)
  })
})

describe('testConnection against the real Code.gs (mocked Google services)', () => {
  const viaGas = (gas: ReturnType<typeof loadGas>): FetchFn => async (_u, init) => {
    const out = gas.doPost({ postData: { contents: init.body as string } })
    return new Response(out.text, { status: 200 })
  }

  it('reports reachable + token accepted + tabs created', async () => {
    const gas = loadGas()
    gas.setup()
    const r = await testConnection(viaGas(gas), URL_OK, gas.logs.at(-1)!)
    expect(r).toMatchObject({ ok: true, reachable: true, token: true, version: 2 })
    expect(r.tabs!.map((t) => t.name)).toEqual(['Players', 'Games', 'Points', 'Events', 'Player Stats', 'Game Stats', 'Meta'])
    expect(r.summary).toMatch(/Connected/)
  })

  it('reports a rejected token', async () => {
    const gas = loadGas()
    gas.setup()
    const r = await testConnection(viaGas(gas), URL_OK, 'wrong')
    expect(r).toMatchObject({ ok: false, reachable: true, token: false })
    expect(r.summary).toMatch(/rejected/)
  })

  it('handles unconfigured, bad and unreachable URLs without throwing', async () => {
    const never = vi.fn<FetchFn>()
    expect((await testConnection(never, '', 't')).summary).toMatch(/not a URL/)
    expect((await testConnection(never, URL_OK, '  ')).summary).toMatch(/token/)
    expect(never).not.toHaveBeenCalled()
    const down = await testConnection(() => Promise.reject(new TypeError('Failed to fetch')), URL_OK, 't')
    expect(down).toMatchObject({ ok: false, reachable: false, token: null })
    const html = await testConnection(() => reply('<html>nope</html>'), URL_OK, 't')
    expect(html).toMatchObject({ ok: false, reachable: true, token: null })
  })
})
