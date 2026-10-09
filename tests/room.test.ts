import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  backgroundRun,
  cliRun,
  endNoticed,
  codexEffort,
  endRun,
  flag,
  isReadOnly,
  meter,
  parseCodexCalls,
  parseCodexCli,
  noteRule,
  pluginOfName,
  pluginOfTool,
  pushRun,
  rescueRun,
  stepKey,
  taskNotices,
  top,
} from '../hooks/room/core'

// ---------------------------------------------------------------- pure behaviour

test('flags are read from prompts and command lines in every spelling', () => {
  expect(flag('fix it --model gpt-6.1-sol --effort xhigh', 'model')).toBe('gpt-6.1-sol')
  expect(flag('--model=gpt-6-luna', 'model')).toBe('gpt-6-luna')
  expect(flag('codex exec -m gpt-6-astra "x"', 'model', 'm')).toBe('gpt-6-astra')
  expect(flag('no flags here', 'model')).toBeNull()
  expect(codexEffort('codex exec -c model_reasoning_effort="high" go')).toBe('high')
  expect(codexEffort('--effort medium')).toBe('medium')
  expect(isReadOnly('Diagnose this. Read-only, do not edit files.')).toBe(true)
  expect(isReadOnly('Implement the parser')).toBe(false)
  // A limit on some files is not a read-only task.
  expect(isReadOnly('Implement the fix, but do not edit generated files')).toBe(false)
  expect(isReadOnly('Read only the README, then fix the bug')).toBe(false)
  expect(isReadOnly("Review this, don't modify any files")).toBe(true)
  expect(isReadOnly('Sadece görüş ver, salt okunur.')).toBe(true)
  expect(isReadOnly('Do not edit files in docs; fix src/core.ts')).toBe(false)
  expect(isReadOnly('Make the read-only field editable')).toBe(false)
  expect(isReadOnly('Diagnose the crash (read-only)')).toBe(true)
})

test('codex calls are read from their own option words, not their prompt or neighbours', () => {
  expect(parseCodexCli('cd repo && codex exec "do it"')).toEqual({ kind: 'exec', model: null, effort: null, isDetached: false, isExitShared: false })
  expect(parseCodexCli('codex e "short form"')?.kind).toBe('exec')
  expect(parseCodexCli('codex review --base main')?.kind).toBe('review')
  // Global options before the subcommand.
  expect(parseCodexCli('codex -m gpt-6-luna -c model_reasoning_effort=high exec "fix it"')).toEqual({ kind: 'exec', model: 'gpt-6-luna', effort: 'high', isDetached: false, isExitShared: false })
  // Model as a config override, quoted the TOML way.
  expect(parseCodexCli(`codex exec -c 'model="gpt-6.1-sol"' -c model_reasoning_effort="xhigh" go`)).toEqual({ kind: 'exec', model: 'gpt-6.1-sol', effort: 'xhigh', isDetached: false, isExitShared: false })
  expect(parseCodexCli(`timeout 900 codex review --base main -c model='"gpt-6.1-sol"'`)).toEqual({ kind: 'review', model: 'gpt-6.1-sol', effort: null, isDetached: false, isExitShared: false })
  // The prompt is never an option.
  expect(parseCodexCli('codex exec "Compare --model gpt-6-astra with alternatives"')?.model).toBeNull()
  // Only a command in command position counts.
  expect(parseCodexCli('echo codex exec')).toBeNull()
  expect(parseCodexCli('mycodex exec x')).toBeNull()
  expect(parseCodexCli('codex --version')).toBeNull()
  expect(parseCodexCli('git diff | codex exec -m gpt-6-luna -')?.model).toBe('gpt-6-luna')
  expect(parseCodexCli('FOO=1 /usr/local/bin/codex exec x')?.kind).toBe('exec')
  // `exec review` is a review; a prompt that starts with the word is not.
  expect(parseCodexCli('codex exec review --base main')?.kind).toBe('review')
  expect(parseCodexCli('codex exec -m gpt-6-luna review')?.kind).toBe('review')
  expect(parseCodexCli('codex exec "review the parser"')?.kind).toBe('exec')
  // A backslash-newline continues the command.
  expect(parseCodexCli('cd repo && \\\n  codex exec -m gpt-6-luna x')?.model).toBe('gpt-6-luna')
  expect(parseCodexCli('codex exec \\\n  -m gpt-6-luna x')?.model).toBe('gpt-6-luna')
})

test('a codex the line sends off with & is detached; redirections and && are not', () => {
  expect(parseCodexCli('nohup codex exec -m gpt-6-luna x >codex.log 2>&1 &')?.isDetached).toBe(true)
  expect(parseCodexCli('codex exec x | tee log &')?.isDetached).toBe(true)
  expect(parseCodexCli('codex exec x && echo ok &')?.isDetached).toBe(true)
  expect(parseCodexCli('codex exec x >log 2>&1')?.isDetached).toBe(false)
  expect(parseCodexCli('codex exec x &>log; echo ok')?.isDetached).toBe(false)
  expect(parseCodexCli('codex exec x |& tee log')?.isDetached).toBe(false)
  expect(parseCodexCli('codex exec x && sleep 1')?.isDetached).toBe(false)
  expect(parseCodexCli('sleep 1 & codex exec x')?.isDetached).toBe(false)
})

test('every codex call on a line is read, through wrappers and their options', () => {
  expect(parseCodexCalls('codex exec -m gpt-6-luna first; codex review').map(c => [c.kind, c.model, c.isExitShared])).toEqual([
    ['exec', 'gpt-6-luna', true],
    ['review', null, false],
  ])
  expect(parseCodexCli('env -i PATH=/bin codex exec x')?.kind).toBe('exec')
  expect(parseCodexCli('env -u HOME codex exec -m gpt-6-luna x')?.model).toBe('gpt-6-luna')
  expect(parseCodexCli('timeout -s KILL 30 codex exec x')?.kind).toBe('exec')
  expect(parseCodexCli('timeout --signal=KILL -k 5 30 codex review')?.kind).toBe('review')
  expect(parseCodexCli('sudo -u bob nice -n 5 codex exec x')?.kind).toBe('exec')
  // The exit status is the call's own only when nothing runs after it.
  expect(parseCodexCli('codex exec x 2>&1 | tail -20')?.isExitShared).toBe(true)
  expect(parseCodexCli('codex exec x; echo done')?.isExitShared).toBe(true)
  expect(parseCodexCli('cd repo && codex exec x')?.isExitShared).toBe(false)
  expect(parseCodexCli('codex exec - <<EOF\nprompt\nEOF')?.isExitShared).toBe(false)
  // `wait` holds the shell until its jobs end, so a backgrounded codex it waits for is not detached.
  expect(parseCodexCli('codex exec x & pid=$!; wait "$pid"')?.isDetached).toBe(false)
  expect(parseCodexCli('codex exec x & wait')?.isDetached).toBe(false)
  expect(parseCodexCli('codex exec x & echo started')?.isDetached).toBe(true)
})

test('here-document bodies are data, not commands', () => {
  expect(parseCodexCli("cat >run.sh <<'EOF'\ncodex exec -m gpt-6-luna x\nEOF")).toBeNull()
  expect(parseCodexCli('cat <<-EOF >run.sh\n\tcodex exec x\n\tEOF')).toBeNull()
  // The line goes on after the terminator, and a here-string stays on its own line.
  expect(parseCodexCli('cat >a <<EOF\ncodex exec x\nEOF\ncodex review')?.kind).toBe('review')
  expect(parseCodexCli('codex exec -m gpt-6-luna - <<EOF\nsummarise --model nope\nEOF')?.model).toBe('gpt-6-luna')
  expect(parseCodexCli('codex exec x <<<"prompt"')?.kind).toBe('exec')
})

test('the delegation rule: model and effort named; review picks its own', () => {
  expect(rescueRun('a', '--model gpt-6.1-sol --effort xhigh fix it', 1).ruleNote).toBeNull()
  expect(rescueRun('b', '--model gpt-6.1-sol fix it', 1).ruleNote).toBe('no effort given')
  expect(rescueRun('c', 'fix it', 1).ruleNote).toBe('no model or effort given')
  expect(rescueRun('d', 'read-only, do not edit files', 1).kind).toBe('consult')
  expect(cliRun('e', parseCodexCli('codex review')!, 1).ruleNote).toBeNull()
  expect(cliRun('f', parseCodexCli('codex exec -m gpt-6-luna -c model_reasoning_effort=low x')!, 1).ruleNote).toBeNull()
  expect(parseCodexCli('ls -la')).toBeNull()
})

test('a run ends once, and the list keeps the newest', () => {
  let runs = pushRun([], rescueRun('a', 'x', 1))
  runs = endRun(runs, 'a', 'done', 5)
  runs = endRun(runs, 'a', 'failed', 9)
  expect([runs[0]?.status, runs[0]?.endedAt]).toEqual(['done', 5])
  let many = pushRun(runs, rescueRun('live', 'x', 2))
  many = backgroundRun(pushRun(many, rescueRun('bg', 'x', 3)), 'bg')
  for (let i = 0; i < 40; i++) many = endRun(pushRun(many, rescueRun(`r${i}`, 'x', i)), `r${i}`, 'done', i)
  expect(many.length).toBe(30)
  expect(many[29]?.id).toBe('r39')
  // Finished runs make room first: the run in flight and the background one stay.
  expect(many.map(r => r.id).slice(0, 2)).toEqual(['live', 'bg'])
  // A run that ended without a verdict is finished too.
  let unknown: ReturnType<typeof pushRun> = []
  for (let i = 0; i < 40; i++) unknown = endRun(pushRun(unknown, rescueRun(`u${i}`, 'x', i)), `u${i}`, 'ended', i)
  expect(unknown.length).toBe(30)
  // With nothing finished left to drop, a background run goes; a run in flight never does.
  let busy = many.filter(r => r.status !== 'done')
  for (let i = 0; i < 30; i++) busy = pushRun(busy, rescueRun(`b${i}`, 'x', i))
  expect(busy.length).toBe(31)
  expect(busy.some(r => r.id === 'live')).toBe(true)
  expect(busy.some(r => r.id === 'bg')).toBe(false)
})

test('task notifications are read for the call they end and how it ended', () => {
  const notice = (id: string, status: string) =>
    `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<summary>x</summary>\n</task-notification>`
  expect(taskNotices(notice('t1', 'completed'))).toEqual([{ toolUseId: 't1', status: 'completed' }])
  expect(taskNotices(`${notice('t2', 'killed')}\n${notice('t3', 'failed')}`).map(n => n.status)).toEqual(['killed', 'failed'])
  expect(taskNotices(notice('t4', 'running'))).toEqual([]) // not an end
  expect(taskNotices('no notification here')).toEqual([])
  // Only a run in flight ends: a codex sent off with `&` outlives the shell that launched it.
  let runs = pushRun([], cliRun('t1', parseCodexCli('codex exec x')!, 1))
  runs = backgroundRun(pushRun(runs, cliRun('t5', parseCodexCli('codex exec x &')!, 2)), 't5')
  runs = endNoticed(runs, [...taskNotices(notice('t1', 'completed')), ...taskNotices(notice('t5', 'completed'))], 9)
  expect(runs.map(r => r.status)).toEqual(['done', 'background'])
  // Every codex call of the shell ends; one with a command after it gets no verdict, unless the shell was killed.
  const [a, b] = parseCodexCalls('codex exec a | tee log; codex review')
  let two = [cliRun('t6', a!, 1), cliRun('t6:2', b!, 1)]
  expect(endNoticed(two, taskNotices(notice('t6', 'completed')), 9).map(r => r.status)).toEqual(['ended', 'done'])
  expect(endNoticed(two, taskNotices(notice('t6', 'killed')), 9).map(r => r.status)).toEqual(['failed', 'failed'])
})

test('rule notes keep the newest, as many as the agent cards', () => {
  let rules: Record<string, string> = {}
  for (let i = 0; i < 30; i++) rules = noteRule(rules, `a${i}`, 'x')
  expect(Object.keys(rules).length).toBe(24)
  expect(Object.keys(rules)[0]).toBe('a6')
  expect(Object.keys(noteRule(rules, 'a6', 'y')).pop()).toBe('a6') // a fresh note moves to the end
})

test('plugins are read from names and MCP tools; tallies rank and draw', () => {
  expect(pluginOfName('vercel:deploy')).toBe('vercel')
  expect(pluginOfName('general-purpose')).toBeNull()
  expect(pluginOfTool('mcp__plugin_chrome-devtools-mcp_chrome-devtools__click')).toBe('chrome-devtools-mcp')
  expect(pluginOfTool('mcp__lemma__memory_read')).toBeNull()
  expect(top({ a: 1, b: 3, c: 2 }, 2)).toEqual([['b', 3], ['c', 2]])
  expect(stepKey('claude-opus-5-5', 'xhigh')).toBe('claude-opus-5-5 · xhigh')
  expect(stepKey('claude-haiku-5-5', undefined)).toBe('claude-haiku-5-5')
  expect(meter(0.01, 5)).toBe('▰▱▱▱▱') // any share shows
  expect(meter(0, 5)).toBe('▱▱▱▱▱')
})

// ---------------------------------------------------------------- drawing

const engine = (on: On) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

const pane = (bodyColumns: number) => ({
  plugin: 'liveroom',
  component: 'Pane' as const,
  requestId: 'liveroom',
  props: {
    title: 'Liveroom',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 90 },
    view: {},
  },
})

const spawn = (subagentType: string, description: string, model?: string) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `tu-${description}`,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  ...(model ? { model } : {}),
  background: true,
  fork: false,
})

test('codex hand-offs draw with their model and status; a failed one is red ✗', async ($, on) => {
  engine(on)
  on('tool.call', (_$, e) => (String(e.tool_use_id) === 'b2' ? { result: {}, text: 'boom', isError: true } : { result: {}, text: 'ok' }))
  await $.tool.call({ tool: 'Agent', subagent_type: 'codex:codex-rescue', prompt: '--model gpt-6.1-sol --effort xhigh fix the parser', description: 'fix', tool_use_id: 'a1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'codex exec "summarise"', tool_use_id: 'b2' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls -la', tool_use_id: 'b3' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    expect(await ui.find({ text: /CODEX · hand-offs/ })).toBeDefined()
    expect(await ui.find({ text: /0 running · 2 total/ })).toBeDefined() // ls is not Codex
    expect(await ui.find({ text: /gpt-6\.1-sol/ })).toBeDefined()
    expect(await ui.find({ text: /^✗ $/ })).toBeDefined() // the failed exec
    expect(await ui.find({ text: /1 without model or effort/ })).toBeDefined()
    await ui.unmount()
  }
})

test('skills and plugins are counted from skill calls, agent types and MCP tools', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.tool.call({ tool: 'Skill', skill: 'vercel:deploy', tool_use_id: 's1' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'vercel:deploy', tool_use_id: 's2' } as never)
  await $.tool.call({ tool: 'mcp__plugin_playwright_playwright__browser_click', tool_use_id: 'm1' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /SKILLS · plugins/ })).toBeDefined()
  expect(await ui.find({ text: /^vercel:deploy$/ })).toBeDefined()
  expect(await ui.find({ text: /^×2$/ })).toBeDefined()
  expect(await ui.find({ text: /⧉ playwright/ })).toBeDefined()
  await ui.unmount()
})

test('room panels with nothing to show take no room', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    expect(await ui.find({ text: /MODELS · requests/ })).toBeUndefined() // no model request yet
    expect(await ui.find({ text: /CODEX · hand-offs/ })).toBeUndefined()
    expect(await ui.find({ text: /SKILLS · plugins/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a subagent that silently inherits the main model gets ⚠ and a toast; a named model does not', async ($, on) => {
  engine(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: `ag-${e.description}` }))
  await $.turn.start({ text: 'fan out', turnId: 'R1' })
  await $.agent.spawn(spawn('general-purpose', 'inherits'))
  await $.agent.spawn(spawn('Explore', 'picks', 'claude-haiku-5-5'))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('general-purpose')
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^⚠ $/ })).toBeDefined()
  await ui.unmount()
})

test('a codex-rescue run lives as long as its subagent, even when the call returns at launch', async ($, on) => {
  engine(on)
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Agent') {
      // The engine starts the subagent, then the background call returns at once.
      await $.agent.spawn({ ...spawn('codex:codex-rescue', 'rescue', 'claude-sonnet-5-5'), tool_use_id: String(e.tool_use_id) })
    }
    return { result: {}, text: 'launched' }
  })
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: 'cx1' }))
  await $.tool.call({ tool: 'Agent', subagent_type: 'codex:codex-rescue', prompt: '--model gpt-6.1-sol --effort xhigh fix', description: 'fix', tool_use_id: 'r1' } as never)
  let ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /1 running · 1 total/ })).toBeDefined()
  await ui.unmount()
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'X1', agentId: 'cx1', reason: 'answer' } as never)
  ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /0 running · 1 total/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ $/ })).toBeDefined()
  await ui.unmount()
})

test('a background codex shell runs until its task notification ends it', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'Command running in background with ID: b1.' }))
  const notify = (id: string, status: string) =>
    $.session.append({
      message: {
        type: 'user',
        role: 'user',
        content: [{ type: 'text', text: `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n</task-notification>` }],
      },
      door: 'prompt',
      origin: { kind: 'task-notification' },
      uuid: `row-${id}`,
    } as never)
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6-luna -c model_reasoning_effort=low x', run_in_background: true, tool_use_id: 'bg1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6-luna -c model_reasoning_effort=low y', run_in_background: true, tool_use_id: 'bg2' } as never)
  let ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /2 running · 2 total/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ $/ })).toBeUndefined() // the call returned, the work goes on
  await ui.unmount()
  await notify('bg1', 'completed')
  await notify('bg2', 'killed')
  ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /0 running · 2 total/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ $/ })).toBeDefined()
  expect(await ui.find({ text: /^✗ $/ })).toBeDefined()
  await ui.unmount()
})

test('a codex the shell line sends off with & shows ◌ bg, apart from the running count', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: '' }))
  await $.tool.call({ tool: 'Bash', command: 'nohup codex exec -m gpt-6-luna -c model_reasoning_effort=low x >codex.log 2>&1 &', tool_use_id: 'nh1' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^◌ $/ })).toBeDefined()
  expect(await ui.find({ text: /^bg$/ })).toBeDefined()
  expect(await ui.find({ text: /0 running · 1 bg · 1 total/ })).toBeDefined() // its end is never seen, so it is not counted as running
  await ui.unmount()
})

test('the session log gives up rows to full room panels', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  for (let i = 0; i < 10; i++) await $.turn.start({ text: `prompt ${i}`, turnId: `T${i}` })
  const base = pane(64)
  const short = { ...base, props: { ...base.props, scroll: { offset: 0, bodyRows: 40 } }, surface: 'terminal' as const }
  let ui = await $.ui.mount(short)
  expect(await ui.findAll({ type: 'Text', text: /^you$/ })).toHaveLength(8)
  await ui.unmount()
  for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Bash', command: `codex exec x${i}`, tool_use_id: `c${i}` } as never)
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Skill', skill: `p${i}:s${i}`, tool_use_id: `s${i}` } as never)
  ui = await $.ui.mount(short)
  expect(await ui.findAll({ type: 'Text', text: /^you$/ })).toHaveLength(4)
  await ui.unmount()
})

test('a background codex shell that fails to start ends as failed at once', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'could not start', isError: true }))
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6-luna -c model_reasoning_effort=low x', run_in_background: true, tool_use_id: 'bf1' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /0 running · 1 total/ })).toBeDefined()
  expect(await ui.find({ text: /^✗ $/ })).toBeDefined()
  await ui.unmount()
})

test('a codex piped into another command ends without a verdict; each call on a line is a run', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6-luna -c model_reasoning_effort=low x 2>&1 | tail -20', tool_use_id: 'p1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'codex review; codex exec -m gpt-6-luna -c model_reasoning_effort=low y', tool_use_id: 'p2' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /0 running · 3 total/ })).toBeDefined()
  expect(await ui.find({ text: /^■ $/ })).toBeDefined() // the piped run and the review followed by another call
  expect(await ui.find({ text: /^✓ $/ })).toBeDefined() // the last call owns the exit status
  expect(await ui.find({ text: /^✗ $/ })).toBeUndefined()
  await ui.unmount()
})

test('an architect that silently inherits the main model shows ⚠ in the architect panel', async ($, on) => {
  engine(on)
  on('ui.toast', () => ({ value: undefined }))
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: 'arch1' }))
  await $.turn.start({ text: 'review it', turnId: 'A1' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /⚠ no model in the call, runs on the main model/ })).toBeDefined()
  await ui.unmount()
})

test('a warned lane keeps its status glyph beside the ⚠', async ($, on) => {
  engine(on)
  on('ui.toast', () => ({ value: undefined }))
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: `w${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'W1' })
  for (const d of ['alpha', 'beta', 'gamma', 'delta']) await $.agent.spawn(spawn('general-purpose', `task ${d}`))
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'W1', agentId: 'w1', reason: 'error' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /━/ })).toBeDefined() // lanes: four cards don't fit
  expect(await ui.find({ text: /^✗ $/ })).toBeDefined() // the failed lane still says so
  expect(await ui.find({ text: /^⚠ $/ })).toBeDefined()
  await ui.unmount()
})

test('the inline summary marks a subagent that silently inherits the main model', async ($, on) => {
  engine(on)
  on('ui.toast', () => ({ value: undefined }))
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: `ag-${e.description}` }))
  await $.turn.start({ text: 'fan out', turnId: 'R1' })
  await $.agent.spawn(spawn('general-purpose', 'inherits'))
  const inline = pane(80)
  const ui = await $.ui.mount({ ...inline, props: { ...inline.props, placement: 'inline' as never }, surface: 'terminal' })
  expect(await ui.find({ text: /MODELS · requests|AGENTS/ })).toBeUndefined() // the 8-row summary, not the docked panels
  expect(await ui.find({ text: /^⚠ $/ })).toBeDefined()
  await ui.unmount()
})

test('delegationRule off: no ⚠ on cards or hand-offs, no toast', { options: { delegationRule: false } }, async ($, on) => {
  engine(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: `ag-${e.description}` }))
  await $.agent.spawn(spawn('general-purpose', 'inherits'))
  await $.tool.call({ tool: 'Bash', command: 'codex exec "no flags"', tool_use_id: 'n1' } as never)
  expect(toasts.length).toBe(0)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /⚠/ })).toBeUndefined()
  await ui.unmount()
})

test('/liveroom reset clears the room with the rest of the pane', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.tool.call({ tool: 'Skill', skill: 'tdd', tool_use_id: 'z1' } as never)
  await $.command.run({ command: 'liveroom', args: 'reset' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /SKILLS · plugins/ })).toBeUndefined()
  await ui.unmount()
})
