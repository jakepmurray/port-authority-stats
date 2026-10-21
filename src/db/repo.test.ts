import { beforeEach, describe, expect, it } from 'vitest'
import { StatsDB } from './db'
import { Repo } from './repo'

let repo: Repo
beforeEach(async () => {
  repo = new Repo(new StatsDB(`test-${crypto.randomUUID()}`))
})

describe('Repo', () => {
  it('creates, validates and queues rows', async () => {
    const team = await repo.create('teams', { name: 'Port Authority' })
    expect(team.division).toBe('Mixed')
    const q = await repo.db.syncQueue.toArray()
    expect(q).toHaveLength(1)
    expect(q[0].row_id).toBe(team.id)
    await expect(repo.create('players', { team_id: team.id, name: '', number: '1', gender_match: 'W' })).rejects.toThrow()
  })

  it('marks hand edits and soft deletes', async () => {
    const team = await repo.create('teams', { name: 'PA' })
    const p = await repo.create('players', { team_id: team.id, name: 'Sam', number: '12', gender_match: 'M' })
    const auto = await repo.update('players', p.id, { role: 'handler' })
    expect(auto.edited_at).toBeNull()
    const edited = await repo.update('players', p.id, { name: 'Samuel' }, { byHand: true })
    expect(edited.edited_at).not.toBeNull()
    expect(edited.created_at).toBe(p.created_at)
    await repo.softDelete('players', p.id)
    expect(await repo.live('players')).toHaveLength(0)
    expect(await repo.all('players')).toHaveLength(1)
    await repo.restore('players', p.id)
    expect(await repo.live('players')).toHaveLength(1)
  })
})
