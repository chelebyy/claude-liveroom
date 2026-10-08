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

/**
 * A shell line as words and separators: quotes removed, `;`, `&`, `|` and newlines kept apart.
 * Enough to find a command and its options; not a full shell parser.
 */
export function shellWords(line: string): { word: string; isSep: boolean }[] {
  const out: { word: string; isSep: boolean }[] = []
  let word = ''
  let hasWord = false
  let quote: '"' | "'" | null = null
  const flush = () => {
    if (hasWord) out.push({ word, isSep: false })
    word = ''
    hasWord = false
  }
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) word += line[++i]
      else word += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasWord = true
    } else if (ch === '\\' && i + 1 < line.length) {
      word += line[++i]
      hasWord = true
    } else if (ch === ';' || ch === '&' || ch === '|' || ch === '\n') {
      flush()
      out.push({ word: ch, isSep: true })
    } else if (ch === ' ' || ch === '\t') {
      flush()
    } else {
      word += ch
      hasWord = true
    }
  }
  flush()
  return out
}

/** Codex options that take a value, globally or on exec and review. */
const CODEX_VALUE_OPTS = new Set([
  '-m', '--model', '-c', '--config', '-p', '--profile', '-C', '--cd', '-s', '--sandbox',
  '-a', '--ask-for-approval', '-i', '--image', '--enable', '--disable', '--add-dir',
  '-o', '--output-last-message', '--output-schema', '--color', '--local-provider', '--base', '--commit', '--title',
])

/** Words that run the command after them: `env`, `nohup`, `timeout 900` and the like. */
const WRAPPERS = new Set(['env', 'nohup', 'time', 'sudo', 'command', 'exec', 'npx'])

const unquote = (v: string) => v.replace(/^(["'])(.*)\1$/, '$2')

/** One `-c key=value` override, or null when it sets another key. */
const configValue = (kv: string, key: string): string | null => {
  const at = kv.indexOf('=')
  return at > 0 && kv.slice(0, at).trim() === key ? unquote(kv.slice(at + 1).trim()) || null : null
}

export type CodexCli = { kind: 'exec' | 'review'; model: string | null; effort: string | null }

/**
 * A codex exec or review call in a shell line, read from its own option words: `-m` / `--model` /
 * `-c model=…` and `-c model_reasoning_effort=…`, before or after the subcommand. The prompt and
 * any other command on the line are never read as options. Null when the line calls no such codex.
 */
export function parseCodexCli(line: string): CodexCli | null {
  const words = shellWords(line)
  for (let i = 0; i < words.length; i++) {
    // Only a word in command position is a command: the start, after a separator, or after a wrapper.
    let j = i
    while (j < words.length && !words[j]!.isSep && (/^\w+=/.test(words[j]!.word) || WRAPPERS.has(words[j]!.word))) j++
    if (j < words.length && words[j]!.word === 'timeout') {
      j++
      while (j < words.length && words[j]!.word.startsWith('-')) j++
      j++ // the duration
    }
    const head = words[j]
    const isCodex = head && !head.isSep && /(^|\/)codex(\.exe)?$/.test(head.word)
    if (isCodex) {
      let kind: CodexCli['kind'] | null | undefined
      let model: string | null = null
      let effort: string | null = null
      let k = j + 1
      let isOptionsDone = false
      for (; k < words.length && !words[k]!.isSep; k++) {
        const w = words[k]!.word
        if (!isOptionsDone && w === '--') {
          isOptionsDone = true
          continue
        }
        if (!isOptionsDone && w.startsWith('-') && w.length > 1) {
          const eq = w.indexOf('=')
          const name = eq > 0 ? w.slice(0, eq) : w
          const value = eq > 0 ? w.slice(eq + 1) : CODEX_VALUE_OPTS.has(name) ? (words[k + 1]?.isSep ? null : (words[++k]?.word ?? null)) : null
          if (value === null) continue
          if (name === '-m' || name === '--model') model = unquote(value)
          else if (name === '-c' || name === '--config') {
            model = configValue(value, 'model') ?? model
            effort = configValue(value, 'model_reasoning_effort') ?? effort
          }
          continue
        }
        // The first plain word is the subcommand; later ones are its prompt or arguments.
        if (kind === undefined) kind = w === 'exec' || w === 'e' ? 'exec' : w === 'review' ? 'review' : null
      }
      if (kind) return { kind, model, effort }
      i = k
      continue
    }
    // Skip to the next command on the line.
    while (i < words.length && !words[i]!.isSep) i++
  }
  return null
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
    agentId: null,
  }
}

/** A Codex run from a shell command; null when the command doesn't call Codex. */
export function cliRun(id: string, command: string, at: number): CodexRun | null {
  const cli = parseCodexCli(command)
  if (!cli) return null
  return {
    id,
    kind: cli.kind,
    model: cli.model,
    effort: cli.effort,
    status: 'running',
    startedAt: at,
    endedAt: null,
    ruleNote: cli.kind === 'review' ? null : ruleNote(cli.model, cli.effort, true),
    agentId: null,
  }
}

/** Ends a run; one that is already over keeps its first ending. */
export function endRun(runs: readonly CodexRun[], id: string, status: 'done' | 'failed', at: number): CodexRun[] {
  return runs.map(r => (r.id === id && (r.status === 'running' || r.status === 'background') ? { ...r, status, endedAt: at } : r))
}

/** A run whose call returned while its work goes on unseen: a background shell. */
export function backgroundRun(runs: readonly CodexRun[], id: string): CodexRun[] {
  return runs.map(r => (r.id === id && r.status === 'running' ? { ...r, status: 'background' as const } : r))
}

/** Ties a codex-rescue run to the subagent its spawn started, so the subagent's end ends it. */
export function linkRun(runs: readonly CodexRun[], id: string, agentId: string): CodexRun[] {
  return runs.map(r => (r.id === id ? { ...r, agentId } : r))
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

/** The glyph a status draws with; running, done and failed match the agent cards. */
export function runGlyph(status: RunStatus): string {
  return status === 'running' ? '◐' : status === 'background' ? '◌' : status === 'done' ? '✓' : '✗'
}
