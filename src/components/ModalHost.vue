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
import PairRequestModal from './modals/PairRequestModal.vue'

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

// activeName 返回模态框 key（'entry' | 'settings' | ...），
// 模板分支按 key 匹配；IMPLEMENTED 仅用于判定该 modal 是否已实现。
const activeName = computed(() => {
  if (vaultState.activeModal === 'entry') return 'entry'
  if (vaultState.activeModal && IMPLEMENTED[vaultState.activeModal]) return vaultState.activeModal
  return ''
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
  <!-- 一键配对弹窗：独立于 activeModal，桌面版配对请求时弹出 -->
  <PairRequestModal />
</template>