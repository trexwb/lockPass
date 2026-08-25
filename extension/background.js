/* LockPass 自动填充 — 后台 Service Worker
   双就绪来源：
   1) 网页版页面桥：LockPass 页面 content script（LP_READY / LP_ENTRIES / LP_PASSWORD）
   2) 桌面版本地 HTTP 服务：127.0.0.1:33555（一键配对后直连取数，token 存 storage）
   明文密码仅在「请求填充 → 转发内容脚本」的瞬时内存中出现，不落盘。 */

const LOCAL_PORT = 33555
const LOCAL_BASE = 'http://127.0.0.1:' + LOCAL_PORT
const POLL_INTERVAL_MS = 1500
const PAIR_TIMEOUT_MS = 90000
const HTTP_STATUS_POLL_MS = 15000
const STORAGE_TOKEN_KEY = 'lp_http_token'

// ── 状态 ─────────────────────────────────────────────
let pageBridgeReady = false
let cachedEntries = [] // 页面桥来源的条目（不含密码）
let passwordCache = {} // id -> password（一次性：转发后立即清除）
let pendingPassword = null // { id, resolve }：等待 LockPass 页面异步返回密码
let httpCachedEntries = [] // HTTP 来源当前站点条目（含密码，仅本会话内存）

let httpServiceAlive = false // 本地服务可达
let httpUnlocked = false // 桌面端已解锁
let httpPaired = false // 已配对（token 有效）
let httpReadyFlag = false // HTTP 通道可填充 = 可达 + 已配对 + 已解锁

let pairing = false
let pairNonce = null
let pairPollTimer = null

let autoFillPending = null // { domain, tabId }：页面就绪前收到的自动填充请求

// ── 就绪判定 ─────────────────────────────────────────
function isReady() {
  return pageBridgeReady || httpReadyFlag
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch (e) {
    return ''
  }
}

// 请求域名匹配条目域名（条目域名为请求域名的精确值或上级域）
function domainMatches(requestDomain, entryDomain) {
  const rd = (requestDomain || '').trim().toLowerCase()
  const ed = (entryDomain || '').trim().toLowerCase()
  if (!rd || !ed) return false
  return rd === ed || rd.endsWith('.' + ed)
}

// ── 本地 HTTP 服务状态检查 ───────────────────────────
async function checkHttpStatus() {
  try {
    const resp = await fetch(LOCAL_BASE + '/status', { cache: 'no-store' })
    if (!resp.ok) {
      httpServiceAlive = false
      httpReadyFlag = false
      return false
    }
    httpServiceAlive = true
    const d = await resp.json()
    httpUnlocked = !!d.unlocked

    const { [STORAGE_TOKEN_KEY]: token } = await chrome.storage.local.get(STORAGE_TOKEN_KEY)
    httpPaired = !!token
    if (httpPaired) {
      // 验证 token 仍有效：带 token 请求（domain 随意，过了鉴权即视为有效）
      try {
        const vr = await fetch(LOCAL_BASE + '/credentials?domain=invalid.localhost', {
          headers: { Authorization: 'Bearer ' + token },
          cache: 'no-store',
        })
        if (vr.status === 401) {
          httpPaired = false
          await chrome.storage.local.remove(STORAGE_TOKEN_KEY)
        }
      } catch (e) {
        httpPaired = false
      }
    }
    httpReadyFlag = httpServiceAlive && httpPaired && httpUnlocked
    return true
  } catch (e) {
    httpServiceAlive = false
    httpReadyFlag = false
    return false
  }
}

// ── 一键配对 ─────────────────────────────────────────
async function startPairing() {
  if (pairing) return { ok: true, nonce: pairNonce }
  pairing = true
  pairNonce = null
  try {
    const resp = await fetch(LOCAL_BASE + '/pair', { method: 'POST', cache: 'no-store' })
    if (!resp.ok) {
      pairing = false
      return { ok: false, error: '无法连接桌面版 LockPass 本地服务' }
    }
    const data = await resp.json()
    pairNonce = data.nonce
    clearTimeout(pairPollTimer)

    const deadline = Date.now() + PAIR_TIMEOUT_MS
    const poll = async () => {
      if (!pairing) return
      if (Date.now() > deadline) {
        pairing = false
        pairNonce = null
        return
      }
      try {
        const r = await fetch(LOCAL_BASE + '/pair/poll?nonce=' + encodeURIComponent(pairNonce), { cache: 'no-store' })
        if (r.ok) {
          const d = await r.json()
          if (d.status === 'confirmed') {
            await chrome.storage.local.set({ [STORAGE_TOKEN_KEY]: d.token })
            pairing = false
            pairNonce = null
            await checkHttpStatus()
            maybeAutoFill()
            return
          }
        } else if (r.status === 404 || r.status === 410) {
          pairing = false
          pairNonce = null
          return
        }
      } catch (e) { /* 服务暂不可达，继续轮询 */ }
      pairPollTimer = setTimeout(poll, POLL_INTERVAL_MS)
    }
    poll()
    return { ok: true, nonce: pairNonce }
  } catch (e) {
    pairing = false
    return { ok: false, error: '无法连接桌面版 LockPass 本地服务' }
  }
}

// ── 取凭据（HTTP 通道） ──────────────────────────────
async function fetchCredentials(domain) {
  if (!httpReadyFlag) return null
  const { [STORAGE_TOKEN_KEY]: token } = await chrome.storage.local.get(STORAGE_TOKEN_KEY)
  if (!token) return null
  try {
    const resp = await fetch(LOCAL_BASE + '/credentials?domain=' + encodeURIComponent(domain), {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store',
    })
    if (!resp.ok) {
      if (resp.status === 401) {
        httpPaired = false
        httpReadyFlag = false
        await chrome.storage.local.remove(STORAGE_TOKEN_KEY)
      }
      return null
    }
    return await resp.json()
  } catch (e) {
    return null
  }
}

// ── 自动填充 ─────────────────────────────────────────
async function sendFill(tabId, entry, password) {
  if (!tabId || password === undefined || password === null) return { ok: false, error: '密码数据无效' }
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'LP_FILL', entry, password })
    return resp || { ok: true }
  } catch (e) {
    return { ok: false, error: 'page not ready: ' + (e.message || e) }
  }
}

async function autoFill(domain, tabId) {
  if (httpReadyFlag) {
    const entries = await fetchCredentials(domain)
    if (entries && entries.length) {
      await sendFill(tabId, entries[0], entries[0].password)
    }
    return
  }
  if (pageBridgeReady) {
    await refreshEntries()
    const entry = cachedEntries.find((e) => domainMatches(domain, extractDomain(e.url)))
    if (entry) {
      const pwd = await requestPassword(entry.id)
      if (pwd.ok) {
        await sendFill(tabId, entry, pwd.password)
      }
    }
  }
}

function maybeAutoFill() {
  if (!autoFillPending) return
  const p = autoFillPending
  autoFillPending = null
  autoFill(p.domain, p.tabId)
}

// ── 页面桥通道（网页版兼容，原逻辑保留） ─────────────
async function refreshEntries() {
  if (!pageBridgeReady) return
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
  if (passwordCache[entryId] !== undefined) {
    return { ok: true, password: passwordCache[entryId] }
  }
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id) continue
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'LP_GET_PASSWORD', id: entryId })
      if (resp && resp.ok) {
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

async function fillCurrentTab(entryId) {
  const entry = cachedEntries.find((e) => e.id === entryId)
  if (!entry) return { ok: false, error: 'entry not found' }

  const pwd = await requestPassword(entryId)
  if (!pwd.ok) return pwd
  const password = pwd.password
  if (password === undefined || password === null) {
    return { ok: false, error: '未获取到密码（条目可能无密码字段）' }
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id || !/^https?:|^file:/.test(tab.url || '')) {
    return { ok: false, error: 'no active web page' }
  }

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

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs && tabs[0] ? tabs[0] : null
}

// ── 消息路由 ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'LP_READY':
      pageBridgeReady = true
      cachedEntries = []
      passwordCache = {}
      checkHttpStatus().then(maybeAutoFill)
      sendResponse({ ok: true })
      break

    case 'LP_LOCKED':
      pageBridgeReady = false
      cachedEntries = []
      passwordCache = {}
      sendResponse({ ok: true })
      break

    case 'LP_ENTRIES':
      cachedEntries = msg.entries || []
      sendResponse({ ok: true })
      break

    case 'LP_PASSWORD':
      passwordCache[msg.id] = msg.password
      if (pendingPassword && pendingPassword.id === msg.id) {
        pendingPassword.resolve({ ok: true, password: msg.password })
        pendingPassword = null
      }
      sendResponse({ ok: true })
      break

    // 网页发现登录表单 → 就绪后自动填充
    case 'LP_PAGE_READY': {
      const tabId = sender.tab && sender.tab.id
      checkHttpStatus().then(() => {
        if (isReady()) {
          autoFill(msg.domain || extractDomain(sender.tab && sender.tab.url), tabId)
        } else {
          autoFillPending = { domain: msg.domain || extractDomain(sender.tab && sender.tab.url), tabId }
        }
      })
      sendResponse({ ok: true })
      break
    }

    // popup 查询状态
    case 'POPUP_GET_STATE': {
      checkHttpStatus().then(async (alive) => {
        let source = null
        let entries = []
        if (httpReadyFlag) {
          source = 'http'
          const tab = await activeTab()
          const domain = tab ? extractDomain(tab.url || '') : ''
          const list = await fetchCredentials(domain)
          entries = list || []
          httpCachedEntries = entries
        } else if (pageBridgeReady) {
          source = 'bridge'
          await refreshEntries()
          entries = cachedEntries
        }
        sendResponse({
          ready: isReady(),
          source,
          entries,
          pageBridgeReady,
          serviceAlive: alive,
          httpUnlocked,
          httpPaired,
          pairing,
          pairNonce,
        })
      })
      return true // 异步响应
    }

    // popup 请求一键配对
    case 'POPUP_PAIR': {
      startPairing().then(sendResponse)
      return true // 异步响应
    }

    // popup 请求填充
    case 'POPUP_FILL': {
      const { entryId } = msg
      if (httpReadyFlag) {
        const entry = httpCachedEntries.find((e) => e.id === entryId)
        if (!entry) {
          sendResponse({ ok: false, error: 'entry not found' })
          break
        }
        activeTab().then((tab) => {
          if (!tab || !tab.id) {
            sendResponse({ ok: false, error: 'no active web page' })
            return
          }
          sendFill(tab.id, entry, entry.password).then(sendResponse)
        })
      } else {
        fillCurrentTab(entryId).then(sendResponse)
      }
      return true // 异步响应
    }

    default:
      sendResponse({ ok: false, error: 'unknown type' })
  }
})

// 活跃期间周期性刷新 HTTP 状态，及时感知桌面端解锁/锁定
setInterval(() => {
  checkHttpStatus().then((alive) => {
    if (alive && httpReadyFlag) maybeAutoFill()
  })
}, HTTP_STATUS_POLL_MS)
