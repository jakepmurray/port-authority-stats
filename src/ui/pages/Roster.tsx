import { useState } from 'react'
import { actions } from '../../db/actions'
import { repo } from '../../db/repo'
import { PlayerSchema, type Player } from '../../domain/schema'
import { usePlayers } from '../hooks'
import { Badge, Btn, Card, Input, Select } from '../kit'

export function Roster() {
  const [showDeleted, setShowDeleted] = useState(false)
  const players = usePlayers(true)
  const list = (players ?? []).filter((p) => showDeleted || !p.deleted)
  const counts = { W: 0, M: 0 }
  for (const p of players ?? []) if (!p.deleted && p.active) counts[p.gender_match]++

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <Card
        title={`Roster · ${counts.W} WMP / ${counts.M} MMP active`}
        actions={
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> show deleted
          </label>
        }
      >
        <AddPlayer existing={players ?? []} />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-slate-400">
              <tr>
                <th className="w-16 p-1">#</th>
                <th className="p-1">Name</th>
                <th className="w-24 p-1">Match</th>
                <th className="w-28 p-1">Role</th>
                <th className="w-16 p-1">Active</th>
                <th className="w-20 p-1" />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <PlayerRow key={p.id} p={p} />
              ))}
            </tbody>
          </table>
          {list.length === 0 && <p className="p-3 text-sm text-slate-500">No players yet. Add your roster above.</p>}
        </div>
      </Card>
    </div>
  )
}

function AddPlayer({ existing }: { existing: Player[] }) {
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [g, setG] = useState<'W' | 'M'>('W')
  const [err, setErr] = useState<string | null>(null)
  const add = async () => {
    setErr(null)
    if (existing.some((p) => !p.deleted && p.number === number)) return setErr(`#${number} is already taken`)
    const team = await actions.ensureTeam()
    const probe = PlayerSchema.safeParse({ id: 'x', team_id: team.id, name: name.trim(), number, gender_match: g, created_at: 0, updated_at: 0 })
    if (!probe.success) return setErr(probe.error.issues[0].message)
    await repo.create('players', { team_id: team.id, name: name.trim(), number, gender_match: g })
    setName('')
    setNumber('')
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <Input aria-label="Number" placeholder="#" inputMode="numeric" className="w-16" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 2))} />
      <Input aria-label="Name" placeholder="Name" className="min-w-40 flex-1" value={name} onChange={(e) => setName(e.target.value)} />
      <Select aria-label="Gender match" value={g} onChange={(e) => setG(e.target.value as 'W' | 'M')}>
        <option value="W">WMP</option>
        <option value="M">MMP</option>
      </Select>
      <Btn tone="primary" type="submit">Add player</Btn>
      {err && <span className="w-full text-xs text-rose-300">{err}</span>}
    </form>
  )
}

function PlayerRow({ p }: { p: Player }) {
  const save = (patch: Partial<Player>) => void repo.update('players', p.id, patch, { byHand: true }).catch((e: Error) => alert(e.message))
  return (
    <tr className={`border-t border-slate-800 ${p.deleted ? 'opacity-40' : ''}`}>
      <td className="p-1">
        <Input
          aria-label="Number"
          className="w-14"
          defaultValue={p.number}
          inputMode="numeric"
          onBlur={(e) => e.target.value !== p.number && save({ number: e.target.value })}
        />
      </td>
      <td className="p-1">
        <Input aria-label="Name" className="w-full" defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && save({ name: e.target.value.trim() })} />
      </td>
      <td className="p-1">
        <Select aria-label="Gender match" value={p.gender_match} onChange={(e) => save({ gender_match: e.target.value as 'W' | 'M' })}>
          <option value="W">WMP</option>
          <option value="M">MMP</option>
        </Select>
      </td>
      <td className="p-1">
        <Select aria-label="Role" value={p.role} onChange={(e) => save({ role: e.target.value as Player['role'] })}>
          <option value="handler">Handler</option>
          <option value="cutter">Cutter</option>
          <option value="hybrid">Hybrid</option>
        </Select>
      </td>
      <td className="p-1 text-center">
        <input aria-label="Active" type="checkbox" checked={p.active} onChange={(e) => save({ active: e.target.checked })} />
      </td>
      <td className="p-1 text-right">
        {p.deleted ? (
          <Btn size="sm" onClick={() => void repo.restore('players', p.id)}>Restore</Btn>
        ) : (
          <Btn size="sm" tone="ghost" onClick={() => void repo.softDelete('players', p.id)} title="Delete (can be restored)">
            Delete
          </Btn>
        )}
        {p.edited_at && <Badge>edited</Badge>}
      </td>
    </tr>
  )
}
