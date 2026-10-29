import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../../db/db'
import { buildGameRows, gameTable, recordText, selectGames, tagsInUse, totals, DEFAULT_FILTER } from '../../domain/dashboard'
import { rankLookup } from '../../domain/opponents'
import { sumPlayerStats } from '../../domain/stats'
import { usePlayers } from '../hooks'
import { Card, Select } from '../kit'
import { OpponentRanks } from '../OpponentRanks'
import { asDash, hashWith, useQueryFilter } from '../queryFilter'
import { GameStatsTable, PlayerStatsTable } from '../StatsTables'
import { TableTagFilter } from '../TableFilter'
import { useView } from '../view'

export function Season() {
  const { readOnly, base } = useView()
  const { filter, setFilter, shareUrl } = useQueryFilter()
  const players = usePlayers(true)
  const data = useLiveQuery(async () => {
    const [games, points, events, opponents] = await Promise.all([db.games.toArray(), db.points.toArray(), db.events.toArray(), db.opponents.toArray()])
    return { games, points, events, opponents }
  })
  const all = useMemo(() => (data ? selectGames(data, DEFAULT_FILTER) : []), [data])
  const tournaments = useMemo(() => [...new Set(all.map((g) => g.game.tournament).filter(Boolean))].sort(), [all])
  const result = useMemo(() => {
    if (!data) return null
    const rows = buildGameRows(data, asDash(filter))
    const ids = new Set(rows.map((r) => r.game.id))
    // With "only tagged events", passes are rarely tagged, so completion % would read ~0: hide it.
    const tagOnly = filter.tags.length > 0 && filter.tagScope === 'only'
    const stats = [...sumPlayerStats(rows.map((r) => [...r.stats.players.values()])).values()].map((s) => (tagOnly ? { ...s, comp_pct: null } : s))
    return {
      rows,
      record: totals(rows).record,
      games: gameTable(rows, rankLookup(data.opponents)),
      players: stats,
      tags: tagsInUse(data.events.filter((e) => ids.has(e.game_id))),
    }
  }, [data, filter])
  const byId = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4" data-testid="season">
      <Card
        title={result ? `Season · ${result.rows.length} games · ${recordText(result.record)}` : 'Season'}
        actions={
          <Select value={filter.tournament} onChange={(e) => setFilter({ ...filter, tournament: e.target.value })} aria-label="Tournament">
            <option value="">All tournaments</option>
            {tournaments.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        }
      >
        {result && (
          <div className="flex flex-col gap-3">
            <TableTagFilter filter={filter} setFilter={setFilter} tags={result.tags} rows={result.rows} shareUrl={shareUrl} />
            <div>
              <h3 className="mb-1 text-xs font-semibold text-slate-300">Games</h3>
              <GameStatsTable rows={result.games} href={(id) => hashWith(`#/${base}game/${id}`, { ...filter, tournament: '' })} />
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-slate-300">Players</h3>
              <PlayerStatsTable stats={result.players} byId={byId} showYards />
            </div>
          </div>
        )}
      </Card>
      {data && <OpponentRanks games={data.games} opponents={data.opponents} readOnly={readOnly} />}
    </div>
  )
}
