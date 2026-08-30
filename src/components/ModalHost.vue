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
import PasswordGeneratorModal from './modals/PasswordGeneratorModal.vue'

const { closeModal } = useVault()

// 已实现的模态框
const IMPLEMENTED = new Set([
  'settings', 'change-pw', 'tags', 'import', 'export', 'qr-import', 'qr-share',
])

// activeName 返回模态框 key（'entry' | 'settings' | ...），
// 模板分支按 key 匹配；IMPLEMENTED 仅用于判定该 modal 是否已实现。
const activeName = computed(() => {
  if (vaultState.activeModal === 'entry') return 'entry'
  if (vaultState.activeModal && IMPLEMENTED.has(vaultState.activeModal)) return vaultState.activeModal
  return ''
})
</script>

<template>
  <Transition name="modal-swap" mode="out-in">
    <EntryEditorModal v-if="activeName === 'entry'" key="entry" />
    <SettingsModal v-else-if="activeName === 'settings'" key="settings" />
    <ChangePwModal v-else-if="activeName === 'change-pw'" key="change-pw" />
    <TagsModal v-else-if="activeName === 'tags'" key="tags" />
    <ImportModal v-else-if="activeName === 'import'" key="import" />
    <ExportModal v-else-if="activeName === 'export'" key="export" />
    <QrShareModal v-else-if="activeName === 'qr-share'" key="qr-share" />
    <QrImportModal v-else-if="activeName === 'qr-import'" key="qr-import" />
  </Transition>
  <!-- 一键配对弹窗：独立于 activeModal，桌面版配对请求时弹出 -->
  <PairRequestModal />
  <!-- 密码生成器：独立于 activeModal，可叠加在 EntryEditorModal 之上 -->
  <PasswordGeneratorModal />
</template>