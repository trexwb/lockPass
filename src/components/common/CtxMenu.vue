<script setup>
/* LockPass — 通用右键菜单组件（Teleport + 视口钳制 + 动效）
   用法：
     <CtxMenu :menu="ctxMenu" :items="ctxItems" @action="onCtxAction" />
   其中 ctxItems 为 computed 或 reactive 数组：
     [{ key, label, iconHtml?, danger?, divider?, disabled? }, ...]
   支持单条子项带键盘可达（tabindex + 方向键切换），与 entries.css .ctx-menu 样式复用。 */
import { computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'

const props = defineProps({
  menu: { type: Object, required: true },
  items: { type: Array, default: () => [] },
  ariaLabel: { type: String, default: '快捷操作' },
})

const emit = defineEmits(['action'])

const Icons = window.Utils?.SvgIcons

const visibleItems = computed(() => (props.items || []).filter(i => i && !i.hidden))

function onClick(item, evt) {
  if (item.disabled) return
  if (item.divider) return
  if (typeof item.onClick === 'function') {
    // 组件级自定义处理（注意先关闭菜单）
    try { item.onClick() } catch (e) { console.error('[CtxMenu]', e) }
    return
  }
  emit('action', item.key, evt)
}

/* ── 键盘导航：打开后焦点到首项；↑↓ 切换；Enter/Space 选中 ── */

let itemsRoot = null
function setItemsRoot(el) { itemsRoot = el }

watch(() => props.menu.visible, (v) => {
  if (!v) return
  nextTick(() => {
    const first = itemsRoot?.querySelector?.('.ctx-item:not([disabled]):not(.ctx-divider)')
    if (first) first.focus()
  })
})

function onKeydown(e) {
  if (!visibleItems.value.length) return
  const items = Array.from(itemsRoot?.querySelectorAll?.('.ctx-item:not([disabled]):not(.ctx-divider)') || [])
  const idx = items.indexOf(document.activeElement)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = items[(idx + 1 + items.length) % items.length]
    next && next.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    const prev = items[(idx - 1 + items.length) % items.length]
    prev && prev.focus()
  } else if (e.key === 'Home') {
    e.preventDefault(); items[0]?.focus()
  } else if (e.key === 'End') {
    e.preventDefault(); items[items.length - 1]?.focus()
  }
}

// 全局 Esc 由 useCtxMenu 统一处理，组件内仅接收方向导航
onMounted(() => {
  // 无额外监听：root 级 keydown 直接处理
})
onBeforeUnmount(() => {})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="menu.visible"
      class="ctx-menu"
      :class="{ 'ctx-sm': visibleItems.length <= 4 }"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      role="menu"
      :aria-label="ariaLabel"
      :aria-orientation="'vertical'"
      ref="setItemsRoot"
      @keydown="onKeydown"
    >
      <template v-for="(item, i) in visibleItems" :key="item.key || ('div-' + i)">
        <div v-if="item.divider" class="ctx-divider" role="separator" aria-hidden="true"></div>
        <button
          v-else
          class="ctx-item"
          :class="{ 'ctx-danger': item.danger, 'ctx-accent': item.accent }"
          role="menuitem"
          :disabled="!!item.disabled"
          :title="item.title || item.label || ''"
          :aria-label="item.label || ''"
          tabindex="0"
          @click="onClick(item, $event)"
        >
          <span class="ctx-icon" v-if="item.iconHtml" v-html="item.iconHtml"></span>
          <span class="ctx-icon ctx-icon-placeholder" v-else aria-hidden="true"></span>
          <span class="ctx-label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="ctx-shortcut" aria-hidden="true">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
