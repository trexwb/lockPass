/* ═══════════════════════════════════════════════════════════════════
   LockPass — 快捷键管理（Vue 3 迁移）
   复刻原生 src/js/shortcuts.js 的 27 项快捷键定义与统一分发逻辑。
   键位约定与原生一致：优先 Alt/Option 组合，避开浏览器保留快捷键。
   ═══════════════════════════════════════════════════════════════════ */

import { onMounted, onBeforeUnmount } from 'vue'
import { useVault, vaultState } from './useVault'

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
  } = useVault()

  return [
    {
      id: 'search', name: '快速搜索', mac: '⌘ + K', win: 'Ctrl + K',
      when: '全局（解锁后）', desc: '聚焦搜索框，输入关键词实时筛选密码',
      test: ctx => ctx.mod && !ctx.alt && !ctx.shift && ctx.key === 'k',
      run: () => { const el = document.getElementById('global-search'); if (el) el.focus(); },
    },
    {
      id: 'save', name: '保存当前表单', mac: '⌘ + ↵', win: 'Ctrl + Enter',
      when: '新建/编辑弹窗打开时', desc: '保存新增或编辑中的密码条目',
      test: ctx => ctx.modalOpen && ctx.mod && ctx.key === 'enter',
      run: () => { const btn = document.getElementById('entry-editor-save'); if (btn) btn.click(); },
    },
    {
      id: 'new-entry', name: '新建密码', mac: '⌥ + N', win: 'Alt + N',
      when: '全局（解锁后）', desc: '打开新增密码表单',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'n',
      run: () => openEntryModal(),
    },
    {
      id: 'qr-import', name: '二维码添加', mac: '⌥ + Q', win: 'Alt + Q',
      when: '全局（解锁后）', desc: '打开二维码导入弹窗',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'q',
      run: () => openModal('qr-import'),
    },
    {
      id: 'import', name: '批量导入', mac: '⌥ + I', win: 'Alt + I',
      when: '全局（解锁后）', desc: '打开 CSV 批量导入弹窗',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'i',
      run: () => openModal('import'),
    },
    {
      id: 'export', name: '导出备份', mac: '⌥ + E', win: 'Alt + E',
      when: '全局（解锁后）', desc: '打开导出备份弹窗',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'e',
      run: () => openModal('export'),
    },
    {
      id: 'tag-manage', name: '标签管理', mac: '⌥ + T', win: 'Alt + T',
      when: '全局（解锁后）', desc: '打开标签管理弹窗',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 't',
      run: () => openModal('tags'),
    },
    {
      id: 'settings', name: '打开设置', mac: '⌘ + ,', win: 'Ctrl + ,',
      when: '全局（解锁后）', desc: '打开设置面板',
      test: ctx => ctx.mod && !ctx.alt && !ctx.shift && ctx.key === ',',
      run: () => openModal('settings'),
    },
    {
      id: 'lock', name: '锁定保险箱', mac: '⌥ + L', win: 'Alt + L',
      when: '全局（解锁后）', desc: '锁定并返回解锁界面',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'l',
      run: () => lockVault(),
    },
    {
      id: 'logout', name: '退出登录', mac: '⌥ + ⇧ + L', win: 'Alt + Shift + L',
      when: '全局（解锁后）', desc: '清除会话并退出登录',
      test: ctx => ctx.alt && ctx.shift && ctx.key === 'l',
      run: () => logout(),
    },
    {
      id: 'filter-all', name: '筛选：全部', mac: '⌥ + A', win: 'Alt + A',
      when: '全局（解锁后）', desc: '切换到全部密码列表',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'a',
      run: () => setFilter('all'),
    },
    {
      id: 'filter-fav', name: '筛选：收藏 / 收藏当前', mac: '⌥ + F', win: 'Alt + F',
      when: '全局（解锁后）', desc: '列表视图切换到收藏；详情面板打开时切换当前条目收藏',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'f',
      run: ctx => {
        if (ctx.detailOpen && ctx.selectedId) toggleFavorite(ctx.selectedId)
        else setFilter('favorites')
      },
    },
    {
      id: 'filter-recycle', name: '筛选：回收站', mac: '⌥ + R', win: 'Alt + R',
      when: '全局（解锁后）', desc: '切换到回收站列表',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === 'r',
      run: () => setFilter('recycle'),
    },
    {
      id: 'filter-type-1', name: '筛选：网站', mac: '⌥ + 1', win: 'Alt + 1',
      when: '全局（解锁后）', desc: '筛选网站类型条目',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '1',
      run: () => setFilter('type:website'),
    },
    {
      id: 'filter-type-2', name: '筛选：服务器', mac: '⌥ + 2', win: 'Alt + 2',
      when: '全局（解锁后）', desc: '筛选服务器类型条目',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '2',
      run: () => setFilter('type:server'),
    },
    {
      id: 'filter-type-3', name: '筛选：数据库', mac: '⌥ + 3', win: 'Alt + 3',
      when: '全局（解锁后）', desc: '筛选数据库类型条目',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '3',
      run: () => setFilter('type:database'),
    },
    {
      id: 'filter-type-4', name: '筛选：AI', mac: '⌥ + 4', win: 'Alt + 4',
      when: '全局（解锁后）', desc: '筛选 AI 类型条目',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '4',
      run: () => setFilter('type:ai'),
    },
    {
      id: 'filter-type-5', name: '筛选：应用', mac: '⌥ + 5', win: 'Alt + 5',
      when: '全局（解锁后）', desc: '筛选应用类型条目',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '5',
      run: () => setFilter('type:app'),
    },
    {
      id: 'filter-type-6', name: '筛选：其他', mac: '⌥ + 6', win: 'Alt + 6',
      when: '全局（解锁后）', desc: '筛选其他类型条目',
      test: ctx => ctx.alt && !ctx.shift && ctx.key === '6',
      run: () => setFilter('type:other'),
    },
    {
      id: 'edit-entry', name: '编辑当前条目', mac: '⌥ + ⇧ + E', win: 'Alt + Shift + E',
      when: '详情面板打开时', desc: '打开当前条目的编辑表单',
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.alt && ctx.shift && ctx.key === 'e',
      run: () => editCurrentEntry(),
    },
    {
      id: 'copy-password', name: '复制密码', mac: '⌥ + C', win: 'Alt + C',
      when: '详情面板打开时', desc: '复制当前条目主密码到剪贴板',
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.alt && !ctx.shift && ctx.key === 'c',
      run: ctx => copyPassword(ctx.selectedId),
    },
    {
      id: 'copy-username', name: '复制用户名', mac: '⌥ + U', win: 'Alt + U',
      when: '详情面板打开时', desc: '复制当前条目用户名到剪贴板',
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.alt && !ctx.shift && ctx.key === 'u',
      run: ctx => {
        const entry = getEntryById(ctx.selectedId)
        if (entry) copyField(entry.username || '')
      },
    },
    {
      id: 'toggle-pw', name: '切换密码可见性', mac: '⌥ + P', win: 'Alt + P',
      when: '详情面板打开时', desc: '显示/隐藏当前条目密码',
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.alt && !ctx.shift && ctx.key === 'p',
      run: () => toggleDetailPassword(),
    },
    {
      id: 'delete-entry', name: '删除当前条目', mac: '⌘ + ⌫', win: 'Ctrl + Backspace',
      when: '详情面板打开时', desc: '移入回收站（回收站视图中为彻底删除）',
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.mod && ctx.key === 'backspace',
      run: ctx => {
        if (ctx.isRecycleView) permanentDelete(ctx.selectedId)
        else softDelete(ctx.selectedId)
      },
    },
    {
      id: 'restore-entry', name: '恢复条目', mac: '⌥ + ⇧ + R', win: 'Alt + Shift + R',
      when: '回收站详情打开时', desc: '从回收站恢复当前条目',
      test: ctx => ctx.detailOpen && ctx.selectedId && ctx.isRecycleView && ctx.alt && ctx.shift && ctx.key === 'r',
      run: ctx => restoreEntry(ctx.selectedId),
    },
    {
      id: 'empty-recycle', name: '清空回收站', mac: '⌥ + ⇧ + ⌫', win: 'Alt + Shift + Backspace',
      when: '回收站视图', desc: '永久删除回收站全部条目（需二次确认）',
      test: ctx => ctx.isRecycleView && ctx.alt && ctx.shift && ctx.key === 'backspace',
      run: () => emptyRecycleBin(),
    },
    {
      id: 'close', name: '关闭/返回', mac: 'Esc', win: 'Esc',
      when: '全局（解锁后）', desc: '关闭弹窗/详情面板，或清空搜索',
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

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
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
