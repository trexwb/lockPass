<script setup>
/* LockPass — 主界面外壳（Header + Sidebar + Content + Detail） */
import { onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useVault, vaultState } from '../composables/useVault'
import HeaderBar from './layout/HeaderBar.vue'
import SidebarNav from './layout/SidebarNav.vue'
import DetailPanel from './entries/DetailPanel.vue'

const {
  getFilteredEntries, emptyRecycleBin, restoreEntry, selectEntry,
  toggleFavorite, copyPassword, softDelete,
} = useVault()

const filteredEntries = computed(() => getFilteredEntries())
const isRecycleView = computed(() => vaultState.currentFilter === 'recycle')

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

function filterDesc() {
  if (vaultState.currentFilter === 'recycle') return '已删除的密码将在这里保留 30 天'
  return '点击左侧筛选或搜索查找密码'
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
                    <span v-html="window.Utils?.SvgIcons?.restore(13)"></span>
                  </button>
                  <button class="copy-btn" title="复制密码" @click="copyPassword(entry.id)">
                    <span v-html="window.Utils?.SvgIcons?.copy(13)"></span>
                  </button>
                </template>
                <template v-else>
                  <button class="star-btn" :class="{ active: entry.favorite }" title="收藏" @click="toggleFavorite(entry.id)">
                    <span v-html="favIconHtml(entry)"></span>
                  </button>
                  <button class="copy-btn" title="复制" @click="copyPassword(entry.id)">
                    <span v-html="window.Utils?.SvgIcons?.copy(13)"></span>
                  </button>
                  <button class="delete-btn" title="删除" @click="softDelete(entry.id)">
                    <span v-html="window.Utils?.SvgIcons?.trash(13)"></span>
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
  </div>
</template>
