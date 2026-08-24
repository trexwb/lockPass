<script setup>
/* LockPass — 修改主密码模态框（Vue 迁移）
   复刻原生 settings.js changePassword()：
   验证旧密码 → 新盐 + 新密钥 → 重新加密 → 保存 → 更新内存密钥 → 同步本地文件 */
import { ref } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'

const { closeModal, openModal, saveVault } = useVault()

const oldPw = ref('')
const newPw = ref('')
const confirmPw = ref('')
const busy = ref(false)

function showError(msg) {
  window.Utils.showToast(msg, 'error')
}

async function changePassword() {
  if (!oldPw.value) return showError('请输入当前主密码')
  if (newPw.value.length < 8) return showError('新密码至少需要 8 位')
  if (newPw.value !== confirmPw.value) return showError('两次输入的新密码不一致')

  busy.value = true
  try {
    // 验证旧密码（读取并派生旧密钥，尝试解密）
    const saltRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'salt')
    const salt = window.CryptoUtils.base64ToArrayBuffer(saltRecord.value)
    const iterRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'iterations')
    const iterations = iterRecord ? (Number(iterRecord.value) || 100000) : 100000
    const oldKey = await window.CryptoUtils.deriveKey(oldPw.value, new Uint8Array(salt), iterations)

    const vaultRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_VAULT, 'main')
    await window.CryptoUtils.decrypt(vaultRecord.data, vaultRecord.iv, oldKey)

    // 新盐 + 新密钥（沿用当前 iterations，保证派生参数一致）
    const newSalt = window.CryptoUtils.generateSalt()
    const newKey = await window.CryptoUtils.deriveKey(newPw.value, newSalt, iterations)

    // 重新加密数据
    const { iv, data } = await window.CryptoUtils.encrypt(
      {
        entries: vaultState.entries,
        tagDefs: vaultState.tagDefs,
        tags: vaultState.tags,
        deleted: vaultState.deleted,
      },
      newKey,
    )

    // 保存新盐值与加密数据
    await window.DBUtils.dbPut(window.DBUtils.STORE_META, { key: 'salt', value: window.CryptoUtils.arrayBufferToBase64(newSalt) })
    await window.DBUtils.dbPut(window.DBUtils.STORE_VAULT, { id: 'main', iv, data })

    // 更新内存密钥
    vaultState.cryptoKey = newKey

    // 同步本地文件（已绑定目录时；未绑定时内部静默跳过）
    await window.FileSync.syncNow()

    closeModal()
    openModal('settings')
    window.Utils.showToast('主密码已修改', 'success')
  } catch (e) {
    window.Utils.showToast('当前主密码错误', 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalBase :max-width="'420px'" @close="closeModal()">
    <div class="modal-header">
      <h2>修改主密码</h2>
      <button class="btn-icon" @click="closeModal()" tabindex="-1">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">当前主密码</label>
        <input v-model="oldPw" class="form-input" type="password" placeholder="输入当前主密码" autocomplete="off" />
      </div>
      <div class="form-group">
        <label class="form-label">新主密码</label>
        <input v-model="newPw" class="form-input" type="password" placeholder="至少 8 位" autocomplete="off" />
      </div>
      <div class="form-group">
        <label class="form-label">确认新密码</label>
        <input v-model="confirmPw" class="form-input" type="password" placeholder="再次输入新密码" autocomplete="off" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" @click="closeModal()">取消</button>
      <button class="btn btn-primary" :disabled="busy" @click="changePassword()">{{ busy ? '修改中…' : '确认修改' }}</button>
    </div>
  </ModalBase>
</template>