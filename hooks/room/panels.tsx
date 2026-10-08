// Liveroom's panels: models, codex and skills. Drawn inside Flightdeck's pane with its colours
// and its status language: ◐ running in the agent colour, ✓ done in green, ✗ failed in red.
import type { Elements } from 'claude-code'

import type { Colors, Palette } from '../core'
import { prettyModel } from '../core'
import type { CodexRun, RunStatus } from './core'
import { meter, runGlyph, top } from './core'
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
  /** Flightdeck's live clock: ticks on the surface's own frame clock while `endAt` is null. */
  clock: (key: string, since: number, endAt: number | null, color: string) => JSX.Element
}

export const isRoomPanel = (p: string): p is RoomPanel => (ROOM_PANELS as readonly string[]).includes(p)

/** A panel with nothing to show takes no room, as Flightdeck's do. */
export function isRoomEmpty(p: RoomPanel, room: RoomView): boolean {
  if (p === 'models') return Object.keys(room.steps).length === 0
  if (p === 'codex') return room.codex.length === 0
  return Object.keys(room.skills).length === 0 && Object.keys(room.plugins).length === 0
}

export const statusColorOf = (C: Colors, s: RunStatus) => (s === 'failed' ? C.warn : s === 'done' ? C.gate : C.agent)

const KIND_LABEL: Record<CodexRun['kind'], string> = { rescue: 'rescue', consult: 'consult', exec: 'exec', review: 'review' }

export function drawRoom(p: RoomPanel, w: number, x: RoomCtx): JSX.Element {
  const { Box, Text } = x.els
  const { C, room } = x
  const RC = ROOM_COLORS[x.palette]

  const frame = (color: string, title: string, hint: string, body: JSX.Element | JSX.Element[]) => (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={w}>
      <Box justifyContent="space-between">
        <Text color={color} bold>
          {title}
        </Text>
        <Text color={C.dim}>{hint}</Text>
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
      'MODELS · requests',
      String(total),
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
    const running = room.codex.filter(r => r.status === 'running').length
    const shown = room.codex.slice(-6)
    const warned = room.codex.filter(r => r.ruleNote).length
    return frame(
      RC.codex,
      'CODEX · hand-offs',
      `${running} running · ${room.codex.length} total`,
      [
        ...shown.map(r => (
          <Box justifyContent="space-between">
            <Text wrap="truncate">
              <Text color={statusColorOf(C, r.status)}>{`${runGlyph(r.status)} `}</Text>
              <Text color={r.status === 'running' ? C.text : C.dim}>{KIND_LABEL[r.kind]}</Text>
              {r.ruleNote ? <Text color={C.amber}>{' ⚠'}</Text> : null}
            </Text>
            <Box flexShrink={0}>
              <Text>
                <Text color={r.status === 'running' ? C.text : C.dim} bold={r.status === 'running'}>
                  {r.model ?? (r.kind === 'review' ? 'own model' : 'default')}
                </Text>
                {r.effort ? <Text color={C.dim}>{` · ${r.effort} `}</Text> : <Text> </Text>}
              </Text>
              {x.clock(`codex-clock-${r.id}`, r.startedAt, r.endedAt, C.dim)}
            </Box>
          </Box>
        )),
        ...(warned > 0
          ? [
              <Text color={C.amber} wrap="truncate">
                {`⚠ ${warned} without model or effort`}
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
    'SKILLS · plugins',
    `${Object.keys(room.skills).length} · ${Object.keys(room.plugins).length}`,
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
