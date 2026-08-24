<script setup>
/* LockPass — 模态框宿主：按 activeModal 分发渲染 */
import { computed } from 'vue'
import { useVault, vaultState } from '../composables/useVault'
import EntryEditorModal from './modals/EntryEditorModal.vue'
import SettingsModal from './modals/SettingsModal.vue'
import ChangePwModal from './modals/ChangePwModal.vue'
import TagsModal from './modals/TagsModal.vue'
import ImportModal from './modals/ImportModal.vue'
import ExportModal from './modals/ExportModal.vue'
import QrShareModal from './modals/QrShareModal.vue'
import QrImportModal from './modals/QrImportModal.vue'

const { closeModal } = useVault()

// 已实现的模态框
const IMPLEMENTED = {
  settings: '设置',
  'change-pw': '修改主密码',
  tags: '标签管理',
  import: '批量导入',
  export: '导出',
  'qr-import': '二维码添加',
  'qr-share': '二维码分享',
}

const activeName = computed(() => {
  if (vaultState.activeModal === 'entry') return 'entry'
  return IMPLEMENTED[vaultState.activeModal] || ''
})
</script>

<template>
  <EntryEditorModal v-if="activeName === 'entry'" />
  <SettingsModal v-else-if="activeName === 'settings'" />
  <ChangePwModal v-else-if="activeName === 'change-pw'" />
  <TagsModal v-else-if="activeName === 'tags'" />
  <ImportModal v-else-if="activeName === 'import'" />
  <ExportModal v-else-if="activeName === 'export'" />
  <QrShareModal v-else-if="activeName === 'qr-share'" />
  <QrImportModal v-else-if="activeName === 'qr-import'" />
</template>