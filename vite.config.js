import { defineConfig } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

// ═══════════════════════════════════════════════════════════════════
// LockPass Vue 构建 — 统一外置资源产物
// ───────────────────────────────────────────────────────────────────
// 版本号单一来源：package.json（打包源 src-tauri/tauri.conf.json 由
// scripts/bump-version.mjs 同步）。构建期注入：
//   __APP_VERSION__     → 'vX.Y.Z'（SW 缓存名、打包版本）
//   __LOCKPASS_VERSION__ → 'X.Y.Z'（core/version.js 运行版本）
// 源码（core/version.js / public/sw.js）不再写死版本号。
//
// 所有构建（vite build）统一走 rollup iife 单 chunk 产物：
//   - JS 外置到 dist/assets/js/，CSS 外置到 dist/assets/css/，
//     产物结构清晰、便于审查
//   - iife（非 module script）在 file:// 下可被 Chrome 加载，
//     不触发 module 脚本的 CORS 拦截，双击 index.html 可用
//   - GitHub Pages 子路径部署
//   - Tauri 桌面打包（frontendDist 指向 ../dist）
// 不再区分 dist / dist-tauri，也不再内联单文件。
// ═══════════════════════════════════════════════════════════════════

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const APP_VERSION = 'v' + pkg.version

// 构建时把 public/sw.js 的 CACHE_NAME 占位符替换为真实版本
// （public 目录文件不经过 vite 编译，只能在写盘后注入）
function injectSwVersion(outDir) {
  return {
    name: 'lockpass-inject-sw-version',
    writeBundle() {
      const swPath = resolve(import.meta.dirname, outDir, 'sw.js')
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

// 构建后把 index.html 的 `<script type="module" crossorigin src=...>` 降级为普通
// `<script src=...>`：产物为 iife（无 import/export），普通脚本在 file:// 下可被
// Chrome 加载，而 module 脚本受 CORS 限制（origin 'null'）会被拦截。
function demoteModuleScripts() {
  return {
    name: 'lockpass-demote-module-scripts',
    closeBundle() {
      const htmlPath = resolve(import.meta.dirname, 'dist/index.html')
      try {
        const html = readFileSync(htmlPath, 'utf8')
        const out = html.replace(
          /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
          '<script defer src="$1"></script>',
        )
        if (out !== html) writeFileSync(htmlPath, out)
      } catch {
        // 忽略：未生成 html 时跳过
      }
    },
  }
}

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [vue(), injectSwVersion('dist'), demoteModuleScripts()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // iife（非 module）：file:// 下可加载，避免 module script 的 CORS 拦截
        // （移除 inlineDynamicImports：源码已无动态 import，codeSplitting 默认 false 已单 chunk）
        format: 'iife',
        entryFileNames: 'assets/js/[name].js',
        assetFileNames: 'assets/[ext]/[name][extname]',
      },
    },
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
  // 生产构建移除 console.debug / console.log（保留 console.error / console.warn）
  // 密码管理器应最小化控制台输出
  esbuild: {
    pure: ['console.debug', 'console.log'],
  },
})
