/* ═══════════════════════════════════════════════════════════════════
   LockPass — 全局微交互（按钮涟漪）
   pointerdown 委托：在可点击控件上生成涟漪圆，让每个操作都有即时触觉反馈。
   - 仅作用于按钮 / 图标按钮 / 列表操作钮 / 菜单项等交互控件；
   - 样式（.ripple-ink 与 position/overflow 加固）在 styles/ux-enhance.css；
   - prefers-reduced-motion 下整体禁用（无障碍优先）；
   - 被动监听，不阻塞主线程滚动。
   ═══════════════════════════════════════════════════════════════════ */

const RIPPLE_SELECTOR = [
  '.btn', '.btn-icon', '.tabbar-add', '.tabbar-item',
  '.restore-btn', '.star-btn', '.copy-btn', '.delete-btn',
  '.search-clear-btn', '.ctx-item',
].join(', ')

const RIPPLE_MS = 460

export function installMicroInteractions() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  } catch (e) { /* 忽略探测失败，默认启用 */ }

  document.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target && e.target.closest ? e.target.closest(RIPPLE_SELECTOR) : null
      if (!target) return
      // 禁用态不播反馈
      if (target.disabled || target.hasAttribute?.('disabled')) return
      const rect = target.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const size = Math.max(rect.width, rect.height) * 2.4
      const span = document.createElement('span')
      span.className = 'ripple-ink'
      span.style.width = span.style.height = `${size}px`
      span.style.left = `${e.clientX - rect.left - size / 2}px`
      span.style.top = `${e.clientY - rect.top - size / 2}px`
      target.appendChild(span)
      // 动画结束后移除（菜单项点击即卸载时由 DOM 回收兜底）
      setTimeout(() => span.remove(), RIPPLE_MS + 60)
    },
    { passive: true },
  )
}
