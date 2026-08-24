<script setup>
/* LockPass — 认证视图（创建 / 解锁 / 锁定屏） */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'

const { handleUnlock, openRestoreFilePicker, handleRestoreFileSelect, bindRestoreFromDirectory } = useVault()

const password = ref('')
const confirmPassword = ref('')
const showPw = ref(false)

const isCreateMode = computed(() => !vaultState.initialized)
// 浏览器环境（非 Tauri）且支持文件系统 API 时，提供「绑定已有数据目录」恢复
const canBindRestore = computed(() =>
  isCreateMode.value &&
  !(window.FileStore && window.FileStore.isTauri) &&
  !!(window.FileSync && window.FileSync.isSupported()),
)
const titleText = computed(() => (vaultState.initialized ? '密码保险箱' : '创建密码保险箱'))
const subtitleText = computed(() =>
  vaultState.initialized ? '输入主密码解锁您的密码库' : '设置一个主密码保护您的所有密码',
)
const btnText = computed(() => {
  if (vaultState.lockBusy) return '…'
  return vaultState.initialized ? '解锁' : '创建保险箱'
})

const strength = ref({ label: '', pct: 0, color: '' })

function updateStrength() {
  if (!isCreateMode.value || !password.value) {
    strength.value = { label: '', pct: 0, color: '' }
    return
  }
  try {
    strength.value = window.PasswordGenerator.calcStrength(password.value)
  } catch (e) {
    strength.value = { label: '', pct: 0, color: '' }
  }
}

function toggleShowPw() {
  showPw.value = !showPw.value
}

async function onSubmit() {
  if (isCreateMode.value && password.value !== confirmPassword.value) {
    vaultState.lockError = '两次输入的密码不一致'
    return
  }
  await handleUnlock(password.value)
}

// R5 修复：恢复/绑定成功后 initialized 翻转为 true，界面从创建模式切到解锁模式，
// 清空密码输入框与错误提示，避免旧输入残留
watch(
  () => vaultState.initialized,
  () => {
    password.value = ''
    confirmPassword.value = ''
    vaultState.lockError = ''
  },
)

onMounted(() => {
  if (window.LockParticles) window.LockParticles.start()
  // 安全上下文：非安全环境（如 file://）下 Web Crypto 部分能力受限的提示保持静默
})

onBeforeUnmount(() => {
  if (window.LockParticles) window.LockParticles.stop()
})
</script>

<template>
  <div id="lock-screen">
    <canvas id="lock-bg" aria-hidden="true"></canvas>
    <div class="lock-box">
      <div class="empty-illustration lock-illustration">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <h1 class="lock-title">{{ titleText }}</h1>
      <p class="lock-subtitle">{{ subtitleText }}</p>

      <form id="lock-form" class="lock-form" @submit.prevent="onSubmit">
        <div class="input-group">
          <input
            id="master-password"
            v-model="password"
            :type="showPw ? 'text' : 'password'"
            :placeholder="isCreateMode ? '设置主密码' : '输入主密码'"
            autocomplete="new-password"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            tabindex="1"
            @input="updateStrength"
          />
          <button class="toggle-pw" type="button" title="显示/隐藏" tabindex="-1" @click="toggleShowPw">
            <svg v-if="!showPw" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        </div>

        <div v-if="isCreateMode" id="confirm-pw-group" class="input-group">
          <input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            placeholder="再次输入主密码确认"
            autocomplete="new-password"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            tabindex="2"
          />
        </div>

        <div v-if="isCreateMode" id="master-pw-strength-wrap" class="mt-2" :class="password ? '' : 'hidden'">
          <div class="pw-strength-bar-bg pw-strength-bg-border">
            <div id="master-pw-strength-bar" class="pw-strength-bar" :style="{ width: strength.pct + '%', background: strength.color }"></div>
          </div>
          <div id="master-pw-strength-text" class="text-muted pw-strength-text">{{ strength.label }}</div>
        </div>

        <div id="lock-error" v-if="vaultState.lockError" class="text-danger text-sm mt-1">{{ vaultState.lockError }}</div>

        <button id="unlock-btn" class="btn btn-primary btn-full" type="submit" :disabled="vaultState.lockBusy" tabindex="3">
          {{ btnText }}
        </button>

        <!-- 首次使用：从本地备份 / 绑定数据目录恢复（与原生 main.js 行为一致，按钮位于 form 内且无分隔线） -->
        <input
          v-if="isCreateMode"
          id="restore-file-input"
          class="hidden"
          type="file"
          accept=".vault,.json,application/octet-stream,application/json"
          @change="handleRestoreFileSelect"
        />
        <button v-if="isCreateMode" id="restore-file-btn" class="btn btn-ghost btn-full" type="button" tabindex="4" @click="openRestoreFilePicker()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          从本地文件恢复
        </button>
        <button
          v-if="canBindRestore"
          id="bind-restore-btn"
          class="btn btn-ghost btn-full"
          type="button"
          tabindex="5"
          @click="bindRestoreFromDirectory()"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          绑定已有数据目录
        </button>
      </form>

      <p class="lock-hint">数据仅保存在本地设备，不会上传到任何服务器</p>
    </div>
  </div>
</template>
