import { useEffect, useRef, useState } from 'react'
import { actions, type TimeStamp } from '../db/actions'
import type { CapKind, GameState } from '../domain/game'
import type { Game } from '../domain/schema'
import { formatClock } from '../domain/time'
import { Badge, Btn } from './kit'

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)
/** A sub/call picker (role=dialog) owns the keys while open. */
const pickerOpen = () => !!document.querySelector('[role=dialog]')

const resultLabel = (r: GameState['result']) => (r === 'W' ? 'win' : r === 'L' ? 'loss' : r === 'T' ? 'tie' : '')

const CAP_HELP: Record<CapKind, string> = {
  half: 'Half comes at the higher score + 1 (after the point in progress).',
  soft: 'After the point in progress, the game goes to the higher score + 1.',
  hard: 'The point in progress is the last one (one more if tied). Between points: the game is over unless tied.',
}

/** What the target will be once the marked cap applies (for the confirmation line). */
function capPreview(st: GameState, k: CapKind, game: Game): string {
  if (!st.capsConfigured[k]) return 'No such cap is set for this game, so it is saved as a marker only (Game settings → caps).'
  const hi = Math.max(st.score.us, st.score.them)
  if (st.current) return CAP_HELP[k]
  if (k === 'half') return st.halfReached ? 'Already in the 2nd half.' : `Half at ${Math.min(st.halfTarget, hi + 1)}.`
  if (k === 'soft') return `Game to ${Math.min(game.game_to, hi + 1)}.`
  return st.score.us === st.score.them ? `Tied, so one more point: game to ${hi + 1}.` : 'Game over at this score (press End game to close it).'
}

/**
 * End game (E) and Cap went off (K): manual markers for when the game clock can't be trusted.
 * End game asks first, then closes the game at the recorded score; Reopen (or Undo) undoes it.
 */
export function GameControls({ game, state: st, stamp, onError }: { game: Game; state: GameState; stamp: () => TimeStamp; onError: (m: string) => void }) {
  const [capOpen, setCapOpen] = useState(false)
  const run = (p: Promise<unknown>) => void p.catch((e: Error) => onError(e.message))
  const hasPoints = st.points.length > 0

  const end = () => {
    const unfinished = st.current ? ' The point in progress stays unscored.' : ''
    const r = st.score.us > st.score.them ? 'W' : st.score.us < st.score.them ? 'L' : 'T'
    if (!confirm(`End the game now at ${st.score.us}–${st.score.them} (${r})?\nThe final score is what is recorded.${unfinished}\nYou can reopen it later (Reopen, or Undo).`)) return
    run(actions.endGame(game.id, stamp()))
  }
  const cap = (k: CapKind) => {
    setCapOpen(false)
    run(actions.markCap(game.id, k, stamp()))
  }

  const h = useRef({ end, cap, capOpen, ended: st.ended, hasPoints })
  useEffect(() => {
    h.current = { end, cap, capOpen, ended: st.ended, hasPoints }
  })
  useEffect(() => {
    // Capture phase so the cap menu's keys (1/2/3, Esc) don't also reach the stat-entry keys.
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      const c = h.current
      if (c.capOpen) {
        const k = ({ '1': 'half', '2': 'soft', '3': 'hard' } as Record<string, CapKind>)[e.key]
        if (k || e.key === 'Escape' || e.key === 'k' || e.key === 'K') {
          e.preventDefault()
          e.stopPropagation()
          if (k) c.cap(k)
          else setCapOpen(false)
        }
        return
      }
      if (pickerOpen()) return
      if ((e.key === 'e' || e.key === 'E') && !c.ended) {
        e.preventDefault()
        e.stopPropagation()
        c.end()
      } else if ((e.key === 'k' || e.key === 'K') && !c.ended && c.hasPoints) {
        e.preventDefault()
        e.stopPropagation()
        setCapOpen(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (st.ended) {
    return (
      <span className="flex items-center gap-1" data-testid="game-ended">
        <Badge tone={st.result === 'W' ? 'good' : st.result === 'L' ? 'bad' : 'default'}>Ended · {st.result}</Badge>
        <Btn size="sm" tone="ghost" onClick={() => run(actions.reopenGame(game.id))} title="Reopen the game to add or fix points">
          Reopen
        </Btn>
      </span>
    )
  }
  const t = stamp().video_time
  return (
    <span className="relative flex items-center gap-1">
      {st.pendingCap && (
        <Badge tone="warn">{st.pendingCap === 'hard' ? 'Hard cap: last point (unless tied)' : 'Soft cap: new target after this point'}</Badge>
      )}
      <Btn size="sm" tone="ghost" disabled={!hasPoints} onClick={() => setCapOpen((o) => !o)} title="Key: K. Mark when a cap went off (at the current film time)" aria-expanded={capOpen}>
        Cap went off… <kbd className="ml-1 rounded bg-black/30 px-1 text-[10px] text-slate-300">K</kbd>
      </Btn>
      <Btn size="sm" tone="bad" onClick={end} title="Key: E. Close the game at the recorded score (asks first)">
        End game <kbd className="ml-1 rounded bg-black/30 px-1 text-[10px] text-slate-300">E</kbd>
      </Btn>
      {capOpen && (
        <div className="absolute right-0 top-full z-30 mt-1 flex w-80 flex-col gap-2 rounded-lg border border-amber-800 bg-slate-950 p-2 text-xs shadow-xl" data-testid="cap-menu">
          <div className="text-slate-300">
            Cap went off {st.current ? `during point ${st.current.point.idx}` : `after point ${st.points.at(-1)?.point.idx}`}
            {t !== null ? ` · at ${formatClock(t)}` : ''}. Which one?
          </div>
          {(['half', 'soft', 'hard'] as const).map((k, i) => (
            <button
              key={k}
              type="button"
              disabled={k === 'half' && st.halfReached}
              onClick={() => cap(k)}
              className="flex flex-col items-start rounded border border-slate-700 px-2 py-1 text-left hover:bg-slate-800 disabled:opacity-40"
            >
              <span className="font-semibold text-amber-200">
                <kbd className="mr-1 rounded bg-black/40 px-1 text-[10px]">{i + 1}</kbd>
                {k[0].toUpperCase() + k.slice(1)} cap{game.caps?.[k] ? ` (${game.caps[k]}′)` : ''}
              </span>
              <span className="text-slate-400">{capPreview(st, k, game)}</span>
            </button>
          ))}
          <p className="text-[11px] text-slate-500">Nothing is forced: it only sets the target. Edit or delete it in the play-by-play.</p>
        </div>
      )}
    </span>
  )
}

/** Shown instead of the point starter when the game is over (target reached) or ended by hand. */
export function FinalBanner({ game, state: st, onPlayOn }: { game: Game; state: GameState; onPlayOn: () => void }) {
  if (st.ended) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-sm" data-testid="final-banner">
        <span>
          Game ended: <b>{st.score.us}–{st.score.them}</b> vs {game.opponent} ({resultLabel(st.result)}). Edit any point or event in the log below; Reopen to add points.
        </span>
        <Btn size="sm" onClick={() => void actions.reopenGame(game.id)}>Reopen</Btn>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-sm" data-testid="final-banner">
      <span>
        Target reached ({st.target}): <b>{st.score.us}–{st.score.them}</b> ({resultLabel(st.result)}). Press End game to close it, or play on if the game continued.
      </span>
      <Btn size="sm" tone="ghost" onClick={onPlayOn}>Play another point</Btn>
    </div>
  )
}
