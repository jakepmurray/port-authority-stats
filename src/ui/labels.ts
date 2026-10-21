import type { GameEvent, Player } from '../domain/schema'

export const playerLabel = (p: Player | undefined | null) => (p ? `#${p.number} ${p.name}` : '?')

export const EVENT_LABEL: Record<GameEvent['type'], string> = {
  pull: 'Pull', pickup: 'Pickup', catch: 'Pass', throw: 'Throw', turnover: 'Turnover', drop: 'Drop',
  throwaway: 'Throwaway', stall: 'Stall', D: 'Block', callahan: 'Callahan', goal: 'Goal', timeout: 'Timeout',
  sub: 'Sub', injury: 'Injury', half: 'Half', cap: 'Cap', note: 'Note',
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
    case 'timeout':
      return `Timeout ${them ? opponent : 'us'}`
    case 'cap':
      return `${e.tags[0] ?? ''} cap on`.trim()
    case 'half':
      return 'Halftime'
    default:
      return `${EVENT_LABEL[e.type]}${e.note ? `: ${e.note}` : ''}`
  }
}
