/* ═══════════════════════════════════════════════════════════════════
   LockPass — 通用右键快捷菜单 composable
   用法：
     const { ctxMenu, openCtxMenu, closeCtxMenu, onCtxAction } = useCtxMenu(handler)
   - openCtxMenu(eventClientX, eventClientY, payload, estimatedMenuSize?)
     返回菜单渲染所需的 reactive ctxMenu。
   - onCtxAction(actionKey)：点某项后先 close 再交给业务 handler 处理。
   - 组件模板需在根级插入 <CtxMenu :menu="ctxMenu" @action="onCtxAction">
     或直接按 ctxMenu.visible 渲染 Teleport 菜单。
   - 全局提供菜单位置钳制 + Esc/点击外部/滚动/缩放 自动关闭。
   调用方只负责：提供「菜单项列表」→ 由业务组件通过 computed(ctxMenu.items)
   按 payload 生成。
   ═══════════════════════════════════════════════════════════════════ */

import { reactive, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'

const DEFAULT_MENU_W = 200
const DEFAULT_MENU_H = 260
const EDGE_PAD = 12

/** 注册一个右键菜单实例（每个组件独立一份，防多处叠加冲突） */
export function useCtxMenu(actionHandler) {
  const ctxMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    payload: null,
    origin: 'tl', // 菜单位置锚点象限：tl/tr/bl/br，供 CtxMenu 设置 transform-origin
  })

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {object} payload 业务负载（entry/tag/navFilter/field 等）
   * @param {{ w?: number, h?: number }} sizeHint
   */
  function openCtxMenu(clientX, clientY, payload, sizeHint) {
    const w = sizeHint?.w || DEFAULT_MENU_W
    const h = sizeHint?.h || DEFAULT_MENU_H
    const x = Math.max(EDGE_PAD, Math.min(clientX, window.innerWidth - w - EDGE_PAD))
    const y = Math.max(EDGE_PAD, Math.min(clientY, window.innerHeight - h - EDGE_PAD))
    ctxMenu.x = x
    ctxMenu.y = y
    ctxMenu.origin = `${y + h / 2 >= window.innerHeight / 2 ? 'b' : 't'}${x + w / 2 >= window.innerWidth / 2 ? 'r' : 'l'}`
    ctxMenu.payload = payload || {}
    ctxMenu.visible = true
  }

  function closeCtxMenu() {
    ctxMenu.visible = false
    ctxMenu.payload = null
  }

  /**
   * 统一动作分发：先关闭菜单，交给业务 actionHandler(actionKey, payload)
   * @param {string} action
   */
  function onCtxAction(action) {
    const payload = ctxMenu.payload
    closeCtxMenu()
    if (typeof actionHandler === 'function') {
      try {
        actionHandler(action, payload)
      } catch (e) {
        console.error('[useCtxMenu] action error:', e)
      }
    }
  }

  /**
   * 便捷封装：用于模板 @contextmenu="handleCtxMenu(e, payload)"
   * 注：模板侧不要再用 .prevent.stop 修饰符——这里按场景决定是否阻止默认菜单。
   *    触屏设备 + 可编辑元素（input/textarea/contenteditable）放行原生菜单，
   *    让移动端长按可呼出系统 paste/copy/select 等原生入口；
   *    其余场景（桌面端右键、卡片、标签等）走自定义菜单。
   */
  function handleCtxMenu(e, payload, sizeHint) {
    if (!e) return
    // 触屏 + 可编辑元素：放行原生菜单（含 paste），不弹自定义菜单
    const isTouch = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(hover: none) and (pointer: coarse)').matches
    if (isTouch) {
      const t = e.target
      if (t && t.closest && t.closest('input, textarea, [contenteditable="true"]')) return
    }
    e.preventDefault?.()
    e.stopPropagation?.()
    const x = e.clientX
    const y = e.clientY
    openCtxMenu(x, y, payload, sizeHint)
  }

  /* ── 外部关闭：点击别处 / Esc / 滚动 / 缩放 ──────────────── */

  function onDocMouseDown(e) {
    if (ctxMenu.visible && !e.target?.closest?.('.ctx-menu')) closeCtxMenu()
  }
  function onDocKeydown(e) {
    if (ctxMenu.visible && e.key === 'Escape') {
      e.stopPropagation()
      closeCtxMenu()
    }
  }
  function onDocScrollOrResize() {
    if (ctxMenu.visible) closeCtxMenu()
  }

  const instance = getCurrentInstance()
  // 有组件实例则按生命周期自动绑定；否则不绑（全局单例模式下由调用方自行绑定）
  if (instance) {
    onMounted(() => {
      document.addEventListener('mousedown', onDocMouseDown)
      document.addEventListener('keydown', onDocKeydown)
      window.addEventListener('scroll', onDocScrollOrResize, { capture: true, passive: true })
      window.addEventListener('resize', onDocScrollOrResize)
    })
    onBeforeUnmount(() => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKeydown)
      window.removeEventListener('scroll', onDocScrollOrResize, { capture: true })
      window.removeEventListener('resize', onDocScrollOrResize)
    })
  }

  return {
    ctxMenu,
    openCtxMenu,
    closeCtxMenu,
    onCtxAction,
    handleCtxMenu,
  }
}
