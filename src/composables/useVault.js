/* ═══════════════════════════════════════════════════════════════════
   LockPass — Vue 全局状态与核心操作
   Vue 3 迁移：复刻 app.js / entries.js / ui.js 的应用逻辑与数据流。
   加密、存储、同步等底层能力仍由 core/ 模块提供（零改动）。
   ═══════════════════════════════════════════════════════════════════ */

import { reactive, nextTick } from 'vue'
// 自定义字段类型枚举（core/templates.js，upgrade-design.md §1.2）
import { CUSTOM_FIELD_TYPES } from '../core/templates.js'
// S1 修复（分级缓存）：editorDraftStore.js —— 锁定/登出时清空内存全量明文；
// 保存成功路径按 key 清内存+脱敏 storage（saveEntry 内调用 clearDraft）
import {
  clearAllDrafts as memClearAllEditorDrafts,
  clearDraft as memClearEditorDraft,
} from './editorDraftStore.js'

/* i18n：Toast 在调用时求值（window.I18n 由 core/i18n.js 挂载） */
const t = (k, p) => window.I18n.t(k, p)

/* ── 常量定义（与原生版一致） ─────────────────────────────── */

export const ENTRY_TYPES = [
  { id: 'website', label: '网站', labelKey: 'entry.type.website', icon: 'globe' },
  { id: 'server', label: '服务器', labelKey: 'entry.type.server', icon: 'server' },
  { id: 'database', label: '数据库', labelKey: 'entry.type.database', icon: 'database' },
  { id: 'ai', label: 'AI', labelKey: 'entry.type.ai', icon: 'ai' },
  { id: 'app', label: '应用', labelKey: 'entry.type.app', icon: 'app' },
  { id: 'other', label: '其他', labelKey: 'entry.type.other', icon: 'other' },
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
  lockTimer: null,
  lockTimeoutMs: loadSettingInt('lockpass_lock_timeout', 5 * 60 * 1000),
  clipboardClearMs: loadSettingInt('lockpass_clipboard_clear', 30 * 1000),
  // C4 回收站自动清空：0 = 从不；30/60/90 = 天数（localStorage lockpass_recycle_ttl）
  recycleTtlDays: loadSettingInt('lockpass_recycle_ttl', 0),
  recycleTimer: null,
  initialized: false,
  hasBindingHistory: false,
  booted: false,
  // 模态框状态（activeModal: 'entry' | 'settings' | 'import' | 'export' | 'qr-import' | 'qr-share' | 'change-pw' | 'tags'）
  activeModal: null,
  editingEntryId: null,
  // 编辑器打开意图（草稿生命周期 v1.1.12b）：openEntryModal 第二参写入，编辑器挂载即消费
  //   { presetType: 'website'|... } → 新建预选类型（不写草稿，避免空骨架误触发询问）
  //   { draftAction: 'use' }        → 复制为新条目流：跳过询问直接恢复刚写入的草稿
  editorOpenOpts: null,
  // 密码生成器独立弹窗（不占用 activeModal，可叠加在 EntryEditorModal 之上）
  // target: null=无目标字段（仅复制） | { source: 'entry', field: 'password'|'rootPwd' }
  pwGenVisible: false,
  pwGenTarget: null,
  // 填入回填请求：EntryEditorModal watch 到非ce 递增后回填字段并自动隐藏
  pwGenFillNonce: 0,
  pwGenFillValue: '',
  // 详情面板收回再弹出动画状态（P2-6 修复：由 DetailPanel 类绑定响应式驱动）
  // detailAnim: null（静止打开）| 'collapse'（收回中，open 暂时挂起）| 'reopen'（弹出中）
  detailAnim: null,
  detailAnimTimer: null,
  // 侧边栏（移动端抽屉）
  sidebarOpen: false,
  // 锁屏交互状态
  lockError: '',
  lockBusy: false,
  // 屏幕阅读器实时通知文本
  srAnnounce: '',
  // 复制成功倒计时胶囊状态（CopyCountdownPill 组件消费）
  clipboardCountdown: { active: false, remaining: 0, total: 0 },
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

/**
 * 清空全部编辑器草稿（锁定 / 退出登录时调用）。
 * S1 分级策略：此处调用 memClearAllEditorDrafts 只清空「内存全量明文」
 * （含 password/privateKey/rootPwd 等敏感字段，驻留即刻终止）；sessionStorage
 * 中仅存脱敏元数据子集（lockpass_safe_draft_*，无机密语义），可保留供下次
 * 解锁后恢复表单骨架。同时兜底清除旧版本可能残留的 lockpass_draft_* 明文草稿。
 */
function clearEditorDrafts() {
  try { memClearAllEditorDrafts() } catch (e) { /* 内存清理异常不影响主流程 */ }
  try {
    const staleKeys = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.indexOf('lockpass_draft_') === 0) staleKeys.push(k)
    }
    staleKeys.forEach(k => sessionStorage.removeItem(k))
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
    // 自定义字段扩展（upgrade-design.md §1.3）：旧版条目补默认空数组
    if (!Array.isArray(e.customFields)) e.customFields = []
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
    if (!saltRecord) throw new Error(t('vault.err.noVault'))

    const salt = window.CryptoUtils.base64ToArrayBuffer(saltRecord.value)
    const iterRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'iterations')
    const iterations = iterRecord ? (Number(iterRecord.value) || window.CryptoUtils.LEGACY_ITERATIONS) : window.CryptoUtils.LEGACY_ITERATIONS
    const key = await window.CryptoUtils.deriveKey(password, new Uint8Array(salt), iterations)

    const vaultRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_VAULT, 'main')
    if (!vaultRecord) throw new Error(t('vault.err.noEntries'))

    try {
      const decrypted = await window.CryptoUtils.decrypt(vaultRecord.data, vaultRecord.iv, key)
      return { key, data: decrypted }
    } catch (e) {
      throw new Error(t('vault.err.wrongPw'))
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
  // 最近一次真实写入是否成功（草稿生命周期 v1.1.12b：保存失败须保留草稿可重试）
  let lastSaveOk = true

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
    list.forEach((r) => r(lastSaveOk))
  }

  /**
   * 防抖合并写盘。返回 Promise<boolean>：true=真实落盘成功；
   * false=写入失败（doSave 抛错，失败 toast 已在此弹出）。
   * 现有调用方 `await saveVault()` 忽略返回值的行为不受影响。
   */
  function saveVault() {
    if (!vaultState.cryptoKey) return Promise.resolve(true)
    if (saveTimer) clearTimeout(saveTimer)
    return new Promise((resolve) => {
      saveResolvers.push(resolve)
      saveTimer = setTimeout(() => {
        saveTimer = null
        lastSaveOk = false
        saveChain = saveChain
          .then(() => doSave())
          .then(() => { lastSaveOk = true })
          .catch((e) => {
            lastSaveOk = false
            console.error('保存失败:', e)
            window.Utils.showToast(t('toast.saveFailed', { msg: e.message || t('toast.unknownError') }), 'error')
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
      vaultState.lockError = t('vault.lock.pwEmpty')
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
            title: t('vault.restore.title'),
            message:
              t('vault.restore.msg1') +
              t('vault.restore.msg2') +
              t('vault.restore.msg3'),
            confirmText: t('vault.restore.btnRestore'),
            cancelText: t('vault.restore.btnCreate'),
          })
          if (proceed) {
            // D1 修复：对齐原版 restoreFromBoundDirectory → 从目录恢复数据，
            // 恢复后置 initialized=true 并递归复用 handleUnlock 解锁流程，
            // 校验主密码并加载数据，一次输入即完成登录（不再停留锁屏需二次输入）
            let handle = null
            try { handle = await window.FileSync.getDirHandle() } catch (e) {}
            if (!handle) {
              if (!window.FileSync.isSupported()) {
                vaultState.lockError = t('vault.lock.noFs')
                vaultState.lockBusy = false
                return
              }
              handle = await window.showDirectoryPicker({ mode: 'readwrite' })
            }
            const restored = await window.FileSync.restoreFromDirectory(handle)
            if (!restored) {
              vaultState.lockError = t('vault.restore.failedNoFile')
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
          vaultState.lockError = t('vault.lock.pwTooShort')
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
        // C4 回收站自动清空：解锁后立即检查一次 + 启动每日检查
        purgeExpiredRecycle()
        startRecycleTimer()
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
      // C4 回收站自动清空：解锁后立即检查一次 + 启动每日检查
      purgeExpiredRecycle()
      startRecycleTimer()
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
      vaultState.lockError = e.message || t('vault.lock.unlockFailed')
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
        ? t('vault.sync.noFs')
        : t('vault.sync.hint')

      banner.innerHTML =
        '<div class="lp-bind-banner-inner">' +
          '<span class="lp-bind-banner-text">' + window.Utils.escHtml(text) + '</span>' +
          '<span class="lp-bind-banner-actions">' +
            (unsupported ? '' : '<button class="btn btn-primary btn-sm" id="lp-bind-banner-bind">' + t('vault.sync.btnBind') + '</button>') +
            '<button class="btn btn-secondary btn-sm" id="lp-bind-banner-dismiss">' + t('vault.sync.btnDismiss') + '</button>' +
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
              window.Utils.showToast(t('toast.restoredFromFile'), 'success')
            } else if (out.result && out.result.ok) {
              window.Utils.showToast(t('toast.dirBoundAutoSync'), 'success')
            } else if (out.result && out.result.reason === 'empty') {
              window.Utils.showToast(t('toast.dirBoundCreateFirst'), 'success')
            } else {
              window.Utils.showToast(t('toast.dirBoundSyncIncomplete'), 'warning')
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
      window.Utils.showToast(t('toast.restoredFromBackup'), 'info')
    } catch (e) {
      console.error('恢复失败:', e)
      vaultState.lockError = t('vault.restore.failedBad') + (e.message || t('vault.restore.badFormat'))
    }
  }

  async function bindRestoreFromDirectory() {
    try {
      vaultState.lockError = ''
      // Tauri 桌面版数据由本地文件管理，目录同步是浏览器版专属能力
      if ((window.FileStore && window.FileStore.isTauri) || window.__TAURI_INTERNALS__) {
        vaultState.lockError = t('vault.restore.desktopAuto')
        return
      }
      if (!window.FileSync.isSupported()) {
        vaultState.lockError = '当前浏览器不支持文件系统访问 API，请使用 Chrome / Edge 打开'
        return
      }
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' })
      const restored = await window.FileSync.restoreFromDirectory(dir)
      if (!restored) {
        vaultState.lockError = t('vault.restore.noVaultFile')
        return
      }
      // R5 修复：恢复成功即置为已初始化，界面从「创建模式」切换为「输入主密码解锁」
      vaultState.initialized = true
      // R4 修复：恢复成功后不再调用 afterUnlock（仍处于锁屏态），引导用户输入主密码解锁
      window.Utils.showToast(t('toast.restoredFromBackup'), 'info')
    } catch (e) {
      console.error('绑定目录恢复失败:', e)
      if (e && e.name === 'AbortError') return // 用户取消选择
      vaultState.lockError = t('vault.restore.bindFailed') + (e.message || t('vault.restore.unknown'))
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
    if (vaultState.recycleTimer) {
      clearInterval(vaultState.recycleTimer)
      vaultState.recycleTimer = null
    }
    closeDetail()
    vaultState.lockError = ''
    vaultState.activeModal = null
    vaultState.editingEntryId = null
    // 锁定时清空明文滞留（R2 修复）：防止 entries/tags/回收站等敏感数据残留在内存
    vaultState.entries = []
    vaultState.history = {} // P1-1 修复：历史快照含修改前明文密码/root/私钥，必须一并清空
    vaultState.tagDefs = {}
    vaultState.tags = []
    vaultState.deleted = []
    vaultState.selectedEntry = null
    // 清除密码显示自动隐藏计时器
    Object.keys(_pwHideTimers).forEach(k => { clearTimeout(_pwHideTimers[k]); delete _pwHideTimers[k] })
    vaultState.showPasswordMap = {}
    // P1-2 修复：锁定即安全边界，编辑器草稿（含明文）一并清除
    clearEditorDrafts()
    // S2 修复：锁定即主动清空系统剪贴板明文（不等 30s 自清定时器）
    clearClipboardNow()
  }

  function logout() {
    // 浏览器扩展桥：令牌清除 + 广播锁定
    try { window.ExtBridge && window.ExtBridge.lock() } catch (e) {}
    // Tauri 本地服务桥：清空内存中的明文条目与解锁标记
    try { window.TauriServer && window.TauriServer.lock() } catch (e) {}
    clearSession()
    vaultState.cryptoKey = null
    vaultState.isUnlocked = false
    if (vaultState.recycleTimer) {
      clearInterval(vaultState.recycleTimer)
      vaultState.recycleTimer = null
    }
    vaultState.entries = []
    vaultState.tagDefs = {}
    vaultState.tags = []
    // S1 修复：与 lockVault 对齐，补清回收站与界面状态，杜绝明文滞留
    vaultState.deleted = []
    vaultState.selectedEntry = null
    vaultState.history = {} // P1-1 修复：历史快照含明文，退出登录必须清空
    vaultState.activeModal = null
    vaultState.editingEntryId = null
    vaultState.lockError = ''
    // 清除密码显示自动隐藏计时器
    Object.keys(_pwHideTimers).forEach(k => { clearTimeout(_pwHideTimers[k]); delete _pwHideTimers[k] })
    vaultState.showPasswordMap = {}
    // P1-2 修复：退出登录清除编辑器草稿（含明文）
    clearEditorDrafts()
    // S2 修复：退出登录即主动清空系统剪贴板明文（不等 30s 自清定时器）
    clearClipboardNow()
    if (vaultState.lockTimer) {
      clearTimeout(vaultState.lockTimer)
      vaultState.lockTimer = null
    }
    window.Utils.showToast(t('toast.loggedOut'), 'success')
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
    const isRecycle = vaultState.currentFilter === 'recycle'

    if (isRecycle) {
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

    // B5 搜索增强：前缀命中 > 子串命中 > 拼音首字母命中，收藏/最近更新优先（src/core/search.js）
    const query = vaultState.searchQuery.trim()
    const results = window.SearchUtil.searchEntries(list, query)

    if (isRecycle) {
      // 回收站视图保持 deletedAt 倒序
      return results.map(r => r.entry).sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0))
    }
    return results.map(r => r.entry)
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
    const alreadyOpen = !!vaultState.selectedEntry
    const sameEntry = vaultState.selectedEntry === id
    vaultState.selectedEntry = id
    if (alreadyOpen && !sameEntry) {
      // 收回再弹出动画（对齐原版 entries.js selectEntry）。
      // P2-6 修复：动画状态纳入响应式（detailAnim），由 DetailPanel 的 :class 绑定驱动，
      // 消除原先直接改 DOM class 与 Vue 重渲染之间的覆盖竞态。
      clearTimeout(vaultState.detailAnimTimer)
      vaultState.detailAnim = 'collapse'
      vaultState.detailAnimTimer = setTimeout(() => {
        vaultState.detailAnim = 'reopen'
        vaultState.detailAnimTimer = setTimeout(() => {
          vaultState.detailAnim = null
          vaultState.detailAnimTimer = null
        }, 30)
      }, 320)
    }
  }

  function closeDetail() {
    clearTimeout(vaultState.detailAnimTimer)
    vaultState.detailAnimTimer = null
    vaultState.detailAnim = null
    vaultState.selectedEntry = null
  }

  async function toggleFavorite(id) {
    const entry = vaultState.entries.find(e => e.id === id)
    if (!entry) return
    entry.favorite = !entry.favorite
    entry.updatedAt = new Date().toISOString()
    await saveVault()
    // 收藏激活时触发星标旋转动画（CSS .star-btn.just-faved）
    if (entry.favorite) {
      nextTick(() => {
        const btn = document.querySelector(`.star-btn[data-id="${CSS.escape(String(id))}"], #detail-fav-btn`)
        if (!btn) return
        btn.classList.remove('just-faved')
        // 强制 reflow 重启动画
        void btn.offsetWidth
        btn.classList.add('just-faved')
        setTimeout(() => btn.classList.remove('just-faved'), 400)
      })
    }
  }

  async function softDelete(id) {
    if (!id) return

    const idx = vaultState.entries.findIndex(e => e.id === id)
    if (idx === -1) return
    const entry = vaultState.entries[idx]

    // 确认弹窗：移动端误触防护（卡片按钮/详情页/长按菜单均走此入口）
    const confirmed = await window.Utils.confirm({
      title: t('vault.confirm.softDelete.title'),
      message: t('vault.confirm.softDelete.msg', { title: entry.title || t('detail.untitled') }),
      confirmText: t('vault.confirm.softDelete.ok'),
      danger: true,
    })
    if (!confirmed) return

    entry.deletedAt = new Date().toISOString()
    vaultState.entries.splice(idx, 1)
    vaultState.deleted.push(entry)

    await saveVault()
    if (vaultState.selectedEntry === id) closeDetail()
    // 撤销 Toast：5 秒内可一键恢复，无需导航到回收站
    window.Utils.showToast(t('toast.movedToTrash'), 'success', {
      duration: 5000,
      action: {
        label: t('toast.undo'),
        callback: () => { restoreEntry(id) },
      },
    })
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
    window.Utils.showToast(t('toast.restored'), 'success')
  }

  async function permanentDelete(id) {
    const confirmed = await window.Utils.confirm({
      title: t('vault.confirm.permanentDelete.title'),
      message: t('vault.confirm.permanentDelete.msg'),
      confirmText: t('vault.confirm.permanentDelete.ok'),
      danger: true,
    })
    if (!confirmed) return

    // 彻底删除同样先播离场动画，再移除数据
    const card = document.querySelector(`.entry-card[data-id="${CSS.escape(String(id))}"]`)
    if (card) {
      card.classList.add('leaving')
      await new Promise(r => setTimeout(r, 240))
    }

    vaultState.deleted = vaultState.deleted.filter(e => e.id !== id)
    // 彻底删除后清理该条目的密码历史（无主数据不保留）
    if (vaultState.history[id]) {
      delete vaultState.history[id]
      vaultState.history = { ...vaultState.history }
    }
    await saveVault()
    if (vaultState.selectedEntry === id) closeDetail()
    window.Utils.showToast(t('toast.permanentlyDeleted'), 'success')
  }

  async function emptyRecycleBin() {
    if (!vaultState.deleted.length) {
      window.Utils.showToast(t('toast.trashAlreadyEmpty'), 'info')
      return
    }
    const confirmed = await window.Utils.confirm({
      title: t('vault.confirm.emptyTrash.title'),
      message: t('vault.confirm.emptyTrash.msg', { count: vaultState.deleted.length }),
      confirmText: t('vault.confirm.emptyTrash.ok'),
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
    window.Utils.showToast(t('toast.trashEmptied'), 'success')
  }

  /* ── 回收站定时清空（C4） ───────────────────────
     解锁后立即检查 + 每日检查；超 TTL 条目彻底删除（含密码历史快照）；
     旧数据无 deletedAt 不参与（安全兜底）。 */
  function purgeExpiredRecycle() {
    const ttl = vaultState.recycleTtlDays
    if (!ttl || ttl <= 0) return 0
    const cutoff = Date.now() - ttl * 24 * 60 * 60 * 1000
    const expired = vaultState.deleted.filter(e => {
      if (!e.deletedAt) return false
      const ts = new Date(e.deletedAt).getTime()
      return !isNaN(ts) && ts < cutoff
    })
    if (!expired.length) return 0
    const deadIds = expired.map(e => e.id)
    vaultState.deleted = vaultState.deleted.filter(e => !deadIds.includes(e.id))
    // 同步清理这些条目的密码历史（无主数据不保留）
    if (deadIds.length) {
      const keep = {}
      Object.keys(vaultState.history).forEach(id => {
        if (!deadIds.includes(id)) keep[id] = vaultState.history[id]
      })
      vaultState.history = keep
    }
    saveVault()
    if (vaultState.currentFilter === 'recycle') closeDetail()
    window.Utils.showToast(t('toast.recycleAutoPurged', { count: expired.length }), 'info')
    return expired.length
  }

  function startRecycleTimer() {
    if (vaultState.recycleTimer) {
      clearInterval(vaultState.recycleTimer)
      vaultState.recycleTimer = null
    }
    if (vaultState.recycleTtlDays > 0) {
      vaultState.recycleTimer = setInterval(() => { purgeExpiredRecycle() }, 24 * 60 * 60 * 1000)
    }
  }

  function setRecycleTtl(days) {
    const v = parseInt(days, 10) || 0
    vaultState.recycleTtlDays = v
    try { localStorage.setItem('lockpass_recycle_ttl', String(v)) } catch (e) {}
    startRecycleTimer()
  }

  /* ── 剪贴板 ────────────────────────────────── */

  let clipboardCleanupFn = null
  let activeCopyTipTimer = null

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
      // 桌面端优先走 LockClipboard（macOS 主线程 arboard 命令 / 其余平台 shim）
      if (window.LockClipboard && typeof window.LockClipboard.write === 'function') {
        await window.LockClipboard.write(text)
      } else {
        await navigator.clipboard.writeText(text)
      }
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
      window.Utils.showToast(t('toast.copyFailed', { msg: writeError || t('toast.unknownError') }), 'error')
      return false
    }
    // srAnnounce 供屏幕阅读器播报（CopyCountdownPill 的 aria-label 同步覆盖）
    vaultState.srAnnounce = t('vault.copyAnnounce')

    // ── 复制成功倒计时胶囊（响应式状态驱动，替代 DOM 操控） ──
    // 先清理旧的倒计时
    if (activeCopyTipTimer) {
      clearInterval(activeCopyTipTimer)
      activeCopyTipTimer = null
    }

    const totalSec = Math.round(vaultState.clipboardClearMs / 1000)

    // 激活倒计时胶囊（CopyCountdownPill 组件消费此状态）
    vaultState.clipboardCountdown = { active: true, remaining: totalSec, total: totalSec }

    // 每秒递减倒计时
    activeCopyTipTimer = setInterval(() => {
      const cd = vaultState.clipboardCountdown
      if (!cd.active) {
        clearInterval(activeCopyTipTimer)
        activeCopyTipTimer = null
        return
      }
      cd.remaining--
      if (cd.remaining <= 0) {
        clearInterval(activeCopyTipTimer)
        activeCopyTipTimer = null
        cd.active = false
      }
    }, 1000)

    // 清除旧的剪贴板自动清除定时器，并注册新的清理回调
    clearTimeout(vaultState.clipboardTimer)
    const prevCleanup = clipboardCleanupFn
    clipboardCleanupFn = () => {
      if (activeCopyTipTimer) {
        clearInterval(activeCopyTipTimer)
        activeCopyTipTimer = null
      }
      vaultState.clipboardCountdown.active = false
      if (prevCleanup) prevCleanup()
    }

    // 自动清除剪贴板（macOS 无手势场景走 LockClipboard 主线程命令）
    vaultState.clipboardTimer = setTimeout(async () => {
      try {
        if (window.LockClipboard) await window.LockClipboard.write('')
        else await navigator.clipboard.writeText('')
      } catch (e) {}
      if (clipboardCleanupFn) {
        clipboardCleanupFn()
        clipboardCleanupFn = null
      }
    }, vaultState.clipboardClearMs)

    // 卡片复制按钮高亮（对齐原版 .copy-btn.copied）
    try {
      if (entryId) {
        document.querySelectorAll(`.entry-card[data-id="${CSS.escape(String(entryId))}"] .copy-btn`).forEach(b => {
          b.classList.add('copied')
          setTimeout(() => b.classList.remove('copied'), 1500)
        })
      }
    } catch (e) { /* CSS.escape 或 querySelector 异常不影响复制结果 */ }
    return true
  }

  /**
   * S2 修复：锁定 / 退出登录时主动立即清空系统剪贴板（不等 30s 自清定时器）。
   * 与既有的自清定时器链路共享 clipboardCleanupFn，先拆除定时器与倒计时胶囊，
   * 再向系统剪贴板写入空串；重复调用幂等，可与倒计时到点回调互相去重。
   */
  async function clearClipboardNow() {
    // 1) 拆除「自动清除定时器 + 倒计时胶囊」链路（幂等，重复调用安全）
    if (vaultState.clipboardTimer) {
      clearTimeout(vaultState.clipboardTimer)
      vaultState.clipboardTimer = null
    }
    const prevCleanup = clipboardCleanupFn
    clipboardCleanupFn = null
    if (prevCleanup) prevCleanup() // 内部会清 interval 并关闭胶囊状态
    // 2) 主动向系统剪贴板写入空串，立即清空明文（失败则静默降级，已拆除自清链）
    try {
      if (window.LockClipboard && typeof window.LockClipboard.write === 'function') {
        await window.LockClipboard.write('')
      } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText('')
      }
    } catch (e) { /* 剪贴板写权限被拒时静默降级 */ }
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

  // 密码显示自动隐藏计时器（按条目 ID 管理，5 秒后自动切回隐藏）
  const _pwHideTimers = {}
  const PW_AUTO_HIDE_MS = 5000

  function toggleDetailPassword() {
    // 密码显隐按条目 ID 记忆（独立于 entry 数据对象，不随加密 vault 持久化）
    if (!vaultState.selectedEntry) return
    const id = vaultState.selectedEntry
    const wasVisible = !!vaultState.showPasswordMap[id]
    vaultState.showPasswordMap[id] = !wasVisible
    if (vaultState.showPasswordMap[id]) {
      // 切换到显示：启动 / 重置 5 秒自动隐藏计时器
      if (_pwHideTimers[id]) clearTimeout(_pwHideTimers[id])
      _pwHideTimers[id] = setTimeout(() => {
        vaultState.showPasswordMap[id] = false
        delete _pwHideTimers[id]
      }, PW_AUTO_HIDE_MS)
      window.Utils.showToast(t('toast.revealedTemp', { sec: PW_AUTO_HIDE_MS / 1000 }), 'info')
    } else {
      // 手动隐藏时清除计时器
      if (_pwHideTimers[id]) { clearTimeout(_pwHideTimers[id]); delete _pwHideTimers[id] }
    }
  }

  /**
   * 临时显示详情面板秘密字段（右键调用，已显示时重置计时 + 弹提示）
   */
  function revealDetailPasswordOnce() {
    if (!vaultState.selectedEntry) return
    const id = vaultState.selectedEntry
    vaultState.showPasswordMap[id] = true
    if (_pwHideTimers[id]) clearTimeout(_pwHideTimers[id])
    _pwHideTimers[id] = setTimeout(() => {
      vaultState.showPasswordMap[id] = false
      delete _pwHideTimers[id]
    }, PW_AUTO_HIDE_MS)
    window.Utils.showToast(t('toast.revealedTemp', { sec: PW_AUTO_HIDE_MS / 1000 }), 'info')
  }

  /* ── 模态框 ────────────────────────────────── */

  function openEntryModal(entryId = null, opts = null) {
    vaultState.sidebarOpen = false
    vaultState.editingEntryId = entryId
    // 草稿生命周期 v1.1.12b：打开意图（presetType / draftAction）随模态框传递，
    // 由 EntryEditorModal 挂载时消费一次后置空（见 closeModal）
    vaultState.editorOpenOpts = opts || null
    vaultState.activeModal = 'entry'
  }

  function openModal(name) {
    vaultState.sidebarOpen = false
    vaultState.activeModal = name
  }

  function closeModal() {
    vaultState.activeModal = null
    vaultState.editingEntryId = null
    vaultState.editorOpenOpts = null
  }

  /* ── 密码生成器独立弹窗（方案 C，不占用 activeModal） ───── */

  function openPasswordGenerator(target = null) {
    vaultState.pwGenTarget = target || null
    vaultState.pwGenVisible = true
  }

  function closePasswordGenerator() {
    vaultState.pwGenVisible = false
    vaultState.pwGenTarget = null
  }

  function requestPwGenFill(value) {
    vaultState.pwGenFillValue = value || ''
    vaultState.pwGenFillNonce++
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
    title: t('vault.hist.title'), entryType: t('vault.hist.entryType'), username: t('vault.hist.username'), password: t('vault.hist.password'),
    url: t('vault.hist.url'), port: t('vault.hist.port'), notes: t('vault.hist.notes'), tags: t('vault.hist.tags'),
    root: t('vault.hist.root'), appId: t('vault.hist.appId'), privateKey: t('vault.hist.privateKey'),
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
      window.Utils.showToast(t('toast.historyNotFound'), 'error')
      return false
    }
    const target = snap.snap || { password: snap.password } // 旧版记录仅含密码
    if (!snapDiffers(entry, snap)) {
      window.Utils.showToast(t('toast.alreadyAtVersion'), 'info')
      return false
    }
    // 确认弹窗防误操作：回滚覆盖当前数据且不留存当前副本
    const fieldText = snap.snap ? (describeHistoryFields(snap.fields) || t('vault.hist.allFields')) : t('vault.hist.password')
    const ok = await window.Utils.confirm({
      title: t('vault.confirm.rollback.title'),
      message: t('vault.confirm.rollback.msg', { fields: fieldText }),
      confirmText: t('vault.confirm.rollback.ok'),
      cancelText: t('confirm.default.cancel'),
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
    window.Utils.showToast(t('toast.rolledBack'), 'success')
    return true
  }

  // 浏览器扩展桥：注册条目数据源（扩展仅能拿到脱敏列表，解密请求经页面内存处理）
  try { window.ExtBridge && window.ExtBridge.setEntriesProvider(() => vaultState.entries) } catch (e) {}

  async function saveEntry(payload) {
    const { title, type, fields, tags, notes, customFields } = payload
    if (!title || !title.trim()) {
      window.Utils.showToast(t('toast.titleRequired'), 'error')
      return false
    }
    const passwordField = fields.password
    // D10 修复：对齐原版——app 类型可不填密码（只需 App ID），其余类型按需必填
    if (type === 'website' || type === 'server' || type === 'database') {
      if (!passwordField) {
        window.Utils.showToast(t('toast.passwordRequired'), 'error')
        return false
      }
    } else if (type === 'ai') {
      if (!passwordField) {
        window.Utils.showToast(t('toast.tokenRequired'), 'error')
        return false
      }
    } else if (type === 'other') {
      if (!passwordField) {
        window.Utils.showToast(t('toast.credentialRequired'), 'error')
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

    // 自定义字段扩展（upgrade-design.md §1.1）：归一化结构、清洗非法 type
    const CF_TYPES = ['text', 'pin', 'email', 'phone', 'otp', 'url', 'notes']
    entry.customFields = (Array.isArray(customFields) ? customFields : [])
      .filter(cf => cf && typeof cf === 'object')
      .map(cf => ({
        id: String(cf.id || `cf_${crypto.randomUUID()}`),
        label: String(cf.label || '').slice(0, 50),
        value: String(cf.value ?? ''),
        sensitive: !!cf.sensitive,
        type: CF_TYPES.includes(cf.type) ? cf.type : 'text',
      }))

    // 变更落地前快照（草稿生命周期 v1.1.12b：写盘失败时回滚内存，
    // 使「提交失败保留草稿以便重试」不产生重复条目/重复历史）
    let mutateKind = '' // 'edit' | 'new'
    let mutateIdx = -1
    let mutateOldEntry = null
    let mutateHistBefore = undefined
    const histHadKey = Object.prototype.hasOwnProperty.call(vaultState.history, id)

    if (vaultState.editingEntryId) {
      const idx = vaultState.entries.findIndex(e => e.id === vaultState.editingEntryId)
      if (idx === -1) {
        // P2-1 修复：条目已被删除（如另一视图移入回收站）时不再静默丢弃修改并假报「已保存」。
        // 保持编辑器打开，让用户有机会手动复制未保存的修改；可到回收站恢复该条目后再保存。
        window.Utils.showToast(t('toast.entryDeletedCannotSave'), 'error')
        return false
      }
      const oldEntry = vaultState.entries[idx]
      mutateKind = 'edit'
      mutateIdx = idx
      mutateOldEntry = oldEntry
      mutateHistBefore = histHadKey ? vaultState.history[id] : undefined
      // 任意内容字段有变更都生成历史记录（默认保留最近 5 版）
      recordEntryHistory(entry.id, oldEntry, entry, now)
      vaultState.entries[idx] = entry
    } else {
      mutateKind = 'new'
      vaultState.entries.unshift(entry)
    }

    // 真实落盘成功才清草稿、关闭并提示成功；失败保留草稿供重试
    const persistOk = await saveVault()
    if (!persistOk) {
      // 回滚内存状态（doSave 失败 toast 已在 saveVault 弹出）
      if (mutateKind === 'edit') {
        if (mutateIdx >= 0 && mutateOldEntry) vaultState.entries[mutateIdx] = mutateOldEntry
        if (histHadKey) vaultState.history[id] = mutateHistBefore
        else delete vaultState.history[id]
      } else if (mutateKind === 'new') {
        const dropped = vaultState.entries.indexOf(entry)
        if (dropped >= 0) vaultState.entries.splice(dropped, 1)
      }
      return false
    }

    // 保存成功 → 清空对应草稿（内存 + 脱敏 storage 由 store.clearDraft 统一处理；
    // 旧版 lockpass_draft_edit_* / lockpass_draft_new 明文残留一并兜底移除）
    if (vaultState.editingEntryId) {
      try { memClearEditorDraft('edit:' + vaultState.editingEntryId) } catch (e) {}
      try { sessionStorage.removeItem('lockpass_draft_edit_' + vaultState.editingEntryId) } catch (e) {}
    } else {
      try { memClearEditorDraft('new') } catch (e) {}
      try { sessionStorage.removeItem('lockpass_draft_new') } catch (e) {}
    }

    closeModal()
    window.Utils.showToast(t('toast.saved'), 'success')
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
    purgeExpiredRecycle,
    setRecycleTtl,
    copyToClipboard,
    copyPassword,
    copyField,
    toggleDetailPassword,
    revealDetailPasswordOnce,
    openEntryModal,
    openModal,
    closeModal,
    openPasswordGenerator,
    closePasswordGenerator,
    requestPwGenFill,
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
