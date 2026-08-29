<script setup>
/* LockPass — 分享为二维码
   Vue 3 迁移：对齐旧版 src/js/qr-sync.js 的载荷结构
   （format: 'LockPass-QR v1'，payload 含 title/username/password/url/notes/tags/
   entryType/port/root/appId/privateKey）。
   主密码从 useVault 的会话（getSession）获取；二维码库懒加载 /assets/vendor/qrcode.min.js */
import { ref, watch, nextTick } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'

const { getSession, closeModal } = useVault()

// P3-4：图标统一走 Utils.SvgIcons
const Icons = window.Utils.SvgIcons

const QR_FORMAT = 'LockPass-QR v1'
const QR_VERSION = 1

const loading = ref(false)
const errorMsg = ref('')
const qrText = ref('')
const byteLen = ref(0)
const qrContainer = ref(null)

const entry = ref(null)

// 当前选中条目变化时刷新二维码（selectedEntry 存的是条目 id）
watch(
  () => vaultState.selectedEntry,
  id => {
    entry.value = id ? vaultState.entries.find(e => e.id === id) || null : null
    generate()
  },
  { immediate: true }
)

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

async function generate() {
  qrText.value = ''
  errorMsg.value = ''
  byteLen.value = 0
  if (qrContainer.value) qrContainer.value.innerHTML = ''
  if (!entry.value) return

  loading.value = true
  try {
    const password = getSession()
    if (!password) {
      errorMsg.value = '未找到会话主密码，请重新解锁后重试'
      return
    }

    const salt = window.CryptoUtils.generateSalt()
    const key = await window.CryptoUtils.deriveKey(password, salt)

    const payload = {
      title: entry.value.title || '',
      username: entry.value.username || '',
      password: entry.value.password || '',
      url: entry.value.url || '',
      notes: entry.value.notes || '',
      tags: entry.value.tags || [],
      entryType: entry.value.entryType || 'website',
      port: entry.value.port != null ? entry.value.port : undefined,
      root: entry.value.root || null,
      appId: entry.value.appId || '',
      privateKey: entry.value.privateKey || '',
    }

    const { iv, data } = await window.CryptoUtils.encrypt(payload, key)
    const text = JSON.stringify({
      format: QR_FORMAT,
      v: QR_VERSION,
      salt: window.CryptoUtils.arrayBufferToBase64(salt),
      iv,
      data,
    })

    // 预检：QR 容量上限（M 纠错级 V40 约 2331 字节），超出直接提示
    const len = new TextEncoder().encode(text).length
    byteLen.value = len
    if (len > 2200) {
      errorMsg.value = `二维码容量不足（内容约 ${(len / 1024).toFixed(1)}KB，上限约 2.2KB）。请精简备注或字段后重试，或改用文件同步传输`
      return
    }
    if (len > 1800) {
      window.Utils.showToast(`⚠️ 内容较大（${(len / 1024).toFixed(1)}KB），扫码时需保持光线充足`, 'warning')
    }

    qrText.value = text
    await nextTick()
    await _loadVendor(import.meta.env.BASE_URL + 'assets/vendor/qrcode.min.js', () => typeof QRCode === 'function')
    // 先结束 loading，使 v-else-if="qrText" 分支渲染出 qrContainer，
    // 再等待 DOM 就绪后生成图案（否则 qrContainer 为 null，静默退出导致空白）
    loading.value = false
    await nextTick()
    const container = qrContainer.value
    if (!container) return
    container.innerHTML = ''
    // 按弹窗内容区可用宽度计算二维码尺寸（上限 320，下限 180），避免小屏撑破布局
    let size = 320
    const body = container.closest('.modal-body')
    if (body) {
      const cs = window.getComputedStyle(body)
      const avail = body.clientWidth
        - parseFloat(cs.paddingLeft || 0)
        - parseFloat(cs.paddingRight || 0)
        - 24 // qr-paper 左右内边距 12px × 2
      if (avail > 0) size = Math.max(180, Math.min(320, Math.floor(avail)))
    }
    new QRCode(container, {
      text,
      width: size,
      height: size,
      correctLevel: QRCode.CorrectLevel.M,
      colorDark: '#000000',
      colorLight: '#ffffff',
    })
  } catch (e) {
    errorMsg.value = '生成失败：' + (e.message || e)
  } finally {
    loading.value = false
  }
}

async function copyQrText() {
  if (!qrText.value) return
  try {
    await window.Utils.copyText(qrText.value)
    window.Utils.showToast('二维码文本已复制', 'success')
  } catch (e) {
    window.Utils.showToast('复制失败，请手动选择复制', 'error')
  }
}
</script>

<template>
  <ModalBase :max-width="'520px'" @close="closeModal()">
    <div class="modal-header">
      <h3>分享为二维码</h3>
      <button class="btn-icon" @click="closeModal()">
        <span v-html="Icons.close(16)"></span>
      </button>
    </div>

    <div class="modal-body">
      <div v-if="!entry" class="text-muted text-sm text-center py-6">
        请先选择一条密码记录，再打开二维码分享
      </div>
      <template v-else>
        <div class="text-muted text-sm mb-3">
          将「{{ entry.title || '未命名' }}」加密为二维码，可在另一台设备扫码导入
        </div>
        <div class="text-center">
          <div v-if="loading" class="spinner-col">
            <div class="spinner"></div>
            <span class="text-muted text-sm">正在生成…</span>
          </div>
          <div v-else-if="errorMsg" class="text-danger text-sm p-6">{{ errorMsg }}</div>
          <template v-else-if="qrText">
            <div ref="qrContainer" class="qr-paper inline-block"></div>
            <p class="text-muted text-sm mt-2">二维码已加密，另一台设备扫码后自动导入</p>
            <div class="qr-text-box mt-2">
              <textarea v-model="qrText" readonly rows="3" class="form-input text-xs" spellcheck="false"></textarea>
              <button class="btn btn-secondary btn-sm mt-1" @click="copyQrText()">复制二维码文本</button>
            </div>
          </template>
        </div>
      </template>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" @click="closeModal()">关闭</button>
    </div>
  </ModalBase>
</template>
