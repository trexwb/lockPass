<script setup>
/* LockPass — 主界面外壳（Header + Sidebar + Content + Detail） */
import { onMounted, onBeforeUnmount, computed } from 'vue'
import { useVault, vaultState } from '../composables/useVault'
import HeaderBar from './layout/HeaderBar.vue'
import SidebarNav from './layout/SidebarNav.vue'
import DetailPanel from './entries/DetailPanel.vue'

const { getFilteredEntries } = useVault()

const filteredEntries = computed(() => getFilteredEntries())

function contentTitle() {
  if (vaultState.currentFilter === 'all') return '全部密码'
  if (vaultState.currentFilter === 'favorites') return '收藏'
  if (vaultState.currentFilter === 'recycle') return '回收站'
  if (vaultState.currentFilter.startsWith('type:')) {
    const t = vaultState.currentFilter.slice(5)
    const def = { website: '网站', server: '服务器', database: '数据库', ai: 'AI', app: '应用', other: '其他' }
    return def[t] || t
  }
  return `标签：${vaultState.currentFilter}`
}

function filterDesc() {
  if (vaultState.currentFilter === 'recycle') return '已删除的密码将在这里保留 30 天'
  return '点击左侧筛选或搜索查找密码'
}

onMounted(() => {
  if (window.LockParticles) window.LockParticles.start()
})

onBeforeUnmount(() => {
  if (window.LockParticles) window.LockParticles.stop()
})
</script>

<template>
  <div id="app-shell">
    <HeaderBar />

    <div id="main-layout">
      <div id="sidebar-overlay" @click="vaultState.sidebarOpen = false"></div>

      <SidebarNav />

      <main id="content">
        <canvas id="workspace-bg" aria-hidden="true"></canvas>
        <div id="content-inner">
          <div class="content-toolbar">
            <div>
              <h2 id="content-title">{{ contentTitle() }}</h2>
              <p class="text-muted text-sm" v-if="vaultState.currentFilter === 'recycle'">{{ filterDesc() }}</p>
            </div>
            <div class="toolbar-right">
              <span id="entry-count" class="text-muted text-sm">{{ filteredEntries.length }} 项</span>
              <button
                v-if="vaultState.currentFilter === 'recycle' && filteredEntries.length"
                id="empty-recycle-btn"
                class="btn btn-ghost btn-sm"
                title="清空回收站"
                @click="$emit('empty-recycle')"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                清空回收站
              </button>
            </div>
          </div>

          <div id="entries-list">
            <div
              v-for="entry in filteredEntries"
              :key="entry.id"
              class="entry-card"
              :class="{ active: vaultState.selectedEntry === entry.id }"
              @click="vaultState.selectedEntry = entry.id"
            >
              <div class="entry-card-icon">{{ entry.title?.slice(0, 1)?.toUpperCase() || '?' }}</div>
              <div class="entry-card-info">
                <div class="entry-card-title">{{ entry.title }}</div>
                <div class="entry-card-sub">{{ entry.username || entry.url || '' }}</div>
              </div>
              <div class="entry-card-meta">
                <span v-for="tag in (entry.tags || []).slice(0, 3)" :key="tag" class="entry-card-tag">{{ tag }}</span>
              </div>
            </div>

            <div v-if="!filteredEntries.length" class="empty-state">
              <div class="empty-illustration">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h3 id="empty-title">{{ vaultState.currentFilter === 'recycle' ? '回收站是空的' : '还没有密码' }}</h3>
              <p id="empty-desc">
                {{ vaultState.currentFilter === 'recycle' ? '删除的密码会出现在这里' : '点击上方「添加密码」开始构建您的密码库' }}
              </p>
              <button v-if="vaultState.currentFilter !== 'recycle'" class="btn btn-primary btn-empty" @click="vaultState.activeModal = 'entry'">
                添加第一个密码
              </button>
              <div v-if="vaultState.currentFilter !== 'recycle'" class="empty-features">
                <span>离线加密存储</span>
                <span>二维码同步</span>
                <span>本地文件备份</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <DetailPanel />
    </div>
  </div>
</template>
