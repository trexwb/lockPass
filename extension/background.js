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

let autoFillPending = null // { domain, tabId, frameId, hasPassword }：页面就绪前收到的自动填充请求
let pendingCredential = null // { tabId, domain, entry, password, at }：多步登录第一步缓存，密码框出现后补填
let lastFormFrame = null // { tabId, frameId, at }：最近上报登录表单的 frame，建议点击填充优先定位
let lastSuggestCreds = null // { tabId, domain, entries, at }：最近一次建议条目缓存（含密码，仅内存），点击时避免重复取数

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

// ── 多字段填充（upgrade-design.md §2.2） ─────────────
// key 语义名：username/password/email/phone/otp/url（url 为自定义字段类型扩展项）
// 条目数据来源：username←条目 username；password←条目 password；
// email←自定义字段 type=email；phone←type=phone；otp←type=otp；url←type=url。
// 发送前仍做密码剥离：LP_MULTI_FILL 仅在 background → content 瞬时内存中携带明文。
const MULTI_FILL_KEYS = ['username', 'password', 'email', 'phone', 'otp', 'url']

function pickCustomFieldValue(entry, type) {
  const cf = ((entry && entry.customFields) || []).find((c) => c && c.type === type)
  const v = cf ? cf.value : ''
  return v === undefined || v === null ? '' : String(v)
}

// 按字段集合构造 LP_MULTI_FILL 字段数组（保持 用户名→密码→邮箱/手机→验证码 顺序），
// 条目无对应值（空字符串）的字段自动剔除
function buildFields(entry, password, keys) {
  const want = Array.isArray(keys) && keys.length ? keys : MULTI_FILL_KEYS
  const fields = []
  for (const key of MULTI_FILL_KEYS) {
    if (!want.includes(key)) continue
    let value = ''
    if (key === 'username') value = entry && entry.username
    else if (key === 'password') value = password
    else if (key === 'email') value = (entry && entry.email) || pickCustomFieldValue(entry, 'email')
    else if (key === 'phone') value = pickCustomFieldValue(entry, 'phone')
    else if (key === 'otp') value = pickCustomFieldValue(entry, 'otp')
    else if (key === 'url') value = pickCustomFieldValue(entry, 'url')
    if (value !== undefined && value !== null && value !== '') fields.push({ key, value: String(value) })
  }
  return fields
}

async function sendMultiFill(tabId, fields, frameId) {
  if (!tabId || !fields || !fields.length) return { ok: false, error: '无可填充字段' }
  try {
    // 显式指定 frameId（默认顶层 0），避免 all_frames 下向所有 frame 广播导致重复填充
    const opts = { frameId: typeof frameId === 'number' ? frameId : 0 }
    const resp = await chrome.tabs.sendMessage(
      tabId,
      { type: 'LP_MULTI_FILL', frameId: opts.frameId, fields },
      opts
    )
    return resp || { ok: true }
  } catch (e) {
    return { ok: false, error: 'page not ready: ' + (e.message || e) }
  }
}

// 多字段自动填充（upgrade-design.md §2.2/§2.3）：
// 按页面能力位 availableFields 构造字段集并填充；若页面还有未出现字段
// （多步登录），把整套字段数据缓存进 pendingCredential（120s 有效期），
// 后续 LP_FIELDS_READY 上报新字段出现时补填剩余字段。
async function autoFill(domain, tabId, frameId, hasPassword, availableFields) {
  const entryForDomain = (list) => (list && list.length ? list[0] : null)
  const keys = Array.isArray(availableFields) && availableFields.length
    ? availableFields
    : hasPassword ? MULTI_FILL_KEYS : ['username']
  if (httpReadyFlag) {
    let entries = await fetchCredentials(domain)
    if ((!entries || !entries.length) && tabId) {
      // iframe 内条目可能挂在主页面域名下：取不到时回退尝试顶层 tab 域名
      try {
        const tab = await chrome.tabs.get(tabId)
        const topDomain = extractDomain(tab.url || '')
        if (topDomain && topDomain !== domain) {
          entries = await fetchCredentials(topDomain)
        }
      } catch (e) { /* 忽略 */ }
    }
    const entry = entryForDomain(entries)
    if (entry) {
      lastSuggestCreds = { tabId, domain, entries, at: Date.now() }
      const allFields = buildFields(entry, entry.password, MULTI_FILL_KEYS)
      const sendFields = allFields.filter((f) => keys.includes(f.key))
      if (sendFields.length) await sendMultiFill(tabId, sendFields, frameId)
      // 多步：页面能力位中仍有未发送字段（如密码框尚未出现）→ 缓存整套字段数据等待补填
      if (keys.some((k) => !sendFields.some((f) => f.key === k))) {
        pendingCredential = { tabId, domain, fields: allFields, at: Date.now() }
      }
    }
    // 命中/未命中都弹建议气泡（页面有登录表单的前提下）
    await sendSuggestions(tabId, entry ? entries : null)
    return
  }
  if (pageBridgeReady) {
    await refreshEntries()
    const entry = cachedEntries.find((e) => domainMatches(domain, extractDomain(e.url)))
    if (entry) {
      const pwd = await requestPassword(entry.id)
      if (pwd.ok) {
        const allFields = buildFields(entry, pwd.password, MULTI_FILL_KEYS)
        const sendFields = allFields.filter((f) => keys.includes(f.key))
        if (sendFields.length) await sendMultiFill(tabId, sendFields, frameId)
        if (keys.some((k) => !sendFields.some((f) => f.key === k))) {
          pendingCredential = { tabId, domain, fields: allFields, at: Date.now() }
        }
        await sendSuggestions(tabId, [entry])
        return
      }
    }
    await sendSuggestions(tabId, null)
  }
}

function maybeAutoFill() {
  if (!autoFillPending) return
  const p = autoFillPending
  autoFillPending = null
  autoFill(p.domain, p.tabId, p.frameId, p.hasPassword, p.fields)
}

// ── 自动弹出建议（按 URL 域名预筛选推荐条目） ────────
// 向顶层 frame 发送建议列表（剥离密码字段，密码仅在后台内存中），并叠加徽标数字提示
function safeSuggestEntries(entries) {
  return (entries || []).map(({ password, ...rest }) => rest)
}

async function sendSuggestions(tabId, entries) {
  if (!tabId) return
  const has = !!(entries && entries.length)
  try {
    await chrome.tabs.sendMessage(
      tabId,
      { type: 'LP_SHOW_SUGGESTIONS', entries: has ? safeSuggestEntries(entries) : [], empty: !has },
      { frameId: 0 }
    )
  } catch (e) { /* 页面不可达/未注入，忽略 */ }
  // 徽标提示（action 原生能力，无需新增权限）：命中数 30s 后自动清除，避免残留
  try {
    chrome.action.setBadgeText({ tabId, text: has ? String(entries.length) : '' })
    if (has) {
      setTimeout(() => {
        try { chrome.action.setBadgeText({ tabId, text: '' }) } catch (e) { /* 忽略 */ }
      }, 30000)
    }
  } catch (e) { /* 忽略 */ }
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
    }, { frameId: 0 })
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
    // fields 为页面能力位（username/password/email/phone/otp/url），后台据此构造多字段填充
    case 'LP_PAGE_READY': {
      const tabId = sender.tab && sender.tab.id
      const frameId = sender.frameId
      const domain = msg.domain || extractDomain(sender.tab && sender.tab.url)
      const hasPassword = !!msg.hasPassword
      // 记录最近上报登录表单的 frame，供建议点击/后续填充定位
      lastFormFrame = { tabId, frameId, at: Date.now() }
      checkHttpStatus().then(() => {
        if (isReady()) {
          autoFill(domain, tabId, frameId, hasPassword, msg.fields)
        } else {
          autoFillPending = { domain, tabId, frameId, hasPassword, fields: msg.fields }
        }
      })
      sendResponse({ ok: true })
      break
    }

    // 多步状态机（upgrade-design.md §2.3）：新字段出现后补填剩余字段
    case 'LP_FIELDS_READY': {
      const tabId = sender.tab && sender.tab.id
      const frameId = sender.frameId
      const domain = msg.domain || extractDomain(sender.tab && sender.tab.url)
      lastFormFrame = { tabId, frameId, at: Date.now() }
      const want = Array.isArray(msg.fields) && msg.fields.length ? msg.fields : MULTI_FILL_KEYS
      const pc = pendingCredential
      const fresh = pc && Date.now() - pc.at < 120000 // 120s 有效，过期丢弃
      if (pc && fresh && pc.tabId === tabId && pc.domain === domain) {
        const toSend = (pc.fields || []).filter((f) => want.includes(f.key))
        // 条目可提供的字段已全部填充（或无值可填）→ 结束等待
        const sendable = want.filter((k) => (pc.fields || []).some((f) => f.key === k))
        if (sendable.every((k) => toSend.some((f) => f.key === k))) pendingCredential = null
        sendMultiFill(tabId, toSend, frameId).then(sendResponse)
      } else {
        // 缓存缺失/过期（如用户隔了很久才到下一步）→ 走常规自动填充兜底
        pendingCredential = null
        checkHttpStatus().then(() => {
          if (isReady()) autoFill(domain, tabId, frameId, want.includes('password'), want)
        })
        sendResponse({ ok: true })
      }
      break
    }

    // 多步登录第二步（兼容旧路径）：密码框出现后，用缓存的字段数据补填密码
    case 'LP_PASSWORD_READY': {
      const tabId = sender.tab && sender.tab.id
      const frameId = sender.frameId
      const domain = msg.domain || extractDomain(sender.tab && sender.tab.url)
      // 密码框 frame 通常即登录表单所在 frame，优先记录，供建议点击定位
      lastFormFrame = { tabId, frameId, at: Date.now() }
      const pc = pendingCredential
      const fresh = pc && Date.now() - pc.at < 120000 // 120s 有效，过期丢弃
      if (pc && fresh && pc.tabId === tabId && pc.domain === domain) {
        const toSend = (pc.fields || []).filter((f) => f.key === 'password')
        if (toSend.length) pendingCredential = null
        sendMultiFill(tabId, toSend, frameId).then(sendResponse)
      } else {
        // 缓存缺失/过期（如用户隔了很久才到第二步）→ 走常规自动填充兜底
        pendingCredential = null
        checkHttpStatus().then(() => {
          if (isReady()) autoFill(domain, tabId, frameId, true, ['password'])
        })
        sendResponse({ ok: true })
      }
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

    // 点击自动弹出建议条目 → 按缓存/当前域名取数并一键填充
    case 'SUGGESTION_FILL': {
      const { entryId } = msg
      const tabId = sender.tab && sender.tab.id
      if (!tabId) {
        sendResponse({ ok: false, error: 'no tab' })
        break
      }
      // 定位填充 frame：优先最近上报登录表单的 frame，其次顶层
      let frameId = 0
      if (lastFormFrame && lastFormFrame.tabId === tabId && Date.now() - lastFormFrame.at < 300000) {
        frameId = lastFormFrame.frameId
      }
      const cacheFresh = lastSuggestCreds && lastSuggestCreds.tabId === tabId && Date.now() - lastSuggestCreds.at < 60000
      const finish = (entry, password) => {
        if (!entry) {
          sendResponse({ ok: false, error: 'entry not found' })
          return
        }
        const domain = (lastSuggestCreds && lastSuggestCreds.domain) || ''
        const allFields = buildFields(entry, password, MULTI_FILL_KEYS)
        if (!allFields.length) {
          sendResponse({ ok: false, error: 'no fillable values' })
          return
        }
        sendMultiFill(tabId, allFields, frameId).then((r) => {
          const filled = !!(r && r.ok && r.filled && r.filled.length)
          // 多步登录：页面可能只有部分字段 → 缓存整套字段数据，新字段出现后由 LP_FIELDS_READY 补填
          if (filled) {
            pendingCredential = { tabId, domain, fields: allFields, at: Date.now() }
          }
          sendResponse({ ok: true, filled, frameId })
          try { chrome.action.setBadgeText({ tabId, text: '' }) } catch (e) { /* 忽略 */ }
        })
      }
      if (cacheFresh) {
        const target = (lastSuggestCreds.entries || []).find((e) => e.id === entryId)
        finish(target, target && target.password)
        return true // 异步响应
      }
      // 缓存过期/缺失 → 按当前 tab 域名重新取数（兼容双通道）
      checkHttpStatus().then(async () => {
        if (httpReadyFlag) {
          let tab = null
          try { tab = await chrome.tabs.get(tabId) } catch (e) { /* 忽略 */ }
          const domain = extractDomain((tab && tab.url) || '')
          const entries = domain ? await fetchCredentials(domain) : []
          const target = (entries || []).find((e) => e.id === entryId)
          if (target) lastSuggestCreds = { tabId, domain, entries, at: Date.now() }
          finish(target, target && target.password)
        } else if (pageBridgeReady) {
          await refreshEntries()
          const target = cachedEntries.find((e) => e.id === entryId)
          if (target) {
            const pwd = await requestPassword(target.id)
            finish(target, pwd.ok ? pwd.password : null)
          } else {
            finish(null)
          }
        } else {
          finish(null)
        }
      })
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
          const fields = buildFields(entry, entry.password, MULTI_FILL_KEYS)
          sendMultiFill(tab.id, fields, 0).then(sendResponse)
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
