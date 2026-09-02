<script setup>
/* LockPass — 侧边栏（添加 / 个人筛选 / 类型筛选 / 热门标签 / 退出）
   v1.0.32：为每一个可交互的导航项补充右键菜单，
   包括：个人筛选（全部/收藏/回收站）、类型筛选、热门标签。 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useVault, vaultState, ENTRY_TYPES } from '../../composables/useVault'
import { useCtxMenu } from '../../composables/useCtxMenu'
import { useSwipeClose } from '../../composables/useSwipeClose'
import CtxMenu from '../common/CtxMenu.vue'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()
const Icons = window.Utils?.SvgIcons

const {
  setFilter, openEntryModal, openModal, computeSidebarStats, getTopTags, logout,
  saveVault,
} = useVault()

const addDropdownOpen = ref(false)
const tagSectionOpen = ref((() => { try { return localStorage.getItem('lockpass_tags_collapsed') !== '1' } catch (e) { return true } })())

const stats = computed(() => computeSidebarStats())
const topTags = computed(() => getTopTags(8))

// 左滑关闭手势（侧边栏在左侧，手指左滑 → translateX 跟随 → 超阈值关闭）
// 仅移动端抽屉模式（≤1024px）且面板已打开时启用
const { dragOffset, isDragging, onTouchStart, onTouchMove, onTouchEnd } = useSwipeClose({
  direction: 'left',
  threshold: 80,
  onClose: () => { vaultState.sidebarOpen = false },
  isEnabled: () => window.matchMedia('(max-width: 1024px)').matches && vaultState.sidebarOpen,
})
const sidebarStyle = computed(() => {
  if (!isDragging.value || !dragOffset.value) return null
  return { transform: `translateX(${dragOffset.value}px)`, transition: 'none' }
})

const typeLabels = {
  website: 'entry.type.website', server: 'entry.type.server', database: 'entry.type.database', ai: 'entry.type.ai', app: 'entry.type.app', other: 'entry.type.other',
}

function selectFilter(f) {
  setFilter(f)
  vaultState.sidebarOpen = false
}

/**
 * 键盘可达（P2-4 修复）：导航项 div 的 Enter/Space 触发与点击等效的筛选切换
 * @param {KeyboardEvent} e 键盘事件
 * @param {string} f 目标筛选值
 */
function onNavKey(e, f) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    selectFilter(f)
  }
}

function onDocClick(e) {
  if (addDropdownOpen.value && !e.target.closest('#add-entry-dropdown')) {
    addDropdownOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
})

// 折叠状态持久化（对齐原生 main.js TAGS_COLLAPSE_KEY）
watch(tagSectionOpen, (v) => {
  try { localStorage.setItem('lockpass_tags_collapsed', v ? '0' : '1') } catch (e) {}
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})

// 类型图标：复用 window.Utils.SvgIcons.typeIcon
function typeIconSvg(type, size = 14) {
  return window.Utils?.SvgIcons?.typeIcon(size, type) || ''
}

// 标签图标：复用旧版 getCategoryIcon
function tagIconSvg(name) {
  const def = vaultState.tagDefs[name] || {}
  return window.Utils.getCategoryIcon(def.icon || 'other', def.color || '#8b949e')
}

/* ════════════════════════════════════════════════════════════════
   侧边栏右键菜单（通用 payload.kind = nav/tag/type/personal/recycle）
   ════════════════════════════════════════════════════════════════ */

const {
  ctxMenu, handleCtxMenu, onCtxAction, closeCtxMenu,
} = useCtxMenu(async (action, payload) => {
  switch (payload?.kind) {
    case 'personal': await handlePersonal(action, payload.filter); break
    case 'type':     await handleType(action, payload.typeId); break
    case 'tag':      await handleTag(action, payload.name); break
    case 'recycle':  await handleRecycle(action); break
    case 'add':      await handleAdd(action); break
    case 'logout':   await handleLogout(action); break
    case 'tag-manage': await handleTagManage(action); break
  }
})

const navCtxItems = computed(() => {
  const p = ctxMenu.payload
  if (!p) return []
  const list = []
  switch (p.kind) {
    case 'personal': {
      const f = p.filter
      list.push({ key: 'jump', label: t('side.ctxJumpGroup'), iconHtml: Icons?.grid(14), accent: true })
      if (f === 'favorites') {
        list.push({ key: 'clear-fav', label: t('side.ctxClearFav'), iconHtml: Icons?.starOutline(14) })
      }
      list.push({ divider: true })
      list.push({ key: 'new-entry', label: t('side.ctxNewInGroup'), iconHtml: Icons?.edit(14) })
      return list
    }
    case 'recycle': {
      const n = stats.value.recycle || 0
      list.push({ key: 'jump', label: t('side.ctxJumpTrash'), iconHtml: Icons?.trash(14), accent: true })
      list.push({ key: 'empty', label: n ? t('side.ctxEmptyTrashN', { n }) : t('side.ctxEmptyTrash'), iconHtml: Icons?.trash(14), danger: !!n, disabled: !n })
      return list
    }
    case 'type': {
      const typeId = p.typeId
      list.push({ key: 'jump', label: t('side.ctxJumpType', { type: t(typeLabels[typeId] || typeId) }), iconHtml: typeIconSvg(typeId, 14), accent: true })
      list.push({ key: 'new-entry', label: t('side.ctxNewType', { type: t(typeLabels[typeId] || typeId) }), iconHtml: Icons?.edit(14) })
      return list
    }
    case 'tag': {
      const name = p.name
      const isDefault = !!vaultState.tagDefs?.[name]?.isDefault
      list.push({ key: 'jump', label: t('side.ctxFilterTag', { tag: name }), iconHtml: tagIconSvg(name), accent: true })
      list.push({ key: 'rename', label: t('side.ctxRenameTag'), iconHtml: Icons?.edit(14), disabled: isDefault, title: isDefault ? t('side.tipDefaultTag') : '' })
      list.push({ key: 'open-tags', label: t('side.ctxEditTagStyle'), iconHtml: Icons?.palette(14) })
      list.push({ key: 'dup-tag', label: t('side.ctxDupTag'), iconHtml: Icons?.copy(14) })
      list.push({ divider: true })
      list.push({ key: 'strip', label: t('side.ctxStrip'), iconHtml: Icons?.refresh(14), disabled: isDefault })
      list.push({ key: 'merge', label: t('side.ctxMerge'), iconHtml: Icons?.merge(14), disabled: isDefault })
      list.push({ key: 'delete', label: t('side.ctxDeleteTag'), iconHtml: Icons?.trash(14), danger: true, disabled: isDefault })
      return list
    }
    case 'add': {
      list.push({ key: 'new', label: t('side.newPassword'), iconHtml: Icons?.key(14), accent: true })
      list.push({ key: 'qr-import', label: t('qrimport.add'), iconHtml: Icons?.qr(14) })
      list.push({ key: 'import', label: t('import.batchVault'), iconHtml: Icons?.upload(14) })
      return list
    }
    case 'logout': {
      list.push({ key: 'lock', label: t('header.ctxLockKeepSession'), iconHtml: Icons?.lock(14) })
      list.push({ key: 'logout', label: t('side.ctxLogout'), iconHtml: Icons?.logoutIcon(14), danger: true })
      return list
    }
    case 'tag-manage': {
      const custom = Object.keys(vaultState.tagDefs || {}).filter(n => !vaultState.tagDefs[n]?.isDefault)
      list.push({ key: 'open', label: t('side.ctxOpenMgr'), iconHtml: Icons?.palette(14), accent: true })
      list.push({ key: 'new-tag', label: t('side.ctxNewTag'), iconHtml: Icons?.tag(14) })
      list.push({ divider: true })
      list.push({ key: 'expand', label: t('side.ctxExpand'), iconHtml: Icons?.refresh(14), disabled: tagSectionOpen.value })
      list.push({ key: 'clear-custom', label: t('side.ctxClearCustom', { n: custom.length }), iconHtml: Icons?.trash(14), danger: true, disabled: !custom.length })
      return list
    }
  }
  return list
})

async function handlePersonal(action, filter) {
  if (action === 'jump') { selectFilter(filter); return }
  if (action === 'new-entry') {
    setFilter(filter === 'all' ? 'all' : filter)
    openEntryModal()
    return
  }
  if (action === 'clear-fav' && filter === 'favorites') {
    const n = stats.value.favorites || 0
    if (!n) return
    const ok = await window.Utils.confirm({
      title: t('side.confirmClearFavTitle'),
      message: t('side.confirmClearFavMsg', { n }),
      confirmText: t('side.confirmClearFavOk'),
      cancelText: t('confirm.default.cancel'),
    })
    if (!ok) return
    vaultState.entries.forEach(e => { if (e.favorite) e.favorite = false })
    await saveVault()
    window.Utils.showToast(t('side.toastClearedFav', { n }), 'success')
  }
}

async function handleType(action, typeId) {
  if (action === 'jump') { selectFilter('type:' + typeId); return }
  if (action === 'new-entry') {
    // 草稿生命周期 v1.1.12b：类型预选改为打开意图传参（editorOpenOpts.presetType），
    // 不再写入 'new' 草稿 —— 空骨架草稿会误触发「是否使用草稿」询问，且与
    // 「任何关闭不清空」的持续保留语义冲突
    openEntryModal(null, { presetType: typeId })
    window.Utils.showToast(t('side.toastTypePreselected', { label: t(typeLabels[typeId] || typeId) }), 'info')
  }
}

async function handleTag(action, name) {
  if (action === 'jump') { selectFilter(name); return }
  if (action === 'open-tags') { openModal('tags'); return }
  if (action === 'rename') {
    const def = vaultState.tagDefs[name]
    if (!def || def.isDefault) return
    const newName = await window.Utils.prompt({
      title: t('side.confirmRenameTitle'),
      message: t('side.confirmRenameMsg', { name }),
      value: name,
      confirmText: t('detail.renameConfirm'),
    })?.trim()
    if (!newName || newName === name) return
    if (vaultState.tagDefs[newName]) {
      window.Utils.showToast(t('side.toastRenameDup'), 'error')
      return
    }
    vaultState.tagDefs[newName] = { ...def }
    delete vaultState.tagDefs[name]
    vaultState.entries.forEach(e => {
      if (!e.tags) return
      const idx = e.tags.indexOf(name)
      if (idx >= 0) e.tags.splice(idx, 1, newName)
    })
    vaultState.deleted.forEach(e => {
      if (!e.tags) return
      const idx = e.tags.indexOf(name)
      if (idx >= 0) e.tags.splice(idx, 1, newName)
    })
    // 同步当前筛选名
    if (vaultState.currentFilter === name) vaultState.currentFilter = newName
    await saveVault()
    window.Utils.showToast(t('side.toastRenamed', { name, newName }), 'success')
    return
  }
  if (action === 'dup-tag') {
    const def = vaultState.tagDefs[name] || {}
    let idx = 1
    let cand = `${name} ${t('side.dupSuffix')}`
    while (vaultState.tagDefs[cand]) { idx++; cand = `${name} ${t('side.dupSuffix')} ${idx}` }
    vaultState.tagDefs[cand] = {
      color: def.color || window.Utils.getRandomTagAttrs(vaultState.tagDefs).color,
      icon: def.icon || 'other',
      isDefault: false,
    }
    await saveVault()
    window.Utils.showToast(t('side.toastTagCreated', { name: cand }), 'success')
    return
  }
  if (action === 'strip' || action === 'delete') {
    const def = vaultState.tagDefs[name]
    if (!def || def.isDefault) return
    const count = (stats.value.byTag || {})[name] || 0
    const msg = action === 'strip'
      ? t('side.confirmStripMsg', { name, count })
      : t('side.confirmDeleteMsg', { name, count })
    const ok = await window.Utils.confirm({
      title: action === 'strip' ? t('side.confirmStripTitle') : t('side.confirmDeleteTitle'),
      message: msg + '\n' + t('side.confirmUnreversible'),
      confirmText: action === 'strip' ? t('side.confirmStripOk') : t('side.confirmDeleteOk'),
      danger: true,
    })
    if (!ok) return
    const strip = (list) => list.forEach(e => {
      if (!e.tags) return
      e.tags = e.tags.filter(t => t !== name)
    })
    strip(vaultState.entries)
    strip(vaultState.deleted)
    if (action === 'delete') delete vaultState.tagDefs[name]
    if (vaultState.currentFilter === name) vaultState.currentFilter = 'all'
    await saveVault()
    window.Utils.showToast(action === 'strip' ? t('side.toastStripped') : t('side.toastDeleted'), 'success')
    return
  }
  if (action === 'merge') {
    const def = vaultState.tagDefs[name]
    if (!def || def.isDefault) return
    const others = Object.keys(vaultState.tagDefs).filter(n => n !== name)
    if (!others.length) { window.Utils.showToast(t('side.toastNoMergeTarget'), 'warning'); return }
    const target = await window.Utils.prompt({
      title: t('side.confirmMergeTitle'),
      message: t('side.confirmMergeMsg', { name, list: others.join('、') }),
      value: others[0],
      confirmText: t('side.confirmMergeOk'),
    })?.trim()
    if (!target || target === name) return
    if (!vaultState.tagDefs[target]) { window.Utils.showToast(t('side.toastMergeTargetMissing'), 'error'); return }
    const mergeOne = (list) => list.forEach(e => {
      if (!e.tags) return
      if (!e.tags.includes(name)) return
      if (!e.tags.includes(target)) e.tags.push(target)
      e.tags = e.tags.filter(t => t !== name)
    })
    mergeOne(vaultState.entries)
    mergeOne(vaultState.deleted)
    delete vaultState.tagDefs[name]
    if (vaultState.currentFilter === name) vaultState.currentFilter = target
    await saveVault()
    window.Utils.showToast(t('side.toastMerged', { name, target }), 'success')
  }
}

async function handleRecycle(action) {
  if (action === 'jump') { selectFilter('recycle'); return }
  if (action === 'empty') {
    // 直接复用 App 壳：saveVault + toast 的链路已内置，空 recycle 会弹窗防误操作
    // 但当前 useVault 不导出 emptyRecycleBin → 从 AppShell 调用不便。
    // 用 Utils.confirm + 清空 deleted 方式，逻辑一致：
    const n = stats.value.recycle || 0
    if (!n) return
    const ok = await window.Utils.confirm({
      title: t('side.confirmEmptyTrashTitle'),
      message: t('side.confirmEmptyTrashMsg', { n }),
      confirmText: t('side.confirmEmptyTrashOk'),
      danger: true,
    })
    if (!ok) return
    const deadIds = vaultState.deleted.map(e => e.id)
    vaultState.deleted = []
    if (deadIds.length) {
      const keep = {}
      Object.keys(vaultState.history || {}).forEach(id => {
        if (!deadIds.includes(id)) keep[id] = vaultState.history[id]
      })
      vaultState.history = keep
    }
    await saveVault()
    if (vaultState.currentFilter === 'recycle') setFilter('all')
    window.Utils.showToast(t('side.toastTrashEmptied'), 'success')
  }
}

async function handleAdd(action) {
  addDropdownOpen.value = false
  if (action === 'new') openEntryModal()
  else if (action === 'qr-import') openModal('qr-import')
  else if (action === 'import') openModal('import')
}

/** 标签区标题右键：打开标签管理 / 新建 / 展开 / 清空自定义标签 */
async function handleTagManage(action) {
  if (action === 'open') { openModal('tags'); return }
  if (action === 'new-tag') {
    openModal('tags')
    window.Utils.showToast(t('side.toastTagMgrHint'), 'info')
    return
  }
  if (action === 'expand') { tagSectionOpen.value = true; return }
  if (action === 'clear-custom') {
    const custom = Object.keys(vaultState.tagDefs || {}).filter(n => !vaultState.tagDefs[n]?.isDefault)
    if (!custom.length) return
    const ok = await window.Utils.confirm({
      title: t('side.confirmClearCustomTitle'),
      message: t('side.confirmClearCustomMsg', { n: custom.length, list: custom.join('、') }),
      confirmText: t('side.confirmClearCustomOk'),
      danger: true,
    })
    if (!ok) return
    const customSet = new Set(custom)
    const strip = (list) => list.forEach(e => {
      if (!e.tags) return
      e.tags = e.tags.filter(t => !customSet.has(t))
    })
    strip(vaultState.entries)
    strip(vaultState.deleted)
    custom.forEach(n => delete vaultState.tagDefs[n])
    if (vaultState.currentFilter && customSet.has(vaultState.currentFilter)) vaultState.currentFilter = 'all'
    await saveVault()
    window.Utils.showToast(t('side.toastCustomTagsDeleted', { n: custom.length }), 'success')
  }
}

async function handleLogout(action) {
  if (action === 'lock') {
    // 复用 composable 导出的 lockVault（内存清理 + 状态重置 + 锁定 Toast 统一在内部完成）
    lockVault()
    return
  }
  if (action === 'logout') logout()
}
</script>

<template>
  <aside
    id="sidebar"
    :class="{ open: vaultState.sidebarOpen, swiping: isDragging }"
    :style="sidebarStyle"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
    @touchcancel.passive="onTouchEnd"
  >
    <div class="swipe-hint" aria-hidden="true"></div>
    <div class="sidebar-scroll">
      <div class="sidebar-section">
        <div class="btn-dropdown" id="add-entry-dropdown">
          <button
            class="btn btn-primary btn-full btn-dropdown-main"
            @click="openEntryModal()"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'add' }, { w: 230, h: 160 })"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {{ t('side.addPassword') }}
          </button>
          <button class="btn btn-primary btn-dropdown-toggle" :aria-label="t('side.moreAdd')" :title="t('side.moreAdd')"
            @click="addDropdownOpen = !addDropdownOpen"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'add' }, { w: 230, h: 160 })"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div class="btn-dropdown-menu" :class="{ hidden: !addDropdownOpen }">
            <button @click="openModal('qr-import'); addDropdownOpen = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 14h3v3h-3z" /><path d="M21 14v3h-3" />
              </svg>
              {{ t('qrimport.add') }}
            </button>
            <button @click="openModal('import'); addDropdownOpen = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {{ t('import.batch') }}
            </button>
          </div>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title">{{ t('side.sectionPersonal') }}</div>
        <nav id="nav-personal">
          <div
            class="nav-item"
            role="button"
            tabindex="0"
            :class="{ active: vaultState.currentFilter === 'all' }"
            @click="selectFilter('all')"
            @keydown="onNavKey($event, 'all')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'personal', filter: 'all' }, { w: 240, h: 170 })"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            {{ t('side.allPasswords') }}
            <span class="count">{{ stats.total }}</span>
          </div>
          <div
            class="nav-item"
            role="button"
            tabindex="0"
            :class="{ active: vaultState.currentFilter === 'favorites' }"
            @click="selectFilter('favorites')"
            @keydown="onNavKey($event, 'favorites')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'personal', filter: 'favorites' }, { w: 248, h: 200 })"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" :fill="vaultState.currentFilter === 'favorites' ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {{ t('side.favorites') }}
            <span class="count">{{ stats.favorites }}</span>
          </div>
          <div
            class="nav-item"
            role="button"
            tabindex="0"
            :class="{ active: vaultState.currentFilter === 'recycle' }"
            @click="selectFilter('recycle')"
            @keydown="onNavKey($event, 'recycle')"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'recycle' }, { w: 240, h: 140 })"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            {{ t('side.trash') }}
            <span class="count">{{ stats.recycle }}</span>
          </div>
        </nav>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title">{{ t('side.sectionTypes') }}</div>
        <nav id="nav-types" class="nav-types">
          <div
            v-for="type in ENTRY_TYPES"
            :key="type.id"
            class="nav-item"
            role="button"
            tabindex="0"
            :class="[{ active: vaultState.currentFilter === 'type:' + type.id }, 'type-' + type.id]"
            @click="selectFilter('type:' + type.id)"
            @keydown="onNavKey($event, 'type:' + type.id)"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'type', typeId: type.id }, { w: 260, h: 150 })"
          >
            <span class="type-icon" v-html="typeIconSvg(type.id)"></span>
            {{ t(typeLabels[type.id]) }}
            <span class="count">{{ stats.byType[type.id] || 0 }}</span>
          </div>
        </nav>
      </div>

      <div class="sidebar-section">
        <div
          class="sidebar-section-title sidebar-title-clickable"
          id="tags-toggle"
          :title="t('side.hotTagsCollapse')"
          role="button" tabindex="0"
          @click="tagSectionOpen = !tagSectionOpen"
          @keydown.enter.prevent="tagSectionOpen = !tagSectionOpen"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'tag-manage' }, { w: 250, h: 190 })"
        >
          {{ t('side.hotTags') }}
          <svg class="tag-chevron" :style="{ transform: !tagSectionOpen ? 'rotate(-90deg)' : 'rotate(0deg)' }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        <nav id="nav-categories" v-show="tagSectionOpen">
          <div
            v-for="tag in topTags"
            :key="tag.name"
            class="nav-item"
            role="button"
            tabindex="0"
            :class="{ active: vaultState.currentFilter === tag.name }"
            @click="selectFilter(tag.name)"
            @keydown="onNavKey($event, tag.name)"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'tag', name: tag.name }, { w: 260, h: 320 })"
          >
            <span v-html="tagIconSvg(tag.name)"></span>
            {{ tag.name }}
            <span class="count">{{ tag.count }}</span>
          </div>
        </nav>
      </div>
    </div>

    <div class="sidebar-footer">
      <button
        class="btn btn-ghost btn-sm btn-full"
        @click="logout()"
        @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'logout' }, { w: 220, h: 140 })"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        {{ t('side.quit') }}
      </button>
    </div>

    <!-- 侧边栏右键菜单（统一挂 body 避免侧边栏 overflow 裁切） -->
    <CtxMenu :menu="ctxMenu" :items="navCtxItems" :aria-label="t('ctx.ariaLabel')" @action="onCtxAction" />
  </aside>
</template>
