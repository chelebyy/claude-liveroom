export type Moment = 'before a plan' | 'error repeats' | 'before done'

export type Bucket = 'file' | 'shell' | 'other'

/** rule: settings allowed it. ask: put to the decider, outcome pending. cleared: asked, then ran. deny: refused. */
export type Verdict = 'rule' | 'ask' | 'cleared' | 'deny'

export type Main = { model: string; effort: string; mode: string; steps: number; isRunning: boolean }

export type Usage = {
  pct: number | null
  tokens: number | null
  window: number
  costUsd: number | null
  limits: { kind: string; pct: number }[]
  compactions: number
  lastCompactAt: number | null
}

export type Consult = { id: string; at: number; endAt: number | null; moment: Moment; via: string }

export type Architect = { consults: Consult[]; ids: string[]; seen: string[]; lastAdvice: string }

export type Check = {
  id: string
  tool: string
  bucket: Bucket
  verdict: Verdict
  inSubagent: boolean
  detail: string
  at: number
}

export type Tally = { rule: number; ask: number; cleared: number; deny: number }

export type Gate = { recent: Check[]; totals: Record<Bucket, Tally> }

export type ToolNote = { tool: string; text: string; isError: boolean }

export type AgentCard = {
  id: string
  type: string
  model: string
  description: string
  status: string
  spawnedAt: number
  endedAt: number | null
  /** The agent's context now: input + cache read + cache write of its latest step. */
  ctx: number
  /** Output tokens summed over its steps. */
  out: number
  steps: number
  lastStop: string | null
  tools: ToolNote[]
  answer: string
}

/** A model loop whose id matches no card: a workflow agent, a compaction or a memory fork. */
export type Loop = { id: string; steps: number; firstAt: number; lastAt: number; isDone: boolean }

export type LogLine = {
  at: number
  who: string
  text: string
  agentId: string | null
  kind: 'info' | 'error' | 'consult' | 'done'
}

export type Turn = {
  edits: number
  errorStreak: number
  errors: number
  isReviewing: boolean
  startedAt: number
  costAtStart: number | null
}

export type Receipt = {
  durationMs: number
  agents: number
  edits: number
  errors: number
  costDelta: number | null
  reason: string
}

export type Layout = 'auto' | 'compact' | 'wide' | 'mini'

export type View = { expanded: string | null; gateOpen: Bucket | null; layout: Layout | null }

export type Roster = { architectTypes: string[] }

// ---- Liveroom's additions (hooks/room)

/**
 * `background`: a codex the shell line sent off with `&`; it runs on, but no event says when it ends.
 * `ended`: it ended, but the shell's exit status was another command's, so there is no verdict.
 */
export type RunStatus = 'running' | 'background' | 'done' | 'failed' | 'ended'

/** One piece of work handed to Codex: through the codex-rescue subagent or the codex CLI. */
export type CodexRun = {
  id: string
  /** `rescue` writes files, `consult` is read-only; `exec` and `review` are direct CLI calls. */
  kind: 'rescue' | 'consult' | 'exec' | 'review'
  /** The model the call names; null when it leaves Codex's own default. */
  model: string | null
  effort: string | null
  status: RunStatus
  startedAt: number
  endedAt: number | null
  /** Why the call breaks the delegation rule; null when it keeps it. */
  ruleNote: string | null
  /** For a codex-rescue run, the subagent carrying it: its end ends the run. */
  agentId: string | null
  /** Another command runs after it on the shell line, so the line's exit status is not its own. */
  isExitShared?: boolean
  /** It runs only if the command before it succeeded (`and`) or failed (`or`). */
  reachedBy?: 'and' | 'or' | null
}

/**
 * A teammate's state: `working` in a turn, `idle` waiting for a message, `ended` once it shut down,
 * `failed` when its turn died on an error.
 */
export type MemberState = 'working' | 'idle' | 'ended' | 'failed'

/** One teammate of the session's agent team. */
export type TeamMember = {
  /** Its agent id: `agent.spawn`'s answer, the `agentId` its loop's events carry. */
  id: string
  /** Its name in the team, which SendMessage addresses it by (`scout`, `scout-2`). */
  name: string
  model: string
  state: MemberState
  /** When it entered its state. */
  since: number
  /** It runs in a terminal pane of its own: its turns raise no events here, so its state is inferred. */
  isPane: boolean
  /** Messages it sent. */
  sent: number
}

/**
 * One message between the lead and its teammates, or between teammates: `text` is the sender's
 * summary or the message's first line. A protocol message is its kind, with the answer when it is one.
 */
export type TeamMessage = {
  at: number
  from: string
  to: string
  kind: 'text' | 'shutdown-request' | 'shutdown-response' | 'plan-request' | 'plan-response'
  text: string
  approve: boolean | null
}

/** The session's agent team, as the lead's events report it. */
export type Team = { members: TeamMember[]; messages: TeamMessage[] }

/** One task of the session's task list, as the Task tools report it. */
export type TeamTask = {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  owner: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'liveroom': {
      meta: { schemaVersion: number }
      main: Main
      usage: Usage
      architect: Architect
      gate: Gate
      agents: AgentCard[]
      loops: Loop[]
      log: LogLine[]
      turn: Turn
      receipt: Receipt | null
      view: View
      roster: Roster
      // Liveroom's additions (hooks/room).
      /** Codex hand-offs: codex-rescue spawns and codex CLI calls. */
      codex: CodexRun[]
      /** Requests per `model · effort`, across the main loop and every subagent. */
      steps: Record<string, number>
      skills: Record<string, number>
      /** Uses per plugin: its skills, its agent types and its MCP tools. */
      plugins: Record<string, number>
      /** Agent id → why its spawn broke the delegation rule. */
      rules: Record<string, string>
      /** The agent team's members and their messages. */
      team: Team
      /** The task list the Task tools keep. */
      tasks: TeamTask[]
    }
  }
}
