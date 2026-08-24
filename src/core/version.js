/* ═══════════════════════════════════════════════════════════════════
   LockPass — 运行版本（构建期注入）
   ───────────────────────────────────────────────────────────────────
   版本号单一来源：package.json（+ src-tauri/tauri.conf.json 打包源）
   vite.config.js 构建时读取 package.json 并注入 __LOCKPASS_VERSION__，
   本文件不再写死版本号。升级流程：npm run version:set <x.y.z>
   ═══════════════════════════════════════════════════════════════════ */
/* global __LOCKPASS_VERSION__ */

export const APP_VERSION = __LOCKPASS_VERSION__

if (typeof window !== 'undefined') {
  window.LockPassVersion = APP_VERSION
}
