#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   LockPass — 版本号一致性校验脚本
   ───────────────────────────────────────────────────────────────────
   用法：node scripts/check-version.mjs
   以 package.json 的 version 为基准，比对其余 8 处版本号，
   全部一致退出 0，任一不一致列出差异并退出 1（可挂 pre-commit / CI）。
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const base = JSON.parse(read('package.json')).version; // 真源 1：npm 版本
const tauriVersion = JSON.parse(read('src-tauri/tauri.conf.json')).version; // 真源 2：打包版本
const VV = 'v' + base;

const lock = JSON.parse(read('package-lock.json'));
const checks = [
  // ── 真源一致性 ──
  ['src-tauri/tauri.conf.json（真源）', tauriVersion, base],
  // ── 派生物一致性 ──
  ['package-lock.json 顶层', lock.version, base],
  ['package-lock.json packages[""]', lock.packages && lock.packages[''] && lock.packages[''].version, base],
  ['extension/manifest.json', JSON.parse(read('extension/manifest.json')).version, base],
  ['src-tauri/Cargo.toml', /^version = "(\d+\.\d+\.\d+)"$/m.exec(read('src-tauri/Cargo.toml'))?.[1], base],
  ['AGENTS.md 当前版本', /当前版本.*?`v(\d+\.\d+\.\d+)`/.exec(read('AGENTS.md'))?.[1], base],
  ['docs/spec.md 头部', /版本：v(\d+\.\d+\.\d+)/.exec(read('docs/spec.md'))?.[1], base],
  ['docs/spec.md 文档版本', /\*\*文档版本：v(\d+\.\d+\.\d+)\*\*/.exec(read('docs/spec.md'))?.[1], base],
  // ── 注入模式（版本号仅允许存在于 package.json / tauri.conf.json 两个真源）──
  ['src/core/version.js 注入模式', /export const APP_VERSION = __LOCKPASS_VERSION__/.test(read('src/core/version.js')) ? '__LOCKPASS_VERSION__' : '⚠️ 硬编码', '__LOCKPASS_VERSION__'],
  ['src/public/sw.js 注入模式', /lockpass-__APP_VERSION__/.test(read('src/public/sw.js')) ? '占位符' : '⚠️ 硬编码', '占位符'],
  ['vite.config.js 读取 package.json', /readFileSync\(new URL\('\.\/package\.json'/.test(read('vite.config.js')) ? '读取源' : '⚠️ 硬编码', '读取源'],
];

let bad = 0;
for (const [label, actual, expect] of checks) {
  const ok = actual === expect;
  if (!ok) bad++;
  console.log(`${ok ? '✅' : '❌'} ${label}: ${actual ?? '(未找到)'} ${ok ? '' : `≠ ${expect}`}`);
}

if (bad === 0) {
  console.log(`\n全部 ${checks.length} 处版本号一致（${VV}）`);
  process.exit(0);
} else {
  console.log(`\n发现 ${bad} 处不一致！请运行: npm run version:set <x.y.z>`);
  process.exit(1);
}
