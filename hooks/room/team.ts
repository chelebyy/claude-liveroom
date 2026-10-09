// The session's agent team and its task list, as pure functions over the lead's events.
//
// What reaches the lead (Claude Code 2.1.295, seen live): a teammate's spawn with its team address,
// each of its turns' steps and end, its tool calls (SendMessage, Task*) with its `agentId`, and the
// harness's own notices in its mailbox (`idle_notification`, `task_assignment`). A teammate in a
// terminal pane of its own runs no loop here: only its messages and notices to the lead arrive, so
// its state is inferred from them. `$.agent.list()` says only whether a teammate is still there:
// it reads `running` between turns.
import type { MemberState, Team, TeamMember, TeamMessage, TeamTask } from '../../types'
import { redact, shorten } from '../core'

export type { MemberState, Team, TeamMember, TeamMessage, TeamTask }

/** The lead's name in its team, as messages to and from the main conversation spell it. */
export const LEAD = 'team-lead'

const MEMBERS = 24
const MESSAGES = 20
const TASKS = 50

const listOf = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null)

/** The team read leniently: a missing or odd field reads as empty. */
export function teamOf(x: unknown): Team {
  const t = (x && typeof x === 'object' ? x : {}) as Partial<Team>
  return { members: listOf<TeamMember>(t.members), messages: listOf<TeamMessage>(t.messages) }
}

/**
 * A teammate joins working, as its first turn starts with its prompt. Its name is its team address's
 * (`scout-2@team`: the team suffixes a taken name); a teammate in a pane of its own has its address
 * as its id, as it runs no loop here.
 */
export function joinTeam(team: Team, m: { id: string; teammateId: string; model: string }, at: number): Team {
  const name = m.teammateId.split('@')[0] || m.id
  const member: TeamMember = { id: m.id, name, model: m.model, state: 'working', since: at, isPane: m.id.includes('@'), sent: 0 }
  return { ...team, members: [...team.members.filter(x => x.id !== m.id), member].slice(-MEMBERS) }
}

export const memberOf = (team: Team, id: string | undefined) => (id ? team.members.find(m => m.id === id) : undefined)

/** The live member a name addresses: the newest one, as a respawn under the name replaces the old. */
export const memberNamed = (team: Team, name: string) =>
  [...team.members].reverse().find(m => m.name === name && m.state !== 'ended') ?? [...team.members].reverse().find(m => m.name === name)

/** A member's state changes; one that ended stays ended, and an unchanged state keeps its clock. */
export function setState(team: Team, id: string, state: MemberState, at: number): Team {
  return {
    ...team,
    members: team.members.map(m => (m.id === id && m.state !== 'ended' && m.state !== state ? { ...m, state, since: at } : m)),
  }
}

/** How a member's turn ending leaves it: waiting for a message, or failed on an error. */
export const turnEndState = (reason: string): MemberState => (reason === 'error' ? 'failed' : 'idle')

/**
 * A SendMessage call as a message line, or null for one with no recipient or an unknown shape. A
 * text message shows its sender's summary, else its first line, with credentials masked.
 */
export function messageOf(input: { to?: unknown; message?: unknown; summary?: unknown }, from: string, at: number): TeamMessage | null {
  const to = str(input.to)
  if (!to) return null
  const m = input.message
  if (typeof m === 'string') {
    const summary = str(input.summary)?.trim() || m.split('\n').find(l => l.trim()) || ''
    return { at, from, to, kind: 'text', text: shorten(redact(summary), 80), approve: null }
  }
  if (!m || typeof m !== 'object') return null
  const { type, approve } = m as { type?: unknown; approve?: unknown }
  const kind = type === 'shutdown_request' ? 'shutdown-request' : type === 'shutdown_response' ? 'shutdown-response' : type === 'plan_approval_response' ? 'plan-response' : null
  return kind ? { at, from, to, kind, text: '', approve: typeof approve === 'boolean' ? approve : null } : null
}

/**
 * A message joins the newest 20 and counts toward its sender. A text message wakes the teammate it
 * reaches, which a pane's turns can't say themselves; an approved shutdown ends the one that sent it.
 */
export function applyMessage(team: Team, msg: TeamMessage): Team {
  const sender = memberNamed(team, msg.from)
  const to = memberNamed(team, msg.to)
  let next: Team = {
    members: team.members.map(m => (m === sender ? { ...m, sent: m.sent + 1 } : m)),
    messages: [...team.messages, msg].slice(-MESSAGES),
  }
  if (msg.kind === 'text' && to?.state === 'idle') next = setState(next, to.id, 'working', msg.at)
  if (msg.kind === 'shutdown-response' && msg.approve === true && sender) next = setState(next, sender.id, 'ended', msg.at)
  return next
}

/** A notice the team's harness writes into a mailbox, which the lead receives as text. */
export type TeamNotice =
  | { kind: 'idle'; from: string }
  | { kind: 'ended'; from: string }
  | { kind: 'assigned'; taskId: string; subject: string }

/**
 * The harness's notice in a delivery's text, or null for a message a model wrote. `sender` is who
 * the mailbox says sent it, for a notice that doesn't name itself.
 */
export function noticeOf(text: string, sender: string | null): TeamNotice | null {
  if (!text.trimStart().startsWith('{')) return null
  let o: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    o = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const from = str(o.from) ?? sender
  if (o.type === 'idle_notification' && from) return { kind: 'idle', from }
  if ((o.type === 'shutdown_approved' || (o.type === 'shutdown_response' && o.approve === true)) && from) return { kind: 'ended', from }
  const taskId = str(o.taskId)
  if (o.type === 'task_assignment' && taskId) return { kind: 'assigned', taskId, subject: str(o.subject) ?? '' }
  return null
}

// ---------------------------------------------------------------- tasks

const STATUSES: readonly TeamTask['status'][] = ['pending', 'in_progress', 'completed']
const statusOf = (x: unknown): TeamTask['status'] | null => (STATUSES as readonly unknown[]).includes(x) ? (x as TeamTask['status']) : null

/** The task list read leniently: entries without an id are dropped. */
export function tasksOf(x: unknown): TeamTask[] {
  return listOf<Partial<TeamTask>>(x).flatMap(t =>
    t && typeof t.id === 'string' ? [{ id: t.id, subject: str(t.subject) ?? '', status: statusOf(t.status) ?? 'pending', owner: str(t.owner) }] : [],
  )
}

const upsert = (tasks: readonly TeamTask[], task: TeamTask) => {
  const at = tasks.findIndex(t => t.id === task.id)
  return (at === -1 ? [...tasks, task] : tasks.map((t, i) => (i === at ? task : t))).slice(-TASKS)
}

/** TaskCreate's answer: a new pending task. */
export function addTask(tasks: readonly TeamTask[], task: { id?: unknown; subject?: unknown }): TeamTask[] {
  const id = str(task.id)
  return id ? upsert(tasks, { id, subject: str(task.subject) ?? '', status: 'pending', owner: null }) : [...tasks]
}

/**
 * A TaskUpdate that succeeded: its fields applied, `deleted` removing the task. A task this pane
 * never saw created (a teammate in a pane made it) joins under its id.
 */
export function updateTask(tasks: readonly TeamTask[], input: { taskId?: unknown; status?: unknown; owner?: unknown; subject?: unknown }): TeamTask[] {
  const id = str(input.taskId)
  if (!id) return [...tasks]
  if (input.status === 'deleted') return tasks.filter(t => t.id !== id)
  const was = tasks.find(t => t.id === id) ?? { id, subject: '', status: 'pending' as const, owner: null }
  return upsert(tasks, {
    ...was,
    subject: str(input.subject) ?? was.subject,
    status: statusOf(input.status) ?? was.status,
    owner: typeof input.owner === 'string' ? input.owner || null : was.owner,
  })
}

/** A TaskList answer is the whole list: it replaces what the pane pieced together, keeping known subjects. */
export function listTasks(tasks: readonly TeamTask[], listed: unknown): TeamTask[] {
  return tasksOf(listed).map(t => ({ ...t, subject: t.subject || tasks.find(x => x.id === t.id)?.subject || '' })).slice(-TASKS)
}

/** A task assigned to a member, as its assignment notice says. */
export function assignTask(tasks: readonly TeamTask[], taskId: string, subject: string, owner: string): TeamTask[] {
  const was = tasks.find(t => t.id === taskId) ?? { id: taskId, subject, status: 'pending' as const, owner: null }
  return upsert(tasks, { ...was, subject: was.subject || subject, owner })
}

/** The task a member works on: one it owns that is in progress. */
export const taskOf = (tasks: readonly TeamTask[], name: string) => tasks.find(t => t.owner === name && t.status === 'in_progress') ?? null

/** The rows a board of `n` shows: work in progress first, then what waits, then the newest done. */
export function boardRows(tasks: readonly TeamTask[], n: number): TeamTask[] {
  const of = (s: TeamTask['status']) => tasks.filter(t => t.status === s)
  const open = [...of('in_progress'), ...of('pending')].slice(0, n)
  const room = n - open.length
  return [...open, ...(room > 0 ? of('completed').slice(-room) : [])]
}
