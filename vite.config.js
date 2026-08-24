import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// LockPass Vue 构建 — 双模式产物
// 默认（npm run vite:build）：viteSingleFile 单文件内联，
// JS/CSS 全量内联进 dist/index.html，产物双击（file://）即可运行，
// 同时适配 GitHub Pages 子路径部署。
// tauri 模式（npm run vite:build:tauri，vite build --mode tauri）：
// 关闭单文件内联，产出外部 JS/CSS 资源，配合 tauri.conf.json 的
// 严格 CSP（script-src 'self'，无 unsafe-inline）在桌面 WebView 运行。
export default defineConfig(({ mode }) => {
  const singleFile = mode !== 'tauri'
  return {
    root: 'src',
    base: './',
    plugins: [vue(), ...(singleFile ? [viteSingleFile()] : [])],
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      assetsInlineLimit: singleFile ? 100000000 : 4096,
      chunkSizeWarningLimit: 1500,
    },
    server: {
      port: 1420,
      strictPort: true,
    },
    define: {
      // 版本号收敛单一来源：由 bump-version.mjs 维护此处
      __APP_VERSION__: JSON.stringify('v1.0.0'),
    },
  }
})
