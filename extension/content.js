/* LockPass 自动填充 — 通用内容脚本（所有网页）
   职责：识别登录表单、填充凭据。
   安全：不自动提交表单（仅填充 + 高亮提交按钮，用户确认后自行提交）。 */
const USERNAME_SELECTORS = [
  'input[type="text"]',
  'input[type="email"]',
  'input[type="tel"]',
  'input:not([type])',
  'input[name*="user" i]',
  'input[name*="email" i]',
  'input[name*="login" i]',
  'input[name*="account" i]',
  'input[id*="user" i]',
  'input[id*="email" i]',
  'input[id*="login" i]',
  'input[autocomplete="username"]',
]

function findPasswordInput(root) {
  return root.querySelector('input[type="password"]')
}

function findUsernameInput(form, passwordInput) {
  const candidates = form ? form.querySelectorAll(USERNAME_SELECTORS.join(',')) : []
  for (const el of candidates) {
    if (el === passwordInput) continue
    if (el.disabled || el.readOnly) continue
    // 可见性过滤：登录表单的用户名字段应在视口内
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    return el
  }
  return null
}

function findLoginForm() {
  const passInput = document.querySelector('input[type="password"]')
  if (!passInput) return null
  // 优先用密码框所在的 form；无 form 时用密码框本身作为容器
  const form = passInput.closest('form') || document
  return { form, passwordInput: passInput, usernameInput: findUsernameInput(form, passInput) }
}

function setNativeValue(el, value) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

function highlightSubmit(form) {
  const btn =
    (form && form.querySelector('button[type="submit"], input[type="submit"], button:not([type])')) ||
    null
  if (!btn) return
  const prev = btn.style.outline
  btn.style.outline = '2px solid #58a6ff'
  btn.style.outlineOffset = '2px'
  setTimeout(() => {
    btn.style.outline = prev
  }, 2400)
}

/* ── 登录表单自动检测（自动填充入口） ──────────────
   页面出现密码输入框时上报后台（携带域名），后台在
   「网页版页面桥 / 桌面版 HTTP 服务」任一就绪后自动取数填充。
   节流：同一域名 5 秒内只上报一次，避免 MutationObserver 高频触发。 */
let lastPageReadyAt = 0
const PAGE_READY_THROTTLE_MS = 5000

function notifyPageReady() {
  const now = Date.now()
  if (now - lastPageReadyAt < PAGE_READY_THROTTLE_MS) return
  if (!document.querySelector('input[type="password"]')) return
  lastPageReadyAt = now
  try {
    chrome.runtime.sendMessage({ type: 'LP_PAGE_READY', domain: location.hostname })
  } catch (e) { /* 忽略 */ }
}

function observeLoginForms() {
  notifyPageReady()
  const mo = new MutationObserver(() => notifyPageReady())
  try {
    mo.observe(document.documentElement, { childList: true, subtree: true })
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'LP_FILL') return
  const { entry, password } = msg
  // 防御：密码缺失时拒绝填充，避免表单被写入 "undefined" 之类的脏值
  if (password === undefined || password === null || password === 'undefined') {
    sendResponse({ ok: false, error: '密码数据无效，请重试' })
    return
  }
  const target = findLoginForm()
  if (!target) {
    sendResponse({ ok: false, error: '当前页面未找到登录表单（缺少密码输入框）' })
    return
  }
  if (target.usernameInput && entry.username) {
    setNativeValue(target.usernameInput, entry.username)
  }
  setNativeValue(target.passwordInput, password)
  highlightSubmit(target.form)
  sendResponse({ ok: true })
})

// 启动登录表单自动检测（自动填充）
observeLoginForms()
