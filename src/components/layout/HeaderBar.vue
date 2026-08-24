<script setup>
/* LockPass — 顶栏（Logo / 全局搜索 / 设置入口） */
import { ref } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'

const { openModal } = useVault()

const searchInput = ref(null)

// 搜索框内 Escape 失焦；⌘K 聚焦由全局快捷键 useShortcuts 统一处理
function onSearchKeydown(e) {
  if (e.key === 'Escape') {
    e.target.blur()
  }
}
</script>

<template>
  <header id="header">
    <button class="btn-icon hamburger-btn" id="hamburger-btn" aria-label="菜单" @click="vaultState.sidebarOpen = !vaultState.sidebarOpen">
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
        @keydown="onSearchKeydown"
      />
    </div>

    <div class="header-actions">
      <button class="btn btn-ghost btn-sm" title="设置" tabindex="-1" @click="openModal('settings')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>设置</span>
      </button>
    </div>
  </header>
</template>
