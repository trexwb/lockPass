/* ═══════════════════════════════════════════════════════════════════
   LockPass — 构建前前端资源拷贝
   把前端真源（src/index.html + css/ + js/ + assets/ 等）复制到
   dist/，供 Tauri `frontendDist` 与 GitHub Pages 部署使用。这样：
     • src/ 是唯一前端源码入口，根目录保持干净
     • Tauri 的 frontendDist 是隔离的干净目录，通过配置校验
   跨平台（Node 内置 fs/path），Windows 构建机同样适用。
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // LockPass 根目录
const SRC = path.join(ROOT, 'src');         // 前端源码目录
const DIST = path.join(ROOT, 'dist');       // 构建产物目录

// 清空并重建 dist
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const targets = ['index.html', 'sw.js', 'manifest.json', 'css', 'js', 'assets'];
for (const rel of targets) {
  const src = path.join(SRC, rel);
  if (!fs.existsSync(src)) {
    console.warn(`[LockPass] 跳过（不存在）: ${rel}`);
    continue;
  }
  fs.cpSync(src, path.join(DIST, rel), { recursive: true });
  console.log(`[LockPass] 已拷贝: ${rel}`);
}

console.log('[LockPass] 前端资源已准备到 dist/');
