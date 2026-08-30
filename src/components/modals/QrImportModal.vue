<script setup>
/* LockPass — 二维码添加（识别二维码并导入）
   Vue 3 迁移：对齐旧版 src/js/qr-sync.js
   - 上传 / 粘贴 / 拖拽二维码图片 → 懒加载 /assets/vendor/jsQR.js 解码
   - 摄像头实时取景扫码（BarcodeDetector 优先，降级 jsQR 逐帧解码）
   - 识别后自动取会话主密码解密（无需再次输入）→ 自动同步导入（按标题+用户名查重） */
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'
import { useI18n } from '../../composables/useI18n'

const { saveVault, closeModal, getSession } = useVault()
const { t } = useI18n()

// P3-4：图标统一走 Utils.SvgIcons
const Icons = window.Utils.SvgIcons

const QR_FORMAT = 'LockPass-QR v1'

const step = ref('upload') // 'upload' | 'scan' | 'working'
const statusMsg = ref('')
// P3-3 同款平台判定：navigator.platform 已废弃，userAgentData 优先
const isMac = (navigator.userAgentData && navigator.userAgentData.platform === 'macOS')
  || /mac/i.test(navigator.platform || '')
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
    s.onload = () => (check() ? resolve() : reject(new Error(t('qrshare.errLibNotReady', { src }))))
    s.onerror = () => reject(new Error(t('qrshare.errLibLoad', { src })))
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
  else window.Utils.showToast(t('qrimport.errNotImage'), 'error')
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
  window.Utils.showToast(t('qrimport.errPasteNotImage'), 'warning')
}

/* ── 图片解码 ─────────────────────────────────────────── */

async function processImage(file) {
  fileName.value = file.name || ''
  step.value = 'working'
  setStatus(t('qrimport.recognizing'))
  try {
    const text = await decodeImageFile(file)
    await handleQrText(text)
  } catch (e) {
    setStatus(e.message || t('qrimport.errRecognize'), 'danger')
    step.value = 'upload'
  }
}

async function decodeImageFile(file) {
  await _loadVendor(import.meta.env.BASE_URL + 'assets/vendor/jsQR.js', () => typeof jsQR === 'function')
  return new Promise((resolve, reject) => {
    if (typeof jsQR !== 'function') {
      reject(new Error(t('qrimport.errDecoderLib')))
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
          reject(new Error(t('qrimport.errNotFound')))
        } catch (e) {
          reject(new Error(t('qrimport.errImageDecode')))
        }
      }
      img.onerror = () => reject(new Error(t('qrimport.errImageRead')))
      img.src = reader.result
    }
    reader.onerror = () => reject(new Error(t('qrimport.errFileRead')))
    reader.readAsDataURL(file)
  })
}

/* ── 识别后的统一处理：自动解密并导入（D8 修复，对齐原版 _processQrText） ── */

async function handleQrText(text) {
  step.value = 'working'
  setStatus(t('qrimport.recognized'))
  // 对齐原版：自动取会话主密码解密，无需再次输入
  const password = getSession()
  if (!password) {
    setStatus(t('qrimport.errNoSession'), 'danger')
    step.value = 'upload'
    return
  }
  try {
    const decrypted = await qrStringToEntry(text, password)
    entry.value = decrypted
    await autoImport(decrypted)
  } catch (e) {
    setStatus(e.message || t('qrimport.errImport'), 'danger')
    step.value = 'upload'
  }
}

/* 校验二维码格式并解密 */
async function qrStringToEntry(qrText, masterPassword) {
  let obj
  try {
    obj = JSON.parse(String(qrText).trim())
  } catch (e) {
    throw new Error(t('qrimport.errNotLockPassContent'))
  }
  if (!obj || obj.format !== QR_FORMAT) {
    throw new Error(t('qrimport.errNotLockPass'))
  }
  if (!obj.salt || !obj.iv || !obj.data) {
    throw new Error(t('qrimport.errIncomplete'))
  }
  try {
    const salt = window.CryptoUtils.base64ToArrayBuffer(obj.salt)
    const key = await window.CryptoUtils.deriveKey(masterPassword, new Uint8Array(salt))
    return await window.CryptoUtils.decrypt(obj.data, obj.iv, key)
  } catch (e) {
    throw new Error(t('qrimport.errPwOrCorrupt'))
  }
}

/* 自动同步导入：无重复直接插入；有重复询问是否替换（对齐原版 _autoImport） */
async function autoImport(e) {
  const dup = vaultState.entries.find(x =>
    (x.title || '') === (e.title || '') &&
    (x.username || '') === (e.username || '')
  )
  if (dup) {
    const dupLabel = `${e.title || t('common.unnamed')}${e.username ? t('import.withUser', { user: e.username }) : ''}`
    const ok = await window.Utils.confirm({
      title: t('import.dupFoundTitle'),
      message: t('import.dupFoundMsg', { label: dupLabel }),
      confirmText: t('import.dupReplace'),
      cancelText: t('import.dupSkip'),
      danger: true,
    })
    if (!ok) {
      window.Utils.showToast(t('qrimport.skippedContinue'), 'info')
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
  if (dup) {
    // 替换导入：迁移旧条目的密码历史到新条目，避免孤儿明文历史滞留加密存储
    if (vaultState.history[dup.id]) {
      vaultState.history[newEntry.id] = vaultState.history[dup.id]
      delete vaultState.history[dup.id]
    }
  }
  await saveVault()
  window.Utils.showToast(dup ? t('qrimport.doneReplaced') : t('qrimport.done'), 'success')

  // 短暂停留后回到上传视图，可继续导入下一张
  setTimeout(() => resetToUpload(), 1500)
}

/* ── 摄像头实时取景扫码（D8 修复，对齐原版 QR.startCameraScan / _initCameraScan / _scanLoop） ── */

async function startCameraScan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    window.Utils.showToast(t('qrimport.errNoCamera'), 'error')
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
    setStatus(t('qrimport.errCameraAccess', { msg: e.message || e }), 'danger')
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
      setStatus(t('qrimport.tapToScan'), 'muted')
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
      setStatus(t('qrimport.errDecoderLibRetry'), 'danger')
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
        setStatus(t('qrimport.scanSuccess'))
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
      <h3>{{ t('qrimport.title') }}</h3>
      <button class="btn-icon" @click="closeModal()">
        <span v-html="Icons.close(16)"></span>
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
        <div>{{ t('qrimport.dropHere') }}</div>
        <div class="text-muted text-sm mt-1">{{ t('qrimport.dropHint') }}</div>
        <input id="qr-import-file" type="file" accept="image/*" style="display:none" @change="onFileChange" />
      </div>

      <!-- 步骤二：摄像头实时取景扫码 -->
      <div v-else-if="step === 'scan'" class="qr-scan-frame">
        <video id="qr-scan-video" autoplay playsinline muted></video>
        <canvas id="qr-scan-canvas" class="hidden" aria-hidden="true"></canvas>
        <div class="text-muted text-sm text-center mt-2">{{ t('qrimport.frameHint') }}</div>
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
        {{ t('qrimport.btnScan') }}
      </button>
    </div>

    <div class="modal-footer">
      <template v-if="step === 'upload'">
        <button class="btn btn-secondary" @click="closeModal()">{{ t('confirm.default.cancel') }}</button>
      </template>
      <template v-else-if="step === 'scan'">
        <button class="btn btn-secondary" @click="cancelCameraScan()">{{ t('qrimport.btnBackUpload') }}</button>
        <button class="btn btn-secondary" @click="closeModal()">{{ t('modal.close') }}</button>
      </template>
      <template v-else>
        <button class="btn btn-secondary" @click="resetToUpload()">{{ t('qrimport.btnBack') }}</button>
      </template>
    </div>
  </ModalBase>
</template>
