<script setup>
/* LockPass — 设置模态框（Vue 迁移）
   复刻原生 settings.js：安全 / 本地文件同步 / 标签管理入口 / 数据说明 /
   数据管理（导入导出入口 + 修改主密码 + 销毁）/ 快捷键说明 / 关于 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import { APP_VERSION } from '../../core/version.js'
import { buildShortcutDefs } from '../../composables/useShortcuts'
import { useTheme } from '../../composables/useTheme'
import ModalBase from '../common/ModalBase.vue'
import { useCtxMenu } from '../../composables/useCtxMenu'
import CtxMenu from '../common/CtxMenu.vue'

const { closeModal, openModal, saveVault, resetLockTimer, lockVault } = useVault()

// P3-4：图标统一走 Utils.SvgIcons
const Icons = window.Utils.SvgIcons

/* ── 设置标签页分组 ── */
const settingsTab = ref('security')
const SETTINGS_TABS = [
  { id: 'security', label: '安全' },
  { id: 'appearance', label: '外观' },
  { id: 'sync', label: '同步备份' },
  { id: 'data', label: '数据' },
  { id: 'extension', label: '扩展' },
  { id: 'about', label: '关于' },
]

/* ── 安全设置（本机配置，仅存 localStorage） ── */

const lockTimeout = ref(vaultState.lockTimeoutMs)
const clipboardClear = ref(vaultState.clipboardClearMs)

/* ── 浏览器扩展：在线扩展包下载 + 使用指南 ── */

const EXT_GUIDE_URL =
  'https://trexwb.github.io/lockPass/guide.html'

const isDesktopApp = computed(() => !!(window.LockTauri && window.LockTauri.isTauri))

// P3-3 同款平台判定：navigator.platform 已废弃，userAgentData 优先
const isMac = (navigator.userAgentData && navigator.userAgentData.platform === 'macOS')
  || /mac/i.test(navigator.platform || '')

function openExternalUrl(url) {
  // 统一入口 Utils.openExternal：桌面走 Rust open_url（协议/字符白名单校验）
  // 在系统默认浏览器打开，命令失败自动降级新窗口；浏览器走 window.open。
  // 失败再退化为复制链接到剪贴板。直接 location 跳转会劫持 WebView 导航。
  window.Utils.openExternal(url).then(function () {
    if (window.LockTauri && window.LockTauri.isTauri) {
      window.Utils.showToast('已在系统浏览器中打开', 'success')
    }
  }).catch(function () {
    window.Utils.copyText(url).then(function () {
      window.Utils.showToast('链接已复制，请在系统浏览器中打开', 'warning')
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
    case 'checking': return '正在检查更新…'
    case 'available': return `发现新版本 v${updateVersion.value}`
    case 'downloading': return `正在下载 v${updateVersion.value}… ${updateProgress.value}%`
    case 'ready': return `新版本 v${updateVersion.value} 已安装完成，重启后生效`
    case 'uptodate': return '已是最新版本'
    case 'error': return `检查失败：${updateError.value}`
    default: return '检查 GitHub Releases 是否有新版本'
  }
})

const updateBtn = computed(() => {
  switch (updateStatus.value) {
    case 'checking': return { label: '检查中…', disabled: true }
    case 'available': return { label: `更新到 v${updateVersion.value}`, disabled: false, fn: startDownload }
    case 'downloading': return { label: `下载中 ${updateProgress.value}%`, disabled: true }
    case 'ready': return { label: '重启应用', disabled: false, fn: doRelaunch }
    default: return { label: '检查更新', disabled: false, fn: startCheck }
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
  window.Utils.showToast('设置已保存', 'success')
}

function updateClipboardClear() {
  const value = parseInt(clipboardClear.value, 10)
  vaultState.clipboardClearMs = value
  try { localStorage.setItem('lockpass_clipboard_clear', String(value)) } catch (e) {}
  window.Utils.showToast('设置已保存', 'success')
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
  if (BM.isDesktop()) return '（数据目录 backups/）'
  return '（绑定目录 backups/）'
})

const lastBackupText = computed(() => {
  if (!BM) return ''
  const at = BM.getLastBackupAt()
  if (!at) return '从未备份'
  const d = new Date(at)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})

function updateBackupInterval() {
  if (!BM) return
  BM.setIntervalDays(backupInterval.value)
  window.Utils.showToast('设置已保存', 'success')
}
function updateSnapshotEnabled() {
  if (!BM) return
  BM.setSnapshotEnabled(snapshotEnabled.value)
  window.Utils.showToast(snapshotEnabled.value ? '自动快照已开启' : '自动快照已关闭', 'success')
}
function updateSnapshotInterval() {
  if (!BM) return
  BM.setSnapshotIntervalDays(snapshotInterval.value)
  window.Utils.showToast('设置已保存', 'success')
}
function updateSnapshotKeep() {
  if (!BM) return
  BM.setSnapshotKeep(snapshotKeep.value)
  window.Utils.showToast('设置已保存', 'success')
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
      window.Utils.showToast('备份快照已生成', 'success')
    } else if (r.reason === 'permission') {
      window.Utils.showToast('目录授权已失效，请在浏览器地址栏重新授权，或重新绑定数据目录', 'warning')
    } else if (r.reason === 'empty') {
      window.Utils.showToast('备份失败：无数据可备份', 'error')
    } else if (r.reason === 'unbound') {
      window.Utils.showToast('请先绑定数据目录', 'warning')
    } else {
      window.Utils.showToast('备份失败：' + ((r.error && r.error.message) || r.reason), 'error')
    }
  } catch (e) {
    window.Utils.showToast('备份失败：' + (e.message || e), 'error')
  } finally {
    backupBusy.value = false
  }
}

/* ── 外观（主题模式 + 强调色，useTheme 管理持久化与 data-* 属性） ── */

const { themeMode, accentName, ACCENTS, setMode, setAccent } = useTheme()
const themeModes = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' },
]
const ACCENT_LABELS = { blue: '蓝色', green: '绿色', purple: '紫色', orange: '橙色', red: '红色', cyan: '青色' }
function accentLabel(a) {
  return ACCENT_LABELS[a] || a
}

/* ── 本地文件同步 ── */

const syncStatus = ref({ text: '检查中…', btnText: '绑定', btnVisible: true })

async function refreshFileSyncStatus() {
  const status = syncStatus.value
  // Tauri 桌面版：数据已通过本地文件存储，无需目录绑定（双信号判定）
  if ((window.FileStore && window.FileStore.isTauri) || window.__TAURI_INTERNALS__) {
    status.text = '数据已保存在桌面本地文件'
    status.btnVisible = false
    try {
      const dir = await window.FileStore.dataDir()
      if (dir) status.text = '数据目录：' + dir
    } catch (e) { /* 目录获取失败时保留默认文案 */ }
    return
  }
  if (!window.FileSync.isSupported()) {
    status.text = '当前浏览器不支持（请用 Chrome / Edge）'
    status.btnVisible = false
    return
  }
  try {
    const handle = await window.FileSync.getDirHandle()
    if (handle && !window.FileSync.isUsableDirHandle(handle)) {
      status.text = '目录句柄失效，请重新绑定'
      status.btnText = '重新绑定'
    } else if (handle) {
      status.text = '已绑定：' + handle.name + ' → LockPass-vault.json'
      status.btnText = '重新绑定'
    } else {
      status.text = '未绑定，数据仅保存在浏览器内'
      status.btnText = '绑定'
    }
  } catch (e) {
    status.text = '状态读取失败'
  }
}

async function bindDataDirectory() {
  try {
    const out = await window.FileSync.bindDirectory()
    if (out.restored) {
      lockVaultAndNotice()
    } else if (out.result && out.result.ok) {
      window.Utils.showToast('已绑定本地目录，数据将自动同步', 'success')
    } else if (out.result && out.result.reason === 'empty') {
      window.Utils.showToast('目录已绑定，创建保险箱后将自动同步', 'success')
    } else {
      window.Utils.showToast('目录已绑定，但同步未完成', 'warning')
    }
    refreshFileSyncStatus()
  } catch (e) {
    if (e && e.name === 'AbortError') return // 用户取消
    window.Utils.showToast(e.message || '绑定失败', 'error')
  }
}

// 绑定目录时若 IndexedDB 已从目录重建：回到锁屏等待解锁
function lockVaultAndNotice() {
  lockVault()
  // R5 修复：绑定目录恢复数据后置为已初始化，锁屏切换为「输入主密码解锁」
  vaultState.initialized = true
  closeModal()
  window.Utils.showToast('已从本地文件恢复数据，输入主密码解锁', 'success')
}

/* ── 数据说明 ── */

const dataInfo = ref({
  entries: '…',
  tags: '…',
  size: '—',
  sync: '…',
  file: '未绑定',
  fileTagClass: 'tag-muted',
})

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(2) + ' MB'
}

async function refreshDataInfo() {
  const info = dataInfo.value
  info.entries = (vaultState.entries || []).length + ' 条'
  info.tags = (vaultState.tags || []).length + ' 个'

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
    info.sync = '桌面文件'
    info.file = '已启用'
    info.fileTagClass = 'tag-ok'
  } else if (window.FileSync.isSupported()) {
    const handle = await window.FileSync.getDirHandle()
    if (handle && !window.FileSync.isUsableDirHandle(handle)) {
      info.sync = '句柄失效'
      info.file = '需重绑'
      info.fileTagClass = 'tag-warning'
    } else if (handle) {
      if (window.FileSync.lastSyncError) {
        info.sync = '同步失败'
        info.file = '同步失败'
        info.fileTagClass = 'tag-danger'
      } else {
        info.sync = '已绑定'
        info.file = '已同步'
        info.fileTagClass = 'tag-ok'
      }
    } else {
      info.sync = '未绑定'
      info.file = '未绑定'
      info.fileTagClass = 'tag-muted'
    }
  } else {
    info.sync = '不支持'
    info.file = '不支持'
    info.fileTagClass = 'tag-muted'
  }
}

/* ── 销毁保险箱 ── */

async function destroyVault() {
  const confirmed = await window.Utils.confirm({
    title: '销毁保险箱',
    message: '⚠️ 此操作将删除所有密码数据，且无法恢复！\n\n确定要销毁保险箱吗？',
    confirmText: '销毁',
    danger: true,
  })
  if (!confirmed) return
  const doubleConfirm = await window.Utils.confirm({
    title: '最后确认',
    message: '您真的要销毁所有数据吗？',
    confirmText: '确认销毁',
    danger: true,
  })
  if (!doubleConfirm) return

  try {
    // 先清理本地同步文件与目录绑定（目录句柄在 IndexedDB 中，须在删库前执行）
    await window.FileSync.deleteLocalFile()
    await window.FileSync.unbindDirectory()
    await window.DBUtils.deleteDatabase()
    window.Utils.showToast('保险箱已销毁', 'success')
    setTimeout(() => { location.reload() }, 800)
  } catch (e) {
    window.Utils.showToast('销毁失败：' + (e.message || e), 'error')
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
        const text = payload.desc || ''
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
      list.push({ key: 'jump', label: '跳到此页', iconHtml: Icons?.grid(14), accent: true })
      return list
    }
    case 'row-action': {
      if (p.target) list.push({ key: 'run', label: '执行：' + (p.runLabel || '操作'), iconHtml: Icons?.edit(14), accent: true })
      if (p.tab) list.push({ key: 'go-tab', label: '跳到「' + p.tabLabel + '」分组', iconHtml: Icons?.grid(14) })
      if (p.desc) list.push({ key: 'copy-desc', label: '复制说明文字', iconHtml: Icons?.copy(14) })
      return list
    }
    case 'card': {
      list.push({ key: 'copy-value', label: '复制数值：' + (p.value || ''), iconHtml: Icons?.copy(14), accent: true, disabled: !p.value })
      return list
    }
    case 'arch-item': {
      list.push({ key: 'copy-name', label: '复制组件名：' + (p.name || ''), iconHtml: Icons?.copy(14) })
      list.push({ key: 'copy-desc', label: '复制说明文字', iconHtml: Icons?.share(14) })
      return list
    }
    case 'shortcut': {
      const keys = p.def ? shortcutKeyText(p.def) : ''
      list.push({ key: 'copy-combo', label: '复制快捷键：' + keys, iconHtml: Icons?.copy(14), accent: true, disabled: !keys })
      list.push({ key: 'copy-name', label: '复制操作名称', iconHtml: Icons?.share(14) })
      return list
    }
    case 'accent-dot': {
      list.push({ key: 'apply', label: '使用强调色：' + accentLabel(p.accent), iconHtml: Icons?.palette(14), accent: true })
      list.push({ key: 'copy-label', label: '复制颜色名', iconHtml: Icons?.copy(14) })
      return list
    }
    case 'theme-btn': {
      const label = p.mode === 'dark' ? '深色' : p.mode === 'light' ? '浅色' : '跟随系统'
      list.push({ key: 'apply', label: '应用主题：' + label, iconHtml: Icons?.grid(14), accent: true })
      return list
    }
    case 'select': {
      list.push({ key: 'copy-value', label: '复制当前值', iconHtml: Icons?.copy(14), accent: true })
      if (p.label) list.push({ key: 'copy-label', label: '复制标签：' + p.label, iconHtml: Icons?.share(14) })
      return list
    }
    case 'version': {
      list.push({ key: 'copy-version', label: '复制版本号 ' + (appVersion.value || ('v' + APP_VERSION)), iconHtml: Icons?.copy(14), accent: true })
      return list
    }
  }
  return list
})
</script>

<template>
  <ModalBase :max-width="'560px'" @close="closeModal()">
    <div class="modal-header">
      <h2>设置</h2>
      <button class="btn-icon" @click="closeModal()" tabindex="-1">
        <span v-html="Icons.close(16)"></span>
      </button>
    </div>
    <div class="modal-body">
      <!-- 设置标签页导航 -->
      <div class="settings-tabs" role="tablist" aria-label="设置分类">
        <button
          v-for="tab in SETTINGS_TABS"
          :key="tab.id"
          class="settings-tab"
          :class="{ active: settingsTab === tab.id }"
          role="tab"
          :aria-selected="settingsTab === tab.id ? 'true' : 'false'"
          :title="tab.label + '（右键快速跳转）'"
          @click="settingsTab = tab.id"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'tab', tab: tab.id }, { w: 180, h: 100 })"
        >{{ tab.label }}</button>
      </div>

      <!-- 安全 -->
      <div class="settings-group" v-show="settingsTab === 'security'">
        <div class="settings-group-title">安全</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: '', desc: '无操作后自动锁定保险箱', tab: 'security', tabLabel: '安全', runLabel: '自动锁定（保存）' }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">自动锁定</div>
            <div class="settings-desc">无操作后自动锁定保险箱</div>
          </div>
          <select
            class="form-input w-120"
            v-model.number="lockTimeout"
            @change="updateLockTimeout()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: lockTimeout, label: '自动锁定间隔' }, { w: 220, h: 120 })"
          >
            <option :value="60000">1 分钟</option>
            <option :value="300000">5 分钟</option>
            <option :value="900000">15 分钟</option>
            <option :value="1800000">30 分钟</option>
            <option :value="0">从不</option>
          </select>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: '复制密码后自动清除剪贴板', tab: 'security', tabLabel: '安全', runLabel: '剪贴板清除（保存）' }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">剪贴板清除</div>
            <div class="settings-desc">复制密码后自动清除剪贴板</div>
          </div>
          <select
            class="form-input w-120"
            v-model.number="clipboardClear"
            @change="updateClipboardClear()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: clipboardClear, label: '剪贴板自动清除' }, { w: 220, h: 120 })"
          >
            <option :value="10000">10 秒</option>
            <option :value="30000">30 秒</option>
            <option :value="60000">60 秒</option>
          </select>
        </div>
      </div>

      <!-- 外观 -->
      <div class="settings-group" v-show="settingsTab === 'appearance'">
        <div class="settings-group-title">外观</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: '跟随系统时实时响应系统深浅切换', tab: 'appearance', tabLabel: '外观' }, { w: 260, h: 140 })"
        >
          <div>
            <div class="settings-label">主题</div>
            <div class="settings-desc">跟随系统时实时响应系统深浅切换</div>
          </div>
          <div class="theme-mode-switch" role="radiogroup" aria-label="主题模式">
            <button
              v-for="m in themeModes"
              :key="m.value"
              class="theme-mode-btn"
              :class="{ active: themeMode === m.value }"
              :title="m.label + '（右键快速应用）'"
              @click="setMode(m.value)"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'theme-btn', mode: m.value }, { w: 200, h: 120 })"
            >{{ m.label }}</button>
          </div>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: '应用于按钮、选中态与焦点边框', tab: 'appearance', tabLabel: '外观' }, { w: 260, h: 140 })"
        >
          <div>
            <div class="settings-label">强调色</div>
            <div class="settings-desc">应用于按钮、选中态与焦点边框</div>
          </div>
          <div class="accent-palette" role="radiogroup" aria-label="强调色">
            <button
              v-for="a in ACCENTS"
              :key="a"
              class="accent-dot"
              :class="['accent-' + a, { active: accentName === a }]"
              :title="accentLabel(a) + '（右键快速应用/复制）'"
              :aria-label="accentLabel(a)"
              @click="setAccent(a)"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'accent-dot', accent: a }, { w: 220, h: 130 })"
            >
              <svg v-if="accentName === a" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3"><polyline points="20 6 9 17 4 12" /></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 本地文件同步 -->
      <div class="settings-group" v-show="settingsTab === 'sync'">
        <div class="settings-group-title">本地文件同步</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: syncStatus.btnVisible ? 'bind-dir' : '', runLabel: syncStatus.btnText, desc: syncStatus.text, tab: 'sync', tabLabel: '同步备份' }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">数据目录</div>
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
          绑定后在所选目录下直接生成 LockPass-vault.json；浏览器清空 IndexedDB 后可重新选择目录恢复。
        </div>
      </div>

      <!-- 备份 -->
      <div class="settings-group" v-show="settingsTab === 'sync'">
        <div class="settings-group-title">备份</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: '距上次 .vault 导出或快照超过间隔时，解锁后提醒', tab: 'sync', tabLabel: '同步备份', runLabel: '备份提醒（保存）' }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">备份提醒</div>
            <div class="settings-desc">距上次 .vault 导出或快照超过间隔时，解锁后提醒</div>
          </div>
          <select
            class="form-input w-120"
            v-model.number="backupInterval"
            @change="updateBackupInterval()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: backupInterval, label: '备份提醒间隔' }, { w: 220, h: 120 })"
          >
            <option :value="0">关闭</option>
            <option :value="1">每天</option>
            <option :value="3">每 3 天</option>
            <option :value="7">每 7 天</option>
            <option :value="30">每 30 天</option>
          </select>
        </div>
        <div
          class="settings-row"
          v-if="canSnapshot"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: '解锁后自动生成加密快照' + snapLocationText + '，保留最近 ' + snapshotKeep + ' 份', tab: 'sync', tabLabel: '同步备份', runLabel: '自动快照（切换）' }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">自动快照</div>
            <div class="settings-desc">解锁后自动生成加密快照{{ snapLocationText }}，保留最近 {{ snapshotKeep }} 份</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="snapshotEnabled" @change="updateSnapshotEnabled()" />
            <span class="switch-slider"></span>
          </label>
        </div>
        <template v-if="canSnapshot && snapshotEnabled">
          <div
            class="settings-row"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: '自动生成快照的最小间隔', tab: 'sync', tabLabel: '同步备份' }, { w: 260, h: 170 })"
          >
            <div>
              <div class="settings-label">快照间隔</div>
              <div class="settings-desc">自动生成快照的最小间隔</div>
            </div>
            <select
              class="form-input w-120"
              v-model.number="snapshotInterval"
              @change="updateSnapshotInterval()"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: snapshotInterval, label: '快照间隔' }, { w: 220, h: 120 })"
            >
              <option :value="1">每天</option>
              <option :value="3">每 3 天</option>
              <option :value="7">每 7 天</option>
              <option :value="30">每 30 天</option>
            </select>
          </div>
          <div
            class="settings-row"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: '超出后自动删除最旧快照', tab: 'sync', tabLabel: '同步备份' }, { w: 260, h: 170 })"
          >
            <div>
              <div class="settings-label">保留份数</div>
              <div class="settings-desc">超出后自动删除最旧快照</div>
            </div>
            <select
              class="form-input w-120"
              v-model.number="snapshotKeep"
              @change="updateSnapshotKeep()"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'select', value: snapshotKeep, label: '快照保留份数' }, { w: 220, h: 120 })"
            >
              <option :value="3">3 份</option>
              <option :value="5">5 份</option>
              <option :value="10">10 份</option>
              <option :value="20">20 份</option>
            </select>
          </div>
        </template>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'backup-now', runLabel: backupBusy ? '备份中' : (canSnapshot ? '立即备份' : '导出 .vault'), desc: lastBackupText, tab: 'sync', tabLabel: '同步备份' }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">上次备份</div>
            <div class="settings-desc">{{ lastBackupText }}</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="backupBusy"
            @click="backupNow()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'backup-now', runLabel: backupBusy ? '备份中' : (canSnapshot ? '立即备份' : '导出 .vault') }, { w: 220, h: 120 })"
          >
            {{ backupBusy ? '备份中…' : (canSnapshot ? '立即备份' : '导出 .vault') }}
          </button>
        </div>
      </div>

      <!-- 浏览器扩展（自动填充） -->
      <div class="settings-group" v-show="settingsTab === 'extension'">
        <div class="settings-group-title">浏览器扩展</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-ext-download', runLabel: '下载扩展 zip', desc: appVersion + ' · 解压后在 Chrome/Edge 中加载已解压的扩展程序', tab: 'extension', tabLabel: '扩展' }, { w: 260, h: 190 })"
        >
          <div>
            <div class="settings-label">下载扩展包</div>
            <div class="settings-desc">{{ appVersion }} · 解压后在 Chrome/Edge 中「加载已解压的扩展程序」</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="downloadExtension()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-ext-download', runLabel: '下载扩展 zip' }, { w: 220, h: 120 })"
          >下载 zip</button>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-ext-guide', runLabel: '查看文档', desc: '安装步骤、配对流程、自动填充用法与常见问题', tab: 'extension', tabLabel: '扩展' }, { w: 260, h: 190 })"
        >
          <div>
            <div class="settings-label">使用指南</div>
            <div class="settings-desc">安装步骤、配对流程、自动填充用法与常见问题</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openGuide()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-ext-guide', runLabel: '查看文档' }, { w: 220, h: 120 })"
          >查看文档</button>
        </div>
        <div class="settings-desc settings-desc-note" v-if="isDesktopApp">
          桌面版不支持直接打开外部链接，点击下载后链接已复制到剪贴板，请在系统浏览器中粘贴打开。
        </div>
      </div>

      <!-- 标签管理入口 -->
      <div class="settings-group" v-show="settingsTab === 'data'">
        <div class="settings-group-title">标签管理</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-tags', runLabel: '标签管理', desc: '增删改标签名称、颜色和图标', tab: 'data', tabLabel: '数据' }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">管理标签</div>
            <div class="settings-desc">增删改标签名称、颜色和图标</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openModal('tags')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'open-tags', runLabel: '标签管理' }, { w: 220, h: 120 })"
          >标签管理</button>
        </div>
      </div>

      <!-- 数据说明 -->
      <div class="settings-group" v-show="settingsTab === 'data'">
        <div class="settings-group-title">数据说明</div>
        <div class="data-info-cards">
          <div
            class="data-info-card"
            title="右键可复制数值"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'card', value: dataInfo.entries, label: '密码条目' }, { w: 220, h: 120 })"
          >
            <div class="data-info-card-label">密码条目</div>
            <div class="data-info-card-value">{{ dataInfo.entries }}</div>
          </div>
          <div
            class="data-info-card"
            title="右键可复制数值"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'card', value: dataInfo.tags, label: '标签' }, { w: 220, h: 120 })"
          >
            <div class="data-info-card-label">标签</div>
            <div class="data-info-card-value">{{ dataInfo.tags }}</div>
          </div>
          <div
            class="data-info-card"
            title="右键可复制数值"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'card', value: dataInfo.size, label: '数据大小' }, { w: 220, h: 120 })"
          >
            <div class="data-info-card-label">数据大小</div>
            <div class="data-info-card-value">{{ dataInfo.size }}</div>
          </div>
          <div
            class="data-info-card"
            title="右键可复制数值"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'card', value: dataInfo.sync, label: '文件同步' }, { w: 220, h: 120 })"
          >
            <div class="data-info-card-label">文件同步</div>
            <div class="data-info-card-value">{{ dataInfo.sync }}</div>
          </div>
        </div>
        <div class="data-info-arch">
          <div class="data-info-arch-title">存储架构</div>
          <div
            class="data-info-arch-item"
            title="右键更多操作"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'arch-item', name: 'IndexedDB', desc: '密码库主存储（AES-256-GCM 加密）' }, { w: 260, h: 150 })"
          >
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">IndexedDB <span class="tag tag-info">数据库</span></span>
              <span class="tag tag-ok">正常</span>
            </div>
            <div class="data-info-arch-desc">密码库主存储（AES-256-GCM 加密）</div>
          </div>
          <div
            class="data-info-arch-item"
            title="右键更多操作"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'arch-item', name: '本地 JSON 文件', desc: 'LockPass-vault.json · 磁盘文件，清缓存不丢数据' }, { w: 260, h: 150 })"
          >
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">本地 JSON 文件 <span class="tag tag-info">备份</span></span>
              <span class="tag" :class="dataInfo.fileTagClass">{{ dataInfo.file }}</span>
            </div>
            <div class="data-info-arch-desc">LockPass-vault.json · 磁盘文件，清缓存不丢数据</div>
          </div>
          <div
            class="data-info-arch-item"
            title="右键更多操作"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'arch-item', name: 'localStorage', desc: '仅存放同步标记等本机配置' }, { w: 260, h: 150 })"
          >
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">localStorage <span class="tag tag-muted">仅缓存</span></span>
            </div>
            <div class="data-info-arch-desc">仅存放同步标记等本机配置</div>
          </div>
        </div>
      </div>

      <!-- 数据管理 -->
      <div class="settings-group" v-show="settingsTab === 'security'">
        <div class="settings-group-title">数据管理</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'import', runLabel: '导入', desc: '从加密备份或 CSV 文件导入', tab: 'security', tabLabel: '安全' }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">导入备份</div>
            <div class="settings-desc">从加密备份或 CSV 文件导入</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openModal('import')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'import', runLabel: '导入备份' }, { w: 220, h: 120 })"
          >导入</button>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'qr-import', runLabel: '扫码导入', desc: '上传或粘贴二维码图片，导入单条密码', tab: 'security', tabLabel: '安全' }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">扫码导入</div>
            <div class="settings-desc">上传或粘贴二维码图片，导入单条密码</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openModal('qr-import')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'qr-import', runLabel: '扫码导入' }, { w: 220, h: 120 })"
          >扫码导入</button>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'export', runLabel: '导出备份', desc: '将密码库导出为加密文件', tab: 'security', tabLabel: '安全' }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">导出备份</div>
            <div class="settings-desc">将密码库导出为加密文件</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openModal('export')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'export', runLabel: '导出备份' }, { w: 220, h: 120 })"
          >导出</button>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'change-pw', runLabel: '修改主密码', desc: '更改解锁保险箱的主密码', tab: 'security', tabLabel: '安全' }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">修改主密码</div>
            <div class="settings-desc">更改解锁保险箱的主密码</div>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            @click="openModal('change-pw')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'change-pw', runLabel: '修改主密码' }, { w: 220, h: 120 })"
          >修改</button>
        </div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'destroy', runLabel: '销毁保险箱', desc: '删除所有数据，此操作不可撤销', tab: 'security', tabLabel: '安全' }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label text-danger">销毁保险箱</div>
            <div class="settings-desc">删除所有数据，此操作不可撤销</div>
          </div>
          <button
            class="btn btn-danger btn-sm"
            @click="destroyVault()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'destroy', runLabel: '销毁保险箱' }, { w: 220, h: 120 })"
          >销毁</button>
        </div>
      </div>

      <!-- 快捷键 -->
      <div class="settings-group" v-show="settingsTab === 'appearance'">
        <div class="settings-group-title">快捷键</div>
        <div v-if="shortcuts.length" class="shortcut-table-wrap">
          <table class="shortcut-table">
            <thead><tr><th>操作</th><th>快捷键</th></tr></thead>
            <tbody>
              <tr
                v-for="d in shortcuts"
                :key="d.id"
                title="右键可复制"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'shortcut', def: d }, { w: 260, h: 150 })"
              >
                <td class="shortcut-name">{{ d.name }}</td>
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
        <div class="settings-group-title">关于</div>
        <div
          class="settings-row"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'version' }, { w: 260, h: 120 })"
        >
          <div>
            <div class="settings-label">版本</div>
            <div class="settings-desc">{{ appVersion }}</div>
          </div>
        </div>
        <div
          class="settings-row"
          v-if="isDesktopApp"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', target: 'check-update', runLabel: updateBtn.label, desc: updateDesc, tab: 'about', tabLabel: '关于' }, { w: 260, h: 180 })"
        >
          <div>
            <div class="settings-label">应用更新</div>
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
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'row-action', desc: '启动时后台检查新版本，发现后自动下载安装', tab: 'about', tabLabel: '关于', runLabel: '自动检查更新（切换）' }, { w: 260, h: 170 })"
        >
          <div>
            <div class="settings-label">自动检查更新</div>
            <div class="settings-desc">启动时后台检查新版本，发现后自动下载安装</div>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="autoUpdate" @change="toggleAutoUpdate()" />
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>
    </div>

    <CtxMenu :menu="ctxMenu" :items="settingsCtxItems" aria-label="设置快捷操作" @action="onCtxAction" />
  </ModalBase>
</template>