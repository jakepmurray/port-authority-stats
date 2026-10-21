import type { GameEvent, TeamSide } from './schema'
import type { PossessionState } from './game'

export type EntryMode = 'full' | 'quick'

/** A stat command, as produced by the keyboard or buttons. Player slots hold player ids. */
export type Command =
  | { kind: 'touch'; player: string }
  | { kind: 'goal'; thrower?: string | null; scorer?: string | null }
  | { kind: 'throwaway'; thrower?: string | null }
  | { kind: 'drop'; receiver?: string | null; thrower?: string | null }
  | { kind: 'stall'; player?: string | null }
  | { kind: 'turnover'; player?: string | null }
  | { kind: 'block'; defender?: string | null }
  | { kind: 'callahan'; defender?: string | null; thrower?: string | null }
  | { kind: 'pull'; puller?: string | null; result?: 'in' | 'ob' | 'brick' }
  | { kind: 'timeout'; team: TeamSide }

export type CommandKind = Command['kind']

export type EventDraft = Pick<GameEvent, 'type' | 'team' | 'actor_id' | 'receiver_id' | 'defender_id' | 'tags'> & { call?: GameEvent['call'] }

export type BuildResult = { ok: true; event: EventDraft } | { ok: false; error: string }

const draft = (d: Partial<EventDraft> & Pick<EventDraft, 'type' | 'team'>): EventDraft => ({
  actor_id: null,
  receiver_id: null,
  defender_id: null,
  tags: [],
  ...d,
})

/**
 * Which player numbers a command still needs, given who has the disc and the
 * entry mode. The UI collects them in order (e.g. quick-mode goal: assist, then scorer).
 */
export function slotsFor(kind: CommandKind, mode: EntryMode, s: PossessionState): string[] {
  const us = s.offense === 'us'
  switch (kind) {
    case 'touch':
      return ['player']
    case 'goal':
      if (!us) return []
      return mode === 'full' && s.holder ? ['scorer'] : ['thrower', 'scorer']
    case 'throwaway':
      return us && !(mode === 'full' && s.holder) ? ['thrower'] : []
    case 'drop':
      if (!us) return []
      return mode === 'full' && s.holder ? ['receiver'] : ['thrower', 'receiver']
    case 'stall':
    case 'turnover':
      return us && !(mode === 'full' && s.holder) ? ['player'] : []
    case 'block':
      return us ? [] : ['defender']
    case 'callahan':
      return us ? (s.holder ? [] : ['thrower']) : ['defender']
    case 'pull':
      return []
    case 'timeout':
      return []
  }
}

/**
 * Turn a command into an event, using the possession state: e.g. a catch's
 * thrower is the current holder, and a throwaway by the team on defense is invalid.
 */
export function buildEvent(cmd: Command, s: PossessionState): BuildResult {
  if (s.over && cmd.kind !== 'timeout') return { ok: false, error: 'Point is over — start the next point' }
  const us = s.offense === 'us'
  switch (cmd.kind) {
    case 'touch':
      if (!us) return { ok: false, error: 'They have the disc — use B (block) or wait for their turnover' }
      if (!s.holder) return { ok: true, event: draft({ type: 'pickup', team: 'us', actor_id: cmd.player }) }
      if (s.holder === cmd.player) return { ok: false, error: 'Same player as the thrower' }
      return { ok: true, event: draft({ type: 'catch', team: 'us', actor_id: s.holder, receiver_id: cmd.player }) }
    case 'goal': {
      if (!us) return { ok: true, event: draft({ type: 'goal', team: 'them' }) }
      const thrower = cmd.thrower ?? s.holder
      if (!cmd.scorer) return { ok: false, error: 'Who scored?' }
      if (thrower && thrower === cmd.scorer) return { ok: false, error: 'Assist and goal cannot be the same player' }
      return { ok: true, event: draft({ type: 'goal', team: 'us', actor_id: thrower ?? null, receiver_id: cmd.scorer }) }
    }
    case 'throwaway':
      return {
        ok: true,
        event: us
          ? draft({ type: 'throwaway', team: 'us', actor_id: cmd.thrower ?? s.holder })
          : draft({ type: 'throwaway', team: 'them' }),
      }
    case 'drop':
      if (!us) return { ok: true, event: draft({ type: 'drop', team: 'them' }) }
      if (!cmd.receiver) return { ok: false, error: 'Who dropped it?' }
      return {
        ok: true,
        event: draft({ type: 'drop', team: 'us', actor_id: cmd.thrower ?? s.holder, receiver_id: cmd.receiver }),
      }
    case 'stall':
    case 'turnover':
      return {
        ok: true,
        event: us
          ? draft({ type: cmd.kind, team: 'us', actor_id: cmd.player ?? s.holder })
          : draft({ type: cmd.kind, team: 'them' }),
      }
    case 'block':
      if (us) return { ok: true, event: draft({ type: 'D', team: 'them' }) } // they got a D on us
      return { ok: true, event: draft({ type: 'D', team: 'us', defender_id: cmd.defender ?? null }) }
    case 'callahan':
      if (us) {
        const thrower = cmd.thrower ?? s.holder
        return { ok: true, event: draft({ type: 'callahan', team: 'them', actor_id: thrower ?? null }) }
      }
      return { ok: true, event: draft({ type: 'callahan', team: 'us', defender_id: cmd.defender ?? null }) }
    case 'pull': {
      // The pulling team is the team on defense at the start of the point.
      const team: TeamSide = us ? 'them' : 'us'
      return {
        ok: true,
        event: draft({
          type: 'pull',
          team,
          actor_id: team === 'us' ? (cmd.puller ?? null) : null,
          tags: cmd.result ? [cmd.result] : [],
        }),
      }
    }
    case 'timeout':
      return { ok: true, event: draft({ type: 'timeout', team: cmd.team }) }
  }
}

/** Keyboard map shared by the UI and the help sheet. */
export const HOTKEYS: { key: string; kind: CommandKind; label: string; help: string }[] = [
  { key: 'g', kind: 'goal', label: 'Goal', help: 'Goal. Ours: then the scorer’s number (Quick: assist, then scorer). Theirs: no number.' },
  { key: 't', kind: 'throwaway', label: 'Throwaway', help: 'Throwaway by the team with the disc.' },
  { key: 'd', kind: 'drop', label: 'Drop', help: 'Drop. Ours: then the receiver’s number.' },
  { key: 'b', kind: 'block', label: 'Block (D)', help: 'D. On their possession: then our defender’s number.' },
  { key: 'c', kind: 'callahan', label: 'Callahan', help: 'Callahan. On their possession: then our defender’s number.' },
  { key: 's', kind: 'stall', label: 'Stall', help: 'Stalled out.' },
  { key: 'x', kind: 'turnover', label: 'Other turn', help: 'Any other turnover.' },
  { key: 'p', kind: 'pull', label: 'Pull', help: 'Pull (in). Use the buttons for OB / brick.' },
]
