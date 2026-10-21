import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { db } from './db/db'
import { actions } from './db/actions'
import { useRoute } from './ui/hooks'
import { DataPage } from './ui/pages/DataPage'
import { GameSetup } from './ui/pages/GameSetup'
import { Home } from './ui/pages/Home'
import { Popout } from './ui/pages/Popout'
import { Roster } from './ui/pages/Roster'
import { Season } from './ui/pages/Season'
import { Workspace } from './ui/pages/Workspace'
import { Settings } from './ui/pages/Settings'
import { SyncBadge } from './ui/SyncBadge'
import { startSync } from './sync'

function EditGame({ id }: { id: string }) {
  const game = useLiveQuery(() => db.games.get(id), [id])
  if (game === undefined) return <p className="p-4 text-slate-400">Loading…</p>
  return <GameSetup key={game.id} game={game} />
}

export default function App() {
  const route = useRoute()
  useEffect(() => {
    void actions.ensureTeam()
    startSync()
  }, [])

  if (route[0] === 'popout' && route[1]) return <Popout gameId={route[1]} />

  const [a, b, c] = route
  let page
  if (a === 'roster') page = <Roster />
  else if (a === 'new') page = <GameSetup />
  else if (a === 'season') page = <Season />
  else if (a === 'data') page = <DataPage />
  else if (a === 'settings') page = <Settings />
  else if (a === 'game' && b && c === 'edit') page = <EditGame id={b} />
  else if (a === 'game' && b) page = <Workspace key={b} gameId={b} />
  else page = <Home />

  const link = (href: string, label: string, active: boolean) => (
    <a href={href} className={`rounded-md px-2 py-1 text-sm ${active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}>
      {label}
    </a>
  )
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-1 border-b border-slate-800 px-3 py-1.5">
        <a href="#/" className="mr-2 flex items-center gap-2 font-bold text-sky-300">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-6 w-6" />
          <span className="hidden sm:inline">Port Authority Stats</span>
        </a>
        {link('#/', 'Games', !a || a === 'game' || a === 'new')}
        {link('#/roster', 'Roster', a === 'roster')}
        {link('#/season', 'Season', a === 'season')}
        {link('#/data', 'Data', a === 'data')}
        {link('#/settings', 'Settings', a === 'settings')}
        <span className="ml-auto">
          <SyncBadge />
        </span>
        <a className="ml-2 text-xs text-slate-500 hover:text-slate-300" href="https://github.com/jakepmurray/port-authority-stats" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-auto">{page}</main>
    </div>
  )
}
