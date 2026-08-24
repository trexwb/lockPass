#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   LockPass — 版本号统一更新脚本
   ───────────────────────────────────────────────────────────────────
   用法：
     node scripts/bump-version.mjs 1.0.8        # 更新全部版本号
     node scripts/bump-version.mjs 1.0.8 --dry-run  # 只预览不写入
   覆盖位置（9 处 / 8 文件）：
     package.json / package-lock.json(顶层+packages[""]) / tauri.conf.json /
     Cargo.toml / core/version.js(APP_VERSION) / vite.config.js(__APP_VERSION__) /
     public/sw.js(CACHE_NAME) / AGENTS.md(当前版本) / SPEC.md(头部+文档版本)
   README.md 更新日志为历史记录，不在本脚本范围（内容需人工编写）。
   ═══════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const versionArg = args.find((a) => !a.startsWith('--'));

if (!versionArg || !/^v?\d+\.\d+\.\d+$/.test(versionArg)) {
  console.error('用法: node scripts/bump-version.mjs <x.y.z | vx.y.z> [--dry-run]');
  process.exit(1);
}
const V = versionArg.replace(/^v/, ''); // 1.0.8（兼容 v1.0.8 写法）
const VV = 'v' + V;                     // v1.0.8

const results = [];

function patchJson(file, apply, label) {
  const p = path.join(ROOT, file);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const before = JSON.stringify(d);
  apply(d);
  const after = JSON.stringify(d);
  if (before === after) {
    results.push(`⚠️  ${file}: 未匹配到版本号（${label}），跳过`);
    return;
  }
  if (!dryRun) fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  results.push(`${dryRun ? '🔍' : '✅'} ${file}: ${label}`);
}

function patchText(file, regex, replace, label) {
  const p = path.join(ROOT, file);
  const raw = fs.readFileSync(p, 'utf8');
  const out = raw.replace(regex, replace);
  if (out === raw) {
    results.push(`⚠️  ${file}: 未匹配到版本号（${label}），跳过`);
    return;
  }
  if (!dryRun) fs.writeFileSync(p, out);
  results.push(`${dryRun ? '🔍' : '✅'} ${file}: ${label}`);
}

/* ── JSON 类 ────────────────────────────────────────────────────── */
patchJson('package.json', (d) => { d.version = V; }, `version -> ${V}`);
patchJson('package-lock.json', (d) => {
  d.version = V;
  if (d.packages && d.packages['']) d.packages[''].version = V;
}, `顶层 + packages[""] -> ${V}`);
patchJson('src-tauri/tauri.conf.json', (d) => { d.version = V; }, `version -> ${V}（打包产物版本）`);

/* ── 文本类 ─────────────────────────────────────────────────────── */
patchText('src-tauri/Cargo.toml', /^version = "\d+\.\d+\.\d+"$/m, `version = "${V}"`, `version -> ${V}（同步 tauri.conf.json）`);
// 注：core/version.js / public/sw.js / vite.config.js 为构建期从
// package.json 注入（vite define + sw 写盘插件），源码无版本号字面量，
// 此处刻意不再修改这三处。
patchText('AGENTS.md', /\*\*当前版本\*\*：`v\d+\.\d+\.\d+`/, `**当前版本**：\`${VV}\``, `当前版本 -> ${VV}`);
patchText('SPEC.md', /版本：v\d+\.\d+\.\d+/, `版本：${VV}`, `头部 -> ${VV}`);
patchText('SPEC.md', /\*\*文档版本：v\d+\.\d+\.\d+\*\*/, `**文档版本：${VV}**`, `文档版本 -> ${VV}`);

console.log(results.join('\n'));
console.log(dryRun
  ? '\n[dry-run] 未写入任何文件'
  : `\n完成：全部版本号已统一为 ${VV}（README 更新日志请人工补充）`);
