import { reactive, ref } from 'vue'

/**
 * useSwipeActions — 条目卡片列表的左滑显示操作手势
 *
 * 交互模型（iOS Reminders / Gmail 风格）：
 * - 每张卡片独立维护拖拽状态（按 entryId 索引）
 * - 手指左滑时，前景内容层跟随位移 → 露出背景操作层
 * - 松手时：超阈值（默认 ACTIONS_WIDTH 一半）则吸附打开；否则回弹关闭
 * - 互斥：打开卡片 A 时自动关闭卡片 B；点击空白处 / 垂直滚动时自动收起
 * - 快速闭合：右滑已打开的卡片（不需要超过阈值）直接关闭
 *
 * @param {Object} options
 * @param {number} [options.actionsWidth=156] - 操作层展开宽度（px），3 个 44px 按钮 + 左右内边距 12*2
 * @param {number} [options.openThresholdRatio=0.35] - 打开阈值占 actionsWidth 的比例
 * @returns {{ swipeState: Map-like object, getCardStyle: Function, cardTouchHandlers: Function, closeAll: Function, openCard: Function, closeCard: Function }}
 */
export function useSwipeActions({ actionsWidth = 156, openThresholdRatio = 0.35 } = {}) {
  // 每张卡片的位移量（px，负数表示向左滑）
  const offsetMap = reactive({})
  // 拖拽态（手指尚未松开，拖拽中跟随手指；松手后回到 CSS transition 控制）
  const draggingMap = reactive({})

  // 当前打开的卡片 id（同一时刻最多一张），用于互斥
  const _openId = ref(null)

  let _startX = 0
  let _startY = 0
  let _startOffset = 0 // 起始时卡片已有位移（已打开的卡片再拖）
  let _locked = false // false=未决定方向, 'h'=水平手势锁定（进行卡片拖拽）, 'v'=垂直滚动锁定
  let _activeId = null

  const openThreshold = actionsWidth * openThresholdRatio

  /** 生成 card 的 style（transform + transition） */
  function getCardStyle(id) {
    const offset = offsetMap[id] || 0
    if (!offset) return null
    const dragging = draggingMap[id]
    return {
      transform: `translateX(${offset}px)`,
      transition: dragging ? 'none' : 'transform 0.32s var(--ease-out-quart)',
    }
  }

  /** 关闭所有已打开的卡片 */
  function closeAll(exceptId = null) {
    Object.keys(offsetMap).forEach(k => {
      if (k !== String(exceptId) && offsetMap[k] !== 0) {
        offsetMap[k] = 0
        delete draggingMap[k]
      }
    })
    if (_openId.value && String(_openId.value) !== String(exceptId)) _openId.value = null
  }

  /** 关闭指定卡片 */
  function closeCard(id) {
    offsetMap[id] = 0
    delete draggingMap[id]
    if (String(_openId.value) === String(id)) _openId.value = null
  }

  /** 打开指定卡片（吸附到 actionsWidth） */
  function openCard(id) {
    // 互斥：关掉其他
    Object.keys(offsetMap).forEach(k => {
      if (k !== String(id) && offsetMap[k] !== 0) offsetMap[k] = 0
    })
    offsetMap[id] = -actionsWidth
    _openId.value = id
  }

  /* ── 单个卡片的触摸处理（由模板调用，传入 entryId） ──────────────────── */
  function cardTouchHandlers(id, isEnabled = () => true) {
    return {
      onTouchstart(e) {
        if (!isEnabled()) return
        if (e.touches.length !== 1) return
        _activeId = id
        _startX = e.touches[0].clientX
        _startY = e.touches[0].clientY
        _startOffset = offsetMap[id] || 0
        _locked = false
        // 起始就关闭其它已打开的卡片（互斥）
        if (_openId.value && String(_openId.value) !== String(id)) {
          closeAll(id)
        }
      },
      onTouchmove(e) {
        if (!_activeId || String(_activeId) !== String(id)) return
        if (!isEnabled()) return
        if (e.touches.length !== 1) return

        const dx = e.touches[0].clientX - _startX
        const dy = e.touches[0].clientY - _startY

        if (!_locked) {
          if (Math.abs(dx) > Math.abs(dy) + 6) {
            _locked = 'h'
            draggingMap[id] = true
          } else if (Math.abs(dy) > Math.abs(dx) + 6) {
            _locked = 'v'
            // 垂直滚动优先：若有卡片打开则顺带关闭
            if (_openId.value) closeAll()
            return
          } else {
            return
          }
        }
        if (_locked !== 'h') return

        // 计算目标位移：左滑为负
        let target = _startOffset + dx
        // 边界钳制：不能向右滑超过 0；向左滑不超过 actionsWidth 的 120%（留少量"橡皮筋"手感）
        const min = -actionsWidth * 1.2
        const max = 0
        if (target > max) {
          // 已闭合的卡片右滑 → 橡皮筋越往右越重
          target = max - Math.sqrt(max - target) * 0.6
        } else if (target < min) {
          target = min + Math.sqrt(target - min) * 0.6
        }
        offsetMap[id] = target
      },
      onTouchend() {
        if (!_activeId || String(_activeId) !== String(id)) return
        const current = offsetMap[id] || 0
        delete draggingMap[id]

        // 判定吸附方向
        let shouldOpen = false
        if (current < -openThreshold) shouldOpen = true
        // 快速滑动（>200px/s 且方向正确）也触发
        // （此处简化为阈值判定，避免引入额外 startTime 复杂度）

        if (shouldOpen) {
          offsetMap[id] = -actionsWidth
          _openId.value = id
        } else {
          offsetMap[id] = 0
          if (String(_openId.value) === String(id)) _openId.value = null
        }
        _activeId = null
        _locked = false
      },
      onTouchcancel() {
        if (!_activeId || String(_activeId) !== String(id)) return
        // 取消时回弹到起始位置（最近的稳态）
        const current = offsetMap[id] || 0
        delete draggingMap[id]
        if (current < -actionsWidth / 2) {
          offsetMap[id] = -actionsWidth
          _openId.value = id
        } else {
          offsetMap[id] = 0
          if (String(_openId.value) === String(id)) _openId.value = null
        }
        _activeId = null
        _locked = false
      },
    }
  }

  return {
    swipeState: offsetMap,
    draggingMap,
    actionsWidth,
    openCardId: _openId,
    getCardStyle,
    cardTouchHandlers,
    closeAll,
    closeCard,
    openCard,
  }
}
