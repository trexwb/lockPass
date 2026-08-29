<script setup>
/* LockPass — 主界面外壳（Header + Sidebar + Content + Detail） */
import { onMounted, onBeforeUnmount, computed, reactive, ref, watch, nextTick } from 'vue'
import { useVault, vaultState } from '../composables/useVault'
import HeaderBar from './layout/HeaderBar.vue'
import SidebarNav from './layout/SidebarNav.vue'
import DetailPanel from './entries/DetailPanel.vue'

// 模板中直接引用 window 会被 Vue 编译为 _ctx.window（undefined）而抛错，
// 故在 setup 作用域暴露 Utils，模板统一使用 Utils.xxx
const Utils = window.Utils

const {
  getFilteredEntries, emptyRecycleBin, restoreEntry, selectEntry,
  toggleFavorite, copyPassword, softDelete, permanentDelete,
  setFilter, openEntryModal, computeSidebarStats,
} = useVault()

// 类型中文名（P3-8 修复：卡片/详情中的类型 title 不再显示英文 id）
const TYPE_LABELS = { website: '网站', server: '服务器', database: '数据库', ai: 'AI', app: '应用', other: '其他' }

function typeLabelOf(type) {
  return TYPE_LABELS[type || 'website'] || type || ''
}

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
// 复审修复：改为模板 :class 绑定（原为 watch + getElementById 手动切 class 的反模式）

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

/**
 * 键盘可达（P2-4 修复）：条目卡片 div 的 Enter/Space 等效点击打开详情
 * Shift+F10 / ContextMenu 键等效右键打开快捷菜单（P1-O6）
 */
function onCardKeydown(entry, e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    selectEntry(entry.id, e)
  } else if (e.key === 'F10' && e.shiftKey) {
    e.preventDefault()
    // 从卡片元素位置计算菜单坐标
    const rect = e.currentTarget.getBoundingClientRect()
    onCardContextMenu(entry, {
      preventDefault() {},
      stopPropagation() {},
      clientX: rect.right - 20,
      clientY: rect.bottom,
    })
  } else if (e.key === 'ContextMenu') {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    onCardContextMenu(entry, {
      preventDefault() {},
      stopPropagation() {},
      clientX: rect.right - 20,
      clientY: rect.bottom,
    })
  }
}

function onActionsClick(e) {
  e.stopPropagation()
}

/* ── 右键快捷菜单（P2-2 修复：兑现 spec §3.8 承诺） ── */

const ctxMenu = reactive({ visible: false, x: 0, y: 0, entry: null })

/** 右键打开快捷菜单；位置做视口边缘钳制，避免菜单溢出屏幕 */
function onCardContextMenu(entry, e) {
  e.preventDefault()
  e.stopPropagation()
  const MENU_W = 180
  const MENU_H = 200
  ctxMenu.x = Math.min(e.clientX, window.innerWidth - MENU_W - 8)
  ctxMenu.y = Math.min(e.clientY, window.innerHeight - MENU_H - 8)
  ctxMenu.entry = entry
  ctxMenu.visible = true
}

/** 关闭右键菜单 */
function closeCtxMenu() {
  ctxMenu.visible = false
  ctxMenu.entry = null
}

/* ── 触屏长按呼出（iOS Safari 不派发 contextmenu，长按 500ms 等效右键） ── */

let longPressTimer = null
const LONG_PRESS_MS = 500

function onCardTouchStart(entry, e) {
  if (!e.touches || e.touches.length !== 1) return
  const touch = e.touches[0]
  const clientX = touch.clientX
  const clientY = touch.clientY
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    // 合成右键事件对象：仅需要 preventDefault/stopPropagation/clientX/clientY
    onCardContextMenu(entry, {
      preventDefault() {},
      stopPropagation() {},
      clientX,
      clientY,
    })
  }, LONG_PRESS_MS)
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

/** 菜单项动作统一分发（关闭后执行，避免菜单残留） */
function onCtxAction(action) {
  const entry = ctxMenu.entry
  closeCtxMenu()
  if (!entry) return
  if (action === 'edit') openEntryModal(entry.id)
  else if (action === 'copy') copyPassword(entry.id)
  else if (action === 'fav') toggleFavorite(entry.id)
  else if (action === 'delete') softDelete(entry.id)
  else if (action === 'restore') restoreEntry(entry.id)
  else if (action === 'purge') permanentDelete(entry.id)
}

function onDocMouseDown(e) {
  if (ctxMenu.visible && !e.target.closest('.ctx-menu')) closeCtxMenu()
}

function onDocScrollOrResize() {
  if (ctxMenu.visible) closeCtxMenu()
}

function onDocResize() {
  onDocScrollOrResize()
  // P3-5：视口尺寸变化时同步窗口计算依据并重新校准行高（卡片换行高度会变）
  if (contentEl.value) viewportH.value = contentEl.value.clientHeight || viewportH.value
  measureRowHeight()
}

/* P3-1 修复：contentTitle 改 computed，避免每次重渲染重复执行 */
const contentTitle = computed(() => {
  if (vaultState.currentFilter === 'all') return '全部密码'
  if (vaultState.currentFilter === 'favorites') return '收藏'
  if (vaultState.currentFilter === 'recycle') return '回收站'
  if (vaultState.currentFilter.startsWith('type:')) {
    return typeLabelOf(vaultState.currentFilter.slice(5))
  }
  return `标签：${vaultState.currentFilter}`
})

/* ── P3-5：条目列表虚拟滚动（窗口化 + spacer，零依赖实现） ──
   条目数 ≤ VIRTUAL_THRESHOLD 时全量渲染（小列表体验与原来完全一致）；
   超过阈值后按 #content 滚动位置只渲染可视窗口 ± BUFFER_ROWS 行，
   窗口外用上下 spacer 撑起高度。行高取首卡实测值 + 8px 下边距。 */

const VIRTUAL_THRESHOLD = 100 // 超过该条数才启用虚拟滚动
const BUFFER_ROWS = 6         // 可视区上下各多渲染的缓冲行数
const DEFAULT_ROW_H = 76     // 行高兜底估值（14+38+8 边距等）

const contentEl = ref(null)
const scrollTop = ref(0)
const viewportH = ref(600)
const measuredRowH = ref(DEFAULT_ROW_H)

const virtualActive = computed(() => filteredEntries.value.length > VIRTUAL_THRESHOLD)

const visibleRange = computed(() => {
  const total = filteredEntries.value.length
  if (!virtualActive.value) return { start: 0, end: total }
  const rowH = measuredRowH.value
  // 起始行按滚动位置推算并做双向钳制（scrollTop 可能大于新列表总高）
  let start = Math.floor(scrollTop.value / rowH) - BUFFER_ROWS
  start = Math.max(0, Math.min(start, Math.max(0, total - 1)))
  const count = Math.ceil(viewportH.value / rowH) + BUFFER_ROWS * 2
  const end = Math.min(total, start + count)
  return { start, end }
})

const visibleEntries = computed(() => filteredEntries.value.slice(visibleRange.value.start, visibleRange.value.end))
const padTop = computed(() => (virtualActive.value ? visibleRange.value.start * measuredRowH.value : 0))
const padBottom = computed(() =>
  virtualActive.value ? (filteredEntries.value.length - visibleRange.value.end) * measuredRowH.value : 0,
)

/** 滚动同步：记录滚动位置与视口高度（驱动窗口计算） */
function onContentScroll(e) {
  scrollTop.value = e.target.scrollTop
  viewportH.value = e.target.clientHeight
}

/** 实测行高：取窗口内首卡 offsetHeight + 8px 卡片下边距 */
async function measureRowHeight() {
  if (!virtualActive.value || !contentEl.value) return
  await nextTick()
  const card = contentEl.value.querySelector('.entry-card')
  if (card && card.offsetHeight > 0) measuredRowH.value = card.offsetHeight + 8
}

// 筛选/搜索切换：列表内容整体更换，回到顶部并重新校准行高
watch(
  () => [vaultState.currentFilter, vaultState.searchQuery],
  () => {
    scrollTop.value = 0
    if (contentEl.value) contentEl.value.scrollTop = 0
    measureRowHeight()
  },
)

onMounted(() => {
  // 主界面：启动工作区粒子背景（LockParticles.stop 语义 = 停止锁屏、启动工作区）
  if (window.LockParticles) window.LockParticles.stop()
  // 右键菜单关闭监听：点击他处 / 滚动 / 缩放视口
  document.addEventListener('mousedown', onDocMouseDown)
  window.addEventListener('scroll', onDocScrollOrResize, true)
  window.addEventListener('resize', onDocResize)
  // P3-5：初始化视口高度与行高（虚拟滚动窗口计算依据）
  if (contentEl.value) viewportH.value = contentEl.value.clientHeight || 600
  measureRowHeight()
})

onBeforeUnmount(() => {
  // 离开主界面（如锁定）：交还锁屏粒子（LockParticles.start 语义 = 启动锁屏、停止工作区）
  if (window.LockParticles) window.LockParticles.start()
  cancelLongPress()
  document.removeEventListener('mousedown', onDocMouseDown)
  window.removeEventListener('scroll', onDocScrollOrResize, true)
  window.removeEventListener('resize', onDocResize)
})
</script>

<template>
  <div id="app-shell">
    <HeaderBar />

    <div id="main-layout">
      <div id="sidebar-overlay" :class="{ active: vaultState.sidebarOpen }" @click="vaultState.sidebarOpen = false"></div>

      <SidebarNav />

      <main id="content" ref="contentEl" @scroll.passive="onContentScroll">
        <canvas id="workspace-bg" aria-hidden="true"></canvas>
        <div id="content-inner" :class="{ 'empty-active': !filteredEntries.length }">
          <div class="content-toolbar">
            <div>
              <h2 id="content-title">{{ contentTitle }}</h2>
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
                <span v-html="Utils?.SvgIcons?.trash(13)"></span>
                清空回收站
              </button>
            </div>
          </div>

          <div id="entries-list">
            <!-- P3-5 虚拟滚动：窗口外用 spacer 撑高（≤100 条时不启用，spacer 高度为 0） -->
            <div v-if="padTop" class="vs-spacer" :style="{ height: padTop + 'px' }" aria-hidden="true"></div>
            <div
              v-for="entry in visibleEntries"
              :key="entry.id"
              class="entry-card"
              :class="[
                !isRecycleView && entry.favorite ? 'fav' : '',
                isRecycleView ? 'recycled' : '',
                vaultState.selectedEntry === entry.id ? 'selected' : '',
              ]"
              :data-id="entry.id"
              role="button"
              tabindex="0"
              :aria-label="'查看 ' + entry.title + '（' + typeLabelOf(entry.entryType) + '）'"
              @click="onCardClick(entry, $event)"
              @keydown="onCardKeydown(entry, $event)"
              @contextmenu="onCardContextMenu(entry, $event)"
              @touchstart.passive="onCardTouchStart(entry, $event)"
              @touchmove.passive="cancelLongPress"
              @touchend.passive="cancelLongPress"
              @touchcancel.passive="cancelLongPress"
            >
              <div class="entry-icon">
                <span class="type-icon-badge" :class="'type-icon-' + (entry.entryType || 'website')" :title="esc(typeLabelOf(entry.entryType))" v-html="cardTypeIcon(entry.entryType)"></span>
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
                  <button class="restore-btn" title="恢复" aria-label="恢复该条目" @click="restoreEntry(entry.id)">
                    <span v-html="Utils?.SvgIcons?.restore(13)"></span>
                  </button>
                  <button class="copy-btn" title="复制密码" aria-label="复制密码" @click="copyPassword(entry.id, $event.currentTarget)">
                    <span v-html="Utils?.SvgIcons?.copy(13)"></span>
                  </button>
                </template>
                <template v-else>
                  <button class="star-btn" :class="{ active: entry.favorite }" title="收藏" aria-label="收藏或取消收藏" @click="toggleFavorite(entry.id)">
                    <span v-html="favIconHtml(entry)"></span>
                  </button>
                  <button class="copy-btn" title="复制" aria-label="复制密码" @click="copyPassword(entry.id, $event.currentTarget)">
                    <span v-html="Utils?.SvgIcons?.copy(13)"></span>
                  </button>
                  <button class="delete-btn" title="删除" aria-label="移入回收站" @click="softDelete(entry.id)">
                    <span v-html="Utils?.SvgIcons?.trash(13)"></span>
                  </button>
                </template>
              </div>
            </div>
            <div v-if="padBottom" class="vs-spacer" :style="{ height: padBottom + 'px' }" aria-hidden="true"></div>
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
            <button v-if="vaultState.currentFilter !== 'recycle'" class="btn btn-primary btn-empty" @click="openEntryModal()">
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
        <span v-html="Utils?.SvgIcons?.grid(20)"></span>
        <span>全部</span>
      </button>
      <button
        class="tabbar-item"
        :class="{ active: vaultState.currentFilter === 'favorites' }"
        @click="selectFilter('favorites')"
      >
        <span v-html="Utils?.SvgIcons?.starOutline(20)"></span>
        <span>收藏</span>
      </button>
      <!-- FAB 加号：stroke-width 2.5 的特殊视觉（保留内联，不属于通用图标体系） -->
      <button class="tabbar-add" aria-label="添加密码" @click="openEntryModal()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <button
        class="tabbar-item"
        :class="{ active: vaultState.currentFilter === 'recycle' }"
        @click="selectFilter('recycle')"
      >
        <span v-html="Utils?.SvgIcons?.trash(20)"></span>
        <span>回收站<span v-if="sidebarStats.recycle > 0" class="tabbar-badge">{{ sidebarStats.recycle > 99 ? '99+' : sidebarStats.recycle }}</span></span>
      </button>
      <button class="tabbar-item" aria-label="标签筛选" :aria-expanded="vaultState.sidebarOpen ? 'true' : 'false'" @click="vaultState.sidebarOpen = true">
        <span v-html="Utils?.SvgIcons?.tag(20)"></span>
        <span>标签</span>
      </button>
    </nav>

    <!-- 右键快捷菜单（P2-2 修复：条目卡片右键，编辑/复制/收藏/删除；回收站视图为恢复/彻底删除） -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.visible"
        class="ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        role="menu"
        aria-label="条目快捷操作"
      >
        <template v-if="isRecycleView">
          <button class="ctx-item" role="menuitem" @click="onCtxAction('restore')">
            <span v-html="Utils?.SvgIcons?.restore(14)"></span>
            恢复
          </button>
          <button class="ctx-item" role="menuitem" @click="onCtxAction('copy')">
            <span v-html="Utils?.SvgIcons?.copy(14)"></span>
            复制密码
          </button>
          <button class="ctx-item ctx-danger" role="menuitem" @click="onCtxAction('purge')">
            <span v-html="Utils?.SvgIcons?.trash(14)"></span>
            彻底删除
          </button>
        </template>
        <template v-else>
          <button class="ctx-item" role="menuitem" @click="onCtxAction('edit')">
            <span v-html="Utils?.SvgIcons?.edit(14)"></span>
            编辑
          </button>
          <button class="ctx-item" role="menuitem" @click="onCtxAction('copy')">
            <span v-html="Utils?.SvgIcons?.copy(14)"></span>
            复制密码
          </button>
          <button class="ctx-item" role="menuitem" @click="onCtxAction('fav')">
            <span v-html="Utils?.SvgIcons?.starOutline(14)"></span>
            {{ ctxMenu.entry && ctxMenu.entry.favorite ? '取消收藏' : '收藏' }}
          </button>
          <button class="ctx-item ctx-danger" role="menuitem" @click="onCtxAction('delete')">
            <span v-html="Utils?.SvgIcons?.trash(14)"></span>
            删除
          </button>
        </template>
      </div>
    </Teleport>
    <!-- 屏幕阅读器实时通知区域 -->
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ vaultState.srAnnounce }}</div>
  </div>
</template>
