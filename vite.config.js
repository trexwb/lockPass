import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// LockPass Vue 迁移 — Vite 双产物构建
// mode=single 时产出 dist-single/index.html 单文件（浏览器双击即用）
export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  const plugins = [vue()]
  if (single) plugins.push(viteSingleFile())

  return {
    root: 'src',
    base: './',
    plugins,
    build: {
      outDir: single ? '../dist-single' : '../dist',
      emptyOutDir: true,
      assetsInlineLimit: single ? 100000000 : 4096,
      chunkSizeWarningLimit: 1500,
    },
    server: {
      port: 1420,
      strictPort: true,
    },
    define: {
      // 版本号收敛单一来源：由 bump-version.mjs 维护此处
      __APP_VERSION__: JSON.stringify('v1.0.15'),
    },
  }
})
