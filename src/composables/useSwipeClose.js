import { ref } from 'vue'

/**
 * useSwipeClose — 抽屉式面板的水平滑动关闭手势
 *
 * 原理：touchstart 记录起点 → touchmove 判断水平/垂直主导 →
 *       水平主导时锁定为"拖拽"态并跟随手指 → touchend 超阈值则关闭
 *
 * @param {Object} options
 * @param {'left'|'right'} options.direction - 关闭方向：'right'=右滑关闭（右侧抽屉），'left'=左滑关闭（左侧抽屉）
 * @param {number} [options.threshold=80] - 拖拽超过此距离（px）才触发关闭
 * @param {Function} options.onClose - 触发关闭时的回调
 * @param {Function} [options.isEnabled] - 返回 false 时禁用手势（如桌面端非抽屉模式）
 * @returns {{ dragOffset: import('vue').Ref<number>, isDragging: import('vue').Ref<boolean>, handlers: Object }}
 */
export function useSwipeClose({ direction = 'right', threshold = 80, onClose, isEnabled }) {
  const dragOffset = ref(0)
  const isDragging = ref(false)

  let startX = 0
  let startY = 0
  let startTime = 0
  let locked = false // 已锁定为水平拖拽（一旦锁定不再让位于垂直滚动）

  function onTouchStart(e) {
    if (e.touches.length !== 1) return
    if (isEnabled && !isEnabled()) return
    startX = e.touches[0].clientX
    startY = e.touches[0].clientY
    startTime = Date.now()
    locked = false
  }

  function onTouchMove(e) {
    if (e.touches.length !== 1) return
    if (isEnabled && !isEnabled()) return
    const dx = e.touches[0].clientX - startX
    const dy = e.touches[0].clientY - startY

    // 未锁定时：水平位移需超过垂直位移 + 6px 死区才锁定
    if (!locked) {
      if (Math.abs(dx) > Math.abs(dy) + 6) locked = true
      else return // 垂直滚动优先，不干预
    }

    // 锁定后：仅允许关闭方向的位移
    if (direction === 'right' && dx > 0) {
      dragOffset.value = dx
      isDragging.value = true
    } else if (direction === 'left' && dx < 0) {
      dragOffset.value = dx
      isDragging.value = true
    } else {
      dragOffset.value = 0
      isDragging.value = false
    }
  }

  function onTouchEnd() {
    if (!locked) { dragOffset.value = 0; isDragging.value = false; return }

    const dx = Math.abs(dragOffset.value)
    const elapsed = Date.now() - startTime
    const dist = direction === 'right' ? dragOffset.value : -dragOffset.value

    // 关闭条件：拖拽超过阈值，或快速滑动（<300ms）且位移 >40px
    const shouldClose = dist > threshold || (elapsed < 300 && dist > 40)

    dragOffset.value = 0
    isDragging.value = false
    locked = false

    if (shouldClose) onClose()
  }

  return { dragOffset, isDragging, onTouchStart, onTouchMove, onTouchEnd }
}
