<script setup>
/* LockPass — 一键配对确认弹窗（桌面版专用）
   流程：扩展 POST /pair → Rust 生成 nonce 并 emit 事件 →
   本组件弹出 nonce 供用户确认 → 用户允许后 confirmPair 发放 token，
   扩展轮询 /pair/poll 领取 token，完成配对。
   该弹窗不占用 activeModal，可在任意界面弹出。 */
import { ref, onMounted, onBeforeUnmount } from 'vue'

const visible = ref(false)
const nonce = ref('')
const busy = ref(false)

function show(n) {
  nonce.value = n || ''
  visible.value = true
}

function close() {
  visible.value = false
  nonce.value = ''
}

async function onAllow() {
  if (busy.value || !nonce.value) return
  busy.value = true
  try {
    if (window.TauriServer) {
      await window.TauriServer.confirmPair(nonce.value)
      window.Utils.showToast('扩展配对成功，可自动填充密码', 'success')
    }
    close()
  } catch (e) {
    window.Utils.showToast('配对失败：' + (e.message || '未知错误'), 'error')
  } finally {
    busy.value = false
  }
}

async function onReject() {
  if (busy.value || !nonce.value) return
  busy.value = true
  try {
    if (window.TauriServer) {
      await window.TauriServer.rejectPair(nonce.value)
    }
  } catch (e) { /* 忽略取消时的错误 */ }
  window.Utils.showToast('已拒绝配对请求', 'info')
  close()
  busy.value = false
}

function onPairRequest(e) {
  show(e.detail)
}

function onKeydown(e) {
  if (e.key === 'Escape' && visible.value) {
    onReject()
  }
}

onMounted(async () => {
  window.addEventListener('lockpass:pair-request', onPairRequest)
  document.addEventListener('keydown', onKeydown)
  // 回查：应用挂载早于事件注册时可能漏掉的事件，主动查询兜底
  try {
    if (window.TauriServer) {
      const pending = await window.TauriServer.getPendingPair()
      if (pending) show(pending)
    }
  } catch (e) { /* 忽略 */ }
})

onBeforeUnmount(() => {
  window.removeEventListener('lockpass:pair-request', onPairRequest)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="visible" class="lp-pair-overlay" @click.self="onReject">
    <div class="lp-pair-card" role="dialog" aria-modal="true" aria-label="浏览器扩展配对请求">
      <h3>浏览器扩展配对请求</h3>
      <p class="lp-pair-desc">检测到浏览器扩展请求连接 LockPass。请在扩展弹窗中确认显示的数字是否一致：</p>
      <div class="lp-pair-nonce">{{ nonce }}</div>
      <div class="lp-pair-actions">
        <button class="btn btn-secondary" :disabled="busy" @click="onReject">拒绝</button>
        <button class="btn btn-primary" :disabled="busy" @click="onAllow">允许配对</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lp-pair-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.lp-pair-card {
  width: 360px;
  max-width: calc(100vw - 48px);
  background: var(--bg2, #161b22);
  border: 1px solid var(--border, #30363d);
  border-radius: 12px;
  padding: 22px 24px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.lp-pair-card h3 { margin: 0 0 10px; font-size: 16px; }
.lp-pair-desc { margin: 0 0 14px; font-size: 13px; color: var(--muted, #8b949e); line-height: 1.6; }
.lp-pair-nonce {
  margin: 0 auto 18px;
  width: 160px;
  text-align: center;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 6px;
  padding: 10px 0;
  border-radius: 8px;
  background: var(--bg3, #21262d);
  color: var(--accent, #58a6ff);
  font-variant-numeric: tabular-nums;
}
.lp-pair-actions { display: flex; justify-content: flex-end; gap: 10px; }
</style>
