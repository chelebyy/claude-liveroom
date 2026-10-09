import { atom, read, update } from 'claude-code'
import type { ApiContentBlock, EngineInterface, Register } from 'claude-code'

import type { AgentCard, Architect, Bucket, Check, Gate, Layout, LogLine, Loop, Main, Roster, Turn, Usage, View } from '../types'
import {
  DEFAULT_ARCHITECT,
  DEFAULT_GATE,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  EDIT_TOOLS,
  SCHEMA_VERSION,
  afterCall,
  applyStep,
  bucketOf,
  cardTitle,
  titleLines,
  consultTimeline,
  describeInput,
  endConsult,
  fitLegend,
  fmtClock,
  fmtDuration,
  fmtTimer,
  fmtUsd,
  gateSummary,
  gauge,
  isAdvising,
  isLoopActive,
  kTokens,
  lanes,
  limitLabel,
  listOf,
  logRows,
  momentOf,
  normalize,
  normalizeCard,
  normalizeGate,
  normalizeLog,
  noteTool,
  PALETTES,
  SVG_COLORS,
  parseConfig,
  prettyModel,
  promptLine,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  settleCheck,
  shorten,
  startConsult,
  stepLoop,
} from './core'
import type { Config, Panel } from './core'
import type { RoomPanel } from './room/panels'
import { MEMBER_GLYPH, ROOM_COLORS, drawRoom, isRoomEmpty, isRoomPanel, loopDots, mainModel, memberColorOf, roomRows } from './room/panels'
import type { CodexRun } from './room/core'
import { CODEX_RESCUE, backgroundRun, bump, callRunId, cliRun, endNoticed, endRun, linkRun, noteRule, openerOf, parseCodexCalls, pluginOfName, pluginOfTool, pushRun, rescueRun, shellEnd, stepKey, taskNotices, withoutPeerNote } from './room/core'
import type { LanguageOption, T } from './room/i18n'
import { clockAblative, isKey, langOf, makeT } from './room/i18n'
import type { RoomView } from './room/state'
import { roomView } from './room/state'
import { LEAD, addTask, applyMessage, assignTask, isNotice, isTeamMessage, joinTeam, listTasks, memberNamed, memberOf, messageOf, noticeOf, protocolOf, reopen, setState, tasksOf, teamOf, turnEndState, updateTask } from './room/team'

const PANE = 'liveroom'
const TITLE = 'Liveroom'
const PANE_COLUMNS = 66


// ---------------------------------------------------------------- state

const meta = atom({ plugin: 'liveroom', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
const main = atom({ plugin: 'liveroom', key: 'main' } as const, DEFAULT_MAIN)
const usage = atom({ plugin: 'liveroom', key: 'usage' } as const, DEFAULT_USAGE)
const architect = atom({ plugin: 'liveroom', key: 'architect' } as const, DEFAULT_ARCHITECT)
const gate = atom({ plugin: 'liveroom', key: 'gate' } as const, DEFAULT_GATE)
const agents = atom({ plugin: 'liveroom', key: 'agents' } as const, [])
const loops = atom({ plugin: 'liveroom', key: 'loops' } as const, [])
const log = atom({ plugin: 'liveroom', key: 'log' } as const, [])
const turn = atom({ plugin: 'liveroom', key: 'turn' } as const, DEFAULT_TURN)
const receipt = atom({ plugin: 'liveroom', key: 'receipt' } as const, null)
const view = atom({ plugin: 'liveroom', key: 'view' } as const, DEFAULT_VIEW)
const roster = atom({ plugin: 'liveroom', key: 'roster' } as const, DEFAULT_ROSTER)

type ServerBlock = { type: string; id?: string; name?: string; tool_use_id?: string }

// Every read goes through these, so a value saved under an older shape still reads.
async function getMain($: EngineInterface): Promise<Main> {
  return normalize(DEFAULT_MAIN, await read($, main))
}
async function getUsage($: EngineInterface): Promise<Usage> {
  return normalize(DEFAULT_USAGE, await read($, usage))
}
async function getArchitect($: EngineInterface): Promise<Architect> {
  const a = normalize(DEFAULT_ARCHITECT, await read($, architect))
  return { ...a, consults: listOf(a.consults), ids: listOf(a.ids), seen: listOf(a.seen) }
}
async function getGate($: EngineInterface): Promise<Gate> {
  return normalizeGate(await read($, gate))
}
async function getCards($: EngineInterface): Promise<AgentCard[]> {
  return listOf<unknown>(await read($, agents)).map(normalizeCard)
}
async function getLoops($: EngineInterface): Promise<Loop[]> {
  return listOf<Loop>(await read($, loops))
}
async function getLog($: EngineInterface): Promise<LogLine[]> {
  return normalizeLog(await read($, log))
}
async function getTurn($: EngineInterface): Promise<Turn> {
  return normalize(DEFAULT_TURN, await read($, turn))
}
async function getView($: EngineInterface): Promise<View> {
  return normalize(DEFAULT_VIEW, await read($, view))
}
async function getRoster($: EngineInterface): Promise<Roster> {
  const r = normalize(DEFAULT_ROSTER, await read($, roster))
  return { architectTypes: listOf(r.architectTypes) }
}

/** A stored shape older than this build's: drop what cannot be read, keep the rest. */
async function migrate($: EngineInterface) {
  const m = await read($, meta)
  if ((m?.schemaVersion ?? 0) >= SCHEMA_VERSION) return
  await update($, log, list => normalizeLog(list))
  await update($, agents, list => listOf<unknown>(list).map(normalizeCard))
  await update($, gate, g => normalizeGate(g))
  await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
}

async function say($: EngineInterface, who: string, text: string, kind: LogLine['kind'] = 'info', agentId: string | null = null) {
  const line: LogLine = { at: await $.clock.now(), who, text, kind, agentId }
  await update($, log, list => [...normalizeLog(list), line].slice(-60))
}

async function refreshStatus($: EngineInterface, cfg: Config) {
  if (!cfg.statusLine) return $.ui.status(undefined)
  const [u, a, g, cards, t] = await Promise.all([getUsage($), getArchitect($), getGate($), getCards($), read($, team).then(teamOf)])
  const running = cards.filter(c => c.status === 'running').length
  const working = t.members.filter(m => m.state === 'working').length
  const live = t.members.filter(m => m.state === 'working' || m.state === 'idle').length
  const s = gateSummary(g)
  const parts = [
    u.pct !== null ? tx('ctx {n}%', { n: Math.round(u.pct) }) : null,
    cards.length > 0 ? tx('agents {running}/{total}', { running, total: cards.length }) : null,
    live > 0 ? tx('team {working}/{total}', { working, total: live }) : null,
    a.consults.length > 0 || a.ids.length > 0 ? `${lower(cfg.architectLabel)} ${isAdvising(a) ? tx('advising') : a.consults.length}` : null,
    s.deny > 0 ? tx('denied {n}', { n: s.deny }) : null,
  ]
  // Only fields with something to say; with none, no status entry at all.
  const shown = parts.filter(Boolean)
  $.ui.status(shown.length > 0 ? shown.join(' · ') : undefined)
}

async function whoIs($: EngineInterface, agentId: string | undefined) {
  if (!agentId) return 'main'
  const card = (await getCards($)).find(c => c.id === agentId)
  const member = card ? undefined : memberOf(teamOf(await read($, team)), agentId)
  return card ? shorten(cardTitle(card), 14) : member ? shorten(member.name, 14) : 'agent'
}

async function consultStarted($: EngineInterface, cfg: Config, id: string, via: string) {
  const t = await getTurn($)
  const moment = momentOf(t)
  const at = await $.clock.now()
  await update($, architect, a => startConsult(normalize(DEFAULT_ARCHITECT, a), { id, at, moment, via }))
  if (moment === 'before done') await update($, turn, x => ({ ...normalize(DEFAULT_TURN, x), isReviewing: true }))
  await say($, lower(cfg.architectLabel), cfg.moments ? tx('{moment} · {via}', { moment: tx(moment), via }) : tx('consulted · {via}', { via }), 'consult')
  await refreshStatus($, cfg)
}

async function consultEnded($: EngineInterface, cfg: Config, advice: string | null, id?: string) {
  const at = await $.clock.now()
  const first = advice?.split('\n').find(l => l.trim()) ?? null
  const text = first ? shorten(first.replace(/^[#>*\s-]+/, ''), 160) : null
  await update($, architect, a => endConsult(normalize(DEFAULT_ARCHITECT, a), at, text, id))
  await update($, turn, t => ({ ...normalize(DEFAULT_TURN, t), isReviewing: false }))
  await say($, lower(cfg.architectLabel), text ? tx('advice: {text}', { text: shorten(text, 60) }) : tx('advice returned'), 'consult')
  await refreshStatus($, cfg)
}

async function noteAdvice($: EngineInterface, cfg: Config, advice: string) {
  await update($, architect, x => ({ ...normalize(DEFAULT_ARCHITECT, x), lastAdvice: advice }))
  await say($, lower(cfg.architectLabel), tx('advice: {text}', { text: shorten(advice, 60) }), 'consult')
}

async function isArchitectType($: EngineInterface, cfg: Config, type: string) {
  return cfg.architect.test(type) || (await getRoster($)).architectTypes.includes(type)
}

async function openPane($: EngineInterface) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  return $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS, rows: 8 })
}

async function resetAll($: EngineInterface) {
  await update($, main, m => ({ ...DEFAULT_MAIN, model: normalize(DEFAULT_MAIN, m).model, mode: normalize(DEFAULT_MAIN, m).mode }))
  await update($, architect, () => DEFAULT_ARCHITECT)
  await update($, gate, () => DEFAULT_GATE)
  await update($, agents, () => [])
  await update($, loops, () => [])
  await update($, log, () => [])
  await update($, turn, () => DEFAULT_TURN)
  await update($, receipt, () => null)
  await update($, view, () => DEFAULT_VIEW)
  // The context gauge waits for the next measurement rather than showing the pre-clear fill.
  await update($, usage, x => ({ ...normalize(DEFAULT_USAGE, x), pct: null, tokens: null }))
  await resetRoom($)
}

/** The session's cost read fresh, not from the last measurement: the receipt subtracts two of these. */
async function costNow($: EngineInterface): Promise<number | null> {
  const u = await $.session.usage().catch(() => null)
  return u?.cost?.usd ?? null
}

async function noteMode($: EngineInterface, mode: string | undefined) {
  if (mode) await update($, main, m => (normalize(DEFAULT_MAIN, m).mode === mode ? normalize(DEFAULT_MAIN, m) : { ...normalize(DEFAULT_MAIN, m), mode }))
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  const C = PALETTES[cfg.palette]
  // tool.check carries no loop id; the tool.call around it does, keyed by the call's id.
  const callLoop = new Map<string, string | null>()

  on('session.start', async ($, e, next) => {
    await noteLanguage($, cfg.language)
    localizeLabels(cfg, options)
    await $.command.register({
      name: 'liveroom',
      description: tx('Liveroom, the live agent dashboard: open, close, reset, or set the layout'),
      argumentHint: '[open|close|reset|layout auto|compact|wide|mini]',
    })
    await migrate($)
    // A host without usage (headless, an SDK host, a session not yet bound) just starts without it.
    const u = await $.session.usage().catch(() => null)
    if (u) {
      await update($, usage, x => ({
        ...normalize(DEFAULT_USAGE, x),
        pct: u.context.percent ?? null,
        tokens: u.context.tokens ?? null,
        window: u.context.window,
        costUsd: u.cost?.usd ?? null,
        limits: u.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed })),
      }))
    }
    if (cfg.openOnStart) void openPane($).catch(() => undefined)
    await refreshStatus($, cfg)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetAll($)
      await refreshStatus($, cfg)
    } else {
      await endTeammates($)
      await refreshStatus($, cfg)
    }
    return next(e)
  })

  on('command.run', { command: 'liveroom' }, async ($, e) => {
    const [verb = 'open', arg = ''] = e.args.trim().split(/\s+/)
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: tx('Liveroom closed.') }
    }
    if (verb === 'reset') {
      await resetAll($)
      await refreshStatus($, cfg)
      return { text: tx('Liveroom reset.') }
    }
    if (verb === 'layout') {
      const layout: Layout | null = arg === 'compact' || arg === 'wide' || arg === 'auto' || arg === 'mini' ? arg : null
      if (!layout) return { text: tx('Usage: /liveroom layout auto|compact|wide|mini') }
      await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), layout }))
      const opened = await openPane($)
      return { text: opened.isPlaced ? tx('Liveroom layout: {layout}.', { layout }) : tx('Layout set to {layout}; the pane is not shown yet: {reason}', { layout, reason: opened.reason }) }
    }
    const opened = await openPane($)
    if (!opened.isPlaced) return { text: tx('Liveroom is not shown yet: {reason}', { reason: opened.reason }) }
    return { text: tx('Liveroom opened. Focus it with ctrl+x tab; 1-6 expand cards, f/s/o open the gate rows.') }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  })

  on('agent.offer', async ($, e, next) => {
    const offered = await next(e)
    if (cfg.architect.test(e.agent) || (cfg.matchDescriptions && cfg.architect.test(e.description))) {
      await update($, roster, r => {
        const x = normalize(DEFAULT_ROSTER, r)
        return x.architectTypes.includes(e.agent) ? x : { architectTypes: [...listOf<string>(x.architectTypes), e.agent].slice(-20) }
      })
    }
    return offered
  })

  on('turn.start', async ($, e, next) => {
    const [now, cost] = await Promise.all([$.clock.now(), costNow($)])
    await update($, turn, () => ({ ...DEFAULT_TURN, startedAt: now, costAtStart: cost }))
    await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: true }))
    // A background architect's report reaches the main loop as the text opening this turn. The
    // SubagentHandback tool call (in tool.call) normally carries it first; this is the fallback.
    const opener = withoutPeerNote(e.text)
    const back = opener ? handbackOf(opener) : null
    const a = back ? await getArchitect($) : null
    if (back && a && a.ids.includes(back.from)) {
      const advice = adviceLine(back.body)
      if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
    } else if (opener) {
      const p = promptLine(opener)
      await say($, p.who, engineLine(opener) ?? p.text)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    await noteStep($, e.model, e.effort)
    // The main loop's model is known when its request starts; a long first request shouldn't read "—".
    if (!e.agentId) {
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        return { ...x, model: e.model, effort: String(e.effort ?? x.effort), steps: x.steps + 1 }
      })
      return yield* next(e)
    }
    // A teammate's first step starts its turn: it works until the turn ends.
    if (await teamStep($, cfg, e.agentId, e.index)) return yield* next(e)
    const result = yield* next(e)
    const id = e.agentId
    const [cards, a] = await Promise.all([getCards($), getArchitect($)])
    if (cards.some(c => c.id === id)) {
      const step = { model: e.model, usage: result.usage, stopReason: result.stopReason }
      await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? applyStep(c, step) : c)))
      if (result.stopReason === 'max_tokens') await say($, await whoIs($, id), tx('hit max_tokens'), 'error', id)
    } else if (!a.ids.includes(id)) {
      const now = await $.clock.now()
      await update($, loops, l => stepLoop(listOf<Loop>(l), id, now))
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, x => ({
      ...normalize(DEFAULT_USAGE, x),
      pct: e.context.percent ?? null,
      tokens: e.context.tokens ?? null,
      window: e.context.window,
      costUsd: e.cost?.usd ?? null,
      limits: e.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed })),
    }))
    if (e.changed.includes('context')) await refreshStatus($, cfg)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.trigger !== 'precompute') {
      const now = await $.clock.now()
      await update($, usage, x => {
        const u = normalize(DEFAULT_USAGE, x)
        return { ...u, compactions: u.compactions + 1, lastCompactAt: now }
      })
      await say($, 'main', tx('context compacted ({trigger})', { trigger: e.trigger }))
    }
    return done
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.tool_use_id) {
      const check: Check = {
        id: e.tool_use_id,
        tool: e.tool,
        bucket: bucketOf(e.tool),
        verdict: verdict.decision === 'allow' ? 'rule' : verdict.decision,
        inSubagent: Boolean(callLoop.get(e.tool_use_id)),
        detail: shorten(describeInput(e.tool, e.input), 90),
        at: await $.clock.now(),
      }
      await update($, gate, g => recordCheck(normalizeGate(g), check))
      // The status line updates when the call settles; only a refusal ends here.
      if (verdict.decision === 'deny') {
        await say($, 'gate', tx('denied by rule · {detail}', { detail: check.detail }), 'error')
        await refreshStatus($, cfg)
      }
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    callLoop.set(e.tool_use_id, e.agentId ?? null)
    const ran = await next(e).finally(() => callLoop.delete(e.tool_use_id))
    const didRun = ran.deny === undefined
    if (didRun) await countPluginTool($, e.tool)
    // Settle this call's pending ask, if it had one; skip the write (and the redraw) otherwise.
    const g0 = await getGate($)
    const isSettled = settleCheck(g0, e.tool_use_id, didRun) !== g0
    if (isSettled) await update($, gate, g => settleCheck(normalizeGate(g), e.tool_use_id, didRun))
    // A background agent hands its report back through this tool; an architect's report is its advice.
    if (String(e.tool) === 'SubagentHandback') {
      const message = (e as unknown as { message?: unknown }).message
      const a = e.agentId ? await getArchitect($) : null
      if (a && e.agentId && a.ids.includes(e.agentId) && typeof message === 'string') {
        const advice = adviceLine(message)
        if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
      }
      return ran
    }
    if (e.tool === 'Agent') {
      if (isSettled) await refreshStatus($, cfg)
      return ran
    }
    const hasFailed = didRun && ran.isError === true
    const isEdit = !hasFailed && didRun && EDIT_TOOLS.has(e.tool)
    const t0 = await getTurn($)
    if (isEdit || hasFailed || (!e.agentId && t0.errorStreak > 0)) {
      await update($, turn, t => afterCall(normalize(DEFAULT_TURN, t), { inSubagent: Boolean(e.agentId), hasFailed, isEdit }))
    }
    const text = shorten(describeInput(e.tool, e), 64)
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? noteTool(c, { tool: e.tool, text, isError: hasFailed || ran.deny !== undefined }) : c)),
      )
    }
    // The log keeps what is worth a glance: refusals, errors and edits; the rest is on the cards.
    if (ran.deny !== undefined) await say($, await whoIs($, e.agentId), tx('{text}  denied', { text }), 'error', e.agentId ?? null)
    else if (hasFailed) await say($, await whoIs($, e.agentId), `${text}  ✗`, 'error', e.agentId ?? null)
    else if (isEdit) await say($, await whoIs($, e.agentId), text, 'info', e.agentId ?? null)
    if (isSettled || !didRun) await refreshStatus($, cfg)
    return ran
  })

  // A server-side review tool never reaches tool.call: it shows only in the assistant's rows.
  on('session.append', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') await endNotifiedCodex($, e.message.content)
    if (!e.agentId && e.message.type === 'assistant') {
      const a = await getArchitect($)
      // Consults this row opened: their result may be in the same row, after the stale read above.
      const opened = new Set<string>()
      for (const block of e.message.content as unknown as readonly ServerBlock[]) {
        if (block.type === 'server_tool_use' && block.name && block.id && cfg.architect.test(block.name)) {
          if (a.seen.includes(block.id)) continue
          const id = block.id
          await update($, architect, x => {
            const y = normalize(DEFAULT_ARCHITECT, x)
            return { ...y, seen: [...listOf<string>(y.seen), id].slice(-60) }
          })
          opened.add(id)
          await consultStarted($, cfg, id, tx('{name} tool', { name: block.name }))
        } else if (block.type.endsWith('_tool_result') && block.tool_use_id) {
          const id = block.tool_use_id
          const isOpen = opened.has(id) || (await getArchitect($)).consults.some(c => c.id === id && c.endAt === null)
          if (isOpen) await consultEnded($, cfg, null, id)
        }
      }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    await noteSpawn($, e, started, cfg.delegationRule)
    if (!e.parentAgentId) await noteMode($, e.permissionMode)
    if (started.deny !== undefined || !started.agentId) return started
    const id = started.agentId
    // A teammate waits between turns rather than finishing: it joins the team panel, not the cards.
    if (e.isTeammate && started.teammateId) {
      await joinTeammate($, id, started.teammateId, started.model ?? '')
      await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id)) // a first step that came before the spawn's answer
      await refreshStatus($, cfg)
      return started
    }
    if (await isArchitectType($, cfg, e.subagentType)) {
      await update($, architect, a => {
        const x = normalize(DEFAULT_ARCHITECT, a)
        return { ...x, ids: [...listOf<string>(x.ids), id].slice(-40) }
      })
      await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
      await consultStarted($, cfg, id, e.subagentType.split(':').pop() ?? 'agent')
      return started
    }
    const card: AgentCard = {
      ...normalizeCard({}),
      id,
      type: e.name ?? e.subagentType,
      model: started.model,
      description: e.description,
      spawnedAt: await $.clock.now(),
    }
    await update($, agents, list => [...listOf<unknown>(list).map(normalizeCard), card].slice(-24))
    await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
    await say($, shorten(cardTitle(card), 12), tx('spawned · {type}', { type: card.type }), 'info', id)
    await refreshStatus($, cfg)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) await endCodexAgent($, e.agentId, e.reason)
    const id = e.agentId
    const now = await $.clock.now()
    if (!id) {
      const [t, cards, cost] = await Promise.all([getTurn($), getCards($), costNow($)])
      const r = receiptOf(t, {
        durationMs: e.durationMs,
        agentsSince: cards.filter(c => c.spawnedAt >= t.startedAt).length,
        costNow: cost,
        reason: e.reason,
      })
      await update($, receipt, () => r)
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
      await refreshStatus($, cfg)
      return done
    }
    if (await endTeamTurn($, id, e.reason)) {
      await refreshStatus($, cfg)
      return done
    }
    if ((await getArchitect($)).ids.includes(id)) {
      await consultEnded($, cfg, e.answer, id)
      return done
    }
    const cards = await getCards($)
    if (cards.some(c => c.id === id)) {
      const status = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? { ...c, status, endedAt: now, answer: shorten(e.answer, 400) } : c)),
      )
      const card = cards.find(c => c.id === id)
      const took = card ? fmtDuration(now - card.spawnedAt) : ''
      await say($, await whoIs($, id), status === 'done' ? tx('done · {took}', { took }) : tx(status), status === 'done' ? 'done' : 'error', id)
    } else {
      await update($, loops, l => listOf<Loop>(l).map(x => (x.id === id ? { ...x, isDone: true, lastAt: now } : x)))
    }
    await refreshStatus($, cfg)
    return done
  })

  // ---------------------------------------------------------------- drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const hasClient = 'Client' in els
    const [m, u, a, g, cards, lp, lines, t, r, v, now, room] = await Promise.all([
      getMain($),
      getUsage($),
      getArchitect($),
      getGate($),
      getCards($),
      getLoops($),
      getLog($),
      getTurn($),
      read($, receipt),
      getView($),
      $.clock.now(),
      readRoom($),
    ])
    // A warning recorded earlier stays in the session; the option decides whether it shows now.
    const ruleOf = (id: string) => {
      const note = cfg.delegationRule ? room.rules[id] : undefined
      return note && isKey(note) ? tx(note) : note
    }
    const W = Math.max(40, e.props.bodyColumns)
    const layout = v.layout ?? cfg.layout
    const isWide = layout === 'wide' || (layout === 'auto' && W >= 110)
    const colW = isWide ? Math.floor((W - 2) / 2) : W
    const modelName = prettyModel(m.model)
    const viewed = e.props.view?.agentId ?? null
    const advising = isAdvising(a)
    const running = cards.filter(c => c.status === 'running')
    const showArchitect = a.consults.length > 0 || a.ids.length > 0
    const motion = cfg.motion && hasClient
    // A panel with nothing to show yet takes no room: most sessions never spawn an agent.
    const isEmpty: Record<Panel, boolean> = {
      main: false,
      architect: !showArchitect,
      gate: g.recent.length === 0 && gateSummary(g).total === 0,
      agents: cards.length === 0,
      loops: lp.length === 0,
      receipt: !m.isRunning && !r,
      log: false,
      models: isRoomEmpty('models', room),
      codex: isRoomEmpty('codex', room),
      skills: isRoomEmpty('skills', room),
      team: isRoomEmpty('team', room),
      tasks: isRoomEmpty('tasks', room),
    }
    const panels = cfg.panels.filter(p => !isEmpty[p])
    const decider = m.mode === 'auto' ? tx('classifier') : tx('you')

    // A connector between panels: animated while its flow is live, a dim line otherwise.
    const rail = (key: string, active: boolean, color: string, width: number, marks: number[] = [], isMerge = false) =>
      motion ? (
        <els.Client
          key={key}
          module="./rail.tsx"
          width={width}
          height={1}
          props={{ active, width, color, dim: C.faint, marks, isMerge }}
        />
      ) : (
        <Text color={C.faint}>{'─'.repeat(Math.max(1, width))}</Text>
      )

    // A start time of 0 is unknown (state saved before it was recorded): no clock, not decades.
    const clock = (key: string, since: number, endAt: number | null, color: string) =>
      since <= 0 ? (
        <Text color={color}>—</Text>
      ) : hasClient ? (
        <els.Client key={key} module="./elapsed.tsx" props={{ since, now, endAt, color }} />
      ) : (
        <Text color={color}>{fmtTimer((endAt ?? now) - since)}</Text>
      )

    // ---- main
    const effortN = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }[m.effort] ?? 0
    const ctxGauge = u.pct !== null ? gauge(u.pct, 10) : null
    const mainState = m.isRunning ? tx('● working') : tx('○ idle')
    const mainPanel = (w: number) => (
      <Box flexDirection="column" borderStyle="round" borderColor={C.main} paddingX={1} width={w}>
        <Box justifyContent="space-between">
          <Text color={C.main} bold>
            {mainModel(modelName, ` · ${tx('main')}`, mainState, w)} · {tx('main')}
          </Text>
          <Text color={m.isRunning ? C.main : C.dim}>{mainState}</Text>
        </Box>
        <Text wrap="truncate">
          <Text dimColor>{tx('effort ')}</Text>
          <Text color={C.main}>{'▮'.repeat(effortN) + '▯'.repeat(4 - effortN)} </Text>
          <Text color={C.main} bold>
            {m.effort || '—'}
          </Text>
          {m.mode ? <Text dimColor>{tx('   mode {mode}', { mode: m.mode })}</Text> : null}
          <Text dimColor>{tx('   {n} req', { n: m.steps })}</Text>
        </Text>
        {ctxGauge ? (
          <Text wrap="truncate">
            <Text dimColor>{tx('ctx ')}</Text>
            <Text color={u.pct !== null && u.pct >= 80 ? C.warn : C.main}>{ctxGauge.on}</Text>
            <Text color={C.faint}>{ctxGauge.off}</Text>
            <Text bold>{` ${Math.round(u.pct ?? 0)}%`}</Text>
            {u.tokens !== null ? <Text dimColor>{` ${kTokens(u.tokens)}/${kTokens(u.window)}`}</Text> : null}
            {u.compactions > 0 ? <Text color={C.amber}>{`  ⟲${u.compactions}`}</Text> : null}
          </Text>
        ) : null}
        {u.costUsd !== null || u.limits.length > 0 ? (
          <Text wrap="truncate">
            {u.costUsd !== null ? <Text color={C.text}>{`${fmtUsd(u.costUsd)}   `}</Text> : null}
            {u.limits.slice(0, 2).map(l => {
              const lg = gauge(l.pct, 5)
              return (
                <Text wrap="truncate">
                  <Text dimColor>{`${limitLabel(l.kind)} `}</Text>
                  <Text color={l.pct >= 80 ? C.warn : C.main}>{lg.on}</Text>
                  <Text color={C.faint}>{lg.off}</Text>
                  <Text dimColor>{` ${Math.round(l.pct)}%  `}</Text>
                </Text>
              )
            })}
          </Text>
        ) : null}
      </Box>
    )

    // ---- architect
    const lastConsult = a.consults[a.consults.length - 1]
    // An architect agent has no card: its delegation warning shows under its last consult.
    const archWarning = lastConsult ? ruleOf(lastConsult.id) : undefined
    const architectPanel = (w: number) => {
      const tl = consultTimeline(a, now, Math.max(8, w - 4))
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.arch} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.arch} bold>
              {cfg.architectLabel} · {advising ? tx('advising') : tx('on call')}
            </Text>
            <Text>
              <Text dimColor>{tx('consults ')}</Text>
              <Text color={C.arch} bold>
                {a.consults.length}
              </Text>
            </Text>
          </Box>
          <Text color={C.arch}>{tl}</Text>
          {lastConsult ? (
            <Text dimColor wrap="truncate">
              {advising
                ? tx('consulting since {t}', { t: fmtClock(lastConsult.at), abl: clockAblative(fmtClock(lastConsult.at)) })
                : tx('last {d} ago · took {d2}', { d: fmtDuration(now - (lastConsult.endAt ?? lastConsult.at)), d2: fmtDuration((lastConsult.endAt ?? now) - lastConsult.at) })}
            </Text>
          ) : (
            <Text dimColor>{tx('not consulted yet')}</Text>
          )}
          {archWarning ? (
            <Text color={C.amber} wrap="truncate">
              {`⚠ ${archWarning}`}
            </Text>
          ) : null}
          {cfg.moments ? (
            <Box flexWrap="wrap" columnGap={2}>
              {(['before a plan', 'error repeats', 'before done'] as const).map(mo => {
                const isOn = lastConsult?.moment === mo
                return (
                  <Text color={isOn ? C.arch : C.dim} bold={isOn}>
                    {isOn ? '◆' : '◇'} {tx(mo)}
                  </Text>
                )
              })}
              <Text color={C.faint}>{tx('(inferred)')}</Text>
            </Box>
          ) : null}
          {a.lastAdvice ? (
            <Text color={C.arch} wrap="truncate">
              » {a.lastAdvice}
            </Text>
          ) : null}
        </Box>
      )
    }

    // ---- gate
    const s = gateSummary(g)
    const verdictColor = (c: Check) =>
      c.verdict === 'rule' ? C.gate : c.verdict === 'cleared' ? C.cleared : c.verdict === 'ask' ? C.amber : C.warn
    const gatePanel = (w: number) => {
      // The totals keep to one row: when their words run past the frame (4 columns of border and
      // padding), as the Turkish do at 40 columns, the colored marks carry the counts alone.
      const wordy = [tx(' {n} allowed  ', { n: s.rule }), ` ${s.cleared} ${decider}  `, s.ask > 0 ? tx('■ {n} pending  ', { n: s.ask }) : '', tx('✗ {n} denied', { n: s.deny })]
      const totals = 2 + wordy.join('').length > w - 4 ? [` ${s.rule}  `, ` ${s.cleared}  `, s.ask > 0 ? `■ ${s.ask}  ` : '', `✗ ${s.deny}`] : wordy
      const strip = g.recent.slice(-Math.max(8, w - 4))
      const open = v.gateOpen
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.gate} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.gate} bold>
              {cfg.gateLabel} · {tx('permissions')}
            </Text>
            <Text dimColor>{tx('{n} checks', { n: s.total })}</Text>
          </Box>
          <Box>
            {strip.length === 0 ? <Text color={C.faint}>{tx('no checks yet')}</Text> : null}
            {strip.map(c => (
              <Text color={verdictColor(c)} dimColor={c.inSubagent}>
                {c.verdict === 'deny' ? '✗' : '■'}
              </Text>
            ))}
          </Box>
          <Text wrap="truncate">
            <Text color={C.gate}>■</Text>
            <Text dimColor>{totals[0]}</Text>
            <Text color={C.cleared}>■</Text>
            <Text dimColor>{totals[1]}</Text>
            {s.ask > 0 ? <Text color={C.amber}>{totals[2]}</Text> : null}
            <Text color={s.deny > 0 ? C.warn : C.dim}>{totals[3]}</Text>
            {w >= 80 && g.recent.some(c => c.inSubagent) ? <Text color={C.faint}>{tx('  dim: in subagents')}</Text> : null}
          </Text>
          <Box columnGap={2}>
            {(['file', 'shell', 'other'] as const).map((b: Bucket) => {
              const tl = g.totals[b]
              const n = tl.rule + tl.ask + tl.cleared + tl.deny
              return (
                <Button
                  key={`gate-${b}`}
                  plain
                  hotkey={tx(b)[0]}
                  label={`${tx(b)} ${n}${open === b ? ' ▾' : ''}`}
                  dimColor={n === 0}
                  onPress={() => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), gateOpen: normalize(DEFAULT_VIEW, x).gateOpen === b ? null : b }))}
                />
              )
            })}
          </Box>
          {open
            ? g.recent
                .filter(c => c.bucket === open)
                .slice(-5)
                .map(c => (
                  <Text wrap="truncate">
                    <Text color={verdictColor(c)}>{c.verdict === 'deny' ? '✗ ' : '■ '}</Text>
                    <Text color={C.dim}>{`${(c.verdict === 'rule' ? tx('allowed') : c.verdict === 'cleared' ? decider : c.verdict === 'ask' ? tx('pending') : tx('denied')).padEnd(10)} `}</Text>
                    <Text dimColor={c.inSubagent}>{shorten(c.detail, Math.max(10, w - 18))}</Text>
                  </Text>
                ))
            : null}
        </Box>
      )
    }

    // ---- agents: cards up to the limit, swimlanes beyond it
    const statusColor = (c: AgentCard) => (c.status === 'failed' ? C.warn : c.status === 'done' ? C.gate : C.agent)
    const glyph = (c: AgentCard) => (c.status === 'running' ? '◐' : c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '■')
    const expandOnPress = (id: string) => () =>
      update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), expanded: normalize(DEFAULT_VIEW, x).expanded === id ? null : id }))

    const agentsPanel = (w: number) => {
      // Cards need 20 columns each; when the pane can't hold the limit, lanes take over.
      const fit = Math.max(1, Math.min(cfg.maxCards, Math.floor((w + 1) / 21)))
      const useLanes = cards.length > fit
      const title = tx('agents · {running} running · {total} total', { running: running.length, total: cards.length })
      const hint = tx('1-{n} expand', { n: Math.min(cards.length, useLanes ? 6 : fit) })
      const header = (
        <Box justifyContent="space-between" width={w}>
          <Text bold>{title}</Text>
          {/* The hint gives way when it can't share the row: Turkish runs longer. */}
          {cards.length > 0 && title.length + 1 + hint.length <= w ? <Text color={C.faint}>{hint}</Text> : null}
        </Box>
      )
      if (cards.length === 0) {
        return (
          <Box flexDirection="column" width={w}>
            {header}
            <Text color={C.faint}>{tx('no subagents yet')}</Text>
          </Box>
        )
      }
      if (useLanes) {
        const shown = cards.slice(-6)
        const barW = Math.max(8, w - 28)
        const geo = lanes(shown, now, barW)
        return (
          <Box flexDirection="column" width={w}>
            {header}
            {cards.length > shown.length ? <Text color={C.faint}>{tx('+{n} earlier', { n: cards.length - shown.length })}</Text> : null}
            {shown.map((c, i) => {
              const gm = geo[i]
              const isViewed = viewed === c.id
              // ⚠ sits beside the status glyph, so a warned lane still shows ✓ or ✗.
              const isWarned = !isViewed && ruleOf(c.id) !== undefined
              return (
                <Box>
                  <Text color={statusColor(c)} bold={isViewed}>{`${isViewed ? '▶' : glyph(c)} `}</Text>
                  {isWarned ? <Text color={C.amber}>⚠ </Text> : null}
                  <Box width={isWarned ? 15 : 17}>
                    <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={shorten(cardTitle(c), isWarned ? 12 : 14)} onPress={expandOnPress(c.id)} />
                  </Box>
                  <Text color={C.faint}>{' ' + '·'.repeat(gm?.before ?? 0)}</Text>
                  <Text color={statusColor(c)}>{'━'.repeat(gm?.bar ?? 1)}</Text>
                  <Text color={C.faint}>{'·'.repeat(gm?.after ?? 0) + ' '}</Text>
                  {clock(`lane-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
                </Box>
              )
            })}
          </Box>
        )
      }
      const shown = cards.slice(-fit)
      const cardW = Math.max(20, Math.floor((w - (shown.length - 1)) / shown.length))
      const centers = shown.map((_, i) => i * (cardW + 1) + Math.floor(cardW / 2))
      return (
        <Box flexDirection="column" width={w}>
          {header}
          {rail('fan-out', running.length > 0, C.agent, w, centers)}
          <Box columnGap={1}>
            {shown.map((c, i) => {
              const isViewed = viewed === c.id
              const sameModel = !c.model || prettyModel(c.model) === modelName
              return (
                <Box
                  flexDirection="column"
                  borderStyle={isViewed ? 'double' : 'round'}
                  borderColor={c.lastStop === 'max_tokens' ? C.warn : C.agent}
                  borderDimColor={c.status !== 'running' && !isViewed}
                  width={cardW}
                  paddingX={1}
                >
                  <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={titleLines(cardTitle(c), cardW - 7, cardW - 4)[0]} onPress={expandOnPress(c.id)} />
                  <Text bold wrap="truncate">
                    {titleLines(cardTitle(c), cardW - 7, cardW - 4)[1]}
                  </Text>
                  <Text color={C.dim} wrap="truncate">
                    {ruleOf(c.id) ? <Text color={C.amber}>⚠ </Text> : null}
                    {sameModel ? c.type : `${c.type} · ${prettyModel(c.model)}`}
                  </Text>
                  <Text dimColor wrap="truncate">
                    {c.steps > 0 ? tx('ctx {ctx} · out {out} · {n} st', { ctx: kTokens(c.ctx), out: kTokens(c.out), n: c.steps }) : tx('starting…')}
                  </Text>
                  <Box>
                    <Text color={c.lastStop === 'max_tokens' ? C.warn : statusColor(c)}>
                      {cardW >= 26 ? `${glyph(c)} ${c.lastStop === 'max_tokens' ? 'max_tokens' : isKey(c.status) ? tx(c.status) : c.status} ` : `${glyph(c)} `}
                    </Text>
                    <Box flexShrink={0}>{clock(`card-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
          {rail('merge', running.length > 0, C.agent, w, centers, true)}
        </Box>
      )
    }

    const expandedCard = cards.find(c => c.id === v.expanded)
    const expandedPanel = (w: number) =>
      expandedCard ? (
        <Box flexDirection="column" borderStyle="single" borderColor={C.agent} paddingX={1} width={w}>
          <Text bold wrap="wrap">
            {expandedCard.description || expandedCard.type}
          </Text>
          <Text dimColor wrap="truncate">{tx('{type} · {model} · {status} · {n} steps', { type: expandedCard.type, model: prettyModel(expandedCard.model), status: isKey(expandedCard.status) ? tx(expandedCard.status) : expandedCard.status, n: expandedCard.steps })}</Text>
          {expandedCard.tools.length === 0 ? <Text color={C.faint}>{tx('no tool calls yet')}</Text> : null}
          {expandedCard.tools.map(n => (
            <Text color={n.isError ? C.warn : C.text} wrap="truncate">
              {`${n.isError ? '✗' : '·'} ${n.text}`}
            </Text>
          ))}
          {expandedCard.answer ? (
            <Text dimColor wrap="wrap">
              {`» ${shorten(expandedCard.answer, 240)}`}
            </Text>
          ) : null}
        </Box>
      ) : null

    // ---- other loops (workflow agents, forks): ids that match no card
    const loopsPanel = (w: number) => {
      if (lp.length === 0) return null
      const active = lp.filter(l => isLoopActive(l, now)).length
      const label = tx('other loops ')
      const counts = tx('{n} seen · {active} active  ', { n: lp.length, active })
      const dots = lp.slice(-loopDots(w, label.length + counts.length))
      return (
        <Box width={w}>
          <Text bold>{label}</Text>
          <Text dimColor>{counts}</Text>
          {dots.map(l => (
            <Text color={isLoopActive(l, now) ? C.agent : l.isDone ? C.dim : C.faint}>{isLoopActive(l, now) ? '●' : l.isDone ? '✓' : '○'}</Text>
          ))}
        </Box>
      )
    }

    // ---- receipt: the turn now, or the last one
    const receiptPanel = (w: number) => {
      const isReview = t.isReviewing
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.main} borderDimColor={!m.isRunning && !isReview} paddingX={1} width={w}>
          {m.isRunning ? (
            <Box>
              <Text color={C.main} wrap="truncate">{tx('◐ back to {model} · turn ', { model: modelName.toLowerCase() })}</Text>
              <Box flexShrink={0}>{clock('turn-clock', t.startedAt, null, C.main)}</Box>
              {w >= 60 ? <Text dimColor wrap="truncate">{tx(' · {edits} · {errors}', { edits: tx(t.edits === 1 ? '{n} edit' : '{n} edits', { n: t.edits }), errors: tx(t.errors === 1 ? '{n} error' : '{n} errors', { n: t.errors }) })}</Text> : null}
            </Box>
          ) : r ? (
            <Text wrap="truncate">
              <Text color={r.reason === 'answer' ? C.gate : C.warn}>{r.reason === 'answer' ? '✓ ' : '✗ '}</Text>
              <Text>{tx('last turn {d} · {agents} · {edits} · {errors}', { d: fmtDuration(r.durationMs), agents: tx(r.agents === 1 ? '{n} agent' : '{n} agents', { n: r.agents }), edits: tx(r.edits === 1 ? '{n} edit' : '{n} edits', { n: r.edits }), errors: tx(r.errors === 1 ? '{n} error' : '{n} errors', { n: r.errors }) })}</Text>
              {r.costDelta !== null ? <Text color={C.main}>{` · +${fmtUsd(r.costDelta)}`}</Text> : null}
            </Text>
          ) : (
            <Text color={C.faint}>{tx('no turn finished yet')}</Text>
          )}
          {isReview ? <Text color={C.arch}>{tx('{label} reviewing before done (inferred)', { label: lower(cfg.architectLabel) })}</Text> : null}
        </Box>
      )
    }

    // ---- log: whatever rows the other panels leave, 4 to 8
    // Liveroom's panels: stacked in one column they all add up; side by side, the taller column counts.
    const rowsOf = (p: RoomPanel) => (panels.includes(p) ? roomRows(p, room, cfg.delegationRule) : 0)
    const roomUsed = isWide
      ? Math.max(rowsOf('models') + rowsOf('tasks'), rowsOf('team') + rowsOf('codex') + rowsOf('skills'))
      : rowsOf('models') + rowsOf('codex') + rowsOf('skills') + rowsOf('team') + rowsOf('tasks')
    const used = 2 + 5 + (showArchitect ? 6 + (archWarning ? 1 : 0) : 0) + 6 + (v.gateOpen ? 5 : 0) + (cards.length > cfg.maxCards ? 3 + Math.min(6, cards.length) : 8) + (expandedCard ? 8 : 0) + (lp.length ? 1 : 0) + 3 + roomUsed
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 40
    const nLog = logRows(bodyRows, used)
    const shownLines = (viewed ? lines.filter(l => l.agentId === viewed) : lines).slice(-nLog)
    const colorOf = (l: LogLine) =>
      l.kind === 'error' ? C.warn : l.kind === 'consult' ? C.arch : l.who === 'main' ? C.main : l.who === 'gate' ? C.gate : l.who === 'you' ? C.text : C.agent
    const logPanel = (w: number) => (
      <Box flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1} width={w}>
        <Text dimColor>{viewed ? tx('session log · this agent') : tx('session log')}</Text>
        {shownLines.length === 0 ? <Text color={C.faint}>{tx('nothing yet')}</Text> : null}
        {shownLines.map(l => (
          <Box>
            <Box width={9} flexShrink={0}>
              <Text color={C.faint}>{fmtClock(l.at)}</Text>
            </Box>
            <Box width={13} flexShrink={0}>
              <Text color={colorOf(l)} bold wrap="truncate">
                {l.who === 'main' || l.who === 'gate' || l.who === 'you' || l.who === 'agent' || l.who === 'engine' ? tx(l.who) : l.who}
              </Text>
            </Box>
            <Text color={l.kind === 'error' ? C.warn : C.text} wrap="truncate">
              {l.text}
            </Text>
          </Box>
        ))}
      </Box>
    )

    const draw = (p: Panel, w: number) =>
      isRoomPanel(p)
        ? drawRoom(p, w, { els, C, palette: cfg.palette, room, isRuleOn: cfg.delegationRule, clock, t: tx })
        : p === 'main'
        ? mainPanel(w)
        : p === 'architect'
          ? architectPanel(w)
          : p === 'gate'
            ? gatePanel(w)
            : p === 'agents'
              ? agentsPanel(w)
              : p === 'loops'
                ? loopsPanel(w)
                : p === 'receipt'
                  ? receiptPanel(w)
                  : logPanel(w)

    // Panels with the flow between them; the agents panel draws its own rails.
    const column = (ps: Panel[], w: number) => (
      <Box flexDirection="column" width={w}>
        {ps.map((p, i) => {
          const prev = ps[i - 1]
          const link =
            i === 0 || p === 'agents' || prev === 'agents' || p === 'log' || p === 'loops' || prev === 'loops'
              ? null
              : rail(`link-${p}`, p === 'architect' ? advising : m.isRunning, p === 'architect' ? C.arch : C.main, w)
          return (
            <Box flexDirection="column">
              {link}
              {draw(p, w)}
              {p === 'agents' ? expandedPanel(w) : null}
            </Box>
          )
        })}
      </Box>
    )

    // Desktop draws the agents' time axis as SVG under the panels.
    const svgLanes =
      e.surface !== 'terminal' && cards.length > 0
        ? (() => {
            const { Svg } = $.ui.resolve(e)
            const rowH = 18
            const pxW = 520
            const geo = lanes(cards.slice(-10), now, 100)
            const rects = cards
              .slice(-10)
              .map((c, i) => {
                const gm = geo[i]
                const x = 150 + ((gm?.before ?? 0) / 100) * (pxW - 160)
                const wpx = Math.max(3, ((gm?.bar ?? 1) / 100) * (pxW - 160))
                const fill = c.status === 'running' ? SVG_COLORS.running : c.status === 'done' ? SVG_COLORS.done : c.status === 'failed' ? SVG_COLORS.failed : SVG_COLORS.other
                const label = shorten(cardTitle(c), 22).replace(/[<&>]/g, '')
                return `<text x="4" y="${i * rowH + 13}" font-size="11" fill="${SVG_COLORS.label}">${label}</text><rect x="${x}" y="${i * rowH + 4}" width="${wpx}" height="10" rx="3" fill="${fill}"/>`
              })
              .join('')
            const svgH = Math.min(10, cards.length) * rowH + 4
            return (
              <Svg
                source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${svgH}" viewBox="0 0 ${pxW} ${svgH}">${rects}</svg>`}
                alt={tx('{n} agents on a time axis', { n: cards.length })}
                width={pxW}
                height={svgH}
              />
            )
          })()
        : null

    // Inline above the prompt (the terminal's main screen), the pane is a summary of at most 8 rows.
    const isMini = layout === 'mini' || (layout === 'auto' && e.props.placement === 'inline')
    const crew = panels.includes('team') ? room.team.members.filter(m => m.state !== 'ended').slice(-8) : []
    if (isMini) {
      const live = [...cards.filter(c => c.status === 'running'), ...cards.filter(c => c.status !== 'running').reverse()].slice(0, crew.length > 0 ? 2 : 3) // a team's row takes one of the three
      const wordy = tx(' {allowed} allowed · {cleared} {decider}{pending} · {denied} denied', { allowed: s.rule, cleared: s.cleared, decider, pending: s.ask > 0 ? tx(' · {n} pending', { n: s.ask }) : '', denied: s.deny })
      // When the words leave less than Flightdeck's 4 cells of strip, the counts turn to marks
      // (✓7 ?1 ✗2), so the denied count always shows: the Turkish words run long at 40 columns.
      const room = W - cfg.gateLabel.length - 1
      const isTight = wordy.length + 4 > room
      const counts = isTight ? tx(' ✓{ok}{pending} ✗{denied}', { ok: s.rule + s.cleared, pending: s.ask > 0 ? ` ?${s.ask}` : '', denied: s.deny }) : wordy
      const strip = g.recent.slice(-Math.max(isTight ? 1 : 4, room - counts.length))
      const mg = u.pct !== null ? gauge(u.pct, 6) : null
      return (
        <Box flexDirection="column" width={W}>
          <Text wrap="truncate">
            <Text color={C.main} bold>
              {modelName}
            </Text>
            <Text color={m.isRunning ? C.main : C.dim}>{m.isRunning ? tx(' ● working') : tx(' ○ idle')}</Text>
            {mg ? <Text dimColor>{tx(' · ctx ')}</Text> : null}
            {mg ? <Text color={(u.pct ?? 0) >= 80 ? C.warn : C.main}>{mg.on}</Text> : null}
            {mg ? <Text color={C.faint}>{mg.off}</Text> : null}
            {mg ? <Text>{` ${Math.round(u.pct ?? 0)}%`}</Text> : null}
            {u.compactions > 0 ? <Text color={C.amber}>{` ⟲${u.compactions}`}</Text> : null}
            {u.costUsd !== null ? <Text dimColor>{` · ${fmtUsd(u.costUsd)}`}</Text> : null}
            {showArchitect ? <Text color={C.arch}>{` · ${lower(cfg.architectLabel)} ${advising ? tx('advising') : a.consults.length}`}</Text> : null}
          </Text>
          {strip.length > 0 ? (
            <Box>
              <Text dimColor>{`${lower(cfg.gateLabel)} `}</Text>
              {strip.map(c => (
                <Text color={verdictColor(c)} dimColor={c.inSubagent}>
                  {c.verdict === 'deny' ? '✗' : '■'}
                </Text>
              ))}
              <Text color={s.deny > 0 ? C.warn : s.ask > 0 ? C.amber : C.dim} wrap="truncate">
                {counts}
              </Text>
            </Box>
          ) : null}
          {live.map(c => (
            <Box>
              <Text color={statusColor(c)}>{`${glyph(c)} `}</Text>
              {ruleOf(c.id) ? <Text color={C.amber}>⚠ </Text> : null}
              <Box width={Math.max(10, W - 30)}>
                <Text wrap="truncate">{cardTitle(c)}</Text>
              </Box>
              <Text dimColor>{c.steps > 0 ? tx(' ctx {n} ', { n: kTokens(c.ctx) }) : ' '}</Text>
              {clock(`mini-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
            </Box>
          ))}
          {cards.length > live.length ? (
            <Text color={C.faint} wrap="truncate">{tx('+{n} more agents · /liveroom layout compact for all', { n: cards.length - live.length })}</Text>
          ) : null}
          {crew.length > 0 ? (
            <Text wrap="truncate">
              <Text color={ROOM_COLORS[cfg.palette].team}>{`${tx('team')} `}</Text>
              {crew.map(m => (
                <Text>
                  {ruleOf(m.id) ? <Text color={C.amber}>⚠</Text> : null}
                  <Text color={memberColorOf(C, m.state)}>{`${MEMBER_GLYPH[m.state]}${m.name} `}</Text>
                </Text>
              ))}
            </Text>
          ) : null}
          {lp.length > 0 ? <Text dimColor>{tx('other loops {n} · {active} active', { n: lp.length, active: lp.filter(l => isLoopActive(l, now)).length })}</Text> : null}
          {!m.isRunning && r ? (
            <Text dimColor wrap="truncate">
              {`${tx('last turn {d} · {agents} · {edits} · {errors}', { d: fmtDuration(r.durationMs), agents: tx(r.agents === 1 ? '{n} agent' : '{n} agents', { n: r.agents }), edits: tx(r.edits === 1 ? '{n} edit' : '{n} edits', { n: r.edits }), errors: tx(r.errors === 1 ? '{n} error' : '{n} errors', { n: r.errors }) })}${r.costDelta !== null ? ` · +${fmtUsd(r.costDelta)}` : ''}`}
            </Text>
          ) : null}
        </Box>
      )
    }

    const legend = fitLegend(
      [
        { label: tx('main'), color: C.main },
        { label: tx('agents'), color: C.agent },
        { label: lower(cfg.gateLabel), color: C.gate },
        ...(showArchitect ? [{ label: lower(cfg.architectLabel), color: C.arch }] : []),
        ...(panels.includes('codex') ? [{ label: 'codex', color: ROOM_COLORS[cfg.palette].codex }] : []),
        ...(panels.includes('team') ? [{ label: tx('team'), color: ROOM_COLORS[cfg.palette].team }] : []),
      ],
      W,
    )

    const body = isWide ? (
      <Box flexDirection="column">
        <Box columnGap={2}>
          {column(panels.filter(p => p === 'main' || p === 'models' || p === 'architect' || p === 'gate' || p === 'tasks'), colW)}
          {column(panels.filter(p => p === 'agents' || p === 'team' || p === 'codex' || p === 'loops' || p === 'skills' || p === 'receipt'), colW)}
        </Box>
        {panels.includes('log') ? logPanel(W) : null}
      </Box>
    ) : (
      column(panels, W)
    )

    return (
      <Box flexDirection="column" width={W}>
        <Box justifyContent="center">
          <Text bold wrap="truncate">
            <Text>LIVEROOM</Text>
            <Text color={C.dim}> · </Text>
            <Text color={C.main}>{modelName.toUpperCase()}</Text>
            <Text>{m.isRunning ? tx(' WORKS') : tx(' IDLE')}</Text>
            {showArchitect ? <Text color={C.dim}> · </Text> : null}
            {showArchitect ? <Text color={C.arch}>{cfg.architectLabel}</Text> : null}
            {showArchitect ? <Text>{advising ? tx(' ADVISING') : tx(' ON CALL')}</Text> : null}
          </Text>
        </Box>
        <Box justifyContent="center" columnGap={2}>
          {legend.map(l => (
            <Text>
              <Text color={l.color}>■</Text>
              <Text dimColor>{` ${l.label}`}</Text>
            </Text>
          ))}
        </Box>
        {body}
        {svgLanes}
      </Box>
    )
  })

  // ---------------------------------------------------------------- Liveroom: hooks with a matcher

  // A codex-rescue spawn is a Codex hand-off; any plugin's agent type counts toward that plugin.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const type = e.subagent_type ?? 'general-purpose'
    // A plugin counts once its agent runs: a denied spawn is no use.
    const countOwner = async <R extends { deny?: string }>(ran: R): Promise<R> => {
      const owner = pluginOfName(type)
      if (owner && ran.deny === undefined) await update($, plugins, p => bump(p, owner))
      return ran
    }
    if (type !== CODEX_RESCUE) return countOwner(await next(e))
    const run = rescueRun(e.tool_use_id, e.prompt ?? '', await $.clock.now())
    await update($, codex, runs => pushRun(runs, run))
    // The run ends with the rescue subagent (turn.complete, linked in noteSpawn). A background
    // spawn returns at once, so the call's return ends only a run no subagent picked up.
    return next(e).then(
      async ran => {
        const isFailed = ran.deny !== undefined || ran.isError === true
        const linked = (await read($, codex)).find(r => r.id === run.id)?.agentId
        if (isFailed || !linked) await endCodex($, run, isFailed ? null : ran)
        return countOwner(ran)
      },
      async err => {
        await endCodex($, run, null)
        throw err
      },
    )
  })

  // Codex called straight from the shell.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const calls = parseCodexCalls(e.command ?? '')
    if (calls.length === 0) return next(e)
    const at = await $.clock.now()
    const runs = calls.map((cli, n) => cliRun(callRunId(e.tool_use_id, n), cli, at))
    await update($, codex, list => runs.reduce((l, run) => pushRun(l, run), list))
    return next(e).then(
      async ran => {
        // A background shell returns as it starts, and its task notification ends its runs later
        // (endNotifiedCodex). A codex the line sends off with `&` outlives its shell: no event says
        // when it ends, so it shows bg.
        for (const [n, run] of runs.entries()) {
          if (ran.deny !== undefined) await endCodex($, run, ran) // it never ran
          else if (calls[n]!.isDetached && ran.isError === true) {
            // The line failed: maybe before codex launched (a syntax error), maybe after. No verdict.
            const at = await $.clock.now()
            await update($, codex, list => endRun(list, run.id, 'ended', at))
          } else if (calls[n]!.isDetached) await update($, codex, list => backgroundRun(list, run.id))
          else if (e.run_in_background !== true) await endCodex($, run, ran)
          else if (ran.isError === true) await endCodex($, run, null) // the background shell never started
        }
        return ran
      },
      async err => {
        for (const run of runs) await endCodex($, run, null)
        throw err
      },
    )
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const name = e.skill ?? '?'
    const ran = await next(e)
    if (ran.deny !== undefined) return ran // a denied skill never ran
    await update($, skills, k => bump(k, name))
    const owner = pluginOfName(name)
    if (owner) await update($, plugins, p => bump(p, owner))
    return ran
  })

  // ---------------------------------------------------------------- Liveroom: the team room

  // Every message that went out, from the lead or a teammate, protocol messages included.
  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const ran = await next(e)
    const result = ran.result as { success?: unknown } | null | undefined
    if (ran.deny === undefined && ran.isError !== true && result?.success !== false) await noteMessage($, cfg, e)
    return ran
  })

  // The task list, from whichever loop keeps it.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const task = (ran.result as { task?: { id?: unknown; subject?: unknown } } | undefined)?.task
    if (task) await update($, tasks, ts => addTask(tasksOf(ts), task))
    return ran
  })
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if ((ran.result as { success?: unknown } | undefined)?.success === true) await update($, tasks, ts => updateTask(tasksOf(ts), e))
    return ran
  })
  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const ran = await next(e)
    const listed = (ran.result as { tasks?: unknown } | undefined)?.tasks
    if (Array.isArray(listed)) await update($, tasks, ts => listTasks(tasksOf(ts), listed))
    return ran
  })

  // The team's mailbox: the harness's notices (a teammate went idle, shut down, took a task), and
  // the messages of teammates in panes of their own, whose tool calls never reach this process.
  on('session.receive', async ($, e, next) => {
    const got = await next(e)
    if ('teammate' in e.origin && (await noteDelivery($, e.origin.teammate, e.origin.isVerified, e.text, e.agentId))) await refreshStatus($, cfg)
    return got
  })
}

// ---------------------------------------------------------------- Liveroom: state access
// The engine follows $ and atoms only within the hooks module's own file, so these live here; the
// logic they apply is in room/core.ts and the drawing in room/panels.tsx.

const codex = atom({ plugin: 'liveroom', key: 'codex' } as const, [])
const steps = atom({ plugin: 'liveroom', key: 'steps' } as const, {})
const skills = atom({ plugin: 'liveroom', key: 'skills' } as const, {})
const plugins = atom({ plugin: 'liveroom', key: 'plugins' } as const, {})
const rules = atom({ plugin: 'liveroom', key: 'rules' } as const, {})
const team = atom({ plugin: 'liveroom', key: 'team' } as const, { members: [], messages: [] })
const tasks = atom({ plugin: 'liveroom', key: 'tasks' } as const, [])
/**
 * Text in the pane's language. The language changes only when a session starts (a reload starts
 * one too), so it lives here rather than in state: no hook pays a state read to translate.
 */
let tx: T = makeT('en')

/** Sets the pane's language: the option's, or under `auto` Claude Code's own `language` setting. */
async function noteLanguage($: EngineInterface, option: LanguageOption) {
  const setting = option === 'auto' ? await $.settings.read().then(s => s.language, () => undefined) : undefined
  tx = makeT(langOf(option, setting))
}

/**
 * A tagged turn opener's log line in the pane's language: a known tag translated, an unknown one as
 * written, the sender's id unchanged. Null for the user's own words, which the log keeps as typed.
 */
function engineLine(text: string): string | null {
  const o = openerOf(text)
  if (!o) return null
  const label = isKey(o.label) ? tx(o.label) : o.label
  return shorten(o.from ? tx('{label} from {from}', { label, from: o.from }) : label, 70)
}

/**
 * Lower case for a label: one written in Turkish, known by a letter only Turkish has (İ ı Ş ş Ğ ğ),
 * the Turkish way, so "MİMAR" reads "mimar", not "mi̇mar"; any other the plain way, so "ARCHITECT"
 * never reads "archıtect" and "REVISIÓN" never "revısıón".
 */
const lower = (s: string) => (/[İıŞşĞğ]/.test(s) ? s.toLocaleLowerCase('tr') : s.toLowerCase())

/** The architect and gate panels take the pane's language for their names, unless the user named them. */
function localizeLabels(cfg: Config, options: Readonly<Record<string, unknown>>) {
  // The engine passes the manifest's defaults as values, so a label still at its default is unnamed.
  const isNamed = (k: string, fallback: string) => typeof options[k] === 'string' && options[k] !== '' && options[k] !== fallback
  if (!isNamed('architectLabel', 'ARCHITECT')) cfg.architectLabel = tx('ARCHITECT')
  if (!isNamed('gateLabel', 'GATE')) cfg.gateLabel = tx('GATE')
}

/** Everything the room's panels draw from, read leniently. */
async function readRoom($: EngineInterface): Promise<RoomView> {
  const [c, s, k, p, r, t, ts] = await Promise.all([
    read($, codex),
    read($, steps),
    read($, skills),
    read($, plugins),
    read($, rules),
    read($, team),
    read($, tasks),
  ])
  return roomView(c, s, k, p, r, t, ts)
}

/** Clears the room with the rest of the pane, on `/clear` and `/liveroom reset`. */
async function resetRoom($: EngineInterface) {
  await update($, codex, () => [])
  await update($, steps, () => ({}))
  await update($, skills, () => ({}))
  await update($, plugins, () => ({}))
  // `/clear` clears the lead's conversation, not its teammates: they stay, with their delegation
  // notes and the task list. Only a pane teammate that shut down goes; an in-process one can be
  // brought back by a message.
  const kept = teamOf(await read($, team)).members.filter(m => !(m.state === 'ended' && m.isPane))
  const ids = new Set(kept.map(m => m.id))
  await update($, rules, r => Object.fromEntries(Object.entries(r && typeof r === 'object' ? r : {}).filter(([id]) => ids.has(id))))
  await update($, team, () => ({ members: kept, messages: [] }))
}

/**
 * A session that ends other than by `/clear` (a resume, a branch, an exit) takes its teammates with
 * it: Claude Code brings none back, so none of them stays to be counted, or revived by a message to
 * its name. The task list stays, as resumed sessions keep their tasks.
 */
async function endTeammates($: EngineInterface) {
  await update($, team, () => ({ members: [], messages: [] }))
}

/** A teammate joins the team panel, working on the prompt it was spawned with. */
async function joinTeammate($: EngineInterface, id: string, teammateId: string, model: string) {
  const at = await $.clock.now()
  await update($, team, t => joinTeam(teamOf(t), { id, teammateId, model }, at))
  await say($, await whoIs($, id), tx('joined the team'), 'info', id)
}

/**
 * A teammate's step: its first starts a turn, so it works, even after it stopped, as a message
 * brings an in-process teammate back. False for any other loop.
 */
async function teamStep($: EngineInterface, cfg: Config, id: string, index: number): Promise<boolean> {
  const member = memberOf(teamOf(await read($, team)), id)
  if (!member) return false
  if (index === 0 && member.state !== 'working') {
    const at = await $.clock.now()
    await update($, team, t => reopen(teamOf(t), id, at))
    await refreshStatus($, cfg)
  }
  return true
}

/**
 * A teammate's turn ends in waiting for a message, or failed on an error. One stopped without the
 * shutdown handshake (TaskStop, the lead ending) ends its turn cut short and leaves the agent list,
 * where it no longer waits. False for any other loop.
 */
async function endTeamTurn($: EngineInterface, id: string, reason: string): Promise<boolean> {
  if (!memberOf(teamOf(await read($, team)), id)) return false
  const isGone = reason === 'aborted' && !(await isListed($, id))
  const at = await $.clock.now()
  await update($, team, t => setState(teamOf(t), id, isGone ? 'ended' : turnEndState(reason), at))
  return true
}

/** Whether an agent is still running or waiting on the session's list; true when the list can't be read. */
async function isListed($: EngineInterface, id: string): Promise<boolean> {
  try {
    return (await $.agent.list()).some(a => a.id === id && a.status !== 'completed' && a.status !== 'failed' && a.status !== 'killed')
  } catch {
    return true
  }
}

/** A SendMessage that went out: from the lead, a teammate, or another agent of the session. */
async function noteMessage($: EngineInterface, cfg: Config, e: { agentId?: string; to?: unknown; message?: unknown; summary?: unknown }) {
  const was = teamOf(await read($, team))
  const from = e.agentId ? (memberOf(was, e.agentId)?.name ?? 'agent') : LEAD
  const msg = messageOf(e, from, await $.clock.now())
  if (!msg || !isTeamMessage(was, msg)) return // another session's traffic
  await update($, team, t => applyMessage(teamOf(t), msg))
  const sender = memberNamed(was, from)
  if (msg.kind === 'shutdown-response' && msg.approve === true && sender) await say($, shorten(sender.name, 14), tx('shut down'), 'info', sender.id)
  await refreshStatus($, cfg) // a message may wake a teammate or end one
}

/**
 * A delivery from a teammate's mailbox: a harness notice sets a teammate's state or a task's owner;
 * a message the harness here didn't write is a pane teammate's, which no tool call showed. True when
 * a teammate's state changed.
 */
async function noteDelivery($: EngineInterface, sender: string, isVerified: boolean, text: string, to: string | undefined): Promise<boolean> {
  const at = await $.clock.now()
  const was = teamOf(await read($, team))
  const notice = noticeOf(text, sender)
  const member = memberNamed(was, notice && notice.kind !== 'assigned' ? notice.from : sender)
  // A message the harness here didn't write is a pane teammate's, which no tool call showed: its
  // words (JSON included), or a protocol request or answer. The mailbox's own notices are not one.
  if (!isVerified && !isNotice(text)) {
    const msg = messageOf({ to: to ? (memberOf(was, to)?.name ?? 'agent') : LEAD, message: protocolOf(text) ?? text }, sender, at)
    // A pane teammate that writes words is in a turn.
    if (msg && isTeamMessage(was, msg)) {
      await update($, team, t => (msg.kind === 'text' && member ? reopen(applyMessage(teamOf(t), msg), member.id, at) : applyMessage(teamOf(t), msg)))
    }
  }
  if (notice?.kind === 'assigned') {
    const owner = to ? memberOf(was, to)?.name : LEAD
    if (owner) await update($, tasks, ts => assignTask(tasksOf(ts), notice.taskId, notice.subject, owner))
  } else if (notice && member) {
    await update($, team, t => setState(teamOf(t), member.id, notice.kind, at))
    if (notice.kind === 'ended' && member.state !== 'ended') await say($, shorten(member.name, 14), tx('shut down'), 'info', member.id)
  }
  return Boolean(member) && (Boolean(notice) || !isVerified)
}

/** A Codex run ends with its call: failed when refused, errored or thrown (`ran` null). */
async function endCodex($: EngineInterface, run: CodexRun, ran: { deny?: string; isError?: boolean } | null) {
  const at = await $.clock.now()
  await update($, codex, runs => endRun(runs, run.id, shellEnd(run, ran), at))
}

/** Every model request: the main loop's and each subagent's, under the model and effort it ran on. */
async function noteStep($: EngineInterface, model: string, effort: unknown) {
  await update($, steps, s => bump(s, stepKey(model, effort)))
}

/** A plugin's MCP tool counts toward the plugin. */
async function countPluginTool($: EngineInterface, tool: string) {
  const owner = pluginOfTool(tool)
  if (owner) await update($, plugins, p => bump(p, owner))
}

/** A codex-rescue run ends with its subagent: done on an answer, failed otherwise. */
/** A background task's notification ends the Codex run its call started, done or failed as it says. */
async function endNotifiedCodex($: EngineInterface, content: readonly ApiContentBlock[]) {
  const notices = taskNotices(content.map(b => (b.type === 'text' ? b.text : '')).join('\n'))
  if (notices.length === 0) return
  const at = await $.clock.now()
  await update($, codex, runs => endNoticed(runs, notices, at))
}

async function endCodexAgent($: EngineInterface, agentId: string, reason: string) {
  const runs = await read($, codex)
  const run = runs.find(r => r.agentId === agentId && (r.status === 'running' || r.status === 'background'))
  if (!run) return
  const at = await $.clock.now()
  await update($, codex, list => endRun(list, run.id, reason === 'answer' ? 'done' : 'failed', at))
}

/**
 * Links a codex-rescue run to its subagent, and applies the delegation rule to every other spawn:
 * a call that names no model and runs on the main model gets ⚠ and a toast. The pane cannot see
 * the agent definition's own model, so the note says only what it can see: no model in the call,
 * running on the main model. Forks always inherit and are left alone; `delegationRule: false`
 * turns the check off.
 */
async function noteSpawn(
  $: EngineInterface,
  e: { tool_use_id: string; model?: string; parentModel: string; parentAgentId?: string; subagentType: string; fork?: boolean },
  started: { model?: string; agentId?: string; deny?: string },
  isRuleOn: boolean,
) {
  if (started.deny !== undefined || !started.agentId) return
  const id = started.agentId
  if (e.subagentType === CODEX_RESCUE) {
    await update($, codex, runs => linkRun(runs, e.tool_use_id, id))
    return
  }
  if (!isRuleOn || e.fork || e.model !== undefined || started.model !== e.parentModel) return
  // A nested spawn's parent model is the calling subagent's, not the main loop's.
  const note = e.parentAgentId ? "no model in the call, inherits its parent's model" : 'no model in the call, runs on the main model'
  await update($, rules, r => noteRule(r, id, note))
  const vars = { type: e.subagentType, model: started.model ?? '' }
  $.ui.toast(e.parentAgentId ? tx('⚠ {type}: no model in the call, inherits {model} from its parent', vars) : tx('⚠ {type}: no model in the call, runs on {model}', vars))
}
