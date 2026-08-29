<script setup>
/* LockPass — 模态框基础容器（遮罩 + 焦点陷阱）
   P3-2：Escape 统一由 useShortcuts.handleKeyboard 分发（confirm → modal → detail → 搜索），
   此处只负责 Tab 焦点陷阱，避免双重监听导致的语义分叉 */
import { onMounted, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  maxWidth: { type: String, default: '480px' },
  ariaLabel: { type: String, default: '' },
})

const emit = defineEmits(['close'])

const overlayRef = ref(null)
const ariaLabelledBy = ref('')
let prevFocus = null

function trapHandler(e) {
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
  // aria-labelledby：优先使用传入的 ariaLabel；否则自动查找模态框内首个标题元素
  if (props.ariaLabel) {
    overlayRef.value?.setAttribute('aria-label', props.ariaLabel)
  } else {
    const heading = overlayRef.value?.querySelector('h2, h3')
    if (heading) {
      if (!heading.id) heading.id = 'modal-title-' + Math.random().toString(36).slice(2, 9)
      ariaLabelledBy.value = heading.id
    }
  }
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
  <div ref="overlayRef" id="modal-overlay" role="dialog" aria-modal="true" :aria-labelledby="ariaLabelledBy || undefined">
    <div id="modal" role="document">
      <slot />
    </div>
  </div>
</template>

