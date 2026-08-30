/**
 * build-extension.mjs — 浏览器扩展打包脚本（Chrome + Firefox 双版本）
 *
 * 作用：
 *   1. Chrome 版：拷贝 extension/ 为 dist/extension/chrome/，并打包
 *      dist/lockpass-extension-v<版本>.zip（保持既有发布链接不变）。
 *   2. Firefox 版：拷贝 extension/ 为 dist/extension/firefox/，生成 Firefox
 *      变体 manifest（注入 browser_specific_settings.gecko、background 由
 *      service_worker 改为 scripts 声明），并经 web-ext 打包为
 *      dist/lockpass-extension-v<版本>-firefox.xpi。
 *
 * 依赖：
 *   - web-ext（Firefox 官方打包工具）：缺失时自动回退为系统 zip 生成 .xpi
 *   - 系统 zip（macOS 自带）
 *
 * 用法：
 *   node scripts/build-extension.mjs
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXT_DIR = join(ROOT, 'extension')
const OUT_DIR = join(ROOT, 'dist', 'extension')

/** Firefox gecko 标识：与 docs/upgrade-design.md 第三章 3.1 保持一致 */
const GECKO_ID = 'lockpass-extension@lockpass.local'
const GECKO_MIN_VERSION = '115.0'

/**
 * 读取扩展版本号（真源：extension/manifest.json）
 * @returns {string} 语义化版本号，如 1.1.5
 */
function readExtensionVersion() {
  const manifest = JSON.parse(readFileSync(join(EXT_DIR, 'manifest.json'), 'utf8'))
  if (!manifest.version) throw new Error('extension/manifest.json 缺少 version 字段')
  return manifest.version
}

/**
 * 将 extension/ 整目录拷贝到目标目录（跳过 .DS_Store）
 * @param {string} dest 目标目录绝对路径
 */
function copyExtension(dest) {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(EXT_DIR, dest, {
    recursive: true,
    filter: (src) => !src.endsWith('.DS_Store'),
  })
}

/**
 * 生成 Firefox 变体 manifest（基于 Chrome manifest 派生）
 * @param {object} chromeManifest 原 Chrome manifest 对象
 * @returns {object} Firefox 变体 manifest 对象
 */
function buildFirefoxManifest(chromeManifest) {
  const fx = structuredClone(chromeManifest)
  // 3.1 manifest 适配：注入 gecko 标识（正式分发必需 id）
  fx.browser_specific_settings = {
    gecko: { id: GECKO_ID, strict_min_version: GECKO_MIN_VERSION },
  }
  // MV3 background 差异点：Firefox 115+ 虽支持 service_worker，但 SW 事件驱动
  // 生命周期下 setInterval 轮询（HTTP_STATUS_POLL_MS=15s）休眠即停；
  // 改用 Firefox 的 background.scripts（event page）声明，保证状态轮询可用。
  if (chromeManifest.background && chromeManifest.background.service_worker) {
    fx.background = { scripts: [chromeManifest.background.service_worker] }
  }
  return fx
}

/**
 * 执行系统命令并回显（失败抛错）
 * @param {string} cmd 可执行文件
 * @param {string[]} args 参数
 * @param {object} [opts] 附加选项（cwd 等）
 */
function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}

/**
 * 检测 web-ext 是否可用
 * @returns {boolean}
 */
function hasWebExt() {
  try {
    execFileSync('web-ext', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * 打包 Chrome 版：目录 + zip（保留既有发布文件名）
 * @param {string} ver 版本号
 */
function buildChrome(ver) {
  const chromeDir = join(OUT_DIR, 'chrome')
  copyExtension(chromeDir)
  const zipPath = join(ROOT, 'dist', `lockpass-extension-v${ver}.zip`)
  // 与 CI 既有行为一致：zip 命令打包，排除 .DS_Store
  run('zip', ['-r', '-q', zipPath, '.'], { cwd: chromeDir })
  console.log(`[Chrome] 目录: ${chromeDir}`)
  console.log(`[Chrome] zip  : ${zipPath}`)
}

/**
 * 打包 Firefox 版：目录（Firefox 变体 manifest）+ xpi（web-ext 优先，zip 兜底）
 * @param {string} ver 版本号
 */
function buildFirefox(ver) {
  const fxDir = join(OUT_DIR, 'firefox')
  copyExtension(fxDir)
  // 派生 Firefox 变体 manifest
  const chromeManifest = JSON.parse(readFileSync(join(EXT_DIR, 'manifest.json'), 'utf8'))
  const fxManifest = buildFirefoxManifest(chromeManifest)
  writeFileSync(join(fxDir, 'manifest.json'), JSON.stringify(fxManifest, null, 2) + '\n', 'utf8')

  const xpiName = `lockpass-extension-v${ver}-firefox.xpi`
  const xpiPath = join(ROOT, 'dist', xpiName)
  if (hasWebExt()) {
    // 设计文档 3.2：web-ext 命令生成 .xpi 供手动加载
    run('web-ext', ['build', '--source-dir', fxDir, '--artifacts-dir', join(ROOT, 'dist'), '--filename', xpiName, '--overwrite-dest'])
    console.log('[Firefox] 使用 web-ext 打包 .xpi')
  } else {
    // 兜底：xpi 本质为 zip，系统 zip 打包同样可被 Firefox 加载
    run('zip', ['-r', '-q', xpiPath, '.'], { cwd: fxDir })
    console.log('[Firefox] web-ext 不可用，回退系统 zip 生成 .xpi')
  }
  console.log(`[Firefox] 目录: ${fxDir}`)
  console.log(`[Firefox] xpi : ${xpiPath}`)
}

/**
 * 校验 Firefox 变体 manifest 关键字段
 * @param {string} ver 版本号
 */
function verifyFirefoxManifest(ver) {
  const fxManifest = JSON.parse(readFileSync(join(OUT_DIR, 'firefox', 'manifest.json'), 'utf8'))
  const checks = [
    ['browser_specific_settings.gecko.id', fxManifest.browser_specific_settings?.gecko?.id === GECKO_ID],
    ['browser_specific_settings.gecko.strict_min_version', fxManifest.browser_specific_settings?.gecko?.strict_min_version === GECKO_MIN_VERSION],
    ['background.scripts[0]', fxManifest.background?.scripts?.[0] === 'background.js'],
    ['manifest_version=3', fxManifest.manifest_version === 3],
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name)
  if (failed.length) throw new Error('Firefox manifest 校验失败: ' + failed.join(', '))
  console.log('[Firefox] manifest 校验通过（gecko id / min_version / background.scripts）')

  const xpiPath = join(ROOT, 'dist', `lockpass-extension-v${ver}-firefox.xpi`)
  if (!existsSync(xpiPath)) throw new Error('Firefox xpi 产物缺失: ' + xpiPath)
  console.log(`[Firefox] xpi 产物存在: ${xpiPath}`)
}

/**
 * 入口：依次构建 Chrome / Firefox 两版
 */
function main() {
  if (!existsSync(join(EXT_DIR, 'manifest.json'))) {
    throw new Error(`未找到扩展目录 manifest: ${join(EXT_DIR, 'manifest.json')}`)
  }
  mkdirSync(join(ROOT, 'dist'), { recursive: true })
  const ver = readExtensionVersion()
  console.log(`[build-extension] LockPass 扩展 v${ver} 双版本打包开始`)
  buildChrome(ver)
  buildFirefox(ver)
  verifyFirefoxManifest(ver)
  console.log(`[build-extension] 完成：Chrome zip + Firefox xpi 已输出到 dist/`)
}

main()
