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
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

/** A short, stable digest (32-bit FNV-1a): it tells masked names apart without keeping what was masked. */
function digest(s: string): string {
  let h = 0x811c9dc5
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0
  return h.toString(36)
}

/**
 * A teammate's name as stored and matched: credentials masked, as everything else from a tool input,
 * one line, 256 characters at most (agent names run that long). A masked name carries its digest
 * (`•••#1x2y3z`), so two names that mask alike stay two teammates. Every name goes through it, the
 * roster's, a task owner's and a message's ends, so a masked name still finds its own teammate.
 */
export function nameOf(x: string): string {
  const masked = redact(x)
  return masked === x ? shorten(x, 256) : `${shorten(masked, 240)}#${digest(x)}`
}

const MEMBER_STATES: readonly unknown[] = ['working', 'idle', 'ended', 'failed']
const MESSAGE_KINDS: readonly unknown[] = ['text', 'shutdown-request', 'shutdown-response', 'plan-request', 'plan-response']

/** A stored member, or none for an entry without an id, a name or a known state. */
function memberIn(x: Partial<TeamMember> | null): TeamMember[] {
  if (!x || typeof x.id !== 'string' || typeof x.name !== 'string' || !MEMBER_STATES.includes(x.state)) return []
  return [{ id: x.id, name: x.name, model: str(x.model) ?? '', state: x.state!, since: num(x.since), joinedAt: num(x.joinedAt), isPane: x.isPane === true, sent: num(x.sent) }]
}

/** A stored message, or none for an entry without its ends, a known kind or its text. */
function messageIn(x: Partial<TeamMessage> | null): TeamMessage[] {
  if (!x || typeof x.from !== 'string' || typeof x.to !== 'string' || typeof x.text !== 'string' || !MESSAGE_KINDS.includes(x.kind)) return []
  return [{ at: num(x.at), from: x.from, to: x.to, kind: x.kind!, text: x.text, approve: typeof x.approve === 'boolean' ? x.approve : null }]
}

/** The team read leniently: a missing or odd field reads as empty, an odd entry as none. */
export function teamOf(x: unknown): Team {
  const t = (x && typeof x === 'object' ? x : {}) as Partial<Team>
  return { members: listOf<Partial<TeamMember> | null>(t.members).flatMap(memberIn), messages: listOf<Partial<TeamMessage> | null>(t.messages).flatMap(messageIn) }
}

/**
 * A teammate joins working, as its first turn starts with its prompt. Its name is its team address's
 * (`scout-2@team`: the team suffixes a taken name); a teammate in a pane of its own has its address
 * as its id, as it runs no loop here.
 */
export function joinTeam(team: Team, m: { id: string; teammateId: string; model: string }, at: number): Team {
  const name = nameOf(m.teammateId.split('@')[0] || m.id)
  const member: TeamMember = { id: m.id, name, model: m.model, state: 'working', since: at, joinedAt: at, isPane: m.id.includes('@'), sent: 0 }
  return { ...team, members: boundMembers([...team.members.filter(x => x.id !== m.id), member]) }
}

/** The teammates that shut down, the earliest first: a teammate's `since` is when it shut down. */
const endedOf = (members: readonly TeamMember[]) => members.filter(m => m.state === 'ended').sort((a, b) => a.since - b.since)

/**
 * The roster kept to 24 by dropping the teammates that shut down earliest; a team has no size limit,
 * so every one still running stays, past 24 if it must.
 */
function boundMembers(members: readonly TeamMember[]): TeamMember[] {
  const gone = new Set(endedOf(members).slice(0, Math.max(0, members.length - MEMBERS)))
  return members.filter(m => !gone.has(m))
}


export const memberOf = (team: Team, id: string | undefined) => (id ? team.members.find(m => m.id === id) : undefined)

/**
 * The member a name addresses, or its id, as SendMessage takes either: the newest live one, as a
 * respawn under the name replaces the old.
 */
export const memberNamed = (team: Team, name: string) => {
  const named = nameOf(name)
  const is = (m: TeamMember) => m.name === named || m.id === name
  return [...team.members].reverse().find(m => is(m) && m.state !== 'ended') ?? [...team.members].reverse().find(is)
}

/**
 * The rows a roster of `n` shows: those at work first, then those waiting or failed, then the newest
 * that shut down, so the header's working count always has rows behind it.
 */
export function rosterRows(members: readonly TeamMember[], n: number): TeamMember[] {
  const live = [...members.filter(m => m.state === 'working'), ...members.filter(m => m.state === 'idle' || m.state === 'failed')].slice(0, n)
  const room = n - live.length
  return [...live, ...(room > 0 ? endedOf(members).slice(-room) : [])]
}

// ---------------------------------------------------------------- transitions

/**
 * What moves a member to another state, each something the lead's process sees:
 * - `step`: a step of its own, the first of a turn. Claude Code revives an in-process teammate that a
 *   message reaches after it stopped, so a step reopens even one that ended.
 * - `wake`: a message, a plan answer or a shutdown request reaching it. It brings back an in-process
 *   teammate that stopped, not a pane's, whose process is gone.
 * - `wrote`: a pane teammate writing, anything but its shutdown approval: it is in a turn.
 * - `assigned`: a task the lead or another teammate gave it.
 * - `idle`, `failed`: its turn ended waiting for a message, or on an error.
 * - `ended`: it shut down, or stopped without the handshake.
 */
export type Cause = 'step' | 'wake' | 'wrote' | 'assigned' | 'idle' | 'failed' | 'ended'

const W: MemberState = 'working'
const I: MemberState = 'idle'
const F: MemberState = 'failed'
const E: MemberState = 'ended'

/**
 * The state each cause leaves a member in, by the state it was in. One that ended stays so, as a
 * notice can arrive after its shutdown, but for a step of its own or a message reviving it in process.
 */
export const TRANSITIONS: Readonly<Record<Cause, readonly [working: MemberState, idle: MemberState, failed: MemberState, ended: MemberState, endedPane: MemberState]>> = {
  step: [W, W, W, W, W],
  wake: [W, W, W, W, E],
  wrote: [W, W, W, E, E],
  assigned: [W, W, W, E, E],
  idle: [I, I, I, E, E],
  failed: [F, F, F, E, E],
  ended: [E, E, E, E, E],
}

/** The state a cause leaves a member in. */
export function nextState(m: TeamMember, cause: Cause): MemberState {
  const column = m.state === 'working' ? 0 : m.state === 'idle' ? 1 : m.state === 'failed' ? 2 : m.isPane ? 4 : 3
  return TRANSITIONS[cause][column]
}

/** A member moved by a cause; a state it keeps keeps its clock, and the roster stays bounded. */
export function move(team: Team, id: string, cause: Cause, at: number): Team {
  const members = team.members.map(m => {
    const state = m.id === id ? nextState(m, cause) : m.state
    return state === m.state ? m : { ...m, state, since: at }
  })
  return { ...team, members: boundMembers(members) }
}

/** A member's state set, as its turn's end, a notice or a pane's words say; one that ended stays so. */
export const setState = (team: Team, id: string, state: MemberState, at: number): Team => move(team, id, state === 'working' ? 'wrote' : state, at)

/** A member seen working, by a step of its own: even one that ended, as a message revives it. */
export const reopen = (team: Team, id: string, at: number): Team => move(team, id, 'step', at)

/** How a member's turn ending leaves it: waiting for a message, or failed on an error. */
export const turnEndState = (reason: string): 'idle' | 'failed' => (reason === 'error' ? 'failed' : 'idle')

/** The agent list's statuses for a loop still there: not started, in a turn, held, or waiting for a message. */
const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])

/**
 * Whether an agent-list status is one of a loop still there. Any other (`completed`, `failed`, `killed`,
 * or one a later Claude Code adds) reads as gone, which a turn of the teammate's own undoes.
 */
export const isLive = (status: string) => LIVE.has(status)

/**
 * A SendMessage call as a message line, or null for one with no recipient or an unknown shape. A
 * text message shows its sender's summary, else its first line, with credentials masked.
 */
export function messageOf(input: { to?: unknown; message?: unknown; summary?: unknown }, from: string, at: number): TeamMessage | null {
  const to = nameOf(str(input.to) ?? '')
  if (!to) return null
  from = nameOf(from)
  const m = input.message
  if (typeof m === 'string') {
    const summary = str(input.summary)?.trim() || m.split('\n').find(l => l.trim()) || ''
    return { at, from, to, kind: 'text', text: shorten(redact(summary), 80), approve: null }
  }
  if (!m || typeof m !== 'object') return null
  const { type, approve } = m as { type?: unknown; approve?: unknown }
  const kind = protocolKind(type)
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

/** A protocol message type's kind: an own entry of the table only, never a name `Object` gives every object. */
const protocolKind = (type: unknown) => (typeof type === 'string' && Object.prototype.hasOwnProperty.call(PROTOCOL, type) ? PROTOCOL[type] : undefined)

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
 * `fromId` names the sender exactly when the call carried its agent id: a teammate respawned under
 * the name is another member.
 */
export function applyMessage(team: Team, msg: TeamMessage, fromId?: string): Team {
  const sender = fromId ? memberOf(team, fromId) : memberNamed(team, msg.from)
  const to = memberNamed(team, msg.to)
  let next: Team = {
    members: team.members.map(m => (m === sender ? { ...m, sent: m.sent + 1 } : m)),
    messages: [...team.messages, msg].slice(-MESSAGES),
  }
  // A plan answer wakes its teammate too (approved, it implements; refused, it plans again), and so
  // does a shutdown request, which it answers.
  const wakes = msg.kind === 'text' || msg.kind === 'plan-response' || msg.kind === 'shutdown-request'
  if (wakes && to) next = move(next, to.id, 'wake', msg.at)
  if (msg.kind === 'shutdown-response' && msg.approve === true && sender) next = move(next, sender.id, 'ended', msg.at)
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
  return o && protocolKind(o.type) ? o : null
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
  | { kind: 'done'; taskId: string; subject: string; from: string }

/**
 * The harness's notice in a delivery's text, or null for a message a model wrote. `sender` is who
 * the mailbox says sent it: the harness pins a notice's `from` to it, so one naming another teammate
 * is not the harness's and counts for no one.
 */
export function noticeOf(text: string, sender: string | null): TeamNotice | null {
  const o = jsonOf(text)
  if (!o) return null
  const named = str(o.from)
  if (named && sender && named.split('@')[0] !== sender.split('@')[0]) return null
  const from = sender ?? named
  // A turn that ended on an API error says so: `idleReason` is `available`, `interrupted` or `failed`.
  if (o.type === 'idle_notification' && from) return { kind: o.idleReason === 'failed' ? 'failed' : 'idle', from }
  if ((o.type === 'shutdown_approved' || o.type === 'teammate_terminated' || (o.type === 'shutdown_response' && o.approve === true)) && from) return { kind: 'ended', from }
  const taskId = str(o.taskId)
  if (o.type === 'task_assignment' && taskId) return { kind: 'assigned', taskId, subject: str(o.subject) ?? '' }
  // A pane teammate's TaskUpdate never reaches this process: its completion notice is the signal.
  if (o.type === 'task_completed' && taskId && from) return { kind: 'done', taskId, subject: str(o.taskSubject) ?? '', from }
  return null
}

// ---------------------------------------------------------------- the team's events

/** A mailbox delivery: who the mailbox says sent it, whether this process wrote it, its text, and the loop it reached (none for the lead). */
export type Delivery = { type: 'deliver'; sender: string; isVerified: boolean; text: string; toId?: string; at: number }

/**
 * What the lead's process sees of its team, each event as a hook hands it over:
 * - `join`: a teammate's spawn answered; `endedAt` when its first turn had already ended by then.
 * - `step`: a step of a teammate's loop. `turnEnd`: its turn ended; `isListed` whether the agent list
 *   still has it, read for a turn cut short.
 * - `send`: a SendMessage call that went out, from the lead or the loop `fromId`.
 * - `deliver`: a mailbox delivery. `assign`: a TaskUpdate that gave a task still to do to `owner`.
 * - `listed`: the session's agent list, read when the lead's turn ends and after a delivery, `at` when
 *   the read began. A teammate outside the lead's process may shut down with no notice reaching the
 *   lead: the list then shows it ended, or no more.
 * - `clear`: `/clear` or `/liveroom reset`. `end`: the session ended otherwise.
 */
export type TeamEvent =
  | { type: 'join'; id: string; teammateId: string; model: string; at: number; endedAt?: number }
  | { type: 'step'; id: string; index: number; at: number }
  | { type: 'turnEnd'; id: string; reason: string; isListed: boolean; at: number }
  | { type: 'send'; fromId?: string; to?: unknown; message?: unknown; summary?: unknown; at: number }
  | Delivery
  | { type: 'assign'; owner: string; byId?: string; at: number }
  | { type: 'listed'; agents: readonly { id: string; teammateId?: string; status: string }[]; at: number }
  | { type: 'clear' }
  | { type: 'end' }

/** A member's state before and after an event: `null` where it was not, or is no more, on the roster. */
export type Change = { id: string; name: string; from: MemberState | null; to: MemberState | null }

/** The members whose state an event changed, joined or dropped. */
function changesOf(before: Team, after: Team): Change[] {
  const was = new Map(before.members.map(m => [m.id, m] as const))
  const now = new Map(after.members.map(m => [m.id, m] as const))
  const ids = [...new Set([...was.keys(), ...now.keys()])]
  return ids.flatMap(id => {
    const a = was.get(id)
    const b = now.get(id)
    return a?.state === b?.state ? [] : [{ id, name: (b ?? a)!.name, from: a?.state ?? null, to: b?.state ?? null }]
  })
}

/**
 * The teammates an event shut down by their own answer, a notice or the agent list: those it moved to
 * ended, and those it ended and the roster bound then let go at once. A turn cut short stays quiet, as
 * before, and a clear or an end only lets teammates go.
 */
export function shutdownsOf(ev: TeamEvent, changes: readonly Change[]): Change[] {
  if (ev.type !== 'send' && ev.type !== 'deliver' && ev.type !== 'listed') return []
  return changes.filter(c => c.to === 'ended' || (c.to === null && c.from !== null && c.from !== 'ended'))
}

/** Whether a delivery assigns or completes a task: the only ones that change the task list. */
export function isTaskNotice(ev: Delivery): boolean {
  const kind = noticeOf(ev.text, ev.sender)?.kind
  return kind === 'assigned' || kind === 'done'
}

/** The team after one of its events, with the members it changed. */
export function reduceTeam(team: Team, ev: TeamEvent): { team: Team; changes: Change[] } {
  const after = teamAfter(team, ev)
  return { team: after, changes: changesOf(team, after) }
}

function teamAfter(team: Team, ev: TeamEvent): Team {
  switch (ev.type) {
    case 'join': {
      const joined = joinTeam(team, ev, ev.at)
      return ev.endedAt === undefined ? joined : move(joined, ev.id, 'idle', ev.endedAt)
    }
    case 'step':
      return ev.index === 0 ? move(team, ev.id, 'step', ev.at) : team
    case 'turnEnd':
      // One stopped without the shutdown handshake ends its turn cut short and leaves the agent list.
      return move(team, ev.id, ev.reason === 'aborted' && !ev.isListed ? 'ended' : turnEndState(ev.reason), ev.at)
    case 'send': {
      // Another agent of the session (a subagent) is not the team's, whatever a teammate is named.
      const author = ev.fromId ? memberOf(team, ev.fromId) : undefined
      if (ev.fromId && !author) return team
      // A teammate addressed by its id reads as its name, as the roster keeps it.
      const to = typeof ev.to === 'string' ? (memberNamed(team, ev.to)?.name ?? ev.to) : ev.to
      const msg = messageOf({ to, message: ev.message, summary: ev.summary }, author?.name ?? LEAD, ev.at)
      return msg && isTeamMessage(team, msg) ? applyMessage(team, msg, author?.id) : team
    }
    case 'deliver':
      return delivered(team, ev)
    case 'assign': {
      // One that took the task itself is already at work.
      const member = memberNamed(team, ev.owner)
      return member && member.id !== ev.byId ? move(team, member.id, 'assigned', ev.at) : team
    }
    case 'listed': {
      // A teammate with no live entry on the list (ended, or no more listed) has shut down. One respawned
      // under its address may sit beside its predecessor's ended entry, so any live entry keeps it.
      // Its `running` or `idle` is not read: the list says `running` while a teammate waits.
      // A teammate that joined while the list was read is not on it yet: the list says nothing of it.
      let next = team
      for (const m of team.members) {
        const isUp = ev.agents.some(x => (x.id === m.id || x.teammateId === m.id) && isLive(x.status))
        if (m.state !== 'ended' && m.joinedAt < ev.at && !isUp) next = move(next, m.id, 'ended', ev.at)
      }
      return next
    }
    case 'clear':
      // `/clear` clears the lead's conversation, not its teammates: only a pane teammate that shut down
      // goes, as an in-process one can be brought back by a message.
      return { members: team.members.filter(m => !(m.state === 'ended' && m.isPane)), messages: [] }
    case 'end':
      // Claude Code brings none of a session's teammates back.
      return { members: [], messages: [] }
  }
}

/**
 * A mailbox delivery: a harness notice sets its teammate's state; a message the harness here didn't
 * write is a pane teammate's, which no tool call showed: its words (JSON included), or a protocol
 * request or answer.
 */
function delivered(team: Team, ev: Delivery): Team {
  const notice = noticeOf(ev.text, ev.sender)
  const state = notice && notice.kind !== 'assigned' && notice.kind !== 'done' ? notice : null
  const member = memberNamed(team, state ? state.from : ev.sender)
  // One delivered to another agent of the session (a subagent) is not the team's.
  const recipient = ev.toId ? memberOf(team, ev.toId) : undefined
  let next = team
  if (!ev.isVerified && !isNotice(ev.text) && (!ev.toId || recipient)) {
    const msg = messageOf({ to: recipient?.name ?? LEAD, message: protocolOf(ev.text) ?? ev.text }, ev.sender, ev.at)
    if (msg && isTeamMessage(team, msg)) {
      // A pane teammate that writes is in a turn, unless it agrees to shut down.
      const isShutdown = msg.kind === 'shutdown-response' && msg.approve === true
      next = applyMessage(next, msg)
      if (member && !isShutdown) next = move(next, member.id, 'wrote', ev.at)
    }
  }
  return state && member ? move(next, member.id, state.kind, ev.at) : next
}

// ---------------------------------------------------------------- tasks

const STATUSES: readonly TeamTask['status'][] = ['pending', 'in_progress', 'completed']

/** A task's subject as stored and shown: credentials masked, one line, 120 characters at most. */
const subjectOf = (x: unknown) => shorten(redact(str(x) ?? ''), 120)

/** A task's owner as stored: a teammate's name as the roster keeps it; none when empty. The panel shortens it when drawn. */
const ownerOf = (x: unknown) => nameOf(str(x) ?? '') || null
const statusOf = (x: unknown): TeamTask['status'] | null => (STATUSES as readonly unknown[]).includes(x) ? (x as TeamTask['status']) : null

/** The task list read leniently: entries without an id are dropped. */
export function tasksOf(x: unknown): TeamTask[] {
  return listOf<Partial<TeamTask>>(x).flatMap(t =>
    t && typeof t.id === 'string' ? [{ id: t.id, subject: subjectOf(t.subject), status: statusOf(t.status) ?? 'pending', owner: ownerOf(t.owner) }] : [],
  )
}

/**
 * The list kept to 200 tasks by dropping the oldest done; a task list has no size limit, so every
 * task in progress or waiting stays, past 200 if it must.
 */
function bound(tasks: readonly TeamTask[]): TeamTask[] {
  let extra = tasks.length - TASKS
  return tasks.filter(t => !(t.status === 'completed' && extra-- > 0))
}

/**
 * A task added or changed in place; one that just completed moves to the end, as the list's order
 * among done tasks is the order they finished in.
 */
const upsert = (tasks: readonly TeamTask[], task: TeamTask) => {
  const at = tasks.findIndex(t => t.id === task.id)
  if (at === -1 || (task.status === 'completed' && tasks[at]!.status !== 'completed')) return bound([...tasks.filter(t => t.id !== task.id), task])
  return bound(tasks.map((t, i) => (i === at ? task : t)))
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
    owner: typeof input.owner === 'string' ? ownerOf(input.owner) : was.owner,
  })
}

/**
 * A TaskList answer is the whole list: it replaces what the pane pieced together, keeping known
 * subjects. The answer gives no completion order, so the done tasks keep the order the pane saw them
 * finish in; one the pane held open has just finished and follows them. One it doesn't hold at all
 * goes first, as the oldest: mostly one the 200-task bound let go, which would otherwise come back
 * as the newest and push recent ones out.
 */
export function listTasks(tasks: readonly TeamTask[], listed: unknown): TeamTask[] {
  const all = tasksOf(listed).map(t => ({ ...t, subject: t.subject || tasks.find(x => x.id === t.id)?.subject || '' }))
  const finished = tasks.filter(t => t.status === 'completed').map(t => t.id)
  const rank = (t: TeamTask) => (finished.includes(t.id) ? finished.indexOf(t.id) : tasks.some(x => x.id === t.id) ? finished.length : -1)
  const done = all.filter(t => t.status === 'completed').map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map(x => x.t)
  let k = 0
  return bound(all.map(t => (t.status === 'completed' ? done[k++]! : t))) // open tasks keep their places
}

/**
 * A task assigned to a member, as its assignment notice says: the notice's subject is the current one
 * (a pane teammate may have renamed the task unseen).
 */
export function assignTask(tasks: readonly TeamTask[], taskId: string, subject: string, owner: string): TeamTask[] {
  const was = tasks.find(t => t.id === taskId) ?? { id: taskId, subject: '', status: 'pending' as const, owner: null }
  return upsert(tasks, { ...was, subject: subjectOf(subject) || was.subject, owner: ownerOf(owner) })
}

/**
 * A task its teammate completed, as its completion notice says: the notice's subject and sender are
 * the current ones (a pane teammate may have renamed or taken the task unseen). One never seen joins.
 */
export function completeTask(tasks: readonly TeamTask[], taskId: string, subject: string, owner: string): TeamTask[] {
  const was = tasks.find(t => t.id === taskId) ?? { id: taskId, subject: '', status: 'pending' as const, owner: null }
  return upsert(tasks, { ...was, subject: subjectOf(subject) || was.subject, status: 'completed', owner: ownerOf(owner) ?? was.owner })
}

/**
 * The task a member works on: one it owns that is in progress, else one it owns that waits, as a pane
 * teammate's own move to in progress never reaches the lead.
 */
export const taskOf = (tasks: readonly TeamTask[], name: string) =>
  tasks.find(t => t.owner === name && t.status === 'in_progress') ?? tasks.find(t => t.owner === name && t.status === 'pending') ?? null

/** The rows a board of `n` shows: work in progress first, then what waits, then the newest done. */
export function boardRows(tasks: readonly TeamTask[], n: number): TeamTask[] {
  const of = (s: TeamTask['status']) => tasks.filter(t => t.status === s)
  const open = [...of('in_progress'), ...of('pending')].slice(0, n)
  const room = n - open.length
  return [...open, ...(room > 0 ? of('completed').slice(-room) : [])]
}

/**
 * What changes the task list: a TaskCreate's answer, a TaskUpdate that succeeded, a TaskList's
 * answer, and a mailbox delivery whose notice assigns or completes a task.
 */
export type TaskEvent =
  | { type: 'create'; task: { id?: unknown; subject?: unknown } }
  | { type: 'update'; input: { taskId?: unknown; status?: unknown; owner?: unknown; subject?: unknown } }
  | { type: 'list'; listed: unknown }
  | Delivery

/** The task list after one of its events; `team` is the team as the event found it. */
export function reduceTasks(tasks: readonly TeamTask[], ev: TaskEvent, team: Team = { members: [], messages: [] }): TeamTask[] {
  switch (ev.type) {
    case 'create':
      return addTask(tasks, ev.task)
    case 'update':
      return updateTask(tasks, ev.input)
    case 'list':
      return Array.isArray(ev.listed) ? listTasks(tasks, ev.listed) : [...tasks]
    case 'deliver': {
      const notice = noticeOf(ev.text, ev.sender)
      const sender = memberNamed(team, ev.sender)
      // Only from this team, its lead or a current teammate: not a departed one's late notice.
      if (notice?.kind === 'assigned' && (sender || isLead(ev.sender))) {
        const owner = ev.toId ? memberOf(team, ev.toId)?.name : LEAD
        return owner ? assignTask(tasks, notice.taskId, notice.subject, owner) : [...tasks]
      }
      return notice?.kind === 'done' && sender ? completeTask(tasks, notice.taskId, notice.subject, notice.from) : [...tasks]
    }
  }
}
