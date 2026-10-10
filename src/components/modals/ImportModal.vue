<script setup>
/* LockPass — 批量导入（.vault 加密备份 / .json 明文 / .csv 明文）
   Vue 3 迁移：对齐旧版 src/js/import-export.js 的导入流程
   - .vault / .json：加密备份（需输入主密码解密）或明文备份
   - .csv：Chrome/通用 CSV 导入向导（列映射 → 预览 → 确认，C2）
   备份导入两种模式（多设备同步设计文档 §6 / §10 P0）：
   - 合并（默认）：按条目 ID 走双向合并引擎，序号高者胜，真冲突进冲突表、落选版本入回收站；
   - 覆盖：同类型 + 同标题覆盖旧条目（旧版语义，供「以这份备份为准」的恢复场景）。
   CSV 仍按「标题 + 用户名」查重逐条询问。支持进度条与中途取消。 */
import { ref, computed } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'
import BaseSelect from '../common/BaseSelect.vue'
import { useI18n } from '../../composables/useI18n'

const { saveVault, closeModal, closeDetail, mergeExternalState } = useVault()
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
// 备份导入模式：'merge' = 按条目 ID 双向合并（默认）；'overwrite' = 同类型+同标题覆盖（旧语义）
const mergeMode = ref('merge')
// 合并结果（摘要 + 冲突表）；非空时停在结果页，等用户确认后才关闭
const result = ref(null)

/* C2 CSV 向导状态 */
const csvHeaders = ref([])
const csvMapping = ref({})       // { 表头原始名: 目标字段 }
const csvStats = ref(null)       // { totalRows, validCount, dupCount, previewRows }
const TARGET_OPTIONS = [
  { value: 'title', label: 'title' },
  { value: 'username', label: 'username' },
  { value: 'password', label: 'password' },
  { value: 'url', label: 'url' },
  { value: 'notes', label: 'notes' },
  { value: 'entrytype', label: 'entrytype' },
  { value: 'category', label: 'category' },
  { value: 'tags', label: 'tags' },
  { value: 'port', label: 'port' },
  { value: 'rootusername', label: 'rootusername' },
  { value: 'rootpassword', label: 'rootpassword' },
  { value: 'appid', label: 'appid' },
  { value: 'privatekey', label: 'privatekey' },
]
const IGNORE_VALUE = '__ignore__'

const csvTargetOptions = computed(() => [
  ...TARGET_OPTIONS,
  { value: IGNORE_VALUE, label: t('import.wizard.ignore') },
])

const csvWizardValid = computed(() => {
  const map = csvMapping.value || {}
  const values = Object.keys(map).map(k => map[k]).filter(v => v && v !== IGNORE_VALUE)
  return values.includes('title') && values.includes('password')
})

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
  mergeMode.value = 'merge'
  result.value = null
  csvHeaders.value = []
  csvMapping.value = {}
  csvStats.value = null
}

/** 结果页「完成」：合并可能产生冲突副本留在回收站，必须由用户确认后才收起 */
function finishImport() {
  resetState()
  closeModal()
}

/**
 * 冲突表只渲染条目级冲突：引擎把标签级冲突塞在同一数组里（形状不同，只有 winnerSide），
 * 直接遍历会在读取 c.winner 时抛错并让弹窗整体卸载。
 */
const entryConflicts = computed(() => (result.value?.conflicts || []).filter((c) => !c.tagConflict))

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
  const rawHeaders = window.Utils.parseCSVLine(lines[0])
  const headers = rawHeaders.map(h => h.toLowerCase().trim())
  // C2 向导：不再要求固定 title/password 列，进入列映射步骤
  const mapping = window.ImportExport
    ? window.ImportExport.autoGuessMapping(rawHeaders)
    : {}
  csvHeaders.value = rawHeaders
  csvMapping.value = mapping
  csvStats.value = window.ImportExport
    ? window.ImportExport.parseCSVPreview(text, mapping, vaultState.entries)
    : { totalRows: lines.length - 1, validCount: 0, dupCount: 0, previewRows: [] }

  importMode.value = 'csv'
  previewInfo.value = {
    kind: 'csv',
    title: t('import.fileCsv'),
    count: lines.length - 1,
    fields: headers.join(', '),
    warning: null,
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

/* C2 向导：列映射调整后刷新统计/预览 */
function refreshCSVStats() {
  if (!importData.value || importMode.value !== 'csv') return
  csvStats.value = window.ImportExport
    ? window.ImportExport.parseCSVPreview(importData.value, csvMapping.value, vaultState.entries)
    : csvStats.value
}

async function confirmImport() {
  if (!importData.value || importing.value) return
  cancelled.value = false
  importing.value = true
  progress.value = { pct: 0, text: t('import.importing') }
  try {
    if (importMode.value === 'csv') await importCSV(importData.value, csvMapping.value)
    else if (importMode.value === 'encrypted-vault') await importEncryptedVault(importData.value)
    else await importPlaintextVault(importData.value)
    if (!(await saveVault())) {
      // 落盘失败：必须复位进行中状态，否则弹窗卡在「导入中」无法重试
      // （saveVault 内部已弹出失败 toast）
      importing.value = false
      progress.value = { pct: 0, text: '' }
      return
    }
    // 合并模式：停在结果页展示摘要与冲突表，用户点「完成」才关闭
    if (result.value) {
      importing.value = false
      return
    }
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

/* ── 导入 CSV（C2 向导：按列映射解析，合并模式） ─────────────── */
async function importCSV(text, mapping) {
  const lines = window.Utils.splitCSVLines(text)
  const headers = window.Utils.parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())

  // 由列映射构建 targetField -> 列索引；映射为空时回退固定表头
  const idx = {}
  if (mapping && Object.keys(mapping).length) {
    Object.keys(mapping).forEach(k => {
      const target = mapping[k]
      const hi = headers.indexOf(String(k).toLowerCase().trim())
      if (hi !== -1 && target) idx[target] = hi
    })
  } else {
    headers.forEach(h => { if (window.ImportExport && window.ImportExport.COLUMN_TARGETS.includes(h)) idx[h] = headers.indexOf(h) })
  }

  const titleIdx = idx.title !== undefined ? idx.title : -1
  const passwordIdx = idx.password !== undefined ? idx.password : -1
  const usernameIdx = idx.username !== undefined ? idx.username : -1
  const urlIdx = idx.url !== undefined ? idx.url : -1
  const entryTypeIdx = idx.entrytype !== undefined ? idx.entrytype : -1
  const categoryIdx = idx.category !== undefined ? idx.category : -1
  const tagsIdx = idx.tags !== undefined ? idx.tags : -1
  const notesIdx = idx.notes !== undefined ? idx.notes : -1
  const rootUserIdx = idx.rootusername !== undefined ? idx.rootusername : -1
  const rootPwdIdx = idx.rootpassword !== undefined ? idx.rootpassword : -1
  const appIdIdx = idx.appid !== undefined ? idx.appid : -1
  const privateKeyIdx = idx.privatekey !== undefined ? idx.privatekey : -1
  const portIdx = idx.port !== undefined ? idx.port : -1
  const customFieldsIdx = idx.customfields !== undefined ? idx.customfields : -1

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

    // 数据完整性修复：解析 customFields 列（JSON 数组字符串，可空/损坏时忽略）
    if (customFieldsIdx !== -1 && cols[customFieldsIdx]) {
      try {
        const arr = JSON.parse(cols[customFieldsIdx])
        if (Array.isArray(arr)) fields.customFields = arr
      } catch (e) { /* 忽略格式错误的 customFields 列 */ }
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

/* v1.1.1：条目类型归一化（与 core/import-bridge.js 的 toEntryType 同口径） */
function normEntryType(v) {
  const t = (v || '').trim().toLowerCase()
  return ['website', 'server', 'database', 'ai', 'app', 'other'].includes(t) ? t : 'website'
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
  let decrypted
  try {
    // 使用文件的 salt、iterations 和 iv 解密（兼容性：旧文件无 iterations 时回退到 LEGACY_ITERATIONS）
    const salt = window.CryptoUtils.base64ToArrayBuffer(data.salt)
    const iterations = Number(data.iterations) || window.CryptoUtils.LEGACY_ITERATIONS
    const key = await window.CryptoUtils.deriveKey(masterPassword.value, new Uint8Array(salt), iterations)
    decrypted = await window.CryptoUtils.decrypt(data.data, data.iv, key)
  } catch (e) {
    throw new Error(t('import.errPwOrCorrupt'))
  }
  applyVaultImport(decrypted)
}

/* ── 导入明文备份 ─────────────────────────────────────────────── */
async function importPlaintextVault(data) {
  applyVaultImport(data)
}

/**
 * 备份负载落库，按所选模式二选一。
 * @param {object} payload 备份明文负载 { entries, deleted, tagDefs, categories, history }
 */
function applyVaultImport(payload) {
  if (mergeMode.value === 'merge') {
    // 引擎只改内存态，落盘由 confirmImport 的 saveVault 完成
    result.value = mergeExternalState(payload)
    if (vaultState.selectedEntry && !vaultState.entries.some(e => e.id === vaultState.selectedEntry)) {
      closeDetail()
    }
    return
  }
  overwriteImport(payload)
}

/* ── 覆盖导入（v1.1.1 旧语义：同类型 + 同标题覆盖，其余新增） ───── */
function overwriteImport(payload) {
  let added = 0
  let replaced = 0

  for (const raw of (payload.entries || [])) {
    // 旧 category 字段升级为标签
    const e = { ...raw }
    if (e.category) {
      const cat = (payload.categories || []).find(c => c.id === e.category)
      const name = cat ? cat.name : e.category
      e.tags = (e.tags || []).slice()
      if (!e.tags.includes(name)) e.tags.push(name)
      delete e.category
    }
    const dup = vaultState.entries.find(x =>
      normEntryType(x.entryType) === normEntryType(e.entryType) &&
      (x.title || '') === (e.title || '') && (e.title || '') !== ''
    )
    if (dup) {
      const merged = Object.assign({}, dup, e, {
        id: dup.id,
        favorite: !!dup.favorite,
        createdAt: dup.createdAt || e.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entryType: e.entryType || dup.entryType || 'website',
        customFields: Array.isArray(e.customFields) ? e.customFields : (dup.customFields || []),
      })
      const idx = vaultState.entries.indexOf(dup)
      if (idx !== -1) vaultState.entries.splice(idx, 1, merged)
      replaced++
    } else {
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
  }

  // 合并标签注册表
  vaultState.tagDefs = vaultState.tagDefs || {}
  ;(payload.categories || []).forEach(c => {
    mergeTagDef(c.name, { color: c.color, icon: c.icon, isDefault: true })
  })
  if (payload.tagDefs) {
    Object.keys(payload.tagDefs).forEach(name => mergeTagDef(name, payload.tagDefs[name]))
  }

  // 数据完整性修复：恢复回收站（deleted）与编辑历史（history），
  // 与 .vault 导出负载对齐；兼容旧备份缺失字段时保持现状
  restoreDeletedAndHistory(payload.deleted, payload.history)

  const doneMsg = replaced
    ? t('import.backupDoneReplaced', { added, replaced })
    : t('import.importedN', { added })
  progress.value = { pct: 100, text: doneMsg }
  window.Utils.showToast(doneMsg, 'success')
}

/* ── 恢复回收站与编辑历史（合并模式，兼容缺失字段） ─────────── */
function restoreDeletedAndHistory(deleted, history) {
  if (Array.isArray(deleted) && deleted.length) {
    vaultState.deleted = vaultState.deleted || []
    const existingIds = new Set(vaultState.deleted.map(x => x && x.id))
    deleted.forEach(d => {
      if (!d || !d.id) { vaultState.deleted.push(d); return }
      if (!existingIds.has(d.id)) {
        existingIds.add(d.id)
        vaultState.deleted.push({
          ...d,
          customFields: Array.isArray(d.customFields) ? d.customFields : [],
        })
      }
    })
  }
  if (history && typeof history === 'object') {
    vaultState.history = vaultState.history || {}
    Object.keys(history).forEach(id => {
      const list = history[id]
      if (!Array.isArray(list) || !list.length) return
      if (!vaultState.history[id]) {
        vaultState.history[id] = list.map(h => ({ ...h }))
      } else {
        const seen = new Set(vaultState.history[id].map(h => JSON.stringify(h)))
        list.forEach(h => {
          const s = JSON.stringify(h)
          if (!seen.has(s)) { seen.add(s); vaultState.history[id].push({ ...h }) }
        })
      }
      vaultState.history = { ...vaultState.history }
    })
  }
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
        <!-- 合并结果页：摘要 + 时钟漂移警示 + 冲突表，用户确认后才关闭 -->
        <div v-if="result" class="import-result">
          <div class="import-result-metrics">
            <span class="metric">{{ t('import.result.added', { n: result.summary.added }) }}</span>
            <span class="metric">{{ t('import.result.updated', { n: result.summary.updated }) }}</span>
            <span class="metric">{{ t('import.result.removed', { n: result.summary.removed }) }}</span>
            <span class="metric">{{ t('import.result.restored', { n: result.summary.restored }) }}</span>
            <span class="metric" :class="{ warn: result.summary.conflicts > 0 }">{{ t('import.result.conflicts', { n: result.summary.conflicts }) }}</span>
          </div>

          <p v-if="result.summary.conflicts === 0 && result.summary.tagConflicts === 0" class="text-muted text-sm">
            {{ t('import.result.clean') }}
          </p>

          <div v-if="result.strict" class="import-result-alert text-warning text-sm">
            {{ t('import.result.skewWarning', { mins: Math.round(result.skewMs / 60000) }) }}
          </div>

          <div v-if="result.summary.tagConflicts > 0" class="text-sm text-muted mt-1">
            {{ t('import.result.tagConflictNote', { n: result.summary.tagConflicts }) }}
          </div>

          <div v-if="entryConflicts.length" class="conflict-table mt-2">
            <div class="text-sm"><strong>{{ t('import.conflict.title') }}</strong></div>
            <div class="text-muted text-sm mt-1">{{ t('import.conflict.hint') }}</div>
            <div v-for="c in entryConflicts" :key="c.id" class="conflict-row">
              <div class="conflict-head">
                <span class="conflict-name">{{ c.title || t('common.unnamed') }}</span>
                <span class="text-muted text-sm">{{ c.username }}</span>
              </div>
              <div class="conflict-versions">
                <span class="version keep">
                  {{ t('import.conflict.kept') }} · {{ t(c.winner.side === 'local' ? 'import.conflict.local' : 'import.conflict.remote') }}
                  <span class="text-muted">#{{ c.winner.rev }}</span>
                  <span class="text-muted">{{ c.winner.updatedAt ? c.winner.updatedAt.slice(0, 10) : t('common.unknown') }}</span>
                </span>
                <span class="version drop">
                  {{ t('import.conflict.dropped') }} · {{ t(c.loser.side === 'local' ? 'import.conflict.local' : 'import.conflict.remote') }}
                  <span class="text-muted">#{{ c.loser.rev }}</span>
                  <span class="text-muted">{{ c.loser.updatedAt ? c.loser.updatedAt.slice(0, 10) : t('common.unknown') }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="!previewInfo"
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
            <template v-if="previewInfo.kind === 'encrypted'">{{ t('import.encryptedPreviewMeta', { time: previewInfo.exportedAt }) }}</template>
            <template v-else-if="previewInfo.kind === 'plaintext'">{{ t('import.plaintextPreviewMeta', { count: previewInfo.count }) }}</template>
          </div>

          <!-- C2 CSV 导入向导：列映射 → 预览 → 确认 -->
          <div v-if="previewInfo.kind === 'csv'" class="csv-wizard mt-2">
            <div class="text-sm"><strong>{{ t('import.wizard.title') }}</strong></div>
            <div class="text-muted text-sm mt-1">{{ t('import.wizard.hint') }}</div>

            <div class="csv-map-table mt-2">
              <div class="csv-map-row csv-map-head">
                <span class="csv-map-col">{{ t('import.wizard.colSource') }}</span>
                <span class="csv-map-col">{{ t('import.wizard.colTarget') }}</span>
              </div>
              <div v-for="(header, i) in csvHeaders" :key="i" class="csv-map-row">
                <span class="csv-map-col csv-map-src">{{ header || '(空)' }}</span>
                <BaseSelect
                  class="form-input csv-map-select"
                  :model-value="csvMapping[header] || IGNORE_VALUE"
                  :options="csvTargetOptions"
                  @change="value => { csvMapping[header] = value; refreshCSVStats() }"
                />
              </div>
            </div>

            <div v-if="csvStats" class="text-sm mt-2">
              <span class="text-muted">{{ t('import.wizard.stats', { total: csvStats.totalRows, valid: csvStats.validCount, dup: csvStats.dupCount }) }}</span>
              <span v-if="csvStats.dupCount > 0" class="text-warning"> · {{ t('import.wizard.dupWarn') }}</span>
            </div>
            <div v-if="!csvWizardValid" class="text-warning text-sm mt-1">{{ t('import.wizard.requiredHint') }}</div>
            <div v-else-if="csvStats && csvStats.validCount === 0" class="text-warning text-sm mt-1">{{ t('import.wizard.noValid') }}</div>

            <div v-if="csvStats && csvStats.previewRows.length" class="text-sm mt-2">
              <div class="text-muted">{{ t('import.wizard.preview', { n: csvStats.previewRows.length }) }}</div>
              <table class="csv-preview-table mt-1">
                <thead>
                  <tr><th>title</th><th>username</th><th>url</th><th>notes</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in csvStats.previewRows" :key="ri">
                    <td>{{ row.title }}</td>
                    <td>{{ row.username }}</td>
                    <td>{{ row.url }}</td>
                    <td>{{ row.notes }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 备份导入模式：合并（按条目 ID 双向合并，默认）/ 覆盖（以这份备份为准） -->
          <div v-if="previewInfo.kind !== 'csv'" class="import-mode mt-2">
            <div class="import-mode-toggle" role="group" :aria-label="t('import.mode.label')">
              <button
                type="button"
                class="mode-btn"
                :class="{ active: mergeMode === 'merge' }"
                :aria-pressed="mergeMode === 'merge'"
                @click="mergeMode = 'merge'"
              >{{ t('import.mode.merge') }}</button>
              <button
                type="button"
                class="mode-btn"
                :class="{ active: mergeMode === 'overwrite' }"
                :aria-pressed="mergeMode === 'overwrite'"
                @click="mergeMode = 'overwrite'"
              >{{ t('import.mode.overwrite') }}</button>
            </div>
            <div class="text-muted text-sm mt-1">
              {{ mergeMode === 'merge' ? t('import.mode.mergeHint') : t('import.mode.overwriteHint') }}
            </div>
          </div>

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
      <button v-if="!result" class="btn btn-secondary" @click="closeModal()">{{ t('confirm.default.cancel') }}</button>
      <button v-else class="btn btn-primary" @click="finishImport()">{{ t('import.result.done') }}</button>
      <button
        v-if="previewInfo && !importing && !result"
        class="btn btn-primary"
        :disabled="(importMode === 'encrypted-vault' && !masterPassword) || (importMode === 'csv' && !csvWizardValid)"
        @click="confirmImport()"
      >
        {{ t('import.btnImport') }}
      </button>
    </div>
  </ModalBase>
</template>
