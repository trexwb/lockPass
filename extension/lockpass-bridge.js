/* LockPass 自动填充 — LockPass 页面桥（content script）
   运行在 manifest 声明的应用地址上（含 file:// 双击用法）。
   职责：把「页面内的 ExtBridge（window.postMessage 协议）」桥接到扩展后台。
   令牌：页面解锁时生成并写入 sessionStorage，content script 请求解密必须携带；
       锁定/登出后令牌清除，扩展侧随之进入未解锁态。
    inert 条件：本页必须是 LockPass 应用页面（ExtBridge 设置的 data-lockpass-app 标记）。
       标记本身可被本地 HTML 伪造，因此它只是第一道闸；真正的凭据投递白名单判定
       在后台按浏览器提供的 sender.url 完成（见 background.js isTrustedAppPageUrl）。 */
let token = null
let markerSeen = false

function isAppPage() {
  try { return document.documentElement.hasAttribute('data-lockpass-app') } catch (e) { return false }
}

function forward(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {})
}

// ExtBridge 与本页脚本同为 document_idle 注入，标记可能稍后出现：轮询确认后再放行桥
function watchAppMarker() {
  if (markerSeen) return
  if (isAppPage()) {
    markerSeen = true
    window.postMessage({ __lpExt: true, type: 'probe' }, '*')
    return
  }
  setTimeout(watchAppMarker, 300)
}

// 页面 → 扩展（非应用页面一律沉默，不接受也不转发任何凭据）
window.addEventListener('message', (e) => {
  if (!markerSeen) return
  if (e.source !== window) return
  const d = e.data
  if (!d || d.__lpExt !== true) return
  if (d.type === 'ready' && d.token) {
    token = d.token
    forward({ type: 'LP_READY' })
  } else if (d.type === 'locked') {
    token = null
    forward({ type: 'LP_LOCKED' })
  } else if (d.type === 'entries') {
    forward({ type: 'LP_ENTRIES', entries: d.entries })
  } else if (d.type === 'password') {
    forward({ type: 'LP_PASSWORD', id: d.id, password: d.password })
  } else if (d.type === 'capture-result') {
    // 自动捕获（v1.1.4）：页面保存结果回传后台，按 requestId 唤醒对应的 LP_CAPTURE_SAVE
    forward({ type: 'LP_CAPTURE_RESULT', requestId: d.requestId, ok: d.ok, action: d.action, error: d.error })
  }
})

// 扩展 → 页面
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!markerSeen) {
    sendResponse({ ok: false, forwarded: false, error: 'not-lockpass-page' })
    return
  }
  if (msg.type === 'LP_GET_ENTRIES') {
    window.postMessage({ __lpExt: true, type: 'get-entries', token }, '*')
    sendResponse({ ok: true })
  } else if (msg.type === 'LP_GET_PASSWORD') {
    window.postMessage({ __lpExt: true, type: 'get-password', token, id: msg.id }, '*')
    sendResponse({ ok: true })
  } else if (msg.type === 'LP_CAPTURE_FORWARD') {
    // 自动捕获（v1.1.4）：把网页登录凭据转发给页面 ExtBridge 入库；未解锁 / 无请求号时拒收
    // requestId 必须回传，后台据此只唤醒本次保存的等待
    if (!token || !msg.requestId) {
      sendResponse({ forwarded: false })
    } else {
      window.postMessage({ __lpExt: true, type: 'capture', token, requestId: msg.requestId, payload: msg.payload }, '*')
      sendResponse({ forwarded: true })
    }
  }
})

watchAppMarker()

/* MV3 Service Worker 空闲约 30s 会被回收，后台的 appBridgeTabs / pageBridgeReady 随之清零，
   而页面解锁后只在首次广播 ready —— 表现为「LockPass 页面一直开着，过一会儿保存却提示未解锁」。
   令牌有效期间定期重发握手，让后台重新登记本 tab（令牌仍是第一道闸，未解锁则静默等待）。 */
function keepAliveBridge() {
  if (!token) {
    setTimeout(keepAliveBridge, 5000)
    return
  }
  forward({ type: 'LP_READY' })
  setTimeout(keepAliveBridge, 20000)
}
keepAliveBridge()
