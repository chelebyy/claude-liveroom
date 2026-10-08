// Liveroom's additions to Flightdeck, as pure functions: Codex runs, the delegation rule,
// and the tallies behind the models and skills panels. Nothing here touches the engine.

import type { CodexRun, RunStatus } from '../../types'

export type { CodexRun, RunStatus }

export const CODEX_RESCUE = 'codex:codex-rescue'

/** The value of `--name x`, `--name=x` or `-n x` in a prompt or a command line. */
export function flag(text: string, long: string, short?: string): string | null {
  const names = short ? `--${long}|-${short}` : `--${long}`
  const match = text.match(new RegExp(`(?:^|\\s)(?:${names})(?:=|\\s+)["']?([\\w.:-]+)`))
  return match?.[1] ?? null
}

/** The Codex CLI takes effort as `-c model_reasoning_effort=high`; the rescue agent as `--effort`. */
export function codexEffort(text: string): string | null {
  return text.match(/model_reasoning_effort\s*=\s*["']?(\w+)/)?.[1] ?? flag(text, 'effort')
}

/** `codex exec …`, `codex e …` or `codex review …` anywhere in a shell command; null otherwise. */
export function codexCommand(command: string): 'exec' | 'review' | null {
  const match = command.match(/(^|[\s;&|(])codex(\.exe)?\s+(exec|e|review)\b/)
  if (!match) return null
  return match[3] === 'review' ? 'review' : 'exec'
}

/** Whether a task asks Codex only for an opinion: no file edits. */
export function isReadOnly(prompt: string): boolean {
  return /read-only|readonly|do not edit|salt okunur/i.test(prompt)
}

/** The plugin behind a `plugin:skill` or `plugin:agent` name; null for a bare name. */
export function pluginOfName(name: string): string | null {
  const at = name.indexOf(':')
  return at > 0 ? name.slice(0, at) : null
}

/** The plugin behind an `mcp__plugin_<plugin>_<server>__<tool>` tool name; null for any other tool. */
export function pluginOfTool(tool: string): string | null {
  return tool.match(/^mcp__plugin_([a-z0-9-]+)_[^_]/i)?.[1] ?? null
}

/**
 * The delegation rule: a hand-off names its model, and a Codex hand-off its effort too.
 * `codex review` picks its own model, so it always keeps the rule.
 */
export function ruleNote(model: string | null, effort: string | null, needsEffort: boolean): string | null {
  const missing = [!model && 'model', needsEffort && !effort && 'effort'].filter(Boolean)
  return missing.length === 0 ? null : `no ${missing.join(' or ')} given`
}

/** A Codex run from a codex-rescue spawn's prompt. */
export function rescueRun(id: string, prompt: string, at: number): CodexRun {
  const model = flag(prompt, 'model')
  const effort = codexEffort(prompt)
  return {
    id,
    kind: isReadOnly(prompt) ? 'consult' : 'rescue',
    model,
    effort,
    status: 'running',
    startedAt: at,
    endedAt: null,
    ruleNote: ruleNote(model, effort, true),
  }
}

/** A Codex run from a shell command; null when the command doesn't call Codex. */
export function cliRun(id: string, command: string, at: number): CodexRun | null {
  const kind = codexCommand(command)
  if (!kind) return null
  const model = flag(command, 'model', 'm')
  const effort = codexEffort(command)
  return {
    id,
    kind,
    model,
    effort,
    status: 'running',
    startedAt: at,
    endedAt: null,
    ruleNote: kind === 'review' ? null : ruleNote(model, effort, true),
  }
}

/** Ends a run; one that is already over keeps its first ending. */
export function endRun(runs: readonly CodexRun[], id: string, status: Exclude<RunStatus, 'running'>, at: number): CodexRun[] {
  return runs.map(r => (r.id === id && r.status === 'running' ? { ...r, status, endedAt: at } : r))
}

/** The newest runs, oldest first, capped so a long session doesn't grow the state without end. */
export function pushRun(runs: readonly CodexRun[], run: CodexRun, keep = 30): CodexRun[] {
  return [...runs, run].slice(-keep)
}

export type Tally = Record<string, number>

export function bump(tally: Readonly<Tally>, key: string): Tally {
  return { ...tally, [key]: (tally[key] ?? 0) + 1 }
}

/** The `n` largest entries, largest first; ties keep their first-seen order. */
export function top(tally: Readonly<Tally>, n: number): [string, number][] {
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

/** The key the models panel counts requests under. */
export function stepKey(model: string, effort: unknown): string {
  return effort === undefined || effort === null || effort === '' ? model : `${model} · ${String(effort)}`
}

/** A 0–1 share as `▰▰▰▱▱`; any share above zero fills at least one cell. */
export function meter(share: number, width: number): string {
  const s = Math.min(1, Math.max(0, share))
  const filled = s > 0 ? Math.max(1, Math.round(s * width)) : 0
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

/** The glyph a status draws with; shared with the agent cards. */
export function runGlyph(status: RunStatus): string {
  return status === 'running' ? '◐' : status === 'done' ? '✓' : '✗'
}
