// The shape Liveroom's panels draw from. The state itself (codex, steps, skills, plugins, rules, team
// and tasks in the `liveroom` namespace) is declared and read in register.tsx: the engine scans atoms and $
// only in the hooks module's own file.
import type { CodexRun, Tally } from './core'
import type { Team, TeamTask } from './team'
import { tasksOf, teamOf } from './team'

export type RoomView = {
  codex: CodexRun[]
  steps: Tally
  skills: Tally
  plugins: Tally
  rules: Record<string, string>
  team: Team
  tasks: TeamTask[]
}

const listOf = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])
const recordOf = <T>(x: unknown): Record<string, T> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, T>) : {}

/** The room as the panels draw it: a missing or odd value reads as empty. */
export function roomView(c: unknown, s: unknown, k: unknown, p: unknown, r: unknown, t: unknown, ts: unknown): RoomView {
  return { codex: listOf<CodexRun>(c), steps: recordOf(s), skills: recordOf(k), plugins: recordOf(p), rules: recordOf(r), team: teamOf(t), tasks: tasksOf(ts) }
}
