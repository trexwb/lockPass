/* ═══════════════════════════════════════════════════════════════════
   LockPass — Vue 入口
   ═══════════════════════════════════════════════════════════════════ */

// 核心逻辑层：原样迁移，保持 window.* 挂载，零算法改动
import './core/crypto.js'
import './core/database.js'
import './core/file-store.js'
import './core/file-sync.js'
import './core/generator.js'
import './core/utils.js'
import './core/version.js'
import './core/tauri-bridge.js'
import './core/import-bridge.js'
import './core/related.js'
import './core/sw-register.js'
// 粒子动效（锁屏/工作区背景，暴露 window.LockParticles）
import './core/particles.js'

// 样式（保留原设计令牌，按组件拆分的样式由各 SFC 引入）
import './styles/main.css'

// Vue 应用
import { createApp } from 'vue'
import App from './App.vue'
// 主题初始化必须在 mount 前同步执行：读 localStorage → 设置 data-theme/data-accent，
// 避免首帧以默认深色渲染后跳变（Tauri CSP 不允许内联脚本，故不放 index.html）
import { useTheme } from './composables/useTheme'

useTheme().init()

createApp(App).mount('#app')
