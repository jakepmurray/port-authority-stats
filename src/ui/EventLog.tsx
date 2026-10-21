import { useEffect, useRef, useState } from 'react'
import { actions } from '../db/actions'
import { checkLine } from '../domain/abba'
import type { GameState } from '../domain/game'
import { EventType, type Game, type GameEvent, type Player, type Point } from '../domain/schema'
import { formatClock, parseClock } from '../domain/time'
import { Badge, Btn, Input, Select } from './kit'
import { describeEvent, EVENT_LABEL, playerLabel } from './labels'

const OUTCOME: Record<Point['outcome'], string> = { hold: 'hold', break: 'BREAK', broken: 'broken', them_hold: 'their hold', none: '' }

/** The play-by-play: every point and event, click to seek, edit/insert/delete anything. */
export function EventLog({
  game,
  state,
  allPoints,
  allEvents,
  players,
  onSeek,
  stamp,
}: {
  game: Game
  state: GameState
  allPoints: Point[]
  allEvents: GameEvent[]
  players: Player[]
  onSeek: ((t: number) => void) | null
  stamp: () => { video_time: number | null; time_source: GameEvent['time_source'] }
}) {
  const [showDeleted, setShowDeleted] = useState(false)
  const [editing, setEditing] = useState<string | null>(null) // event id, 'new:<pointId>:<afterId>', or 'point:<id>'
  const byId = new Map(players.map((p) => [p.id, p]))
  const end = useRef<HTMLDivElement>(null)
  const liveCount = allEvents.filter((e) => !e.deleted).length
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [liveCount])

  const points = [...allPoints].filter((p) => showDeleted || !p.deleted).sort((a, b) => a.idx - b.idx || a.created_at - b.created_at)
  const info = new Map(state.points.map((i) => [i.point.id, i]))

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>Play-by-play · click a time to jump the film there</span>
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> show deleted
        </label>
      </div>
      {points.length === 0 && <p className="text-slate-500">No points yet.</p>}
      {points.map((p) => {
        const i = info.get(p.id)
        const evs = allEvents.filter((e) => e.point_id === p.id && (showDeleted || !e.deleted)).sort((a, b) => a.seq - b.seq)
        return (
          <div key={p.id} className={`rounded-lg border border-slate-800 ${p.deleted ? 'opacity-40' : ''}`}>
            <div className="flex flex-wrap items-center gap-2 bg-slate-900 px-2 py-1 text-xs">
              <button type="button" className="font-semibold text-slate-200" onClick={() => onSeek && p.video_start !== null && onSeek(p.video_start)}>
                Point {p.idx}
              </button>
              <Badge>{p.start_on}</Badge>
              <Badge>{p.ratio}</Badge>
              {i && (
                <span className="tabular-nums text-slate-400">
                  {i.before.us}–{i.before.them}
                  {i.state.over && ` → ${i.after.us}–${i.after.them}`}
                </span>
              )}
              {i && i.outcome !== 'none' && <Badge tone={i.outcome === 'hold' || i.outcome === 'break' ? 'good' : 'bad'}>{OUTCOME[i.outcome]}</Badge>}
              {i?.halfAfter && <Badge tone="warn">half</Badge>}
              {p.edited_at && <Badge>edited</Badge>}
              <span className="truncate text-slate-500">{p.line.map((id) => byId.get(id)?.number ?? '?').join(' ')}</span>
              <span className="ml-auto flex gap-1">
                <Btn size="sm" tone="ghost" onClick={() => setEditing(editing === `point:${p.id}` ? null : `point:${p.id}`)}>
                  Edit
                </Btn>
                <Btn size="sm" tone="ghost" title="Insert an event at the start of this point" onClick={() => setEditing(`new:${p.id}:`)}>
                  +
                </Btn>
              </span>
            </div>
            {editing === `point:${p.id}` && <PointEditor point={p} players={players} onDone={() => setEditing(null)} />}
            {editing === `new:${p.id}:` && (
              <EventEditor game={game} players={players} pointId={p.id} afterId="" stamp={stamp} onDone={() => setEditing(null)} />
            )}
            <ul>
              {evs.map((e) => (
                <li key={e.id}>
                  <div className={`group flex items-center gap-2 border-t border-slate-800/60 px-2 py-1 ${e.deleted ? 'line-through opacity-50' : ''}`}>
                    <button
                      type="button"
                      disabled={!onSeek || e.video_time === null}
                      onClick={() => e.video_time !== null && onSeek?.(e.video_time)}
                      className="w-14 shrink-0 rounded font-mono text-xs text-sky-300 hover:bg-sky-950 disabled:text-slate-600"
                      title={e.video_time !== null ? 'Jump the film here (starts 3 s before)' : 'No timestamp'}
                    >
                      {formatClock(e.video_time)}
                    </button>
                    <span className={`flex-1 ${e.type === 'goal' || e.type === 'callahan' ? 'font-semibold' : ''} ${e.team === 'them' ? 'text-rose-200' : ''}`}>
                      {describeEvent(e, byId, game.opponent)}
                    </span>
                    {e.edited_at && <Badge>edited</Badge>}
                    {e.time_source === 'manual' && <Badge>manual time</Badge>}
                    <span className="flex gap-1 opacity-60 group-hover:opacity-100">
                      {e.deleted ? (
                        <Btn size="sm" onClick={() => void actions.restoreEvent(e.id)}>Restore</Btn>
                      ) : (
                        <>
                          <Btn size="sm" tone="ghost" onClick={() => setEditing(editing === e.id ? null : e.id)}>Edit</Btn>
                          <Btn size="sm" tone="ghost" title="Insert after" onClick={() => setEditing(`new:${p.id}:${e.id}`)}>+</Btn>
                          <Btn size="sm" tone="ghost" title="Delete (can be restored)" onClick={() => void actions.deleteEvent(e.id)}>✕</Btn>
                        </>
                      )}
                    </span>
                  </div>
                  {editing === e.id && <EventEditor game={game} players={players} event={e} stamp={stamp} onDone={() => setEditing(null)} />}
                  {editing === `new:${p.id}:${e.id}` && (
                    <EventEditor game={game} players={players} pointId={p.id} afterId={e.id} stamp={stamp} onDone={() => setEditing(null)} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      <div ref={end} />
    </div>
  )
}

function PlayerSelect({ label, value, players, onChange }: { label: string; value: string | null; players: Player[]; onChange: (v: string | null) => void }) {
  return (
    <label className="flex flex-col gap-0.5 text-xs text-slate-400">
      {label}
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {players.map((p) => (
          <option key={p.id} value={p.id}>
            {playerLabel(p)}
            {p.deleted ? ' (deleted)' : ''}
          </option>
        ))}
      </Select>
    </label>
  )
}

/** Edit an existing event, or create one (pointId + afterId; afterId '' = start of point). */
export function EventEditor({
  game,
  players,
  event,
  pointId,
  afterId,
  stamp,
  onDone,
}: {
  game: Game
  players: Player[]
  event?: GameEvent
  pointId?: string
  afterId?: string
  stamp: () => { video_time: number | null; time_source: GameEvent['time_source'] }
  onDone: () => void
}) {
  const [d, setD] = useState(() => ({
    type: event?.type ?? ('catch' as GameEvent['type']),
    team: event?.team ?? ('us' as GameEvent['team']),
    actor_id: event?.actor_id ?? null,
    receiver_id: event?.receiver_id ?? null,
    defender_id: event?.defender_id ?? null,
    tags: (event?.tags ?? []).join(', '),
    note: event?.note ?? '',
    time: event ? formatClock(event.video_time).replace('–', '') : '',
  }))
  const [err, setErr] = useState<string | null>(null)
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((s) => ({ ...s, [k]: v }))

  const save = async () => {
    const t = parseClock(d.time)
    if (Number.isNaN(t)) return setErr('Time must look like 12:34')
    const fields = {
      type: d.type, team: d.team, actor_id: d.actor_id, receiver_id: d.receiver_id, defender_id: d.defender_id,
      tags: d.tags.split(',').map((x) => x.trim()).filter(Boolean), note: d.note,
    }
    try {
      if (event) {
        const timeChanged = t !== event.video_time && !(t === null && event.video_time === null)
        await actions.editEvent(event.id, {
          ...fields,
          ...(timeChanged ? { video_time: t, time_source: t === null ? 'none' : 'manual' } : {}),
        })
      } else if (pointId !== undefined) {
        await actions.addEvent(pointId, fields, { video_time: t, time_source: 'manual' }, { afterId })
      }
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <form
      className="grid grid-cols-2 gap-2 border-t border-sky-900 bg-sky-950/30 p-2 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label className="flex flex-col gap-0.5 text-xs text-slate-400">
        Type
        <Select value={d.type} onChange={(e) => set('type', e.target.value as GameEvent['type'])}>
          {EventType.options.map((t) => (
            <option key={t} value={t}>
              {EVENT_LABEL[t]}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-slate-400">
        Team
        <Select value={d.team} onChange={(e) => set('team', e.target.value as GameEvent['team'])}>
          <option value="us">Us</option>
          <option value="them">{game.opponent}</option>
        </Select>
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-slate-400">
        Video time
        <span className="flex gap-1">
          <Input className="w-20 font-mono" value={d.time} placeholder="mm:ss" onChange={(e) => set('time', e.target.value)} />
          <Btn size="sm" title="Use the current video time" onClick={() => set('time', formatClock(stamp().video_time).replace('–', ''))}>
            Now
          </Btn>
        </span>
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-slate-400">
        Tags
        <Input value={d.tags} placeholder="ob, brick, half…" onChange={(e) => set('tags', e.target.value)} />
      </label>
      <PlayerSelect label="Actor / thrower" value={d.actor_id} players={players} onChange={(v) => set('actor_id', v)} />
      <PlayerSelect label="Receiver" value={d.receiver_id} players={players} onChange={(v) => set('receiver_id', v)} />
      <PlayerSelect label="Defender" value={d.defender_id} players={players} onChange={(v) => set('defender_id', v)} />
      <label className="flex flex-col gap-0.5 text-xs text-slate-400">
        Note
        <Input value={d.note} onChange={(e) => set('note', e.target.value)} />
      </label>
      {err && <p className="col-span-full text-xs text-rose-300">{err}</p>}
      <div className="col-span-full flex gap-2">
        <Btn tone="primary" size="sm" type="submit">{event ? 'Save' : 'Insert'}</Btn>
        <Btn size="sm" onClick={onDone}>Cancel</Btn>
      </div>
    </form>
  )
}

function PointEditor({ point, players, onDone }: { point: Point; players: Player[]; onDone: () => void }) {
  const [p, setP] = useState(() => ({ ...point, vs: formatClock(point.video_start).replace('–', ''), ve: formatClock(point.video_end).replace('–', '') }))
  const [err, setErr] = useState<string | null>(null)
  const check = checkLine(p.line, players, p.ratio)
  const toggle = (id: string) => setP((s) => ({ ...s, line: s.line.includes(id) ? s.line.filter((x) => x !== id) : [...s.line, id] }))
  const save = async () => {
    const vs = parseClock(p.vs)
    const ve = parseClock(p.ve)
    if (Number.isNaN(vs) || Number.isNaN(ve)) return setErr('Times must look like 12:34')
    try {
      await actions.editPoint(point.id, { start_on: p.start_on, ratio: p.ratio, line: p.line, pulled_by: p.pulled_by, video_start: vs, video_end: ve })
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="flex flex-col gap-2 border-t border-sky-900 bg-sky-950/30 p-2 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-slate-400">
          Start on
          <Select value={p.start_on} onChange={(e) => setP({ ...p, start_on: e.target.value as 'O' | 'D' })}>
            <option value="O">O</option>
            <option value="D">D</option>
          </Select>
        </label>
        <label className="flex flex-col gap-0.5 text-slate-400">
          Ratio
          <Select value={p.ratio} onChange={(e) => setP({ ...p, ratio: e.target.value as 'W4' | 'M4' })}>
            <option value="W4">W4</option>
            <option value="M4">M4</option>
          </Select>
        </label>
        <label className="flex flex-col gap-0.5 text-slate-400">
          Puller
          <Select value={p.pulled_by ?? ''} onChange={(e) => setP({ ...p, pulled_by: e.target.value || null })}>
            <option value="">—</option>
            {p.line.map((id) => (
              <option key={id} value={id}>
                {playerLabel(players.find((x) => x.id === id))}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-0.5 text-slate-400">
          Video start
          <Input className="w-20 font-mono" value={p.vs} onChange={(e) => setP({ ...p, vs: e.target.value })} />
        </label>
        <label className="flex flex-col gap-0.5 text-slate-400">
          Video end
          <Input className="w-20 font-mono" value={p.ve} onChange={(e) => setP({ ...p, ve: e.target.value })} />
        </label>
      </div>
      <div className="flex flex-wrap gap-1">
        {players
          .filter((x) => !x.deleted && (x.active || p.line.includes(x.id)))
          .map((x) => (
            <button
              type="button"
              key={x.id}
              onClick={() => toggle(x.id)}
              className={`rounded border px-1.5 py-0.5 ${p.line.includes(x.id) ? (x.gender_match === 'W' ? 'border-fuchsia-400 bg-fuchsia-900/60' : 'border-sky-400 bg-sky-900/60') : 'border-slate-700'}`}
            >
              #{x.number} {x.name}
            </button>
          ))}
      </div>
      <div className={check.ok ? 'text-slate-400' : 'text-rose-300'}>
        W {check.counts.W}/{check.need.W} · M {check.counts.M}/{check.need.M} {check.issues.map((i) => `· ${i.message}`).join(' ')}
      </div>
      {err && <p className="text-rose-300">{err}</p>}
      <div className="flex gap-2">
        <Btn tone="primary" size="sm" onClick={() => void save()}>Save point</Btn>
        <Btn size="sm" onClick={onDone}>Cancel</Btn>
        {point.deleted ? (
          <Btn size="sm" className="ml-auto" onClick={() => void actions.repo.restore('points', point.id).then(onDone)}>Restore point</Btn>
        ) : (
          <Btn
            size="sm"
            tone="bad"
            className="ml-auto"
            onClick={() => {
              if (confirm(`Delete point ${point.idx} and hide its events? It can be restored.`)) void actions.repo.softDelete('points', point.id).then(onDone)
            }}
          >
            Delete point
          </Btn>
        )}
      </div>
    </div>
  )
}
