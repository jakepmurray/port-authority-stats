import { useState } from 'react'
import { footnotes, type GameRow } from '../domain/dashboard'
import { TagPicker } from './dashboard/Filters'
import { Btn } from './kit'
import { asDash, type TableFilter } from './queryFilter'

/** Tag filter above a stat table, with a "Copy link" for the filtered view and a note on what changed. */
export function TableTagFilter({
  filter, setFilter, tags, rows, shareUrl,
}: { filter: TableFilter; setFilter: (f: TableFilter) => void; tags: { tag: string; n: number }[]; rows: GameRow[]; shareUrl: () => string }) {
  const [open, setOpen] = useState(filter.tags.length > 0)
  const [copied, setCopied] = useState(false)
  const note = footnotes(rows, asDash(filter)).tagNote
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-2" aria-label="Tag filter" data-testid="table-filter">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="text-xs font-semibold text-slate-300" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Tag filter{filter.tags.length ? ` (${filter.tags.join(', ')})` : ''} {open ? '▴' : '▾'}
        </button>
        <span className="ml-auto">
          <Btn
            size="sm"
            tone="ghost"
            title="Copy a link to this view"
            onClick={() => {
              void navigator.clipboard?.writeText(shareUrl()).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Btn>
        </span>
      </div>
      {open && (
        <div className="mt-2">
          <TagPicker compact filter={filter} set={(p) => setFilter({ ...filter, ...p })} tags={tags} />
        </div>
      )}
      {note && (
        <p className="mt-1 text-[11px] text-amber-200/90" data-testid="table-filter-note">
          Filtered: {note}
        </p>
      )}
    </section>
  )
}
