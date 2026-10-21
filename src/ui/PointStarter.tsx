import { useMemo, useState } from 'react'
import { checkLine, checkPuller, majorityOf, ratioForPoint } from '../domain/abba'
import type { GameState } from '../domain/game'
import type { Game, Player, Ratio, Side } from '../domain/schema'
import { Badge, Btn, Select } from './kit'
import { playerLabel } from './labels'

/** Pick the line for the next point, with live ABBA ratio and majority-pull checks. */
export function PointStarter({
  game,
  state,
  players,
  onStart,
}: {
  game: Game
  state: GameState
  players: Player[]
  onStart: (o: { line: string[]; pulled_by: string | null; start_on: Side; ratio: Ratio }) => void
}) {
  const roster = players.filter((p) => !p.deleted && p.active)
  const expected = state.next.ratio
  const [startOn, setStartOn] = useState<Side>(state.next.start_on)
  const [ratio, setRatio] = useState<Ratio>(expected)
  const [line, setLine] = useState<string[]>([])
  const [puller, setPuller] = useState<string | null>(null)

  const check = useMemo(() => checkLine(line, players, ratio), [line, players, ratio])
  const pullIssues = startOn === 'D' ? checkPuller(puller, line, players, ratio) : []
  const issues = [...check.issues, ...pullIssues]
  if (ratio !== expected) issues.unshift({ level: 'error', code: 'over_ratio', message: `ABBA says point ${state.next.idx} is ${expected}` })
  const hasError = issues.some((i) => i.level === 'error')
  const lastLine = (side: Side) => [...state.points].reverse().find((p) => p.point.start_on === side)?.point.line ?? null

  const toggle = (id: string) => setLine((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  const col = (g: 'W' | 'M') => (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-slate-400">
        {g === 'W' ? 'WMP' : 'MMP'} {check.counts[g]}/{check.need[g]}
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {roster
          .filter((p) => p.gender_match === g)
          .map((p) => {
            const on = line.includes(p.id)
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => toggle(p.id)}
                className={`truncate rounded-lg border px-2 py-2 text-left text-sm ${on ? (g === 'W' ? 'border-fuchsia-400 bg-fuchsia-900/60' : 'border-sky-400 bg-sky-900/60') : 'border-slate-700 bg-slate-800/60 hover:bg-slate-700'}`}
              >
                <span className="font-mono text-slate-400">#{p.number}</span> {p.name}
              </button>
            )
          })}
      </div>
    </div>
  )

  if (state.over) {
    return (
      <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-sm">
        Game over: {state.score.us}–{state.score.them}. Edit any point or event in the log below if something is wrong.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Point {state.next.idx}</span>
        <Badge tone="info">ABBA: {ratioForPoint(game.ratio_first, state.next.idx) === game.ratio_first ? 'A' : 'B'} · {expected}</Badge>
        {state.points.at(-1)?.halfAfter && <Badge tone="warn">2nd half</Badge>}
        <Select aria-label="We are on" value={startOn} onChange={(e) => setStartOn(e.target.value as Side)} className="ml-auto">
          <option value="O">We receive (O)</option>
          <option value="D">We pull (D)</option>
        </Select>
        <Select aria-label="Ratio" value={ratio} onChange={(e) => setRatio(e.target.value as Ratio)}>
          <option value="W4">4 WMP</option>
          <option value="M4">4 MMP</option>
        </Select>
      </div>
      {roster.length === 0 ? (
        <p className="text-sm text-slate-400">
          No active players. <a className="text-sky-300 underline" href="#/roster">Add your roster</a> (you can still start the point with no line).
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {col('W')}
          {col('M')}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {(['O', 'D'] as const).map((s) => {
          const l = lastLine(s)
          return l ? (
            <Btn key={s} size="sm" onClick={() => setLine(l.filter((id) => roster.some((p) => p.id === id)))}>
              Last {s} line
            </Btn>
          ) : null
        })}
        <Btn size="sm" tone="ghost" onClick={() => setLine([])}>
          Clear
        </Btn>
        {startOn === 'D' && (
          <Select aria-label="Puller" value={puller ?? ''} onChange={(e) => setPuller(e.target.value || null)}>
            <option value="">Puller ({majorityOf(ratio) === 'W' ? 'WMP' : 'MMP'})…</option>
            {line
              .map((id) => players.find((p) => p.id === id))
              .filter((p): p is Player => !!p)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {playerLabel(p)}
                </option>
              ))}
          </Select>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {issues.map((i, k) => (
            <li key={k} className={i.level === 'error' ? 'text-rose-300' : 'text-amber-300'}>
              {i.level === 'error' ? '✕' : '!'} {i.message}
            </li>
          ))}
        </ul>
      )}
      <Btn
        tone={hasError ? 'bad' : 'good'}
        size="lg"
        onClick={() => {
          if (hasError && !confirm('The line breaks the ratio rules. Record it anyway (e.g. that is what happened on film)?')) return
          onStart({ line, pulled_by: puller, start_on: startOn, ratio })
          setLine([])
          setPuller(null)
        }}
      >
        {hasError ? 'Start point anyway' : `Start point ${state.next.idx}`} (score {state.score.us}–{state.score.them})
      </Btn>
    </div>
  )
}
