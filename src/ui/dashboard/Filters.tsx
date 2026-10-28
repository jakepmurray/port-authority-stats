import { useState, type ReactNode } from 'react'
import { activeFilterCount, DEFAULT_FILTER, SOURCES, type DashFilter, type SourceKind } from '../../domain/dashboard'
import type { Game } from '../../domain/schema'
import { Btn, Select } from '../kit'

const SOURCE_LABEL: Record<SourceKind, string> = { film: 'Film', live: 'Live', tagger: 'Tagger', import: 'Imported' }

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? 'border-sky-400 bg-sky-500/20 text-sky-100' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'}`}
    >
      {children}
    </button>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-slate-700">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`px-2.5 py-1 text-xs ${value === v ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function Filters({
  filter, setFilter, tournaments, games, sources, tags,
}: {
  filter: DashFilter
  setFilter: (f: DashFilter) => void
  tournaments: string[]
  games: { game: Game; label: string }[]
  sources: SourceKind[]
  tags: { tag: string; n: number }[]
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const n = activeFilterCount(filter)
  const set = (p: Partial<DashFilter>) => setFilter({ ...filter, ...p })
  const visibleGames = games.filter((g) => !filter.tournament || g.game.tournament === filter.tournament)
  const tagOn = (t: string) => filter.tags.some((x) => x.toLowerCase() === t.toLowerCase())

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3" aria-label="Filters" data-testid="dash-filters">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="text-sm font-semibold text-slate-200 md:pointer-events-none" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Filters{n ? ` (${n})` : ''} <span className="text-slate-500 md:hidden">{open ? '▴' : '▾'}</span>
        </button>
        <Select aria-label="Tournament" value={filter.tournament} onChange={(e) => set({ tournament: e.target.value, games: [] })} className="max-w-[12rem] py-1 text-xs">
          <option value="">All tournaments</option>
          {tournaments.map((t) => <option key={t}>{t}</option>)}
        </Select>
        <Segmented label="Points" value={filter.side} onChange={(side) => set({ side })} options={[['all', 'All points'], ['O', 'O-line'], ['D', 'D-line']]} />
        <div className="ml-auto flex gap-1">
          {n > 0 && <Btn size="sm" tone="ghost" onClick={() => setFilter(DEFAULT_FILTER)}>Reset</Btn>}
          <Btn
            size="sm"
            tone="ghost"
            title="Copy a link to this view"
            onClick={() => {
              void navigator.clipboard?.writeText(window.location.href).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Btn>
        </div>
      </div>

      <div className={`${open ? 'flex' : 'hidden'} mt-3 flex-col gap-3 md:flex`}>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Games {filter.games.length ? `(${filter.games.length} picked)` : '(all)'}</span>
          <div className="flex max-h-28 flex-wrap gap-1 overflow-auto">
            {visibleGames.map(({ game, label }) => (
              <Chip key={game.id} on={filter.games.includes(game.id)} onClick={() => set({ games: toggle(filter.games, game.id) })} title={game.tournament}>
                {label}
              </Chip>
            ))}
            {!visibleGames.length && <span className="text-xs text-slate-500">No games</span>}
          </div>
        </div>
        {sources.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-slate-400">Source</span>
            {SOURCES.filter((s) => sources.includes(s)).map((s) => (
              <Chip key={s} on={filter.sources.includes(s)} onClick={() => set({ sources: toggle(filter.sources, s) })}>
                {SOURCE_LABEL[s]}
              </Chip>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-slate-400">Tags</span>
            {tags.map(({ tag, n: count }) => (
              <Chip key={tag} on={tagOn(tag)} onClick={() => set({ tags: tagOn(tag) ? filter.tags.filter((x) => x.toLowerCase() !== tag.toLowerCase()) : [...filter.tags, tag] })}>
                {tag} <span className="text-slate-500">{count}</span>
              </Chip>
            ))}
            {!tags.length && <span className="text-xs text-slate-500">No tagged events yet. Tag turnovers and blocks while entering stats.</span>}
          </div>
          {filter.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {filter.tags.length > 1 && <Segmented label="Tag match" value={filter.tagMode} onChange={(tagMode) => set({ tagMode })} options={[['any', 'Any tag'], ['all', 'All tags']]} />}
              <Select aria-label="Tag filter mode" value={filter.tagScope} onChange={(e) => set({ tagScope: e.target.value as DashFilter['tagScope'] })} className="py-1 text-xs">
                <option value="only">Count only events with these tags</option>
                <option value="without">Count only events without them</option>
                <option value="drop_points">Leave out points that contain them</option>
              </Select>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Tags live on events (turnovers, blocks, calls). The first two modes narrow the event counts (turnovers, Ds, passes, goals, calls) and keep the
            score, holds, breaks and points played as they are. "Leave out points" drops the whole point, so it changes holds and breaks too.
          </p>
        </div>
      </div>
    </section>
  )
}
