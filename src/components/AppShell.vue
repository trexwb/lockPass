<script setup>
/* LockPass — 主界面外壳（Header + Sidebar + Content + Detail） */
import { onMounted, onBeforeUnmount, computed, reactive, ref, watch, nextTick } from 'vue'
import { useVault, vaultState } from '../composables/useVault'
import HeaderBar from './layout/HeaderBar.vue'
import SidebarNav from './layout/SidebarNav.vue'
import DetailPanel from './entries/DetailPanel.vue'
import CopyCountdownPill from './common/CopyCountdownPill.vue'
import { useI18n } from '../composables/useI18n'
import CtxMenu from './common/CtxMenu.vue'

// 模板中直接引用 window 会被 Vue 编译为 _ctx.window（undefined）而抛错，
// 故在 setup 作用域暴露 Utils，模板统一使用 Utils.xxx
const { t } = useI18n()
const Utils = window.Utils
const Icons = window.Utils?.SvgIcons

const {
  getFilteredEntries, emptyRecycleBin, restoreEntry, selectEntry,
  toggleFavorite, copyPassword, softDelete, permanentDelete,
  setFilter, openEntryModal, computeSidebarStats, openModal,
  copyField, lockVault, openPasswordGenerator,
} = useVault()

// 类型中文名（P3-8 修复：卡片/详情中的类型 title 不再显示英文 id）
const TYPE_LABELS = { website: 'entry.type.website', server: 'entry.type.server', database: 'entry.type.database', ai: 'entry.type.ai', app: 'entry.type.app', other: 'entry.type.other' }

function typeLabelOf(type) {
  return t(TYPE_LABELS[type || 'website'] || type || '')
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
  if (vaultState.currentFilter === 'recycle') return t('empty.title.recycle')
  if (vaultState.searchQuery && vaultState.searchQuery.trim()) return t('empty.title.search')
  if (vaultState.currentFilter === 'favorites') return t('empty.favorites')
  return t('empty.noPasswords')
})

const emptyDesc = computed(() => {
  if (vaultState.currentFilter === 'recycle') return t('empty.desc.recycle')
  const q = (vaultState.searchQuery || '').trim()
  if (q) return t('empty.desc.search', { q })
  if (vaultState.currentFilter === 'favorites') return t('empty.desc.favorites')
  return t('empty.desc.none')
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
  if (isRecycleView.value) return t('detail.deletedAt')
  return window.Utils ? window.Utils.formatDate(entry.updatedAt || entry.createdAt) : ''
}

function esc(value) {
  return window.Utils ? window.Utils.escHtml(value) : String(value ?? '')
}

/* B5 搜索增强：标题/副标题命中片段高亮（SearchUtil.highlightField 内置转义防 XSS） */
function highlightTitle(entry) {
  const q = vaultState.searchQuery.trim()
  if (!q || !window.SearchUtil) return esc(entry.title || '')
  return window.SearchUtil.highlightField(entry.title || '', q)
}

function highlightSubtitle(entry) {
  const sub = cardSubtitle(entry)
  if (!sub) return ''
  const q = vaultState.searchQuery.trim()
  if (!q || !window.SearchUtil) return esc(sub)
  return window.SearchUtil.highlightField(sub, q)
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

const ctxMenu = reactive({ visible: false, x: 0, y: 0, payload: null })
// origin 锚点：用于给 .ctx-menu 切 transform-origin，点击区越靠右/下反向锚
const ctxOrigin = ref('tl')

/** 右键打开快捷菜单；位置做视口边缘钳制，避免菜单溢出屏幕 */
function onCardContextMenu(entry, e) {
  e.preventDefault()
  e.stopPropagation()
  const MENU_W = 210
  const MENU_H = 320
  const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8)
  const y = Math.min(e.clientY, window.innerHeight - MENU_H - 8)
  const leftHalf = e.clientX <= window.innerWidth / 2
  const topHalf = e.clientY <= window.innerHeight / 2
  ctxOrigin.value = (topHalf ? 't' : 'b') + (leftHalf ? 'l' : 'r')
  ctxMenu.x = Math.max(8, x)
  ctxMenu.y = Math.max(8, y)
  ctxMenu.payload = { kind: 'entry', entry }
  ctxMenu.visible = true
}

/** 关闭右键菜单 */
function closeCtxMenu() {
  ctxMenu.visible = false
  ctxMenu.payload = null
}

/**
 * 工作区兜底右键：工具栏 / 列表空白 / 空状态 命中时打开 kind='workspace' 菜单
 * （条目卡片右键仍走 onCardContextMenu，其 stopPropagation 保证不会冒泡到此处）
 */
function onWorkspaceContextMenu(e) {
  e.preventDefault()
  e.stopPropagation()
  const MENU_W = 240
  const MENU_H = isRecycleView.value ? 220 : 300
  const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8)
  const y = Math.min(e.clientY, window.innerHeight - MENU_H - 8)
  const leftHalf = e.clientX <= window.innerWidth / 2
  const topHalf = e.clientY <= window.innerHeight / 2
  ctxOrigin.value = (topHalf ? 't' : 'b') + (leftHalf ? 'l' : 'r')
  ctxMenu.x = Math.max(8, x)
  ctxMenu.y = Math.max(8, y)
  ctxMenu.payload = { kind: 'workspace' }
  ctxMenu.visible = true
}

// 列表重播编舞：筛选 / 搜索切换时整表重挂载，重播 list-rise 入场动画
// （增删走卡片自身 leaving / just-restored 动画，不触发整表重播以免打断离场）
const listEpoch = ref(0)
watch(
  () => [vaultState.currentFilter, vaultState.searchQuery],
  () => { listEpoch.value++ },
)

/** 根据当前 payload 生成菜单项（扩展自旧版 4 项 → 最高 10+，按类型动态插入） */
const entryCtxItems = computed(() => {
  if (!ctxMenu.payload) return []
  // 工作区兜底右键：工具栏 / 列表空白 / 空状态 → 生成密码（无目标字段，仅复制）
  if (ctxMenu.payload.kind === 'workspace') {
    return [
      { key: 'pwgen', label: t('pwgen.ctxEntry'), iconHtml: Icons?.refresh?.(14), accent: true },
    ]
  }
  if (ctxMenu.payload.kind !== 'entry') return []
  const e = ctxMenu.payload.entry
  if (!e) return []

  const list = []
  const isRecycle = isRecycleView.value

  if (isRecycle) {
    list.push(
      { key: 'restore', label: t('detail.ctx.restore'), iconHtml: Icons?.restore(14), accent: true },
      { key: 'copy', label: t('detail.ctx.copyPw'), iconHtml: Icons?.copy(14) },
    )
    if (e.username) list.push({ key: 'copy-user', label: t('detail.ctx.copyUser'), iconHtml: Icons?.user(14) })
    if (e.url) list.push({ key: 'copy-url', label: t('detail.ctx.copyUrl'), iconHtml: Icons?.link(14) })
    list.push({ divider: true })
    list.push({ key: 'purge', label: t('detail.ctx.purge'), iconHtml: Icons?.trash(14), danger: true })
    return list
  }

  list.push({ key: 'edit', label: t('ctx.edit'), iconHtml: Icons?.edit(14), shortcut: '↵' })
  list.push({ key: 'duplicate', label: t('detail.ctx.duplicate'), iconHtml: Icons?.copy(14) })
  list.push({ key: 'fav', label: e.favorite ? t('detail.ctx.unfav') : t('detail.ctx.fav'), iconHtml: e.favorite ? Icons?.starFilled(14) : Icons?.starOutline(14), accent: !!e.favorite })
  list.push({ divider: true })

  list.push({ key: 'copy', label: e.entryType === 'app' ? t('detail.ctx.copyAppId') : t('detail.ctx.copyPw'), iconHtml: Icons?.copy(14), shortcut: '⌘C' })
  if (e.username) list.push({ key: 'copy-user', label: t('detail.ctx.copyUser'), iconHtml: Icons?.user(14) })
  if (e.url) {
    list.push({ key: 'copy-url', label: t('detail.ctx.copyUrl'), iconHtml: Icons?.link(14) })
    list.push({ key: 'open-url', label: t('detail.ctx.openUrl'), iconHtml: Icons?.external(14) })
  }
  if (e.entryType === 'server' && e.url && e.username) {
    list.push({ key: 'copy-ssh', label: t('detail.ctx.copySsh'), iconHtml: Icons?.terminal(14) })
  }
  if (e.entryType === 'database' && e.url && e.username) {
    list.push({ key: 'copy-mysql', label: t('detail.ctx.copyMysql'), iconHtml: Icons?.terminal(14) })
  }
  list.push({ divider: true })
  list.push({ key: 'pwgen', label: t('pwgen.ctxEntry'), iconHtml: Icons?.refresh?.(14), accent: true })
  list.push({ divider: true })
  list.push({ key: 'qr-share', label: t('detail.ctx.qrShare'), iconHtml: Icons?.qr(14) })
  list.push({ divider: true })
  list.push({ key: 'delete', label: t('detail.ctx.softDelete'), iconHtml: Icons?.trash(14), danger: true })
  return list
})

/** 右键菜单动作分发：entry 级 */
async function onEntryCtxAction(action) {
  const payload = ctxMenu.payload
  closeCtxMenu()
  const e = payload?.entry
  // 全局级动作：无目标条目也可执行（工作区右键菜单）
  if (action === 'pwgen') {
    openPasswordGenerator()
    return
  }
  if (!e) return
  const id = e.id
  try {
    if (action === 'edit') openEntryModal(id)
    else if (action === 'duplicate') {
      // 深拷贝一条：新 id，保留字段，原 createdAt 不保留
      // 先写 sessionStorage 草稿，再打开编辑器（onMounted 会立即读取）
      try {
        sessionStorage.setItem('lockpass_draft_new', JSON.stringify({
          title: e.title ? e.title + ' ' + t('detail.copySuffix') : t('detail.untitled') + ' ' + t('detail.copySuffix'),
          entryType: e.entryType || 'website',
          tags: e.tags || [],
          notes: e.notes || '',
          fields: {
            username: e.username || '', password: e.password || '', url: e.url || '',
            port: e.port ? String(e.port) : '', appId: e.appId || '',
            privateKey: e.privateKey || '',
            rootUser: e.root?.username || '',
            rootPwd: e.root?.password || '',
          },
        }))
      } catch (_err) { /* 草稿写入失败不阻断打开编辑器 */ }
      openEntryModal(null)
      window.Utils.showToast(t('toast.duplicateDraft'), 'info')
    }
    else if (action === 'fav') toggleFavorite(id)
    else if (action === 'copy') copyPassword(id)
    else if (action === 'copy-user') copyField(e.username || '')
    else if (action === 'copy-url') copyField(e.url || '')
    else if (action === 'copy-ssh') {
      const port = e.port ? ` -p ${e.port}` : ''
      copyField(`ssh${port} ${e.username}@${e.url}`)
    }
    else if (action === 'copy-mysql') {
      const port = e.port ? ` -P ${e.port}` : ''
      copyField(`mysql -h ${e.url}${port} -u ${e.username} -p`)
    }
    else if (action === 'open-url') {
      if (!e.url) return
      let url = e.url
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url
      window.Utils.openExternal(url)
    }
    else if (action === 'qr-share') {
      selectEntry(id)
      openModal('qr-share')
    }
    else if (action === 'delete') softDelete(id)
    else if (action === 'restore') restoreEntry(id)
    else if (action === 'purge') permanentDelete(id)
  } catch (err) {
    console.error('[AppShell ctx]', err)
  }
}

let longPressTimer = null
let longPressTarget = null
const LONG_PRESS_MS = 500

function onCardTouchStart(entry, e) {
  if (!e.touches || e.touches.length !== 1) return
  const touch = e.touches[0]
  const clientX = touch.clientX
  const clientY = touch.clientY
  longPressTarget = e.currentTarget
  longPressTarget.classList.add('long-pressing')
  // 轻触反馈：提示用户长按已开始
  if (navigator.vibrate) navigator.vibrate(10)
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    // 长按触发：清除视觉状态 + 较强震动
    if (longPressTarget) {
      longPressTarget.classList.remove('long-pressing')
      longPressTarget = null
    }
    if (navigator.vibrate) navigator.vibrate(30)
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
  if (longPressTarget) {
    longPressTarget.classList.remove('long-pressing')
    longPressTarget = null
  }
}

/** （旧版动作分发已被 onEntryCtxAction 替代，保留 0 成本空壳避免外部引用编译告警） */
function onCtxAction() {}

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
  if (vaultState.currentFilter === 'all') return t('side.allPasswords')
  if (vaultState.currentFilter === 'favorites') return t('side.favorites')
  if (vaultState.currentFilter === 'recycle') return t('side.trash')
  if (vaultState.currentFilter.startsWith('type:')) {
    return typeLabelOf(vaultState.currentFilter.slice(5))
  }
  return t('side.filterTagLabel', { tag: vaultState.currentFilter })
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
  // N10：capture 监听显式标记 passive，避免主线程滚动阻塞
  window.addEventListener('scroll', onDocScrollOrResize, { capture: true, passive: true })
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
  // N10：移除时需匹配 capture 标志
  window.removeEventListener('scroll', onDocScrollOrResize, { capture: true })
  window.removeEventListener('resize', onDocResize)
})
</script>

<template>
  <div id="app-shell">
    <!-- Hero moment：解锁成功瞬间的扫描脉冲（CSS 动画一次，fail-open） -->
    <div class="hero-scan-line" aria-hidden="true"></div>
    <HeaderBar />

    <div id="main-layout">
      <div id="sidebar-overlay" :class="{ active: vaultState.sidebarOpen }" @click="vaultState.sidebarOpen = false"></div>

      <SidebarNav />

      <main id="content" ref="contentEl" @scroll.passive="onContentScroll">
        <canvas id="workspace-bg" aria-hidden="true"></canvas>
        <div id="content-inner" :class="{ 'empty-active': !filteredEntries.length }">
          <div class="content-toolbar" @contextmenu.self.prevent.stop="onWorkspaceContextMenu">
            <div>
              <h2 id="content-title">{{ contentTitle }}</h2>
            </div>
            <div class="toolbar-right">
              <span id="entry-count" :key="filteredEntries.length" class="text-muted text-sm count-pop">{{ filteredEntries.length }} 项</span>
              <button
                v-if="vaultState.currentFilter === 'recycle' && filteredEntries.length"
                id="empty-recycle-btn"
                class="btn btn-ghost btn-sm"
                :title="t('side.ctxEmptyTrash')"
                @click="emptyRecycleBin()"
              >
                <span v-html="Utils?.SvgIcons?.trash(13)"></span>
                {{ t('side.ctxEmptyTrash') }}
              </button>
            </div>
          </div>

          <div id="entries-list" :key="listEpoch" @contextmenu.self.prevent.stop="onWorkspaceContextMenu">
            <!-- P3-5 虚拟滚动：窗口外用 spacer 撑高（≤100 条时不启用，spacer 高度为 0） -->
            <div v-if="padTop" class="vs-spacer" :style="{ height: padTop + 'px' }" aria-hidden="true"></div>
            <div
              v-for="(entry, idx) in visibleEntries"
              :key="entry.id"
              class="entry-card"
              :class="[
                !isRecycleView && entry.favorite ? 'fav' : '',
                isRecycleView ? 'recycled' : '',
                vaultState.selectedEntry === entry.id ? 'selected' : '',
              ]"
              :data-id="entry.id"
              :style="{ '--i': Math.min(idx, 8) }"
              role="button"
              tabindex="0"
              :aria-label="t('detail.viewAria', { title: entry.title, type: typeLabelOf(entry.entryType) })"
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
                <div class="entry-title" v-html="highlightTitle(entry)"></div>
                <div class="entry-meta">
                  <span v-if="cardSubtitle(entry)" class="entry-subtitle" v-html="highlightSubtitle(entry)"></span>
                  <span v-for="tag in (entry.tags || []).slice(0, 3)" :key="tag" v-html="tagChipHtml(tag)"></span>
                  <span v-if="(entry.tags || []).length > 3" class="entry-tag-more">+{{ entry.tags.length - 3 }}</span>
                  <span class="entry-date">{{ formatCardDate(entry) }}</span>
                </div>
              </div>
              <div class="entry-actions" @click="onActionsClick">
                <template v-if="isRecycleView">
                  <button class="restore-btn" :title="t('detail.footer.restore')" :aria-label="t('card.ariaRestore')" @click="restoreEntry(entry.id)">
                    <span v-html="Utils?.SvgIcons?.restore(13)"></span>
                  </button>
                  <button class="copy-btn" :title="t('detail.ctx.copyPw')" :aria-label="t('detail.ctx.copyPw')" @click="copyPassword(entry.id, $event.currentTarget)">
                    <span v-html="Utils?.SvgIcons?.copy(13)"></span>
                  </button>
                </template>
                <template v-else>
                  <button class="star-btn" :class="{ active: entry.favorite }" :data-id="entry.id" :title="t('detail.fav')" :aria-label="t('card.ariaFav')" @click="toggleFavorite(entry.id)">
                    <span v-html="favIconHtml(entry)"></span>
                  </button>
                  <button class="copy-btn" :title="t('detail.field.copy')" :aria-label="t('detail.ctx.copyPw')" @click="copyPassword(entry.id, $event.currentTarget)">
                    <span v-html="Utils?.SvgIcons?.copy(13)"></span>
                  </button>
                  <button class="delete-btn" :title="t('detail.footer.delete')" :aria-label="t('detail.ctx.softDelete')" @click="softDelete(entry.id)">
                    <span v-html="Utils?.SvgIcons?.trash(13)"></span>
                  </button>
                </template>
              </div>
            </div>
            <div v-if="padBottom" class="vs-spacer" :style="{ height: padBottom + 'px' }" aria-hidden="true"></div>
          </div>

          <div v-if="!filteredEntries.length" id="empty-state" class="empty-state" @contextmenu.prevent.stop="onWorkspaceContextMenu">
            <div class="empty-illustration">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3 id="empty-title">{{ emptyTitle }}</h3>
            <p id="empty-desc">{{ emptyDesc }}</p>
            <button v-if="vaultState.currentFilter !== 'recycle'" class="btn btn-primary btn-empty" @click="openEntryModal()">
              {{ t('empty.cta') }}
            </button>
            <div class="empty-features">
              <span>{{ t('empty.feature.offline') }}</span>
              <span>{{ t('empty.feature.qr') }}</span>
              <span>{{ t('empty.feature.localBackup') }}</span>
            </div>
          </div>
        </div>
      </main>

      <DetailPanel />
    </div>

    <!-- 移动端底部导航（≤480px 显示；替代侧边栏主路径，标签入口打开抽屉） -->
    <nav id="mobile-tabbar" :aria-label="t('nav.ariaTabbar')">
      <button
        class="tabbar-item"
        :class="{ active: vaultState.currentFilter === 'all' }"
        @click="selectFilter('all')"
      >
        <span v-html="Utils?.SvgIcons?.grid(20)"></span>
        <span>{{ t('nav.all') }}</span>
      </button>
      <button
        class="tabbar-item"
        :class="{ active: vaultState.currentFilter === 'favorites' }"
        @click="selectFilter('favorites')"
      >
        <span v-html="Utils?.SvgIcons?.starOutline(20)"></span>
        <span>{{ t('side.favorites') }}</span>
      </button>
      <!-- FAB 加号：stroke-width 2.5 的特殊视觉（保留内联，不属于通用图标体系） -->
      <button class="tabbar-add" :aria-label="t('side.addPassword')" @click="openEntryModal()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <button
        class="tabbar-item"
        :class="{ active: vaultState.currentFilter === 'recycle' }"
        @click="selectFilter('recycle')"
      >
        <span v-html="Utils?.SvgIcons?.trash(20)"></span>
        <span>{{ t('side.trash') }}<span v-if="sidebarStats.recycle > 0" class="tabbar-badge">{{ sidebarStats.recycle > 99 ? '99+' : sidebarStats.recycle }}</span></span>
      </button>
      <button class="tabbar-item" :aria-label="t('nav.ariaTagsFilter')" :aria-expanded="vaultState.sidebarOpen ? 'true' : 'false'" @click="vaultState.sidebarOpen = true">
        <span v-html="Utils?.SvgIcons?.tag(20)"></span>
        <span>{{ t('nav.tags') }}</span>
      </button>
    </nav>

    <!-- 条目右键快捷菜单（扩展版：编辑/复制/二维码分享/打开链接/复制命令/删除/恢复等动态） -->
    <CtxMenu
      :menu="ctxMenu"
      :items="entryCtxItems"
      :aria-label="t('ctx.ariaLabel')"
      :origin="ctxOrigin"
      @action="onEntryCtxAction"
    />
    <!-- 复制成功倒计时胶囊（响应式状态驱动，替代旧版 DOM 操控浮动提示） -->
    <CopyCountdownPill />
    <!-- 屏幕阅读器实时通知区域 -->
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ vaultState.srAnnounce }}</div>
  </div>
</template>
