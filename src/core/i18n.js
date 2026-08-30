/* ═══════════════════════════════════════════════════════════════════
   LockPass — i18n 基础设施（多语言：zh-CN / en-US）
   ═══════════════════════════════════════════════════════════════════
   设计要点（升级方案 §6.5）：
   - 纯逻辑层，零框架依赖（词典经 src/i18n/zh.js|en.js ESM 导入），挂载 window.I18n
   - 语言偏好三级：'system' | 'zh-CN' | 'en-US'，存 localStorage（lockpass_lang）
     'system' 运行时按 navigator.language 解析（zh* → zh-CN，否则 en-US）
   - t(key) 回退链：当前语言 → zh-CN → key 本身；占位符 {name} 替换
   - 切换即时生效：语言态为响应式（composables/useI18n.js 桥接），组件模板自动重渲染；
     JS 侧 Toast 在调用时求值，天然即时
   - 键名规范：<模块>.<语义>；新代码禁止硬编码用户可见文案
   ═══════════════════════════════════════════════════════════════════ */
import zhDict from '../i18n/zh.json'
import enDict from '../i18n/en.json'

const LANG_PACKS = { 'zh-CN': zhDict, 'en-US': enDict }
const FALLBACK = 'zh-CN'
const PREF_KEY = 'lockpass_lang'

/** 当前语言（解析后的具体语言，非 'system'） */
let currentLang = FALLBACK

/** 解析偏好 → 具体语言 */
function resolveLang(pref) {
  if (pref === 'zh-CN' || pref === 'en-US') return pref
  // system：按浏览器语言探测（探测不可用兜底 zh-CN，§6.5 启动时序）
  const nav = (navigator.language || '').toLowerCase()
  return !nav || nav.startsWith('zh') ? 'zh-CN' : 'en-US'
}

/** 读取持久化偏好（缺省 'system'） */
function loadPref() {
  try {
    const v = localStorage.getItem(PREF_KEY)
    return v === 'zh-CN' || v === 'en-US' || v === 'system' ? v : 'system'
  } catch (e) { return 'system' }
}

/** 启动初始化：读偏好 → 解析 → 设定当前语言 */
function initLang() {
  currentLang = resolveLang(loadPref())
  return currentLang
}

/**
 * 取翻译文案
 * @param {string} key - 语言包键名（如 'side.addPassword'）
 * @param {Object<string, string|number>} [params] - 占位符参数（{n}/{sec} 等）
 * @returns {string} 翻译文案；回退链 en→zh-CN 均未命中时返回 key 本身
 */
function t(key, params) {
  const pack = LANG_PACKS[currentLang] || LANG_PACKS[FALLBACK]
  let text = pack[key] != null ? pack[key] : LANG_PACKS[FALLBACK][key]
  if (text == null) {
    // dev 模式未命中键告警（升级方案 §6.5：dev 下 t() 未命中键 console.warn）
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
      console.warn('[i18n] missing key:', key)
    }
    return key
  }
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }
  return text
}

/** 切换语言（仅接受已注册语言包；不影响持久化偏好） */
function setLang(lang) {
  if (LANG_PACKS[lang]) currentLang = lang
}

/** 切换并持久化偏好（'system' | 'zh-CN' | 'en-US'） */
function setLangPref(pref) {
  const valid = pref === 'zh-CN' || pref === 'en-US' || pref === 'system'
  if (!valid) return currentLang
  try { localStorage.setItem(PREF_KEY, pref) } catch (e) {}
  currentLang = resolveLang(pref)
  return currentLang
}

/** 当前语言标识（具体语言，非 'system'） */
function getLang() { return currentLang }

/** 当前偏好（'system' | 具体语言） */
function getLangPref() { return loadPref() }

/** 已注册语言 */
function langs() { return Object.keys(LANG_PACKS) }

initLang()

window.I18n = { t, setLang, setLangPref, getLang, getLangPref, langs, initLang }
