/* ═══════════════════════════════════════════════════════════════════
   LockPass — 生成 Tauri updater 更新清单 latest.json（v2：递归扫描）
   ───────────────────────────────────────────────────────────────────
   用法（CI 内）：
     node scripts/gen-latest-json.mjs \
       --win artifacts/windows --mac artifacts/macos \
       --out latest.json [--tag vX.Y.Z]
   规则：
     • 版本号取 src-tauri/tauri.conf.json（单一真源）
     • 递归扫描目录（download-artifact 会保留上传时的子目录层级，
       v1 顶层扫描在 nsis/、macos/ 嵌套下漏检——已修复）
     • windows-x86_64 ← NSIS 安装器（*-setup.exe + 同目录 *.sig）
     • darwin-aarch64 ← macOS 更新包（*.app.tar.gz + 同目录 *.sig）
     • url 指向 GitHub Release 资产（发布后可下载；draft 期间 404 属预期）
   ═══════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }

const conf = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'))
const version = conf.version
const repo = 'trexwb/lockPass'
const tag = arg('tag') || ('v' + version)
const base = `https://github.com/${repo}/releases/download/${tag}`

/* 递归收集目录下全部文件（绝对路径） */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/* 找带 .sig 签名的更新产物（递归） */
function findUpdaterArtifact(dir, suffix) {
  if (!dir || !existsSync(dir)) return null
  const files = walk(dir)
  const artifact = files.find((f) => f.endsWith(suffix) && existsSync(f + '.sig'))
  if (!artifact) return null
  return {
    name: path.basename(artifact),
    signature: readFileSync(artifact + '.sig', 'utf8').trim(),
  }
}

const platforms = {}
const win = findUpdaterArtifact(arg('win'), '-setup.exe')
if (win) platforms['windows-x86_64'] = { signature: win.signature, url: `${base}/${encodeURIComponent(win.name)}` }
const mac = findUpdaterArtifact(arg('mac'), '.app.tar.gz')
if (mac) platforms['darwin-aarch64'] = { signature: mac.signature, url: `${base}/${encodeURIComponent(mac.name)}` }

if (!Object.keys(platforms).length) {
  console.error('[gen-latest-json] 未找到任何带 .sig 的更新产物；已扫描目录树：')
  for (const d of [arg('win'), arg('mac')]) {
    if (d && existsSync(d)) {
      const files = walk(d)
      console.error(`  ${d} (${files.length} 个文件):`)
      files.slice(0, 20).forEach((f) => console.error('   -', path.relative(d, f)))
      if (!files.length) console.error('   （空目录）')
    } else {
      console.error(`  ${d} （目录不存在）`)
    }
  }
  process.exit(1)
}

const manifest = { version, pub_date: new Date().toISOString(), platforms }
const out = arg('out') || 'latest.json'
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n')
console.log(`[gen-latest-json] latest.json 已生成（v${version}，平台：${Object.keys(platforms).join(' / ')}）`)
