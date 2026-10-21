import { useState, useSyncExternalStore } from 'react'
import { sync } from '../../sync'
import { checkUrl, testConnection, type ConnectionReport } from '../../sync/client'
import { clearConfig, loadConfig, saveConfig } from '../../sync/settings'
import { CODE_URL, REDEPLOY_STEPS, SETUP_STEPS } from '../../sync/setupSteps'
import { PUBLISHED_TABS } from '../../sync/sheetRows'
import { Badge, Btn, Card, Field, Input } from '../kit'
import { SyncBadge } from '../SyncBadge'

const time = (t: number | null) =>
  t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never'

function Check({ v, label }: { v: boolean | null; label: string }) {
  return (
    <li className={v === true ? 'text-emerald-300' : v === false ? 'text-rose-300' : 'text-slate-500'}>
      {v === true ? '✓' : v === false ? '✕' : '–'} {label}
    </li>
  )
}

export function Settings() {
  const st = useSyncExternalStore(sync.subscribe, sync.get)
  const saved = loadConfig()
  const [url, setUrl] = useState(saved?.url ?? '')
  const [token, setToken] = useState(saved?.token ?? '')
  const [auto, setAuto] = useState(saved?.auto ?? true)
  const [show, setShow] = useState(false)
  const [report, setReport] = useState<ConnectionReport | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const dirty = url !== (saved?.url ?? '') || token !== (saved?.token ?? '') || auto !== (saved?.auto ?? true)
  const urlCheck = url.trim() ? checkUrl(url.trim()) : null

  const save = () => {
    saveConfig({ url, token, auto })
    sync.reconfigured()
    setMsg({ text: 'Saved in this browser only.' })
  }
  const test = async () => {
    setBusy('test')
    setReport(null)
    try {
      setReport(await testConnection((u, i) => fetch(u, i), url, token))
    } catch (e) {
      setReport({ url: { ok: true, note: null }, reachable: null, token: null, tabs: null, version: null, ok: false, summary: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }
  const run = async (full: boolean) => {
    if (dirty) save()
    setBusy(full ? 'full' : 'sync')
    const r = await sync.syncNow(full)
    setBusy(null)
    setMsg(r.ok ? { text: full ? 'Everything pushed to the Sheet.' : 'Synced.' } : { text: r.error ?? 'Sync failed', bad: true })
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <Card title="Google Sheet sync" actions={<SyncBadge />}>
        <div className="flex flex-col gap-1 text-sm text-slate-300">
          <div>
            Last synced: <span className="text-slate-100">{time(st.lastSyncedAt)}</span> · {st.pending} change{st.pending === 1 ? '' : 's'} waiting
          </div>
          {st.lastError && (
            <div className="text-rose-300">
              Last error: {st.lastError}
              {st.nextRetryAt && ` · retrying at ${new Date(st.nextRetryAt).toLocaleTimeString()}`}
            </div>
          )}
          <p className="text-xs text-slate-400">
            The app pushes to your Sheet a few seconds after each change while you’re online. Offline changes wait and go out
            when you’re back. The app is the source of truth: each game’s rows in the Sheet are replaced with the app’s copy.
          </p>
        </div>
      </Card>

      <Card title="Connection">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Field label="Web app URL" hint={urlCheck?.warning ?? 'From Deploy > Manage deployments; ends in /exec.'}>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/…/exec"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              aria-label="Web app URL"
            />
          </Field>
          <Field label="Token" hint="From the Apps Script Execution log after running setup. Stored only in this browser.">
            <span className="flex gap-1">
              <Input
                type={show ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                aria-label="Token"
                className="flex-1 font-mono"
              />
              <Btn size="sm" tone="ghost" onClick={() => setShow((v) => !v)}>
                {show ? 'Hide' : 'Show'}
              </Btn>
            </span>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Sync automatically after changes
          </label>
          <div className="flex flex-wrap gap-2">
            <Btn tone="primary" type="submit" disabled={!dirty}>
              Save
            </Btn>
            <Btn onClick={() => void test()} disabled={busy !== null}>
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </Btn>
            <Btn onClick={() => void run(false)} disabled={busy !== null || !url.trim() || !token.trim()}>
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </Btn>
            <Btn tone="ghost" onClick={() => void run(true)} disabled={busy !== null || !url.trim() || !token.trim()} title="Re-send every game, player and stat (first sync, or after restoring a backup)">
              {busy === 'full' ? 'Pushing…' : 'Push everything'}
            </Btn>
            <Btn
              tone="ghost"
              className="ml-auto"
              onClick={() => {
                if (!confirm('Forget the URL and token in this browser?')) return
                clearConfig()
                setUrl('')
                setToken('')
                sync.reconfigured()
                setReport(null)
              }}
            >
              Forget
            </Btn>
          </div>
          {msg && <p className={`text-sm ${msg.bad ? 'text-rose-300' : 'text-emerald-300'}`}>{msg.text}</p>}
          {report && (
            <div className="rounded-lg border border-slate-800 bg-black/30 p-3 text-sm" aria-live="polite" data-testid="test-report">
              <p className={report.ok ? 'text-emerald-300' : 'text-amber-200'}>{report.summary}</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                <Check v={report.url.ok} label={`URL looks right${report.url.note ? ` (${report.url.note})` : ''}`} />
                <Check v={report.reachable} label="Script reachable" />
                <Check v={report.token} label="Token accepted" />
                <Check v={report.tabs ? true : null} label="Tabs and headers in place" />
              </ul>
              {report.tabs && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {report.tabs.map((t) => (
                    <Badge key={t.name} tone={t.status === 'ok' ? 'good' : 'info'}>
                      {t.name}: {t.status === 'ok' ? 'ok' : t.status === 'created' ? 'created' : 'headers added'}
                      {PUBLISHED_TABS.includes(t.name as never) ? ' · publish' : ''}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </form>
      </Card>

      <Card title="One-time setup (your Google account, free)">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-slate-300">
          {SETUP_STEPS.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-slate-400">
          Script: <a className="text-sky-300 underline" href={CODE_URL} target="_blank" rel="noreferrer">apps-script/Code.gs</a>. Never put
          the token in the script, the repo or a chat; it lives in Script Properties and in this browser. “Publish to web” makes those three
          tabs readable by anyone with the link.
        </p>
        <h3 className="mt-3 text-sm font-semibold text-slate-200">After a script update (keep the same URL)</h3>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-slate-300">
          {REDEPLOY_STEPS.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </Card>
    </div>
  )
}
