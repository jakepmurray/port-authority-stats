import { shortDate, type DrillRow } from '../../domain/dashboard'
import { ytLink } from '../../domain/exports'
import type { Player } from '../../domain/schema'
import { userTags } from '../../domain/tags'
import { Badge, Btn, Card } from '../kit'
import { describeEvent } from '../labels'

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

/** The events behind a chart element, with links to the game and the moment on video. */
export function DrillPanel({ title, rows, byId, onClose, onFilterTag }: { title: string; rows: DrillRow[]; byId: Map<string, Player>; onClose: () => void; onFilterTag?: () => void }) {
  const shown = rows.slice(0, 200)
  return (
    <Card
      title={<span data-testid="drill-title">{title} · {rows.length} event{rows.length === 1 ? '' : 's'}</span>}
      actions={
        <>
          {onFilterTag && <Btn size="sm" onClick={onFilterTag}>Filter by this tag</Btn>}
          <Btn size="sm" tone="ghost" onClick={onClose}>Close</Btn>
        </>
      }
    >
      {!rows.length ? (
        <p className="text-sm text-slate-400">No events.</p>
      ) : (
        <ul className="max-h-[50vh] divide-y divide-slate-800 overflow-auto text-sm" data-testid="drill-list">
          {shown.map(({ event: e, game: g, point: p }) => {
            const link = e.source !== 'import' ? ytLink(g, e.video_time) : ''
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                <a className="text-xs text-sky-300 underline" href={`#/game/${g.id}`} title={g.tournament}>
                  {shortDate(g.date) ? `${shortDate(g.date)} ` : ''}vs {g.opponent}
                </a>
                {p && <span className="text-xs text-slate-500">pt {p.idx} · {p.start_on} · {p.score_us}–{p.score_them}</span>}
                <span className="min-w-0 flex-1 text-slate-200">{describeEvent(e, byId, g.opponent)}</span>
                {userTags(e.tags).map((t) => <Badge key={t}>{t}</Badge>)}
                {e.source === 'import' && <Badge tone="info">import</Badge>}
                {link && (
                  <a className="text-xs text-emerald-300 underline" href={link} target="_blank" rel="noreferrer" title="Open the film at this moment">
                    ▶ {mmss(e.video_time!)}
                  </a>
                )}
              </li>
            )
          })}
          {rows.length > shown.length && <li className="py-1.5 text-xs text-slate-500">…and {rows.length - shown.length} more. Narrow the filters to see them.</li>}
        </ul>
      )}
    </Card>
  )
}
