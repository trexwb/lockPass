/* ═══════════════════════════════════════════════════════════════════
   LockPass — 全局右键守卫
   需求：取消 HTML 默认右键内容；能加右键逻辑的地方一律使用自定义菜单。
   策略：
   - capture 阶段全局 preventDefault，彻底屏蔽浏览器原生上下文菜单；
   - 组件自定义右键（@contextmenu.prevent.stop）不受影响：capture 阶段
     preventDefault 只禁止默认菜单，事件仍继续派发到目标节点；
   - 输入类元素（input / textarea / [contenteditable]）放行原生菜单，
     保留粘贴、拼写检查等编辑能力（密码输入场景高频依赖粘贴）；
   - 必须在 Vue 挂载前同步安装，保证首帧起即无原生右键。
   ═══════════════════════════════════════════════════════════════════ */

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]'

export function installContextMenuGuard() {
  document.addEventListener(
    'contextmenu',
    (e) => {
      const t = e.target
      // 输入区保留原生菜单（粘贴/拷贝/拼写），其余一律禁用默认右键
      if (t && t.closest && t.closest(EDITABLE_SELECTOR)) return
      e.preventDefault()
    },
    { capture: true },
  )
}
