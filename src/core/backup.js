/* ═══════════════════════════════════════════════════════════════════
   LockPass — 备份管理（自动备份提醒 + 定期快照）
   ───────────────────────────────────────────────────────────────────
   - 提醒：解锁时检查距上次 .vault 导出 / 快照时间，超过间隔 Toast 提醒
   - 快照：完整加密负载（与 LockPass-vault.json 同构，带日期时间后缀）
     · Tauri 桌面：写入数据目录 backups/，清单维护保留最近 N 份
     · 浏览器已绑定目录：写入目录 backups/，枚举清理保留最近 N 份
   - 设置存 localStorage（本机偏好，非敏感数据）
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  const INTERVAL_KEY = 'lockpass_backup_interval'     // 提醒间隔（天），0=关闭，默认 7
  const LAST_REMIND_KEY = 'lockpass_last_remind'      // 上次提醒时间戳（防刷屏）
  const LAST_KEY = 'lockpass_last_backup'             // 上次备份时间戳（导出或快照）
  const SNAP_ENABLED_KEY = 'lockpass_snapshot_enabled' // 自动快照开关 '1'/'0'，默认开
  const SNAP_INTERVAL_KEY = 'lockpass_snapshot_interval' // 快照间隔（天），默认 7
  const SNAP_KEEP_KEY = 'lockpass_snapshot_keep'      // 保留份数，默认 5，上限 20
  const SNAPSHOT_DIR = 'backups'
  const SNAPSHOT_PREFIX = 'LockPass-backup-'
  const MANIFEST = '.manifest.json'
  const DAY_MS = 86400000

  function getInt(key, fallback) {
    try {
      const v = parseInt(localStorage.getItem(key) || '', 10)
      if (!isNaN(v) && v >= 0) return v
    } catch (e) {}
    return fallback
  }
  function getStr(key, fallback) {
    try { return localStorage.getItem(key) || fallback } catch (e) { return fallback }
  }
  function setVal(key, val) {
    try { localStorage.setItem(key, String(val)) } catch (e) {}
  }
  function stampName(d) {
    const pad = n => String(n).padStart(2, '0')
    return `${SNAPSHOT_PREFIX}${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`
  }

  const BackupManager = {
    /* ── 设置读写 ── */
    getIntervalDays() { return getInt(INTERVAL_KEY, 7) },
    setIntervalDays(v) { setVal(INTERVAL_KEY, Math.max(0, parseInt(v, 10) || 0)) },
    getLastBackupAt() { return getInt(LAST_KEY, 0) },
    markBackupNow() { setVal(LAST_KEY, Date.now()) },
    snapshotEnabled() { return getStr(SNAP_ENABLED_KEY, '1') === '1' },
    setSnapshotEnabled(v) { setVal(SNAP_ENABLED_KEY, v ? '1' : '0') },
    snapshotIntervalDays() { return Math.max(1, getInt(SNAP_INTERVAL_KEY, 7)) },
    setSnapshotIntervalDays(v) { setVal(SNAP_INTERVAL_KEY, Math.max(1, parseInt(v, 10) || 7)) },
    snapshotKeep() { return Math.min(20, Math.max(1, getInt(SNAP_KEEP_KEY, 5))) },
    setSnapshotKeep(v) { setVal(SNAP_KEEP_KEY, Math.min(20, Math.max(1, parseInt(v, 10) || 5))) },

    isDesktop() { return !!(window.FileStore && window.FileStore.isTauri) },
    canSnapshot() {
      // 桌面端恒可用；浏览器需支持文件系统 API 且已绑定目录（lp_sync_bound 为绑定标记）
      if (this.isDesktop()) return true
      try {
        return !!(
          window.FileSync &&
          window.FileSync.isSupported() &&
          localStorage.getItem('lp_sync_bound')
        )
      } catch (e) {
        return false
      }
    },

    /* ── 解锁后检查：提醒 + 自动快照 ── */
    checkAfterUnlock() {
      try { this.checkRemind() } catch (e) {}
      try { this.checkSnapshot() } catch (e) {}
    },

    checkRemind() {
      const interval = this.getIntervalDays()
      if (interval <= 0) return
      const now = Date.now()
      const last = this.getLastBackupAt()
      const lastRemind = getInt(LAST_REMIND_KEY, 0)
      const overdue = last === 0 || (now - last) / DAY_MS >= interval
      const reminded = (now - lastRemind) / DAY_MS < interval
      if (!overdue || reminded) return
      setVal(LAST_REMIND_KEY, now)
      try {
        window.Utils.showToast(
          last === 0
            ? '您还没有备份过，建议尽快导出 .vault 加密备份'
            : `距上次备份已超过 ${interval} 天，建议导出 .vault 备份`,
          'warning',
        )
      } catch (e) {}
    },

    /* ── 自动快照 ── */
    async checkSnapshot() {
      if (!this.snapshotEnabled()) return
      const last = this.getLastBackupAt()
      if (last > 0 && (Date.now() - last) / DAY_MS < this.snapshotIntervalDays()) return
      const r = await this.createSnapshot()
      if (r.ok) {
        try { window.Utils.showToast('已自动备份快照', 'success') } catch (e) {}
      }
      // 自动流程失败一律静默（permission/unbound/error 均不打扰；
      // 快照可用性由设置面板状态与手动「立即备份」反馈呈现）
    },

    /* ── 生成快照（加密负载 + 日期时间名 + 清理旧份） ── */
    async createSnapshot() {
      if (!window.FileSync || typeof window.FileSync._readPayload !== 'function') {
        return { ok: false, reason: 'unsupported' }
      }
      let payload = null
      try { payload = await window.FileSync._readPayload() } catch (e) {}
      if (!payload) return { ok: false, reason: 'empty' }

      const name = stampName(new Date())
      const text = JSON.stringify(payload, null, 2)

      try {
        if (this.isDesktop()) {
          await window.FileStore.write(SNAPSHOT_DIR + '/' + name, text)
          await this._cleanupByManifest(name)
        } else if (window.FileSync && window.FileSync.isSupported()) {
          // 句柄损坏自动解绑（返回 null 时按未绑定静默跳过）
          const dir = await window.FileSync.ensureUsableDirHandle()
          if (!dir) return { ok: false, reason: 'unbound' }
          // 权限预检：IndexedDB 恢复的句柄权限可能为 'prompt'，
          // 无用户手势时 getDirectoryHandle(create) 会被浏览器拒绝（报 not allowed）。
          // 自动流程静默跳过；手动「立即备份」时由调用方提示重新授权。
          try {
            if (dir.queryPermission && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
              return { ok: false, reason: 'permission' }
            }
          } catch (e) { /* 不支持 queryPermission 的环境跳过预检 */ }
          const sub = await dir.getDirectoryHandle(SNAPSHOT_DIR, { create: true })
          const fh = await sub.getFileHandle(name, { create: true })
          const w = await fh.createWritable()
          await w.write(text)
          await w.close()
          await this._cleanupByEnumeration(sub, name)
        } else {
          return { ok: false, reason: 'unsupported' }
        }
      } catch (e) {
        return { ok: false, reason: 'error', error: e }
      }

      this.markBackupNow()
      return { ok: true, name }
    },

    /* Tauri：清单文件维护（数据目录无枚举命令） */
    async _cleanupByManifest(keepName) {
      const keep = this.snapshotKeep()
      let list = []
      try {
        const raw = await window.FileStore.read(SNAPSHOT_DIR + '/' + MANIFEST)
        list = JSON.parse(raw || '[]')
      } catch (e) { list = [] }
      if (!Array.isArray(list)) list = []
      list.push(keepName)
      const remove = list.slice(0, Math.max(0, list.length - keep))
      list = list.slice(Math.max(0, list.length - keep))
      for (const n of remove) {
        try { await window.FileStore.delete(SNAPSHOT_DIR + '/' + n) } catch (e) {}
      }
      try { await window.FileStore.write(SNAPSHOT_DIR + '/' + MANIFEST, JSON.stringify(list, null, 2)) } catch (e) {}
    },

    /* 浏览器：枚举目录清理（文件名按字典序即时间序） */
    async _cleanupByEnumeration(sub, keepName) {
      const keep = this.snapshotKeep()
      const names = []
      for await (const [n] of sub.entries()) {
        if (n.startsWith(SNAPSHOT_PREFIX) && n !== keepName) names.push(n)
      }
      names.sort().reverse()
      for (let i = keep - 1; i < names.length; i++) {
        try { await sub.removeEntry(names[i]) } catch (e) {}
      }
    },
  }

  window.BackupManager = BackupManager
})()
