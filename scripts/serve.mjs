/* ═══════════════════════════════════════════════════════════════════
   LockPass — 跨平台开发静态服务器（替代 python -m http.server）
   运行：node scripts/serve.mjs  →  http://localhost:1420
   供 `tauri dev` 的 beforeDevCommand 使用，Windows/macOS/Linux 通用。
   ═══════════════════════════════════════════════════════════════════ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // LockPass 根目录
const SRC = path.join(ROOT, 'src');         // 前端源码目录（开发服务器直接提供 src/ 真源）
const PORT = Number(process.env.PORT) || 1420;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.icns': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.vault': 'application/octet-stream',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(SRC, urlPath));
  // 防目录穿越
  if (!filePath.startsWith(SRC)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[LockPass] dev server: http://localhost:${PORT}`);
});
