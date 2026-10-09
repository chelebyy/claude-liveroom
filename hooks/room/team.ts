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

/** Whether a name is the lead's: its name in the team, or `main`, which SendMessage also takes. */
export const isLead = (name: string) => name === LEAD || name === 'main'

const MEMBERS = 24
const MESSAGES = 20
const TASKS = 200

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
  return { ...team, members: boundMembers([...team.members.filter(x => x.id !== m.id), member]) }
}

/**
 * The roster kept to 24 by dropping the oldest teammates that shut down; a team has no size limit,
 * so every one still running stays, past 24 if it must.
 */
function boundMembers(members: readonly TeamMember[]): TeamMember[] {
  let extra = members.length - MEMBERS
  return members.filter(m => !(m.state === 'ended' && extra-- > 0))
}


export const memberOf = (team: Team, id: string | undefined) => (id ? team.members.find(m => m.id === id) : undefined)

/** The live member a name addresses: the newest one, as a respawn under the name replaces the old. */
export const memberNamed = (team: Team, name: string) =>
  [...team.members].reverse().find(m => m.name === name && m.state !== 'ended') ?? [...team.members].reverse().find(m => m.name === name)

/** The rows a roster of `n` shows: every teammate not shut down first, then the newest that did. */
export function rosterRows(members: readonly TeamMember[], n: number): TeamMember[] {
  const live = members.filter(m => m.state !== 'ended').slice(-n)
  const room = n - live.length
  return [...live, ...(room > 0 ? members.filter(m => m.state === 'ended').slice(-room) : [])]
}

/**
 * A member's state changes; one that ended stays ended, as a notice can arrive after its shutdown,
 * and an unchanged state keeps its clock.
 */
export function setState(team: Team, id: string, state: MemberState, at: number): Team {
  return {
    ...team,
    members: team.members.map(m => (m.id === id && m.state !== 'ended' && m.state !== state ? { ...m, state, since: at } : m)),
  }
}

/**
 * A member seen working: a step of its own, or a message that brings it back. Claude Code revives an
 * in-process teammate that a message reaches after it stopped, so this reopens one that ended.
 */
export function reopen(team: Team, id: string, at: number): Team {
  return { ...team, members: team.members.map(m => (m.id === id && m.state !== 'working' ? { ...m, state: 'working', since: at } : m)) }
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
  const kind = typeof type === 'string' ? PROTOCOL[type] : undefined
  // A mailbox spells a shutdown answer as approved or rejected; SendMessage takes it with `approve`.
  const answer = type === 'shutdown_approved' ? true : type === 'shutdown_rejected' ? false : typeof approve === 'boolean' ? approve : null
  return kind ? { at, from, to, kind, text: '', approve: answer } : null
}

/** The protocol messages a team sends, as SendMessage takes them and as the mailbox spells them. */
const PROTOCOL: Readonly<Record<string, TeamMessage['kind']>> = {
  shutdown_request: 'shutdown-request',
  shutdown_response: 'shutdown-response',
  shutdown_approved: 'shutdown-response',
  shutdown_rejected: 'shutdown-response',
  plan_approval_request: 'plan-request',
  plan_approval_response: 'plan-response',
}

/** The mailbox's own notices (Claude Code 2.1.295's schema), which are never a model's words. */
const NOTICES = new Set(['idle_notification', 'task_assignment', 'task_completed', 'teammate_terminated'])

/**
 * Whether a message is the team's: between the lead and a member, or between two members. A member's
 * message to another session is not.
 */
export function isTeamMessage(team: Team, msg: TeamMessage): boolean {
  const isMember = (x: string) => team.members.some(m => m.name === x || m.id === x)
  return (isMember(msg.from) || isMember(msg.to)) && (isMember(msg.from) || isLead(msg.from)) && (isMember(msg.to) || isLead(msg.to))
}

/**
 * A message joins the newest 20 and counts toward its sender. A text message wakes the teammate it
 * reaches, which a pane's turns can't say themselves: one waiting, one whose turn failed, and an
 * in-process one that stopped, which Claude Code brings back. An approved shutdown ends its sender.
 */
export function applyMessage(team: Team, msg: TeamMessage): Team {
  const sender = memberNamed(team, msg.from)
  const to = memberNamed(team, msg.to)
  let next: Team = {
    members: team.members.map(m => (m === sender ? { ...m, sent: m.sent + 1 } : m)),
    messages: [...team.messages, msg].slice(-MESSAGES),
  }
  // A plan answer wakes its teammate too (approved, it implements; refused, it plans again), and so
  // does a shutdown request, which it answers.
  const isRevived = to?.state === 'ended' && !to.isPane
  const wakes = msg.kind === 'text' || msg.kind === 'plan-response' || msg.kind === 'shutdown-request'
  if (wakes && to && to.state !== 'working' && (to.state !== 'ended' || isRevived)) next = reopen(next, to.id, msg.at)
  if (msg.kind === 'shutdown-response' && msg.approve === true && sender) next = setState(next, sender.id, 'ended', msg.at)
  return next
}

/** A delivery's text as the JSON object the harness wrote, or null for words a model wrote. */
export function jsonOf(text: string): Record<string, unknown> | null {
  if (!text.trimStart().startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A protocol message (a shutdown or plan request or answer) in a delivery's text. */
export function protocolOf(text: string): Record<string, unknown> | null {
  const o = jsonOf(text)
  return o && typeof o.type === 'string' && o.type in PROTOCOL ? o : null
}

/** Whether a delivery's text is one of the mailbox's own notices rather than a message. */
export const isNotice = (text: string) => {
  const type = jsonOf(text)?.type
  return typeof type === 'string' && NOTICES.has(type)
}

/** A notice the team's harness writes into a mailbox, which the lead receives as text. */
export type TeamNotice =
  | { kind: 'idle'; from: string }
  | { kind: 'failed'; from: string }
  | { kind: 'ended'; from: string }
  | { kind: 'assigned'; taskId: string; subject: string }

/**
 * The harness's notice in a delivery's text, or null for a message a model wrote. `sender` is who
 * the mailbox says sent it, for a notice that doesn't name itself.
 */
export function noticeOf(text: string, sender: string | null): TeamNotice | null {
  const o = jsonOf(text)
  if (!o) return null
  const from = str(o.from) ?? sender
  // A turn that ended on an API error says so: `idleReason` is `available`, `interrupted` or `failed`.
  if (o.type === 'idle_notification' && from) return { kind: o.idleReason === 'failed' ? 'failed' : 'idle', from }
  if ((o.type === 'shutdown_approved' || o.type === 'teammate_terminated' || (o.type === 'shutdown_response' && o.approve === true)) && from) return { kind: 'ended', from }
  const taskId = str(o.taskId)
  if (o.type === 'task_assignment' && taskId) return { kind: 'assigned', taskId, subject: str(o.subject) ?? '' }
  return null
}

// ---------------------------------------------------------------- tasks

const STATUSES: readonly TeamTask['status'][] = ['pending', 'in_progress', 'completed']

/** A task's subject as stored and shown: credentials masked, one line, 120 characters at most. */
const subjectOf = (x: unknown) => shorten(redact(str(x) ?? ''), 120)
const statusOf = (x: unknown): TeamTask['status'] | null => (STATUSES as readonly unknown[]).includes(x) ? (x as TeamTask['status']) : null

/** The task list read leniently: entries without an id are dropped. */
export function tasksOf(x: unknown): TeamTask[] {
  return listOf<Partial<TeamTask>>(x).flatMap(t =>
    t && typeof t.id === 'string' ? [{ id: t.id, subject: subjectOf(t.subject), status: statusOf(t.status) ?? 'pending', owner: str(t.owner) }] : [],
  )
}

/** The list kept to 200 tasks: the oldest done go first, so work in progress or waiting stays. */
function bound(tasks: readonly TeamTask[]): TeamTask[] {
  let extra = tasks.length - TASKS
  if (extra <= 0) return [...tasks]
  return tasks.filter(t => !(t.status === 'completed' && extra-- > 0)).slice(-TASKS)
}

const upsert = (tasks: readonly TeamTask[], task: TeamTask) => {
  const at = tasks.findIndex(t => t.id === task.id)
  return bound(at === -1 ? [...tasks, task] : tasks.map((t, i) => (i === at ? task : t)))
}

/** TaskCreate's answer: a new pending task. */
export function addTask(tasks: readonly TeamTask[], task: { id?: unknown; subject?: unknown }): TeamTask[] {
  const id = str(task.id)
  return id ? upsert(tasks, { id, subject: subjectOf(task.subject), status: 'pending', owner: null }) : [...tasks]
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
    subject: typeof input.subject === 'string' ? subjectOf(input.subject) : was.subject,
    status: statusOf(input.status) ?? was.status,
    owner: typeof input.owner === 'string' ? input.owner || null : was.owner,
  })
}

/** A TaskList answer is the whole list: it replaces what the pane pieced together, keeping known subjects. */
export function listTasks(tasks: readonly TeamTask[], listed: unknown): TeamTask[] {
  return bound(tasksOf(listed).map(t => ({ ...t, subject: t.subject || tasks.find(x => x.id === t.id)?.subject || '' })))
}

/** A task assigned to a member, as its assignment notice says. */
export function assignTask(tasks: readonly TeamTask[], taskId: string, subject: string, owner: string): TeamTask[] {
  const was = tasks.find(t => t.id === taskId) ?? { id: taskId, subject: '', status: 'pending' as const, owner: null }
  return upsert(tasks, { ...was, subject: was.subject || subjectOf(subject), owner })
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
