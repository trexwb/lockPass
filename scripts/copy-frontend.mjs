/* ═══════════════════════════════════════════════════════════════════
   LockPass — 构建前端产物（生成 dist/）
   ───────────────────────────────────────────────────────────────────
   v1.0.17 起：Vue/Vite 迁移后 dist 由 vite build 直接生成，
   本脚本不再做「从 src 拷贝文件」的旧逻辑（src 是源码，产物在 dist）。

   保留脚本名 copy-frontend.mjs 仅为兼容 GitHub Actions 等既有调用点，
   实际行为 = 执行 npm run vite:build（vite build + 单文件内联）。
   注意：不调用 npm run build —— 那已是「vite + tauri 打包 + dmg」全流程，
   本脚本只服务前端产物生成（Pages 部署等场景）。

   适用场景：
     • GitHub Pages 部署（.github/workflows/pages.yml）
     • 任何需要「先构建出 dist/」的 CI / 手动流程
   注意：需要 node_modules 已安装（脚本内部执行 npm run vite:build）。
   ═══════════════════════════════════════════════════════════════════ */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // LockPass 根目录

console.log('[LockPass] 执行 vite build 生成 dist/ …');
execSync('npm run vite:build', { cwd: ROOT, stdio: 'inherit' });

const distIndex = path.join(ROOT, 'dist', 'index.html');
try {
  const fs = await import('node:fs');
  if (fs.existsSync(distIndex)) {
    const size = (fs.statSync(distIndex).size / 1024).toFixed(1);
    console.log(`[LockPass] 构建完成：dist/index.html（${size} KB，单文件自包含）`);
  } else {
    console.warn('[LockPass] 警告：未找到 dist/index.html，请检查构建输出');
  }
} catch (e) {
  /* 校验失败不影响构建结果 */
}
console.log('[LockPass] dist/ 已生成，可直接部署或双击 dist/index.html 使用');