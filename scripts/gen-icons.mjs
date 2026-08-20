/* ═══════════════════════════════════════════════════════════════════
   LockPass — 图标生成脚本（纯 Node，无第三方依赖）
   运行：node scripts/gen-icons.mjs
   生成：src-tauri/icons/{32x32,128x128,128x128@2x,icon}.png + icon.ico + icon.icns
         app-icon.png（1024，供 `npm run icons` 用 tauri icon 重新生成）
   ═══════════════════════════════════════════════════════════════════ */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_DIR = path.resolve(__dirname, '..', 'src-tauri', 'icons');
fs.mkdirSync(ICON_DIR, { recursive: true });

/* ── CRC32（PNG 校验） ───────────────────────────────────────────── */
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/* ── 绘制 LockPass 图标（深蓝底 + 青色保险箱 + 白色锁孔） ───────── */
function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    buf[o] = 15; buf[o + 1] = 23; buf[o + 2] = 42; buf[o + 3] = 255; // 深海军蓝
  }
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const o = (y * size + x) * 4;
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
  };
  const fillCircle = (cx, cy, rad, r, g, b) => {
    const r2 = rad * rad;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) set(x, y, r, g, b);
      }
  };
  const fillRect = (x0, y0, x1, y1, r, g, b) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, r, g, b);
  };
  const roundRect = (x0, y0, x1, y1, rad, r, g, b) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const ix = Math.min(x - x0, x1 - x), iy = Math.min(y - y0, y1 - y);
        if (ix < rad && iy < rad) {
          const ddx = rad - ix, ddy = rad - iy;
          if (ddx * ddx + ddy * ddy > rad * rad) continue;
        }
        set(x, y, r, g, b);
      }
  };
  const t = size;
  const teal = [20, 184, 166];
  const white = [226, 232, 240];
  const m = Math.round(t * 0.12);
  roundRect(m, m, t - m, t - m, Math.round(t * 0.16), teal[0], teal[1], teal[2]);     // 保险箱面板
  const cx = t / 2;
  fillRect(Math.round(cx - t * 0.10), Math.round(t * 0.18), Math.round(cx + t * 0.10), Math.round(t * 0.30), white[0], white[1], white[2]); // 锁梁
  fillCircle(cx, t * 0.58, t * 0.075, white[0], white[1], white[2]);                    // 锁孔圆
  fillRect(Math.round(cx - t * 0.022), Math.round(t * 0.58), Math.round(cx + t * 0.022), Math.round(t * 0.72), white[0], white[1], white[2]); // 锁孔柄
  return buf;
}

/* ── ICO（PNG-in-ICO，256px） ───────────────────────────────────── */
function makeIco(png) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0; // 256 用 0 表示
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4);   // color planes
  entry.writeUInt16LE(32, 6);  // bit count
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([dir, entry, png]);
}

/* ── ICNS（嵌入 PNG：128/256/512） ──────────────────────────────── */
function makeIcns(entries) {
  let body = Buffer.alloc(0);
  for (const e of entries) {
    const head = Buffer.alloc(8);
    head.write(e.os, 0, 'ascii');
    head.writeUInt32BE(e.png.length + 8, 4);
    body = Buffer.concat([body, head, e.png]);
  }
  const out = Buffer.alloc(8);
  out.write('icns', 0, 'ascii');
  out.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([out, body]);
}

/* ── 生成 ───────────────────────────────────────────────────────── */
const png32 = encodePNG(32, 32, makeIcon(32));
const png128 = encodePNG(128, 128, makeIcon(128));
const png256 = encodePNG(256, 256, makeIcon(256));
const png512 = encodePNG(512, 512, makeIcon(512));
const png1024 = encodePNG(1024, 1024, makeIcon(1024));

fs.writeFileSync(path.join(ICON_DIR, '32x32.png'), png32);
fs.writeFileSync(path.join(ICON_DIR, '128x128.png'), png128);
fs.writeFileSync(path.join(ICON_DIR, '128x128@2x.png'), png256);
fs.writeFileSync(path.join(ICON_DIR, 'icon.png'), png512);
fs.writeFileSync(path.join(ICON_DIR, 'icon.ico'), makeIco(png256));
fs.writeFileSync(path.join(ICON_DIR, 'icon.icns'), makeIcns([
  { os: 'ic07', png: png128 },
  { os: 'ic08', png: png256 },
  { os: 'ic09', png: png512 }
]));
fs.writeFileSync(path.join(__dirname, '..', 'app-icon.png'), png1024);

console.log('✅ 图标已生成：');
console.log('   src-tauri/icons/32x32.png');
console.log('   src-tauri/icons/128x128.png');
console.log('   src-tauri/icons/128x128@2x.png');
console.log('   src-tauri/icons/icon.png');
console.log('   src-tauri/icons/icon.ico');
console.log('   src-tauri/icons/icon.icns');
console.log('   app-icon.png (源文件，可用 `npm run icons` 重新生成)');
