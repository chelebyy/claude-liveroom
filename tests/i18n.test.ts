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
