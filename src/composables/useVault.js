/* ═══════════════════════════════════════════════════════════════════
   LockPass — Vue 全局状态与核心操作
   Vue 3 迁移：复刻 app.js / entries.js / ui.js 的应用逻辑与数据流。
   加密、存储、同步等底层能力仍由 core/ 模块提供（零改动）。
   ═══════════════════════════════════════════════════════════════════ */

import { reactive } from 'vue'

/* ── 常量定义（与原生版一致） ─────────────────────────────── */

export const ENTRY_TYPES = [
  { id: 'website', label: '网站', icon: 'globe' },
  { id: 'server', label: '服务器', icon: 'server' },
  { id: 'database', label: '数据库', icon: 'database' },
  { id: 'ai', label: 'AI', icon: 'ai' },
  { id: 'app', label: '应用', icon: 'app' },
  { id: 'other', label: '其他', icon: 'other' },
]

export const DEFAULT_TAGS = [
  { name: '社交', icon: 'social', color: '#58a6ff', isDefault: true },
  { name: '邮箱', icon: 'email', color: '#f85149', isDefault: true },
  { name: '金融', icon: 'finance', color: '#3fb950', isDefault: true },
  { name: '工作', icon: 'work', color: '#d29922', isDefault: true },
  { name: '开发', icon: 'dev', color: '#bc8cff', isDefault: true },
  { name: '生活', icon: 'life', color: '#79c0ff', isDefault: true },
  { name: '其他', icon: 'other', color: '#8b949e', isDefault: true },
]

export const TAG_ICON_OPTIONS = [
  'social', 'email', 'finance', 'work', 'dev', 'life', 'other',
  'bookmark', 'star', 'key', 'lock', 'cloud', 'globe', 'shield',
  'heart', 'tag', 'folder',
]

export const TAG_COLOR_OPTIONS = [
  '#58a6ff', '#f85149', '#3fb950', '#d29922', '#bc8cff',
  '#79c0ff', '#8b949e', '#f778ba', '#39c5cf', '#ffa657',
  '#56d364', '#e3b341', '#ff7b72', '#d2a8ff', '#a5d6ff',
]

function loadSettingInt(key, fallback) {
  try {
    const v = parseInt(localStorage.getItem(key) || '', 10)
    if (!isNaN(v) && v >= 0) return v
  } catch (e) {}
  return fallback
}

/* ── 全局响应式状态（对应原生 App.state） ─────────────────── */

export const vaultState = reactive({
  entries: [],
  // 密码历史：{ [entryId]: [{ password, at }] }，每条目最多 HISTORY_LIMIT 条
  // 与 entries 并列整体加密；导入导出只读写 entries，历史天然不随数据迁移
  history: {},
  tagDefs: {},
  tags: [],
  deleted: [],
  isUnlocked: false,
  cryptoKey: null,
  selectedEntry: null,
  currentFilter: 'all',
  searchQuery: '',
  // 密码显隐状态：按条目 ID 记忆，独立于 entry 数据对象，避免污染加密 vault
  showPasswordMap: {},
  clipboardTimer: null,
  clipboardNoteTimer: null,
  lockTimer: null,
  lockTimeoutMs: loadSettingInt('lockpass_lock_timeout', 5 * 60 * 1000),
  clipboardClearMs: loadSettingInt('lockpass_clipboard_clear', 30 * 1000),
  initialized: false,
  hasBindingHistory: false,
  booted: false,
  // 模态框状态（activeModal: 'entry' | 'settings' | 'import' | 'export' | 'qr-import' | 'qr-share' | 'change-pw' | 'tags'）
  activeModal: null,
  editingEntryId: null,
  // 侧边栏（移动端抽屉）
  sidebarOpen: false,
  // 锁屏交互状态
  lockError: '',
  lockBusy: false,
})

/* ── 自动锁定：用户交互重置（G2 修复） ───────────────
   解锁后监听用户交互（mousemove/keydown/touch/scroll），
   每次交互重置自动锁定计时器，符合 SPEC 5.2。
   监听在 boot 时挂载一次，handler 内部用 isUnlocked 守卫，
   锁定后空转不做事。 */
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
let activityResetFn = null
let activityBound = false
let lastActivityReset = 0

function onUserActivity() {
  if (!vaultState.isUnlocked) return
  if (vaultState.lockTimeoutMs <= 0) return
  const now = Date.now()
  if (now - lastActivityReset < 1000) return // 节流：至少间隔 1s 才重置，避免 mousemove 高频重置
  lastActivityReset = now
  if (typeof activityResetFn === 'function') activityResetFn()
}

function setupActivityListeners() {
  if (activityBound) return
  ACTIVITY_EVENTS.forEach(e => document.addEventListener(e, onUserActivity, { passive: true }))
  activityBound = true
}

/* ── 会话（内存级，刷新即失） ─────────────────────────────── */

let sessionPassword = ''

function saveSession(password) { sessionPassword = password || '' }
function getSession() { return sessionPassword }
function clearSession() {
  sessionPassword = ''
  try {
    sessionStorage.removeItem('lockpass_session')
    sessionStorage.removeItem('lockpass_session_nonce')
  } catch (e) {}
}

/* ── 工具函数 ─────────────────────────────────────────────── */

function buildDefaultTagDefs() {
  const defs = {}
  DEFAULT_TAGS.forEach(t => { defs[t.name] = { color: t.color, icon: t.icon, isDefault: t.isDefault } })
  return defs
}

function seedDefaultTagDefs() {
  const tagDefs = buildDefaultTagDefs()
  const popular = ['重要', '工作', '个人', '购物', '娱乐', '测试', '临时', '常用']
  popular.forEach(name => {
    if (tagDefs[name]) return
    const attrs = window.Utils.getRandomTagAttrs(tagDefs)
    tagDefs[name] = { color: attrs.color, icon: attrs.icon, isDefault: false }
  })
  return tagDefs
}

function migrateVaultData(data) {
  data = data || {}
  const tagDefs = {}
  let changed = false

  DEFAULT_TAGS.forEach(t => {
    tagDefs[t.name] = { color: t.color, icon: t.icon, isDefault: true }
  })
  const legacyCategories = data.categories || []
  legacyCategories.forEach(c => {
    tagDefs[c.name] = { color: c.color, icon: c.icon, isDefault: true }
  })
  if (data.tagDefs) {
    Object.keys(data.tagDefs).forEach(name => {
      if (!tagDefs[name]) tagDefs[name] = data.tagDefs[name]
    })
  }

  const migrateEntry = (e) => {
    const tags = e.tags ? e.tags.slice() : []
    if (e.category) {
      const cat = legacyCategories.find(c => c.id === e.category)
      const catName = cat ? cat.name : e.category
      if (!tags.includes(catName)) tags.push(catName)
      changed = true
    }
    if (!e.entryType) e.entryType = 'website'
    const { category, ...rest } = e
    rest.tags = tags
    ;(rest.tags || []).forEach(t => {
      if (!tagDefs[t]) {
        const attrs = window.Utils.getRandomTagAttrs(tagDefs)
        tagDefs[t] = { color: attrs.color, icon: attrs.icon, isDefault: false }
      }
    })
    return rest
  }

  const entries = (data.entries || []).map(migrateEntry)
  const deleted = (data.deleted || []).map(migrateEntry)
  if (legacyCategories.length && !data.tagDefs) changed = true

  return { entries, history: data.history || {}, tagDefs, tags: data.tags || [], deleted, changed }
}

/* ── 主 composable ────────────────────────────────────────── */

export function useVault() {
  // 让全局交互监听回调指向本实例最新的 resetLockTimer
  activityResetFn = resetLockTimer

  /* ── 启动与状态检查 ─────────────────────────── */

  async function boot() {
    if (vaultState.booted) return
    // 兼容桥：core/related.js 依赖 window.App.state，注入状态引用（不覆盖原生 App）
    if (!window.App) {
      window.App = { state: vaultState }
    } else if (!window.App.state) {
      window.App.state = vaultState
    }
    await window.DBUtils.openDB()
    const { initialized, hasBindingHistory } = await checkVaultStatus()
    vaultState.initialized = initialized
    vaultState.hasBindingHistory = hasBindingHistory
    vaultState.booted = true
    // C2 修复：拖放导入桥（window.ImportExport）需要触发加密写盘，挂载到全局
    window.App.saveVault = saveVault
    setupActivityListeners()
  }

  async function checkVaultStatus() {
    await window.DBUtils.openDB()
    const saltRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'salt')
    const initialized = !!saltRecord
    const hasBindingHistory = window.FileSync.wasBound()
    return { initialized, hasBindingHistory }
  }

  /* ── 创建 / 解锁 / 保存 ─────────────────────── */

  async function createVault(password) {
    const salt = window.CryptoUtils.generateSalt()
    const saltBase64 = window.CryptoUtils.arrayBufferToBase64(salt)
    const key = await window.CryptoUtils.deriveKey(password, salt, window.CryptoUtils.DEFAULT_ITERATIONS)

    const initialData = {
      entries: [],
      tagDefs: seedDefaultTagDefs(),
      tags: [],
      deleted: [],
    }

    const { iv, data } = await window.CryptoUtils.encrypt(initialData, key)

    await window.DBUtils.dbPut(window.DBUtils.STORE_META, { key: 'salt', value: saltBase64 })
    await window.DBUtils.dbPut(window.DBUtils.STORE_META, { key: 'iterations', value: window.CryptoUtils.DEFAULT_ITERATIONS })
    await window.DBUtils.dbPut(window.DBUtils.STORE_META, { key: 'version', value: 1 })
    await window.DBUtils.dbPut(window.DBUtils.STORE_VAULT, { id: 'main', iv, data })

    await window.FileSync.syncNow()

    return { salt, key }
  }

  async function unlockVault(password) {
    const saltRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'salt')
    if (!saltRecord) throw new Error('未找到保险箱数据')

    const salt = window.CryptoUtils.base64ToArrayBuffer(saltRecord.value)
    const iterRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'iterations')
    const iterations = iterRecord ? (Number(iterRecord.value) || window.CryptoUtils.LEGACY_ITERATIONS) : window.CryptoUtils.LEGACY_ITERATIONS
    const key = await window.CryptoUtils.deriveKey(password, new Uint8Array(salt), iterations)

    const vaultRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_VAULT, 'main')
    if (!vaultRecord) throw new Error('未找到加密数据')

    try {
      const decrypted = await window.CryptoUtils.decrypt(vaultRecord.data, vaultRecord.iv, key)
      return { key, data: decrypted }
    } catch (e) {
      throw new Error('密码错误')
    }
  }

  /* ── saveVault 防抖合并（R8 修复） ─────────────────
     连续多次 saveVault 调用在 150ms 内合并为一次真实加密写盘，
     避免写放大。
     P1 修复：返回的 Promise 与「本次触发的真实写入」绑定——
     等待对应的 doSave 完成后才 resolve；被后续调用合并掉的
     旧请求一并延后到合并后的写入完成时 resolve，杜绝提前返回。 */
  let saveTimer = null
  let saveChain = Promise.resolve()
  let saveResolvers = []

  async function doSave() {
    const { iv, data } = await window.CryptoUtils.encrypt(
      {
        entries: vaultState.entries,
        history: vaultState.history,
        tagDefs: vaultState.tagDefs,
        tags: vaultState.tags,
        deleted: vaultState.deleted,
      },
      vaultState.cryptoKey,
    )
    await window.DBUtils.dbPut(window.DBUtils.STORE_VAULT, { id: 'main', iv, data })
    await window.FileSync.syncNow()
    // 保存完成后同步最新条目到 Tauri 本地服务（桌面版扩展自动填充用）
    try { window.TauriServer && window.TauriServer.setEntries(vaultState.entries) } catch (e) {}
  }

  function flushSaveResolvers() {
    const list = saveResolvers
    saveResolvers = []
    list.forEach((r) => r())
  }

  function saveVault() {
    if (!vaultState.cryptoKey) return Promise.resolve()
    if (saveTimer) clearTimeout(saveTimer)
    return new Promise((resolve) => {
      saveResolvers.push(resolve)
      saveTimer = setTimeout(() => {
        saveTimer = null
        saveChain = saveChain
          .then(() => doSave())
          .catch((e) => {
            console.error('保存失败:', e)
            window.Utils.showToast('保存失败：' + (e.message || '未知错误'), 'error')
          })
        // 本次写入（以及被合并的旧请求）完成后统一 resolve
        saveChain.then(flushSaveResolvers)
      }, 150)
    })
  }

  /* ── 解锁处理（创建 / 解锁 / 绑定恢复） ─────── */

  async function handleUnlock(password) {
    if (vaultState.lockBusy) return
    if (!password) {
      vaultState.lockError = '请输入主密码'
      return
    }
    vaultState.lockBusy = true
    vaultState.lockError = ''

    try {
      const status = await checkVaultStatus()
      vaultState.initialized = status.initialized

      if (!status.initialized) {
        if (status.hasBindingHistory) {
          const proceed = await window.Utils.confirm({
            title: '检测到曾绑定的数据目录',
            message:
              '检测到您曾绑定过本地数据目录，但当前浏览器本地数据为空。\n\n' +
              '点击「从绑定目录恢复」：尝试从绑定目录恢复数据（目录中需存在 LockPass-vault.json 同步文件）；\n' +
              '点击「继续创建」：创建全新保险箱（原有同步文件将无法自动找回）。',
            confirmText: '从绑定目录恢复',
            cancelText: '继续创建',
          })
          if (proceed) {
            // D1 修复：对齐原版 restoreFromBoundDirectory → 从目录恢复数据，
            // 恢复后置 initialized=true 并递归复用 handleUnlock 解锁流程，
            // 校验主密码并加载数据，一次输入即完成登录（不再停留锁屏需二次输入）
            let handle = null
            try { handle = await window.FileSync.getDirHandle() } catch (e) {}
            if (!handle) {
              if (!window.FileSync.isSupported()) {
                vaultState.lockError = '当前浏览器不支持文件系统访问 API，请使用 Chrome / Edge 打开'
                vaultState.lockBusy = false
                return
              }
              handle = await window.showDirectoryPicker({ mode: 'readwrite' })
            }
            const restored = await window.FileSync.restoreFromDirectory(handle)
            if (!restored) {
              vaultState.lockError = '未能从绑定目录恢复：目录中缺少 LockPass-vault.json，请点击「绑定已有数据目录」重新选择'
              vaultState.lockBusy = false
              return
            }
            // 恢复成功后 initialized=true（对应原版重建 IndexedDB），
            // 复位 busy 后递归复用解锁流程：校验主密码并加载数据
            vaultState.initialized = true
            vaultState.lockBusy = false
            await handleUnlock(password)
            return
          }
        }
        // D3 修复：创建模式校验主密码长度（对齐原版 password.length < 8 报错）
        if (password.length < 8) {
          vaultState.lockError = '主密码至少需要 8 位'
          vaultState.lockBusy = false
          return
        }
        const { key } = await createVault(password)
        // 首次创建：注入初始状态（与原生 app.js 对齐）
        vaultState.cryptoKey = key
        vaultState.initialized = true
        vaultState.entries = []
        vaultState.history = {}
        vaultState.tagDefs = seedDefaultTagDefs()
        vaultState.tags = []
        vaultState.deleted = []
        // 保存会话密码（与原生一致：内存级，刷新后需重新解锁）
        saveSession(password)
        vaultState.isUnlocked = true
        // 浏览器扩展桥：广播就绪（携带会话令牌）
        try { window.ExtBridge && window.ExtBridge.ready() } catch (e) {}
        // Tauri 本地服务桥：标记就绪（桌面版扩展自动填充用）
        try { window.TauriServer && window.TauriServer.ready() } catch (e) {}
        await afterUnlock(password)
        // D2 修复：首次创建成功后引导绑定数据目录（对齐原版）
        await showBindBannerIfNeeded()
        return
      }

      // 已初始化：解锁
      const { key, data } = await unlockVault(password)
      vaultState.cryptoKey = key
      const migrated = migrateVaultData(data)
      vaultState.entries = migrated.entries
      vaultState.history = migrated.history
      vaultState.tagDefs = migrated.tagDefs
      vaultState.tags = migrated.tags
      vaultState.deleted = migrated.deleted
      if (migrated.changed) await saveVault()

      saveSession(password)
      vaultState.isUnlocked = true
      // 浏览器扩展桥：广播就绪（携带会话令牌）
      try { window.ExtBridge && window.ExtBridge.ready() } catch (e) {}
      // Tauri 本地服务桥：标记就绪（桌面版扩展自动填充用）
      try { window.TauriServer && window.TauriServer.ready() } catch (e) {}
      await afterUnlock()
      // D2 修复：解锁成功后若未绑定数据目录则引导绑定（对齐原版）
      await showBindBannerIfNeeded()
    } catch (e) {
      // 用户取消目录选择（showDirectoryPicker AbortError）：静默停留当前界面（对齐原版）
      if (e && e.name === 'AbortError') return
      vaultState.lockError = e.message || '解锁失败'
    } finally {
      vaultState.lockBusy = false
    }
  }

  async function afterUnlock() {
    closeModal()
    // 同步明文条目到 Tauri 本地服务（桌面版扩展自动填充用；内存级，不落盘）
    try { window.TauriServer && window.TauriServer.setEntries(vaultState.entries) } catch (e) {}
    // 备份提醒 + 自动快照检查（BackupManager 内部容错，失败不阻断解锁）
    try { window.BackupManager && window.BackupManager.checkAfterUnlock() } catch (e) {}
    const savedFilter = restoreFilterFromHash()
    if (savedFilter && savedFilter !== 'all') {
      vaultState.currentFilter = savedFilter
    }
    resetLockTimer()
    vaultState.lockError = ''
  }

  /* ── D2 修复：绑定引导横幅（对齐原版 app.js showBindBannerIfNeeded） ── */

  let _bindBannerDismissedFallback = false // sessionStorage 不可用时的内存降级标记

  async function showBindBannerIfNeeded() {
    // 桌面应用（Tauri，含 Windows/macOS）：数据已自动保存在应用数据目录的
    // 本地文件中，无需也无法绑定数据目录 → 不显示绑定横幅。
    // 统一走 tauri-env.js 的双信号判定（Windows 下 __TAURI__ 注入异常也有兜底），
    // 避免按平台字符串特判漏掉某个桌面系统。
    if (window.LockTauri && window.LockTauri.isTauri) {
      return
    }
    try {
      // 本会话已点过「暂不」则不再显示：优先读 sessionStorage 标记，异常时用内存变量
      let dismissed = false
      try {
        dismissed = !!sessionStorage.getItem('lp_bind_prompted')
      } catch (e) {
        dismissed = _bindBannerDismissedFallback
      }
      if (dismissed) return

      // 同一时刻只保留一个横幅实例：先移除旧的再创建
      const old = document.getElementById('lp-bind-banner')
      if (old) old.remove()

      if (!window.FileSync) return
      const handle = await window.FileSync.getDirHandle()
      if (handle) return // 已绑定数据目录，不显示横幅

      const unsupported = !window.FileSync.isSupported()
      const banner = document.createElement('div')
      banner.id = 'lp-bind-banner'
      banner.setAttribute('role', 'alert')

      const text = unsupported
        ? '当前浏览器不支持本地文件同步，请使用 Chrome / Edge 打开本页面后绑定数据目录'
        : '建议绑定数据目录：绑定后每次修改密码库会自动写入加密的 LockPass-vault.json 文件，即使浏览器清空缓存，数据也不会丢失'

      banner.innerHTML =
        '<div class="lp-bind-banner-inner">' +
          '<span class="lp-bind-banner-text">' + window.Utils.escHtml(text) + '</span>' +
          '<span class="lp-bind-banner-actions">' +
            (unsupported ? '' : '<button class="btn btn-primary btn-sm" id="lp-bind-banner-bind">立即绑定</button>') +
            '<button class="btn btn-secondary btn-sm" id="lp-bind-banner-dismiss">暂不</button>' +
          '</span>' +
        '</div>'

      document.body.insertBefore(banner, document.body.firstChild)

      const bindBtn = document.getElementById('lp-bind-banner-bind')
      if (bindBtn) {
        bindBtn.addEventListener('click', async () => {
          try {
            const out = await window.FileSync.bindDirectory()
            if (out.restored) {
              // 从绑定目录恢复数据：回到锁屏等待解锁（与 SettingsModal.lockVaultAndNotice 对齐）
              lockVault()
              vaultState.initialized = true
              window.Utils.showToast('已从本地文件恢复数据，输入主密码解锁', 'success')
            } else if (out.result && out.result.ok) {
              window.Utils.showToast('已绑定本地目录，数据将自动同步', 'success')
            } else if (out.result && out.result.reason === 'empty') {
              window.Utils.showToast('目录已绑定，创建保险箱后将自动同步', 'success')
            } else {
              window.Utils.showToast('目录已绑定，但同步未完成', 'warning')
            }
            // 仅当确认已保存目录句柄（绑定成功）才移除横幅并刷新状态；用户取消/失败时保留横幅
            const bound = await window.FileSync.getDirHandle()
            if (bound) banner.remove()
          } catch (e) {
            // 绑定失败：保留横幅，允许再次尝试
          }
        })
      }

      const dismissBtn = document.getElementById('lp-bind-banner-dismiss')
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
          banner.remove()
          try { sessionStorage.setItem('lp_bind_prompted', '1') } catch (e) { _bindBannerDismissedFallback = true }
        })
      }
    } catch (e) {
      // 静默忽略：横幅展示失败不阻塞用户进入工作区
    }
  }

  /* ── 从本地文件 / 绑定目录恢复（锁屏入口） ─── */

  function openRestoreFilePicker() {
    const input = document.getElementById('restore-file-input')
    if (input) input.click()
  }

  async function handleRestoreFileSelect(event) {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    try {
      vaultState.lockError = ''
      const payload = JSON.parse(await file.text())
      await window.FileSync.restorePayload(payload)
      // R5 修复：恢复成功即置为已初始化，界面从「创建模式」切换为「输入主密码解锁」
      vaultState.initialized = true
      // R4 修复：恢复成功后不再调用 afterUnlock（仍处于锁屏态），引导用户输入主密码解锁
      window.Utils.showToast('已恢复备份数据，请输入主密码解锁', 'info')
    } catch (e) {
      console.error('恢复失败:', e)
      vaultState.lockError = '恢复失败：' + (e.message || '文件格式不正确或数据损坏')
    }
  }

  async function bindRestoreFromDirectory() {
    try {
      vaultState.lockError = ''
      if (!window.FileSync.isSupported()) {
        vaultState.lockError = '当前浏览器不支持文件系统访问 API，请使用 Chrome / Edge 打开'
        return
      }
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' })
      const restored = await window.FileSync.restoreFromDirectory(dir)
      if (!restored) {
        vaultState.lockError = '目录中未找到 LockPass-vault.json，未执行恢复'
        return
      }
      // R5 修复：恢复成功即置为已初始化，界面从「创建模式」切换为「输入主密码解锁」
      vaultState.initialized = true
      // R4 修复：恢复成功后不再调用 afterUnlock（仍处于锁屏态），引导用户输入主密码解锁
      window.Utils.showToast('已恢复备份数据，请输入主密码解锁', 'info')
    } catch (e) {
      console.error('绑定目录恢复失败:', e)
      if (e && e.name === 'AbortError') return // 用户取消选择
      vaultState.lockError = '绑定目录恢复失败：' + (e.message || '未知错误')
    }
  }

  /* ── 快捷键辅助 ────────────────────────────── */

  function editCurrentEntry() {
    if (!vaultState.selectedEntry) return
    openEntryModal(vaultState.selectedEntry.id)
  }

  /* ── 锁定 / 退出 ────────────────────────────── */

  function lockVault() {
    vaultState.isUnlocked = false
    vaultState.cryptoKey = null
    // 浏览器扩展桥：令牌清除 + 广播锁定
    try { window.ExtBridge && window.ExtBridge.lock() } catch (e) {}
    // Tauri 本地服务桥：清空内存中的明文条目与解锁标记
    try { window.TauriServer && window.TauriServer.lock() } catch (e) {}
    clearSession()
    clearTimeout(vaultState.lockTimer)
    closeDetail()
    vaultState.lockError = ''
    vaultState.activeModal = null
    vaultState.editingEntryId = null
    // 锁定时清空明文滞留（R2 修复）：防止 entries/tags/回收站等敏感数据残留在内存
    vaultState.entries = []
    vaultState.tagDefs = {}
    vaultState.tags = []
    vaultState.deleted = []
    vaultState.selectedEntry = null
  }

  function logout() {
    // 浏览器扩展桥：令牌清除 + 广播锁定
    try { window.ExtBridge && window.ExtBridge.lock() } catch (e) {}
    // Tauri 本地服务桥：清空内存中的明文条目与解锁标记
    try { window.TauriServer && window.TauriServer.lock() } catch (e) {}
    clearSession()
    vaultState.cryptoKey = null
    vaultState.isUnlocked = false
    vaultState.entries = []
    vaultState.tagDefs = {}
    vaultState.tags = []
    // S1 修复：与 lockVault 对齐，补清回收站与界面状态，杜绝明文滞留
    vaultState.deleted = []
    vaultState.selectedEntry = null
    vaultState.activeModal = null
    vaultState.editingEntryId = null
    vaultState.lockError = ''
    if (vaultState.lockTimer) {
      clearTimeout(vaultState.lockTimer)
      vaultState.lockTimer = null
    }
    window.Utils.showToast('已退出登录', 'success')
  }

  /* ── 自动锁定 ───────────────────────────────── */

  function resetLockTimer() {
    clearTimeout(vaultState.lockTimer)
    if (vaultState.lockTimeoutMs > 0) {
      vaultState.lockTimer = setTimeout(lockVault, vaultState.lockTimeoutMs)
    }
  }

  /* ── 筛选 / 统计 ────────────────────────────── */

  function setFilter(filter) {
    vaultState.currentFilter = filter
    if (filter === 'recycle') closeDetail()
    // 更新 URL hash（用于刷新后保持状态），与原生 setFilter 行为一致
    try {
      const hash = filter === 'all' ? '' : `#filter=${encodeURIComponent(filter)}`
      history.replaceState(null, '', hash || window.location.pathname)
    } catch (e) {}
  }

  function restoreFilterFromHash() {
    const m = location.hash.match(/[#&]filter=([^&]+)/)
    return m ? decodeURIComponent(m[1]) : null
  }

  function getFilteredEntries() {
    let list

    if (vaultState.currentFilter === 'recycle') {
      list = vaultState.deleted
    } else {
      list = vaultState.entries
      if (vaultState.currentFilter === 'favorites') {
        list = list.filter(e => e.favorite)
      } else if (vaultState.currentFilter.startsWith('type:')) {
        const type = vaultState.currentFilter.slice(5)
        list = list.filter(e => (e.entryType || 'website') === type)
      } else if (vaultState.currentFilter !== 'all') {
        list = list.filter(e => (e.tags || []).includes(vaultState.currentFilter))
      }
    }

    const query = vaultState.searchQuery.trim().toLowerCase()
    if (query) {
      list = list.filter(e =>
        (e.title || '').toLowerCase().includes(query) ||
        (e.username || '').toLowerCase().includes(query) ||
        (e.url || '').toLowerCase().includes(query) ||
        (e.tags || []).some(t => t.toLowerCase().includes(query)),
      )
    }

    if (vaultState.currentFilter === 'recycle') {
      return list.slice().sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0))
    }

    return list.slice().sort((a, b) => {
      if ((b.favorite || false) !== (a.favorite || false)) {
        return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
      }
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    })
  }

  function getEntryById(id) {
    return vaultState.entries.find(e => e.id === id) || vaultState.deleted.find(e => e.id === id) || null
  }

  function computeSidebarStats() {
    const stats = { total: 0, favorites: 0, recycle: 0, byType: {}, byTag: {} }
    const typeMap = {}
    ENTRY_TYPES.forEach(t => { typeMap[t.id] = 0 })
    const tagCount = {}

    vaultState.entries.forEach(e => {
      stats.total++
      if (e.favorite) stats.favorites++
      const type = e.entryType || 'website'
      if (type in typeMap) typeMap[type]++
      ;(e.tags || []).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1 })
    })
    stats.recycle = vaultState.deleted.length
    stats.byType = typeMap
    stats.byTag = tagCount
    return stats
  }

  function getTopTags(limit = 8) {
    const stats = computeSidebarStats()
    return Object.keys(stats.byTag)
      .map(name => ({ name, count: stats.byTag[name] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  }

  /* ── 条目操作 ───────────────────────────────── */

  function selectEntry(id, event) {
    if (event) event.stopPropagation()
    const entry = getEntryById(id)
    if (!entry) return
    const panel = document.getElementById('detail-panel')
    const alreadyOpen = !!panel?.classList.contains('open')
    const sameEntry = vaultState.selectedEntry === id
    vaultState.selectedEntry = id
    if (alreadyOpen && !sameEntry) {
      // 收回再弹出动画（对齐原版 entries.js selectEntry）
      clearTimeout(vaultState.detailAnimTimer)
      panel.classList.remove('open')
      panel.classList.add('animating')
      vaultState.detailAnimTimer = setTimeout(() => {
        panel.classList.add('open')
        vaultState.detailAnimTimer = setTimeout(() => panel.classList.remove('animating'), 30)
      }, 320)
    } else if (panel) {
      panel.classList.add('open')
    }
  }

  function closeDetail() {
    clearTimeout(vaultState.detailAnimTimer)
    const panel = document.getElementById('detail-panel')
    panel?.classList.remove('open', 'animating')
    vaultState.selectedEntry = null
  }

  async function toggleFavorite(id) {
    const entry = vaultState.entries.find(e => e.id === id)
    if (!entry) return
    entry.favorite = !entry.favorite
    entry.updatedAt = new Date().toISOString()
    await saveVault()
  }

  async function softDelete(id) {
    if (!id) return
    const confirmed = await window.Utils.confirm({
      title: '删除密码',
      message: '将移入回收站，您可以在回收站中恢复或彻底删除。',
      confirmText: '移入回收站',
      danger: true,
    })
    if (!confirmed) return

    const idx = vaultState.entries.findIndex(e => e.id === id)
    if (idx === -1) return
    const entry = vaultState.entries[idx]
    entry.deletedAt = new Date().toISOString()
    vaultState.entries.splice(idx, 1)
    vaultState.deleted.push(entry)

    await saveVault()
    if (vaultState.selectedEntry === id) closeDetail()
    window.Utils.showToast('已移入回收站', 'success')
  }

  async function restoreEntry(id) {
    const idx = vaultState.deleted.findIndex(e => e.id === id)
    if (idx === -1) return
    const entry = vaultState.deleted[idx]
    delete entry.deletedAt
    vaultState.deleted.splice(idx, 1)
    vaultState.entries.push(entry)

    await saveVault()
    if (vaultState.selectedEntry === id) closeDetail()
    window.Utils.showToast('已恢复', 'success')
  }

  async function permanentDelete(id) {
    const confirmed = await window.Utils.confirm({
      title: '彻底删除',
      message: '此操作不可撤销，密码将被永久删除。',
      confirmText: '彻底删除',
      danger: true,
    })
    if (!confirmed) return

    vaultState.deleted = vaultState.deleted.filter(e => e.id !== id)
    // 彻底删除后清理该条目的密码历史（无主数据不保留）
    if (vaultState.history[id]) {
      delete vaultState.history[id]
      vaultState.history = { ...vaultState.history }
    }
    await saveVault()
    if (vaultState.selectedEntry === id) closeDetail()
    window.Utils.showToast('已彻底删除', 'success')
  }

  async function emptyRecycleBin() {
    if (!vaultState.deleted.length) {
      window.Utils.showToast('回收站已经是空的', 'info')
      return
    }
    const confirmed = await window.Utils.confirm({
      title: '清空回收站',
      message: '将永久删除回收站中的 ' + vaultState.deleted.length + ' 项密码，此操作不可撤销。',
      confirmText: '清空',
      danger: true,
    })
    if (!confirmed) return

    const deadIds = vaultState.deleted.map(e => e.id)
    vaultState.deleted = []
    // 清空回收站时同步清理这些条目的密码历史
    if (deadIds.length) {
      const keep = {}
      Object.keys(vaultState.history).forEach(id => {
        if (!deadIds.includes(id)) keep[id] = vaultState.history[id]
      })
      vaultState.history = keep
    }
    await saveVault()
    if (vaultState.currentFilter === 'recycle') closeDetail()
    window.Utils.showToast('回收站已清空', 'success')
  }

  /* ── 剪贴板 ────────────────────────────────── */

  let clipboardCleanupFn = null

  // 兼容复制：WKWebView/旧环境在 clipboard API 不可用时的最后手段
  // （须在用户手势调用链内执行；execCommand 虽已废弃但桌面 WebView 支持稳定）
  function legacyCopy(text) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch (e) { ok = false }
    ta.remove()
    return ok
  }

  async function copyToClipboard(text, entryId = null, btnEl = null) {
    // 写入主链路：成功后立即提示；失败降级 execCommand，再失败才报错
    // （真实错误随 Toast 透出，不再被统一文案吞掉）
    let clipboardOk = false
    let writeError = ''
    try {
      await navigator.clipboard.writeText(text)
      clipboardOk = true
    } catch (e) {
      writeError = (e && e.message) || String(e)
      try {
        clipboardOk = legacyCopy(text)
        if (clipboardOk) console.warn('[clipboard] 主通道失败，已用兼容模式复制:', writeError)
      } catch (e2) {
        writeError = writeError || String((e2 && e2.message) || e2)
      }
    }
    if (!clipboardOk) {
      console.error('[clipboard] 复制失败:', writeError)
      window.Utils.showToast('复制失败：' + (writeError || '未知错误'), 'error')
      return false
    }
    window.Utils.showToast('已复制到剪贴板', 'success')
    try {

      // ── 浮动「已复制」提示（靠近按钮位置，对齐原版 entries.js） ──
      let cleanupFloatTip = null
      if (btnEl) {
        const floatTip = document.createElement('div')
        floatTip.textContent = '✓ 已复制'
        Object.assign(floatTip.style, {
          position: 'fixed',
          top: '-28px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--accent, #4f86f7)',
          color: '#fff',
          fontSize: '11px',
          padding: '2px 7px',
          borderRadius: '8px',
          pointerEvents: 'none',
          zIndex: '99999',
          whiteSpace: 'nowrap',
          opacity: '1',
          transition: 'opacity 0.4s',
        })
        const rect = btnEl.getBoundingClientRect()
        floatTip.style.left = rect.left + rect.width / 2 + 'px'
        floatTip.style.top = rect.top + 'px'
        document.body.appendChild(floatTip)
        cleanupFloatTip = () => floatTip.remove()
        setTimeout(() => {
          if (floatTip.parentNode) {
            floatTip.style.opacity = '0'
            setTimeout(() => floatTip.remove(), 400)
          }
        }, 1200)
      }

      // 清除旧的定时器与浮动提示
      clearTimeout(vaultState.clipboardTimer)
      const prevCleanup = clipboardCleanupFn
      clipboardCleanupFn = () => {
        if (cleanupFloatTip) cleanupFloatTip()
        if (prevCleanup) prevCleanup()
      }

      // 自动清除剪贴板（macOS 无手势场景走 LockClipboard 主线程命令）
      vaultState.clipboardTimer = setTimeout(async () => {
        try {
          if (window.LockClipboard) await window.LockClipboard.write('')
          else await navigator.clipboard.writeText('')
        } catch (e) {}
        const note = document.getElementById('clipboard-note')
        if (note) note.classList.add('hidden')
        if (clipboardCleanupFn) {
          clipboardCleanupFn()
          clipboardCleanupFn = null
        }
      }, vaultState.clipboardClearMs)

      // 详情面板倒计时提示（对齐原版 entries.js clipboard-note）
      if (entryId === vaultState.selectedEntry) {
        const note = document.getElementById('clipboard-note')
        if (note) {
          note.classList.remove('hidden')
          let remaining = vaultState.clipboardClearMs / 1000
          note.innerHTML = `✓ 已复制，${remaining}秒后清除`
          // 清除上一次的倒计时 interval，避免多个定时器同时运行
          if (vaultState.clipboardNoteTimer) clearInterval(vaultState.clipboardNoteTimer)
          vaultState.clipboardNoteTimer = setInterval(() => {
            remaining--
            if (note) note.innerHTML = `✓ 已复制，${remaining}秒后清除`
            if (remaining <= 0) {
              clearInterval(vaultState.clipboardNoteTimer)
              vaultState.clipboardNoteTimer = null
              if (note) note.classList.add('hidden')
            }
          }, 1000)
        }
      }

      // 卡片复制按钮高亮（对齐原版 .copy-btn.copied）
      if (entryId) {
        document.querySelectorAll(`.entry-card[data-id="${CSS.escape(String(entryId))}"] .copy-btn`).forEach(b => {
          b.classList.add('copied')
          setTimeout(() => b.classList.remove('copied'), 1500)
        })
      }
      clipboardCleanupFn = null
    } catch (uiErr) {
      // 写入已成功；纯 UI 装饰异常不影响复制结果
      console.warn('[clipboard] 复制后 UI 提示异常:', uiErr)
    }
    return true
  }

  async function copyPassword(id, btnEl = null) {
    const entry = getEntryById(id)
    if (!entry) return
    // 与原生 copyDetailPassword 一致：app 类型取 App ID（无则取公钥/密码）
    let val = entry.password
    if ((entry.entryType || 'website') === 'app') val = entry.appId || entry.password
    await copyToClipboard(val || '', id, btnEl)
  }

  async function copyField(value, btnEl = null) {
    await copyToClipboard(value || '', null, btnEl)
  }

  function toggleDetailPassword() {
    // 密码显隐按条目 ID 记忆（独立于 entry 数据对象，不随加密 vault 持久化）
    if (!vaultState.selectedEntry) return
    const id = vaultState.selectedEntry
    vaultState.showPasswordMap[id] = !vaultState.showPasswordMap[id]
  }

  /* ── 模态框 ────────────────────────────────── */

  function openEntryModal(entryId = null) {
    vaultState.sidebarOpen = false
    vaultState.editingEntryId = entryId
    vaultState.activeModal = 'entry'
  }

  function openModal(name) {
    vaultState.sidebarOpen = false
    vaultState.activeModal = name
  }

  function closeModal() {
    vaultState.activeModal = null
    vaultState.editingEntryId = null
  }

  /* ── 保存条目（编辑器回调） ─────────────────── */

  /* ── 修改历史与回滚（v1.0.x：任意字段变更均记录） ───────
     记录范围：编辑保存时任意内容字段变更都生成一条记录（不只密码）；
     快照内容：修改前可回滚字段的深拷贝 + 变更字段列表（整体随 vault 加密，不参与导入导出）。
     回滚语义：确认弹窗防误操作；执行成功即删除该条记录（防重复执行）；
               回滚本身不新增记录（回滚不是编辑）。
     兼容：旧版仅含 { password, at } 的密码快照仍可展示与回滚（只恢复密码）。
     保留策略：每条目最多 HISTORY_LIMIT 条，最新在前。 */
  const HISTORY_LIMIT = 5
  /* 参与历史记录/回滚的内容字段（favorite / showPassword 等状态位不入史） */
  const HISTORY_FIELDS = ['title', 'entryType', 'username', 'password', 'url', 'port', 'notes', 'tags', 'root', 'appId', 'privateKey']
  const HISTORY_FIELD_LABELS = {
    title: '标题', entryType: '类型', username: '用户名', password: '密码',
    url: '网址/地址', port: '端口', notes: '备注', tags: '标签',
    root: 'Root 账号', appId: 'App ID', privateKey: '私钥',
  }

  function histEq(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      const x = Array.isArray(a) ? a : [], y = Array.isArray(b) ? b : []
      return x.length === y.length && x.every((v, i) => histEq(v, y[i]))
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      return [...keys].every(k => histEq(a[k], b[k]))
    }
    return (a == null ? '' : a) === (b == null ? '' : b)
  }

  /* 取条目可回滚字段的深拷贝，避免之后原地改数组/对象污染已存历史 */
  function materialOf(e) {
    const out = {}
    HISTORY_FIELDS.forEach(k => {
      const v = e[k]
      if (v === undefined) return
      out[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v
    })
    return out
  }

  function diffKeys(a, b) {
    return HISTORY_FIELDS.filter(k => !histEq(a[k], b[k]))
  }

  /* 编辑保存时记录旧状态；fields 为本次变更字段列表（展示与确认提示用）
     与最新一条快照完全相同则不重复记录（旧版仅密码记录不做全量比对去重） */
  function recordEntryHistory(id, prevEntry, nextEntry, at) {
    if (!id || !prevEntry) return
    const list = vaultState.history[id] || []
    const newest = list[0]
    if (newest && newest.snap && histEq(materialOf(prevEntry), newest.snap)) return
    const fields = diffKeys(prevEntry, nextEntry)
    if (!fields.length) return
    list.unshift({ at, snap: materialOf(prevEntry), fields })
    vaultState.history[id] = list.slice(0, HISTORY_LIMIT)
  }

  /* 该历史版本与当前条目是否存在可执行差异（旧版仅密码记录只比密码） */
  function snapDiffers(entry, snap) {
    if (!entry || !snap) return false
    const target = snap.snap || { password: snap.password }
    return Object.keys(target).some(k => HISTORY_FIELDS.includes(k) && !histEq(target[k], entry[k]))
  }

  function describeHistoryFields(fields) {
    return (fields || []).map(f => HISTORY_FIELD_LABELS[f] || f).join('、')
  }

  async function rollbackEntry(id, at) {
    const entry = vaultState.entries.find(e => e.id === id)
    const list = vaultState.history[id] || []
    const snap = list.find(s => s.at === at)
    if (!entry || !snap) {
      window.Utils.showToast('历史记录不存在或已过期', 'error')
      return false
    }
    const target = snap.snap || { password: snap.password } // 旧版记录仅含密码
    if (!snapDiffers(entry, snap)) {
      window.Utils.showToast('当前数据已是该版本', 'info')
      return false
    }
    // 确认弹窗防误操作：回滚覆盖当前数据且不留存当前副本
    const fieldText = snap.snap ? (describeHistoryFields(snap.fields) || '全部字段') : '密码'
    const ok = await window.Utils.confirm({
      title: '确认回滚',
      message: `将把该条目恢复到所选历史版本（覆盖：${fieldText}）。\n当前数据将被覆盖且不会保存副本，该条历史执行后删除，是否继续？`,
      confirmText: '回滚',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return false
    Object.keys(target).forEach(k => {
      const v = target[k]
      entry[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v
    })
    entry.updatedAt = new Date().toISOString()
    // 执行成功即删除被执行的记录；回滚不是编辑，不新增历史
    const remain = list.filter(s => s !== snap)
    if (remain.length) vaultState.history[id] = remain
    else delete vaultState.history[id]
    vaultState.history = { ...vaultState.history }
    await saveVault()
    window.Utils.showToast('已回滚到历史版本', 'success')
    return true
  }

  // 浏览器扩展桥：注册条目数据源（扩展仅能拿到脱敏列表，解密请求经页面内存处理）
  try { window.ExtBridge && window.ExtBridge.setEntriesProvider(() => vaultState.entries) } catch (e) {}

  async function saveEntry(payload) {
    const { title, type, fields, tags, notes } = payload
    if (!title || !title.trim()) {
      window.Utils.showToast('请输入标题', 'error')
      return false
    }
    const passwordField = fields.password
    // D10 修复：对齐原版——app 类型可不填密码（只需 App ID），其余类型按需必填
    if (type === 'website' || type === 'server' || type === 'database') {
      if (!passwordField) {
        window.Utils.showToast('请输入密码', 'error')
        return false
      }
    } else if (type === 'ai') {
      if (!passwordField) {
        window.Utils.showToast('请输入 Token', 'error')
        return false
      }
    } else if (type === 'other') {
      if (!passwordField) {
        window.Utils.showToast('请输入凭证值', 'error')
        return false
      }
    }

    const id = vaultState.editingEntryId || crypto.randomUUID()
    const now = new Date().toISOString()

    const base = {
      id,
      title: title.trim(),
      entryType: type,
      tags: tags || [],
      notes: notes || '',
      // D5 修复：对齐原版数据模型，密码显隐按条目记忆
      showPassword: false,
      updatedAt: now,
    }
    if (!vaultState.editingEntryId) base.createdAt = now

    const entry = { ...base, ...fields }
    if (type === 'server' && (fields.rootUser || fields.rootPwd)) {
      entry.root = { username: fields.rootUser || '', password: fields.rootPwd || '' }
    }
    delete entry.rootUser
    delete entry.rootPwd
    // C2 修复：统一 url/password 数据模型，删除遗留旧字段（host/baseUrl/apiKey）
    delete entry.host
    delete entry.baseUrl
    delete entry.apiKey

    if (vaultState.editingEntryId) {
      const idx = vaultState.entries.findIndex(e => e.id === vaultState.editingEntryId)
      if (idx !== -1) {
        const oldEntry = vaultState.entries[idx]
        // 任意内容字段有变更都生成历史记录（默认保留最近 5 版）
        recordEntryHistory(entry.id, oldEntry, entry, now)
        vaultState.entries[idx] = entry
      }
      // 保存成功后清除草稿缓存
      try { sessionStorage.removeItem('lockpass_draft_edit_' + vaultState.editingEntryId) } catch (e) {}
    } else {
      vaultState.entries.unshift(entry)
      try { sessionStorage.removeItem('lockpass_draft_new') } catch (e) {}
    }

    await saveVault()
    closeModal()
    window.Utils.showToast('已保存', 'success')
    return true
  }

  return {
    vaultState,
    getSession,
    saveSession,
    boot,
    checkVaultStatus,
    createVault,
    unlockVault,
    saveVault,
    handleUnlock,
    afterUnlock,
    showBindBannerIfNeeded,
    lockVault,
    logout,
    resetLockTimer,
    setFilter,
    restoreFilterFromHash,
    getFilteredEntries,
    getEntryById,
    computeSidebarStats,
    getTopTags,
    selectEntry,
    closeDetail,
    toggleFavorite,
    softDelete,
    restoreEntry,
    permanentDelete,
    emptyRecycleBin,
    copyToClipboard,
    copyPassword,
    copyField,
    toggleDetailPassword,
    openEntryModal,
    openModal,
    closeModal,
    saveEntry,
    rollbackEntry,
    snapDiffers,
    describeHistoryFields,
    openRestoreFilePicker,
    handleRestoreFileSelect,
    bindRestoreFromDirectory,
    editCurrentEntry,
  }
}
