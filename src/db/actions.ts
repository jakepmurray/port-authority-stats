import { ratioForPoint } from '../domain/abba'
import { makeBackup, mergeRows, parseBackup, type Backup } from '../domain/backup'
import type { EventDraft } from '../domain/entry'
import { deriveGame, liveOnly, missedState, outcomeOf, replayPoint, type CapKind } from '../domain/game'
import { normalizeTag } from '../domain/tags'
import { opponentId } from '../domain/opponents'
import type { Game, GameEvent, GenderMatch, Opponent, Point, Side } from '../domain/schema'
import { planGame, type NameChoice, type UAGame } from '../domain/ultianalytics'
import { repo as defaultRepo, type NewRow, type Repo } from './repo'

export const TEAM_NAME = 'Port Authority'

export interface TimeStamp {
  video_time: number | null
  time_source: GameEvent['time_source']
}

export class Actions {
  readonly repo: Repo
  constructor(repo: Repo = defaultRepo) {
    this.repo = repo
  }

  /** The single team this app tracks; created on first run. */
  async ensureTeam() {
    const teams = await this.repo.live('teams')
    return teams[0] ?? this.repo.create('teams', { name: TEAM_NAME, division: 'Mixed' })
  }

  async createGame(input: Omit<NewRow<'games'>, 'team_id'>) {
    const team = await this.ensureTeam()
    return this.repo.create('games', { ...input, team_id: team.id })
  }

  private async gameData(gameId: string) {
    const [game, points, events] = await Promise.all([
      this.repo.get('games', gameId),
      this.repo.pointsOfGame(gameId),
      this.repo.eventsOfGame(gameId),
    ])
    if (!game) throw new Error('Game not found')
    return { game, points, events }
  }

  /** Start the next point. Ratio and O/D default to what the game state predicts. */
  async startPoint(
    gameId: string,
    opts: {
      line: string[]; pulled_by?: string | null; start_on?: Side; ratio?: Point['ratio']; video_time?: number | null
      /** Record a point that is not on the film, with its result entered by hand. */
      missed?: { result: Point['manual_result'] }
    },
  ) {
    const { game, points, events } = await this.gameData(gameId)
    const st = deriveGame(game, points, events)
    if (st.current) throw new Error('Finish the current point first')
    if (st.ended) throw new Error('The game has ended. Reopen it to add points.')
    const idx = st.next.idx
    return this.repo.create('points', {
      game_id: gameId,
      idx,
      score_us: st.score.us,
      score_them: st.score.them,
      start_on: opts.start_on ?? st.next.start_on,
      ratio: opts.ratio ?? ratioForPoint(game.ratio_first, idx),
      line: opts.line,
      pulled_by: opts.pulled_by ?? null,
      video_start: opts.video_time ?? null,
      missed_on_film: !!opts.missed,
      manual_result: opts.missed?.result ?? null,
      outcome: opts.missed ? outcomeOf(opts.start_on ?? st.next.start_on, opts.missed.result) : 'none',
    })
  }

  /** Mark a point as (not) missed on film, with the hand-entered result. */
  async setPointMissed(pointId: string, missed: boolean, result: Point['manual_result'] = null) {
    return this.editPoint(pointId, { missed_on_film: missed, manual_result: missed ? result : null })
  }

  /** Set an event's tags. Tags add context only; they never change who is charged. */
  async tagEvent(id: string, tags: string[], byHand = false) {
    const clean = [...new Map(tags.map(normalizeTag).filter(Boolean).map((t) => [t.toLowerCase(), t])).values()]
    return this.repo.update('events', id, { tags: clean }, { byHand })
  }

  /** Save a custom tag on the team so it is offered again in every game. */
  async addCustomTag(tag: string) {
    const t = normalizeTag(tag)
    if (!t) return null
    const team = await this.ensureTeam()
    const list = team.custom_tags ?? []
    if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return team
    return this.repo.update('teams', team.id, { custom_tags: [...list, t] })
  }

  async removeCustomTag(tag: string) {
    const team = await this.ensureTeam()
    return this.repo.update('teams', team.id, { custom_tags: (team.custom_tags ?? []).filter((x) => x.toLowerCase() !== tag.toLowerCase()) })
  }

  /** Append an event to a point (or insert after `afterId`). Updates the point's cached outcome. */
  async addEvent(
    pointId: string,
    draft: EventDraft & Partial<Pick<GameEvent, 'note'>>,
    time: TimeStamp,
    opts: { afterId?: string; source?: GameEvent['source'] } = {},
  ) {
    const point = await this.repo.get('points', pointId)
    if (!point) throw new Error('Point not found')
    const evs = liveOnly(await this.repo.db.events.where('point_id').equals(pointId).toArray()).sort((a, b) => a.seq - b.seq)
    let seq: number
    if (opts.afterId) {
      const i = evs.findIndex((e) => e.id === opts.afterId)
      if (i < 0) throw new Error('Event not found')
      const next = evs[i + 1]
      seq = next ? (evs[i].seq + next.seq) / 2 : evs[i].seq + 1
    } else if (opts.afterId === '') {
      seq = evs.length ? evs[0].seq - 1 : 1 // insert at the start
    } else {
      seq = (evs.at(-1)?.seq ?? 0) + 1
    }
    const ev = await this.repo.create('events', {
      ...draft,
      game_id: point.game_id,
      point_id: pointId,
      seq,
      video_time: time.video_time,
      time_source: time.video_time === null ? 'none' : time.time_source,
      wall_time: Date.now(),
      source: opts.source ?? 'film',
    })
    if (draft.type === 'goal' || draft.type === 'callahan') {
      await this.repo.update('points', pointId, { video_end: time.video_time ?? point.video_end })
    }
    await this.refreshPoint(pointId)
    return ev
  }

  /** Recompute a point's cached outcome after any change to its events. */
  async refreshPoint(pointId: string) {
    const point = await this.repo.get('points', pointId)
    if (!point) return
    const evs = liveOnly(await this.repo.db.events.where('point_id').equals(pointId).toArray()).sort((a, b) => a.seq - b.seq)
    const st = point.missed_on_film === true ? missedState(point) : replayPoint(point.start_on, evs)
    const outcome = outcomeOf(point.start_on, st.scorer)
    if (outcome !== point.outcome) await this.repo.update('points', pointId, { outcome })
  }

  async editEvent(id: string, patch: Partial<GameEvent>) {
    const ev = await this.repo.update('events', id, patch, { byHand: true })
    await this.refreshPoint(ev.point_id)
    return ev
  }

  async deleteEvent(id: string) {
    const ev = await this.repo.softDelete('events', id)
    await this.refreshPoint(ev.point_id)
    if (ev.type === 'end') await this.setEnded(ev.game_id, null)
    return ev
  }

  async restoreEvent(id: string) {
    const ev = await this.repo.restore('events', id)
    await this.refreshPoint(ev.point_id)
    if (ev.type === 'end') await this.setEnded(ev.game_id, ev.wall_time ?? Date.now())
    return ev
  }

  private async setEnded(gameId: string, at: number | null) {
    const g = await this.repo.get('games', gameId)
    if (g && (g.ended_at ?? null) !== at) await this.repo.update('games', gameId, { ended_at: at }, { byHand: true })
  }

  /**
   * End the game by hand, whatever the score or clock. The final score is what is recorded
   * (an unfinished point stays unscored). Adds an 'end' marker (with the video time) to the
   * last point so it shows in the play-by-play; deleting or undoing that marker reopens the game.
   */
  async endGame(gameId: string, time: TimeStamp = { video_time: null, time_source: 'none' }) {
    const { game, points } = await this.gameData(gameId)
    if (game.ended_at) return game
    const last = liveOnly(points).sort((a, b) => a.idx - b.idx).at(-1)
    if (last) await this.addEvent(last.id, { type: 'end', team: 'us', actor_id: null, receiver_id: null, defender_id: null, tags: [] }, time)
    return this.repo.update('games', gameId, { ended_at: Date.now() }, { byHand: true })
  }

  /** Reopen an ended game: clears ended_at and removes the end marker(s). */
  async reopenGame(gameId: string) {
    const { events } = await this.gameData(gameId)
    for (const e of liveOnly(events).filter((x) => x.type === 'end')) {
      await this.repo.softDelete('events', e.id)
    }
    return this.repo.update('games', gameId, { ended_at: null }, { byHand: true })
  }

  /**
   * "Cap went off": a cap marker with the current film time, mid-point (on the point in progress)
   * or between points (on the last finished point, so it applies from the next point).
   */
  async markCap(gameId: string, kind: CapKind, time: TimeStamp) {
    const { game, points, events } = await this.gameData(gameId)
    const st = deriveGame(game, points, events)
    const target = st.current?.point ?? st.points.at(-1)?.point
    if (!target) throw new Error('Start the first point before marking a cap')
    return this.addEvent(target.id, { type: 'cap', team: 'us', actor_id: null, receiver_id: null, defender_id: null, tags: [kind] }, time)
  }

  async editPoint(id: string, patch: Partial<Point>) {
    const p = await this.repo.update('points', id, patch, { byHand: true })
    await this.refreshPoint(id)
    return p
  }

  /** Undo: soft-delete the last event of the last point; if that point is empty, remove the point. */
  async undo(gameId: string): Promise<'event' | 'point' | null> {
    const points = liveOnly(await this.repo.pointsOfGame(gameId))
    const last = points.at(-1)
    if (!last) return null
    const evs = liveOnly(await this.repo.db.events.where('point_id').equals(last.id).toArray()).sort((a, b) => a.seq - b.seq)
    const ev = evs.at(-1)
    if (ev) {
      await this.repo.softDelete('events', ev.id, false)
      await this.refreshPoint(last.id)
      if (ev.type === 'end') await this.setEnded(gameId, null)
      return 'event'
    }
    await this.repo.softDelete('points', last.id, false)
    return 'point'
  }

  /**
   * Import UltiAnalytics games: create the new players first, then each game with its points
   * and events (source 'import'). Everything lands in the sync queue like a hand-entered game.
   */
  async importUltiAnalytics(
    games: UAGame[],
    choices: Map<string, NameChoice>,
    newPlayers: Map<string, { name: string; number: string; gender_match: GenderMatch }>,
  ) {
    const team = await this.ensureTeam()
    const d = this.repo.db
    const ids = new Map<string, string>()
    let created = 0
    const saved: Game[] = []
    await d.transaction('rw', [d.players, d.games, d.points, d.events, d.syncQueue], async () => {
      for (const [name, c] of choices) {
        if (c.kind === 'player') ids.set(name, c.id)
        else if (c.kind === 'new') {
          const np = newPlayers.get(name)
          if (!np) throw new Error(`Missing details for new player ${name}`)
          const p = await this.repo.create('players', { team_id: team.id, name: np.name.trim() || name, number: np.number, gender_match: np.gender_match, role: 'hybrid' })
          ids.set(name, p.id)
          created++
        }
      }
      const P = (n: string | null) => (n ? (ids.get(n) ?? null) : null)
      for (const ua of games) {
        const plan = planGame(ua, P, { team_id: team.id })
        await this.repo.create('games', plan.game)
        await this.repo.bulkCreate('points', plan.points)
        await this.repo.bulkCreate('events', plan.events)
        saved.push(plan.game)
      }
    })
    return { games: saved, playersCreated: created }
  }

  /**
   * Set opponent ranks (one per opponent and season; '' = every season). Shared team data:
   * anyone may change it and the newer edit wins. rank null clears it.
   */
  async setRanks(list: { name: string; season: string; rank: number | null; usau_name?: string }[], editedBy = '') {
    const team = await this.ensureTeam()
    const out: Opponent[] = []
    for (const r of list) {
      const id = opponentId(r.name, r.season)
      const cur = await this.repo.get('opponents', id)
      const patch = { rank: r.rank, usau_name: r.usau_name ?? cur?.usau_name ?? '', edited_by: editedBy, deleted: false }
      if (cur) {
        if (cur.rank === patch.rank && cur.usau_name === patch.usau_name && !cur.deleted) continue
        out.push(await this.repo.update('opponents', id, patch, { byHand: true }))
      } else if (r.rank !== null) {
        out.push(await this.repo.create('opponents', { id, team_id: team.id, name: r.name.trim(), season: r.season, ...patch }))
      }
    }
    return out
  }

  async exportBackup(): Promise<Backup> {
    const [teams, players, games, points, events, opponents] = await Promise.all([
      this.repo.all('teams'),
      this.repo.all('players'),
      this.repo.all('games'),
      this.repo.all('points'),
      this.repo.all('events'),
      this.repo.all('opponents'),
    ])
    return makeBackup({ teams, players, games, points, events, opponents })
  }

  /** Restore a backup. 'merge' keeps whichever copy of each row is newer; 'replace' wipes first. */
  async importBackup(json: string, mode: 'merge' | 'replace') {
    const b = parseBackup(json)
    const d = this.repo.db
    const counts: Record<string, number> = {}
    await d.transaction('rw', [d.teams, d.players, d.games, d.points, d.events, d.opponents, d.syncQueue], async () => {
      if (mode === 'replace') await Promise.all([d.teams.clear(), d.players.clear(), d.games.clear(), d.points.clear(), d.events.clear(), d.opponents.clear()])
      const put = async <T extends { id: string; updated_at: number }>(tbl: unknown, rows: T[]) => {
        const table = tbl as import('dexie').Table<T, string>
        const write = mode === 'replace' ? rows : mergeRows(await table.toArray(), rows)
        await table.bulkPut(write)
        counts[table.name] = write.length
        // Queue restored players and games for Sheet sync (each game is pushed as a full snapshot).
        if (table.name === 'players' || table.name === 'games' || table.name === 'opponents') {
          await d.syncQueue.bulkPut(write.map((r) => ({ op_id: `${table.name}:${r.id}`, table: table.name as 'players' | 'games' | 'opponents', row_id: r.id, payload: r, attempts: 0, last_error: null })))
        }
      }
      await put(d.teams, b.teams)
      await put(d.players, b.players)
      await put(d.games, b.games)
      await put(d.points, b.points)
      await put(d.events, b.events)
      await put(d.opponents, b.opponents)
    })
    this.repo.onWrite?.()
    return counts
  }
}

export const actions = new Actions()
export type { Game }
