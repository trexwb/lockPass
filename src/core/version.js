/* ═══════════════════════════════════════════════════════════════════
   LockPass — 版本单一来源
   Vue 3 迁移：收敛所有版本号到此处（原分散在 app.js / sw.js / SPEC 等，
   且多处理落后）。设置面板从此处读取，避免再出现版本号不一致。
   ═══════════════════════════════════════════════════════════════════ */

export const APP_VERSION = '1.0.15'

if (typeof window !== 'undefined') {
  window.LockPassVersion = APP_VERSION
}
