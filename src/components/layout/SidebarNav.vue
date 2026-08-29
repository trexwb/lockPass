<script setup>
/* LockPass — 侧边栏（添加 / 个人筛选 / 类型筛选 / 热门标签 / 退出）
   v1.0.32：为每一个可交互的导航项补充右键菜单，
   包括：个人筛选（全部/收藏/回收站）、类型筛选、热门标签。 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useVault, vaultState, ENTRY_TYPES } from '../../composables/useVault'
import { useCtxMenu } from '../../composables/useCtxMenu'
import CtxMenu from '../common/CtxMenu.vue'

const Icons = window.Utils?.SvgIcons

const {
  setFilter, openEntryModal, openModal, computeSidebarStats, getTopTags, logout,
  saveVault,
} = useVault()

const addDropdownOpen = ref(false)
const tagSectionOpen = ref((() => { try { return localStorage.getItem('lockpass_tags_collapsed') !== '1' } catch (e) { return true } })())

const stats = computed(() => computeSidebarStats())
const topTags = computed(() => getTopTags(8))

const typeLabels = {
  website: '网站', server: '服务器', database: '数据库', ai: 'AI', app: '应用', other: '其他',
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
      list.push({ key: 'jump', label: '切换到该分组', iconHtml: Icons?.grid(14), accent: true })
      if (f === 'favorites') {
        list.push({ key: 'clear-fav', label: '清空全部收藏（保留条目）', iconHtml: Icons?.starOutline(14) })
      }
      list.push({ divider: true })
      list.push({ key: 'new-entry', label: '在该分组下新建条目', iconHtml: Icons?.edit(14) })
      return list
    }
    case 'recycle': {
      const n = stats.value.recycle || 0
      list.push({ key: 'jump', label: '切换到回收站', iconHtml: Icons?.trash(14), accent: true })
      list.push({ key: 'empty', label: n ? `清空回收站（${n} 项）` : '清空回收站', iconHtml: Icons?.trash(14), danger: !!n, disabled: !n })
      return list
    }
    case 'type': {
      const t = p.typeId
      list.push({ key: 'jump', label: `仅显示「${typeLabels[t] || t}」类型`, iconHtml: typeIconSvg(t, 14), accent: true })
      list.push({ key: 'new-entry', label: `新建「${typeLabels[t] || t}」类型条目`, iconHtml: Icons?.edit(14) })
      return list
    }
    case 'tag': {
      const name = p.name
      const isDefault = !!vaultState.tagDefs?.[name]?.isDefault
      list.push({ key: 'jump', label: `筛选标签：${name}`, iconHtml: tagIconSvg(name), accent: true })
      list.push({ key: 'rename', label: '重命名标签', iconHtml: Icons?.edit(14), disabled: isDefault, title: isDefault ? '系统默认标签不允许重命名' : '' })
      list.push({ key: 'open-tags', label: '修改颜色 / 图标', iconHtml: Icons?.palette(14) })
      list.push({ key: 'dup-tag', label: '复制标签（快速建新）', iconHtml: Icons?.copy(14) })
      list.push({ divider: true })
      list.push({ key: 'strip', label: '从所有条目移除该标签', iconHtml: Icons?.refresh(14), disabled: isDefault })
      list.push({ key: 'merge', label: '合并到另一标签…', iconHtml: Icons?.merge(14), disabled: isDefault })
      list.push({ key: 'delete', label: '删除该标签（连同从条目移除）', iconHtml: Icons?.trash(14), danger: true, disabled: isDefault })
      return list
    }
    case 'add': {
      list.push({ key: 'new', label: '新建密码', iconHtml: Icons?.key(14), accent: true })
      list.push({ key: 'qr-import', label: '二维码添加', iconHtml: Icons?.qr(14) })
      list.push({ key: 'import', label: '批量导入 (.vault/.csv)', iconHtml: Icons?.upload(14) })
      return list
    }
    case 'logout': {
      list.push({ key: 'lock', label: '立即锁定（不清会话）', iconHtml: Icons?.lock(14) })
      list.push({ key: 'logout', label: '退出登录', iconHtml: Icons?.logoutIcon(14), danger: true })
      return list
    }
    case 'tag-manage': {
      const custom = Object.keys(vaultState.tagDefs || {}).filter(n => !vaultState.tagDefs[n]?.isDefault)
      list.push({ key: 'open', label: '打开标签管理', iconHtml: Icons?.palette(14), accent: true })
      list.push({ key: 'new-tag', label: '新建标签', iconHtml: Icons?.tag(14) })
      list.push({ divider: true })
      list.push({ key: 'expand', label: '展开标签区', iconHtml: Icons?.refresh(14), disabled: tagSectionOpen.value })
      list.push({ key: 'clear-custom', label: `删除全部自定义标签（${custom.length} 个）`, iconHtml: Icons?.trash(14), danger: true, disabled: !custom.length })
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
      title: '清空全部收藏？',
      message: `将对 ${n} 条收藏条目取消星标，条目本身保留，该操作不可撤销，是否继续？`,
      confirmText: '全部取消收藏',
      cancelText: '取消',
    })
    if (!ok) return
    vaultState.entries.forEach(e => { if (e.favorite) e.favorite = false })
    await saveVault()
    window.Utils.showToast(`已清空收藏（${n} 条）`, 'success')
  }
}

async function handleType(action, typeId) {
  if (action === 'jump') { selectFilter('type:' + typeId); return }
  if (action === 'new-entry') {
    openEntryModal()
    // 通过草稿预选类型（EntryEditor 打开后会读取 lockpass_draft_new）
    try {
      const cur = JSON.parse(sessionStorage.getItem('lockpass_draft_new') || '{}')
      cur.type = typeId
      if (!cur.fields) cur.fields = {}
      sessionStorage.setItem('lockpass_draft_new', JSON.stringify(cur))
    } catch (_e) {}
    window.Utils.showToast(`已预选类型：${typeLabels[typeId] || typeId}（可在编辑器更改）`, 'info')
  }
}

async function handleTag(action, name) {
  if (action === 'jump') { selectFilter(name); return }
  if (action === 'open-tags') { openModal('tags'); return }
  if (action === 'rename') {
    const def = vaultState.tagDefs[name]
    if (!def || def.isDefault) return
    const newName = await window.Utils.prompt({
      title: '重命名标签',
      message: `将标签「${name}」改名为：`,
      value: name,
      confirmText: '重命名',
    })?.trim()
    if (!newName || newName === name) return
    if (vaultState.tagDefs[newName]) {
      window.Utils.showToast('已存在同名标签，请改用「合并到另一标签」', 'error')
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
    window.Utils.showToast(`已重命名「${name}」→「${newName}」`, 'success')
    return
  }
  if (action === 'dup-tag') {
    const def = vaultState.tagDefs[name] || {}
    let idx = 1
    let cand = `${name} 副本`
    while (vaultState.tagDefs[cand]) { idx++; cand = `${name} 副本 ${idx}` }
    vaultState.tagDefs[cand] = {
      color: def.color || window.Utils.getRandomTagAttrs(vaultState.tagDefs).color,
      icon: def.icon || 'other',
      isDefault: false,
    }
    await saveVault()
    window.Utils.showToast(`已新增标签：${cand}`, 'success')
    return
  }
  if (action === 'strip' || action === 'delete') {
    const def = vaultState.tagDefs[name]
    if (!def || def.isDefault) return
    const count = (stats.value.byTag || {})[name] || 0
    const msg = action === 'strip'
      ? `将从所有 ${count} 条条目中移除「${name}」标签，标签本身保留。`
      : `将删除「${name}」标签，并从全部 ${count} 条条目中移除。`
    const ok = await window.Utils.confirm({
      title: action === 'strip' ? '移除该标签？' : '删除该标签？',
      message: msg + '\n该操作不可撤销，是否继续？',
      confirmText: action === 'strip' ? '确认移除' : '确认删除',
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
    window.Utils.showToast(action === 'strip' ? '已从条目移除该标签' : '已删除该标签', 'success')
    return
  }
  if (action === 'merge') {
    const def = vaultState.tagDefs[name]
    if (!def || def.isDefault) return
    const others = Object.keys(vaultState.tagDefs).filter(n => n !== name)
    if (!others.length) { window.Utils.showToast('没有可合并的目标标签', 'warning'); return }
    const target = await window.Utils.prompt({
      title: '合并标签',
      message: '将「' + name + '」合并到目标标签（现有条目同时拥有的会去重）：\n\n可选：' + others.join('、'),
      value: others[0],
      confirmText: '合并',
    })?.trim()
    if (!target || target === name) return
    if (!vaultState.tagDefs[target]) { window.Utils.showToast('目标标签不存在', 'error'); return }
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
    window.Utils.showToast(`已将「${name}」合并到「${target}」`, 'success')
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
      title: '清空回收站？',
      message: `将永久删除 ${n} 项密码且不可恢复，是否继续？`,
      confirmText: '清空',
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
    window.Utils.showToast('回收站已清空', 'success')
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
    window.Utils.showToast('在标签管理中点击「新建标签」即可添加', 'info')
    return
  }
  if (action === 'expand') { tagSectionOpen.value = true; return }
  if (action === 'clear-custom') {
    const custom = Object.keys(vaultState.tagDefs || {}).filter(n => !vaultState.tagDefs[n]?.isDefault)
    if (!custom.length) return
    const ok = await window.Utils.confirm({
      title: '删除全部自定义标签？',
      message: `将删除 ${custom.length} 个自定义标签（${custom.join('、')}），并从所有条目中移除；系统默认标签保留。该操作不可撤销，是否继续？`,
      confirmText: '全部删除',
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
    window.Utils.showToast(`已删除 ${custom.length} 个自定义标签`, 'success')
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
  <aside id="sidebar" :class="{ open: vaultState.sidebarOpen }">
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
            添加密码
          </button>
          <button class="btn btn-primary btn-dropdown-toggle" aria-label="更多添加方式" title="更多添加方式"
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
              二维码添加
            </button>
            <button @click="openModal('import'); addDropdownOpen = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              批量导入
            </button>
          </div>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title">个人</div>
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
            全部密码
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
            收藏
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
            回收站
            <span class="count">{{ stats.recycle }}</span>
          </div>
        </nav>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title">类型筛选</div>
        <nav id="nav-types" class="nav-types">
          <div
            v-for="t in ENTRY_TYPES"
            :key="t.id"
            class="nav-item"
            role="button"
            tabindex="0"
            :class="[{ active: vaultState.currentFilter === 'type:' + t.id }, 'type-' + t.id]"
            @click="selectFilter('type:' + t.id)"
            @keydown="onNavKey($event, 'type:' + t.id)"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'type', typeId: t.id }, { w: 260, h: 150 })"
          >
            <span class="type-icon" v-html="typeIconSvg(t.id)"></span>
            {{ typeLabels[t.id] }}
            <span class="count">{{ stats.byType[t.id] || 0 }}</span>
          </div>
        </nav>
      </div>

      <div class="sidebar-section">
        <div
          class="sidebar-section-title sidebar-title-clickable"
          id="tags-toggle"
          title="折叠/展开热门标签"
          role="button" tabindex="0"
          @click="tagSectionOpen = !tagSectionOpen"
          @keydown.enter.prevent="tagSectionOpen = !tagSectionOpen"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'tag-manage' }, { w: 250, h: 190 })"
        >
          热门标签
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
        退出
      </button>
    </div>

    <!-- 侧边栏右键菜单（统一挂 body 避免侧边栏 overflow 裁切） -->
    <CtxMenu :menu="ctxMenu" :items="navCtxItems" aria-label="侧边栏快捷操作" @action="onCtxAction" />
  </aside>
</template>
