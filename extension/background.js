/* LockPass 自动填充 — 后台 Service Worker
   职责：解锁状态中心 + 消息路由（LockPass 页面 ↔ popup ↔ 当前网页）
   明文密码仅在「请求填充 → 转发内容脚本」的瞬时内存中出现，不落盘。 */
let lockpassReady = false
let cachedEntries = []
let passwordCache = {} // id -> password（一次性：转发后立即清除）
let pendingPassword = null // { id, resolve }：等待 LockPass 页面异步返回密码

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'LP_READY':
      lockpassReady = true
      cachedEntries = []
      passwordCache = {}
      sendResponse({ ok: true })
      break

    case 'LP_LOCKED':
      lockpassReady = false
      cachedEntries = []
      passwordCache = {}
      sendResponse({ ok: true })
      break

    // LockPass 页面 content script 上报条目列表
    case 'LP_ENTRIES':
      cachedEntries = msg.entries || []
      sendResponse({ ok: true })
      break

    // LockPass 页面 content script 上报解密结果（来自用户主应用的会话内存）
    case 'LP_PASSWORD':
      passwordCache[msg.id] = msg.password
      if (pendingPassword && pendingPassword.id === msg.id) {
        pendingPassword.resolve({ ok: true, password: msg.password })
        pendingPassword = null
      }
      sendResponse({ ok: true })
      break

    // popup 查询状态：先向 LockPass 页面拉取最新列表（解锁态下实时刷新）
    case 'POPUP_GET_STATE': {
      refreshEntries().then(() => {
        sendResponse({ ready: lockpassReady, entries: cachedEntries })
      })
      return true // 异步响应
    }

    // popup 请求填充：从 LockPass 取密码 → 转发给当前活动标签页的内容脚本
    case 'POPUP_FILL': {
      const { entryId } = msg
      fillCurrentTab(entryId).then(sendResponse)
      return true // 异步响应
    }

    default:
      sendResponse({ ok: false, error: 'unknown type' })
  }
})

async function fillCurrentTab(entryId) {
  const entry = cachedEntries.find((e) => e.id === entryId)
  if (!entry) return { ok: false, error: 'entry not found' }

  // 1) 向 LockPass 页面请求解密该条目（主密码仍在主应用内存，扩展不接触）
  const pwd = await requestPassword(entryId)
  if (!pwd.ok) return pwd
  const password = pwd.password
  if (password === undefined || password === null) {
    return { ok: false, error: '未获取到密码（条目可能无密码字段）' }
  }

  // 2) 找到当前活动标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id || !/^https?:|^file:/.test(tab.url || '')) {
    return { ok: false, error: 'no active web page' }
  }

  // 3) 转发填充（一次性使用后清除缓存）
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: 'LP_FILL',
      entry,
      password,
    })
    delete passwordCache[entryId]
    return resp || { ok: true }
  } catch (e) {
    delete passwordCache[entryId]
    return { ok: false, error: 'page not ready: ' + (e.message || e) }
  }
}

// 向 LockPass 页面请求最新条目列表（解锁态下才有响应）
async function refreshEntries() {
  if (!lockpassReady) return
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id) continue
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'LP_GET_ENTRIES' })
      if (resp && resp.ok) return
    } catch (e) { /* 非 LockPass 页面无此监听，跳过 */ }
  }
}

async function requestPassword(entryId) {
  // 缓存命中（同一次填充流程内重复请求）
  if (passwordCache[entryId] !== undefined) {
    return { ok: true, password: passwordCache[entryId] }
  }
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id) continue
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'LP_GET_PASSWORD', id: entryId })
      if (resp && resp.ok) {
        // bridge 只确认「已转发」；密码经页面 postMessage → LP_PASSWORD 异步返回。
        // 必须等 pendingPassword 被 resolve，否则拿到 undefined 填入表单。
        return await new Promise((resolve) => {
          const timer = setTimeout(() => {
            pendingPassword = null
            resolve({ ok: false, error: 'LockPass 页面响应超时，请确认已解锁' })
          }, 5000)
          pendingPassword = {
            id: entryId,
            resolve: (r) => {
              clearTimeout(timer)
              resolve(r)
            },
          }
        })
      }
    } catch (e) { /* 非 LockPass 页面无此监听，跳过 */ }
  }
  return { ok: false, error: 'LockPass 未解锁或页面未打开' }
}
