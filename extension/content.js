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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'LP_FILL') return
  const { entry, password } = msg
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
