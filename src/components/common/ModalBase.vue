<script setup>
/* LockPass — 模态框基础容器（遮罩 + 焦点陷阱 + Esc 关闭） */
import { onMounted, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  maxWidth: { type: String, default: '480px' },
  closeOnEsc: { type: Boolean, default: true },
})

const emit = defineEmits(['close'])

const overlayRef = ref(null)
let prevFocus = null

function trapHandler(e) {
  if (!props.closeOnEsc && e.key === 'Escape') return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key !== 'Tab') return

  const modal = overlayRef.value
  const focusables = [...modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  if (!focusables.length) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault()
      last.focus()
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

onMounted(() => {
  prevFocus = document.activeElement
  document.addEventListener('keydown', trapHandler)
  const firstFocusable = overlayRef.value?.querySelector('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
  if (firstFocusable) firstFocusable.focus()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', trapHandler)
  if (prevFocus && prevFocus.focus) {
    try { prevFocus.focus() } catch (e) {}
  }
})
</script>

<template>
  <div ref="overlayRef" class="modal-overlay">
    <div class="modal" :style="{ maxWidth: props.maxWidth }">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.modal {
  background: var(--surface, #1c2128);
  border: 1px solid var(--border, #30363d);
  border-radius: var(--radius, 14px);
  width: 100%;
  max-width: 480px;
  max-height: min(82vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
</style>
