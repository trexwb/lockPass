<script setup>
/* LockPass — 主界面外壳（Header + Sidebar + Content + Detail） */
import { onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useVault, vaultState } from '../composables/useVault'
import HeaderBar from './layout/HeaderBar.vue'
import SidebarNav from './layout/SidebarNav.vue'
import DetailPanel from './entries/DetailPanel.vue'

// 模板中直接引用 window 会被 Vue 编译为 _ctx.window（undefined）而抛错，
// 故在 setup 作用域暴露 Utils，模板统一使用 Utils.xxx
const Utils = window.Utils

const {
  getFilteredEntries, emptyRecycleBin, restoreEntry, selectEntry,
  toggleFavorite, copyPassword, softDelete,
  setFilter, openEntryModal, computeSidebarStats,
} = useVault()

// 底部导航筛选入口（与 SidebarNav 一致的本地包装；useVault 导出名为 setFilter）
function selectFilter(f) {
  setFilter(f)
}

const filteredEntries = computed(() => getFilteredEntries())
const isRecycleView = computed(() => vaultState.currentFilter === 'recycle')
// 移动端底部导航徽标（回收站数量）
const sidebarStats = computed(() => computeSidebarStats())

/* ── 空状态（对应原版 ui.js renderEntries 的文案分支） ── */

const emptyTitle = computed(() => {
  if (vaultState.currentFilter === 'recycle') return '回收站为空'
  if (vaultState.searchQuery && vaultState.searchQuery.trim()) return '没有找到匹配项'
  if (vaultState.currentFilter === 'favorites') return '暂无收藏'
  return '还没有密码'
})

const emptyDesc = computed(() => {
  if (vaultState.currentFilter === 'recycle') return '删除的密码会暂时保存在这里，可恢复或彻底删除'
  const q = (vaultState.searchQuery || '').trim()
  if (q) return `没有找到包含「${q}」的密码`
  if (vaultState.currentFilter === 'favorites') return '点击密码卡片的星标收藏常用密码'
  return '点击上方「添加密码」开始构建您的密码库'
})

// 原版 ui.js：空列表时给 #content-inner 加 empty-active（margin:0 auto 居中）
watch(
  () => filteredEntries.value.length,
  (len) => {
    const inner = document.getElementById('content-inner')
    if (inner) inner.classList.toggle('empty-active', len === 0)
  },
  { immediate: true }
)

/* ── 卡片渲染辅助（对应原版 buildEntryCard / getCardTypeIcon / getCardSubtitle） ── */

function cardTypeIcon(type) {
  return window.Utils && window.Utils.SvgIcons
    ? window.Utils.SvgIcons.typeIcon(12, type || 'website')
    : ''
}

function cardSubtitle(entry) {
  const type = entry.entryType || 'website'
  if (type === 'website') return entry.username || entry.url || ''
  if (type === 'server') return entry.username ? `${entry.username} @ ${entry.url}` : (entry.url || '')
  if (type === 'database') return entry.username ? `${entry.username} @ ${entry.url}` : (entry.url || '')
  if (type === 'ai') return entry.url || ''
  if (type === 'app') return entry.appId || ''
  if (type === 'other') return entry.username || ''
  return entry.username || ''
}

function favIconHtml(entry) {
  return entry.favorite
    ? (window.Utils?.SvgIcons?.starFilled(13, 'var(--warning)') || '')
    : (window.Utils?.SvgIcons?.starOutline(13) || '')
}

function tagChipHtml(name) {
  return window.Utils ? window.Utils.renderTagChip(vaultState.tagDefs || {}, name, false) : ''
}

function formatCardDate(entry) {
  if (isRecycleView.value) return '已删除'
  return window.Utils ? window.Utils.formatDate(entry.updatedAt || entry.createdAt) : ''
}

function esc(value) {
  return window.Utils ? window.Utils.escHtml(value) : String(value ?? '')
}

function onCardClick(entry, e) {
  selectEntry(entry.id, e)
}

function onActionsClick(e) {
  e.stopPropagation()
}

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

onMounted(() => {
  // 主界面：启动工作区粒子背景（LockParticles.stop 语义 = 停止锁屏、启动工作区）
  if (window.LockParticles) window.LockParticles.stop()
})

onBeforeUnmount(() => {
  // 离开主界面（如锁定）：交还锁屏粒子（LockParticles.start 语义 = 启动锁屏、停止工作区）
  if (window.LockParticles) window.LockParticles.start()
})
</script>

<template>
  <div id="app-shell">
    <HeaderBar />

    <div id="main-layout">
      <div id="sidebar-overlay" :class="{ active: vaultState.sidebarOpen }" @click="vaultState.sidebarOpen = false"></div>

      <SidebarNav />

      <main id="content">
        <canvas id="workspace-bg" aria-hidden="true"></canvas>
        <div id="content-inner">
          <div class="content-toolbar">
            <div>
              <h2 id="content-title">{{ contentTitle() }}</h2>
            </div>
            <div class="toolbar-right">
              <span id="entry-count" class="text-muted text-sm">{{ filteredEntries.length }} 项</span>
              <button
                v-if="vaultState.currentFilter === 'recycle' && filteredEntries.length"
                id="empty-recycle-btn"
                class="btn btn-ghost btn-sm"
                title="清空回收站"
                @click="emptyRecycleBin()"
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
              :class="[
                !isRecycleView && entry.favorite ? 'fav' : '',
                isRecycleView ? 'recycled' : '',
                vaultState.selectedEntry === entry.id ? 'selected' : '',
              ]"
              @click="onCardClick(entry, $event)"
            >
              <div class="entry-icon">
                <span class="type-icon-badge" :class="'type-icon-' + (entry.entryType || 'website')" :title="esc(entry.entryType || 'website')" v-html="cardTypeIcon(entry.entryType)"></span>
              </div>
              <div class="entry-info">
                <div class="entry-title">{{ entry.title }}</div>
                <div class="entry-meta">
                  <span v-if="cardSubtitle(entry)" class="entry-subtitle">{{ cardSubtitle(entry) }}</span>
                  <span v-for="tag in (entry.tags || []).slice(0, 3)" :key="tag" v-html="tagChipHtml(tag)"></span>
                  <span v-if="(entry.tags || []).length > 3" class="entry-tag-more">+{{ entry.tags.length - 3 }}</span>
                  <span class="entry-date">{{ formatCardDate(entry) }}</span>
                </div>
              </div>
              <div class="entry-actions" @click="onActionsClick">
                <template v-if="isRecycleView">
                  <button class="restore-btn" title="恢复" @click="restoreEntry(entry.id)">
                    <span v-html="Utils?.SvgIcons?.restore(13)"></span>
                  </button>
                  <button class="copy-btn" title="复制密码" @click="copyPassword(entry.id, $event.currentTarget)">
                    <span v-html="Utils?.SvgIcons?.copy(13)"></span>
                  </button>
                </template>
                <template v-else>
                  <button class="star-btn" :class="{ active: entry.favorite }" title="收藏" @click="toggleFavorite(entry.id)">
                    <span v-html="favIconHtml(entry)"></span>
                  </button>
                  <button class="copy-btn" title="复制" @click="copyPassword(entry.id, $event.currentTarget)">
                    <span v-html="Utils?.SvgIcons?.copy(13)"></span>
                  </button>
                  <button class="delete-btn" title="删除" @click="softDelete(entry.id)">
                    <span v-html="Utils?.SvgIcons?.trash(13)"></span>
                  </button>
                </template>
              </div>
            </div>
          </div>

          <div v-if="!filteredEntries.length" id="empty-state" class="empty-state">
            <div class="empty-illustration">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3 id="empty-title">{{ emptyTitle }}</h3>
            <p id="empty-desc">{{ emptyDesc }}</p>
            <button v-if="vaultState.currentFilter !== 'recycle'" class="btn btn-primary btn-empty" @click="vaultState.activeModal = 'entry'">
              添加第一个密码
            </button>
            <div class="empty-features">
              <span>离线加密存储</span>
              <span>二维码同步</span>
              <span>本地文件备份</span>
            </div>
          </div>
        </div>
      </main>

      <DetailPanel />
    </div>

    <!-- 移动端底部导航（≤480px 显示；替代侧边栏主路径，标签入口打开抽屉） -->
    <nav id="mobile-tabbar" aria-label="底部导航">
      <button
        class="tabbar-item"
        :class="{ active: vaultState.currentFilter === 'all' }"
        @click="selectFilter('all')"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
        <span>全部</span>
      </button>
      <button
        class="tabbar-item"
        :class="{ active: vaultState.currentFilter === 'favorites' }"
        @click="selectFilter('favorites')"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
        <span>收藏</span>
      </button>
      <button class="tabbar-add" aria-label="添加密码" @click="openEntryModal()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <button
        class="tabbar-item"
        :class="{ active: vaultState.currentFilter === 'recycle' }"
        @click="selectFilter('recycle')"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
        <span>回收站<span v-if="sidebarStats.recycle > 0" class="tabbar-badge">{{ sidebarStats.recycle > 99 ? '99+' : sidebarStats.recycle }}</span></span>
      </button>
      <button class="tabbar-item" aria-label="标签筛选" @click="vaultState.sidebarOpen = true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
        <span>标签</span>
      </button>
    </nav>
  </div>
</template>
