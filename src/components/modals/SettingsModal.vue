<script setup>
/* LockPass — 设置模态框（Vue 迁移）
   复刻原生 settings.js：安全 / 本地文件同步 / 标签管理入口 / 数据说明 /
   数据管理（导入导出入口 + 修改主密码 + 销毁）/ 快捷键说明 / 关于 */
import { ref, computed, onMounted } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import { buildShortcutDefs } from '../../composables/useShortcuts'
import { useTheme } from '../../composables/useTheme'
import ModalBase from '../common/ModalBase.vue'

const { closeModal, openModal, saveVault, resetLockTimer, lockVault } = useVault()

/* ── 安全设置（本机配置，仅存 localStorage） ── */

const lockTimeout = ref(vaultState.lockTimeoutMs)
const clipboardClear = ref(vaultState.clipboardClearMs)

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
  // Tauri 桌面版：数据已通过本地文件存储，无需目录绑定
  if (window.FileStore && window.FileStore.isTauri) {
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
    if (handle) {
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
  if (window.FileStore && window.FileStore.isTauri) {
    info.sync = '桌面文件'
    info.file = '已启用'
    info.fileTagClass = 'tag-ok'
  } else if (window.FileSync.isSupported()) {
    const handle = await window.FileSync.getDirHandle()
    if (handle) {
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
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

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
</script>

<template>
  <ModalBase :max-width="'560px'" @close="closeModal()">
    <div class="modal-header">
      <h2>设置</h2>
      <button class="btn-icon" @click="closeModal()" tabindex="-1">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
    <div class="modal-body">
      <!-- 安全 -->
      <div class="settings-group">
        <div class="settings-group-title">安全</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">自动锁定</div>
            <div class="settings-desc">无操作后自动锁定保险箱</div>
          </div>
          <select class="form-input w-120" v-model.number="lockTimeout" @change="updateLockTimeout()">
            <option :value="60000">1 分钟</option>
            <option :value="300000">5 分钟</option>
            <option :value="900000">15 分钟</option>
            <option :value="1800000">30 分钟</option>
            <option :value="0">从不</option>
          </select>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">剪贴板清除</div>
            <div class="settings-desc">复制密码后自动清除剪贴板</div>
          </div>
          <select class="form-input w-120" v-model.number="clipboardClear" @change="updateClipboardClear()">
            <option :value="10000">10 秒</option>
            <option :value="30000">30 秒</option>
            <option :value="60000">60 秒</option>
          </select>
        </div>
      </div>

      <!-- 外观 -->
      <div class="settings-group">
        <div class="settings-group-title">外观</div>
        <div class="settings-row">
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
              @click="setMode(m.value)"
            >{{ m.label }}</button>
          </div>
        </div>
        <div class="settings-row">
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
              :title="accentLabel(a)"
              :aria-label="accentLabel(a)"
              @click="setAccent(a)"
            >
              <svg v-if="accentName === a" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3"><polyline points="20 6 9 17 4 12" /></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 本地文件同步 -->
      <div class="settings-group">
        <div class="settings-group-title">本地文件同步</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">数据目录</div>
            <div class="settings-desc">{{ syncStatus.text }}</div>
          </div>
          <button v-if="syncStatus.btnVisible" class="btn btn-secondary btn-sm" @click="bindDataDirectory()">{{ syncStatus.btnText }}</button>
        </div>
        <div class="settings-desc settings-desc-note">
          绑定后在所选目录下直接生成 LockPass-vault.json；浏览器清空 IndexedDB 后可重新选择目录恢复。
        </div>
      </div>

      <!-- 标签管理入口 -->
      <div class="settings-group">
        <div class="settings-group-title">标签管理</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">管理标签</div>
            <div class="settings-desc">增删改标签名称、颜色和图标</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="openModal('tags')">标签管理</button>
        </div>
      </div>

      <!-- 数据说明 -->
      <div class="settings-group">
        <div class="settings-group-title">数据说明</div>
        <div class="data-info-cards">
          <div class="data-info-card">
            <div class="data-info-card-label">密码条目</div>
            <div class="data-info-card-value">{{ dataInfo.entries }}</div>
          </div>
          <div class="data-info-card">
            <div class="data-info-card-label">标签</div>
            <div class="data-info-card-value">{{ dataInfo.tags }}</div>
          </div>
          <div class="data-info-card">
            <div class="data-info-card-label">数据大小</div>
            <div class="data-info-card-value">{{ dataInfo.size }}</div>
          </div>
          <div class="data-info-card">
            <div class="data-info-card-label">文件同步</div>
            <div class="data-info-card-value">{{ dataInfo.sync }}</div>
          </div>
        </div>
        <div class="data-info-arch">
          <div class="data-info-arch-title">存储架构</div>
          <div class="data-info-arch-item">
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">IndexedDB <span class="tag tag-info">数据库</span></span>
              <span class="tag tag-ok">正常</span>
            </div>
            <div class="data-info-arch-desc">密码库主存储（AES-256-GCM 加密）</div>
          </div>
          <div class="data-info-arch-item">
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">本地 JSON 文件 <span class="tag tag-info">备份</span></span>
              <span class="tag" :class="dataInfo.fileTagClass">{{ dataInfo.file }}</span>
            </div>
            <div class="data-info-arch-desc">LockPass-vault.json · 磁盘文件，清缓存不丢数据</div>
          </div>
          <div class="data-info-arch-item">
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">localStorage <span class="tag tag-muted">仅缓存</span></span>
            </div>
            <div class="data-info-arch-desc">仅存放同步标记等本机配置</div>
          </div>
        </div>
      </div>

      <!-- 数据管理 -->
      <div class="settings-group">
        <div class="settings-group-title">数据管理</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">导入备份</div>
            <div class="settings-desc">从加密备份或 CSV 文件导入</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="openModal('import')">导入</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">扫码导入</div>
            <div class="settings-desc">上传或粘贴二维码图片，导入单条密码</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="openModal('qr-import')">扫码导入</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">导出备份</div>
            <div class="settings-desc">将密码库导出为加密文件</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="openModal('export')">导出</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">修改主密码</div>
            <div class="settings-desc">更改解锁保险箱的主密码</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="openModal('change-pw')">修改</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label text-danger">销毁保险箱</div>
            <div class="settings-desc">删除所有数据，此操作不可撤销</div>
          </div>
          <button class="btn btn-danger btn-sm" @click="destroyVault()">销毁</button>
        </div>
      </div>

      <!-- 快捷键 -->
      <div class="settings-group">
        <div class="settings-group-title">快捷键</div>
        <div v-if="shortcuts.length" class="shortcut-table-wrap">
          <table class="shortcut-table">
            <thead><tr><th>操作</th><th>快捷键</th></tr></thead>
            <tbody>
              <tr v-for="d in shortcuts" :key="d.id">
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
      <div class="settings-group">
        <div class="settings-group-title">关于</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">版本</div>
            <div class="settings-desc">{{ appVersion }}</div>
          </div>
        </div>
      </div>
    </div>
  </ModalBase>
</template>