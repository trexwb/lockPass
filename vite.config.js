import { defineConfig } from 'vite'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
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
// 同时剥掉 stylesheet link 的 crossorigin：file:// 下 CORS 模式的样式请求会被
// Chrome 拦截（实测样式不生效），与 module script 同族问题；同源场景去后排版无害。
function demoteModuleScripts() {
  return {
    name: 'lockpass-demote-module-scripts',
    closeBundle() {
      const htmlPath = resolve(import.meta.dirname, 'dist/index.html')
      try {
        const html = readFileSync(htmlPath, 'utf8')
        const out = html
          .replace(
            /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
            '<script defer src="$1"></script>',
          )
          .replace(
            /<link rel="stylesheet" crossorigin( href="[^"]*">)/g,
            '<link rel="stylesheet"$1',
          )
        if (out !== html) writeFileSync(htmlPath, out)
      } catch {
        // 忽略：未生成 html 时跳过
      }
    },
  }
}

// 构建期把 npm 包的浏览器产物拷到 dist/assets/vendor/，由组件运行时 script 注入按需加载。
// 为什么不走 import：这两个库合计 300KB+，只在扫码/分享时才需要；产物是 iife 单 chunk
// （见下方 rollupOptions.format），静态 import 会把它们压进首屏。改为「运行时注入 +
// 构建期文件拷贝」既保留懒加载，又让许可正文随 npm 包分发，仓库里不再手工存放第三方代码。
// 缺包即构建失败，不静默跳过（静默跳过的后果是功能上线后才发现 404）。
// 注：qrcode.js 来自作者本人发布的 qrcode-generator，不是原先那份 qrcodejs 手工副本的
// 同源替换（原作者从未发布到 npm），对应改动见 QrShareModal 的渲染分支。
const VENDOR_LIBS = [
  { from: 'jsqr/dist/jsQR.js', to: 'assets/vendor/jsQR.js' },
  { from: 'qrcode-generator/dist/qrcode.js', to: 'assets/vendor/qrcode.js' },
]

function copyVendorLibs() {
  return {
    name: 'lockpass-copy-vendor-libs',
    closeBundle() {
      const outDir = resolve(import.meta.dirname, 'dist')
      for (const lib of VENDOR_LIBS) {
        const src = resolve(import.meta.dirname, 'node_modules', lib.from)
        if (!existsSync(src)) {
          throw new Error(
            `缺少第三方运行期依赖产物：${src}（先执行 npm install，再重新构建）`
          )
        }
        const dest = resolve(outDir, lib.to)
        mkdirSync(resolve(dest, '..'), { recursive: true })
        copyFileSync(src, dest)
      }
    },
  }
}

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [vue(), injectSwVersion('dist'), copyVendorLibs(), demoteModuleScripts()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1500,
    // rolldown（vite 8 默认内核）在 iife 输出格式下会静默丢弃 CSS 资源：
    // 不产出 assets/css/、index.html 不注入 stylesheet link（构建仍报成功）。
    // 关闭 CSS code split 强制 CSS 以独立资源产出，恢复「CSS 外置到 dist/assets/css/」设计。
    // 修复背景见 docs/version/RELEASE-v1.0.md 的 v1.0.5 分节（vite ^5.4.2 → ^8.2.2 升级引入的回归）。
    cssCodeSplit: false,
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
