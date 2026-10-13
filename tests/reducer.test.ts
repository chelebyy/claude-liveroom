import { expect, test } from 'claude-code/testing'

import type { Cause, MemberState, Team, TeamTask } from '../hooks/room/team'
import { LEAD, TRANSITIONS, isTaskNotice, joinTeam, move, reduceTasks, reduceTeam, setState, shutdownsOf } from '../hooks/room/team'

const EMPTY: Team = { members: [], messages: [] }

/** A team of one, `scout`, in the given state; a pane teammate has its address as its id. */
function one(state: MemberState, isPane = false): Team {
  const id = isPane ? 'scout@x' : 'a1'
  const t = joinTeam(EMPTY, { id, teammateId: 'scout@x', model: '' }, 0)
  return state === 'working' ? t : setState(t, id, state, 1)
}

// The table as the README's "What is inferred" describes it, written out apart from the code's own:
// columns are working, idle, failed, ended in process, ended in a pane.
const EXPECTED: Record<Cause, MemberState[]> = {
  step: ['working', 'working', 'working', 'working', 'working'],
  wake: ['working', 'working', 'working', 'working', 'ended'],
  wrote: ['working', 'working', 'working', 'ended', 'ended'],
  assigned: ['working', 'working', 'working', 'ended', 'ended'],
  idle: ['idle', 'idle', 'idle', 'ended', 'ended'],
  failed: ['failed', 'failed', 'failed', 'ended', 'ended'],
  ended: ['ended', 'ended', 'ended', 'ended', 'ended'],
}

const STARTS: [MemberState, boolean][] = [
  ['working', false],
  ['idle', false],
  ['failed', false],
  ['ended', false],
  ['ended', true],
]

test('every cause leaves every state where the table says, and a kept state keeps its clock', () => {
  expect(Object.keys(TRANSITIONS).sort()).toEqual(Object.keys(EXPECTED).sort())
  for (const cause of Object.keys(EXPECTED) as Cause[]) {
    STARTS.forEach(([state, isPane], i) => {
      const before = one(state, isPane)
      const after = move(before, before.members[0]!.id, cause, 9).members[0]!
      expect([cause, state, isPane, after.state]).toEqual([cause, state, isPane, EXPECTED[cause][i]])
      expect(after.since).toBe(after.state === before.members[0]!.state ? before.members[0]!.since : 9)
    })
  }
})

test('a join is a change from nothing; one whose first turn already ended joins waiting from then', () => {
  const r = reduceTeam(EMPTY, { type: 'join', id: 'a1', teammateId: 'scout@x', model: 'm', at: 10 })
  expect(r.changes).toEqual([{ id: 'a1', name: 'scout', from: null, to: 'working' }])
  const early = reduceTeam(EMPTY, { type: 'join', id: 'a1', teammateId: 'scout@x', model: 'm', at: 10, endedAt: 7 })
  expect(early.team.members[0]).toMatchObject({ state: 'idle', since: 7, joinedAt: 10 })
})

test('a step opens a turn only when it is the first; a turn ends waiting, failed, or gone from the list', () => {
  const idle = one('idle')
  expect(reduceTeam(idle, { type: 'step', id: 'a1', index: 3, at: 5 }).changes).toEqual([])
  expect(reduceTeam(idle, { type: 'step', id: 'a1', index: 0, at: 5 }).changes).toEqual([{ id: 'a1', name: 'scout', from: 'idle', to: 'working' }])
  const working = one('working')
  const end = (reason: string, isListed: boolean) => reduceTeam(working, { type: 'turnEnd', id: 'a1', reason, isListed, at: 5 }).team.members[0]!.state
  expect([end('answer', true), end('error', true), end('aborted', true), end('aborted', false)]).toEqual(['idle', 'failed', 'idle', 'ended'])
  expect(reduceTeam(one('ended'), { type: 'turnEnd', id: 'a1', reason: 'answer', isListed: true, at: 5 }).changes).toEqual([])
})

test('a SendMessage counts only the team\'s traffic, and an approved shutdown ends the member that sent it', () => {
  const t = one('working')
  // A subagent's message to a teammate is not read as the lead's: it neither counts nor wakes.
  const idle = one('idle')
  expect(reduceTeam(idle, { type: 'send', fromId: 'sub-x', to: 'scout', message: 'hi', at: 2 })).toEqual({ team: idle, changes: [] })
  const bye = reduceTeam(t, { type: 'send', fromId: 'a1', to: LEAD, message: { type: 'shutdown_response', request_id: 'r', approve: true }, at: 2 })
  expect(bye.changes).toEqual([{ id: 'a1', name: 'scout', from: 'working', to: 'ended' }])
  const wake = reduceTeam(one('idle'), { type: 'send', to: 'a1', message: 'one more', at: 3 })
  expect([wake.changes[0]?.to, wake.team.messages[0]?.to]).toEqual(['working', 'scout'])
})

test('a delivery: a pane teammate that writes works, its notice sets its state, and a notice naming another changes no one', () => {
  const pane = one('idle', true)
  const from = { type: 'deliver' as const, sender: 'scout', isVerified: false, at: 4 }
  expect(reduceTeam(pane, { ...from, text: 'found it' }).changes[0]?.to).toBe('working')
  expect(reduceTeam(one('working', true), { ...from, text: '{"type":"teammate_terminated","message":"bye"}' }).changes[0]?.to).toBe('ended')
  expect(reduceTeam(pane, { ...from, sender: 'critic', text: '{"type":"idle_notification","from":"scout","idleReason":"failed"}' }).changes).toEqual([])
  // An in-process teammate's message is counted at its SendMessage call, not again here.
  expect(reduceTeam(one('idle'), { ...from, isVerified: true, text: 'counted at its call' }).changes).toEqual([])
})

test('an assignment wakes its owner unless the owner took it itself', () => {
  const t = one('idle')
  expect(reduceTeam(t, { type: 'assign', owner: 'scout', byId: 'a1', at: 2 }).changes).toEqual([])
  expect(reduceTeam(t, { type: 'assign', owner: 'scout', at: 2 }).changes[0]?.to).toBe('working')
})

test('a clear keeps teammates but a pane one that shut down; an end takes them all', () => {
  let t = joinTeam(joinTeam(EMPTY, { id: 'a1', teammateId: 'scout@x', model: '' }, 0), { id: 'critic@x', teammateId: 'critic@x', model: '' }, 0)
  t = setState(setState(t, 'a1', 'ended', 1), 'critic@x', 'ended', 1)
  t = reduceTeam(t, { type: 'send', to: 'scout', message: 'hi', at: 2 }).team
  const cleared = reduceTeam(t, { type: 'clear' })
  expect([cleared.team.members.map(m => m.id), cleared.team.messages.length]).toEqual([['a1'], 0])
  expect(cleared.changes).toEqual([{ id: 'critic@x', name: 'critic', from: 'ended', to: null }])
  expect(reduceTeam(t, { type: 'end' }).changes.map(c => [c.id, c.to])).toEqual([['a1', null], ['critic@x', null]])
})

test('the task list: its tools, and a notice only from the team', () => {
  let ts: TeamTask[] = reduceTasks([], { type: 'create', task: { id: '1', subject: 'audit' } })
  ts = reduceTasks(ts, { type: 'update', input: { taskId: '1', status: 'in_progress', owner: 'scout' } })
  expect(ts).toEqual([{ id: '1', subject: 'audit', status: 'in_progress', owner: 'scout' }])
  expect(reduceTasks(ts, { type: 'list', listed: 'not a list' })).toEqual(ts)
  const team = one('working', true)
  const done = { type: 'deliver' as const, isVerified: false, text: '{"type":"task_completed","from":"scout","taskId":"1","taskSubject":"audit"}', at: 5 }
  expect(reduceTasks(ts, { ...done, sender: 'scout' }, team)[0]?.status).toBe('completed')
  expect(reduceTasks(ts, { ...done, sender: 'gone', text: done.text.replace('scout', 'gone') }, team)[0]?.status).toBe('in_progress')
  const assigned = { type: 'deliver' as const, isVerified: false, text: '{"type":"task_assignment","taskId":"2","subject":"next","assignedBy":"x"}', at: 6 }
  expect(reduceTasks(ts, { ...assigned, sender: LEAD }, team).map(t => [t.id, t.owner])).toEqual([['1', 'scout'], ['2', LEAD]])
  expect(reduceTasks(ts, { ...assigned, sender: 'gone' }, team)).toEqual(ts)
})

test('a shutdown is logged once, also when the roster bound lets the teammate go at once; a cut-short turn is not', () => {
  let t = EMPTY
  for (let i = 0; i < 25; i++) t = joinTeam(t, { id: `a${i}`, teammateId: `t${i}@x`, model: '' }, i)
  const bye = { type: 'send' as const, fromId: 'a3', to: LEAD, message: { type: 'shutdown_response', request_id: 'r', approve: true }, at: 30 }
  const past = reduceTeam(t, bye)
  expect(past.team.members.some(m => m.id === 'a3')).toBe(false) // 25 running: the one that ended goes at once
  expect(shutdownsOf(bye, past.changes).map(c => c.id)).toEqual(['a3'])
  const again = reduceTeam(one('ended'), { ...bye, fromId: 'a1' })
  expect(shutdownsOf(bye, again.changes)).toEqual([]) // already down: no second line
  const cut = { type: 'turnEnd' as const, id: 'a1', reason: 'aborted', isListed: false, at: 5 }
  expect(shutdownsOf(cut, reduceTeam(one('working'), cut).changes)).toEqual([])
  expect(shutdownsOf({ type: 'end' }, reduceTeam(one('working'), { type: 'end' }).changes)).toEqual([])
})

test('only an assignment or a completion notice touches the task list', () => {
  const at = { type: 'deliver' as const, sender: 'scout', isVerified: false, at: 1 }
  expect(isTaskNotice({ ...at, text: '{"type":"task_assignment","taskId":"1","subject":"s"}' })).toBe(true)
  expect(isTaskNotice({ ...at, text: '{"type":"task_completed","from":"scout","taskId":"1"}' })).toBe(true)
  expect(isTaskNotice({ ...at, text: '{"type":"idle_notification","from":"scout"}' })).toBe(false)
  expect(isTaskNotice({ ...at, text: 'words' })).toBe(false)
})
