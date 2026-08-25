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

function findUsernameInput(passwordInput) {
  // 与密码框同一渲染边界（Document 或 ShadowRoot）内找用户名候选
  const root = passwordInput.getRootNode()
  let found = null
  walkRoots(root, (el) => {
    if (!(el instanceof HTMLInputElement)) return
    if (el === passwordInput) return
    if (el.disabled || el.readOnly) return
    const type = (el.type || '').toLowerCase()
    if (['password', 'hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image'].includes(type)) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return
    if (!isUsernameCandidate(el)) return
    found = el
    return false
  })
  return found
}

function findLoginForm() {
  const passwordInput = findPasswordInput()
  if (!passwordInput) return null
  const root = passwordInput.getRootNode()
  return {
    form: passwordInput.closest('form') || null,
    passwordInput,
    usernameInput: findUsernameInput(passwordInput),
  }
}

/* ── 多步登录：仅有「用户名输入框 + 提交按钮」的潜在登录表单 ── */
function findUsernameOnlyForm() {
  let usernameInput = null
  walkRoots(document, (el) => {
    if (!(el instanceof HTMLInputElement)) return
    if (el.disabled || el.readOnly) return
    const type = (el.type || '').toLowerCase()
    if (['password', 'hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image'].includes(type)) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return
    if (!isUsernameCandidate(el)) return
    usernameInput = el
    return false
  })
  if (!usernameInput) return null
  // 同一渲染边界内存在提交按钮才算潜在登录表单，避免误报搜索框等
  const root = usernameInput.getRootNode()
  let hasSubmit = false
  walkRoots(root, (el) => {
    if (el.tagName === 'BUTTON' && (!el.type || el.type === 'submit')) {
      hasSubmit = true
      return false
    }
    if (el instanceof HTMLInputElement && ['submit', 'image'].includes((el.type || '').toLowerCase())) {
      hasSubmit = true
      return false
    }
  })
  return hasSubmit
    ? { form: usernameInput.closest('form') || null, passwordInput: null, usernameInput }
    : null
}

/* ── 页面状态检测 ─────────────────────────────────── */
function detectLoginState() {
  const full = findLoginForm()
  const usernameOnly = full ? null : findUsernameOnlyForm()
  return {
    hasPassword: !!full,
    passwordInput: full && full.passwordInput,
    usernameInput: (full && full.usernameInput) || (usernameOnly && usernameOnly.usernameInput),
    form: (full && full.form) || (usernameOnly && usernameOnly.form),
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
   页面出现「密码框」或「用户名框+提交按钮」时上报后台，后台在
   「网页版页面桥 / 桌面版 HTTP 服务」任一就绪后自动取数填充。
   节流：同一域名 5 秒内只上报一次，避免 MutationObserver 高频触发。
   多步登录：第一步只填用户名并进入 waitingPassword；密码框出现时
   立即上报 LP_PASSWORD_READY（不受节流限制）请求补填密码。 */
let lastPageReadyAt = 0
const PAGE_READY_THROTTLE_MS = 5000
let lastScanAt = 0
const SCAN_THROTTLE_MS = 300 // MutationObserver 微节流：避免同帧高频变化时重复全树遍历
let waitingPassword = false // 已填用户名，等待密码框出现后补填密码

function notifyPageReady() {
  const state = detectLoginState()
  if (!state.hasPassword && !state.usernameInput) return
  const now = Date.now()
  if (now - lastPageReadyAt < PAGE_READY_THROTTLE_MS) return
  lastPageReadyAt = now
  try {
    chrome.runtime.sendMessage({
      type: 'LP_PAGE_READY',
      domain: location.hostname,
      hasPassword: state.hasPassword,
    })
  } catch (e) { /* 忽略 */ }
}

function onDomMaybeChanged() {
  const now = Date.now()
  if (now - lastScanAt < SCAN_THROTTLE_MS) return
  lastScanAt = now
  const state = detectLoginState()
  // 多步登录第二步：等待中的密码框出现 → 立即请求密码补填
  if (waitingPassword && state.hasPassword) {
    waitingPassword = false
    try {
      chrome.runtime.sendMessage({ type: 'LP_PASSWORD_READY', domain: location.hostname })
    } catch (e) { /* 忽略 */ }
    return
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
    } else {
      // 多步登录第一步：只有用户名框，填入后等待密码框
      waitingPassword = true
    }
    sendResponse({ ok: true })
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
    waitingPassword = true
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
    waitingPassword = false
    sendResponse({ ok: true })
    return
  }
})

// 启动登录表单自动检测（自动填充）
observeLoginForms()
