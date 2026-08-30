<script setup>
/* LockPass — 设置模态框（Vue 迁移）
   复刻原生 settings.js：安全 / 本地文件同步 / 标签管理入口 / 数据说明 /
   数据管理（导入导出入口 + 修改主密码 + 销毁）/ 快捷键说明 / 关于 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import { APP_VERSION } from '../../core/version.js'
import { buildShortcutDefs } from '../../composables/useShortcuts'
import { useTheme } from '../../composables/useTheme'
import { useI18n } from '../../composables/useI18n'
import ModalBase from '../common/ModalBase.vue'
import BaseSelect from '../common/BaseSelect.vue'
import { useCtxMenu } from '../../composables/useCtxMenu'
import CtxMenu from '../common/CtxMenu.vue'

const { closeModal, openModal, saveVault, resetLockTimer, lockVault, setRecycleTtl } = useVault()

// P3-4：图标统一走 Utils.SvgIcons
const Icons = window.Utils.SvgIcons

/* ── 设置标签页分组 ── */
const settingsTab = ref('security')
const SETTINGS_TABS = [
  { id: 'security', label: '安全', labelKey: 'settings.tab.security' },
  { id: 'appearance', label: '外观', labelKey: 'settings.tab.appearance' },
  { id: 'sync', label: '备份', labelKey: 'settings.tab.sync' },
  { id: 'extension', label: '扩展', labelKey: 'settings.tab.extension' },
  { id: 'about', label: '关于', labelKey: 'settings.tab.about' },
]

/* ── 安全设置（本机配置，仅存 localStorage） ── */

const lockTimeout = ref(vaultState.lockTimeoutMs)
const clipboardClear = ref(vaultState.clipboardClearMs)
const recycleTtl = ref(vaultState.recycleTtlDays)

/* ── 浏览器扩展：在线扩展包下载 + 使用指南 ── */

const EXT_GUIDE_URL =
  'https://trexwb.github.io/lockPass/guide.html'

const isDesktopApp = computed(() => !!(window.LockTauri && window.LockTauri.isTauri))

// P3-3 同款平台判定：navigator.platform 已废弃，userAgentData 优先
const isMac = (navigator.userAgentData && navigator.userAgentData.platform === 'macOS')
  || /mac/i.test(navigator.platform || '')


/* ── I1：界面语言（多语言方案 §6.5） ── */
const { t, pref: langPref, setLang } = useI18n()

const langOptions = computed(() => [
  { value: 'system', label: t('settings.lang.system') },
  { value: 'zh-CN', label: t('settings.lang.zh') },
  { value: 'en-US', label: t('settings.lang.en') },
])

const lockTimeoutOptions = computed(() => [
  { value: 60000, label: t('settings.security.lock1m') },
  { value: 300000, label: t('settings.security.lock5m') },
  { value: 900000, label: t('settings.security.lock15m') },
  { value: 1800000, label: t('settings.security.lock30m') },
  { value: 0, label: t('settings.security.lockNever') },
])

const clipboardClearOptions = computed(() => [
  { value: 10000, label: t('settings.security.clear10s') },
  { value: 30000, label: t('settings.security.clear30s') },
  { value: 60000, label: t('settings.security.clear60s') },
])

const recycleTtlOptions = computed(() => [
  { value: 0, label: t('settings.security.recycleNever') },
  { value: 30, label: t('settings.security.recycle30d') },
  { value: 60, label: t('settings.security.recycle60d') },
  { value: 90, label: t('settings.security.recycle90d') },
])

const backupIntervalOptions = computed(() => [
  { value: 0, label: t('settings.backup.off') },
  { value: 1, label: t('settings.backup.daily') },
  { value: 3, label: t('settings.backup.every3d') },
  { value: 7, label: t('settings.backup.every7d') },
  { value: 30, label: t('settings.backup.every30d') },
])

const snapshotIntervalOptions = computed(() => [
  { value: 1, label: t('settings.backup.snapDaily') },
  { value: 3, label: t('settings.backup.every3d') },
  { value: 7, label: t('settings.backup.every7d') },
  { value: 30, label: t('settings.backup.every30d') },
])

const snapshotKeepOptions = computed(() => [
  { value: 3, label: t('settings.backup.keep3') },
  { value: 5, label: t('settings.backup.keep5') },
  { value: 10, label: t('settings.backup.keep10') },
  { value: 20, label: t('settings.backup.keep20') },
])

function onLangChange(value) {
  // 必须走 useI18n.setLang：同步更新响应式 i18nState.lang 驱动全界面即时刷新，
  // 直接调 window.I18n.setLangPref 只改 core 状态，不触发组件重渲染
  setLang(value)
  window.Utils.showToast(t('settings.langChanged'), 'success')
}


function openExternalUrl(url) {
  // 统一入口 Utils.openExternal：桌面走 Rust open_url（协议/字符白名单校验）
  // 在系统默认浏览器打开，命令失败自动降级新窗口；浏览器走 window.open。
  // 失败再退化为复制链接到剪贴板。直接 location 跳转会劫持 WebView 导航。
  window.Utils.openExternal(url).then(function () {
    if (window.LockTauri && window.LockTauri.isTauri) {
      window.Utils.showToast(t('settings.toast.openedInBrowser'), 'success')
    }
  }).catch(function () {
    window.Utils.copyText(url).then(function () {
      window.Utils.showToast(t('settings.toast.linkCopied'), 'warning')
    }).catch(function () {
      window.Utils.showToast(url, 'info')
    })
  })
}

function downloadExtension() {
  // 扩展 zip 由 Pages 流水线随站点发布，版本号与主应用保持一致
  openExternalUrl('https://trexwb.github.io/lockPass/lockpass-extension-v' + APP_VERSION + '.zip')
}

function openGuide() {
  openExternalUrl(EXT_GUIDE_URL)
}

/* ── 应用更新（桌面版，Tauri updater 插件） ── */

const updateStatus = ref('idle')
const updateVersion = ref('')
const updateProgress = ref(0)
const updateError = ref('')
const autoUpdate = ref(window.LockUpdater ? window.LockUpdater.autoEnabled() : false)
let updateTimer = null

function syncUpdateState() {
  const st = window.LockUpdater ? window.LockUpdater.state : null
  if (!st) return
  updateStatus.value = st.status
  updateVersion.value = st.version || ''
  updateProgress.value = st.progress || 0
  updateError.value = st.error || ''
}

const updateDesc = computed(() => {
  switch (updateStatus.value) {
    case 'checking': return t('update.desc.checking')
    case 'available': return t('update.desc.available', { version: updateVersion.value })
    case 'downloading': return t('update.desc.downloading', { version: updateVersion.value, progress: updateProgress.value })
    case 'ready': return t('update.desc.ready', { version: updateVersion.value })
    case 'uptodate': return t('update.desc.uptodate')
    case 'error': return t('update.desc.error', { msg: updateError.value })
    default: return t('update.desc.default')
  }
})

const updateBtn = computed(() => {
  switch (updateStatus.value) {
    case 'checking': return { label: t('update.btn.checking'), disabled: true }
    case 'available': return { label: t('update.btn.updateTo', { version: updateVersion.value }), disabled: false, fn: startDownload }
    case 'downloading': return { label: t('update.btn.downloading', { progress: updateProgress.value }), disabled: true }
    case 'ready': return { label: t('update.btn.relaunch'), disabled: false, fn: doRelaunch }
    default: return { label: t('update.btn.check'), disabled: false, fn: startCheck }
  }
})

function startCheck() { if (window.LockUpdater) { syncUpdateState(); window.LockUpdater.check(false).then(syncUpdateState) } }
function startDownload() { if (window.LockUpdater) window.LockUpdater.download().then(syncUpdateState) }
function doRelaunch() { if (window.LockUpdater) window.LockUpdater.relaunch() }
function toggleAutoUpdate() { if (window.LockUpdater) window.LockUpdater.setAutoEnabled(autoUpdate.value) }

onMounted(() => {
  if (!isDesktopApp.value) return
  syncUpdateState()
  // 下载进度由 updater 事件驱动，这里轮询快照刷新 UI
  updateTimer = setInterval(syncUpdateState, 600)
})

onBeforeUnmount(() => {
  if (updateTimer) {
    clearInterval(updateTimer)
    updateTimer = null
  }
})

function updateLockTimeout() {
  const value = parseInt(lockTimeout.value, 10)
  vaultState.lockTimeoutMs = value
  try { localStorage.setItem('lockpass_lock_timeout', String(value)) } catch (e) {}
  if (value > 0) {
    resetLockTimer()
  } else {
    clearTimeout(vaultState.lockTimer)
  }
  window.Utils.showToast(t('settings.toast.saved'), 'success')
}

function updateClipboardClear() {
  const value = parseInt(clipboardClear.value, 10)
  vaultState.clipboardClearMs = value
  try { localStorage.setItem('lockpass_clipboard_clear', String(value)) } catch (e) {}
  window.Utils.showToast(t('settings.toast.saved'), 'success')
}

/* C4 回收站自动清空：开启（非从不）时确认「自动清空不可恢复」 */
async function updateRecycleTtl() {
  const value = parseInt(recycleTtl.value, 10) || 0
  if (value > 0 && value !== vaultState.recycleTtlDays) {
    const ok = await window.Utils.confirm({
      title: t('settings.security.recycleConfirmTitle'),
      message: t('settings.security.recycleConfirmMsg', { days: value }),
      confirmText: t('confirm.default.ok'),
      cancelText: t('confirm.default.cancel'),
      danger: true,
    })
    if (!ok) {
      recycleTtl.value = vaultState.recycleTtlDays
      return
    }
  }
  setRecycleTtl(value)
  window.Utils.showToast(t('settings.toast.saved'), 'success')
}

/* ── 备份（提醒 + 自动快照，BackupManager 管理） ── */

const BM = window.BackupManager
const backupInterval = ref(BM ? BM.getIntervalDays() : 7)
const snapshotEnabled = ref(BM ? BM.snapshotEnabled() : false)
const snapshotInterval = ref(BM ? BM.snapshotIntervalDays() : 7)
const snapshotKeep = ref(BM ? BM.snapshotKeep() : 5)
const backupBusy = ref(false)

const canSnapshot = computed(() => !!(BM && BM.canSnapshot()))

const snapLocationText = computed(() => {
  if (!BM) return ''
  if (BM.isDesktop()) return t('backup.locDesktop')
  return t('backup.locBound')
})

const lastBackupText = computed(() => {
  if (!BM) return ''
  const at = BM.getLastBackupAt()
  if (!at) return t('backup.never')
  const d = new Date(at)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})

function updateBackupInterval() {
  if (!BM) return
  BM.setIntervalDays(backupInterval.value)
  window.Utils.showToast(t('settings.toast.saved'), 'success')
}
function updateSnapshotEnabled() {
  if (!BM) return
  BM.setSnapshotEnabled(snapshotEnabled.value)
  window.Utils.showToast(t(snapshotEnabled.value ? 'backup.snapshotOn' : 'backup.snapshotOff'), 'success')
}
function updateSnapshotInterval() {
  if (!BM) return
  BM.setSnapshotIntervalDays(snapshotInterval.value)
  window.Utils.showToast(t('settings.toast.saved'), 'success')
}
function updateSnapshotKeep() {
  if (!BM) return
  BM.setSnapshotKeep(snapshotKeep.value)
  window.Utils.showToast(t('settings.toast.saved'), 'success')
}
async function backupNow() {
  if (!BM) return
  // 浏览器未绑定目录：引导走 .vault 导出
  if (!BM.canSnapshot()) {
    openModal('export')
    return
  }
  backupBusy.value = true
  try {
    const r = await BM.createSnapshot()
    if (r.ok) {
      window.Utils.showToast(t('backup.snapshotDone'), 'success')
    } else if (r.reason === 'permission') {
      window.Utils.showToast(t('backup.handleExpired'), 'warning')
    } else if (r.reason === 'empty') {
      window.Utils.showToast(t('backup.errNoData'), 'error')
    } else if (r.reason === 'unbound') {
      window.Utils.showToast(t('backup.errNotBound'), 'warning')
    } else {
      window.Utils.showToast(t('backup.errFailed', { msg: (r.error && r.error.message) || r.reason }), 'error')
    }
  } catch (e) {
    window.Utils.showToast(t('backup.errFailed', { msg: e.message || e }), 'error')
  } finally {
    backupBusy.value = false
  }
}

/* ── 外观（主题模式 + 强调色，useTheme 管理持久化与 data-* 属性） ── */

const { themeMode, accentName, ACCENTS, setMode, setAccent } = useTheme()
const themeModes = [
  { value: 'dark', label: t('theme.dark') },
  { value: 'light', label: t('theme.light') },
  { value: 'system', label: t('theme.system') },
]
const ACCENT_LABELS = { blue: t('accent.blue'), green: t('accent.green'), purple: t('accent.purple'), orange: t('accent.orange'), red: t('accent.red'), cyan: t('accent.cyan') }
function accentLabel(a) {
  return ACCENT_LABELS[a] || a
}

/* ── 本地文件同步 ── */

const syncStatus = ref({ text: t('sync.checking'), btnText: t('sync.bind'), btnVisible: true })

async function refreshFileSyncStatus() {
  const status = syncStatus.value
  // Tauri 桌面版：数据已通过本地文件存储，无需目录绑定（双信号判定）
  if ((window.FileStore && window.FileStore.isTauri) || window.__TAURI_INTERNALS__) {
    status.text = t('sync.desktopLocal')
    status.btnVisible = false
    try {
      const dir = await window.FileStore.dataDir()
      if (dir) status.text = t('sync.dataDir', { dir })
    } catch (e) { /* 目录获取失败时保留默认文案 */ }
    return
  }
  if (!window.FileSync.isSupported()) {
    status.text = t('sync.browserUnsupported')
    status.btnVisible = false
    return
  }
  try {
    const handle = await window.FileSync.getDirHandle()
    if (handle && !window.FileSync.isUsableDirHandle(handle)) {
      status.text = t('sync.handleExpired')
      status.btnText = t('sync.rebind')
    } else if (handle) {
      status.text = t('settings.data.bound', { name: handle.name })
      status.btnText = t('sync.rebind')
    } else {
      status.text = t('sync.notBound')
      status.btnText = t('sync.bind')
    }
  } catch (e) {
    status.text = t('sync.statusReadFailed')
  }
}

async function bindDataDirectory() {
  try {
    const out = await window.FileSync.bindDirectory()
    if (out.restored) {
      lockVaultAndNotice()
    } else if (out.result && out.result.ok) {
      window.Utils.showToast(t('sync.boundOk'), 'success')
    } else if (out.result && out.result.reason === 'empty') {
      window.Utils.showToast(t('sync.boundWillSync'), 'success')
    } else {
      window.Utils.showToast(t('sync.boundPartial'), 'warning')
    }
    refreshFileSyncStatus()
  } catch (e) {
    if (e && e.name === 'AbortError') return // 用户取消
    window.Utils.showToast(e.message || t('sync.bindFailed'), 'error')
  }
}

// 绑定目录时若 IndexedDB 已从目录重建：回到锁屏等待解锁
function lockVaultAndNotice() {
  lockVault()
  // R5 修复：绑定目录恢复数据后置为已初始化，锁屏切换为「输入主密码解锁」
  vaultState.initialized = true
  closeModal()
  window.Utils.showToast(t('sync.restoredFromFile'), 'success')
}

/* ── 数据说明 ── */

const dataInfo = ref({
  entries: '…',
  tags: '…',
  size: '—',
  sync: '…',
  file: t('settings.data.unbound'),
  fileTagClass: 'tag-muted',
})

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(2) + ' MB'
}

async function refreshDataInfo() {
  const info = dataInfo.value
  info.entries = t('data.info.entries', { n: (vaultState.entries || []).length })
  info.tags = t('data.info.tags', { n: (vaultState.tags || []).length })

  // 数据大小：vault 加密负载（密文 base64 解码后的字节数）
  try {
    await window.DBUtils.openDB()
    const rec = await window.DBUtils.dbGet(window.DBUtils.STORE_VAULT, 'main')
    let bytes = 0
    if (rec && rec.data) {
      try { bytes = atob(rec.data).length } catch (e) { bytes = Math.floor(rec.data.length * 3 / 4) }
    }
    info.size = formatBytes(bytes)
  } catch (e) {
    info.size = '—'
  }

  // 文件同步状态
  if ((window.FileStore && window.FileStore.isTauri) || window.__TAURI_INTERNALS__) {
    info.sync = t('data.info.desktopFile')
    info.file = t('data.info.enabled')
    info.fileTagClass = 'tag-ok'
  } else if (window.FileSync.isSupported()) {
    const handle = await window.FileSync.getDirHandle()
    if (handle && !window.FileSync.isUsableDirHandle(handle)) {
      info.sync = t('data.info.handleExpired')
      info.file = t('data.info.needRebind')
      info.fileTagClass = 'tag-warning'
    } else if (handle) {
      if (window.FileSync.lastSyncError) {
        info.sync = t('data.info.syncFailed')
        info.file = t('data.info.syncFailed')
        info.fileTagClass = 'tag-danger'
      } else {
        info.sync = t('data.info.bound')
        info.file = t('data.info.synced')
        info.fileTagClass = 'tag-ok'
      }
    } else {
      info.sync = t('data.info.notBound')
      info.file = t('data.info.notBound')
      info.fileTagClass = 'tag-muted'
    }
  } else {
    info.sync = t('data.info.unsupported')
    info.file = t('data.info.unsupported')
    info.fileTagClass = 'tag-muted'
  }
}

/* ── 销毁保险箱 ── */

async function destroyVault() {
  const confirmed = await window.Utils.confirm({
    title: t('settings.destroy.title'),
    message: t('settings.destroy.message'),
    confirmText: t('settings.destroy.confirm'),
    danger: true,
  })
  if (!confirmed) return
  const doubleConfirm = await window.Utils.confirm({
    title: t('settings.destroy.finalTitle'),
    message: t('settings.destroy.finalMessage'),
    confirmText: t('settings.destroy.finalConfirm'),
    danger: true,
  })
  if (!doubleConfirm) return

  try {
    // 先清理本地同步文件与目录绑定（目录句柄在 IndexedDB 中，须在删库前执行）
    await window.FileSync.deleteLocalFile()
    await window.FileSync.unbindDirectory()
    await window.DBUtils.deleteDatabase()
    window.Utils.showToast(t('settings.destroy.done'), 'success')
    setTimeout(() => { location.reload() }, 800)
  } catch (e) {
    window.Utils.showToast(t('settings.destroy.errFailed', { msg: e.message || e }), 'error')
  }
}

/* ── 快捷键说明表 ── */

const shortcuts = ref([])

onMounted(() => {
  shortcuts.value = buildShortcutDefs()
  refreshFileSyncStatus()
  refreshDataInfo()
})

function shortcutKeyText(def) {
  return (isMac ? def.mac : def.win) || ''
}

/* ── 版本号 ── */

const appVersion = computed(() => window.LockPassVersion ? 'v' + window.LockPassVersion : '')

/* ════════════════════════════════════════════════════════════════
   右键菜单（行 / 卡片 / Tab / 快捷键 / 链接 等）
   ════════════════════════════════════════════════════════════════ */

const { ctxMenu, handleCtxMenu, onCtxAction } = useCtxMenu(async (action, payload) => {
  const kind = payload?.kind
  switch (kind) {
    case 'tab': {
      const tab = payload.tab
      if (action === 'jump' && tab) settingsTab.value = tab
      return
    }
    case 'row-action': {
      const target = payload.target
      if (action === 'run') {
        if (target === 'bind-dir') bindDataDirectory()
        else if (target === 'backup-now') backupNow()
        else if (target === 'open-ext-download') downloadExtension()
        else if (target === 'open-ext-guide') openGuide()
        else if (target === 'open-tags') openModal('tags')
        else if (target === 'import') openModal('import')
        else if (target === 'qr-import') openModal('qr-import')
        else if (target === 'export') openModal('export')
        else if (target === 'change-pw') openModal('change-pw')
        else if (target === 'destroy') destroyVault()
        else if (target === 'check-update') updateBtn.value.fn?.()
      } else if (action === 'copy-desc') {
        const text = payload.descKey ? t(payload.descKey) : (payload.desc || '')
        if (text) window.Utils.copyText(String(text))
      } else if (action === 'go-tab' && payload.tab) {
        settingsTab.value = payload.tab
      }
      return
    }
    case 'card': {
      const text = payload.value
      if (action === 'copy-value' && text) window.Utils.copyText(String(text))
      return
    }
    case 'arch-item': {
      const name = payload.name
      const desc = payload.desc
      if (action === 'copy-name' && name) window.Utils.copyText(String(name))
      else if (action === 'copy-desc' && desc) window.Utils.copyText(String(desc))
      return
    }
    case 'shortcut': {
      if (action === 'copy-combo') {
        const keys = shortcutKeyText(payload.def)
        if (keys) window.Utils.copyText(keys)
      } else if (action === 'copy-name') {
        window.Utils.copyText(payload.def?.name || '')
      }
      return
    }
    case 'accent-dot': {
      const a = payload.accent
      if (action === 'apply' && a) setAccent(a)
      else if (action === 'copy-label' && a) {
        window.Utils.copyText(accentLabel(a))
      }
      return
    }
    case 'theme-btn': {
      const m = payload.mode
      if (action === 'apply' && m) setMode(m)
      return
    }
    case 'select': {
      const value = payload.value
      const label = payload.label || ''
      if (action === 'copy-value') window.Utils.copyText(String(value ?? ''))
      else if (action === 'copy-label') window.Utils.copyText(label)
      return
    }
    case 'version': {
      if (action === 'copy-version') {
        window.Utils.copyText(appVersion.value || APP_VERSION)
      }
      return
    }
  }
})

const settingsCtxItems = computed(() => {
  const p = ctxMenu.payload
  if (!p) return []
  const list = []
  switch (p?.kind) {
    case 'tab': {
      list.push({ key: 'jump', label: t('settings.ctx.jumpToPage'), iconHtml: Icons?.grid(14), accent: true })
      return list
    }
    case 'row-action': {
      if (p.target) list.push({ key: 'run', label: t('settings.ctx.run') + (p.runLabel || t('settings.ctx.actionFallback')), iconHtml: Icons?.edit(14), accent: true })
      if (p.tab) list.push({ key: 'go-tab', label: t('settings.ctx.goTab', { tab: p.tabLabel }) + t('settings.ctx.goTabSuffix'), iconHtml: Icons?.grid(14) })
      if (p.desc) list.push({ key: 'copy-desc', label: t('settings.ctx.copyDesc'), iconHtml: Icons?.copy(14) })
      return list
    }
    case 'card': {
      list.push({ key: 'copy-value', label: t('settings.ctx.copyValue', { value: p.value || '' }), iconHtml: Icons?.copy(14), accent: true, disabled: !p.value })
      return list
    }
    case 'arch-item': {
      list.push({ key: 'copy-name', label: t('settings.ctx.copyComponent', { name: p.name || '' }), iconHtml: Icons?.copy(14) })
      list.push({ key: 'copy-desc', label: t('settings.ctx.copyDesc'), iconHtml: Icons?.share(14) })
      return list
    }
    case 'shortcut': {
      const keys = p.def ? shortcutKeyText(p.def) : ''
      list.push({ key: 'copy-combo', label: t('settings.ctx.copyCombo', { keys }), iconHtml: Icons?.copy(14), accent: true, disabled: !keys })
      list.push({ key: 'copy-name', label: t('settings.ctx.copyActionName', { name: p.def ? t(p.def.nameKey || p.def.name) : '' }), iconHtml: Icons?.share(14) })
      return list
    }
    case 'accent-dot': {
      list.push({ key: 'apply', label: t('settings.ctx.useAccent', { accent: accentLabel(p.accent) }), iconHtml: Icons?.palette(14), accent: true })
      list.push({ key: 'copy-label', label: t('settings.ctx.copyColorName'), iconHtml: Icons?.copy(14) })
      return list
    }
    case 'theme-btn': {
      const label = p.mode === 'dark' ? t('theme.dark') : p.mode === 'light' ? t('theme.light') : t('theme.system')
      list.push({ key: 'apply', label: t('settings.ctx.applyTheme', { label }), iconHtml: Icons?.grid(14), accent: true })
      return list
    }
    case 'select': {
      list.push({ key: 'copy-value', label: t('settings.ctx.copyCurrentValue'), iconHtml: Icons?.copy(14), accent: true })
      if (p.label) list.push({ key: 'copy-label', label: t('settings.ctx.copyLabel', { label: p.label }), iconHtml: Icons?.share(14) })
      return list
    }
    case 'version': {
      list.push({ key: 'copy-version', label: t('settings.ctx.copyVersion', { version: appVersion.value || APP_VERSION }), iconHtml: Icons?.copy(14), accent: true })
      return list
    }
  }
  return list
})
</script>

<template>
  <ModalBase :max-width="'560px'" @close="closeModal()">
    <div class="modal-header">
      <h2>{{ t('settings.title') }}</h2>
      <button class="btn-icon" @click="closeModal()" tabindex="-1">
        <span v-html="Icons.close(16)"></span>
      </button>
    </div>
    <div class="modal-body">
      <!-- 设置标签页导航 -->
      <div class="settings-tabs" role="tablist" :aria-label="t('settings.tabsAria')">
        <button
          v-for="tab in SETTINGS_TABS"
          :key="tab.id"
          class="settings-tab"
          :class="{ active: settingsTab === tab.id }"
          role="tab"
          :aria-selected="settingsTab === tab.id ? 'true' : 'false'"
          :title="t(tab.labelKey) + t('settings.ctx.jumpSuffix')"
          @click="settingsTab = tab.id"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'tab', tab: tab.id }, { w: 180, h: 100 })"
        >{{ t(tab.labelKey) }}</button>
      </div>

      <!-- 安全 -->
      <div class="settings-group" v-show="settingsTab === 'security'">
        <div class="settings-group-title">{{ t('settings.group.security') }}</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: '', desc: t('settings.security.autoLockDesc'), tab: 'security', tabLabel: t('settings.tab.security'), runLabel: t('settings.security.autoLock') + t('settings.ctx.saveSuffix') }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.security.autoLock') }}</div>
            <div class="settings-desc">{{ t('settings.security.autoLockDesc') }}</div>
          </div>
          <BaseSelect
            class="form-input w-120"
            v-model.number="lockTimeout"
            :options="lockTimeoutOptions"
            @change="updateLockTimeout()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: lockTimeout, label: t('settings.security.autoLock') }, { w: 220, h: 120 })"
          />
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: t('settings.security.clipboardClearDesc'), tab: 'security', tabLabel: t('settings.tab.security'), runLabel: t('settings.security.clipboardClear') + t('settings.ctx.saveSuffix') }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.security.clipboardClear') }}</div>
            <div class="settings-desc">{{ t('settings.security.clipboardClearDesc') }}</div>
          </div>
          <BaseSelect
            class="form-input w-120"
            v-model.number="clipboardClear"
            :options="clipboardClearOptions"
            @change="updateClipboardClear()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: clipboardClear, label: t('settings.security.clipboardClear') }, { w: 220, h: 120 })"
          />
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: t('settings.security.recycleTtlDesc'), tab: 'security', tabLabel: t('settings.tab.security'), runLabel: t('settings.security.recycleTtl') + t('settings.ctx.saveSuffix') }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.security.recycleTtl') }}</div>
            <div class="settings-desc">{{ t('settings.security.recycleTtlDesc') }}</div>
          </div>
          <BaseSelect
            class="form-input w-120"
            v-model.number="recycleTtl"
            :options="recycleTtlOptions"
            @change="updateRecycleTtl()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: recycleTtl, label: t('settings.security.recycleTtl') }, { w: 220, h: 120 })"
          />
        </div>
      </div>

      <!-- 外观 -->
      <div class="settings-group" v-show="settingsTab === 'appearance'">
        <div class="settings-group-title">{{ t('settings.group.appearance') }}</div>

        <!-- 统一模块：主题模式 + 强调色（主题与色调） -->
        <div class="appearance-theme-block">
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: t('settings.appearance.themeDesc'), tab: 'appearance', tabLabel: t('settings.tab.appearance') }, { w: 260, h: 140 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.appearance.theme') }}</div>
            <div class="settings-desc">{{ t('settings.appearance.themeDesc') }}</div>
          </div>
          <div class="theme-mode-switch" role="radiogroup" :aria-label="t('settings.appearance.themeAria')">
            <button
              v-for="m in themeModes"
              :key="m.value"
              class="theme-mode-btn"
              :class="{ active: themeMode === m.value }"
              :title="m.label + t('settings.ctx.quickApply')"
              @click="setMode(m.value)"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'theme-btn', mode: m.value }, { w: 200, h: 120 })"
            >{{ m.label }}</button>
          </div>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: t('settings.appearance.accentDesc'), tab: 'appearance', tabLabel: t('settings.tab.appearance') }, { w: 260, h: 140 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.appearance.accent') }}</div>
            <div class="settings-desc">{{ t('settings.appearance.accentDesc') }}</div>
          </div>
          <div class="accent-palette" role="radiogroup" :aria-label="t('settings.appearance.accentAria')">
            <button
              v-for="a in ACCENTS"
              :key="a"
              class="accent-dot"
              :class="['accent-' + a, { active: accentName === a }]"
              :title="accentLabel(a) + t('settings.ctx.quickApplyCopy')"
              :aria-label="accentLabel(a)"
              @click="setAccent(a)"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'accent-dot', accent: a }, { w: 220, h: 130 })"
            >
              <svg v-if="accentName === a" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3"><polyline points="20 6 9 17 4 12" /></svg>
            </button>
          </div>
        </div>
        </div>

        <!-- 语言（独立行，置于主题/色调模块之后，避免下拉被遮挡） -->
        <div class="settings-row">
          <div>
            <div class="settings-label">{{ t('settings.language') }}</div>
            <div class="settings-desc">{{ t('settings.languageDesc') }}</div>
          </div>
          <BaseSelect
            class="form-input w-120"
            :model-value="langPref"
            :options="langOptions"
            @change="onLangChange"
          />
        </div>
      </div>

      <!-- 本地文件同步 -->
      <div class="settings-group" v-show="settingsTab === 'sync'">
        <div class="settings-group-title">{{ t('settings.group.sync') }}</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: syncStatus.btnVisible ? 'bind-dir' : '', runLabel: syncStatus.btnText, desc: syncStatus.text, tab: 'sync', tabLabel: t('settings.tab.sync') }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.sync.dataDir') }}</div>
            <div class="settings-desc">{{ syncStatus.text }}</div>
          </div>
          <button
            v-if="syncStatus.btnVisible"
            class="btn btn-secondary btn-sm"
            @click="bindDataDirectory()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'bind-dir', runLabel: syncStatus.btnText, desc: syncStatus.text }, { w: 220, h: 140 })"
          >{{ syncStatus.btnText }}</button>
        </div>
        <div class="settings-desc settings-desc-note">
          <div class="settings-desc">{{ t('settings.sync.dataDirDesc') }}</div>
        </div>
      </div>

      <!-- 备份 -->
      <div class="settings-group" v-show="settingsTab === 'sync'">
        <div class="settings-group-title">{{ t('settings.group.backup') }}</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: t('settings.backup.remindDesc'), tab: 'sync', tabLabel: t('settings.tab.sync'), runLabel: t('settings.backup.remind') + t('settings.ctx.saveSuffix') }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.backup.remind') }}</div>
            <div class="settings-desc">{{ t('settings.backup.remindDesc') }}</div>
          </div>
          <BaseSelect
            class="form-input w-120"
            v-model.number="backupInterval"
            :options="backupIntervalOptions"
            @change="updateBackupInterval()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: backupInterval, label: t('settings.backup.remind') }, { w: 220, h: 120 })"
          />
        </div>
        <div
          class="settings-row"
          v-if="canSnapshot"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: t('settings.backup.snapshotCtxDesc', { loc: snapLocationText, n: snapshotKeep }), tab: 'sync', tabLabel: t('settings.tab.sync'), runLabel: t('settings.backup.snapshot') + t('settings.ctx.toggleSuffix') }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.backup.snapshot') }}</div>
            <div class="settings-desc">{{ t('settings.backup.snapshotDesc') }}{{ snapLocationText }}，{{ t('settings.backup.keepMost') }}近 {{ snapshotKeep }} 份</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="snapshotEnabled" @change="updateSnapshotEnabled()" />
            <span class="switch-slider"></span>
          </label>
        </div>
        <template v-if="canSnapshot && snapshotEnabled">
          <div
            class="settings-row"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: t('settings.backup.snapshotIntervalDesc'), tab: 'sync', tabLabel: t('settings.tab.sync') }, { w: 260, h: 170 })"
          >
            <div>
              <div class="settings-label">{{ t('settings.backup.snapshotInterval') }}</div>
              <div class="settings-desc">{{ t('settings.backup.snapshotIntervalDesc') }}</div>
            </div>
            <BaseSelect
              class="form-input w-120"
              v-model.number="snapshotInterval"
              :options="snapshotIntervalOptions"
              @change="updateSnapshotInterval()"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: snapshotInterval, label: t('settings.backup.snapshotInterval') }, { w: 220, h: 120 })"
            />
          </div>
          <div
            class="settings-row"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: t('settings.backup.keepCountDesc'), tab: 'sync', tabLabel: t('settings.tab.sync') }, { w: 260, h: 170 })"
          >
            <div>
              <div class="settings-label">{{ t('settings.backup.keepCount') }}</div>
              <div class="settings-desc">{{ t('settings.backup.keepCountDesc') }}</div>
            </div>
            <BaseSelect
              class="form-input w-120"
              v-model.number="snapshotKeep"
              :options="snapshotKeepOptions"
              @change="updateSnapshotKeep()"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: snapshotKeep, label: t('settings.backup.keepCount') }, { w: 220, h: 120 })"
            />
          </div>
        </template>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'backup-now', runLabel: backupBusy ? t('backup.busy') : (canSnapshot ? t('backup.now') : t('backup.exportVault')), desc: lastBackupText, tab: 'sync', tabLabel: t('settings.tab.sync') }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.backup.lastBackup') }}</div>
            <div class="settings-desc">{{ lastBackupText }}</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="backupBusy"
            @click="backupNow()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'backup-now', runLabel: backupBusy ? t('backup.busy') : (canSnapshot ? t('backup.now') : t('backup.exportVault')) }, { w: 220, h: 120 })"
          >
            {{ backupBusy ? t('backup.busy') : (canSnapshot ? t('backup.now') : t('backup.exportVault')) }}
          </button>
        </div>
      </div>

      <!-- 浏览器扩展（自动填充） -->
      <div class="settings-group" v-show="settingsTab === 'extension'">
        <div class="settings-group-title">{{ t('settings.group.extension') }}</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-ext-download', runLabel: t('settings.extension.downloadZip'), desc: appVersion + ' · ' + t('settings.extension.desktopCopyHint'), tab: 'extension', tabLabel: t('settings.tab.extension') }, { w: 260, h: 190 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.extension.download') }}</div>
            <div class="settings-desc">{{ appVersion }} · {{ t('settings.extension.desktopCopyHint') }}</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="downloadExtension()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-ext-download', runLabel: t('settings.extension.downloadZip') }, { w: 220, h: 120 })"
          >{{ t('settings.extension.downloadZip') }}</button>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-ext-guide', runLabel: t('settings.extension.viewDocs'), desc: t('settings.extension.guideCtxDesc'), tab: 'extension', tabLabel: t('settings.tab.extension') }, { w: 260, h: 190 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.extension.guide') }}</div>
            <div class="settings-desc">{{ t('settings.extension.guideDesc') }}</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openGuide()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-ext-guide', runLabel: t('settings.extension.viewDocs') }, { w: 220, h: 120 })"
          >{{ t('settings.extension.viewDocs') }}</button>
        </div>
        <div class="settings-desc settings-desc-note" v-if="isDesktopApp">
          {{ t('settings.extension.desktopCopyHint') }}
        </div>
      </div>

      <!-- 标签管理入口（归属扩展栏目） -->
      <div class="settings-group" v-show="settingsTab === 'extension'">
        <div class="settings-group-title">{{ t('settings.group.tags') }}</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-tags', runLabel: t('settings.tags.manage'), desc: t('settings.tags.manageDesc'), tab: 'extension', tabLabel: t('settings.tab.extension') }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.tags.manage') }}</div>
            <div class="settings-desc">{{ t('settings.tags.manageDesc') }}</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openModal('tags')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-tags', runLabel: t('settings.tags.manage') }, { w: 220, h: 120 })"
          >{{ t('settings.tags.manageBtn') }}</button>
        </div>
      </div>

      <!-- 数据说明（归属安全栏目） -->
      <div class="settings-group" v-show="settingsTab === 'security'">
        <div class="settings-group-title">{{ t('settings.group.dataInfo') }}</div>
        <div class="data-info-cards">
          <div
            class="data-info-card"
            :title="t('settings.ctx.copyValueTip')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'card', value: dataInfo.entries, label: t('settings.data.entries') }, { w: 220, h: 120 })"
          >
            <div class="data-info-card-label">{{ t('settings.data.entries') }}</div>
            <div class="data-info-card-value">{{ dataInfo.entries }}</div>
          </div>
          <div
            class="data-info-card"
            :title="t('settings.ctx.copyValueTip')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'card', value: dataInfo.tags, label: t('settings.data.tags') }, { w: 220, h: 120 })"
          >
            <div class="data-info-card-label">{{ t('settings.data.tags') }}</div>
            <div class="data-info-card-value">{{ dataInfo.tags }}</div>
          </div>
          <div
            class="data-info-card"
            :title="t('settings.ctx.copyValueTip')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'card', value: dataInfo.size, label: t('settings.data.size') }, { w: 220, h: 120 })"
          >
            <div class="data-info-card-label">{{ t('settings.data.size') }}</div>
            <div class="data-info-card-value">{{ dataInfo.size }}</div>
          </div>
          <div
            class="data-info-card"
            :title="t('settings.ctx.copyValueTip')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'card', value: dataInfo.sync, label: t('settings.data.fileSync') }, { w: 220, h: 120 })"
          >
            <div class="data-info-card-label">{{ t('settings.data.fileSync') }}</div>
            <div class="data-info-card-value">{{ dataInfo.sync }}</div>
          </div>
        </div>
        <div class="data-info-arch">
          <div class="data-info-arch-title">{{ t('settings.data.archTitle') }}</div>
          <div
            class="data-info-arch-item"
            :title="t('settings.ctx.moreOps')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'arch-item', name: 'IndexedDB', desc: t('settings.data.archIdbDesc') }, { w: 260, h: 150 })"
          >
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">IndexedDB <span class="tag tag-info">{{ t('settings.data.archTagIdb') }}</span></span>
              <span class="tag tag-ok">{{ t('settings.data.tagOk') }}</span>
            </div>
            <div class="data-info-desc">{{ t('settings.data.archIdbDesc') }}</div>
          </div>
          <div
            class="data-info-arch-item"
            :title="t('settings.ctx.moreOps')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'arch-item', name: t('settings.data.archFile'), desc: t('settings.data.archFileDesc') }, { w: 260, h: 150 })"
          >
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">{{ t('settings.data.archFile') }} <span class="tag tag-info">{{ t('settings.data.archTagFile') }}</span></span>
              <span class="tag" :class="dataInfo.fileTagClass">{{ dataInfo.file }}</span>
            </div>
            <div class="data-info-desc">{{ t('settings.data.archFileDesc') }}</div>
          </div>
          <div
            class="data-info-arch-item"
            :title="t('settings.ctx.moreOps')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'arch-item', name: 'localStorage', desc: t('settings.data.archLsDesc') }, { w: 260, h: 150 })"
          >
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">localStorage <span class="tag tag-muted">{{ t('settings.data.archTagLs') }}</span></span>
            </div>
            <div class="data-info-desc">{{ t('settings.data.archLsDesc') }}</div>
          </div>
        </div>
      </div>

      <!-- 数据管理 -->
      <div class="settings-group" v-show="settingsTab === 'security'">
        <div class="settings-group-title">{{ t('settings.group.dataMgr') }}</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'import', runLabel: t('settings.data.importBtn'), desc: t('settings.data.importCtxDesc'), tab: 'security', tabLabel: t('settings.tab.security') }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.data.importBackup') }}</div>
            <div class="settings-desc">{{ t('settings.data.importBackupDesc') }}</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openModal('import')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'import', runLabel: t('settings.data.importBackup') }, { w: 220, h: 120 })"
          >{{ t('settings.data.importBtn') }}</button>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'qr-import', runLabel: t('settings.data.scanImport'), desc: t('settings.data.scanImportCtxDesc'), tab: 'security', tabLabel: t('settings.tab.security') }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.data.scanImport') }}</div>
            <div class="settings-desc">{{ t('settings.data.scanImportDesc') }}</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openModal('qr-import')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'qr-import', runLabel: t('settings.data.scanImport') }, { w: 220, h: 120 })"
          >{{ t('settings.data.scanImportBtn') }}</button>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'export', runLabel: t('settings.data.exportBackup'), desc: t('settings.data.exportBackupCtxDesc'), tab: 'security', tabLabel: t('settings.tab.security') }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.data.exportBackup') }}</div>
            <div class="settings-desc">{{ t('settings.data.exportBackupDesc') }}</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openModal('export')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'export', runLabel: t('settings.data.exportBackup') }, { w: 220, h: 120 })"
          >{{ t('settings.data.exportBtn') }}</button>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'change-pw', runLabel: t('settings.data.changeMaster'), desc: t('settings.data.changeMasterCtxDesc'), tab: 'security', tabLabel: t('settings.tab.security') }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.data.changeMaster') }}</div>
            <div class="settings-desc">{{ t('settings.data.changeMasterDesc') }}</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openModal('change-pw')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'change-pw', runLabel: t('settings.data.changeMaster') }, { w: 220, h: 120 })"
          >{{ t('settings.data.changeBtn') }}</button>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'destroy', runLabel: t('settings.data.destroyVault'), desc: t('settings.data.destroyCtxDesc'), tab: 'security', tabLabel: t('settings.tab.security') }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label text-danger">{{ t('settings.data.destroyVault') }}</div>
            <div class="settings-desc">{{ t('settings.data.destroyDesc') }}</div>
          </div>
          <button
            class="btn btn-danger btn-sm"
            @click="destroyVault()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'destroy', runLabel: t('settings.data.destroyVault') }, { w: 220, h: 120 })"
          >{{ t('settings.data.destroyBtn') }}</button>
        </div>
      </div>

      <!-- 快捷键 -->
      <div class="settings-group" v-show="settingsTab === 'appearance'">
        <div class="settings-group-title">{{ t('settings.group.shortcuts') }}</div>
        <div v-if="shortcuts.length" class="shortcut-table-wrap">
          <table class="shortcut-table">
            <thead><tr><th>{{ t('settings.shortcuts.action') }}</th><th>{{ t('settings.shortcuts.keys') }}</th></tr></thead>
            <tbody>
              <tr
                v-for="d in shortcuts"
                :key="d.id"
                :title="t('settings.ctx.copyValueTipShort')"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'shortcut', def: d }, { w: 260, h: 150 })"
              >
                <td class="shortcut-name">{{ t(d.nameKey || d.name) }}</td>
                <td class="shortcut-keys">
                  <template v-for="(k, i) in shortcutKeyText(d).split('+').map(s => s.trim())" :key="i">
                    <kbd>{{ k }}</kbd><span v-if="i < shortcutKeyText(d).split('+').length - 1" class="shortcut-plus"> + </span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 关于 -->
      <div class="settings-group" v-show="settingsTab === 'about'">
        <div class="settings-group-title">{{ t('settings.group.about') }}</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'version' }, { w: 260, h: 120 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.about.version') }}</div>
            <div class="settings-desc">{{ appVersion }}</div>
          </div>
        </div>
        <div
          class="settings-row"
          v-if="isDesktopApp"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'check-update', runLabel: updateBtn.label, desc: updateDesc, tab: 'about', tabLabel: t('settings.tab.about') }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.about.updateTitle') }}</div>
            <div class="settings-desc">{{ updateDesc }}</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="updateBtn.disabled"
            @click="updateBtn.fn()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'check-update', runLabel: updateBtn.label }, { w: 220, h: 120 })"
          >
            {{ updateBtn.label }}
          </button>
        </div>
        <div
          class="settings-row"
          v-if="isDesktopApp"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: t('settings.about.autoUpdateDesc'), tab: 'about', tabLabel: t('settings.tab.about'), runLabel: t('settings.about.autoUpdate') + t('settings.ctx.toggleSuffix') }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">{{ t('settings.about.autoUpdate') }}</div>
            <div class="settings-desc">{{ t('settings.about.autoUpdateDesc') }}</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="autoUpdate" @change="toggleAutoUpdate()" />
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>
    </div>

    <CtxMenu :menu="ctxMenu" :items="settingsCtxItems" :aria-label="t('settings.ctx.ctxMenuAria')" @action="onCtxAction" />
  </ModalBase>
</template>