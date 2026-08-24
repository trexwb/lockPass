<script setup>
/* LockPass — 二维码添加（识别二维码并导入）
   Vue 3 迁移：对齐旧版 src/js/qr-sync.js
   - 上传 / 粘贴 / 拖拽二维码图片 → 懒加载 /assets/vendor/jsQR.js 解码
   - 摄像头实时取景扫码（BarcodeDetector 优先，降级 jsQR 逐帧解码）
   - 识别后自动取会话主密码解密（无需再次输入）→ 自动同步导入（按标题+用户名查重） */
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'

const { saveVault, closeModal, getSession } = useVault()

const QR_FORMAT = 'LockPass-QR v1'

const step = ref('upload') // 'upload' | 'scan' | 'working'
const statusMsg = ref('')
const statusType = ref('')
const fileName = ref('')
const entry = ref(null)

// 摄像头扫码会话状态（D8 修复：对齐原版 QR.startCameraScan / _scanLoop）
let _scanStream = null
let _barcodeDetector = null
const scanActive = ref(false)

function setStatus(msg, type = 'muted') {
  statusMsg.value = msg
  statusType.value = type
}

function _loadVendor(src, check) {
  if (check()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => (check() ? resolve() : reject(new Error('库加载完成但未就绪：' + src)))
    s.onerror = () => reject(new Error('库加载失败：' + src))
    document.head.appendChild(s)
  })
}

function pickFile() {
  const input = document.getElementById('qr-import-file')
  if (input) input.click()
}

function onFileChange(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (file) processImage(file)
}

function onDrop(e) {
  e.preventDefault()
  e.currentTarget.classList.remove('dragover')
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (file && file.type && file.type.startsWith('image/')) processImage(file)
  else window.Utils.showToast('请拖入图片文件', 'error')
}

function onPaste(e) {
  const items = e.clipboardData && e.clipboardData.items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.startsWith('image/')) {
      e.preventDefault()
      const file = items[i].getAsFile()
      if (file) processImage(file)
      return
    }
  }
  // 非图片粘贴：给予提示
  e.preventDefault()
  window.Utils.showToast('请粘贴图片格式的二维码（截图或右键复制图片）', 'warning')
}

/* ── 图片解码 ─────────────────────────────────────────── */

async function processImage(file) {
  fileName.value = file.name || ''
  step.value = 'working'
  setStatus('正在识别二维码…')
  try {
    const text = await decodeImageFile(file)
    await handleQrText(text)
  } catch (e) {
    setStatus(e.message || '二维码识别失败', 'danger')
    step.value = 'upload'
  }
}

async function decodeImageFile(file) {
  await _loadVendor(import.meta.env.BASE_URL + 'assets/vendor/jsQR.js', () => typeof jsQR === 'function')
  return new Promise((resolve, reject) => {
    if (typeof jsQR !== 'function') {
      reject(new Error('二维码解码库加载失败'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        try {
          // 限制最大尺寸，提升解码性能；按比例缩放
          const MAX = 1024
          const scale = Math.min(1, MAX / Math.max(img.width, img.height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(img.width * scale))
          canvas.height = Math.max(1, Math.round(img.height * scale))
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

          // 优先快速识别，失败后尝试反色识别
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          })
          if (code && code.data) {
            resolve(code.data)
            return
          }
          const codeInverted = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          })
          if (codeInverted && codeInverted.data) {
            resolve(codeInverted.data)
            return
          }
          reject(new Error('未在图片中找到二维码'))
        } catch (e) {
          reject(new Error('图片解码失败'))
        }
      }
      img.onerror = () => reject(new Error('图片读取失败'))
      img.src = reader.result
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

/* ── 识别后的统一处理：自动解密并导入（D8 修复，对齐原版 _processQrText） ── */

async function handleQrText(text) {
  step.value = 'working'
  setStatus('二维码识别成功，正在自动同步…')
  // 对齐原版：自动取会话主密码解密，无需再次输入
  const password = getSession()
  if (!password) {
    setStatus('未找到会话主密码，请先解锁保险箱后重试', 'danger')
    step.value = 'upload'
    return
  }
  try {
    const decrypted = await qrStringToEntry(text, password)
    entry.value = decrypted
    await autoImport(decrypted)
  } catch (e) {
    setStatus(e.message || '导入失败', 'danger')
    step.value = 'upload'
  }
}

/* 校验二维码格式并解密 */
async function qrStringToEntry(qrText, masterPassword) {
  let obj
  try {
    obj = JSON.parse(String(qrText).trim())
  } catch (e) {
    throw new Error('不是有效的 LockPass 二维码内容')
  }
  if (!obj || obj.format !== QR_FORMAT) {
    throw new Error('不是 LockPass 二维码')
  }
  if (!obj.salt || !obj.iv || !obj.data) {
    throw new Error('二维码内容不完整')
  }
  try {
    const salt = window.CryptoUtils.base64ToArrayBuffer(obj.salt)
    const key = await window.CryptoUtils.deriveKey(masterPassword, new Uint8Array(salt))
    return await window.CryptoUtils.decrypt(obj.data, obj.iv, key)
  } catch (e) {
    throw new Error('主密码错误或二维码已损坏')
  }
}

/* 自动同步导入：无重复直接插入；有重复询问是否替换（对齐原版 _autoImport） */
async function autoImport(e) {
  const dup = vaultState.entries.find(x =>
    (x.title || '') === (e.title || '') &&
    (x.username || '') === (e.username || '')
  )
  if (dup) {
    const dupLabel = `${e.title || '未命名'}${e.username ? '（' + e.username + '）' : ''}`
    const ok = await window.Utils.confirm({
      title: '发现重复条目',
      message: `已存在相同条目「${dupLabel}」，是否替换？`,
      confirmText: '替换',
      cancelText: '跳过',
      danger: true,
    })
    if (!ok) {
      window.Utils.showToast('已跳过，可继续扫码', 'info')
      setTimeout(() => resetToUpload(), 1200)
      return
    }
    const idx = vaultState.entries.indexOf(dup)
    if (idx !== -1) vaultState.entries.splice(idx, 1)
  }

  // 统一标签模型：旧二维码可能带 category（名称），并入 tags
  const entryTags = (e.tags || []).slice()
  if (e.category && !entryTags.includes(e.category)) entryTags.push(e.category)

  // 构建导入条目
  const newEntry = {
    id: window.CryptoUtils.uuid(),
    title: e.title || '',
    username: e.username || '',
    password: e.password || '',
    url: e.url || '',
    notes: e.notes || '',
    tags: entryTags,
    entryType: e.entryType || 'website',
    port: e.port != null ? e.port : undefined,
    favorite: false,
    showPassword: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (e.root) {
    newEntry.root = {
      username: e.root.username || '',
      password: e.root.password || '',
    }
  }
  if (e.appId) newEntry.appId = e.appId
  if (e.privateKey) newEntry.privateKey = e.privateKey

  vaultState.entries.push(newEntry)
  await saveVault()
  window.Utils.showToast(dup ? '导入成功（已替换原条目）' : '导入成功', 'success')

  // 短暂停留后回到上传视图，可继续导入下一张
  setTimeout(() => resetToUpload(), 1500)
}

/* ── 摄像头实时取景扫码（D8 修复，对齐原版 QR.startCameraScan / _initCameraScan / _scanLoop） ── */

async function startCameraScan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    window.Utils.showToast('当前浏览器不支持摄像头访问，请使用上传图片', 'error')
    return
  }
  stopCamera() // 清理上一次扫码会话
  step.value = 'scan'
  setStatus('')
  await initCameraScan()
}

async function initCameraScan() {
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
  } catch (e) {
    setStatus('无法访问摄像头：' + (e.message || e) + '（可改用上传图片识别）', 'danger')
    step.value = 'upload'
    return
  }
  // 手机端 getUserMedia 可能在 Vue 渲染 video 前 resolve，先等 DOM 就绪再取元素
  await nextTick()
  const video = document.getElementById('qr-scan-video')
  if (!video) { // 等待授权期间模态框已被关闭
    stream.getTracks().forEach(t => t.stop())
    return
  }
  _scanStream = stream
  video.srcObject = stream
  try {
    await video.play()
  } catch (e) {
    // iOS 自动播放策略差异：静音重试，仍失败则提示用户点击画面开始
    try {
      video.muted = true
      await video.play()
    } catch (e2) {
      setStatus('请点击画面开始扫码', 'muted')
    }
  }

  // 优先原生 BarcodeDetector（Chrome / Android / iOS 16.4+）
  _barcodeDetector = null
  try {
    if ('BarcodeDetector' in window) {
      _barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] })
    }
  } catch (e) {
    _barcodeDetector = null // 构造失败则降级 jsQR
  }
  // 降级引擎：确保 jsQR 就绪
  if (!_barcodeDetector) {
    try {
      await _loadVendor(import.meta.env.BASE_URL + 'assets/vendor/jsQR.js', () => typeof jsQR === 'function')
    } catch (e) {
      setStatus('二维码解码库加载失败，请检查网络后重试', 'danger')
      stopCamera()
      step.value = 'upload'
      return
    }
  }
  scanActive.value = true
  scanLoop()
}

/** 识别循环：检测到二维码文本即停止并进入导入流程 */
async function scanLoop() {
  const video = document.getElementById('qr-scan-video')
  while (scanActive.value && video) {
    try {
      let text = null
      if (_barcodeDetector) {
        const codes = await _barcodeDetector.detect(video)
        if (codes && codes.length > 0 && codes[0].rawValue) text = codes[0].rawValue
      } else {
        const canvas = document.getElementById('qr-scan-canvas')
        if (canvas && video.videoWidth > 0) {
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
          if (code && code.data) text = code.data
        }
      }
      if (text) {
        stopCamera()
        setStatus('识别成功，正在导入…')
        await handleQrText(text)
        return
      }
    } catch (e) { /* 单帧检测异常忽略，继续下一帧 */ }
    await new Promise(r => setTimeout(r, 120))
  }
}

/** 停止摄像头与识别循环 */
function stopCamera() {
  scanActive.value = false
  if (_scanStream) {
    try { _scanStream.getTracks().forEach(t => t.stop()) } catch (e) { /* 忽略 */ }
    _scanStream = null
  }
}

/** 取消扫码，回到上传视图 */
function cancelCameraScan() {
  stopCamera()
  resetToUpload()
}

function resetToUpload() {
  stopCamera()
  step.value = 'upload'
  statusMsg.value = ''
  statusType.value = ''
  fileName.value = ''
  entry.value = null
}

onMounted(() => {
  document.addEventListener('paste', onPaste)
})

onUnmounted(() => {
  document.removeEventListener('paste', onPaste)
  stopCamera()
})
</script>

<template>
  <ModalBase :max-width="'560px'" @close="closeModal()">
    <div class="modal-header">
      <h3>二维码添加</h3>
      <button class="btn-icon" @click="closeModal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="modal-body">
      <!-- 步骤一：上传 / 粘贴 / 拖拽 -->
      <div
        v-if="step === 'upload'"
        class="file-drop"
        @click="pickFile()"
        @dragover.prevent="e => e.currentTarget.classList.add('dragover')"
        @dragleave="e => e.currentTarget.classList.remove('dragover')"
        @drop="onDrop"
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto mb-3">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3h-3z" />
          <path d="M21 14v3h-3" />
        </svg>
        <div>粘贴 / 上传 / 拖拽二维码图片</div>
        <div class="text-muted text-sm mt-1">支持 PNG / JPG；可直接复制二维码图片后按 ⌘+V 粘贴，或拖拽图片到此处</div>
        <input id="qr-import-file" type="file" accept="image/*" style="display:none" @change="onFileChange" />
      </div>

      <!-- 步骤二：摄像头实时取景扫码 -->
      <div v-else-if="step === 'scan'" class="qr-scan-frame">
        <video id="qr-scan-video" autoplay playsinline muted></video>
        <canvas id="qr-scan-canvas" class="hidden" aria-hidden="true"></canvas>
        <div class="text-muted text-sm text-center mt-2">将二维码对准取景框，识别后自动导入</div>
        <div v-if="statusMsg" :class="['text-sm mt-2 text-center', statusType === 'danger' ? 'text-danger' : 'text-muted']">{{ statusMsg }}</div>
      </div>

      <!-- 步骤三：识别 / 同步中 -->
      <div v-else-if="step === 'working'" class="py-4">
        <div v-if="statusMsg" :class="['text-sm text-center', statusType === 'danger' ? 'text-danger' : 'text-muted']">{{ statusMsg }}</div>
      </div>

      <!-- 扫码识别入口（对齐原版：桌面端同样支持摄像头扫码） -->
      <button
        v-if="step === 'upload'"
        class="btn btn-primary btn-full mt-3 qr-scan-camera"
        @click="startCameraScan()"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        扫码识别
      </button>
    </div>

    <div class="modal-footer">
      <template v-if="step === 'upload'">
        <button class="btn btn-secondary" @click="closeModal()">取消</button>
      </template>
      <template v-else-if="step === 'scan'">
        <button class="btn btn-secondary" @click="cancelCameraScan()">返回上传</button>
        <button class="btn btn-secondary" @click="closeModal()">关闭</button>
      </template>
      <template v-else>
        <button class="btn btn-secondary" @click="resetToUpload()">返回</button>
      </template>
    </div>
  </ModalBase>
</template>
