import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  cliRun,
  codexCommand,
  codexEffort,
  endRun,
  flag,
  isReadOnly,
  meter,
  pluginOfName,
  pluginOfTool,
  pushRun,
  rescueRun,
  stepKey,
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
})

test('only real codex calls count, wherever they sit in a shell line', () => {
  expect(codexCommand('cd repo && codex exec "do it"')).toBe('exec')
  expect(codexCommand('codex e "short form"')).toBe('exec')
  expect(codexCommand('codex review --base main')).toBe('review')
  expect(codexCommand('echo codex exec')).toBe('exec') // a shell word boundary is all the scan sees
  expect(codexCommand('mycodex exec x')).toBeNull()
  expect(codexCommand('codex --version')).toBeNull()
})

test('the delegation rule: model and effort named; review picks its own', () => {
  expect(rescueRun('a', '--model gpt-6.1-sol --effort xhigh fix it', 1).ruleNote).toBeNull()
  expect(rescueRun('b', '--model gpt-6.1-sol fix it', 1).ruleNote).toBe('no effort given')
  expect(rescueRun('c', 'fix it', 1).ruleNote).toBe('no model or effort given')
  expect(rescueRun('d', 'read-only, do not edit files', 1).kind).toBe('consult')
  expect(cliRun('e', 'codex review', 1)?.ruleNote).toBeNull()
  expect(cliRun('f', 'codex exec -m gpt-6-luna -c model_reasoning_effort=low x', 1)?.ruleNote).toBeNull()
  expect(cliRun('g', 'ls -la', 1)).toBeNull()
})

test('a run ends once, and the list keeps the newest', () => {
  let runs = pushRun([], rescueRun('a', 'x', 1))
  runs = endRun(runs, 'a', 'done', 5)
  runs = endRun(runs, 'a', 'failed', 9)
  expect([runs[0]?.status, runs[0]?.endedAt]).toEqual(['done', 5])
  let many = runs
  for (let i = 0; i < 40; i++) many = pushRun(many, rescueRun(`r${i}`, 'x', i))
  expect(many.length).toBe(30)
  expect(many[29]?.id).toBe('r39')
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

test('/liveroom reset clears the room with the rest of the pane', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.tool.call({ tool: 'Skill', skill: 'tdd', tool_use_id: 'z1' } as never)
  await $.command.run({ command: 'liveroom', args: 'reset' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /SKILLS · plugins/ })).toBeUndefined()
  await ui.unmount()
})
