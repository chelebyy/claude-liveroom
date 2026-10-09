import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { clockAblative, isKey, langOf, makeT } from '../hooks/room/i18n'
import { openerOf } from '../hooks/room/core'
import { loopDots } from '../hooks/room/panels'

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

test('a clock takes the suffix of its last spoken word', () => {
  const cases: [string, string][] = [
    ['12:03:45', 'ten'], // beş
    ['12:03:06', 'dan'], // altı
    ['12:03:00', 'ten'], // üç
    ['09:15:40', 'tan'], // kırk
    ['12:40:20', 'den'], // yirmi
    ['10:00:00', 'dan'], // on
    ['00:00:00', 'dan'], // sıfır
  ]
  for (const [clock, suffix] of cases) expect(clockAblative(clock)).toBe(`'${suffix}`)
  expect(clockAblative('--:--:--')).toBe('') // no clock yet: no suffix
})

/** The world beneath the plugin; `statuses` collects what the status line was set to. */
const engine = (on: On, statuses?: string[]) => {
  mock.clock(on)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => e)
  on('ui.status', (_$, e) => {
    if (statuses && typeof e.text === 'string') statuses.push(e.text)
    return { value: undefined }
  })
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
  expect(await ui.find({ text: /genişlet/ })).toBeUndefined() // the hint gives way at 40 columns
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

test('language tr: the architect and gate take Turkish names, lower-cased the Turkish way', { options: { language: 'tr', openOnStart: false } }, async ($, on) => {
  const statuses: string[] = []
  engine(on, statuses)
  on('tool.check', () => ({ decision: 'deny', reason: 'no' }))
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-fable-5-1', agentId: 'adv1' }))
  await $.session.start(START)
  await $.turn.start({ text: 'incele', turnId: 'A1' })
  await $.agent.spawn({ prompt: 'p', description: 'final review', subagentType: 'fable-advisor:fable-advisor', model: 'claude-fable-5-1', tool_use_id: 'tu-a', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' }, tool_use_id: 'k1' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /MİMAR · danışıyor/ })).toBeDefined()
  expect(await ui.find({ text: /--:--:-- beri danışıyor/ })).toBeDefined() // the test clock is at 0
  expect(await ui.find({ text: /İZİN · izinler/ })).toBeDefined()
  expect(await ui.find({ text: /\u0307/ })).toBeUndefined() // no stray combining dot from lower-casing İ
  await ui.unmount()
  expect(statuses.at(-1)).toMatch(/mimar danışıyor · 1 reddedildi/)
})

test('language tr: a label the user named stays theirs, and an English one lower-cases the English way', { options: { language: 'tr', gateLabel: 'KAPI', architectLabel: 'REVIEWER', openOnStart: false } }, async ($, on) => {
  const statuses: string[] = []
  engine(on, statuses)
  on('tool.check', () => ({ decision: 'allow' }))
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-fable-5-1', agentId: 'adv1' }))
  await $.session.start(START)
  await $.turn.start({ text: 'incele', turnId: 'A1' })
  await $.agent.spawn({ prompt: 'p', description: 'final review', subagentType: 'fable-advisor:fable-advisor', model: 'claude-fable-5-1', tool_use_id: 'tu-a', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  expect(statuses.at(-1)).toMatch(/^reviewer danışıyor/) // not "revıewer"
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'k1' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /KAPI · izinler/ })).toBeDefined()
  await ui.unmount()
})

test('language en: the agents hint still fits beside its header at 40 columns', { options: { language: 'en', openOnStart: false } }, async ($, on) => {
  engine(on)
  on('ui.toast', () => ({ value: undefined }))
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: `en${++n}` }))
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 'EN1' })
  for (const description of ['one', 'two', 'three', 'four']) {
    await $.agent.spawn({ prompt: description, description, subagentType: 'Explore', model: 'claude-haiku-5-5', tool_use_id: `tu-${description}`, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  }
  const ui = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await ui.find({ text: /agents · 4 running · 4 total/ })).toBeDefined()
  expect(await ui.find({ text: /1-\d expand/ })).toBeDefined()
  await ui.unmount()
})

test('loop dots keep Flightdeck\'s count in English and never run past the row in Turkish', () => {
  const en = 'other loops '.length + '1 seen · 0 active  '.length
  expect([loopDots(40, en), loopDots(80, en)]).toEqual([4, 42]) // Flightdeck's max(4, w - 38)
  const tr = 'diğer döngüler '.length + '10 görüldü · 10 aktif  '.length
  expect(tr + loopDots(40, tr)).toBeLessThanOrEqual(40)
})

test('language tr: the codex header falls back to its short hint at 40 columns', { options: { language: 'tr', openOnStart: false } }, async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6-luna -c model_reasoning_effort=low x', tool_use_id: 'c1' } as never)
  let ui = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await ui.find({ text: /CODEX · devirler/ })).toBeDefined()
  expect(await ui.find({ text: /^1 toplam$/ })).toBeDefined()
  expect(await ui.find({ text: /çalışıyor · 1 toplam/ })).toBeUndefined()
  await ui.unmount()
  ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /0 çalışıyor · 1 toplam/ })).toBeDefined()
  await ui.unmount()
})

test('language tr: the inline gate summary turns to marks when its words would not fit', { options: { language: 'tr', openOnStart: false } }, async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Read' ? 'allow' : e.tool === 'Bash' ? 'ask' : 'deny', reason: 'no' }))
  await $.session.start(START)
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'k1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'make' }, tool_use_id: 'k2' })
  await $.tool.check({ tool: 'Write', input: { file_path: '/b', content: '' }, tool_use_id: 'k3' })
  const mini = (cols: number) => {
    const p = pane(cols)
    return { ...p, props: { ...p.props, placement: 'inline' as const }, surface: 'terminal' as const }
  }
  let ui = await $.ui.mount(mini(40))
  const marks = await ui.find({ text: /^ ✓\d+ \?\d+ ✗\d+$/ })
  expect(marks?.text).toBe(' ✓1 ?1 ✗1')
  expect(await ui.find({ text: /reddedildi/ })).toBeUndefined()
  await ui.unmount()
  ui = await $.ui.mount(mini(100))
  expect(await ui.find({ text: /1 reddedildi/ })).toBeDefined() // room for the words
  await ui.unmount()
})

test('a tagged turn opener is read for its tag and sender, as promptLine reads them', () => {
  expect(openerOf('<agent-message from="a1492260715f3be7b"> hi')).toEqual({ label: 'agent message', from: 'a1492260' })
  expect(openerOf('<task-notification>\n<task-id>b1</task-id>')).toEqual({ label: 'task notification', from: null })
  expect(openerOf('fix the parser')).toBeNull()
})

for (const [language, line] of [
  ['tr', /^ajan mesajı · a1492260$/],
  ['en', /^agent message from a1492260$/],
] as const) {
  test(`language ${language}: a tagged turn opener's log line`, { options: { language, openOnStart: false } }, async ($, on) => {
    engine(on)
    await $.session.start(START)
    await $.turn.start({ text: '<agent-message from="a1492260715f3be7b"> hi', turnId: 'M1' })
    await $.turn.start({ text: '<some-new-tag> x', turnId: 'M2' })
    const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
    expect(await ui.find({ text: line })).toBeDefined()
    expect(await ui.find({ text: /^some new tag$/ })).toBeDefined() // an unknown tag stays as written
    await ui.unmount()
  })
}

test('language tr: the gate totals turn to marks when their words would run past the frame', { options: { language: 'tr', openOnStart: false } }, async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: String(e.tool_use_id).startsWith('a') ? 'allow' : 'deny', reason: 'no' }))
  await $.session.start(START)
  for (let i = 0; i < 10; i++) {
    await $.tool.check({ tool: 'Read', input: { file_path: `/a${i}` }, tool_use_id: `a${i}` })
    await $.tool.check({ tool: 'Write', input: { file_path: `/d${i}`, content: '' }, tool_use_id: `d${i}` })
  }
  let ui = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await ui.find({ text: /^✗ 10$/ })).toBeDefined()
  expect(await ui.find({ text: /^✗ 10 reddedildi$/ })).toBeUndefined()
  await ui.unmount()
  ui = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  expect(await ui.find({ text: /^✗ 10 reddedildi$/ })).toBeDefined()
  await ui.unmount()
})

test('labels lower-case by their own script: Turkish letters the Turkish way, any other label the plain way', { options: { language: 'tr', architectLabel: 'REVISIÓN', gateLabel: 'KAPI DENETİMİ', openOnStart: false } }, async ($, on) => {
  const statuses: string[] = []
  engine(on, statuses)
  on('tool.check', () => ({ decision: 'allow' }))
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-fable-5-1', agentId: 'adv1' }))
  await $.session.start(START)
  await $.turn.start({ text: 'incele', turnId: 'A1' })
  await $.agent.spawn({ prompt: 'p', description: 'final review', subagentType: 'fable-advisor:fable-advisor', model: 'claude-fable-5-1', tool_use_id: 'tu-a', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'k1' })
  expect(statuses.at(-1)).toMatch(/^revisión danışıyor/) // not "revısıón"
  const p = pane(80)
  const ui = await $.ui.mount({ ...p, props: { ...p.props, placement: 'inline' as const }, surface: 'terminal' })
  expect(await ui.find({ text: /^kapı denetimi $/ })).toBeDefined() // not "kapi deneti̇mi"
  await ui.unmount()
})
