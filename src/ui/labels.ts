import type { CallKind, CallOutcome, GameEvent, Player } from '../domain/schema'

export const playerLabel = (p: Player | undefined | null) => (p ? `#${p.number} ${p.name}` : '?')

export const EVENT_LABEL: Record<GameEvent['type'], string> = {
  pull: 'Pull', pickup: 'Pickup', catch: 'Pass', throw: 'Throw', turnover: 'Turnover', drop: 'Drop',
  throwaway: 'Throwaway', stall: 'Stall', D: 'Block', callahan: 'Callahan', goal: 'Goal', timeout: 'Timeout',
  sub: 'Sub', injury: 'Injury sub', call: 'Call', half: 'Half', cap: 'Cap went off', end: 'Game ended', note: 'Note',
}

export const CALL_KIND_LABEL: Record<CallKind, string> = {
  foul: 'Foul', travel: 'Travel', pick: 'Pick', strip: 'Strip', contact: 'Contact', stall: 'Stall (contested count)', offside: 'Offside', other: 'Other',
}
export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  contested: 'contested', uncontested: 'uncontested', retracted: 'retracted', back_to_thrower: 'disc back to thrower', turnover: 'turnover',
}

/** One-line human description of an event. */
export function describeEvent(e: GameEvent, byId: Map<string, Player>, opponent = 'Them'): string {
  const n = (id: string | null) => (id ? playerLabel(byId.get(id)) : 'unknown')
  const them = e.team === 'them'
  switch (e.type) {
    case 'pull':
      return `${them ? opponent : n(e.actor_id)} pulls${e.tags.length ? ` (${e.tags.join(', ')})` : ''}`
    case 'pickup':
      return `${n(e.actor_id)} picks up`
    case 'catch':
      return `${n(e.actor_id)} → ${n(e.receiver_id)}`
    case 'goal':
      return them ? `${opponent} score` : `GOAL ${n(e.receiver_id)} (assist ${n(e.actor_id)})`
    case 'throwaway':
      return them ? `${opponent} throwaway` : `Throwaway by ${n(e.actor_id)}`
    case 'drop':
      return them ? `${opponent} drop` : `Drop by ${n(e.receiver_id)} (from ${n(e.actor_id)})`
    case 'stall':
      return them ? `${opponent} stalled` : `${n(e.actor_id)} stalled`
    case 'turnover':
      return them ? `${opponent} turnover` : `Turnover by ${n(e.actor_id)}`
    case 'D':
      return them ? `${opponent} block` : `Block by ${n(e.defender_id)}`
    case 'callahan':
      return them ? `${opponent} Callahan (thrown by ${n(e.actor_id)})` : `CALLAHAN ${n(e.defender_id)}`
    case 'sub':
    case 'injury':
      if (them) return `${opponent} ${e.type === 'injury' ? 'injury sub' : 'sub'}`
      return `${e.type === 'injury' ? 'Injury sub' : 'Sub'}: ${n(e.actor_id)} off → ${n(e.receiver_id)} on`
    case 'call': {
      if (!e.call) return 'Call'
      const by = them ? opponent : e.actor_id ? n(e.actor_id) : 'us'
      const on = them ? (e.receiver_id ? n(e.receiver_id) : 'us') : opponent
      const result =
        e.call.outcome !== 'turnover'
          ? CALL_OUTCOME_LABEL[e.call.outcome]
          : e.call.turnover_team === 'them'
            ? `${opponent} turnover`
            : `our turnover${e.call.charged_id ? ` (${n(e.call.charged_id)})` : ''}`
      return `${CALL_KIND_LABEL[e.call.kind].replace(/ \(.*\)/, '')} called by ${by} on ${on}: ${result}`
    }
    case 'timeout':
      return `Timeout ${them ? opponent : 'us'}`
    case 'cap': {
      const k = e.tags.find((t) => t === 'half' || t === 'soft' || t === 'hard')
      return k ? `${k[0].toUpperCase()}${k.slice(1)} cap went off` : 'Cap went off'
    }
    case 'end':
      return `Game ended (by hand)${e.note ? `: ${e.note}` : ''}`
    case 'half':
      return 'Halftime'
    default:
      return `${EVENT_LABEL[e.type]}${e.note ? `: ${e.note}` : ''}`
  }
}
