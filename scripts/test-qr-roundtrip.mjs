/* LockPass — 二维码渲染链路回归
   不启动浏览器，直接验证「构建产物里那份库文件」在经典 script 场景下能跑通
   QrShareModal 的实际调用序列：全局名 → 自动选版本 → UTF-8 编码 → canvas 直绘 → jsQR 解码取回原文。
   用法：node scripts/test-qr-roundtrip.mjs（先 npm run vite:build 则测 dist 产物，否则退回 node_modules 源文件） */
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const jsQR = require('jsqr')

const SCALE = 6
const QUIET = 4

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1
    console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail += 1
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

/**
 * 以「页面里 <script src=…> 的古典脚本」方式加载库，返回其挂到全局的工厂函数。
 * 组件的懒加载判定就是 `typeof qrcode === 'function'`，此处用同一口径校验全局名没写错。
 */
function loadLibrary() {
  const built = path.join(ROOT, 'dist/assets/vendor/qrcode.js')
  const file = existsSync(built)
    ? built
    : path.join(ROOT, 'node_modules/qrcode-generator/dist/qrcode.js')
  const sandbox = { navigator: { userAgent: 'Mozilla/5.0' }, console }
  sandbox.window = sandbox
  sandbox.self = sandbox
  vm.createContext(sandbox)
  vm.runInContext(readFileSync(file, 'utf8'), sandbox)
  return { qrcode: sandbox.qrcode, file }
}

const { qrcode: lib, file: libFile } = loadLibrary()
check(
  '库文件以古典脚本加载后暴露全局 qrcode（组件 _loadVendor 的判定条件）',
  typeof lib === 'function',
  path.relative(ROOT, libFile)
)

/** 与 QrShareModal 完全一致的编码调用序列 */
function encode(text) {
  lib.stringToBytes = lib.stringToBytesFuncs['UTF-8']
  const qr = lib(0, 'M') // 第 1 参 0 = 由库按数据长度自动选版本；纠错级沿用 M
  qr.addData(text)
  qr.make()
  return qr
}

/** 假 2D context：只记录 fillRect 调用，用于核对组件画布的输出规格 */
function stubContext() {
  const rects = []
  return {
    fillStyle: '#fff',
    fillRect(x, y, w, h) {
      rects.push({ x, y, w, h, dark: this.fillStyle === 'black' })
    },
    rects,
  }
}

const SAMPLE = JSON.stringify({
  format: 'LockPass-QR v1',
  v: 1,
  salt: 'c1NhbHR8',
  iv: 'aXZpdml2aQ==',
  data: 'ZGF0YWRhdGE=',
})

/** 组件的渲染分支：整数边长 + 无留白，模块总数与明暗分布必须与库的矩阵一致 */
function checkCanvasPath(text, label) {
  const qr = encode(text)
  const modules = qr.getModuleCount()
  const size = 320
  const cell = Math.max(1, Math.floor(size / modules))
  const ctx = stubContext()
  qr.renderTo2dContext(ctx, cell)
  const expected = modules * modules
  const darkFromLib = [...Array(modules)].reduce(
    (acc, _, r) => acc + [...Array(modules)].filter((__, c) => qr.isDark(r, c)).length,
    0
  )
  const darkDrawn = ctx.rects.filter(r => r.dark).length
  check(
    `${label} canvas 直绘：填满 ${cell * modules}×${cell * modules}，${expected} 个模块，黑块 ${darkDrawn} 与矩阵一致`,
    ctx.rects.length === expected && darkDrawn === darkFromLib
  )
}

/** 把模块矩阵画成 RGBA 位图；quiet=0 时与弹窗 canvas 输出完全一致（无留白） */
function toImageData(qr, quiet) {
  const n = qr.getModuleCount()
  const size = (n + quiet * 2) * SCALE
  const data = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue
      for (let y = 0; y < SCALE; y++) {
        for (let x = 0; x < SCALE; x++) {
          const px = ((r * SCALE + y + quiet * SCALE) * size + c * SCALE + x + quiet * SCALE) * 4
          data[px] = data[px + 1] = data[px + 2] = 0
        }
      }
    }
  }
  return { data, size }
}

function roundTrip(text, label) {
  const qr = encode(text)
  const detail = `${Buffer.byteLength(text, 'utf8')} 字节 / 版本 ${(qr.getModuleCount() - 17) / 4} / ${qr.getModuleCount()}×${qr.getModuleCount()}`
  const noQuiet = toImageData(qr, 0)
  const withQuiet = toImageData(qr, QUIET)
  const gotNoQuiet = jsQR(noQuiet.data, noQuiet.size, noQuiet.size, {
    inversionAttempts: 'dontInvert',
  })
  const gotWithQuiet = jsQR(withQuiet.data, withQuiet.size, withQuiet.size, {
    inversionAttempts: 'dontInvert',
  })
  check(
    `${label} 无留白解码取回原文（弹窗实际输出）`,
    gotNoQuiet?.data === text,
    detail + (gotNoQuiet ? '' : ' / 解码失败：' + (gotNoQuiet?.errorReason ?? 'no result'))
  )
  check(`${label} 4 模块留白解码取回原文（对照）`, gotWithQuiet?.data === text)
}

console.log('二维码渲染链路回归')

// 分享载荷是 base64 JSON（全 ASCII）；三档长度对应预检的 1800 警告线与 2200 错误线以内
for (const [text, label] of [
  [SAMPLE, '短载荷'],
  ['A'.repeat(600), '典型载荷'],
  ['B'.repeat(1800), '警告线 1800B'],
  ['C'.repeat(2200), '错误线上限 2200B'],
  ['密码测试-密码测试-密码测试', '非 ASCII（UTF-8 分支）'],
]) {
  roundTrip(text, label)
  checkCanvasPath(text, label)
}

// 超上限必须抛错而不是静默画出一张扫不出的图。注意库这里 throw 的是裸字符串
// （'code length overflow. …'）而非 Error；QrShareModal 的 catch 取 `e.message || e`，文案不受影响。
let thrown = null
try {
  encode('D'.repeat(2400))
} catch (e) {
  thrown = e
}
check('2400B 超容量时抛错而非静默出图', thrown !== null, String(thrown).slice(0, 40))

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
if (fail) process.exit(1)
