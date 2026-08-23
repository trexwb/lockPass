<script setup>
/* LockPass — 模态框宿主：按 activeModal 分发渲染 */
import { computed } from 'vue'
import { useVault, vaultState } from '../composables/useVault'
import ModalBase from './common/ModalBase.vue'
import EntryEditorModal from './modals/EntryEditorModal.vue'

const { closeModal } = useVault()

const PENDING_MODAL_NAMES = {
  settings: '设置',
  import: '批量导入',
  export: '导出',
  'qr-import': '二维码添加',
  'qr-share': '二维码分享',
  'change-pw': '修改主密码',
  tags: '标签管理',
}

const activeName = computed(() => {
  if (vaultState.activeModal === 'entry') return 'entry'
  return PENDING_MODAL_NAMES[vaultState.activeModal] || ''
})
</script>

<template>
  <EntryEditorModal v-if="activeName === 'entry'" />

  <ModalBase v-else-if="activeName" :max-width="'420px'" @close="closeModal()">
    <div class="modal-header">
      <h3>{{ activeName }}</h3>
      <button class="btn-icon" @click="closeModal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
    <div class="modal-body">
      <p class="text-muted">「{{ activeName }}」功能将在后续迁移轮次中提供，本轮暂未开放。</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" @click="closeModal()">知道了</button>
    </div>
  </ModalBase>
</template>
