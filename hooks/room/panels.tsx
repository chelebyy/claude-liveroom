// Liveroom's panels: models, codex and skills. Drawn inside Flightdeck's pane with its colours
// and its status language: ◐ running in the agent colour, ✓ done in green, ✗ failed in red.
import type { Elements } from 'claude-code'

import type { Colors, Palette } from '../core'
import { prettyModel, shorten } from '../core'
import type { CodexRun, RunStatus } from './core'
import { meter, runGlyph, top } from './core'
import type { Key, T } from './i18n'
import type { RoomView } from './state'

export type RoomPanel = 'models' | 'codex' | 'skills'
export const ROOM_PANELS: readonly RoomPanel[] = ['models', 'codex', 'skills']

/** The room's own colours: theme keys by default, fixed hex under `pastel`. */
export const ROOM_COLORS: Record<Palette, { codex: string; skills: string }> = {
  theme: { codex: 'ide', skills: 'planMode' },
  pastel: { codex: '#f9a8d4', skills: '#fdba74' },
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
