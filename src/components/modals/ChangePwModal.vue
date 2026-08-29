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
const showOldPw = ref(false)
const showNewPw = ref(false)
const showConfirmPw = ref(false)

// P3-4 / N4：图标统一走 Utils.SvgIcons（移除内联 SVG 与 eyeOpenPaths/eyeClosedPaths 拼接）
const Icons = window.Utils.SvgIcons

function showError(msg) {
  window.Utils.showToast(msg, 'error')
}

async function changePassword() {
  if (!oldPw.value) return showError('请输入当前主密码')
  if (newPw.value.length < 8) return showError('新密码至少需要 8 位')
  if (newPw.value !== confirmPw.value) return showError('两次输入的新密码不一致')

  busy.value = true

  // 第一步：仅校验旧密码（单独捕获——只有这里失败才是「当前主密码错误」）
  try {
    // 读取并派生旧密钥，尝试解密
    const saltRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'salt')
    const salt = window.CryptoUtils.base64ToArrayBuffer(saltRecord.value)
    const iterRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'iterations')
    const iterations = iterRecord ? (Number(iterRecord.value) || window.CryptoUtils.LEGACY_ITERATIONS) : window.CryptoUtils.LEGACY_ITERATIONS
    const oldKey = await window.CryptoUtils.deriveKey(oldPw.value, new Uint8Array(salt), iterations)

    const vaultRecord = await window.DBUtils.dbGet(window.DBUtils.STORE_VAULT, 'main')
    await window.CryptoUtils.decrypt(vaultRecord.data, vaultRecord.iv, oldKey)
  } catch (e) {
    window.Utils.showToast('当前主密码错误', 'error')
    busy.value = false
    return
  }

  // 第二步：重加密与保存（此段异常不再误报为「当前主密码错误」）
  try {
    // 新盐 + 新密钥（升级到 DEFAULT_ITERATIONS 以获得更强保护）
    const newIterations = window.CryptoUtils.DEFAULT_ITERATIONS
    const newSalt = window.CryptoUtils.generateSalt()
    const newKey = await window.CryptoUtils.deriveKey(newPw.value, newSalt, newIterations)

    // 重新加密数据（包含密码历史，确保修改密码后历史记录可用）
    const { iv, data } = await window.CryptoUtils.encrypt(
      {
        entries: vaultState.entries,
        history: vaultState.history,
        tagDefs: vaultState.tagDefs,
        tags: vaultState.tags,
        deleted: vaultState.deleted,
      },
      newKey,
    )

    // 保存新盐值、新迭代次数与加密数据
    await window.DBUtils.dbPut(window.DBUtils.STORE_META, { key: 'salt', value: window.CryptoUtils.arrayBufferToBase64(newSalt) })
    await window.DBUtils.dbPut(window.DBUtils.STORE_META, { key: 'iterations', value: newIterations })
    await window.DBUtils.dbPut(window.DBUtils.STORE_VAULT, { id: 'main', iv, data })

    // 更新内存密钥
    vaultState.cryptoKey = newKey

    // 同步本地文件（已绑定目录时；未绑定时内部静默跳过）
    await window.FileSync.syncNow()

    closeModal()
    openModal('settings')
    window.Utils.showToast('主密码已修改', 'success')
  } catch (e) {
    window.Utils.showToast('修改失败：' + ((e && e.message) || '请重试'), 'error')
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
        <span v-html="Icons.close(16)"></span>
      </button>
    </div>
    <div class="modal-body">
      <div class="lock-warning" role="alert">
        <span class="lock-warning-icon" v-html="Icons.alert(14)"></span>
        <span class="text-sm">此操作不可撤销：修改后需使用新密码解锁，如遗忘新主密码，将无法恢复保险箱内任何数据。请确保牢记新密码。</span>
      </div>
      <div class="form-group">
        <label class="form-label">当前主密码</label>
        <div class="input-affix">
          <input v-model="oldPw" class="form-input" :type="showOldPw ? 'text' : 'password'" placeholder="输入当前主密码" autocomplete="off" />
          <div class="input-affix-btns">
            <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="showOldPw = !showOldPw">
              <span v-html="showOldPw ? Icons.eyeClosed(15) : Icons.eyeOpen(15)"></span>
            </button>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">新主密码</label>
        <div class="input-affix">
          <input v-model="newPw" class="form-input" :type="showNewPw ? 'text' : 'password'" placeholder="至少 8 位" autocomplete="off" />
          <div class="input-affix-btns">
            <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="showNewPw = !showNewPw">
              <span v-html="showNewPw ? Icons.eyeClosed(15) : Icons.eyeOpen(15)"></span>
            </button>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">确认新密码</label>
        <div class="input-affix">
          <input v-model="confirmPw" class="form-input" :type="showConfirmPw ? 'text' : 'password'" placeholder="再次输入新密码" autocomplete="off" />
          <div class="input-affix-btns">
            <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="showConfirmPw = !showConfirmPw">
              <span v-html="showConfirmPw ? Icons.eyeClosed(15) : Icons.eyeOpen(15)"></span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" @click="closeModal()">取消</button>
      <button class="btn btn-primary" :disabled="busy" @click="changePassword()">{{ busy ? '修改中…' : '确认修改' }}</button>
    </div>
  </ModalBase>
</template>