<script setup>
/* ═══════════════════════════════════════════════════════════════════
   LockPass — BaseSelect（自定义下拉选择器）
   ───────────────────────────────────────────────────────────────────
   替代原生 <select>，解决 WebView/桌面端原生 option popup 与触发框
   错位的问题。下拉列表为 DOM 元素，宽度与触发器严格对齐，支持
   点击外部关闭、键盘导航、向下/向上自适应展开。

   渲染：菜单 Teleport 到 <body> 并以 fixed 定位（与 CtxMenu 同款
   策略）——脱离弹窗、滚动容器等祖先的 overflow / transform 影响，
   杜绝下拉被容器裁剪、错位，以及 WebView 合成层绘制异常导致的
   “下拉框与其他动效重叠/拉伸覆盖下方内容”问题。
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

/* 菜单定位（fixed 于 body，相对视口坐标） */
const menuPos = ref({ left: 0, top: 0, minWidth: '120px' })
const MENU_GAP = 6

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
    layoutMenu()
    scrollActiveIntoView()
    triggerRef.value?.focus({ preventScroll: true })
  })
}

function close() {
  open.value = false
}

/**
 * 计算并应用菜单位置（fixed 于视口）：
 * 先临时隐藏测量实际尺寸，决定向下/向上展开，
 * 再按可用空间钳制高度，并按视口边界钳制横向位置。
 */
function layoutMenu() {
  const trigger = triggerRef.value
  const menu = menuRef.value
  if (!trigger || !menu || !open.value) return
  const tr = trigger.getBoundingClientRect()

  // 隐藏测量，避免受入场动画/上次定位影响；先把菜单位置摆到 (0,0)
  // 便于无干扰测量尺寸。注意：定位一律直接写 DOM style（命令式），
  // 不要用两段式 menuPos 响应式赋值——Vue 对 style 绑定的 patch 会
  // 在连续赋值合并后丢掉 left/top 更新（实测残留初始 0,0，全跑到左上角）。
  menu.style.visibility = 'hidden'
  menu.style.maxHeight = ''
  menu.style.left = '0px'
  menu.style.top = '0px'
  menu.style.minWidth = tr.width + 'px'

  let mr = menu.getBoundingClientRect()
  const spaceBelow = window.innerHeight - tr.bottom - MENU_GAP
  const spaceAbove = tr.top - MENU_GAP
  const openUp = mr.height > spaceBelow && spaceAbove > mr.height
  upward.value = openUp

  // 高度钳制：菜单不超出对应方向可用空间
  const maxH = Math.max(120, (openUp ? spaceAbove : spaceBelow) - 2)
  if (mr.height > maxH) {
    menu.style.maxHeight = maxH + 'px'
    mr = menu.getBoundingClientRect()
  }

  // 横向视口钳制：至少保留 8px 边距
  const maxLeft = Math.max(8, window.innerWidth - mr.width - 8)
  const left = Math.min(Math.max(tr.left, 8), maxLeft)
  const top = openUp ? (tr.top - mr.height - MENU_GAP) : (tr.bottom + MENU_GAP)

  // 命令式落位（同步、确定生效），再同步响应式兜底供重挂载使用
  menu.style.left = left + 'px'
  menu.style.top = top + 'px'
  menuPos.value = { left, top, minWidth: tr.width + 'px' }
  menu.style.visibility = ''
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
  // 菜单已 Teleport 到 body，需同时命中 root 与菜单本体
  const inside = rootRef.value?.contains(e.target) || menuRef.value?.contains(e.target)
  if (!inside) close()
}

/* 滚动/尺寸变化时重定位菜单（rAF 节流） */
let posPending = false
function requestLayout() {
  if (posPending) return
  posPending = true
  requestAnimationFrame(() => {
    posPending = false
    if (open.value) layoutMenu()
  })
}

watch(open, (v) => {
  if (v) {
    window.addEventListener('click', onWindowClick, { capture: true })
    window.addEventListener('scroll', requestLayout, { capture: true, passive: true })
    window.addEventListener('resize', requestLayout)
  } else {
    window.removeEventListener('click', onWindowClick, { capture: true })
    window.removeEventListener('scroll', requestLayout, { capture: true })
    window.removeEventListener('resize', requestLayout)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick, { capture: true })
  window.removeEventListener('scroll', requestLayout, { capture: true })
  window.removeEventListener('resize', requestLayout)
})
</script>

<template>
  <div
    ref="rootRef"
    class="base-select"
    :class="{ open: open }"
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

    <Teleport to="body">
      <div
        v-if="open"
        :id="listboxId"
        ref="menuRef"
        class="base-select-menu"
        :class="{ upward: upward }"
        :style="menuPos"
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
    </Teleport>
  </div>
</template>
