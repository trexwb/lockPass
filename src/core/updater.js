/* ═══════════════════════════════════════════════════════════════════
   LockPass — 自动更新（桌面版专属，Tauri updater 插件桥）
   ───────────────────────────────────────────────────────────────────
   - 仅桌面版生效（依赖 window.LockTauri / __TAURI__.updater 插件 API）
   - 冷启动延迟 5s 静默检查 GitHub Releases 的 latest.json
   - 发现新版本后按「自动下载安装」开关在后台下载（不阻塞使用）
   - 下载完成后 Toast + 确认弹窗，重启应用完成更新（process.relaunch）
   - 更新包校验：Tauri updater 以 tauri.conf.json 内嵌公钥 + .sig 签名验证
   - 安全说明：仅桌面版联网检查；浏览器版/Pages 不具备更新能力，静默跳过
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict'

  const lt = window.LockTauri || {}
  if (!lt.isTauri) return
  const T = window.__TAURI__
  if (!T || !T.updater) {
    console.warn('[LockUpdater] updater API 不可用（插件未注册或权限缺失）')
    return
  }

  const AUTO_KEY = 'lockpass_auto_update'

  /* status: idle | checking | available | downloading | ready | uptodate | error */
  const state = {
    status: 'idle',
    version: '',
    notes: '',
    progress: 0,
    error: '',
  }
  let updateRef = null

  async function check(silent) {
    if (state.status === 'downloading' || state.status === 'checking' || state.status === 'ready') return state
    state.status = 'checking'
    state.error = ''
    try {
      const update = await T.updater.check()
      if (update) {
        updateRef = update
        state.status = 'available'
        state.version = update.version || ''
        state.notes = update.body || ''
        if (!silent) { try { window.Utils.showToast(window.I18n.t('update.available', { v: state.version }), 'info') } catch (e) {} }
        autoFlow(update)
      } else {
        state.status = 'uptodate'
        if (!silent) { try { window.Utils.showToast(window.I18n.t('update.uptodate'), 'success') } catch (e) {} }
      }
    } catch (e) {
      state.status = 'error'
      state.error = String((e && e.message) || e)
      if (!silent) { try { window.Utils.showToast(window.I18n.t('update.checkFailed', { msg: state.error }), 'error') } catch (e2) {} }
    }
    return state
  }

  async function autoFlow(update) {
    if (!autoEnabled()) return
    await download(update)
  }

  async function download(update) {
    const u = update || updateRef
    if (!u) return
    state.status = 'downloading'
    state.progress = 0
    let received = 0
    let total = 0
    try {
      await u.downloadAndInstall(function (event) {
        if (event.event === 'Started') {
          total = (event.data && event.data.contentLength) || 0
          received = 0
        } else if (event.event === 'Progress') {
          received += (event.data && event.data.chunkLength) || 0
          state.progress = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : Math.min(99, state.progress + 7)
        } else if (event.event === 'Finished') {
          state.progress = 100
        }
      })
      state.status = 'ready'
      try { window.Utils.showToast(window.I18n.t('update.readyToast'), 'success') } catch (e) {}
      try {
        window.Utils.confirm({
          title: window.I18n.t('update.readyTitle'),
          message: window.I18n.t('update.readyMessage', { version: state.version || '' }),
          confirmText: window.I18n.t('update.restartNow'),
          cancelText: window.I18n.t('update.later'),
        }).then(function (ok) { if (ok) relaunch() })
      } catch (e) {}
    } catch (e) {
      state.status = 'available'
      state.error = String((e && e.message) || e)
      try { window.Utils.showToast(window.I18n.t('update.downloadFailed', { msg: state.error }), 'error') } catch (e2) {}
    }
    return state
  }

  function relaunch() {
    try {
      T.process.relaunch()
      return
    } catch (e) {}
    setTimeout(function () { try { T.process.exit(0) } catch (e) {} }, 300)
  }

  function autoEnabled() {
    try { return (localStorage.getItem(AUTO_KEY) ?? '1') === '1' } catch (e) { return true }
  }
  function setAutoEnabled(v) {
    try { localStorage.setItem(AUTO_KEY, v ? '1' : '0') } catch (e) {}
  }

  window.LockUpdater = { check, download, relaunch, state, autoEnabled, setAutoEnabled }

  // 冷启动静默检查：延迟 5s，避开解锁界面关键路径
  setTimeout(function () { try { check(true) } catch (e) {} }, 5000)
})()
