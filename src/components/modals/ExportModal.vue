<script setup>
/* LockPass — 导出（.vault 加密备份 / .csv 明文）
    Vue 3 迁移：对齐旧版 src/js/import-export.js 的导出流程
    - 加密备份：使用会话密钥加密 {entries, tagDefs, tags}，附 salt/iterations/iv
    - 明文 CSV：表头与旧版一致，导出前提示明文风险
    - P3-F3：支持按标签筛选导出范围 */
import { ref, computed } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'
import { useI18n } from '../../composables/useI18n'

const { closeModal } = useVault()
const { t } = useI18n()

// P3-4：图标统一走 Utils.SvgIcons
const Icons = window.Utils.SvgIcons

const exporting = ref(false)
const exportProgress = ref('')
const exportTagFilter = ref('') // 空 = 全部

const availableTags = computed(() => Object.keys(vaultState.tagDefs).sort())

// 按标签筛选后的条目
const entriesToExport = computed(() => {
  if (!exportTagFilter.value) return vaultState.entries
  return vaultState.entries.filter(e => (e.tags || []).includes(exportTagFilter.value))
})

async function exportEncryptedVault() {
  if (exporting.value) return
  exporting.value = true
  exportProgress.value = t('export.exportingVault')
  try {
    if (!vaultState.cryptoKey) {
      window.Utils.showToast(t('export.errNoSessionKey'), 'error')
      return
    }
    const now = new Date()
    const dateStr = window.Utils.formatDateFilename(now)

    const { iv, data } = await window.CryptoUtils.encrypt(
      {
        entries: entriesToExport.value,
        tagDefs: vaultState.tagDefs,
        tags: vaultState.tags,
      },
      vaultState.cryptoKey
    )

    const saltRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'salt')
    const iterRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'iterations')

    const exportData = {
      version: 1,
      exportedAt: now.toISOString(),
      format: 'encrypted',
      salt: saltRecord.value,
      iterations: iterRecord ? (Number(iterRecord.value) || window.CryptoUtils.LEGACY_ITERATIONS) : window.CryptoUtils.LEGACY_ITERATIONS,
      iv,
      data,
      tagDefs: vaultState.tagDefs,
    }

    const tagSuffix = exportTagFilter.value ? `-${exportTagFilter.value}` : ''
    window.Utils.downloadFile(
      `${t('export.filePrefix')}${tagSuffix}-${dateStr}.vault`,
      JSON.stringify(exportData, null, 2),
      'application/json'
    )
    // 记录备份时间：提醒周期从最近一次 .vault 导出/快照起算
    if (window.BackupManager) window.BackupManager.markBackupNow()
    window.Utils.showToast(t('export.doneVault', { n: entriesToExport.value.length }), 'success')
    closeModal()
  } catch (e) {
    window.Utils.showToast(t('toast.exportFailed', { msg: e.message || e }), 'error')
  } finally {
    exporting.value = false
    exportProgress.value = ''
  }
}

async function exportCSV() {
  const confirmed = await window.Utils.confirm({
    title: t('export.confirmCsvTitle'),
    message: t('export.confirmCsvMsg'),
    confirmText: t('export.confirmCsvOk'),
    danger: true,
  })
  if (!confirmed) return
  if (exporting.value) return
  exporting.value = true
  exportProgress.value = t('export.exportingCsv')
  try {
    // 含 entryType + 各类型专有字段；未使用的字段留空
    const headers = [
      'entryType', 'title',
      'username', 'password', 'url', 'port',
      'rootUsername', 'rootPassword',   // server
      'appId',                             // app
      'privateKey',                        // app
      'tags', 'notes',
    ]
    const rows = [headers.join(',')]

    entriesToExport.value.forEach(entry => {
      const type = entry.entryType || 'website'
      const root = entry.root || {}
      rows.push([
        type,
        `"${(entry.title || '').replace(/"/g, '""')}"`,
        `"${(entry.username || '').replace(/"/g, '""')}"`,
        `"${(entry.password || '').replace(/"/g, '""')}"`,
        `"${(entry.url || '').replace(/"/g, '""')}"`,
        (type === 'server' || type === 'database') && entry.port != null ? entry.port : '""',
        type === 'server' ? `"${(root.username || '').replace(/"/g, '""')}"` : '""',
        type === 'server' ? `"${(root.password || '').replace(/"/g, '""')}"` : '""',
        type === 'app' ? `"${(entry.appId || '').replace(/"/g, '""')}"` : '""',
        type === 'app' ? `"${(entry.privateKey || '').replace(/"/g, '""')}"` : '""',
        `"${(entry.tags || []).join(';').replace(/"/g, '""')}"`,
        `"${(entry.notes || '').replace(/"/g, '""')}"`,
      ].join(','))
    })

    const dateStr = window.Utils.formatDateFilename(new Date())
    const tagSuffix = exportTagFilter.value ? `-${exportTagFilter.value}` : ''
    window.Utils.downloadFile(
      `${t('export.filePrefix')}${tagSuffix}-${dateStr}.csv`,
      rows.join('\n'),
      'text/csv'
    )
    window.Utils.showToast(t('export.doneCsv', { n: entriesToExport.value.length }), 'warning')
    closeModal()
  } catch (e) {
    window.Utils.showToast(t('toast.exportFailed', { msg: e.message || e }), 'error')
  } finally {
    exporting.value = false
    exportProgress.value = ''
  }
}
</script>

<template>
  <ModalBase :max-width="'560px'" @close="closeModal()">
    <div class="modal-header">
      <h3>{{ t('export.title') }}</h3>
      <button class="btn-icon" @click="closeModal()">
        <span v-html="Icons.close(16)"></span>
      </button>
    </div>

    <div class="modal-body">
      <div v-if="exporting" class="spinner-wrap">
        <div class="spinner mx-auto mb-4"></div>
        <div>{{ exportProgress }}</div>
      </div>
      <div v-else class="export-options">
        <!-- P3-F3：按标签筛选导出范围 -->
        <div class="form-group" v-if="availableTags.length">
          <label class="form-label">{{ t('export.scope') }}</label>
          <select class="form-input" v-model="exportTagFilter">
            <option value="">{{ t('export.allEntries', { n: vaultState.entries.length }) }}</option>
            <option v-for="tag in availableTags" :key="tag" :value="tag">{{ tag }}</option>
          </select>
          <div class="text-muted text-sm mt-1" v-if="exportTagFilter">
            {{ t('export.tagScopeHint', { tag: exportTagFilter, n: entriesToExport.length }) }}
          </div>
        </div>
        <div class="export-option" role="button" @click="exportEncryptedVault()">
          <div class="export-option-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div class="export-option-text">
            <div class="export-option-title">{{ t('export.optEncrypted') }}</div>
            <div class="text-muted text-sm">{{ t('export.optEncryptedDesc') }}</div>
          </div>
        </div>
        <div class="export-option" role="button" @click="exportCSV()">
          <div class="export-option-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <div class="export-option-text">
            <div class="export-option-title">{{ t('export.optCsv') }}</div>
            <div class="text-muted text-sm">{{ t('export.optCsvDesc') }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" @click="closeModal()">{{ t('modal.close') }}</button>
    </div>
  </ModalBase>
</template>
