import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../../db/db'
import { computeGameStats, sumPlayerStats } from '../../domain/stats'
import { usePlayers } from '../hooks'
import { Card, Select } from '../kit'
import { PlayerStatsTable } from '../StatsTables'

export function Season() {
  const [tournament, setTournament] = useState('')
  const players = usePlayers(true)
  const data = useLiveQuery(async () => {
    const [games, points, events] = await Promise.all([db.games.toArray(), db.points.toArray(), db.events.toArray()])
    return { games: games.filter((g) => !g.deleted), points, events }
  })
  const tournaments = useMemo(() => [...new Set((data?.games ?? []).map((g) => g.tournament).filter(Boolean))].sort(), [data])
  const result = useMemo(() => {
    if (!data) return null
    const games = data.games.filter((g) => !tournament || g.tournament === tournament)
    const per = games.map((g) => computeGameStats(g, data.points, data.events))
    const record = per.reduce(
      (acc, s) => {
        if (s.state.result) acc[s.state.result === 'W' ? 'w' : s.state.result === 'L' ? 'l' : 't']++
        else acc.open++
        return acc
      },
      { w: 0, l: 0, t: 0, open: 0 },
    )
    return { games: games.length, record, players: [...sumPlayerStats(per.map((s) => [...s.players.values()])).values()] }
  }, [data, tournament])
  const byId = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Card
        title={result ? `Season · ${result.games} games · ${result.record.w}–${result.record.l}${result.record.t ? `–${result.record.t}` : ''}${result.record.open ? ` (+${result.record.open} open)` : ''}` : 'Season'}
        actions={
          <Select value={tournament} onChange={(e) => setTournament(e.target.value)} aria-label="Tournament">
            <option value="">All tournaments</option>
            {tournaments.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        }
      >
        {result && <PlayerStatsTable stats={result.players} byId={byId} showYards />}
      </Card>
    </div>
  )
}
