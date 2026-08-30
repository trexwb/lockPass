<script setup>
/* LockPass — 批量导入（.vault 加密备份 / .json 明文 / .csv 明文）
   Vue 3 迁移：对齐旧版 src/js/import-export.js 的导入流程
   - .vault / .json：加密备份（需输入主密码解密）或明文备份
   - .csv：明文 CSV（表头映射 + 合并模式）
   导入采用合并模式：按「标题 + 用户名」查重，重复时逐条询问替换/跳过；
   支持进度条与中途取消。数据通过 useVault 的 vaultState / saveVault 操作。 */
import { ref } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'
import { useI18n } from '../../composables/useI18n'

const { saveVault, closeModal } = useVault()
const { t } = useI18n()

// P3-4：图标统一走 Utils.SvgIcons
const Icons = window.Utils.SvgIcons

const fileName = ref('')
const importType = ref('') // 'csv' | 'vault'
const importMode = ref('') // 'csv' | 'encrypted-vault' | 'plaintext-vault'
const importData = ref(null)
const previewInfo = ref(null)
const masterPassword = ref('')
const importing = ref(false)
const progress = ref({ pct: 0, text: '' })
const cancelled = ref(false)

function resetState() {
  fileName.value = ''
  importType.value = ''
  importMode.value = ''
  importData.value = null
  previewInfo.value = null
  masterPassword.value = ''
  importing.value = false
  progress.value = { pct: 0, text: '' }
  cancelled.value = false
}

function pickFile() {
  const input = document.getElementById('import-file-input')
  if (input) input.click()
}

function onFileDrop(e) {
  e.preventDefault()
  e.currentTarget.classList.remove('dragover')
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (file) processFile(file)
}

function onFileChange(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (file) processFile(file)
}

async function processFile(file) {
  const name = (file.name || '').toLowerCase()
  fileName.value = file.name || ''
  try {
    const text = await file.text()
    if (name.endsWith('.csv')) {
      importType.value = 'csv'
      importData.value = text
      previewCSV(text)
    } else if (name.endsWith('.vault') || name.endsWith('.json')) {
      importType.value = 'vault'
      importData.value = text
      previewVault(text)
    } else {
      window.Utils.showToast(t('import.errUnsupportedFormat'), 'error')
      resetState()
    }
  } catch (e) {
    window.Utils.showToast(t('import.errReadFailed', { msg: e.message || e }), 'error')
    resetState()
  }
}

function previewCSV(text) {
  const lines = window.Utils.splitCSVLines(text)
  if (lines.length < 2) {
    window.Utils.showToast(t('import.errCsvEmpty'), 'error')
    resetState()
    return
  }
  const headers = window.Utils.parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())
  // 列头校验：title 和 password 为必填列
  const missing = []
  if (!headers.includes('title')) missing.push('title')
  if (!headers.includes('password')) missing.push('password')
  if (missing.length) {
    window.Utils.showToast(t('import.errCsvMissingCols', { cols: missing.join('、') }), 'error')
    resetState()
    return
  }
  // 检测已知列头拼写（提示未知列但不阻断）
  const KNOWN_COLS = ['title', 'username', 'password', 'url', 'entrytype', 'category', 'tags', 'notes', 'rootusername', 'rootpassword', 'appid', 'privatekey', 'port']
  const unknown = headers.filter(h => h && !KNOWN_COLS.includes(h))
  const count = lines.length - 1
  importMode.value = 'csv'
  previewInfo.value = {
    kind: 'csv',
    title: t('import.fileCsv'),
    count: count,
    fields: headers.join(', '),
    warning: unknown.length ? t('import.unknownColsIgnored', { cols: unknown.join(', ') }) : null,
  }
}

function previewVault(text) {
  try {
    const data = JSON.parse(text)
    // 加密封套识别：.vault 导出（format:'encrypted'）与自动快照/同步文件
    // （format:'LockPass-file-sync'，如 LockPass-backup-*.json、LockPass-vault.json）
    // 结构等价（salt + iterations + iv + data），统一按结构判断
    if (data.data && data.iv && data.salt) {
      importMode.value = 'encrypted-vault'
      importData.value = data
      previewInfo.value = {
        kind: 'encrypted',
        title: t('import.fileEncrypted'),
        exportedAt: data.exportedAt || data.updatedAt || t('common.unknown'),
      }
    } else if (data.entries) {
      importMode.value = 'plaintext-vault'
      importData.value = data
      previewInfo.value = {
        kind: 'plaintext',
        title: t('import.filePlaintext'),
        count: (data.entries || []).length,
      }
    } else {
      window.Utils.showToast(t('import.errUnsupportedFormat'), 'error')
      resetState()
    }
  } catch (e) {
    window.Utils.showToast(t('import.errBadFormat'), 'error')
    resetState()
  }
}

function cancelImport() {
  cancelled.value = true
}

async function confirmImport() {
  if (!importData.value || importing.value) return
  cancelled.value = false
  importing.value = true
  progress.value = { pct: 0, text: t('import.importing') }
  try {
    if (importMode.value === 'csv') await importCSV(importData.value)
    else if (importMode.value === 'encrypted-vault') await importEncryptedVault(importData.value)
    else await importPlaintextVault(importData.value)
    await saveVault()
    setTimeout(() => {
      resetState()
      closeModal()
    }, 1200)
  } catch (e) {
    window.Utils.showToast(t('import.errImportFailed', { msg: e.message || e }), 'error')
    importing.value = false
    progress.value = { pct: 0, text: '' }
  }
}

/* ── 查重：标题 + 用户名（与旧版 import-export.js 保持一致） ── */
function findDuplicateByTitleUser(title, username) {
  return vaultState.entries.find(e =>
    (e.title || '') === (title || '') &&
    (e.username || '') === (username || '')
  )
}

/* ── 导入 CSV（合并模式） ─────────────────────────────────────── */
async function importCSV(text) {
  const lines = window.Utils.splitCSVLines(text)
  const headers = window.Utils.parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())

  const titleIdx = headers.indexOf('title')
  const usernameIdx = headers.indexOf('username')
  const passwordIdx = headers.indexOf('password')
  const urlIdx = headers.indexOf('url')
  const entryTypeIdx = headers.indexOf('entrytype')
  const categoryIdx = headers.indexOf('category')
  const tagsIdx = headers.indexOf('tags')
  const notesIdx = headers.indexOf('notes')
  const rootUserIdx = headers.indexOf('rootusername')
  const rootPwdIdx = headers.indexOf('rootpassword')
  const appIdIdx = headers.indexOf('appid')
  const privateKeyIdx = headers.indexOf('privatekey')
  const portIdx = headers.indexOf('port')

  if (titleIdx === -1 || passwordIdx === -1) {
    throw new Error(t('import.errCsvRequiredCols'))
  }

  let added = 0
  let replaced = 0
  let skipped = 0
  let emptySkipped = 0
  const rows = lines.slice(1)

  for (let i = 0; i < rows.length; i++) {
    const cols = window.Utils.parseCSVLine(rows[i])
    const title = cols[titleIdx]
    const password = cols[passwordIdx]

    if (!title || !password) { emptySkipped++; continue }

    const now = new Date().toISOString()
    const entryType = entryTypeIdx !== -1 ? (cols[entryTypeIdx] || '').trim().toLowerCase() : 'website'

    // 兼容旧 CSV：category 列并入 tags
    const csvTags = []
    if (categoryIdx !== -1 && cols[categoryIdx]) {
      const c = cols[categoryIdx].trim()
      if (c) csvTags.push(c)
    }
    if (tagsIdx !== -1 && cols[tagsIdx]) {
      cols[tagsIdx].split(';').forEach(t => {
        const s = t.trim()
        if (s && !csvTags.includes(s)) csvTags.push(s)
      })
    }

    const username = usernameIdx !== -1 ? (cols[usernameIdx] || '').trim() : ''

    const fields = {
      title,
      entryType,
      password,
      username,
      url: urlIdx !== -1 ? (cols[urlIdx] || '').trim() : '',
      notes: notesIdx !== -1 ? (cols[notesIdx] || '').trim() : '',
      tags: csvTags,
    }

    // server / database：携带 port
    if ((entryType === 'server' || entryType === 'database') && portIdx !== -1) {
      const p = parseInt(cols[portIdx], 10)
      if (!isNaN(p)) fields.port = p
    }

    // server 类型：携带 root 账号/密码
    if (entryType === 'server' && (rootUserIdx !== -1 || rootPwdIdx !== -1)) {
      fields.root = {
        username: rootUserIdx !== -1 ? (cols[rootUserIdx] || '').trim() : '',
        password: rootPwdIdx !== -1 ? (cols[rootPwdIdx] || '').trim() : '',
      }
    }

    // app 类型：携带 App ID、私钥
    if (entryType === 'app') {
      if (appIdIdx !== -1) fields.appId = (cols[appIdIdx] || '').trim()
      if (privateKeyIdx !== -1) fields.privateKey = (cols[privateKeyIdx] || '').trim()
    }

    // 标题 + 用户名查重（与二维码导入一致）
    const dup = findDuplicateByTitleUser(title, username)
    if (dup) {
      const dupLabel = `${title || t('common.unnamed')}${username ? t('import.withUser', { user: username }) : ''}`
      const ok = await window.Utils.confirm({
        title: t('import.dupFoundTitle'),
        message: t('import.dupFoundMsg', { label: dupLabel }),
        confirmText: t('import.dupReplace'),
        cancelText: t('import.dupSkip'),
        danger: true,
      })
      if (ok) {
        Object.keys(fields).forEach(k => { dup[k] = fields[k] })
        dup.updatedAt = now
        replaced++
      } else {
        skipped++
      }
    } else {
      vaultState.entries.push({
        ...fields,
        id: window.CryptoUtils.uuid(),
        favorite: false,
        showPassword: false,
        createdAt: now,
        updatedAt: now,
      })
      added++
    }

    if (i % 10 === 0) {
      progress.value.pct = Math.round((i / rows.length) * 100)
      await new Promise(r => setTimeout(r, 0))
      if (cancelled.value) {
        progress.value = {
          pct: 100,
          text: t('import.cancelledProgress', { added, replaced, skipped }),
        }
        window.Utils.showToast(t('import.cancelledToast', { added }), 'warning')
        return
      }
    }
  }

  const emptyHint = emptySkipped > 0 ? t('import.emptyRowsSkipped', { n: emptySkipped }) : ''
  progress.value = {
    pct: 100,
    text: t('import.doneProgress', { added, replaced, skipped, hint: emptyHint }),
  }
  window.Utils.showToast(t('import.doneProgress', { added, replaced, skipped, hint: emptyHint }), 'success')
}

/* ── 合并标签注册表（旧 categories 升级为 tagDefs） ────────────── */
function mergeTagDef(name, def) {
  if (!name || vaultState.tagDefs[name]) return
  vaultState.tagDefs[name] = def
}

/* ── 导入加密备份 ─────────────────────────────────────────────── */
async function importEncryptedVault(data) {
  if (!masterPassword.value) {
    throw new Error(t('lock.errorPwEmpty'))
  }
  try {
    // 使用文件的 salt、iterations 和 iv 解密（兼容性：旧文件无 iterations 时回退到 LEGACY_ITERATIONS）
    const salt = window.CryptoUtils.base64ToArrayBuffer(data.salt)
    const iterations = Number(data.iterations) || window.CryptoUtils.LEGACY_ITERATIONS
    const key = await window.CryptoUtils.deriveKey(masterPassword.value, new Uint8Array(salt), iterations)
    const decrypted = await window.CryptoUtils.decrypt(data.data, data.iv, key)

    let added = 0
    for (const entry of (decrypted.entries || [])) {
      // 旧 category 字段升级为标签
      const e = { ...entry }
      if (e.category) {
        const cat = (decrypted.categories || []).find(c => c.id === e.category)
        const name = cat ? cat.name : e.category
        e.tags = (e.tags || []).slice()
        if (!e.tags.includes(name)) e.tags.push(name)
        delete e.category
      }
      // 合并模式：不跳过冲突，直接作为新条目添加
      vaultState.entries.push({
        ...e,
        entryType: e.entryType || 'website',
        id: window.CryptoUtils.uuid(),
        createdAt: e.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // 自定义字段扩展（upgrade-design.md §1.3）：v1 备份补默认空数组
        customFields: (e.customFields || []),
      })
      added++
    }

    // 合并标签注册表
    vaultState.tagDefs = vaultState.tagDefs || {}
    ;(decrypted.categories || []).forEach(c => {
      mergeTagDef(c.name, { color: c.color, icon: c.icon, isDefault: true })
    })
    if (decrypted.tagDefs) {
      Object.keys(decrypted.tagDefs).forEach(name => mergeTagDef(name, decrypted.tagDefs[name]))
    }

    progress.value = { pct: 100, text: t('import.doneRecords', { added }) }
    window.Utils.showToast(t('import.importedN', { added }), 'success')
  } catch (e) {
    throw new Error(t('import.errPwOrCorrupt'))
  }
}

/* ── 导入明文备份 ─────────────────────────────────────────────── */
async function importPlaintextVault(data) {
  const { entries, categories, tagDefs } = data
  let added = 0

  for (const entry of (entries || [])) {
    // 合并模式：不跳过冲突，直接作为新条目添加
    vaultState.entries.push({
      ...entry,
      entryType: entry.entryType || 'website',
      id: window.CryptoUtils.uuid(),
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // 自定义字段扩展（upgrade-design.md §1.3）：v1 明文备份补默认空数组
      customFields: entry.customFields || [],
    })
    added++
  }

  // 合并标签注册表
  vaultState.tagDefs = vaultState.tagDefs || {}
  if (categories) {
    categories.forEach(c => mergeTagDef(c.name, { color: c.color, icon: c.icon, isDefault: true }))
  }
  if (tagDefs) {
    Object.keys(tagDefs).forEach(name => mergeTagDef(name, tagDefs[name]))
  }

  progress.value = { pct: 100, text: t('import.doneRecords', { added }) }
  window.Utils.showToast(t('import.importedN', { added }), 'success')
}
</script>

<template>
  <ModalBase :max-width="'520px'" @close="closeModal()">
    <div class="modal-header">
      <h3>{{ t('import.title') }}</h3>
      <button class="btn-icon" @click="closeModal()">
        <span v-html="Icons.close(16)"></span>
      </button>
    </div>

    <div class="modal-body">
      <template v-if="!importing">
        <div
          v-if="!previewInfo"
          class="file-drop"
          @click="pickFile()"
          @dragover.prevent="e => e.currentTarget.classList.add('dragover')"
          @dragleave="e => e.currentTarget.classList.remove('dragover')"
          @drop="onFileDrop"
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto mb-3">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div>{{ t('import.dropHere') }}</div>
          <div class="text-muted text-sm mt-1">{{ t('import.supportedFormats') }}</div>
          <input id="import-file-input" type="file" accept=".vault,.json,.csv,application/octet-stream,application/json,text/csv" style="display:none" @change="onFileChange" />
        </div>

        <div v-else class="import-preview">
          <div class="divider"></div>
          <div class="text-sm"><strong>{{ previewInfo.title }}</strong></div>
          <div class="text-muted text-sm mt-1">
            <template v-if="previewInfo.kind === 'csv'">{{ t('import.csvPreviewMeta', { count: previewInfo.count, fields: previewInfo.fields }) }}</template>
            <template v-else-if="previewInfo.kind === 'encrypted'">{{ t('import.encryptedPreviewMeta', { time: previewInfo.exportedAt }) }}</template>
            <template v-else>{{ t('import.plaintextPreviewMeta', { count: previewInfo.count }) }}</template>
          </div>
          <div v-if="previewInfo.kind === 'csv'" class="text-warning text-sm mt-2">{{ t('import.csvWarning') }}</div>
          <div v-if="previewInfo.warning" class="text-warning text-sm mt-1">{{ previewInfo.warning }}</div>
          <div v-if="previewInfo.kind === 'plaintext'" class="text-warning text-sm mt-2">{{ t('import.plaintextWarning') }}</div>
          <div v-if="previewInfo.kind === 'encrypted'" class="form-group mt-2 mb-0">
            <input v-model="masterPassword" class="form-input" type="password" :placeholder="t('import.pwPlaceholderDecrypt')" @keydown.enter.prevent="confirmImport()" />
          </div>
        </div>
      </template>

      <div v-else class="import-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progress.pct + '%' }"></div>
        </div>
        <div class="text-sm text-muted mt-1">{{ progress.text }}</div>
        <button class="btn btn-secondary btn-sm mt-2" :disabled="cancelled" @click="cancelImport()">
          {{ cancelled ? t('import.cancelling') : t('confirm.default.cancel') }}
        </button>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" @click="closeModal()">{{ t('confirm.default.cancel') }}</button>
      <button
        v-if="previewInfo && !importing"
        class="btn btn-primary"
        :disabled="importMode === 'encrypted-vault' && !masterPassword"
        @click="confirmImport()"
      >
        {{ t('import.btnImport') }}
      </button>
    </div>
  </ModalBase>
</template>
