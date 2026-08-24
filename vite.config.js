import { defineConfig } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// ═══════════════════════════════════════════════════════════════════
// LockPass Vue 构建 — 双模式产物
// ───────────────────────────────────────────────────────────────────
// 版本号单一来源：package.json（打包源 src-tauri/tauri.conf.json 由
// scripts/bump-version.mjs 同步）。构建期注入：
//   __APP_VERSION__     → 'vX.Y.Z'（SW 缓存名、打包版本）
//   __LOCKPASS_VERSION__ → 'X.Y.Z'（core/version.js 运行版本）
// 源码（core/version.js / public/sw.js）不再写死版本号。
//
// 默认（npm run vite:build）：viteSingleFile 单文件内联，
// JS/CSS 全量内联进 dist/index.html，产物双击（file://）即可运行，
// 同时适配 GitHub Pages 子路径部署。
// tauri 模式（npm run vite:build:tauri，vite build --mode tauri）：
// 关闭单文件内联，产出外部 JS/CSS 资源，配合 tauri.conf.json 的
// 严格 CSP（script-src 'self'，无 unsafe-inline）在桌面 WebView 运行。
// ═══════════════════════════════════════════════════════════════════

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const APP_VERSION = 'v' + pkg.version

// 构建时把 public/sw.js 的 CACHE_NAME 占位符替换为真实版本
// （public 目录文件不经过 vite 编译，只能在写盘后注入）
function injectSwVersion() {
  return {
    name: 'lockpass-inject-sw-version',
    writeBundle() {
      const swPath = resolve(import.meta.dirname, 'dist/sw.js')
      try {
        const raw = readFileSync(swPath, 'utf8')
        const out = raw.replace(/lockpass-__APP_VERSION__/g, `lockpass-${APP_VERSION}`)
        if (out !== raw) writeFileSync(swPath, out)
      } catch {
        // 忽略：public 未复制时跳过
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const singleFile = mode !== 'tauri'
  return {
    root: 'src',
    base: './',
    plugins: [vue(), injectSwVersion(), ...(singleFile ? [viteSingleFile()] : [])],
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
      // 版本号单一来源注入：升级只改 package.json / tauri.conf.json
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      __LOCKPASS_VERSION__: JSON.stringify(pkg.version),
    },
  }
})
