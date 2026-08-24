<script setup>
/* LockPass — 二维码添加（识别二维码图片并导入）
   Vue 3 迁移：对齐旧版 src/js/qr-sync.js 的载荷结构与解码流程
   - 上传 / 粘贴 / 拖拽二维码图片 → 懒加载 /assets/vendor/jsQR.js 解码
   - 输入主密码解密（base64ToArrayBuffer / deriveKey / decrypt）
   - 校验 format === 'LockPass-QR v1' → 预览条目 → 按标题+用户名查重合并 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'

const { saveVault, closeModal } = useVault()

const QR_FORMAT = 'LockPass-QR v1'

const step = ref('upload') // 'upload' | 'decrypt' | 'preview'
const statusMsg = ref('')
const statusType = ref('')
const fileName = ref('')
const qrText = ref('')
const masterPassword = ref('')
const entry = ref(null)
const decrypting = ref(false)

// 移动端 / PAD 才显示「扫码识别」：capture 直接调起系统后置相机，拍完照走图片解码流程
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh|Mac OS X|Mac/.test(navigator.userAgent))

function scanCamera() {
  const input = document.getElementById('qr-camera-input')
  if (input) input.click()
}

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

async function processImage(file) {
  fileName.value = file.name || ''
  step.value = 'decrypt'
  setStatus('正在识别二维码…')
  try {
    const text = await decodeImageFile(file)
    qrText.value = text
    setStatus('二维码识别成功，请输入主密码解密')
  } catch (e) {
    setStatus(e.message || '二维码识别失败', 'danger')
    step.value = 'upload'
  }
}

async function decodeImageFile(file) {
  await _loadVendor('/assets/vendor/jsQR.js', () => typeof jsQR === 'function')
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

async function decryptQr() {
  if (!masterPassword.value || decrypting.value) return
  decrypting.value = true
  try {
    const decrypted = await qrStringToEntry(qrText.value, masterPassword.value)
    entry.value = decrypted
    step.value = 'preview'
  } catch (e) {
    setStatus(e.message || '解密失败', 'danger')
  } finally {
    decrypting.value = false
  }
}

/* 预览后确认导入：标题 + 用户名查重，替换 / 跳过 */
async function confirmImport() {
  if (!entry.value) return
  const e = entry.value
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
      resetToUpload()
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

function resetToUpload() {
  step.value = 'upload'
  statusMsg.value = ''
  statusType.value = ''
  fileName.value = ''
  qrText.value = ''
  masterPassword.value = ''
  entry.value = null
}

onMounted(() => {
  document.addEventListener('paste', onPaste)
})

onUnmounted(() => {
  document.removeEventListener('paste', onPaste)
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

      <!-- 步骤二：输入主密码解密 -->
      <div v-else-if="step === 'decrypt'">
        <div class="text-sm text-muted mb-2">
          <template v-if="fileName">文件：{{ fileName }}</template>
        </div>
        <div v-if="statusMsg" :class="['text-sm mb-2', statusType === 'danger' ? 'text-danger' : 'text-muted']">{{ statusMsg }}</div>
        <div class="form-group">
          <input v-model="masterPassword" class="form-input" type="password" placeholder="输入主密码解密" @keydown.enter.prevent="decryptQr()" />
        </div>
        <div class="text-muted text-sm mt-2">二维码由 LockPass 加密，需要使用导出时所用的主密码解密</div>
      </div>

      <!-- 步骤三：预览并确认导入 -->
      <div v-else-if="step === 'preview'">
        <div class="qr-import-preview">
          <div class="text-sm"><strong>{{ entry.title || '未命名' }}</strong></div>
          <div class="text-muted text-sm mt-1">
            类型：{{ entry.entryType || 'website' }} · 用户名：{{ entry.username || '—' }} · 标签：{{ (entry.tags || []).join('、') || '—' }}
          </div>
          <div class="text-warning text-sm mt-2">确认后按「标题 + 用户名」查重，重复条目会询问替换或跳过</div>
        </div>
      </div>

      <!-- 移动端 / PAD：直接调起摄像头扫码 -->
      <button
        v-if="isMobile && step === 'upload'"
        class="btn btn-primary btn-full mt-3 qr-scan-camera"
        @click="scanCamera()"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        扫码识别
      </button>
      <input id="qr-camera-input" type="file" accept="image/*" capture="environment" style="display:none" @change="onFileChange" />
    </div>

    <div class="modal-footer">
      <template v-if="step === 'upload'">
        <button class="btn btn-secondary" @click="closeModal()">取消</button>
      </template>
      <template v-else-if="step === 'decrypt'">
        <button class="btn btn-secondary" @click="resetToUpload()">返回</button>
        <button class="btn btn-primary" :disabled="!masterPassword || decrypting" @click="decryptQr()">{{ decrypting ? '解密中…' : '解密' }}</button>
      </template>
      <template v-else>
        <button class="btn btn-secondary" @click="resetToUpload()">继续扫描</button>
        <button class="btn btn-primary" @click="confirmImport()">确认导入</button>
      </template>
    </div>
  </ModalBase>
</template>
