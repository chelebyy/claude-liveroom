// Liveroom's languages: English, and Turkish by the `language` option. The English text is the key,
// so English needs no table and a string without a Turkish entry fails to type-check.

export type Lang = 'en' | 'tr'
export type LanguageOption = 'auto' | Lang

/** Turkish, keyed by the English it replaces. `{name}` marks a value filled in at the call. */
export const TR = {
  // ---- room panels
  'MODELS · requests': 'MODELLER · istekler',
  'CODEX · hand-offs': 'CODEX · devirler',
  'SKILLS · plugins': 'SKILL · eklentiler',
  '{n} running': '{n} çalışıyor',
  '{n} bg': '{n} bg',
  '{n} total': '{n} toplam',
  'own model': 'kendi modeli',
  default: 'varsayılan',
  '⚠ {n} without model or effort': '⚠ {n} model ya da efor verilmeden',
  rescue: 'rescue',
  consult: 'danışma',
  exec: 'exec',
  review: 'review',
  // ---- delegation rule
  'no model in the call, runs on the main model': 'çağrıda model yok, ana modelde çalışıyor',
  "no model in the call, inherits its parent's model": 'çağrıda model yok, üst ajanın modelini alıyor',
  '⚠ {type}: no model in the call, runs on {model}': '⚠ {type}: çağrıda model yok, {model} üzerinde çalışıyor',
  '⚠ {type}: no model in the call, inherits {model} from its parent': '⚠ {type}: çağrıda model yok, {model} modelini üst ajandan alıyor',
  // ---- Flightdeck panels
  ARCHITECT: 'MİMAR',
  GATE: 'İZİN',
  'ctx {n}%': 'ctx {n}%',
  'agents {running}/{total}': 'ajanlar {running}/{total}',
  advising: 'danışıyor',
  'denied {n}': '{n} reddedildi',
  'before a plan': 'plan öncesi',
  'error repeats': 'hata tekrarı',
  'before done': 'bitiş öncesi',
  '{moment} · {via}': '{moment} · {via}',
  'consulted · {via}': 'danışıldı · {via}',
  'advice: {text}': 'öneri: {text}',
  'advice returned': 'öneri geldi',
  'Liveroom, the live agent dashboard: open, close, reset, or set the layout': 'Liveroom, canlı ajan paneli: aç, kapat, sıfırla veya yerleşimi ayarla',
  'Liveroom closed.': 'Liveroom kapatıldı.',
  'Liveroom reset.': 'Liveroom sıfırlandı.',
  'Usage: /liveroom layout auto|compact|wide|mini': 'Kullanım: /liveroom layout auto|compact|wide|mini',
  'Liveroom layout: {layout}.': 'Liveroom yerleşimi: {layout}.',
  'Layout set to {layout}; the pane is not shown yet: {reason}': 'Yerleşim {layout} olarak ayarlandı; panel henüz gösterilmiyor: {reason}',
  'Liveroom is not shown yet: {reason}': 'Liveroom henüz gösterilmiyor: {reason}',
  'Liveroom opened. Focus it with ctrl+x tab; 1-6 expand cards, f/s/o open the gate rows.': 'Liveroom açıldı. ctrl+x tab ile odaklan; 1-6 kartları genişletir, d/k/b izin satırlarını açar.',
  'hit max_tokens': 'max_tokens sınırına ulaştı',
  'context compacted ({trigger})': 'bağlam sıkıştırıldı ({trigger})',
  'denied by rule · {detail}': 'kuralla reddedildi · {detail}',
  '{text}  denied': '{text}  reddedildi',
  '{name} tool': '{name} aracı',
  'spawned · {type}': 'başlatıldı · {type}',
  'done · {took}': 'bitti · {took}',
  running: 'çalışıyor',
  done: 'bitti',
  stopped: 'durduruldu',
  failed: 'başarısız',
  classifier: 'sınıflandırıcı',
  you: 'sen',
  main: 'ana',
  gate: 'izin',
  agent: 'ajan',
  engine: 'sistem',
  '● working': '● çalışıyor',
  '○ idle': '○ boşta',
  'effort ': 'efor ',
  '   mode {mode}': '   mod {mode}',
  '   {n} req': '   {n} istek',
  'ctx ': 'ctx ',
  'on call': 'hazırda',
  'consults ': 'danışma ',
  'consulting since {t}': '{t}{abl} beri danışıyor',
  'last {d} ago · took {d2}': 'son: {d} önce · {d2} sürdü',
  'not consulted yet': 'henüz danışılmadı',
  '(inferred)': '(tahmini)',
  permissions: 'izinler',
  '{n} checks': '{n} kontrol',
  'no checks yet': 'henüz kontrol yok',
  ' {n} allowed  ': ' {n} izinli  ',
  '■ {n} pending  ': '■ {n} bekliyor  ',
  '✗ {n} denied': '✗ {n} reddedildi',
  '  dim: in subagents': '  soluk: alt ajanlarda',
  file: 'dosya',
  shell: 'kabuk',
  other: 'başka',
  allowed: 'izinli',
  pending: 'bekliyor',
  denied: 'reddedildi',
  'agents · {running} running · {total} total': 'ajanlar · {running} çalışıyor · {total} toplam',
  '1-{n} expand': '1-{n} genişlet',
  'no subagents yet': 'henüz alt ajan yok',
  '+{n} earlier': '+{n} önceki',
  'ctx {ctx} · out {out} · {n} st': 'ctx {ctx} · çıktı {out} · {n} adım',
  'starting…': 'başlıyor…',
  '{type} · {model} · {status} · {n} steps': '{type} · {model} · {status} · {n} adım',
  'no tool calls yet': 'henüz araç çağrısı yok',
  'other loops ': 'diğer döngüler ',
  '{n} seen · {active} active  ': '{n} görüldü · {active} aktif  ',
  '◐ back to {model} · turn ': '◐ {model} modeline dönüldü · tur ',
  ' · {edits} · {errors}': ' · {edits} · {errors}',
  '{n} edit': '{n} düzenleme',
  '{n} edits': '{n} düzenleme',
  '{n} error': '{n} hata',
  '{n} errors': '{n} hata',
  '{n} agent': '{n} ajan',
  '{n} agents': '{n} ajan',
  'last turn {d} · {agents} · {edits} · {errors}': 'son tur {d} · {agents} · {edits} · {errors}',
  'no turn finished yet': 'henüz biten tur yok',
  '{label} reviewing before done (inferred)': '{label} bitmeden önce inceliyor (tahmini)',
  'session log · this agent': 'oturum kaydı · bu ajan',
  'session log': 'oturum kaydı',
  'nothing yet': 'henüz bir şey yok',
  '{n} agents on a time axis': '{n} ajan zaman ekseninde',
  ' {allowed} allowed · {cleared} {decider}{pending} · {denied} denied': ' {allowed} izinli · {cleared} {decider}{pending} · {denied} reddedildi',
  ' · {n} pending': ' · {n} bekliyor',
  ' ✓{ok}{pending} ✗{denied}': ' ✓{ok}{pending} ✗{denied}',
  // ---- tagged turn openers in the session log
  '{label} from {from}': '{label} · {from}',
  'agent message': 'ajan mesajı',
  'teammate message': 'takım üyesi mesajı',
  'task notification': 'görev bildirimi',
  'command message': 'komut mesajı',
  'command name': 'komut',
  'local command stdout': 'yerel komut çıktısı',
  'system reminder': 'sistem hatırlatması',
  ' ● working': ' ● çalışıyor',
  ' ○ idle': ' ○ boşta',
  ' · ctx ': ' · ctx ',
  ' ctx {n} ': ' ctx {n} ',
  '+{n} more agents · /liveroom layout compact for all': '+{n} ajan daha · hepsi için /liveroom layout compact',
  'other loops {n} · {active} active': 'diğer döngüler {n} · {active} aktif',
  agents: 'ajanlar',
  ' WORKS': ' ÇALIŞIYOR',
  ' IDLE': ' BOŞTA',
  ' ADVISING': ' DANIŞIYOR',
  ' ON CALL': ' HAZIRDA',
} as const satisfies Record<string, string>

export type Key = keyof typeof TR
export type Vars = Readonly<Record<string, string | number>>
/** Text in the pane's language: `t('{n} total', { n: 3 })`. */
export type T = (key: Key, vars?: Vars) => string

const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text)

export function makeT(lang: Lang): T {
  return (key, vars) => fill(lang === 'tr' ? TR[key] : key, vars)
}

const UNITS = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz']
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli']

/** The ablative suffix a Turkish word takes: `dan`, `den`, `tan` or `ten`, by its last vowel and sound. */
function ablativeOf(word: string): string {
  const vowel = [...word].reverse().find(c => 'aıoueiöü'.includes(c)) ?? 'a'
  const consonant = /[çfhkpsşt]$/.test(word) ? 't' : 'd'
  return `${consonant}${'aıou'.includes(vowel) ? 'a' : 'e'}n`
}

/**
 * The ablative suffix for a `HH:MM:SS` clock as it is read aloud, apostrophe included: its last part
 * that isn't zero names the last word ("12:03:45" ends on "beş", so `'ten`); all zeros read "sıfır".
 * Nothing for a clock that isn't one, such as `--:--:--`.
 */
export function clockAblative(clock: string): string {
  if (!/^\d{1,2}(:\d{2}){1,2}$/.test(clock)) return ''
  const n = [...clock.split(':')].reverse().map(Number).find(x => x > 0)
  return `'${ablativeOf(n === undefined ? 'sıfır' : n % 10 > 0 ? UNITS[n % 10]! : TENS[Math.floor(n / 10) % 6]!)}`
}

/** Whether a stored text, such as a rule note, has a translation. */
export const isKey = (text: string): text is Key => Object.prototype.hasOwnProperty.call(TR, text)

/**
 * The pane's language: `en` or `tr` as the option says, or under `auto` Claude Code's own
 * `language` setting (`"Turkish"`, `"tr"`, `"Türkçe"`); English when it names anything else.
 */
export function langOf(option: LanguageOption, setting: unknown): Lang {
  if (option !== 'auto') return option
  return typeof setting === 'string' && /^(tr\b|turkish|türkçe|turkce)/i.test(setting.trim()) ? 'tr' : 'en'
}
