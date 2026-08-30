<script setup>
/* ═══════════════════════════════════════════════════════════════════
   LockPass — BaseSelect（自定义下拉选择器）
   ───────────────────────────────────────────────────────────────────
   替代原生 <select>，解决 WebView/桌面端原生 option popup 与触发框
   错位的问题。下拉列表为 DOM 元素，宽度与触发器严格对齐，支持
   点击外部关闭、键盘导航、向下/向上自适应展开。
   用法：
     <BaseSelect
       v-model.number="value"
       :options="[{ value, label }, ...]"
       class="form-input w-120"
       @change="onChange"
     />
   ═══════════════════════════════════════════════════════════════════ */
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: [String, Number, Boolean], default: '' },
  modelModifiers: { type: Object, default: () => ({}) },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const rootRef = ref(null)
const triggerRef = ref(null)
const menuRef = ref(null)
const open = ref(false)
const activeIndex = ref(-1)
const upward = ref(false)
const listboxId = 'base-select-lb-' + Math.random().toString(36).slice(2, 9)

const allOptions = computed(() => {
  const list = props.options || []
  if (!props.placeholder) return list
  return [{ value: '', label: props.placeholder, disabled: true }, ...list]
})

const selectedIndex = computed(() => {
  return allOptions.value.findIndex(o => o.value === props.modelValue)
})

const selectedLabel = computed(() => {
  const found = allOptions.value.find(o => o.value === props.modelValue)
  return found ? found.label : ''
})

function resolveValue(raw) {
  if (props.modelModifiers.number) {
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  return raw
}

function select(raw) {
  const value = resolveValue(raw)
  open.value = false
  if (value !== props.modelValue) {
    emit('update:modelValue', value)
    emit('change', value)
  }
  nextTick(() => triggerRef.value?.focus({ preventScroll: true }))
}

function toggle() {
  if (props.disabled) return
  open.value ? close() : doOpen()
}

function doOpen() {
  open.value = true
  activeIndex.value = Math.max(selectedIndex.value, 0)
  nextTick(() => {
    adjustPlacement()
    scrollActiveIntoView()
    triggerRef.value?.focus({ preventScroll: true })
  })
}

function close() {
  open.value = false
}

function adjustPlacement() {
  const menu = menuRef.value
  if (!menu) return
  const rect = menu.getBoundingClientRect()
  const gap = 6
  const spaceBelow = window.innerHeight - rect.top - gap
  upward.value = rect.height > spaceBelow && rect.top > rect.height + gap
}

function scrollActiveIntoView() {
  nextTick(() => {
    const el = menuRef.value?.querySelector('.base-select-option.active')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onTriggerKeydown(e) {
  if (props.disabled) return
  const items = allOptions.value
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (open.value && activeIndex.value >= 0 && !items[activeIndex.value]?.disabled) {
      select(items[activeIndex.value].value)
    } else {
      toggle()
    }
    return
  }
  if (e.key === 'Escape') {
    if (open.value) { e.preventDefault(); close() }
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!open.value) { doOpen(); return }
    let i = activeIndex.value + 1
    while (i < items.length && items[i]?.disabled) i += 1
    if (i < items.length) activeIndex.value = i
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) { doOpen(); return }
    let i = activeIndex.value - 1
    while (i >= 0 && items[i]?.disabled) i -= 1
    if (i >= 0) activeIndex.value = i
    return
  }
  if (e.key === 'Home') {
    e.preventDefault()
    if (!open.value) doOpen()
    activeIndex.value = items.findIndex(o => !o.disabled)
    return
  }
  if (e.key === 'End') {
    e.preventDefault()
    if (!open.value) doOpen()
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (!items[i]?.disabled) { activeIndex.value = i; break }
    }
    return
  }
  if (e.key === 'Tab' && open.value) {
    close()
  }
}

function onOptionKeydown(e, opt, idx) {
  if (opt.disabled) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    select(opt.value)
  }
}

function onWindowClick(e) {
  if (!rootRef.value || rootRef.value.contains(e.target)) return
  close()
}

watch(open, (v) => {
  if (v) {
    window.addEventListener('click', onWindowClick, { capture: true })
  } else {
    window.removeEventListener('click', onWindowClick, { capture: true })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick, { capture: true })
})
</script>

<template>
  <div
    ref="rootRef"
    class="base-select"
    :class="{ open: open, upward: upward }"
  >
    <button
      type="button"
      ref="triggerRef"
      class="base-select-trigger"
      v-bind="$attrs"
      :disabled="disabled"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-haspopup="'listbox'"
      :aria-controls="listboxId"
      :aria-activedescendant="open && activeIndex >= 0 ? listboxId + '-opt-' + activeIndex : undefined"
      :aria-label="ariaLabel"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="base-select-label">{{ selectedLabel || placeholder || '\u00A0' }}</span>
      <span class="base-select-chevron" :class="{ open: open }">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
    </button>

    <div
      v-if="open"
      :id="listboxId"
      ref="menuRef"
      class="base-select-menu"
      role="listbox"
      :aria-label="ariaLabel"
      @keydown="onTriggerKeydown"
    >
      <button
        v-for="(opt, idx) in allOptions"
        :key="opt.value + '-' + idx"
        type="button"
        class="base-select-option"
        :class="{
          selected: opt.value === modelValue,
          active: idx === activeIndex,
          disabled: opt.disabled,
        }"
        :id="listboxId + '-opt-' + idx"
        role="option"
        :aria-selected="opt.value === modelValue ? 'true' : 'false'"
        :disabled="opt.disabled"
        tabindex="-1"
        @click.stop="!opt.disabled && select(opt.value)"
        @keydown="onOptionKeydown($event, opt, idx)"
        @mouseenter="activeIndex = idx"
      >
        <span class="base-select-option-label">{{ opt.label }}</span>
        <span v-if="opt.value === modelValue" class="base-select-check" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      </button>
    </div>
  </div>
</template>
