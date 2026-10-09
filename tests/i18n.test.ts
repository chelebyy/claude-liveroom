import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { isKey, langOf, makeT } from '../hooks/room/i18n'

test('the language comes from the option, or under auto from Claude Code\'s own setting', () => {
  expect(langOf('en', 'Turkish')).toBe('en')
  expect(langOf('tr', undefined)).toBe('tr')
  for (const s of ['Turkish', 'turkish', 'Türkçe', 'tr', 'tr-TR']) expect(langOf('auto', s)).toBe('tr')
  for (const s of ['English', 'German', 'trance', '', undefined, 42]) expect(langOf('auto', s)).toBe('en')
})

test('text fills its values; English is the key itself', () => {
  expect(makeT('en')('{n} total', { n: 3 })).toBe('3 total')
  expect(makeT('tr')('{n} total', { n: 3 })).toBe('3 toplam')
  expect(isKey('no model in the call, runs on the main model')).toBe(true)
  expect(isKey('something else')).toBe(false)
})

const engine = (on: On) => {
  mock.clock(on)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => e)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

const pane = (bodyColumns: number) => ({
  plugin: 'liveroom',
  component: 'Pane' as const,
  requestId: 'liveroom',
  props: { title: 'Liveroom', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 90 }, view: {} },
})

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as never

test('language tr: the room panels and the toast speak Turkish', { options: { language: 'tr', openOnStart: false } }, async ($, on) => {
  engine(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: 'ag1' }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'codex exec x', tool_use_id: 'c1' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'd', subagentType: 'general-purpose', tool_use_id: 'tu1', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  expect(toasts).toEqual(['⚠ general-purpose: çağrıda model yok, claude-opus-5-5 üzerinde çalışıyor'])
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /CODEX · devirler/ })).toBeDefined()
  expect(await ui.find({ text: /0 çalışıyor · 1 toplam/ })).toBeDefined()
  expect(await ui.find({ text: /⚠ 1 model ya da efor verilmeden/ })).toBeDefined()
  await ui.unmount()
})

test('language auto follows a Turkish language setting, and English otherwise', { options: { openOnStart: false } }, async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  let setting = 'Turkish'
  on('settings.read', () => ({ value: { language: setting } }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'codex exec x', tool_use_id: 'c1' } as never)
  let ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /CODEX · devirler/ })).toBeDefined()
  await ui.unmount()
  setting = 'English'
  await $.session.start(START)
  ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /CODEX · hand-offs/ })).toBeDefined()
  await ui.unmount()
})

test('language tr: docked Flightdeck panels speak Turkish at 40 and 120 columns', { options: { language: 'tr', openOnStart: false } }, async ($, on) => {
  engine(on)
  await $.session.start(START)
  for (const cols of [40, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /oturum kaydı/ })).toBeDefined()
    expect(await ui.find({ text: /· ana$/ })).toBeDefined()
    expect(await ui.find({ text: /boşta/ })).toBeDefined()
    expect(await ui.find({ text: /henüz bir şey yok/ })).toBeDefined()
    expect(await ui.find({ text: /session log|· main$|idle|nothing yet/i })).toBeUndefined()
    await ui.unmount()
  }
})

test('language tr: the inline mini summary shows idle and working in Turkish', { options: { language: 'tr', openOnStart: false } }, async ($, on) => {
  engine(on)
  await $.session.start(START)
  const inline = pane(80)
  const request = { ...inline, props: { ...inline.props, placement: 'inline' as const }, surface: 'terminal' as const }
  let ui = await $.ui.mount(request)
  expect(await ui.find({ text: /boşta/ })).toBeDefined()
  expect(await ui.find({ text: /idle|working/ })).toBeUndefined()
  expect(await ui.find({ text: /oturum kaydı/ })).toBeUndefined()
  const root = (await ui.drawn()) as { children?: unknown[] }
  expect((root.children ?? []).filter(Boolean).length <= 8).toBe(true)
  await ui.unmount()
  await $.turn.start({ text: 'başla', turnId: 'TR1' })
  ui = await $.ui.mount(request)
  expect(await ui.find({ text: /çalışıyor/ })).toBeDefined()
  expect(await ui.find({ text: /idle|working/ })).toBeUndefined()
  await ui.unmount()
})

test('language tr: four agents keep lanes and a failed glyph at 40 columns', { options: { language: 'tr', openOnStart: false } }, async ($, on) => {
  engine(on)
  on('ui.toast', () => ({ value: undefined }))
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: `tr${++n}` }))
  await $.session.start(START)
  await $.turn.start({ text: 'başla', turnId: 'TR2' })
  for (const description of ['bir', 'iki', 'üç', 'dört']) {
    await $.agent.spawn({ prompt: description, description, subagentType: 'general-purpose', tool_use_id: `tu-${description}`, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  }
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'TR2', agentId: 'tr1', reason: 'error' } as never)
  const ui = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await ui.find({ text: /ajanlar · 3 çalışıyor · 4 toplam/ })).toBeDefined()
  expect(await ui.find({ text: /agents ·|running|total/ })).toBeUndefined()
  expect(await ui.find({ text: /━/ })).toBeDefined()
  expect(await ui.find({ text: /^✗ $/ })).toBeDefined()
  expect(await ui.find({ text: /^⚠ $/ })).toBeDefined()
  await ui.unmount()
})

test('language tr: the gate rows open on the first letter of their Turkish label', { options: { language: 'tr', openOnStart: false } }, async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Read' ? 'allow' : 'ask' }))
  await $.session.start(START)
  await $.tool.check({ tool: 'Read', input: { file_path: '/a/b.ts' }, tool_use_id: 'k1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'make test' }, tool_use_id: 'k2' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /2 kontrol/ })).toBeDefined()
  const hotkeys = await Promise.all(['file', 'shell', 'other'].map(async b => (await ui.find({ key: `gate-${b}` }))?.props))
  expect(hotkeys.map(p => [String(p?.label).split(' ')[0], p?.hotkey])).toEqual([['dosya', 'd'], ['kabuk', 'k'], ['başka', 'b']])
  await ui.press({ key: 'gate-shell' })
  expect(await ui.find({ text: /make test/ })).toBeDefined()
  await ui.unmount()
})
