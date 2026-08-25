/* LockPass 自动填充 — 后台 Service Worker
   职责：解锁状态中心 + 消息路由（LockPass 页面 ↔ popup ↔ 当前网页）
   明文密码仅在「请求填充 → 转发内容脚本」的瞬时内存中出现，不落盘。 */
let lockpassReady = false
let cachedEntries = []
let passwordCache = {} // id -> password（一次性：转发后立即清除）

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
  let password = passwordCache[entryId]
  if (password === undefined) {
    const pwd = await requestPassword(entryId)
    if (!pwd.ok) return pwd
    password = pwd.password
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
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id) continue
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'LP_GET_PASSWORD', id: entryId })
      if (resp && resp.ok) return { ok: true, password: passwordCache[entryId] }
    } catch (e) { /* 非 LockPass 页面无此监听，跳过 */ }
  }
  return { ok: false, error: 'LockPass 未解锁或页面未打开' }
}
