/* ═══════════════════════════════════════════════════════════════════
   LockPass — 浏览器扩展桥接（window.ExtBridge）
   ───────────────────────────────────────────────────────────────────
   与 extension/ 目录的「LockPass 自动填充」扩展配合：
   - 解锁后广播 ready（含一次性会话令牌），锁定/登出广播 locked
   - 响应扩展 content script 的 window.postMessage 请求：
     · get-entries：返回条目列表（仅 title/username/url/entryType，不含密码）
     · get-password：返回指定条目密码（主密码/解密全程在页面内存，扩展仅转发）
   - 安全：所有请求必须携带当前会话令牌（sessionStorage，锁定即清除）；
     来源必须是本窗口（e.source === window）
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  const TOKEN_KEY = 'lp_ext_token'
  const MSG_FLAG = '__lpExt'

  let entriesProvider = () => []

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch (e) { return '' }
  }

  function setToken(token) {
    try { sessionStorage.setItem(TOKEN_KEY, token) } catch (e) {}
  }

  function clearToken() {
    try { sessionStorage.removeItem(TOKEN_KEY) } catch (e) {}
  }

  function post(type, extra) {
    // 注意：标记值必须是布尔 true——页面监听与 lockpass-bridge 均校验 d[MSG_FLAG] !== true
    window.postMessage(Object.assign({ [MSG_FLAG]: true, type }, extra || {}), '*')
  }

  /* ── 页面消息监听（来自扩展 content script） ── */
  window.addEventListener('message', (e) => {
    if (e.source !== window) return
    const d = e.data
    if (!d || d[MSG_FLAG] !== true) return

    if (d.type === 'probe') {
      // 扩展侧探测：已解锁则重新广播 ready（扩展安装/页面刷新后接续）
      if (getToken()) post('ready', { token: getToken() })
      return
    }

    // 以下请求必须携带有效令牌
    const token = getToken()
    if (!token || d.token !== token) return

    if (d.type === 'get-entries') {
      const list = entriesProvider().map((x) => ({
        id: x.id,
        title: x.title || '',
        username: x.username || '',
        url: x.url || '',
        entryType: x.entryType || 'website',
      }))
      post('entries', { token, entries: list })
    } else if (d.type === 'get-password') {
      const entry = entriesProvider().find((x) => x.id === d.id)
      if (entry) {
        post('password', { token, id: entry.id, password: entry.password || '' })
      }
    }
  })

  window.ExtBridge = {
    /** 由 useVault 注册条目数据源（锁定时 entries 清空，自然返回空列表） */
    setEntriesProvider(fn) {
      if (typeof fn === 'function') entriesProvider = fn
    },

    /** 解锁成功后调用：生成一次性令牌并广播就绪 */
    ready() {
      setToken(crypto.randomUUID())
      post('ready', { token: getToken() })
    },

    /** 锁定 / 登出时调用：清除令牌并广播 */
    lock() {
      clearToken()
      post('locked')
    },

    isActive() {
      return !!getToken()
    },
  }
})()
