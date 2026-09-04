/* ═══════════════════════════════════════════════════════════════════
   LockPass — Vue 入口
   ═══════════════════════════════════════════════════════════════════ */

// 引导标记必须最先同步设置（Rust 冷启动自愈探针依赖此信号）
import './core/boot-flag.js'
// Tauri 环境统一探测（其余模块依赖 window.LockTauri 判定）
import './core/tauri-env.js'
// 自动更新（桌面版专属；依赖 tauri-env + updater 插件）
import './core/updater.js'
// 核心逻辑层：原样迁移，保持 window.* 挂载，零算法改动
import './core/crypto.js'
// A2 修复：双存储显式条件分发（database.js 仅在浏览器挂载 IndexedDB 版；
// file-store.js 仅在 Tauri 挂载文件版）。两模块互斥，不再依赖 import 顺序
// 实现「后挂载覆盖前者」，消除隐式时序耦合。
import './core/database.js'
import './core/file-store.js'
import './core/file-sync.js'
import './core/generator.js'
import './core/utils.js'
import './core/i18n.js'
import './core/version.js'
import './core/tauri-bridge.js'
import './core/passkey-bridge.js'
import './core/import-bridge.js'
import './core/search.js'
import './core/templates.js'
import './core/related.js'
import './core/ext-bridge.js'
import './core/tauri-server-bridge.js'
import './core/backup.js'
import './core/sw-register.js'
// 粒子动效（锁屏/工作区背景，暴露 window.LockParticles）
import './core/particles.js'
// 全局右键守卫：取消浏览器默认右键，统一走自定义菜单（输入框保留原生粘贴菜单）
import { installContextMenuGuard } from './core/contextmenu-guard.js'
// 全局微交互：按钮涟漪等触觉反馈（prefers-reduced-motion 下自动禁用）
import { installMicroInteractions } from './core/micro-interactions.js'

// 样式（保留原设计令牌，按组件拆分的样式由各 SFC 引入）
import './styles/main.css'
// UX 深化增强层（主题过渡/列表编舞/删除离场/模态关闭/涟漪/焦点可见性等）
import './styles/ux-enhance.css'

// Vue 应用
import { createApp } from 'vue'
import App from './App.vue'
// 主题初始化必须在 mount 前同步执行：读 localStorage → 设置 data-theme/data-accent，
// 避免首帧以默认深色渲染后跳变（Tauri CSP 不允许内联脚本，故不放 index.html）
import { useTheme } from './composables/useTheme'

useTheme().init()

// 启动屏（#splash）原本位于 #app 内，mount 会用 App 内容整体替换 #app，
// 导致 splash 瞬间消失。这里先把它移到 <body> 下（脱离 mount 替换范围），
// 再在挂载完成后淡出移除，实现「加载快时至少停留 1s」的平滑过渡。
// 移动是同步 DOM 操作（同帧完成，用户无感知），fixed 定位不受父容器影响。
const splashEl = document.getElementById('splash')
if (splashEl) document.body.appendChild(splashEl)

createApp(App).mount('#app')

// 淡出启动屏：从页面导航开始计时（performance.now 相对 timeOrigin），
// 网络好时 mount 很快，补足到 1s 再淡出；网络慢时已超 1s，立即淡出。
const SPLASH_MIN_MS = 1000
const splashDelay = Math.max(0, SPLASH_MIN_MS - performance.now())
const removeSplash = () => {
  // 彻底消除 splash：DOM 节点与 head 内联样式（含全部 @keyframes / 媒体查询）一并移除，零残留
  const el = document.getElementById('splash')
  if (el) el.remove()
  const styleEl = document.getElementById('splash-style')
  if (styleEl) styleEl.remove()
}
setTimeout(() => {
  const el = document.getElementById('splash')
  if (!el) return
  el.classList.add('splash-exit')
  el.addEventListener('transitionend', removeSplash, { once: true })
  // 兜底：transition 未触发（如 reduced-motion 或浏览器异常）时强制移除
  setTimeout(removeSplash, 500)
}, splashDelay)
