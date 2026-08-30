/* ═══════════════════════════════════════════════════════════════════
   LockPass — 快捷键管理（Vue 3 迁移）
   复刻原生 src/js/shortcuts.js 的 27 项快捷键定义与统一分发逻辑。
   键位约定与原生一致：优先 Alt/Option 组合，避开浏览器保留快捷键。
   ═══════════════════════════════════════════════════════════════════ */

import { onMounted, onBeforeUnmount } from 'vue'
import { useVault, vaultState } from './useVault'

/** i18n 简写：延迟取 window.I18n（core/i18n 先于组件加载） */
const t = (key, params) => (window.I18n ? window.I18n.t(key, params) : key)

/**
 * 快捷键定义表（与原生 SHORTCUT_DEFS 一致，run 改为调用 Vue composable）
 * test(ctx)：命中判定；run(ctx)：执行动作
 */
export function buildShortcutDefs() {
  const {
    setFilter, openEntryModal, openModal, lockVault, logout,
    toggleFavorite, copyPassword, copyField, editCurrentEntry,
    toggleDetailPassword, softDelete, permanentDelete, restoreEntry,
    emptyRecycleBin, closeModal, closeDetail, getEntryById,
    getFilteredEntries, selectEntry,
  } = useVault()

  return [
    {
      id: 'search', nameKey: 'shortcuts.search.name', name: t('shortcuts.search.name'), mac: '⌘ + K', win: 'Ctrl + K',
      whenKey: 'shortcuts.search.when', descKey: 'shortcuts.search.desc',
      when: t('shortcuts.search.when'), desc: t('shortcuts.search.desc'),
      test: ctx => ctx.mod && !ctx.alt && !ctx.shift && ctx.key === 'k',
      run: () => { const el = document.getElementById('global-search'); if (el) el.focus(); },
    },
    {
      id: 'save', nameKey: 'shortcuts.save.name', name: t('shortcuts.save.name'), mac: '⌘ + ↵', win: 'Ctrl + Enter',
      whenKey: 'shortcuts.save.when', descKey: 'shortcuts.save.desc',
      when: t('shortcuts.save.when'), desc: t('shortcuts.save.desc'),
      test: ctx => ctx.modalOpen && ctx.mod && ctx.key === 'enter',
      run: () => { const btn = document.getElementById('entry-editor-save'); if (btn) btn.click(); },
    },
    {
      id: 'new-entry', nameKey: 'shortcuts.new-entry.name', name: t('shortcuts.new-entry.name'), mac: '⌥ + N', win: 'Alt + N',
      whenKey: 'shortcuts.new-entry.when', descKey: 'shortcuts.new-entry.desc',
      when: t('shortcuts.new-entry.when'), desc: t('shortcuts.new-entry.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'n',
      run: () => openEntryModal(),
    },
    {
      id: 'qr-import', nameKey: 'shortcuts.qr-import.name', name: t('shortcuts.qr-import.name'), mac: '⌥ + Q', win: 'Alt + Q',
      whenKey: 'shortcuts.qr-import.when', descKey: 'shortcuts.qr-import.desc',
      when: t('shortcuts.qr-import.when'), desc: t('shortcuts.qr-import.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'q',
      run: () => openModal('qr-import'),
    },
    {
      id: 'import', nameKey: 'shortcuts.import.name', name: t('shortcuts.import.name'), mac: '⌥ + I', win: 'Alt + I',
      whenKey: 'shortcuts.import.when', descKey: 'shortcuts.import.desc',
      when: t('shortcuts.import.when'), desc: t('shortcuts.import.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'i',
      run: () => openModal('import'),
    },
    {
      id: 'export', nameKey: 'shortcuts.export.name', name: t('shortcuts.export.name'), mac: '⌥ + E', win: 'Alt + E',
      whenKey: 'shortcuts.export.when', descKey: 'shortcuts.export.desc',
      when: t('shortcuts.export.when'), desc: t('shortcuts.export.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'e',
      run: () => openModal('export'),
    },
    {
      id: 'tag-manage', nameKey: 'shortcuts.tag-manage.name', name: t('shortcuts.tag-manage.name'), mac: '⌥ + T', win: 'Alt + T',
      whenKey: 'shortcuts.tag-manage.when', descKey: 'shortcuts.tag-manage.desc',
      when: t('shortcuts.tag-manage.when'), desc: t('shortcuts.tag-manage.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 't',
      run: () => openModal('tags'),
    },
    {
      id: 'settings', nameKey: 'shortcuts.settings.name', name: t('shortcuts.settings.name'), mac: '⌘ + ,', win: 'Ctrl + ,',
      whenKey: 'shortcuts.settings.when', descKey: 'shortcuts.settings.desc',
      when: t('shortcuts.settings.when'), desc: t('shortcuts.settings.desc'),
      test: ctx => ctx.mod && !ctx.alt && !ctx.shift && ctx.key === ',',
      run: () => openModal('settings'),
    },
    {
      id: 'lock', nameKey: 'shortcuts.lock.name', name: t('shortcuts.lock.name'), mac: '⌥ + L', win: 'Alt + L',
      whenKey: 'shortcuts.lock.when', descKey: 'shortcuts.lock.desc',
      when: t('shortcuts.lock.when'), desc: t('shortcuts.lock.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'l',
      run: () => lockVault(),
    },
    {
      id: 'logout', nameKey: 'shortcuts.logout.name', name: t('shortcuts.logout.name'), mac: '⌥ + ⇧ + L', win: 'Alt + Shift + L',
      whenKey: 'shortcuts.logout.when', descKey: 'shortcuts.logout.desc',
      when: t('shortcuts.logout.when'), desc: t('shortcuts.logout.desc'),
      test: ctx => ctx.alt && ctx.shift && ctx.key === 'l',
      run: () => logout(),
    },
    {
      id: 'filter-all', nameKey: 'shortcuts.filter-all.name', name: t('shortcuts.filter-all.name'), mac: '⌥ + A', win: 'Alt + A',
      whenKey: 'shortcuts.filter-all.when', descKey: 'shortcuts.filter-all.desc',
      when: t('shortcuts.filter-all.when'), desc: t('shortcuts.filter-all.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'a',
      run: () => setFilter('all'),
    },
    {
      id: 'filter-fav', nameKey: 'shortcuts.filter-fav.name', name: t('shortcuts.filter-fav.name'), mac: '⌥ + F', win: 'Alt + F',
      whenKey: 'shortcuts.filter-fav.when', descKey: 'shortcuts.filter-fav.desc',
      when: t('shortcuts.filter-fav.when'), desc: t('shortcuts.filter-fav.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'f',
      run: ctx => {
        if (ctx.detailOpen && ctx.selectedId) toggleFavorite(ctx.selectedId)
        else setFilter('favorites')
      },
    },
    {
      id: 'filter-recycle', nameKey: 'shortcuts.filter-recycle.name', name: t('shortcuts.filter-recycle.name'), mac: '⌥ + R', win: 'Alt + R',
      whenKey: 'shortcuts.filter-recycle.when', descKey: 'shortcuts.filter-recycle.desc',
      when: t('shortcuts.filter-recycle.when'), desc: t('shortcuts.filter-recycle.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'r',
      run: () => setFilter('recycle'),
    },
    {
      id: 'filter-type-1', nameKey: 'shortcuts.filter-type-1.name', name: t('shortcuts.filter-type-1.name'), mac: '⌥ + 1', win: 'Alt + 1',
      whenKey: 'shortcuts.filter-type-1.when', descKey: 'shortcuts.filter-type-1.desc',
      when: t('shortcuts.filter-type-1.when'), desc: t('shortcuts.filter-type-1.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '1',
      run: () => setFilter('type:website'),
    },
    {
      id: 'filter-type-2', nameKey: 'shortcuts.filter-type-2.name', name: t('shortcuts.filter-type-2.name'), mac: '⌥ + 2', win: 'Alt + 2',
      whenKey: 'shortcuts.filter-type-2.when', descKey: 'shortcuts.filter-type-2.desc',
      when: t('shortcuts.filter-type-2.when'), desc: t('shortcuts.filter-type-2.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '2',
      run: () => setFilter('type:server'),
    },
    {
      id: 'filter-type-3', nameKey: 'shortcuts.filter-type-3.name', name: t('shortcuts.filter-type-3.name'), mac: '⌥ + 3', win: 'Alt + 3',
      whenKey: 'shortcuts.filter-type-3.when', descKey: 'shortcuts.filter-type-3.desc',
      when: t('shortcuts.filter-type-3.when'), desc: t('shortcuts.filter-type-3.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '3',
      run: () => setFilter('type:database'),
    },
    {
      id: 'filter-type-4', nameKey: 'shortcuts.filter-type-4.name', name: t('shortcuts.filter-type-4.name'), mac: '⌥ + 4', win: 'Alt + 4',
      whenKey: 'shortcuts.filter-type-4.when', descKey: 'shortcuts.filter-type-4.desc',
      when: t('shortcuts.filter-type-4.when'), desc: t('shortcuts.filter-type-4.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '4',
      run: () => setFilter('type:ai'),
    },
    {
      id: 'filter-type-5', nameKey: 'shortcuts.filter-type-5.name', name: t('shortcuts.filter-type-5.name'), mac: '⌥ + 5', win: 'Alt + 5',
      whenKey: 'shortcuts.filter-type-5.when', descKey: 'shortcuts.filter-type-5.desc',
      when: t('shortcuts.filter-type-5.when'), desc: t('shortcuts.filter-type-5.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '5',
      run: () => setFilter('type:app'),
    },
    {
      id: 'filter-type-6', nameKey: 'shortcuts.filter-type-6.name', name: t('shortcuts.filter-type-6.name'), mac: '⌥ + 6', win: 'Alt + 6',
      whenKey: 'shortcuts.filter-type-6.when', descKey: 'shortcuts.filter-type-6.desc',
      when: t('shortcuts.filter-type-6.when'), desc: t('shortcuts.filter-type-6.desc'),
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '6',
      run: () => setFilter('type:other'),
    },
    {
      id: 'edit-entry', nameKey: 'shortcuts.edit-entry.name', name: t('shortcuts.edit-entry.name'), mac: '⌥ + ⇧ + E', win: 'Alt + Shift + E',
      whenKey: 'shortcuts.edit-entry.when', descKey: 'shortcuts.edit-entry.desc',
      when: t('shortcuts.edit-entry.when'), desc: t('shortcuts.edit-entry.desc'),
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.alt && ctx.shift && ctx.key === 'e',
      run: () => editCurrentEntry(),
    },
    {
      id: 'copy-password', nameKey: 'shortcuts.copy-password.name', name: t('shortcuts.copy-password.name'), mac: '⌥ + C', win: 'Alt + C',
      whenKey: 'shortcuts.copy-password.when', descKey: 'shortcuts.copy-password.desc',
      when: t('shortcuts.copy-password.when'), desc: t('shortcuts.copy-password.desc'),
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.alt && !ctx.shift && ctx.key === 'c',
      run: ctx => copyPassword(ctx.selectedId),
    },
    {
      id: 'copy-username', nameKey: 'shortcuts.copy-username.name', name: t('shortcuts.copy-username.name'), mac: '⌥ + U', win: 'Alt + U',
      whenKey: 'shortcuts.copy-username.when', descKey: 'shortcuts.copy-username.desc',
      when: t('shortcuts.copy-username.when'), desc: t('shortcuts.copy-username.desc'),
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.alt && !ctx.shift && ctx.key === 'u',
      run: ctx => {
        const entry = getEntryById(ctx.selectedId)
        if (entry) copyField(entry.username || '')
      },
    },
    {
      id: 'toggle-pw', nameKey: 'shortcuts.toggle-pw.name', name: t('shortcuts.toggle-pw.name'), mac: '⌥ + P', win: 'Alt + P',
      whenKey: 'shortcuts.toggle-pw.when', descKey: 'shortcuts.toggle-pw.desc',
      when: t('shortcuts.toggle-pw.when'), desc: t('shortcuts.toggle-pw.desc'),
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.alt && !ctx.shift && ctx.key === 'p',
      run: () => toggleDetailPassword(),
    },
    {
      id: 'delete-entry', nameKey: 'shortcuts.delete-entry.name', name: t('shortcuts.delete-entry.name'), mac: '⌘ + ⌫', win: 'Ctrl + Backspace',
      whenKey: 'shortcuts.delete-entry.when', descKey: 'shortcuts.delete-entry.desc',
      when: t('shortcuts.delete-entry.when'), desc: t('shortcuts.delete-entry.desc'),
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.mod && ctx.key === 'backspace',
      run: ctx => {
        if (ctx.isRecycleView) permanentDelete(ctx.selectedId)
        else softDelete(ctx.selectedId)
      },
    },
    {
      id: 'restore-entry', nameKey: 'shortcuts.restore-entry.name', name: t('shortcuts.restore-entry.name'), mac: '⌥ + ⇧ + R', win: 'Alt + Shift + R',
      whenKey: 'shortcuts.restore-entry.when', descKey: 'shortcuts.restore-entry.desc',
      when: t('shortcuts.restore-entry.when'), desc: t('shortcuts.restore-entry.desc'),
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.isRecycleView && ctx.alt && ctx.shift && ctx.key === 'r',
      run: ctx => restoreEntry(ctx.selectedId),
    },
    {
      id: 'empty-recycle', nameKey: 'shortcuts.empty-recycle.name', name: t('shortcuts.empty-recycle.name'), mac: '⌥ + ⇧ + ⌫', win: 'Alt + Shift + Backspace',
      whenKey: 'shortcuts.empty-recycle.when', descKey: 'shortcuts.empty-recycle.desc',
      when: t('shortcuts.empty-recycle.when'), desc: t('shortcuts.empty-recycle.desc'),
      test: ctx => ctx.isRecycleView && ctx.alt && ctx.shift && ctx.key === 'backspace',
      run: () => emptyRecycleBin(),
    },
    {
      id: 'list-nav', nameKey: 'shortcuts.list-nav.name', name: t('shortcuts.list-nav.name'), mac: '↑ / ↓', win: '↑ / ↓',
      whenKey: 'shortcuts.list-nav.when', descKey: 'shortcuts.list-nav.desc',
      when: t('shortcuts.list-nav.when'), desc: t('shortcuts.list-nav.desc'),
      test: ctx => ctx.key === 'arrowdown' || ctx.key === 'arrowup',
      run: () => {}, // 实际分发在 handleKeyboard 中提前拦截处理
    },
    {
      id: 'close', nameKey: 'shortcuts.close.name', name: t('shortcuts.close.name'), mac: 'Esc', win: 'Esc',
      whenKey: 'shortcuts.close.when', descKey: 'shortcuts.close.desc',
      when: t('shortcuts.close.when'), desc: t('shortcuts.close.desc'),
      test: ctx => ctx.key === 'escape',
      run: () => {},
    },
  ]
}

/**
 * 统一键盘分发入口（与原生 handleKeyboard 逻辑一致）
 */
function handleKeyboard(event, defs) {
  if (!vaultState.isUnlocked) return

  // P3-3 修复：navigator.platform 已废弃，优先用 userAgentData，platform 作兜底
  const isMac = (navigator.userAgentData && navigator.userAgentData.platform === 'macOS')
    || /mac/i.test(navigator.platform || '')
  const mod = isMac ? event.metaKey : event.ctrlKey
  const alt = event.altKey
  const shift = event.shiftKey
  const key = (event.key || '').toLowerCase()

  const {
    setFilter, openEntryModal, openModal, lockVault, logout,
    toggleFavorite, copyPassword, copyField, editCurrentEntry,
    toggleDetailPassword, softDelete, permanentDelete, restoreEntry,
    emptyRecycleBin, closeModal, closeDetail,
  } = useVault()

  // ── 上下文收集 ──
  const ae = document.activeElement
  const isTyping = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)
  const modalOpen = !!vaultState.activeModal
  const detailOpen = !!vaultState.selectedEntry
  const selectedId = vaultState.selectedEntry
  const isRecycleView = vaultState.currentFilter === 'recycle'
  const confirmOpen = !!document.querySelector('#confirm-overlay:not(.hidden)')

  // ── Escape：关闭弹窗 → 详情面板 → 清空搜索；confirm 打开时交由其自身处理 ──
  if (key === 'escape') {
    // 配对弹窗可见时 Esc 全权交由 PairRequestModal 处理，避免双监听冲突
    if (document.querySelector('.lp-pair-overlay')) return
    if (confirmOpen) return
    if (modalOpen) {
      event.preventDefault()
      closeModal()
      return
    }
    if (detailOpen) {
      event.preventDefault()
      closeDetail()
      return
    }
    const searchInput = document.getElementById('global-search')
    if (ae === searchInput && searchInput.value) {
      searchInput.value = ''
      vaultState.searchQuery = ''
      event.preventDefault()
    }
    return
  }

  // ── 确认框打开：Enter / ⌘+Enter 独立映射为点击确认按钮 ──
  if (confirmOpen) {
    if (key === 'enter') {
      event.preventDefault()
      const okBtn = document.querySelector('#confirm-overlay .confirm-ok')
      if (okBtn) okBtn.click()
    }
    return
  }

  // ── 弹窗打开：仅允许 ⌘ + Enter 保存 ──
  if (modalOpen) {
    if (mod && key === 'enter') {
      event.preventDefault()
      const btn = document.getElementById('entry-editor-save')
      if (btn) btn.click()
    }
    return
  }

  // ── 输入框聚焦：默认不触发全局快捷键，仅保留 ⌘ + K 搜索 ──
  if (isTyping) {
    if (mod && !alt && !shift && key === 'k') {
      event.preventDefault()
      const el = document.getElementById('global-search')
      if (el) el.focus()
    }
    return
  }

  // ── P2-12 修复：列表键盘导航 ↑/↓ 选择条目（未选中时 ↓ 选首条、↑ 选末条），并滚动到可见 ──
  if (key === 'arrowdown' || key === 'arrowup') {
    event.preventDefault()
    const list = getFilteredEntries()
    if (!list.length) return
    const curIdx = list.findIndex(e => e.id === vaultState.selectedEntry)
    let nextIdx
    if (curIdx === -1) {
      nextIdx = key === 'arrowdown' ? 0 : list.length - 1
    } else {
      nextIdx = key === 'arrowdown' ? Math.min(curIdx + 1, list.length - 1) : Math.max(curIdx - 1, 0)
    }
    const target = list[nextIdx]
    if (target && target.id !== vaultState.selectedEntry) {
      selectEntry(target.id)
      const card = document.querySelector(`.entry-card[data-id="${CSS.escape(target.id)}"]`)
      if (card) card.scrollIntoView({ block: 'nearest' })
    }
    return
  }

  // ── 常规全局快捷键：按定义表分发 ──
  const ctx = { isMac, mod, alt, shift, key, isTyping, modalOpen, detailOpen, isRecycleView, selectedId }
  for (const def of defs) {
    if (def.id === 'close') continue // Escape 已单独处理
    if (def.test(ctx)) {
      event.preventDefault()
      def.run(ctx)
      return
    }
  }
}

/**
 * 初始化快捷键监听（组件挂载时调用一次）
 */
export function useShortcuts() {
  const defs = buildShortcutDefs()

  function onKeydown(e) {
    handleKeyboard(e, defs)
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeydown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
  })

  return { defs }
}
