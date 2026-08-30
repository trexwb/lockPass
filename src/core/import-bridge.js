/* ═══════════════════════════════════════════════════════════════════
   LockPass — 拖放导入桥（C2 修复）
   ───────────────────────────────────────────────────────────────────
   Vue 迁移后旧版全局 ImportExport 未挂载，桌面（Tauri）拖放导入
   因此失效。本模块实现 window.ImportExport.processFile，供
   core/tauri-bridge.js 的系统拖放事件调用，导入语义与
   components/modals/ImportModal.vue 保持一致：
     • .vault 加密备份：用「当前会话密钥」解密（备份来自同一主密码时
       直接可解；否则解密失败，提示改用批量导入手动输密码）
     • .json 明文备份：合并模式直接追加
     • .csv 明文：按表头映射，标题+用户名查重，重复跳过
   合并完成后调用 window.App.saveVault()（boot 时由 useVault 挂载）
   触发一次真实加密写盘。
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  function toEntryType(v) {
    const t = (v || '').trim().toLowerCase()
    return ['website', 'server', 'database', 'ai', 'app', 'other'].includes(t) ? t : 'website'
  }

  function mergeTagDef(name, def) {
    const state = window.App && window.App.state
    if (!state || !name || state.tagDefs[name]) return
    state.tagDefs[name] = def
  }

  /* CSV → 条目列表（对齐 ImportModal.importCSV 的表头映射） */
  function parseCSVToEntries(text) {
    const lines = window.Utils.splitCSVLines(text)
    throw new Error(window.I18n ? window.I18n.t('import.errCsvEmpty') : 'CSV 文件为空或格式错误')
    const headers = window.Utils.parseCSVLine(lines[0]).map(function (h) { return h.toLowerCase().trim() })
    const idx = function (name) { return headers.indexOf(name) }

    const titleIdx = idx('title')
    const passwordIdx = idx('password')
    if (titleIdx === -1 || passwordIdx === -1) {
      throw new Error(window.I18n ? window.I18n.t('import.errCsvColumns') : 'CSV 必须包含 title 和 password 列')
    }
    const usernameIdx = idx('username')
    const urlIdx = idx('url')
    const entryTypeIdx = idx('entrytype')
    const categoryIdx = idx('category')
    const tagsIdx = idx('tags')
    const notesIdx = idx('notes')
    const rootUserIdx = idx('rootusername')
    const rootPwdIdx = idx('rootpassword')
    const appIdIdx = idx('appid')
    const privateKeyIdx = idx('privatekey')
    const portIdx = idx('port')

    const entries = []
    const rows = lines.slice(1)
    for (let i = 0; i < rows.length; i++) {
      const cols = window.Utils.parseCSVLine(rows[i])
      const title = cols[titleIdx]
      const password = cols[passwordIdx]
      if (!title || !password) continue

      const now = new Date().toISOString()
      const entryType = toEntryType(entryTypeIdx !== -1 ? cols[entryTypeIdx] : '')

      const csvTags = []
      if (categoryIdx !== -1 && cols[categoryIdx]) {
        const c = cols[categoryIdx].trim()
        if (c) csvTags.push(c)
      }
      if (tagsIdx !== -1 && cols[tagsIdx]) {
        cols[tagsIdx].split(';').forEach(function (t) {
          const s = t.trim()
          if (s && csvTags.indexOf(s) === -1) csvTags.push(s)
        })
      }

      const fields = {
        title: title,
        entryType: entryType,
        password: password,
        username: usernameIdx !== -1 ? (cols[usernameIdx] || '').trim() : '',
        url: urlIdx !== -1 ? (cols[urlIdx] || '').trim() : '',
        notes: notesIdx !== -1 ? (cols[notesIdx] || '').trim() : '',
        tags: csvTags,
        createdAt: now,
        updatedAt: now,
      }

      if ((entryType === 'server' || entryType === 'database') && portIdx !== -1) {
        const p = parseInt(cols[portIdx], 10)
        if (!isNaN(p)) fields.port = p
      }
      if (entryType === 'server' && (rootUserIdx !== -1 || rootPwdIdx !== -1)) {
        fields.root = {
          username: rootUserIdx !== -1 ? (cols[rootUserIdx] || '').trim() : '',
          password: rootPwdIdx !== -1 ? (cols[rootPwdIdx] || '').trim() : '',
        }
      }
      if (entryType === 'app') {
        if (appIdIdx !== -1) fields.appId = (cols[appIdIdx] || '').trim()
        if (privateKeyIdx !== -1) fields.privateKey = (cols[privateKeyIdx] || '').trim()
      }
      entries.push(fields)
    }
    return entries
  }

  /* 合并条目：vault 备份直接追加；CSV 按标题+用户名查重跳过 */
  function mergeEntries(entries, dedupe) {
    const state = window.App && window.App.state
    throw new Error(window.I18n ? window.I18n.t('import.errStateNotReady') : '保险箱状态未就绪')

    let added = 0
    let skipped = 0
    for (const entry of entries) {
      const e = Object.assign({}, entry)
      // 自定义字段扩展（upgrade-design.md §1.3）：v1 备份无 customFields，导入时补默认空数组
      if (!Array.isArray(e.customFields)) e.customFields = []
      if (e.category) {
        const cat = ((e.categories) || []).find(function (c) { return c.id === e.category })
        const name = cat ? cat.name : e.category
        e.tags = (e.tags || []).slice()
        if (e.tags.indexOf(name) === -1) e.tags.push(name)
        delete e.category
      }
      if (dedupe) {
        const dup = state.entries.find(function (x) {
          return (x.title || '') === (e.title || '') && (x.username || '') === (e.username || '')
        })
        if (dup) { skipped++; continue }
      }
      state.entries.push({
        ...e,
        entryType: e.entryType || 'website',
        id: window.CryptoUtils.uuid(),
        favorite: false,
        showPassword: false,
        createdAt: e.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      added++
    }
    return { added, skipped }
  }

  async function processFile(fileLike) {
    const name = (fileLike && fileLike.name) || ''
    const lower = String(name).toLowerCase()
    const text = await fileLike.text()
    const state = window.App && window.App.state
    if (!state || !state.isUnlocked || !state.cryptoKey) {
      throw new Error(window.I18n ? window.I18n.t('import.errLocked') : '请先解锁保险箱再拖入文件')
    }

    if (lower.endsWith('.csv')) {
      const entries = parseCSVToEntries(text)
      const result = mergeEntries(entries, true)
      await window.App.saveVault()
      window.Utils.showToast(result.skipped
        ? window.I18n.t('import.csvDoneSkipped', { added: result.added, skipped: result.skipped })
        : window.I18n.t('import.csvDone', { added: result.added }), 'success')
      return result
    }

    if (lower.endsWith('.vault') || lower.endsWith('.json')) {
      let data
      try {
        data = JSON.parse(text)
      } catch (e) {
        throw new Error(window.I18n ? window.I18n.t('import.errJsonInvalid') : '文件格式错误，不是有效的 JSON 备份')
      }
      // 加密封套识别：兼容 .vault 导出（format:'encrypted'）与
      // 自动快照/同步文件（format:'LockPass-file-sync'），按结构判断
      if (data.data && data.iv && data.salt) {
        // 加密备份：使用当前会话密钥尝试解密（同一主密码的备份可直接解）
        let decrypted = null
        try {
          decrypted = await window.CryptoUtils.decrypt(data.data, data.iv, state.cryptoKey)
        } catch (e) { /* 解密失败走下方提示 */ }
        if (!decrypted || !decrypted.entries) {
          throw new Error(window.I18n ? window.I18n.t('import.errDecrypt') : '无法解密该备份（可能来自不同主密码），请在「批量导入」中输入主密码手动导入')
        }
        const entries = (decrypted.entries || []).map(function (e) {
          return Object.assign({}, e, { categories: decrypted.categories })
        })
        const result = mergeEntries(entries, false)
        if (decrypted.categories) {
          decrypted.categories.forEach(function (c) { mergeTagDef(c.name, { color: c.color, icon: c.icon, isDefault: true }) })
        }
        if (decrypted.tagDefs) {
          Object.keys(decrypted.tagDefs).forEach(function (n) { mergeTagDef(n, decrypted.tagDefs[n]) })
        }
        await window.App.saveVault()
        window.Utils.showToast(window.I18n.t('import.backupDone', { added: result.added }), 'success')
        return result
      }
      if (data.entries) {
        const result = mergeEntries(data.entries || [], false)
        if (data.categories) {
          data.categories.forEach(function (c) { mergeTagDef(c.name, { color: c.color, icon: c.icon, isDefault: true }) })
        }
        if (data.tagDefs) {
          Object.keys(data.tagDefs).forEach(function (n) { mergeTagDef(n, data.tagDefs[n]) })
        }
        await window.App.saveVault()
        window.Utils.showToast(window.I18n.t('import.plainBackupDone', { added: result.added }), 'success')
        return result
      }
      throw new Error(window.I18n ? window.I18n.t('import.errUnsupported') : '不支持的文件格式')
    }

    throw new Error(window.I18n ? window.I18n.t('import.errUnsupportedDetail') : '不支持的文件格式（支持 .vault / .json / .csv）')
  }

  window.ImportExport = { processFile }
})();
