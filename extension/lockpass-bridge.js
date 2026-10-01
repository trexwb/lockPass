/* LockPass 自动填充 — LockPass 页面桥（content script）
   只运行在 LockPass 主应用域名上（manifest content_scripts 第二段 matches）。
   职责：把「页面内的 ExtBridge（window.postMessage 协议）」桥接到扩展后台。
   令牌：页面解锁时生成并写入 sessionStorage，content script 请求解密必须携带；
       锁定/登出后令牌清除，扩展侧随之进入未解锁态。 */
let token = null

function forward(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {})
}

// 页面 → 扩展
window.addEventListener('message', (e) => {
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
    // 自动捕获（v1.1.4）：页面保存结果回传后台，唤醒 LP_CAPTURE_SAVE 的等待
    forward({ type: 'LP_CAPTURE_RESULT', ok: d.ok, action: d.action, error: d.error })
  }
})

// 扩展 → 页面
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'LP_GET_ENTRIES') {
    window.postMessage({ __lpExt: true, type: 'get-entries', token }, '*')
    sendResponse({ ok: true })
  } else if (msg.type === 'LP_GET_PASSWORD') {
    window.postMessage({ __lpExt: true, type: 'get-password', token, id: msg.id }, '*')
    sendResponse({ ok: true })
  } else if (msg.type === 'LP_CAPTURE_FORWARD') {
    // 自动捕获（v1.1.4）：把网页登录凭据转发给页面 ExtBridge 入库；未解锁时拒收
    if (!token) {
      sendResponse({ forwarded: false })
    } else {
      window.postMessage({ __lpExt: true, type: 'capture', token, payload: msg.payload }, '*')
      sendResponse({ forwarded: true })
    }
  }
})

// 探测：扩展新安装 / 页面在扩展后刷新时，若页面已解锁会重新广播 ready
window.postMessage({ __lpExt: true, type: 'probe' }, '*')
