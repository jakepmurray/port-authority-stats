import { GameSchema, EventSchema, PointSchema, type Game, type GameEvent, type Point, type Side, type TeamSide } from './schema'
import { ratioForPoint } from './abba'

/** Tiny builder for tests: a game with points and events. */
export function builder(gameOverrides: Partial<Game> = {}) {
  const game = GameSchema.parse({
    id: 'g1', team_id: 't1', opponent: 'Opp', ratio_first: 'W4', start_on: 'O',
    created_at: 1, updated_at: 1, ...gameOverrides,
  })
  const points: Point[] = []
  const events: GameEvent[] = []
  let seq = 0
  const b = {
    game, points, events,
    point(start_on: Side, line: string[] = [], extra: Partial<Point> = {}) {
      const idx = points.length + 1
      points.push(PointSchema.parse({
        id: `p${idx}`, game_id: game.id, idx, score_us: 0, score_them: 0, start_on,
        ratio: ratioForPoint(game.ratio_first, idx), line, created_at: 1, updated_at: 1, ...extra,
      }))
      return b
    },
    ev(type: GameEvent['type'], team: TeamSide, f: Partial<GameEvent> = {}) {
      const p = points.at(-1)!
      seq++
      events.push(EventSchema.parse({
        id: `e${seq}`, game_id: game.id, point_id: p.id, seq, type, team, created_at: seq, updated_at: seq, ...f,
      }))
      return b
    },
    pass(from: string, to: string, f: Partial<GameEvent> = {}) {
      return b.ev('catch', 'us', { actor_id: from, receiver_id: to, ...f })
    },
    goal(from: string | null, to: string) {
      return b.ev('goal', 'us', { actor_id: from, receiver_id: to })
    },
    themGoal() {
      return b.ev('goal', 'them')
    },
  }
  return b
}
