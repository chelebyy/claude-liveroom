import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { roomRows } from '../hooks/room/panels'
import { roomView } from '../hooks/room/state'
import type { Team, TeamTask } from '../hooks/room/team'
import {
  LEAD,
  addTask,
  applyMessage,
  assignTask,
  boardRows,
  joinTeam,
  listTasks,
  messageOf,
  noticeOf,
  setState,
  taskOf,
  turnEndState,
  updateTask,
} from '../hooks/room/team'

const EMPTY: Team = { members: [], messages: [] }

test('a teammate joins working, named by its team address; a pane teammate has its address as its id', () => {
  let t = joinTeam(EMPTY, { id: 'a1', teammateId: 'scout-2@session-x', model: 'claude-haiku-5-5' }, 10)
  expect(t.members[0]).toEqual({ id: 'a1', name: 'scout-2', model: 'claude-haiku-5-5', state: 'working', since: 10, isPane: false, sent: 0 })
  t = joinTeam(t, { id: 'critic@session-x', teammateId: 'critic@session-x', model: '' }, 20)
  expect(t.members[1]?.isPane).toBe(true)
  // A respawn under the same id replaces the member.
  t = joinTeam(t, { id: 'a1', teammateId: 'scout-2@session-x', model: 'claude-opus-5-5' }, 30)
  expect(t.members.map(m => `${m.name}:${m.model}`)).toEqual(['critic:', 'scout-2:claude-opus-5-5'])
})

test('a teammate that shut down stays down; an unchanged state keeps its clock', () => {
  let t = joinTeam(EMPTY, { id: 'a1', teammateId: 'scout@x', model: '' }, 10)
  t = setState(t, 'a1', 'working', 50)
  expect(t.members[0]?.since).toBe(10)
  t = setState(t, 'a1', turnEndState('answer'), 60)
  expect([t.members[0]?.state, t.members[0]?.since]).toEqual(['idle', 60])
  expect(turnEndState('aborted')).toBe('idle')
  expect(turnEndState('error')).toBe('failed')
  t = setState(t, 'a1', 'ended', 70)
  t = setState(t, 'a1', 'working', 80)
  expect(t.members[0]?.state).toBe('ended')
})

test('a SendMessage reads as its summary or first line, credentials masked; protocol messages by kind', () => {
  expect(messageOf({ to: 'scout', message: 'long body\nmore', summary: 'greeting' }, LEAD, 1)).toEqual({ at: 1, from: LEAD, to: 'scout', kind: 'text', text: 'greeting', approve: null })
  expect(messageOf({ to: 'scout', message: '\n  first line\nsecond' }, LEAD, 1)?.text).toBe('first line')
  expect(messageOf({ to: 'scout', message: 'use ghp_abcdefghijklmnop now' }, LEAD, 1)?.text).not.toContain('abcdefghijklmnop')
  expect(messageOf({ to: 'scout', message: { type: 'shutdown_request', reason: 'done' } }, LEAD, 1)?.kind).toBe('shutdown-request')
  const answer = messageOf({ to: LEAD, message: { type: 'shutdown_response', request_id: 'r', approve: false } }, 'scout', 1)
  expect([answer?.kind, answer?.approve]).toEqual(['shutdown-response', false])
  expect(messageOf({ to: 'scout', message: { type: 'plan_approval_response', request_id: 'r', approve: true } }, LEAD, 1)?.kind).toBe('plan-response')
  expect(messageOf({ to: 'scout', message: { type: 'something_new' } }, LEAD, 1)).toBeNull()
  expect(messageOf({ message: 'no recipient' }, LEAD, 1)).toBeNull()
})

test('a message counts toward its sender, wakes a waiting teammate, and an approved shutdown ends its sender', () => {
  let t = joinTeam(EMPTY, { id: 'a1', teammateId: 'scout@x', model: '' }, 0)
  t = setState(t, 'a1', 'idle', 5)
  t = applyMessage(t, messageOf({ to: 'scout', message: 'next task' }, LEAD, 10)!)
  expect([t.members[0]?.state, t.members[0]?.since]).toEqual(['working', 10])
  t = applyMessage(t, messageOf({ to: LEAD, message: 'on it' }, 'scout', 11)!)
  expect(t.members[0]?.sent).toBe(1)
  t = applyMessage(t, messageOf({ to: LEAD, message: { type: 'shutdown_response', request_id: 'r', approve: true } }, 'scout', 12)!)
  expect(t.members[0]?.state).toBe('ended')
  for (let i = 0; i < 25; i++) t = applyMessage(t, messageOf({ to: 'scout', message: `m${i}` }, LEAD, 20 + i)!)
  expect(t.messages.length).toBe(20)
  expect(t.messages.at(-1)?.text).toBe('m24')
})

test('mailbox notices: idle, shutdown and task assignment; a model\'s own words are not one', () => {
  expect(noticeOf('{"type":"idle_notification","from":"scout","timestamp":"t"}', 'x')).toEqual({ kind: 'idle', from: 'scout' })
  expect(noticeOf('{"type":"shutdown_approved"}', 'scout')).toEqual({ kind: 'ended', from: 'scout' })
  expect(noticeOf('{"type":"shutdown_response","approve":true}', 'scout')).toEqual({ kind: 'ended', from: 'scout' })
  expect(noticeOf('{"type":"shutdown_response","approve":false}', 'scout')).toBeNull()
  expect(noticeOf('{"type":"task_assignment","taskId":"3","subject":"write tests","assignedBy":"team-lead"}', 'team-lead')).toEqual({ kind: 'assigned', taskId: '3', subject: 'write tests' })
  expect(noticeOf('hello from scout', 'scout')).toBeNull()
  expect(noticeOf('{"not json', 'scout')).toBeNull()
  expect(noticeOf('{"note":"a model wrote JSON"}', 'scout')).toBeNull()
})

test('the task list: created, updated, owned, deleted, and replaced by a TaskList answer', () => {
  let ts: TeamTask[] = addTask([], { id: '1', subject: 'probe task one' })
  ts = addTask(ts, { id: '2', subject: 'second' })
  ts = updateTask(ts, { taskId: '1', status: 'in_progress', owner: 'scout' })
  expect(ts[0]).toEqual({ id: '1', subject: 'probe task one', status: 'in_progress', owner: 'scout' })
  expect(taskOf(ts, 'scout')?.id).toBe('1')
  ts = updateTask(ts, { taskId: '1', owner: '' })
  expect(ts[0]?.owner).toBeNull()
  ts = updateTask(ts, { taskId: '9', status: 'completed' }) // made by a pane teammate this pane never saw
  expect(ts.find(t => t.id === '9')).toEqual({ id: '9', subject: '', status: 'completed', owner: null })
  ts = updateTask(ts, { taskId: '2', status: 'deleted' })
  expect(ts.map(t => t.id)).toEqual(['1', '9'])
  ts = assignTask(ts, '1', 'ignored', 'critic')
  expect([ts[0]?.owner, ts[0]?.subject]).toEqual(['critic', 'probe task one'])
  // A TaskList answer is the whole list; it keeps subjects the pane knew.
  ts = listTasks(ts, [
    { id: '1', subject: 'probe task one', status: 'completed', owner: 'critic', blockedBy: [] },
    { id: '9', subject: 'from a pane', status: 'pending', blockedBy: [] },
  ])
  expect(ts.map(t => `${t.id}:${t.status}:${t.subject}`)).toEqual(['1:completed:probe task one', '9:pending:from a pane'])
  expect(listTasks(ts, 'not a list')).toEqual([])
})

test('the board shows work in progress first, then what waits, then the newest done', () => {
  const ts: TeamTask[] = [
    { id: '1', subject: 'a', status: 'completed', owner: null },
    { id: '2', subject: 'b', status: 'pending', owner: null },
    { id: '3', subject: 'c', status: 'in_progress', owner: 'scout' },
    { id: '4', subject: 'd', status: 'completed', owner: null },
  ]
  expect(boardRows(ts, 6).map(t => t.id)).toEqual(['3', '2', '1', '4'])
  expect(boardRows(ts, 3).map(t => t.id)).toEqual(['3', '2', '4'])
  expect(boardRows(ts, 1).map(t => t.id)).toEqual(['3'])
})

test('team and task panels take rows only when they have something to show', () => {
  const empty = roomView([], {}, {}, {}, {}, undefined, undefined)
  expect([roomRows('team', empty, true), roomRows('tasks', empty, true)]).toEqual([0, 0])
  const team = joinTeam(EMPTY, { id: 'a1', teammateId: 'scout@x', model: '' }, 0)
  const room = roomView([], {}, {}, {}, {}, applyMessage(team, messageOf({ to: 'scout', message: 'hi' }, LEAD, 1)!), addTask([], { id: '1', subject: 's' }))
  expect([roomRows('team', room, true), roomRows('tasks', room, true)]).toEqual([4 + 1 + 1, 4 + 1])
})

// ---------------------------------------------------------------- drawn

/**
 * The world beneath the plugin: a teammate spawn answers with its team address, on the lead's model
 * unless the call names one. `critic` runs in a terminal pane of its own, so its id is its address.
 */
const engine = (on: On, statuses?: string[]) => {
  mock.clock(on)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => e)
  on('ui.status', (_$, e) => {
    if (statuses && typeof e.text === 'string') statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.receive', (_$, e) => ({ text: e.text }))
  on('agent.spawn', (_$, e) =>
    e.isTeammate
      ? { model: e.model ?? e.parentModel, agentId: e.name === 'critic' ? 'critic@session-t' : `tm-${e.name}`, teammateId: `${e.name}@session-t` }
      : { model: e.model ?? 'claude-opus-5-5', agentId: `sub-${e.description}` },
  )
  on('tool.call', (_$, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: '1', subject: String((e as { subject?: unknown }).subject) } }, text: 'ok' }
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: '1', updatedFields: [] }, text: 'ok' }
    if (e.tool === 'SendMessage') return { result: { success: true }, text: 'ok' }
    return { result: {}, text: 'ok' }
  })
}

const pane = (bodyColumns: number) => ({
  plugin: 'liveroom',
  component: 'Pane' as const,
  requestId: 'liveroom',
  props: { title: 'Liveroom', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 90 }, view: {} },
})

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as never

/** Spawns a teammate; `null` names no model, so it runs on the lead's. */
const spawnTeammate = ($: Engine, name: string, model: string | null = 'claude-haiku-5-5') =>
  $.agent.spawn({ prompt: 'p', description: `${name} work`, name, model: model ?? undefined, isTeammate: true, subagentType: 'teammate', tool_use_id: `tu-${name}`, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)

test('a teammate joins the team panel, not the agent cards, and waits between turns instead of finishing', { options: { language: 'en', openOnStart: false } }, async ($, on) => {
  const statuses: string[] = []
  engine(on, statuses)
  await $.session.start(START)
  await spawnTeammate($, 'scout')
  let ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^TEAM · teammates$/ })).toBeDefined()
  expect(await ui.find({ text: /^1 working · 0 idle$/ })).toBeDefined()
  expect(await ui.find({ text: /no subagents yet|agents · / })).toBeUndefined() // no card
  expect(await ui.find({ text: /joined the team/ })).toBeDefined()
  expect(statuses.at(-1)).toContain('team 1/1')
  expect(await ui.find({ text: /^⚠ $/ })).toBeUndefined() // it named its model
  await ui.unmount()
  // Its turn ends: it waits for a message, it has not finished.
  await $.turn.complete({ answer: 'ready', durationMs: 10, isAborted: false, turnId: 'T1', agentId: 'tm-scout', reason: 'answer' } as never)
  ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^0 working · 1 idle$/ })).toBeDefined()
  expect(await ui.find({ text: /^○ $/ })).toBeDefined()
  expect(await ui.find({ text: /done ·/ })).toBeUndefined()
  expect(statuses.at(-1)).toContain('team 0/1')
  await ui.unmount()
  // The lead writes: the message shows, and the teammate works again.
  await $.tool.call({ tool: 'SendMessage', to: 'scout', message: 'review the parser', summary: 'next task', tool_use_id: 'm1' } as never)
  ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^lead → scout {2}$/ })).toBeDefined()
  expect(await ui.find({ text: /^next task$/ })).toBeDefined()
  expect(await ui.find({ text: /^1 working · 0 idle$/ })).toBeDefined()
  await ui.unmount()
})

test('a pane teammate: its messages and idle notice arrive by mailbox; a shutdown notice ends it', { options: { language: 'en', openOnStart: false } }, async ($, on) => {
  engine(on)
  await $.session.start(START)
  await spawnTeammate($, 'critic')
  // A message the harness here didn't write: the teammate runs elsewhere, so it is counted here.
  await $.session.receive({ origin: { kind: 'peer', teammate: 'critic', isVerified: false }, text: 'found two bugs\nin the parser' } as never)
  // An in-process sender's copy is not counted twice: its SendMessage call was.
  await $.session.receive({ origin: { kind: 'peer', teammate: 'critic', isVerified: true }, text: 'counted at its call' } as never)
  await $.session.receive({ origin: { kind: 'peer', teammate: 'critic', isVerified: false }, text: '{"type":"idle_notification","from":"critic","timestamp":"t"}' } as never)
  let ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^critic → lead {2}$/ })).toBeDefined()
  expect(await ui.find({ text: /^found two bugs$/ })).toBeDefined()
  expect(await ui.find({ text: /counted at its call/ })).toBeUndefined()
  expect(await ui.find({ text: /^0 working · 1 idle$/ })).toBeDefined()
  expect(await ui.find({ text: /^ ▣$/ })).toBeDefined() // in a pane of its own
  await ui.unmount()
  const p = pane(80)
  const mini = { ...p, props: { ...p.props, placement: 'inline' as const }, surface: 'terminal' as const }
  let inline = await $.ui.mount(mini)
  expect(await inline.find({ text: /^○critic $/ })).toBeDefined()
  await inline.unmount()
  await $.session.receive({ origin: { kind: 'peer', teammate: 'critic', isVerified: false }, text: '{"type":"shutdown_approved","requestId":"r"}' } as never)
  ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^■ $/ })).toBeDefined()
  expect(await ui.find({ text: /shut down/ })).toBeDefined()
  expect(await ui.find({ text: /^0 working · 0 idle$/ })).toBeDefined()
  await ui.unmount()
  inline = await $.ui.mount(mini)
  expect(await inline.find({ text: /critic/ })).toBeUndefined() // a team that shut down takes no row
  await inline.unmount()
})

test('a teammate whose spawn names no model and runs on the lead\'s gets ⚠ in the team panel and the summary', { options: { language: 'en', openOnStart: false } }, async ($, on) => {
  engine(on)
  await $.session.start(START)
  await spawnTeammate($, 'scout', null)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^⚠ $/ })).toBeDefined()
  await ui.unmount()
  const p = pane(80)
  const inline = await $.ui.mount({ ...p, props: { ...p.props, placement: 'inline' as const }, surface: 'terminal' })
  expect(await inline.find({ text: /^⚠$/ })).toBeDefined()
  await inline.unmount()
})

test('a teammate cut short ends waiting while the agent list can\'t say it left', { options: { language: 'en', openOnStart: false } }, async ($, on) => {
  engine(on)
  await $.session.start(START)
  await spawnTeammate($, 'scout')
  // The kit has no agent list, so a cut-short turn is read as an interrupt: the teammate waits.
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 'T1', agentId: 'tm-scout', reason: 'aborted' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^0 working · 1 idle$/ })).toBeDefined()
  await ui.unmount()
})

test('the task board fills from the Task tools; a teammate shows the task it works on', { options: { language: 'en', openOnStart: false } }, async ($, on) => {
  engine(on)
  await $.session.start(START)
  await spawnTeammate($, 'scout')
  await $.tool.call({ tool: 'TaskCreate', subject: 'probe task one', description: 'probe', tool_use_id: 'k1' } as never)
  let ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^TASKS · board$/ })).toBeDefined()
  expect(await ui.find({ text: /^0\/1 done$/ })).toBeDefined()
  expect(await ui.find({ text: /^probe task one$/ })).toBeDefined()
  await ui.unmount()
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', owner: 'scout', tool_use_id: 'k2' } as never)
  ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^ #1 probe task one$/ })).toBeDefined() // the teammate's row names its task
  expect(await ui.find({ text: /^◐ $/ })).toBeDefined()
  await ui.unmount()
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed', tool_use_id: 'k3' } as never)
  ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^1\/1 done$/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ $/ })).toBeDefined()
  await ui.unmount()
})

test('team and task panels speak Turkish and fit 40 columns; the inline summary keeps to 8 rows', { options: { language: 'tr', openOnStart: false } }, async ($, on) => {
  engine(on)
  await $.session.start(START)
  for (const name of ['scout', 'critic-with-a-long-name']) await spawnTeammate($, name)
  for (const d of ['one', 'two', 'three']) await $.agent.spawn({ prompt: 'p', description: d, subagentType: 'Explore', model: 'claude-haiku-5-5', tool_use_id: `tu-${d}`, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'a task with a subject long enough to need cutting', description: 'd', tool_use_id: 'k1' } as never)
  await $.tool.call({ tool: 'SendMessage', to: 'scout', message: { type: 'shutdown_request', reason: 'done' }, tool_use_id: 'm1' } as never)
  const ui = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await ui.find({ text: /^TAKIM · üyeler$/ })).toBeDefined()
  expect(await ui.find({ text: /^GÖREVLER · pano$/ })).toBeDefined()
  expect(await ui.find({ text: /^lider → scout {2}$/ })).toBeDefined()
  expect(await ui.find({ text: /^kapanış\?$/ })).toBeDefined()
  expect(await ui.find({ text: /takıma katıldı/ })).toBeDefined()
  // Headers keep to the 36 columns inside the frame; the hint gives way first.
  for (const title of ['TAKIM · üyeler', 'GÖREVLER · pano']) {
    const head = await ui.find({ text: new RegExp(`^${title}$`) })
    expect(head).toBeDefined()
  }
  const hint = await ui.find({ type: 'Text', text: /^\d+ çalışıyor · \d+ boşta$/ })
  expect(hint).toBeDefined()
  expect('TAKIM · üyeler'.length + 1 + (hint?.text.length ?? 0)).toBeLessThanOrEqual(36)
  await ui.unmount()
  const p = pane(80)
  const inline = await $.ui.mount({ ...p, props: { ...p.props, placement: 'inline' as const }, surface: 'terminal' })
  expect(await inline.find({ text: /^takım $/ })).toBeDefined()
  expect(await inline.find({ text: /^●scout $/ })).toBeDefined()
  // The team's row takes one of the three agent rows: other loops' row would make a ninth.
  expect(await inline.find({ text: /^\+1 ajan daha/ })).toBeDefined()
  const root = (await inline.drawn()) as { children?: unknown[] }
  expect((root.children ?? []).filter(Boolean).length <= 8).toBe(true)
  await inline.unmount()
})
