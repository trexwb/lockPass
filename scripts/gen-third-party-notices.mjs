/* ═══════════════════════════════════════════════════════════════════
   LockPass — 第三方声明生成器
   ───────────────────────────────────────────────────────────────────
   产出仓库根 THIRD-PARTY-NOTICES.txt：
     1) 内嵌进前端产物的第三方文件（手工维护的常量段，见 VENDORED）
     2) npm 直接依赖（版本与 license 取自 node_modules 内各包自身元数据）
     3) 桌面版链接的 Rust crate（版本取自 Cargo.lock，license 取自本地
        cargo registry 解包后的 Cargo.toml；取不到则标注 未获取，不猜）
   用法：node scripts/gen-third-party-notices.mjs
   ═══════════════════════════════════════════════════════════════════ */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'THIRD-PARTY-NOTICES.txt')
const REGISTRY_SRC = path.join(process.env.HOME || '', '.cargo/registry/src')

/** 随 dist 一起分发的第三方文件；无法从包元数据派生，故显式声明 */
const VENDORED = [
  {
    file: 'src/core/eff-wordlist.js',
    name: 'EFF Large Diceware Wordlist（7776 词）',
    version: '2016-07-18 版',
    license: '未标注（待人工核实）',
    origin: 'https://www.eff.org/files/2016-07-18/eff_large_wordlist.txt',
    note: '词表正文已内嵌于源码，文件头仅记录来源 URL，未记录许可条款。需向 EFF 的来源页面确认数据条款后再补写此条。',
  },
]

/** 包内没有 LICENSE/COPYING 文件时，补充其许可声明的实际出处（取自包自身内容，不做推断） */
const NPM_NOTES = {
  'qrcode-generator':
    '包内未附 LICENSE 文件；许可依据为该包 package.json 的 "license": "MIT" 与 dist/qrcode.js 文件头声明' +
    '（Copyright (c) 2009 Kazuhiko Arase / Licensed under the MIT license / ' +
    "The word 'QR Code' is registered trademark of DENSO WAVE INCORPORATED）。",
}

/**
 * 读取 package.json 的依赖表
 * @param {string} field dependencies / devDependencies
 * @returns {Array<{name: string, range: string, version: string, license: string, licenseFiles: string[]}>}
 */
function readNpmDeps(field) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const table = pkg[field] || {}
  return Object.entries(table).map(([name, range]) => {
    const dir = path.join(ROOT, 'node_modules', name)
    let version = '未安装'
    let license = '未获取'
    let licenseFiles = []
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      version = meta.version || '未标注'
      license = typeof meta.license === 'string' ? meta.license : '未标注'
      licenseFiles = fs
        .readdirSync(dir)
        .filter((f) => /^(licen[cs]e|copying)/i.test(f))
        .map((f) => `node_modules/${name}/${f}`)
    } catch (e) {
      /* node_modules 缺失时保留「未获取」，不猜测许可 */
    }
    return { name, range, version, license, licenseFiles }
  })
}

/**
 * 解析 Cargo.lock，取带 registry source 的包（本地 crate 无 source，排除）
 * @returns {Array<{name: string, version: string}>}
 */
function readCargoLock() {
  const text = fs.readFileSync(path.join(ROOT, 'src-tauri/Cargo.lock'), 'utf8')
  const out = []
  for (const block of text.split('[[package]]').slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)
    const version = /^version = "([^"]+)"/m.exec(block)
    const source = /^source = "registry\+([^"]+)"/m.exec(block)
    if (name && version && source) out.push({ name: name[1], version: version[1] })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/**
 * 从本地 cargo registry 解包目录读该 crate 声明的 license
 * @param {{name: string, version: string}} crate
 * @returns {{license: string, licenseFiles: string[]}}
 */
function readCrateLicense(crate) {
  const result = { license: '未获取（本地 registry 无该 crate 解包）', licenseFiles: [] }
  if (!fs.existsSync(REGISTRY_SRC)) return result
  let hosts = []
  try {
    hosts = fs.readdirSync(REGISTRY_SRC)
  } catch (e) {
    return result
  }
  for (const host of hosts) {
    const dir = path.join(REGISTRY_SRC, host, `${crate.name}-${crate.version}`)
    if (!fs.existsSync(dir)) continue
    try {
      const toml = fs.readFileSync(path.join(dir, 'Cargo.toml'), 'utf8')
      const declared = /^license = "([^"]+)"/m.exec(toml)
      const field = /^license-file = "([^"]+)"/m.exec(toml)
      const files = fs
        .readdirSync(dir)
        .filter((f) => /^(licen[cs]e|copying)/i.test(f))
        .map((f) => `${dir}/${f}`)
      if (declared) result.license = declared[1]
      else if (files.length) result.license = 'Cargo.toml 未声明 license 字段，包内含许可文件'
      if (field && !files.includes(path.join(dir, field[1]))) files.push(path.join(dir, field[1]))
      result.licenseFiles = files
    } catch (e) {
      /* 单个 crate 读失败不影响整体产出，标注留在 license 字段里 */
    }
    return result
  }
  return result
}

function main() {
  const deps = readNpmDeps('dependencies')
  const devDeps = readNpmDeps('devDependencies')
  const crates = readCargoLock()
  const crateRows = crates.map((c) => ({ ...c, ...readCrateLicense(c) }))
  const unresolved = crateRows.filter((c) => c.license.startsWith('未获取'))

  const L = []
  L.push('LockPass — 第三方声明 / THIRD-PARTY NOTICES')
  L.push('')
  L.push('本文件由 `node scripts/gen-third-party-notices.mjs` 生成，禁止手改正文之外的内容。')
  L.push('生成时间：' + new Date().toISOString())
  L.push('LockPass 自身以 MIT License 分发，见仓库根 LICENSE。')
  L.push('')
  L.push('说明：LockPass 不主张对第三方组件的版权，亦不授予其额外许可。')
  L.push('各条目「许可正文」列指向本地存在该包时的许可文件位置；未安装的依赖只能')
  L.push('依据其自身元数据标注，标注为「未获取」的条目表示本地无证据，未经核实。')
  L.push('')
  L.push('─'.repeat(67))
  L.push('')

  L.push('【1】内嵌进前端产物的第三方文件（随 dist 分发）')
  L.push('')
  for (const v of VENDORED) {
    L.push(`· ${v.name}`)
    L.push(`  版本：${v.version}`)
    L.push(`  许可：${v.license}`)
    L.push(`  来源：${v.origin}`)
    L.push(`  本仓库位置：${v.file}`)
    L.push(`  备注：${v.note}`)
    L.push('')
  }

  L.push('─'.repeat(67))
  L.push('')
  L.push('【2】npm 运行时依赖（打进前端产物，或构建期拷贝到 dist/assets/vendor/）')
  L.push('')
  for (const d of deps) {
    L.push(`· ${d.name}@${d.version}（声明范围 ${d.range}） — 许可：${d.license}`)
    L.push(`  许可正文：${d.licenseFiles.length ? d.licenseFiles.join('、') : '包内未附许可文件'}`)
    if (NPM_NOTES[d.name]) L.push(`  备注：${NPM_NOTES[d.name]}`)
  }
  L.push('')
  L.push('【2b】npm 构建期依赖（不进入产物，但随源码仓库分发时同样适用其许可）')
  L.push('')
  for (const d of devDeps) {
    L.push(`· ${d.name}@${d.version}（声明范围 ${d.range}） — 许可：${d.license}`)
    L.push(`  许可正文：${d.licenseFiles.length ? d.licenseFiles.join('、') : '本地未取到文件'}`)
  }

  L.push('')
  L.push('─'.repeat(67))
  L.push('')
  L.push(`【3】桌面版链接的 Rust 依赖（共 ${crateRows.length} 个，版本取自 src-tauri/Cargo.lock）`)
  L.push('')
  L.push('格式：crate 版本 — 许可（该 crate 的 Cargo.toml 自身声明）')
  L.push('')
  for (const c of crateRows) L.push(`· ${c.name} ${c.version} — ${c.license}`)
  L.push('')
  L.push(
    unresolved.length
      ? `其中 ${unresolved.length} 个条目本地未取到许可元数据，已如实标注，需要时重新生成即可补齐。`
      : '全部条目均从本地 cargo registry 元数据取得许可声明。'
  )
  L.push('')
  L.push('─'.repeat(67))
  L.push('')
  L.push('【4】待确认事项（不得对外表述为已合规）')
  L.push('')
  L.push('  1. eff-wordlist.js：词表数据条款未在文件头记录，需向来源页面确认后再补写第【1】段。')
  L.push('')
  L.push('已处理（保留记录，便于回溯）：')
  L.push('  · jsQR：原手工副本无 LICENSE 文件，已改为 npm 依赖 jsqr@1.4.0（Apache-2.0），' +
    '构建期由 vite 插件拷到 dist/assets/vendor/jsQR.js；与上游产物逐字节一致（cmp 校验）。')
  L.push('  · 二维码生成库：原 src/public/assets/vendor/qrcode.min.js 系 davidshimjs/qrcodejs 的压缩产物，' +
    '经核实与上游 master（commit 06c7a5e134f1，19927 字节）及 cdnjs/jsdelivr 各公开副本均相差 1 个字符' +
    '（版本选择循环里 g>=f 被改成 g>f），即仓库里那份是被人手工改过的压缩代码，来源无法归到任何已发布版本。' +
    '该原作者从未向 npm 发布，npm 上的 qrcodejs 各包都是第三方镜像，故改为直接采用作者本人发布的' +
    ' qrcode-generator@2.0.4（MIT），渲染改由 QrShareModal 用 canvas 直绘；' +
    'qrcode-generator 编码 → jsQR 解码往返共 17 项断言全绿（node scripts/test-qr-roundtrip.mjs）。')

  fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8')
  console.log(
    `已生成 ${path.relative(ROOT, OUT)}：内嵌 ${VENDORED.length} 项 / npm ${deps.length}+${devDeps.length} 项 / crate ${crateRows.length} 项（未取到许可 ${unresolved.length}）`
  )
}

main()
