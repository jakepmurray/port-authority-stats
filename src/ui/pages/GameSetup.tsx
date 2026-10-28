import { useState } from 'react'
import { actions } from '../../db/actions'
import { repo } from '../../db/repo'
import { parseYouTubeId, parseYouTubeStart } from '../../domain/youtube'
import { USAU_2026_BRACKET_CAPS, USAU_2026_CAPS, type Caps, type Game } from '../../domain/schema'
import { formatClock, parseClock } from '../../domain/time'
import { go } from '../hooks'
import { Btn, Card, Field, Input, Select } from '../kit'

type Preset = 'pool' | 'bracket' | 'none' | 'custom'
const presetOf = (c: Caps): Preset =>
  JSON.stringify(c) === JSON.stringify(USAU_2026_CAPS)
    ? 'pool'
    : JSON.stringify(c) === JSON.stringify(USAU_2026_BRACKET_CAPS)
      ? 'bracket'
      : c.half === null && c.soft === null && c.hard === null
        ? 'none'
        : 'custom'

/** New-game form, or edit form when `game` is given. */
export function GameSetup({ game }: { game?: Game }) {
  const [f, setF] = useState(() => ({
    opponent: game?.opponent ?? '',
    tournament: game?.tournament ?? '',
    date: game?.date ?? new Date().toISOString().slice(0, 10),
    game_to: game?.game_to ?? 15,
    caps: game?.caps ?? USAU_2026_CAPS,
    timeouts_per_half: game?.timeouts_per_half ?? 2,
    ratio_first: game?.ratio_first ?? ('W4' as const),
    start_on: game?.start_on ?? ('O' as const),
    url: game?.video.url ?? (game?.video.youtube_id ? `https://youtu.be/${game.video.youtube_id}` : ''),
    offset: game ? formatClock(game.video.offset_s) : '',
    notes: game?.notes ?? '',
    use_clock: game?.use_clock === true,
  }))
  const [preset, setPreset] = useState<Preset>(presetOf(f.caps))
  const [err, setErr] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))
  const vid = f.url ? parseYouTubeId(f.url) : null

  const save = async () => {
    setErr(null)
    if (!f.opponent.trim()) return setErr('Opponent is required')
    if (f.url && !vid) return setErr('That does not look like a YouTube link')
    const off = parseClock(f.offset)
    if (Number.isNaN(off)) return setErr('Game start must look like 12:34')
    const video = vid
      ? { kind: 'youtube' as const, youtube_id: vid, url: f.url.trim(), offset_s: off ?? parseYouTubeStart(f.url) ?? 0 }
      : { kind: 'none' as const, youtube_id: null, url: null, offset_s: off ?? 0 }
    const data = {
      opponent: f.opponent.trim(), tournament: f.tournament.trim(), date: f.date, game_to: f.game_to, caps: f.caps,
      timeouts_per_half: f.timeouts_per_half, ratio_first: f.ratio_first, start_on: f.start_on, video, notes: f.notes,
      use_clock: f.use_clock,
    }
    try {
      if (game) {
        await repo.update('games', game.id, data, { byHand: true })
        go(`game/${game.id}`)
      } else {
        const g = await actions.createGame(data)
        go(`game/${g.id}`)
      }
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const capInput = (k: keyof Caps) => (
    <Field label={`${k[0].toUpperCase()}${k.slice(1)} cap (min)`}>
      <Input
        type="number"
        min={1}
        value={f.caps[k] ?? ''}
        disabled={preset !== 'custom'}
        onChange={(e) => set('caps', { ...f.caps, [k]: e.target.value ? Number(e.target.value) : null })}
      />
    </Field>
  )

  return (
    <div className="mx-auto max-w-3xl p-4">
      <Card title={game ? 'Edit game' : 'New game'}>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label="Opponent">
            <Input autoFocus value={f.opponent} onChange={(e) => set('opponent', e.target.value)} placeholder="e.g. Philly AMP" />
          </Field>
          <Field label="Tournament">
            <Input value={f.tournament} onChange={(e) => set('tournament', e.target.value)} placeholder="e.g. Regionals" />
          </Field>
          <Field label="Date">
            <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Game to">
            <Input type="number" min={1} value={f.game_to} onChange={(e) => set('game_to', Number(e.target.value) || 15)} />
          </Field>
          <Field label="First-point ratio (ABBA)" hint="Winner of the ratio flip picks point 1.">
            <Select value={f.ratio_first} onChange={(e) => set('ratio_first', e.target.value as 'W4' | 'M4')}>
              <option value="W4">4 WMP / 3 MMP</option>
              <option value="M4">4 MMP / 3 WMP</option>
            </Select>
          </Field>
          <Field label="We start on">
            <Select value={f.start_on} onChange={(e) => set('start_on', e.target.value as 'O' | 'D')}>
              <option value="O">Offense (we receive)</option>
              <option value="D">Defense (we pull)</option>
            </Select>
          </Field>
          <Field label="Caps">
            <Select
              value={preset}
              onChange={(e) => {
                const p = e.target.value as Preset
                setPreset(p)
                if (p === 'pool') set('caps', USAU_2026_CAPS)
                if (p === 'bracket') set('caps', USAU_2026_BRACKET_CAPS)
                if (p === 'none') set('caps', { half: null, soft: null, hard: null })
              }}
            >
              <option value="pool">USAU 2026 pool play (45′ / 90′ / 105′)</option>
              <option value="bracket">USAU 2026 semis/finals (52′ / 105′ / none)</option>
              <option value="none">No caps</option>
              <option value="custom">Custom</option>
            </Select>
          </Field>
          <Field label="Timeouts per half (each team)">
            <Input type="number" min={0} value={f.timeouts_per_half} onChange={(e) => set('timeouts_per_half', Number(e.target.value))} />
          </Field>
          <div className="grid grid-cols-3 gap-2 sm:col-span-2">
            {capInput('half')}
            {capInput('soft')}
            {capInput('hard')}
          </div>
          <Field label="YouTube link" hint={f.url ? (vid ? `Video id ${vid}` : 'Not a YouTube link') : 'Optional. Paste the game film link.'}>
            <Input value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://youtu.be/…" />
          </Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-1" checked={f.use_clock} onChange={(e) => set('use_clock', e.target.checked)} />
            <span>
              Use the game clock (cap timers from the video time)
              <span className="block text-xs text-slate-500">
                Off by default: film often starts late or cuts. Instead, mark caps with “Cap went off” (K) and finish with “End game” (E). The caps above still set the new target when you mark one.
              </span>
            </span>
          </label>
          {f.use_clock && (
            <Field label="Game starts at (video time)" hint="Used for the cap clock. You can set it later from the player.">
              <Input value={f.offset} onChange={(e) => set('offset', e.target.value)} placeholder="0:00" />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Notes">
              <textarea className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
          {err && <p className="text-sm text-rose-300 sm:col-span-2">{err}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Btn tone="primary" type="submit">{game ? 'Save' : 'Create game'}</Btn>
            <Btn onClick={() => history.back()}>Cancel</Btn>
            {game && (
              <Btn
                tone="bad"
                className="ml-auto"
                onClick={async () => {
                  if (!confirm('Delete this game? It can be restored from the Home page.')) return
                  await repo.softDelete('games', game.id)
                  go('')
                }}
              >
                Delete game
              </Btn>
            )}
          </div>
        </form>
      </Card>
    </div>
  )
}
