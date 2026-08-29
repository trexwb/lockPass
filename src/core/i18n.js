/* ═══════════════════════════════════════════════════════════════════
   LockPass — i18n 基础设施（P3-12：文案与代码分离的地基）
   ═══════════════════════════════════════════════════════════════════
   设计要点：
   - 纯逻辑层，零框架依赖，挂载 window.I18n（遵循 core/ 规范）
   - 当前仅内置 zh-CN 语言包；新增语言只需扩充 LANG_PACKS，t() 自动回退 zh-CN
   - t(key) 未命中时返回 key 本身（便于发现漏翻译）
   - 占位符语法：t('lock.cooldown', { sec: 30 }) → "…{sec}…" 中的 {sec} 被替换

   迁移约定（面向后续迭代）：
   1. 新代码禁止硬编码用户可见文案，统一走 I18n.t('模块.key')
   2. 存量文案按页面渐进迁移（本文件先试点锁屏 AuthView 文案）
   3. 键名规范：<模块>.<语义>，如 lock.titleUnlock / entry.copyOk
   ═══════════════════════════════════════════════════════════════════ */

const LANG_PACKS = {
  'zh-CN': {
    /* ── 锁屏（试点） ── */
    'lock.titleCreate': '创建密码保险箱',
    'lock.titleUnlock': '密码保险箱',
    'lock.subtitleCreate': '设置一个强主密码来保护您的所有密码',
    'lock.subtitleUnlock': '输入主密码解锁您的密码库',
    'lock.btnUnlock': '解锁',
    'lock.btnCreate': '创建',
    'lock.hint': '数据仅保存在本地设备，不会上传到任何服务器',
    'lock.pwPlaceholderCreate': '设置主密码',
    'lock.pwPlaceholderUnlock': '输入主密码',
    'lock.pwConfirmPlaceholder': '再次输入主密码确认',
    'lock.errorPwMismatch': '两次输入的密码不一致',
    'lock.errorPwEmpty': '请输入主密码',
    'lock.errorPwTooShort': '主密码至少需要 8 位',
    'lock.errorUnlockFailed': '解锁失败',
    'lock.errorBackoff': '尝试次数过多，请 {sec} 秒后重试',
    'lock.errorBackoffBtn': '{sec}s 后重试',
    'lock.restoreFromFile': '从本地文件恢复',
    'lock.bindDirectory': '绑定已有数据目录',
    'lock.masterPwWarning': '主密码无法找回：若遗失，加密数据将永久无法恢复。请务必牢记，或在安全位置备份主密码。',
  },
}

/** 当前语言（模块级内存态；后续接设置持久化时再扩展） */
let currentLang = 'zh-CN'

/**
 * 取翻译文案
 * @param {string} key - 语言包键名（如 'lock.titleUnlock'）
 * @param {Object<string, string|number>} [params] - 占位符参数（{sec} 等）
 * @returns {string} 翻译文案；未命中时返回 key 本身
 */
function t(key, params) {
  const pack = LANG_PACKS[currentLang] || LANG_PACKS['zh-CN']
  let text = pack[key] != null ? pack[key] : LANG_PACKS['zh-CN'][key]
  if (text == null) return key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }
  return text
}

/**
 * 切换语言（仅接受已注册语言包）
 * @param {string} lang - 语言标识（如 'zh-CN'）
 */
function setLang(lang) {
  if (LANG_PACKS[lang]) currentLang = lang
}

/** 当前语言标识 */
function getLang() {
  return currentLang
}

// 导出模块（遵循 core/ 的 window.* 挂载规范）
window.I18n = { t, setLang, getLang, langs: Object.keys(LANG_PACKS) }
