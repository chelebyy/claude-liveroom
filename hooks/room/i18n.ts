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
} as const satisfies Record<string, string>

export type Key = keyof typeof TR
export type Vars = Readonly<Record<string, string | number>>
/** Text in the pane's language: `t('{n} total', { n: 3 })`. */
export type T = (key: Key, vars?: Vars) => string

const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text)

export function makeT(lang: Lang): T {
  return (key, vars) => fill(lang === 'tr' ? TR[key] : key, vars)
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
