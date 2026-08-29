<script setup>
/* LockPass — 顶栏（Logo / 全局搜索 / 设置入口）
   UX 深化：
   - 顶栏空白 / Logo 区右键 → 应用级快捷菜单（设置/修改主密码/标签管理/锁定）
   - 设置按钮右键 → 设置快速菜单（主题模式 + 强调色原地切换，带 ✓ 当前态标记）
   - 搜索输入框保留原生右键菜单（粘贴/复制），不被顶栏守卫拦截 */
import { computed, reactive, ref } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import { useTheme } from '../../composables/useTheme'
import CtxMenu from '../common/CtxMenu.vue'

const { openModal, lockVault } = useVault()
const { themeMode, accentName, ACCENTS, setMode, setAccent } = useTheme()

const searchInput = ref(null)

// 搜索框内 Escape 失焦并清空；⌘K 聚焦由全局快捷键 useShortcuts 统一处理
function onSearchKeydown(e) {
  if (e.key === 'Escape') {
    if (vaultState.searchQuery) {
      vaultState.searchQuery = ''
      e.preventDefault()
    } else {
      e.target.blur()
    }
  }
}

function clearSearch() {
  vaultState.searchQuery = ''
  searchInput.value?.focus()
}

/* ── 顶栏右键菜单 ── */

const ACCENT_LABELS = { blue: '蓝色', green: '绿色', purple: '紫色', orange: '橙色', red: '红色', cyan: '青色' }
const THEME_LABELS = { dark: '暗色', light: '亮色', system: '跟随系统' }

const headerCtxMenu = reactive({ visible: false, x: 0, y: 0, payload: null })
const headerCtxOrigin = ref('bl')

function openHeaderMenu(e, kind) {
  const MENU_W = 230
  const MENU_H = kind === 'app' ? 200 : 400
  const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8)
  const y = Math.min(e.clientY, window.innerHeight - MENU_H - 8)
  const leftHalf = e.clientX <= window.innerWidth / 2
  const topHalf = e.clientY <= window.innerHeight / 2
  headerCtxOrigin.value = (topHalf ? 't' : 'b') + (leftHalf ? 'l' : 'r')
  headerCtxMenu.x = Math.max(8, x)
  headerCtxMenu.y = Math.max(8, y)
  headerCtxMenu.payload = { kind }
  headerCtxMenu.visible = true
}

/** 顶栏空白 / Logo 区右键 → 应用级菜单；输入框与设置按钮放行（各自独立处理） */
function onHeaderContextMenu(e) {
  if (e.target.closest('input, textarea')) return
  if (e.target.closest('.header-actions')) return
  openHeaderMenu(e, 'app')
}

/** 设置按钮右键 → 设置快速菜单（主题 / 强调色原地切换） */
function onSettingsCtx(e) {
  e.preventDefault()
  e.stopPropagation()
  openHeaderMenu(e, 'settings')
}

function closeHeaderCtx() {
  headerCtxMenu.visible = false
  headerCtxMenu.payload = null
}

const headerCtxItems = computed(() => {
  if (!headerCtxMenu.visible || !headerCtxMenu.payload) return []
  const kind = headerCtxMenu.payload.kind
  const list = []

  if (kind === 'app') {
    list.push({ key: 'settings', label: '设置', iconHtml: window.Utils?.SvgIcons?.settings?.(14) })
    list.push({ key: 'change-pw', label: '修改主密码', iconHtml: window.Utils?.SvgIcons?.key?.(14) })
    list.push({ key: 'tags', label: '标签管理', iconHtml: window.Utils?.SvgIcons?.tag?.(14) })
    list.push({ divider: true })
    list.push({ key: 'lock', label: '立即锁定', iconHtml: window.Utils?.SvgIcons?.lock?.(14) })
    return list
  }

  // 设置快速菜单：入口 + 主题模式 + 强调色
  list.push({ key: 'settings', label: '打开设置', iconHtml: window.Utils?.SvgIcons?.settings?.(14), accent: true })
  list.push({ key: 'change-pw', label: '修改主密码', iconHtml: window.Utils?.SvgIcons?.key?.(14) })
  list.push({ key: 'tags', label: '标签管理', iconHtml: window.Utils?.SvgIcons?.tag?.(14) })
  list.push({ divider: true })
  list.push({ key: 'th-title', label: '主题模式', disabled: true })
  for (const m of ['dark', 'light', 'system']) {
    list.push({ key: 'theme:' + m, label: THEME_LABELS[m] + (themeMode.value === m ? '  ✓' : '') })
  }
  list.push({ divider: true })
  list.push({ key: 'ac-title', label: '强调色', disabled: true })
  for (const a of ACCENTS) {
    list.push({ key: 'accent:' + a, label: ACCENT_LABELS[a] + (accentName.value === a ? '  ✓' : '') })
  }
  list.push({ divider: true })
  list.push({ key: 'lock', label: '立即锁定', iconHtml: window.Utils?.SvgIcons?.lock?.(14) })
  return list
})

function onHeaderCtxAction(action) {
  closeHeaderCtx()
  if (action === 'settings') openModal('settings')
  else if (action === 'change-pw') openModal('change-pw')
  else if (action === 'tags') openModal('tags')
  else if (action === 'lock') lockVault()
  else if (action.startsWith('theme:')) setMode(action.slice(6))
  else if (action.startsWith('accent:')) setAccent(action.slice(7))
}
</script>

<template>
  <header id="header" @contextmenu="onHeaderContextMenu">
    <button class="btn-icon hamburger-btn" id="hamburger-btn" aria-label="菜单" :aria-expanded="vaultState.sidebarOpen ? 'true' : 'false'" @click="vaultState.sidebarOpen = !vaultState.sidebarOpen">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
    <div class="logo">
      <svg width="24" height="24" viewBox="0 0 100 100">
        <rect width="100" height="100" rx="20" fill="var(--accent)" opacity="0.15" />
        <rect x="25" y="45" width="50" height="35" rx="6" fill="none" stroke="var(--accent)" stroke-width="4" />
        <path d="M35 45V32a15 15 0 0 1 30 0v13" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" />
        <circle cx="50" cy="62" r="5" fill="var(--accent)" />
      </svg>
      密码保险箱
    </div>

    <div class="header-search">
      <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref="searchInput"
        id="global-search"
        v-model="vaultState.searchQuery"
        type="text"
        placeholder="搜索密码 (⌘ + K)"
        aria-label="搜索密码"
        @keydown="onSearchKeydown"
      />
      <button
        v-if="vaultState.searchQuery"
        class="search-clear-btn"
        type="button"
        aria-label="清除搜索"
        @click="clearSearch"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="header-actions">
      <button
        class="btn btn-ghost btn-sm"
        title="设置（右键快速切换主题）"
        aria-label="打开设置"
        @click="openModal('settings')"
        @contextmenu="onSettingsCtx"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>设置</span>
      </button>
    </div>

    <!-- 顶栏右键快捷菜单：应用级（空白/Logo）或 设置快速菜单（设置按钮） -->
    <CtxMenu
      :menu="headerCtxMenu"
      :items="headerCtxItems"
      aria-label="顶栏快捷操作"
      :origin="headerCtxOrigin"
      @action="onHeaderCtxAction"
    />
  </header>
</template>
