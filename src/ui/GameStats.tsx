import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../db/db'
import { buildGameRows, tagsInUse } from '../domain/dashboard'
import { rankFor } from '../domain/opponents'
import type { Game, GameEvent, Player, Point } from '../domain/schema'
import { computeGameStats } from '../domain/stats'
import { Badge } from './kit'
import { asDash, useQueryFilter } from './queryFilter'
import { CallsTable, PlayerStatsTable, TagBreakdownTable, TeamSummary } from './StatsTables'
import { TableTagFilter } from './TableFilter'

/** A game's stat tables with the tag filter (kept in the page link: ?tags=…&ts=…). */
export function GameStatsPanel({ game, points, events, byId }: { game: Game; points: Point[]; events: GameEvent[]; byId: Map<string, Player> }) {
  const { filter, setFilter, shareUrl } = useQueryFilter()
  const opponents = useLiveQuery(() => db.opponents.toArray(), [])
  const rank = rankFor(game, opponents ?? [])
  const { rows, stats, tags } = useMemo(() => {
    const rows = buildGameRows({ games: [game], points, events }, asDash({ ...filter, tournament: '' }, [game.id]))
    return { rows, stats: rows[0]?.stats ?? computeGameStats(game, points, events), tags: tagsInUse(events) }
  }, [game, points, events, filter])
  const tagOnly = filter.tags.length > 0 && filter.tagScope === 'only'
  const players = [...stats.players.values()].map((s) => (tagOnly ? { ...s, comp_pct: null } : s))
  return (
    <div className="flex flex-col gap-3" data-testid="game-stats">
      <TableTagFilter filter={filter} setFilter={setFilter} tags={tags} rows={rows} shareUrl={shareUrl} />
      {rank && (
        <div className="text-xs text-slate-400" data-testid="game-rank">
          <Badge tone="info">USAU #{rank.rank}</Badge> {game.opponent}
          {rank.season ? `, ${rank.season} season` : ''}
        </div>
      )}
      <TeamSummary team={stats.team} opp={stats.opponent} opponent={game.opponent} />
      <PlayerStatsTable stats={players} byId={byId} showYards={events.some((e) => e.y !== null)} />
      <CallsTable team={stats.team} players={players} byId={byId} opponent={game.opponent} />
      <TagBreakdownTable team={stats.team} opp={stats.opponent} players={players} byId={byId} opponent={game.opponent} />
    </div>
  )
}
