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
  for (const tabId of appBridgeTabIds()) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'LP_GET_ENTRIES' })
      if (resp && resp.ok) return
    } catch (e) {
      appBridgeTabs.delete(tabId) // 页面桥已卸载或刷新，回收登记
    }
  }
}

async function requestPassword(entryId) {
  if (passwordCache[entryId] !== undefined) {
    return { ok: true, password: passwordCache[entryId] }
  }
  for (const tabId of appBridgeTabIds()) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'LP_GET_PASSWORD', id: entryId })
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
    } catch (e) {
      appBridgeTabs.delete(tabId) // 页面桥已卸载或刷新，回收登记
    }
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

// ── 自动捕获（v1.1.4） ─────────────────────────────
// 登录 submit 凭据按 tab 暂存（仅 Service Worker 内存，15s TTL，不落盘）；
// 新页面加载时内容脚本 LP_CAPTURE_CHECK 判定「已跳转或密码框消失」→ 弹保存浮层；
// LP_CAPTURE_SAVE 经 LockPass 页面桥（lockpass-bridge → 页面 ExtBridge）入库，等待 capture-result。
const CAPTURE_TTL_MS = 15000
// 已下发浮层的凭据：浮层可停留 20s 才自动收起，用户也可能在第 15–20s 之间才点「保存」，
// 若沿用 CAPTURE_TTL_MS（15s）判定，等待中的点击会被必然判为过期，故独立放宽
const CAPTURE_ISSUED_TTL_MS = 90000
const CAPTURE_RESULT_TIMEOUT_MS = 8000
const capturePending = new Map() // tabId -> { payload, at }
const captureIssued = new Map() // tabId -> { payload, at }：已弹过浮层的凭据，SAVE 时以此为准
const captureWaiters = new Map() // requestId -> { resolve, timer }：每次保存独立等待，互不覆盖
let captureReqSeq = 0

// MV3 Service Worker 空闲约 30s 被回收，capturePending / captureIssued 内存 Map 随之清零，
// 用户看到的浮层还在，但点「保存」时 captureIssued 为空 → 判 expired → 显示「保存失败」。
// chrome.storage.session 跨 SW 重启存活（浏览器关闭自动清除），作为持久化后备。
// 只写不读：正常路径走内存（同步、快），SW 重启后的首次 LP_CAPTURE_CHECK / LP_CAPTURE_SAVE
// 才从 session 恢复到内存 Map。
const SESSION_PENDING_KEY = 'lp_capture_pending'
const SESSION_ISSUED_KEY = 'lp_capture_issued'

function sessionSave(key, map) {
  try {
    const obj = {}
    for (const [k, v] of map) obj[k] = v
    chrome.storage.session.set({ [key]: obj }).catch(() => {})
  } catch (e) { /* session storage 不可用时降级纯内存 */ }
}

function sessionRemove(key, tabIdStr) {
  try {
    chrome.storage.session.get(key, (items) => {
      const obj = items && items[key]
      if (obj && obj[tabIdStr]) {
        delete obj[tabIdStr]
        chrome.storage.session.set({ [key]: obj }).catch(() => {})
      }
    })
  } catch (e) { /* 忽略 */ }
}

/** 从 chrome.storage.session 恢复到内存 Map（SW 重启后首次调用） */
async function sessionRestore(key, map) {
  try {
    const items = await chrome.storage.session.get(key)
    const obj = items && items[key]
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) map.set(Number(k) || k, v)
    }
  } catch (e) { /* 忽略 */ }
}

/** 唤醒（并移除）指定 requestId 的保存结果等待；重复调用无副作用 */
function settleCaptureWaiter(requestId, result) {
  const w = captureWaiters.get(requestId)
  if (!w) return
  clearTimeout(w.timer)
  captureWaiters.delete(requestId)
  w.resolve(result)
}

function captureRemember(tabId, payload) {
  capturePending.set(tabId, { payload, at: Date.now() })
  sessionSave(SESSION_PENDING_KEY, capturePending)
  setTimeout(() => {
    const cur = capturePending.get(tabId)
    if (cur && cur.payload === payload) {
      capturePending.delete(tabId)
      sessionRemove(SESSION_PENDING_KEY, String(tabId))
    }
  }, CAPTURE_TTL_MS)
}

/* ── LockPass 应用页面白名单 ──────────────────────────
   凡是「扩展主动送数据给页面」的请求（捕获转发 / 取条目 / 取密码）都只投递给
   appBridgeTabs 里握手过的 tab。曾按 chrome.tabs.query({}) 全量广播：
   桥脚本被注入到所有 file:// 页面，任意本地 HTML 自报 ready 即可抢答 forwarded:true，
   从而收到别的站点登录时用户点保存的明文密码（还能反向污染 passwordCache）。
   file:// 页面在浏览器侧无法彼此区分（同为 file:// origin），因此默认整体拒绝，
   仅当用户在扩展弹窗显式勾选「信任本地页面」后放行，且限定 index.html。 */
const TRUST_FILE_PAGES_KEY = 'lp_trust_file_app_pages'
let trustFileAppPages = false
chrome.storage.local.get(TRUST_FILE_PAGES_KEY).then((r) => {
  trustFileAppPages = !!r[TRUST_FILE_PAGES_KEY]
}).catch(() => {})

/** sender.url 由浏览器注入，页面脚本无法伪造，作为唯一可信判据 */
function isTrustedAppPageUrl(url) {
  if (!url) return false
  if (url.startsWith('file://')) return trustFileAppPages && url.endsWith('/index.html')
  let u
  try { u = new URL(url) } catch (e) { return false }
  if (u.hostname === 'trexwb.github.io') return u.pathname.startsWith('/lockPass/')
  return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '1420'
}

const appBridgeTabs = new Map() // tabId -> { url, at }：可信 LockPass 页面桥所在 tab
let fileAppPageSeen = false // 本次会话出现过 file:// 的 LockPass 页面（弹窗据此显示信任开关）

function registerAppBridgeTab(sender) {
  const tabId = sender.tab && sender.tab.id
  if (!tabId || !isTrustedAppPageUrl(sender.url)) return false
  appBridgeTabs.set(tabId, { url: sender.url, at: Date.now() })
  return true
}

function unregisterAppBridgeTab(sender) {
  const tabId = sender.tab && sender.tab.id
  if (tabId) appBridgeTabs.delete(tabId)
}

chrome.tabs.onRemoved.addListener((tabId) => {
  appBridgeTabs.delete(tabId)
  capturePending.delete(tabId)
  captureIssued.delete(tabId)
  sessionRemove(SESSION_PENDING_KEY, String(tabId))
  sessionRemove(SESSION_ISSUED_KEY, String(tabId))
})

/** 最近握手的 LockPass 页面优先接收数据 */
function appBridgeTabIds() {
  return [...appBridgeTabs.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .map(([tabId]) => tabId)
}

async function forwardCaptureToLockPassPage(payload, requestId) {
  for (const tabId of appBridgeTabIds()) {
    // MV3 里 appBridgeTabs 是内存态：tab 已关闭但 onRemoved 尚未回收（或 SW 重启后残留旧握手的
    // 极端竞态）时，直接 chrome.tabs.sendMessage 会 reject "No tab with id"。先校验存活，
    // 不存活则跳过并清理登记，避免向失效 tab 发消息触发未捕获异常。
    let alive = false
    try { alive = !!(await chrome.tabs.get(tabId)) } catch (e) { alive = false }
    if (!alive) { appBridgeTabs.delete(tabId); continue }
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'LP_CAPTURE_FORWARD', payload, requestId })
      if (r && r.forwarded) return true
    } catch (e) {
      appBridgeTabs.delete(tabId) // 页面桥已卸载或刷新，回收登记
    }
  }
  return false
}

/* 桌面版捕获入库（v1.1.2 未闭环项补齐）：LockPass 跑在 Tauri 窗口里没有页面桥，
   改走本地 HTTP 通道 —— POST /capture 交给桌面端确认（用户必须在桌面窗口点「保存」才入库），
   再轮询 /capture/status 拿结果回浮层。等待上限 185s：需覆盖「浏览器提交 → 切到桌面确认」的
   跨应用耗时，且须 ≥ Rust 侧槽位 TTL(180s)，否则后台会先于槽位过期而误报超时，
   用户其实已保存却收不到成功回执。 */
const CAPTURE_DESKTOP_TIMEOUT_MS = 185000
const CAPTURE_DESKTOP_POLL_MS = 700
// MV3 后台 30s 空闲即回收，而轮询里的 fetch 不算扩展事件（在途的 sendResponse 也不保证续命）：
// 等待期间每 20s 真走一次扩展 API 把空闲计时器顶回去，否则后台被杀后浮层永远收不到结果
const CAPTURE_SW_KEEPALIVE_MS = 20000

async function captureViaLocalServer(payload) {
  await checkHttpStatus() // 感知桌面端刚解锁/刚锁定
  if (!httpReadyFlag) return { ok: false, error: 'no-lockpass' }
  const { [STORAGE_TOKEN_KEY]: token } = await chrome.storage.local.get(STORAGE_TOKEN_KEY)
  if (!token) return { ok: false, error: 'no-lockpass' }
  let posted
  try {
    posted = await fetch(LOCAL_BASE + '/capture', {
      method: 'POST',
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: payload.domain || '',
        username: payload.username || '',
        password: payload.password || '',
      }),
    })
  } catch (e) {
    return { ok: false, error: 'no-lockpass' }
  }
  if (posted.status === 401 || posted.status === 409) {
    // 401：token 失效（桌面端重置过）→ 清掉本地 token；409：桌面端未解锁
    if (posted.status === 401) {
      httpPaired = false
      httpReadyFlag = false
      await chrome.storage.local.remove(STORAGE_TOKEN_KEY)
    }
    return { ok: false, error: 'desktop-locked' }
  }
  if (!posted.ok) {
    // 400 = 载荷校验被拒（空口令/超长/控制字符），与桌面端入库失败同为 desktop-error，
    // 记录状态码便于在扩展 Service Worker 控制台区分「请求就没进门」与「确认后写盘失败」
    console.warn('[LP_CAPTURE_SAVE] /capture 被拒 status=' + posted.status)
    return { ok: false, error: 'desktop-error' }
  }
  const data = await posted.json().catch(() => ({}))
  if (!data.id) {
    console.warn('[LP_CAPTURE_SAVE] /capture 响应缺少 id')
    return { ok: false, error: 'desktop-error' }
  }

  const deadline = Date.now() + CAPTURE_DESKTOP_TIMEOUT_MS
  let lastKeepAlive = Date.now()
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CAPTURE_DESKTOP_POLL_MS))
    if (Date.now() - lastKeepAlive >= CAPTURE_SW_KEEPALIVE_MS) {
      lastKeepAlive = Date.now()
      // 扩展 API 调用才算后台活动：顺带确认 token 还在（桌面端重置过就无需再等）
      const { [STORAGE_TOKEN_KEY]: live } = await chrome.storage.local.get(STORAGE_TOKEN_KEY)
      if (!live) return { ok: false, error: 'desktop-locked' }
    }
    let resp
    try {
      resp = await fetch(LOCAL_BASE + '/capture/status?id=' + encodeURIComponent(data.id), {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
      })
    } catch (e) {
      continue // 桌面端瞬不可达，继续等
    }
    if (resp.status === 401) return { ok: false, error: 'desktop-locked' }
    // 410 = 待确认槽位超时（用户未在 Rust TTL 内确认），与 404 槽位丢失语义不同：
    // 必须回 'expired' 让浮层走 failExpired 文案，此前并入 desktop-error 会误报「返回异常」
    if (resp.status === 410) return { ok: false, error: 'expired' }
    if (resp.status === 404) return { ok: false, error: 'desktop-error' }
    const d = await resp.json().catch(() => ({}))
    if (d.status === 'created' || d.status === 'updated' || d.status === 'exists') {
      return { ok: true, action: d.status }
    }
    if (d.status === 'rejected') return { ok: false, error: 'rejected' }
    if (d.status === 'error') return { ok: false, error: 'desktop-error' }
    // pending / 其它：继续等用户确认
  }
  return { ok: false, error: 'desktop-timeout' }
}

// ── 消息路由 ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'LP_READY': {
      // 只接受来自白名单应用页面的握手：其余 tab 一律忽略，避免假桥污染状态
      const wasReady = pageBridgeReady
      if (!registerAppBridgeTab(sender)) {
        sendResponse({ ok: false, error: 'untrusted-app-page' })
        break
      }
      pageBridgeReady = true
      // 页面桥心跳会周期性重发握手：无条件清缓存会让每 20s 丢掉已取到的条目，
      // 徒增取数往返。仅首次握手（或此前未就绪）才重置缓存
      if (!wasReady) {
        cachedEntries = []
        passwordCache = {}
      }
      checkHttpStatus().then(maybeAutoFill)
      sendResponse({ ok: true })
      break
    }

    case 'LP_LOCKED':
      unregisterAppBridgeTab(sender)
      // 仍有其它已握手的应用页面时保持就绪（并保留缓存条目），全部锁定才清空
      pageBridgeReady = appBridgeTabs.size > 0
      if (!pageBridgeReady) {
        cachedEntries = []
        passwordCache = {}
      }
      sendResponse({ ok: true })
      break

    case 'LP_ENTRIES':
      if (!registerAppBridgeTab(sender)) break
      cachedEntries = msg.entries || []
      sendResponse({ ok: true })
      break

    case 'LP_PASSWORD':
      if (!registerAppBridgeTab(sender)) break
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
          trustFilePages: trustFileAppPages,
          fileAppSeen: fileAppPageSeen,
        })
      })
      return true // 异步响应
    }

    // popup 切换「信任本地文件页面」（默认关）：决定 file:// 页面能否接收捕获凭据
    case 'POPUP_SET_TRUST': {
      trustFileAppPages = !!msg.value
      chrome.storage.local.set({ [TRUST_FILE_PAGES_KEY]: trustFileAppPages })
      if (!trustFileAppPages) {
        // 取消信任立即回收已登记的本地页面，防止切换前握手的 tab 继续接收数据
        for (const [tabId, rec] of appBridgeTabs) {
          if ((rec.url || '').startsWith('file://')) appBridgeTabs.delete(tabId)
        }
      }
      sendResponse({ ok: true, value: trustFileAppPages })
      break
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
        }).catch((e) => { console.warn('[SUGGESTION_FILL]', e && e.message ? e.message : e); try { sendResponse({ ok: false, error: 'fill failed' }) } catch (_) {} })
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

    // ── 自动捕获（v1.1.4）─────────────────────────
    // 登录表单 submit：暂存凭据
    // file:// 方式打开的 LockPass 页面探测（仅用于决定是否展示「信任本地页面」开关）
    case 'LP_FILE_APP_SEEN': {
      if (sender.tab && (sender.url || '').startsWith('file://')) fileAppPageSeen = true
      sendResponse({ ok: true })
      break
    }

    case 'LP_CAPTURE_PENDING': {
      const tabId = sender.tab && sender.tab.id
      if (!tabId || !msg.password) {
        sendResponse({ ok: false })
        break
      }
      captureRemember(tabId, {
        href: msg.href || (sender.tab && sender.tab.url) || '',
        domain: msg.domain || extractDomain(sender.tab && sender.tab.url),
        username: msg.username || '',
        password: msg.password,
      })
      sendResponse({ ok: true })
      break
    }

    // 新页面加载：已跳转或密码框消失 → 下发待确认凭据（消费即删）
    case 'LP_CAPTURE_CHECK': {
      (async () => {
        const tabId = sender.tab && sender.tab.id
        let rec = tabId ? capturePending.get(tabId) : null
        // SW 被回收后 capturePending 为空，从 chrome.storage.session 恢复
        if (!rec && tabId) {
          await sessionRestore(SESSION_PENDING_KEY, capturePending)
          rec = capturePending.get(tabId)
        }
        if (!rec || Date.now() - rec.at > CAPTURE_TTL_MS) {
          if (rec) capturePending.delete(tabId)
          if (tabId) sessionRemove(SESSION_PENDING_KEY, String(tabId))
          sendResponse({ pending: null })
          return
        }
        const navigated = rec.payload.href && rec.payload.href !== msg.href
        if (navigated || !msg.hasPasswordField) {
          capturePending.delete(tabId)
          sessionRemove(SESSION_PENDING_KEY, String(tabId))
          if (tabId) {
            captureIssued.set(tabId, { payload: rec.payload, at: Date.now() })
            sessionSave(SESSION_ISSUED_KEY, captureIssued)
          }
          sendResponse({ pending: rec.payload })
        } else {
          // 仍停在原登录页（可能登录失败），不打扰
          sendResponse({ pending: null })
        }
      })().catch((e) => { console.warn('[LP_CAPTURE_CHECK]', e && e.message ? e.message : e) })
      return true // 异步响应（async IIFE 内部 sendResponse）
    }

    // 浮层点击保存：转发到 LockPass 页面入库，等待结果回传
    // 凭据取后台本 tab 下发记录（不用 msg.payload）：内容脚本运行在任意站点，
    // 页面脚本可自行 sendMessage 伪造 payload 写入用户库。
    case 'LP_CAPTURE_SAVE': {
      (async () => {
        const saveTabId = sender.tab && sender.tab.id
        let issued = saveTabId ? captureIssued.get(saveTabId) : null
        // SW 被回收后 captureIssued 为空，从 chrome.storage.session 恢复
        if (!issued && saveTabId) {
          await sessionRestore(SESSION_ISSUED_KEY, captureIssued)
          issued = captureIssued.get(saveTabId)
        }
        if (!issued || Date.now() - issued.at > CAPTURE_ISSUED_TTL_MS) {
          if (saveTabId) {
            captureIssued.delete(saveTabId)
            sessionRemove(SESSION_ISSUED_KEY, String(saveTabId))
          }
          sendResponse({ ok: false, error: 'expired' })
          return
        }
        captureIssued.delete(saveTabId)
        sessionRemove(SESSION_ISSUED_KEY, String(saveTabId))
        const requestId = 'cap-' + Date.now().toString(36) + '-' + (++captureReqSeq)
        const waitResult = new Promise((resolve) => {
          const timer = setTimeout(
            () => settleCaptureWaiter(requestId, { ok: false, error: 'timeout' }),
            CAPTURE_RESULT_TIMEOUT_MS
          )
          captureWaiters.set(requestId, { resolve, timer })
        })
        forwardCaptureToLockPassPage(issued.payload, requestId).then((forwarded) => {
          if (forwarded) {
            waitResult.then(sendResponse)
            return
          }
          // 没有可用的 LockPass 页面桥：放弃页面侧等待，改走桌面版本地服务通道
          settleCaptureWaiter(requestId, { ok: false, error: 'no-lockpass' })
          captureViaLocalServer(issued.payload).then(sendResponse)
        })
      })().catch((e) => { console.warn('[LP_CAPTURE_SAVE]', e && e.message ? e.message : e) })
      return true // 异步响应
    }

    // LockPass 页面（经页面桥）回传的保存结果：按 requestId 精确唤醒，不波及其它等待
    case 'LP_CAPTURE_RESULT': {
      if (!registerAppBridgeTab(sender)) break
      settleCaptureWaiter(msg.requestId, { ok: !!msg.ok, action: msg.action, error: msg.error })
      sendResponse({ ok: true })
      break
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
