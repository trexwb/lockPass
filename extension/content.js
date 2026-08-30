/* LockPass 自动填充 — 通用内容脚本（所有网页，含 iframe）
   职责：识别登录表单（支持 iframe / Shadow DOM / 多步登录）、填充凭据。
   安全：不自动提交表单（仅填充 + 高亮提交按钮，用户确认后自行提交）。 */

// ── 用户名候选判定 ──────────────────────────────────
const USERNAME_HINT_RE = /user|email|login|account|mobile|phone|tel|name/i

function isUsernameCandidate(el) {
  const attrs = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')]
    .filter(Boolean)
    .join(' ')
  if (USERNAME_HINT_RE.test(attrs)) return true
  const type = (el.type || '').toLowerCase()
  return ['text', 'email', 'tel'].includes(type)
}

// ── 多字段识别（upgrade-design.md §2.1） ─────────────
// 在 username/password 启发式之外，按特征识别 email / phone / otp / url 字段，
// 供 LP_MULTI_FILL 按条目 customFields type 匹配填充。识别结果与既有逻辑共用
// walkRoots 遍历框架（iframe / shadow DOM 自动兼容）。
const EMAIL_HINT_RE = /email|mail/i
const PHONE_HINT_RE = /phone|mobile|tel/i
const OTP_HINT_RE = /code|otp|verify|verification|captcha|mfa|2fa|auth/i
const URL_HINT_RE = /url|website|web.?site|link|domain/i

function isEmailField(el) {
  const type = (el.type || '').toLowerCase()
  if (type === 'email') return true
  const auto = (el.autocomplete || '').toLowerCase()
  if (auto === 'email' || /(^|\s)email(\s|$)/.test(auto)) return true
  const attrs = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')]
    .filter(Boolean)
    .join(' ')
  return EMAIL_HINT_RE.test(attrs)
}

function isPhoneField(el) {
  const type = (el.type || '').toLowerCase()
  if (type === 'tel') return true
  const auto = (el.autocomplete || '').toLowerCase()
  if (auto === 'tel' || /(^|\s)tel(\s|$)/.test(auto)) return true
  const attrs = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')]
    .filter(Boolean)
    .join(' ')
  return PHONE_HINT_RE.test(attrs)
}

function isOtpField(el) {
  const auto = (el.autocomplete || '').toLowerCase()
  if (auto === 'one-time-code') return true
  const type = (el.type || '').toLowerCase()
  if (!['text', 'tel', 'number'].includes(type)) return false
  const attrs = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')]
    .filter(Boolean)
    .join(' ')
  if (!OTP_HINT_RE.test(attrs)) return false
  // 强特征（名称/占位符含验证码语义）或数字输入模式视为 OTP，避免误抓普通 code 输入框
  if (/(verify|verification|otp|captcha|mfa|2fa)/i.test(attrs)) return true
  return el.inputMode === 'numeric' && /(code|auth)/i.test(attrs)
}

function isUrlField(el) {
  const type = (el.type || '').toLowerCase()
  if (type === 'url') return true
  const attrs = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')]
    .filter(Boolean)
    .join(' ')
  return URL_HINT_RE.test(attrs)
}

/* ── Shadow DOM 穿透遍历 ────────────────────────────
   遍历 root（Document 或 ShadowRoot）下所有元素；遇到 open shadow root 时深入。
   cb 返回 false 提前终止。
   限制：closed shadow root 无法经 DOM API 访问（浏览器安全边界），不支持。 */
function walkRoots(root, cb) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let node
  while ((node = walker.nextNode())) {
    if (cb(node) === false) return false
    if (node.shadowRoot && node.shadowRoot.mode === 'open') {
      if (walkRoots(node.shadowRoot, cb) === false) return false
    }
  }
  return true
}

/* ── 表单定位（跨 Shadow DOM） ────────────────────── */
function findPasswordInput() {
  let found = null
  walkRoots(document, (el) => {
    if (!(el instanceof HTMLInputElement)) return
    if (el.type !== 'password') return
    if (el.disabled || el.readOnly) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return
    found = el
    return false
  })
  return found
}

/* ── 页面状态检测（多字段，upgrade-design.md §2.1/§2.3） ──
   统一扫描 username / password / email / phone / otp / url 输入框：
   优先以「密码框所在渲染边界」为范围（避免误填不同表单的框）；
   无密码框时回退全文档扫描（多步登录/注册/验证码场景）。
   返回 fieldKeys 能力位，供后台按条目数据构造 LP_MULTI_FILL 字段集。 */
function findFormFields() {
  const fields = {
    username: null,
    password: null,
    email: null,
    phone: null,
    otp: null,
    url: null,
  }
  const passwordInput = findPasswordInput()
  const root = passwordInput ? passwordInput.getRootNode() : document
  walkRoots(root, (el) => {
    if (!(el instanceof HTMLInputElement)) return
    if (el === passwordInput) return
    if (el.disabled || el.readOnly) return
    const type = (el.type || '').toLowerCase()
    if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset'].includes(type)) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return
    // 优先级：password > otp > email > phone > url > username（避免 email 框被抢作 username）
    if (type === 'password') {
      fields.password = fields.password || el
    } else if (isOtpField(el)) {
      fields.otp = fields.otp || el
    } else if (isEmailField(el)) {
      fields.email = fields.email || el
    } else if (isPhoneField(el)) {
      fields.phone = fields.phone || el
    } else if (isUrlField(el)) {
      fields.url = fields.url || el
    } else if (isUsernameCandidate(el)) {
      fields.username = fields.username || el
    }
  })
  if (passwordInput) fields.password = passwordInput
  // 无密码框时：全文档找 username 候选（含提交按钮校验，避免误抓搜索框）
  if (!fields.password && !fields.username) {
    let usernameEl = null
    walkRoots(document, (el) => {
      if (!(el instanceof HTMLInputElement)) return
      if (el.disabled || el.readOnly) return
      const type = (el.type || '').toLowerCase()
      if (['password', 'hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset'].includes(type)) return
      if (isEmailField(el) || isPhoneField(el) || isOtpField(el) || isUrlField(el)) return
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return
      if (!isUsernameCandidate(el)) return
      usernameEl = el
      return false
    })
    if (usernameEl) {
      const r2 = usernameEl.getRootNode()
      let hasSubmit = false
      walkRoots(r2, (el) => {
        if (el.tagName === 'BUTTON' && (!el.type || el.type === 'submit')) {
          hasSubmit = true
          return false
        }
        if (el instanceof HTMLInputElement && ['submit', 'image'].includes((el.type || '').toLowerCase())) {
          hasSubmit = true
          return false
        }
      })
      if (hasSubmit) fields.username = usernameEl
    }
  }
  return fields
}

function detectLoginState() {
  const f = findFormFields()
  return {
    hasPassword: !!f.password,
    hasAnyField: !!(f.password || f.username || f.email || f.phone || f.otp || f.url),
    passwordInput: f.password,
    usernameInput: f.username,
    emailInput: f.email,
    phoneInput: f.phone,
    otpInput: f.otp,
    urlInput: f.url,
    form: (f.password && f.password.closest('form')) || (f.username && f.username.closest('form')) || null,
    // 能力位：本页面已出现哪些可填字段（按状态机顺序）
    fieldKeys: ['username', 'password', 'email', 'phone', 'otp', 'url'].filter((k) => f[k]),
  }
}

/* ── 填充原语 ────────────────────────────────────── */
function setNativeValue(el, value) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

function highlightSubmit(ctx) {
  const root =
    (ctx && (ctx.form || (ctx.passwordInput && ctx.passwordInput.getRootNode()))) || document
  let btn = null
  walkRoots(root, (el) => {
    if (el.tagName === 'BUTTON' && (!el.type || el.type === 'submit')) {
      btn = el
      return false
    }
    if (el instanceof HTMLInputElement && ['submit', 'image'].includes((el.type || '').toLowerCase())) {
      btn = el
      return false
    }
  })
  if (!btn) return
  const prev = btn.style.outline
  btn.style.outline = '2px solid #58a6ff'
  btn.style.outlineOffset = '2px'
  setTimeout(() => {
    btn.style.outline = prev
  }, 2400)
}

/* ── 自动检测（自动填充入口） ────────────────────────
   页面出现「密码框」或「用户名框+提交按钮」或 email/phone/otp 等字段时上报后台，
   后台在「网页版页面桥 / 桌面版 HTTP 服务」任一就绪后自动取数填充。
   节流：同一域名 5 秒内只上报一次，避免 MutationObserver 高频触发。
   多步登录：第一步只填已出现字段并进入 waitingFields；后续字段出现时
   立即上报 LP_FIELDS_READY（携带当前能力位）请求补填剩余字段。 */
let lastPageReadyAt = 0
const PAGE_READY_THROTTLE_MS = 5000
let lastScanAt = 0
const SCAN_THROTTLE_MS = 300 // MutationObserver 微节流：避免同帧高频变化时重复全树遍历
let waitingFields = null // 已填字段 key 数组；页面出现新字段后请求补填剩余字段

function notifyPageReady() {
  const state = detectLoginState()
  if (!state.hasAnyField) return
  const now = Date.now()
  if (now - lastPageReadyAt < PAGE_READY_THROTTLE_MS) return
  lastPageReadyAt = now
  try {
    chrome.runtime.sendMessage({
      type: 'LP_PAGE_READY',
      domain: location.hostname,
      hasPassword: state.hasPassword,
      fields: state.fieldKeys,
    })
  } catch (e) { /* 忽略 */ }
}

function onDomMaybeChanged() {
  const now = Date.now()
  if (now - lastScanAt < SCAN_THROTTLE_MS) return
  lastScanAt = now
  const state = detectLoginState()
  // 多步状态机（upgrade-design.md §2.3）：等待中的新字段出现（密码框 / 邮箱 / 验证码…）
  // → 立即请求补填剩余字段
  if (waitingFields && waitingFields.length) {
    const newKeys = state.fieldKeys.filter((k) => !waitingFields.includes(k))
    if (newKeys.length) {
      waitingFields = null
      try {
        chrome.runtime.sendMessage({
          type: 'LP_FIELDS_READY',
          domain: location.hostname,
          fields: state.fieldKeys,
        })
      } catch (e) { /* 忽略 */ }
      return
    }
  }
  notifyPageReady()
}

function observeLoginForms() {
  notifyPageReady()
  const mo = new MutationObserver(() => onDomMaybeChanged())
  try {
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'style', 'class'] })
  } catch (e) { /* 忽略 */ }
  // SPA 路由变化后重置节流重新检测
  const patch = (type) => {
    const orig = history[type]
    history[type] = function (...args) {
      const r = orig.apply(this, args)
      setTimeout(() => { lastPageReadyAt = 0; notifyPageReady() }, 200)
      return r
    }
  }
  try { patch('pushState'); patch('replaceState') } catch (e) {}
  window.addEventListener('popstate', () => { lastPageReadyAt = 0; notifyPageReady() })
}

/* ── 消息处理 ────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 多字段填充（upgrade-design.md §2.2 主路径）：fields = [{ key, value }]
  // key ∈ username/password/email/phone/otp/url，按页面能力位匹配输入框逐项填充
  if (msg.type === 'LP_MULTI_FILL') {
    const { fields } = msg
    if (!Array.isArray(fields) || !fields.length) {
      sendResponse({ ok: false, error: '无可填充字段' })
      return
    }
    const state = detectLoginState()
    const inputMap = {
      username: state.usernameInput,
      password: state.passwordInput,
      email: state.emailInput,
      phone: state.phoneInput,
      otp: state.otpInput,
      url: state.urlInput,
    }
    const filled = []
    for (const f of fields) {
      const input = f && inputMap[f.key]
      if (!input) continue
      if (f.value === undefined || f.value === null || f.value === '') continue
      setNativeValue(input, f.value)
      filled.push(f.key)
    }
    if (!filled.length) {
      sendResponse({ ok: false, error: '当前页面未找到可匹配的输入框' })
      return
    }
    highlightSubmit(state)
    const hasPasswordFilled = filled.includes('password')
    // 多步：页面仍有已识别但本次未填充的字段（如密码框尚未出现）→ 等待补填
    const remaining = state.fieldKeys.filter((k) => !filled.includes(k))
    waitingFields = remaining.length ? filled : null
    sendResponse({ ok: true, filled, filledPassword: hasPasswordFilled })
    return
  }

  // 完整填充（用户名 + 密码），兼容旧路径
  if (msg.type === 'LP_FILL') {
    const { entry, password } = msg
    // 防御：密码缺失时拒绝填充，避免表单被写入 "undefined" 之类的脏值
    if (password === undefined || password === null || password === 'undefined') {
      sendResponse({ ok: false, error: '密码数据无效，请重试' })
      return
    }
    const state = detectLoginState()
    if (!state.hasPassword && !state.usernameInput) {
      sendResponse({ ok: false, error: '当前页面未找到登录表单（缺少密码输入框）' })
      return
    }
    if (state.usernameInput && entry.username) {
      setNativeValue(state.usernameInput, entry.username)
    }
    if (state.hasPassword) {
      setNativeValue(state.passwordInput, password)
      highlightSubmit(state)
      sendResponse({ ok: true, filledPassword: true })
    } else {
      // 多步登录第一步：只有用户名框，填入后等待后续字段（密码/邮箱/验证码）
      waitingFields = ['username']
      sendResponse({ ok: true, filledPassword: false })
    }
    return
  }

  // 多步登录第一步：仅填用户名
  if (msg.type === 'LP_FILL_USERNAME') {
    const { entry } = msg
    const state = detectLoginState()
    if (!state.usernameInput) {
      sendResponse({ ok: false, error: '当前页面未找到用户名输入框' })
      return
    }
    if (entry.username) {
      setNativeValue(state.usernameInput, entry.username)
    }
    waitingFields = ['username']
    sendResponse({ ok: true })
    return
  }

  // 多步登录第二步：密码框出现后补填密码
  if (msg.type === 'LP_FILL_PASSWORD') {
    const { password } = msg
    if (password === undefined || password === null || password === 'undefined') {
      sendResponse({ ok: false, error: '密码数据无效，请重试' })
      return
    }
    const state = detectLoginState()
    if (!state.hasPassword) {
      sendResponse({ ok: false, error: '尚未出现密码输入框' })
      return
    }
    setNativeValue(state.passwordInput, password)
    highlightSubmit(state)
    waitingFields = null
    sendResponse({ ok: true })
    return
  }

  // 建议气泡（来自 background：按 URL 域名预筛选的推荐条目）
  if (msg.type === 'LP_SHOW_SUGGESTIONS') {
    // 仅在顶层 frame 显示，避免 iframe 内重复渲染
    if (window !== window.top) { sendResponse({ ok: false }); return }
    const now = Date.now()
    if (suggestDismissed || now - lastSuggestAt < SUGGEST_BUBBLE_MIN_GAP_MS) {
      sendResponse({ ok: false })
      return
    }
    lastSuggestAt = now
    if (msg.empty) showSuggestionEmpty()
    else showSuggestionBubble(msg.entries || [])
    sendResponse({ ok: true })
    return
  }
})

// 启动登录表单自动检测（自动填充）
observeLoginForms()

/* ── 自动弹出建议气泡（按 URL 域名预筛选推荐条目） ────
   由 background 在检测到登录表单后发送 LP_SHOW_SUGGESTIONS 触发。
   命中多条：列表展示可多选；未命中：短暂提示。60s 内同页不重复自动弹出。 */
const SUGGEST_BUBBLE_MIN_GAP_MS = 60000
let lastSuggestAt = 0
let suggestDismissed = false

function ensureSuggestStyle() {
  if (document.getElementById('lp-suggest-style')) return
  const style = document.createElement('style')
  style.id = 'lp-suggest-style'
  style.textContent =
    '#lp-suggest-root{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:280px;max-width:calc(100vw - 32px);background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.4);font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden}' +
    '#lp-suggest-root .lp-sg-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#161b22;border-bottom:1px solid #30363d;font-weight:600}' +
    '#lp-suggest-root .lp-sg-close{cursor:pointer;color:#8b949e;font-size:16px;line-height:1;background:none;border:none;padding:2px 6px}' +
    '#lp-suggest-root .lp-sg-close:hover{color:#e6edf3}' +
    '#lp-suggest-root .lp-sg-list{list-style:none;margin:0;padding:0;max-height:240px;overflow-y:auto}' +
    '#lp-suggest-root .lp-sg-item{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;cursor:pointer;border-bottom:1px solid #21262d;text-align:left;background:none;color:inherit;font:inherit}' +
    '#lp-suggest-root .lp-sg-item:hover{background:#161b22}' +
    '#lp-suggest-root .lp-sg-item .lp-sg-main{min-width:0;flex:1}' +
    '#lp-suggest-root .lp-sg-title{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#lp-suggest-root .lp-sg-sub{display:block;font-size:11px;color:#8b949e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#lp-suggest-root .lp-sg-arrow{color:#8b949e;flex-shrink:0}' +
    '#lp-suggest-root .lp-sg-empty{padding:14px 12px;color:#8b949e;text-align:center}'
  ;(document.head || document.documentElement).appendChild(style)
}

function removeSuggestBubble() {
  const el = document.getElementById('lp-suggest-root')
  if (el) el.remove()
}

function attachSuggestClose(root) {
  root.querySelector('.lp-sg-close').addEventListener('click', () => {
    removeSuggestBubble()
    suggestDismissed = true
  })
}

function showSuggestionBubble(entries) {
  ensureSuggestStyle()
  removeSuggestBubble()
  const root = document.createElement('div')
  root.id = 'lp-suggest-root'
  root.innerHTML =
    '<div class="lp-sg-head"><span>LockPass 建议</span><button class="lp-sg-close" title="关闭">×</button></div>' +
    '<ul class="lp-sg-list"></ul>'
  const list = root.querySelector('.lp-sg-list')
  ;(entries || []).forEach((e) => {
    const btn = document.createElement('button')
    btn.className = 'lp-sg-item'
    btn.innerHTML =
      '<span class="lp-sg-main"><span class="lp-sg-title"></span><span class="lp-sg-sub"></span></span>' +
      '<span class="lp-sg-arrow">↪</span>'
    btn.querySelector('.lp-sg-title').textContent = e.title || '未命名'
    btn.querySelector('.lp-sg-sub').textContent =
      [e.username, e.url].filter(Boolean).join(' · ') || '—'
    btn.addEventListener('click', async () => {
      removeSuggestBubble()
      suggestDismissed = true
      try {
        await chrome.runtime.sendMessage({ type: 'SUGGESTION_FILL', entryId: e.id })
      } catch (err) { /* 忽略 */ }
    })
    list.appendChild(btn)
  })
  attachSuggestClose(root)
  ;(document.body || document.documentElement).appendChild(root)
  // 5s 后自动收起（点击条目 / 关闭后不再重复弹）
  setTimeout(() => {
    if (document.getElementById('lp-suggest-root') === root) removeSuggestBubble()
  }, 5000)
}

function showSuggestionEmpty() {
  ensureSuggestStyle()
  removeSuggestBubble()
  const root = document.createElement('div')
  root.id = 'lp-suggest-root'
  root.innerHTML =
    '<div class="lp-sg-head"><span>LockPass 建议</span><button class="lp-sg-close" title="关闭">×</button></div>' +
    '<div class="lp-sg-empty">未找到当前网站的登录条目。<br>可点击扩展图标查看全部。</div>'
  attachSuggestClose(root)
  ;(document.body || document.documentElement).appendChild(root)
  setTimeout(() => {
    if (document.getElementById('lp-suggest-root') === root) removeSuggestBubble()
  }, 3000)
}
