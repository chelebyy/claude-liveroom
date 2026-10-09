// Liveroom's panels: models, codex, skills, team and tasks. Drawn inside Flightdeck's pane with its
// colours and its status language: ◐ running in the agent colour, ✓ done in green, ✗ failed in red.
import type { Elements } from 'claude-code'

import type { Colors, Palette } from '../core'
import { prettyModel, shorten } from '../core'
import type { CodexRun, RunStatus } from './core'
import { meter, runGlyph, top } from './core'
import type { Key, T } from './i18n'
import type { RoomView } from './state'
import type { MemberState, TeamMessage, TeamTask } from './team'
import { LEAD, boardRows, taskOf } from './team'

export type RoomPanel = 'models' | 'codex' | 'skills' | 'team' | 'tasks'
export const ROOM_PANELS: readonly RoomPanel[] = ['models', 'codex', 'skills', 'team', 'tasks']

/** The room's own colours: theme keys by default, fixed hex under `pastel`. */
export const ROOM_COLORS: Record<Palette, { codex: string; skills: string; team: string; tasks: string }> = {
  theme: { codex: 'ide', skills: 'planMode', team: 'autoAccept', tasks: 'remember' },
  pastel: { codex: '#f9a8d4', skills: '#fdba74', team: '#67e8f9', tasks: '#bef264' },
}

/** The two elements the room draws with; every surface's table has them. */
type Els = Pick<Elements['terminal'], 'Box' | 'Text'>

export type RoomCtx = {
  els: Els
  C: Colors
  palette: Palette
  room: RoomView
  /** `delegationRule`: show ⚠ on hand-offs that name no model or effort. */
  isRuleOn: boolean
  /** Flightdeck's live clock: ticks on the surface's own frame clock while `endAt` is null. */
  clock: (key: string, since: number, endAt: number | null, color: string) => JSX.Element
  /** Text in the pane's language. */
  t: T
}

export const isRoomPanel = (p: string): p is RoomPanel => (ROOM_PANELS as readonly string[]).includes(p)

/** A panel with nothing to show takes no room, as Flightdeck's do. */
export function isRoomEmpty(p: RoomPanel, room: RoomView): boolean {
  if (p === 'models') return Object.keys(room.steps).length === 0
  if (p === 'codex') return room.codex.length === 0
  if (p === 'team') return room.team.members.length === 0
  if (p === 'tasks') return room.tasks.length === 0
  return Object.keys(room.skills).length === 0 && Object.keys(room.plugins).length === 0
}

/**
 * The rows a room panel takes, so the session log can leave room for it: its frame and title, its
 * rows as drawRoom caps them, and the rail above it. Nothing for an empty panel, which takes no room.
 */
export function roomRows(p: RoomPanel, room: RoomView, isRuleOn: boolean): number {
  if (isRoomEmpty(p, room)) return 0
  const frame = 3 + 1
  if (p === 'models') return frame + Math.min(5, Object.keys(room.steps).length)
  if (p === 'codex') return frame + Math.min(6, room.codex.length) + (isRuleOn && room.codex.some(r => r.ruleNote) ? 1 : 0)
  if (p === 'team') return frame + Math.min(TEAM_ROWS, room.team.members.length) + Math.min(MESSAGE_ROWS, room.team.messages.length)
  if (p === 'tasks') return frame + Math.min(TASK_ROWS, room.tasks.length)
  return frame + Math.min(5, Object.keys(room.skills).length) + Math.min(4, Object.keys(room.plugins).length)
}

/**
 * How many loop dots share a row of `w` with `used` columns of text: Flightdeck's own count, capped
 * so the row never runs past `w` once its text is longer, as the Turkish is.
 */
export const loopDots = (w: number, used: number) => Math.min(Math.max(4, w - 38), Math.max(1, w - used))

/**
 * The main panel's model name in a frame of `w`, beside its role (` · main`) and its state (`● working`):
 * an unknown model id keeps 22 characters, so it gives way for the state and a space before it.
 */
export const mainModel = (model: string, role: string, state: string, w: number) => shorten(model, w - 5 - role.length - state.length)

/** The cards' colours: running in the agent colour, done green, failed red; a run without a verdict dims. */
export const statusColorOf = (C: Colors, s: RunStatus) =>
  s === 'failed' ? C.warn : s === 'done' ? C.gate : s === 'background' || s === 'ended' ? C.dim : C.agent

const KIND_LABEL: Record<CodexRun['kind'], Key> = { rescue: 'rescue', consult: 'consult', exec: 'exec', review: 'review' }

const TEAM_ROWS = 6
const MESSAGE_ROWS = 3
const TASK_ROWS = 6

/** A teammate's glyph: ● working, ○ idle, ■ shut down, ✗ failed. */
export const MEMBER_GLYPH: Record<MemberState, string> = { working: '●', idle: '○', ended: '■', failed: '✗' }
/** A teammate's colour: working in the agent colour, failed red, waiting or gone dim. */
export const memberColorOf = (C: Colors, s: MemberState) => (s === 'working' ? C.agent : s === 'failed' ? C.warn : C.dim)
const TASK_GLYPH: Record<TeamTask['status'], string> = { in_progress: '◐', pending: '○', completed: '✓' }

/** A message's line: a text message's summary, or its protocol kind with the answer. */
function messageText(msg: TeamMessage, t: T): string {
  const mark = msg.approve === true ? ' ✓' : msg.approve === false ? ' ✗' : ''
  if (msg.kind === 'shutdown-request') return t('shutdown?')
  if (msg.kind === 'shutdown-response') return `${t('shutdown')}${mark}`
  if (msg.kind === 'plan-request') return t('plan?')
  if (msg.kind === 'plan-response') return `${t('plan')}${mark}`
  return msg.text
}

export function drawRoom(p: RoomPanel, w: number, x: RoomCtx): JSX.Element {
  const { Box, Text } = x.els
  const { C, room, t } = x
  const RC = ROOM_COLORS[x.palette]

  // The title row keeps to one line: a hint that can't share it falls back to its short form, then
  // to nothing. The frame's border and padding take 4 columns.
  const fitHint = (title: string, hints: string[]) => hints.find(h => title.length + 1 + h.length <= w - 4) ?? ''
  const frame = (color: string, title: string, hints: string[], body: JSX.Element | JSX.Element[]) => (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={w}>
      <Box justifyContent="space-between">
        <Text color={color} bold>
          {title}
        </Text>
        <Text color={C.dim}>{fitHint(title, hints)}</Text>
      </Box>
      {body}
    </Box>
  )

  if (p === 'models') {
    const rows = top(room.steps, 5)
    const most = rows[0]?.[1] ?? 1
    const total = Object.values(room.steps).reduce((a, b) => a + b, 0)
    const barW = Math.max(4, Math.min(10, w - 32))
    return frame(
      C.main,
      t('MODELS · requests'),
      [String(total)],
      rows.map(([key, n]) => {
        const [model, effort] = key.split(' · ')
        return (
          <Box justifyContent="space-between">
            <Text wrap="truncate">
              <Text color={C.text}>{prettyModel(model ?? key)}</Text>
              {effort ? <Text color={C.dim}>{` · ${effort}`}</Text> : null}
            </Text>
            <Text>
              <Text color={C.main}>{meter(n / most, barW)}</Text>
              <Text color={C.dim}>{` ${String(n).padStart(3)}`}</Text>
            </Text>
          </Box>
        )
      }),
    )
  }

  if (p === 'codex') {
    // A run sent off with `&` is not counted as running: no event says when it ends.
    const running = room.codex.filter(r => r.status === 'running').length
    const unseen = room.codex.filter(r => r.status === 'background').length
    const shown = room.codex.slice(-6)
    const warned = x.isRuleOn ? room.codex.filter(r => r.ruleNote).length : 0
    const isLive = (r: CodexRun) => r.status === 'running' || r.status === 'background'
    // A long model id gives way, so the glyph and kind on the left always show: the row's inside
    // width less the left side (glyph, kind, ⚠), the effort and the clock.
    const modelWidth = (r: CodexRun) => Math.max(6, w - 4 - 12 - (r.effort ? r.effort.length + 4 : 1) - 8)
    return frame(
      RC.codex,
      t('CODEX · hand-offs'),
      [
        [t('{n} running', { n: running }), ...(unseen > 0 ? [t('{n} bg', { n: unseen })] : []), t('{n} total', { n: room.codex.length })].join(' · '),
        t('{n} total', { n: room.codex.length }),
      ],
      [
        ...shown.map(r => (
          <Box justifyContent="space-between">
            <Text wrap="truncate">
              <Text color={statusColorOf(C, r.status)}>{`${runGlyph(r.status)} `}</Text>
              <Text color={isLive(r) ? C.text : C.dim}>{t(KIND_LABEL[r.kind])}</Text>
              {x.isRuleOn && r.ruleNote ? <Text color={C.amber}>{' ⚠'}</Text> : null}
            </Text>
            <Box flexShrink={0}>
              <Text>
                <Text color={isLive(r) ? C.text : C.dim} bold={r.status === 'running'}>
                  {shorten(r.model ?? (r.kind === 'review' ? t('own model') : t('default')), modelWidth(r))}
                </Text>
                {r.effort ? <Text color={C.dim}>{` · ${r.effort} `}</Text> : <Text> </Text>}
              </Text>
              {r.status === 'background' ? <Text color={C.dim}>bg</Text> : x.clock(`codex-clock-${r.id}`, r.startedAt, r.endedAt, C.dim)}
            </Box>
          </Box>
        )),
        ...(warned > 0
          ? [
              <Text color={C.amber} wrap="truncate">
                {t('⚠ {n} without model or effort', { n: warned })}
              </Text>,
            ]
          : []),
      ],
    )
  }

  // The lead is `team-lead` in its team's messages; the pane names it in its own language.
  const who = (name: string) => (name === LEAD ? t('lead') : name)

  if (p === 'team') {
    const { members, messages } = room.team
    const working = members.filter(m => m.state === 'working').length
    const idle = members.filter(m => m.state === 'idle').length
    const shown = members.slice(-TEAM_ROWS)
    const nameW = Math.min(12, Math.max(4, ...shown.map(m => m.name.length)))
    return frame(
      RC.team,
      t('TEAM · teammates'),
      [t('{working} working · {idle} idle', { working, idle }), `${working}/${members.length}`],
      [
        ...shown.map(m => {
          const task = taskOf(room.tasks, m.name)
          const isLive = m.state === 'working' || m.state === 'idle'
          return (
            <Box justifyContent="space-between">
              <Text wrap="truncate">
                <Text color={memberColorOf(C, m.state)}>{`${MEMBER_GLYPH[m.state]} `}</Text>
                {x.isRuleOn && room.rules[m.id] ? <Text color={C.amber}>{'⚠ '}</Text> : null}
                <Text color={isLive ? C.text : C.dim} bold={m.state === 'working'}>
                  {shorten(m.name, nameW).padEnd(nameW)}
                </Text>
                <Text color={C.dim}>{` ${task ? `#${task.id} ${task.subject}` : prettyModel(m.model)}`}</Text>
              </Text>
              <Box flexShrink={0}>
                {m.isPane ? <Text color={C.dim}>{' ▣'}</Text> : null}
                {isLive ? <Text> </Text> : null}
                {isLive ? x.clock(`team-clock-${m.id}`, m.since, null, C.dim) : null}
              </Box>
            </Box>
          )
        }),
        ...messages.slice(-MESSAGE_ROWS).map(msg => (
          <Text wrap="truncate">
            <Text color={C.dim}>{`${who(msg.from)} → ${who(msg.to)}  `}</Text>
            <Text color={C.text}>{messageText(msg, t)}</Text>
          </Text>
        )),
      ],
    )
  }

  if (p === 'tasks') {
    const done = room.tasks.filter(task => task.status === 'completed').length
    const total = room.tasks.length
    const glyphColor = (s: TeamTask['status']) => (s === 'in_progress' ? C.agent : s === 'completed' ? C.gate : C.dim)
    return frame(
      RC.tasks,
      t('TASKS · board'),
      [t('{done}/{total} done', { done, total }), `${done}/${total}`],
      boardRows(room.tasks, TASK_ROWS).map(task => (
        <Box justifyContent="space-between">
          <Text wrap="truncate">
            <Text color={glyphColor(task.status)}>{`${TASK_GLYPH[task.status]} `}</Text>
            <Text color={C.dim}>{`#${task.id} `}</Text>
            <Text color={task.status === 'completed' ? C.dim : C.text}>{task.subject || '—'}</Text>
          </Text>
          {task.owner ? (
            <Box flexShrink={0}>
              <Text color={C.dim}>{` ${shorten(who(task.owner), 10)}`}</Text>
            </Box>
          ) : null}
        </Box>
      )),
    )
  }

  const rows = [
    ...top(room.skills, 5).map(([name, n]) => ({ name, n, isPlugin: false })),
    ...top(room.plugins, 4).map(([name, n]) => ({ name, n, isPlugin: true })),
  ]
  return frame(
    RC.skills,
    t('SKILLS · plugins'),
    [`${Object.keys(room.skills).length} · ${Object.keys(room.plugins).length}`],
    rows.map(r => (
      <Box justifyContent="space-between">
        <Text color={r.isPlugin ? C.dim : C.text} wrap="truncate">
          {r.isPlugin ? `⧉ ${r.name}` : r.name}
        </Text>
        <Text color={C.dim}>{`×${r.n}`}</Text>
      </Box>
    )),
  )
}
