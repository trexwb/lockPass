/* ═══════════════════════════════════════════════════════════════════
   LockPass — 桌面包 SW 清理（tauri build 专用后处理）
   ───────────────────────────────────────────────────────────────────
   桌面版前端资源嵌入 exe 且经 http://tauri.localhost 提供；
   sw.js 出现在该 origin 上存在两类风险：
     1) 任何历史构建残留的注册可拦截首屏（旧缓存清单不一致时致 404）
     2) 即便跳过注册，文件存在于根目录也允许再次手动注册
   浏览器版（GitHub Pages / 本地 file:// 构建）不受影响：本脚本仅在
   tauri.conf.json 的 beforeBuildCommand 链中调用。
   ═══════════════════════════════════════════════════════════════════ */
import { existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'dist', 'sw.js')

if (existsSync(target)) {
  unlinkSync(target)
  console.log('[remove-dist-sw] 已移除桌面包中的 dist/sw.js')
} else {
  console.log('[remove-dist-sw] dist/sw.js 不存在，无需清理')
}
