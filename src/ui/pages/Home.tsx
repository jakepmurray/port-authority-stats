import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { computeGameStats } from '../../domain/stats'
import { go, usePlayers } from '../hooks'
import { Badge, Btn, Card } from '../kit'

export function Home() {
  const [showDeleted, setShowDeleted] = useState(false)
  const players = usePlayers()
  const data = useLiveQuery(async () => {
    const [games, points, events] = await Promise.all([db.games.toArray(), db.points.toArray(), db.events.toArray()])
    return games
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at)
      .map((g) => ({ g, s: computeGameStats(g, points, events).state }))
  })
  const list = (data ?? []).filter((x) => showDeleted || !x.g.deleted)
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      {players && players.length === 0 && (
        <Card title="Welcome">
          <p className="text-sm text-slate-300">
            Start by adding your <a className="text-sky-300 underline" href="#/roster">roster</a>, then create a game and paste the YouTube link to the film.
            Everything is stored in this browser; use <a className="text-sky-300 underline" href="#/data">Data</a> to back it up.
          </p>
        </Card>
      )}
      <Card
        title="Games"
        actions={
          <>
            <label className="mr-2 flex items-center gap-1 text-xs text-slate-400">
              <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> deleted
            </label>
            <Btn tone="primary" onClick={() => go('new')}>New game</Btn>
          </>
        }
      >
        <ul className="divide-y divide-slate-800">
          {list.map(({ g, s }) => (
            <li key={g.id} className={`flex items-center gap-3 py-2 ${g.deleted ? 'opacity-40' : ''}`}>
              <button type="button" className="flex flex-1 flex-col text-left" onClick={() => go(`game/${g.id}`)}>
                <span className="font-medium">vs {g.opponent}</span>
                <span className="text-xs text-slate-400">
                  {[g.date, g.tournament].filter(Boolean).join(' · ')} {g.video.youtube_id ? '· 🎬 film' : ''}
                </span>
              </button>
              <span className="text-lg font-semibold tabular-nums">
                {s.score.us}–{s.score.them}
              </span>
              {s.result ? <Badge tone={s.result === 'W' ? 'good' : s.result === 'L' ? 'bad' : 'default'}>{s.result}</Badge> : <Badge>{s.points.length ? 'in progress' : 'new'}</Badge>}
              {g.deleted && (
                <Btn size="sm" onClick={() => void repo.restore('games', g.id)}>Restore</Btn>
              )}
            </li>
          ))}
        </ul>
        {list.length === 0 && <p className="py-3 text-sm text-slate-500">No games yet.</p>}
      </Card>
    </div>
  )
}
