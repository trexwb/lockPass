import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// LockPass Vue 构建 — 单文件统一产物
// viteSingleFile 恒启用：JS/CSS 全量内联进 dist/index.html，
// 产物双击（file://）即可运行，同时 HTTP 部署 / Tauri WebView 完全兼容，
// 不再需要单独的 dist-single。
export default defineConfig({
  root: 'src',
  base: './',
  plugins: [vue(), viteSingleFile()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  define: {
    // 版本号收敛单一来源：由 bump-version.mjs 维护此处
    __APP_VERSION__: JSON.stringify('v1.0.16'),
  },
})
