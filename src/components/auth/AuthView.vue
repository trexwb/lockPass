<script setup>
/* LockPass — 认证视图（创建 / 解锁 / 锁定屏） */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'

const { handleUnlock, openRestoreFilePicker, handleRestoreFileSelect, bindRestoreFromDirectory } = useVault()

// P3-4：图标统一走 Utils.SvgIcons（消除与图标库的重复定义）
const Icons = window.Utils.SvgIcons
// P3-12 试点：锁屏文案走 i18n 语言包（新代码起统一用 I18n.t）
const t = window.I18n.t

const password = ref('')
const confirmPassword = ref('')
const showPw = ref(false)
// D9 修复：非安全上下文（http 非 localhost）下 Web Crypto 不可用，阻断并禁用解锁按钮
const blocked = ref(false)

const isCreateMode = computed(() => !vaultState.initialized)
// 浏览器环境（非 Tauri）且支持文件系统 API 时，提供「绑定已有数据目录」恢复
const canBindRestore = computed(() =>
  isCreateMode.value &&
  !(window.FileStore && window.FileStore.isTauri) &&
  !!(window.FileSync && window.FileSync.isSupported()),
)
const titleText = computed(() => (vaultState.initialized ? t('lock.titleUnlock') : t('lock.titleCreate')))
// D12 修复：创建模式副标题对齐原版「设置一个强主密码来保护您的所有密码」
const subtitleText = computed(() =>
  vaultState.initialized ? t('lock.subtitleUnlock') : t('lock.subtitleCreate'),
)
const btnText = computed(() => {
  if (vaultState.lockBusy) return '…'
  // D12 修复：创建模式按钮文案对齐原版「创建」
  return vaultState.initialized ? t('lock.btnUnlock') : t('lock.btnCreate')
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

/* 忘记主密码：管理预期并引导恢复/销毁路径（离线加密无找回可能） */
function showForgotPassword() {
  window.Utils.confirm({
    title: '无法找回主密码',
    message: 'LockPass 采用离线加密设计，主密码本身无法找回。\n\n• 如曾绑定数据目录：可从目录中的加密备份恢复\n• 如保存过 .vault 备份文件：可在「创建」界面选择「从本地备份恢复」\n• 否则只能销毁当前保险箱并重新创建（所有数据将被清空）',
    confirmText: '我知道了',
    cancelText: '关闭',
  })
}

/* ── P3-9：解锁失败指数退避（会话内计数，防离线暴力尝试） ── */
const FAIL_BACKOFF_THRESHOLD = 5  // 连续失败达到该次数后进入冷却
const BACKOFF_BASE_MS = 1000     // 首次冷却 1s，之后指数翻倍
const BACKOFF_MAX_MS = 30000     // 冷却上限 30s
const failCount = ref(0)
const cooldownRemain = ref(0)    // 剩余冷却秒数，>0 时禁用提交
let cooldownTimer = null

/**
 * 启动指数退避冷却：第 5 次失败 1s、第 6 次 2s、第 7 次 4s … 封顶 30s
 */
function startBackoffCooldown() {
  const exponent = failCount.value - FAIL_BACKOFF_THRESHOLD // 0 起
  const ms = Math.min(BACKOFF_BASE_MS * Math.pow(2, exponent), BACKOFF_MAX_MS)
  cooldownRemain.value = Math.ceil(ms / 1000)
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    cooldownRemain.value -= 1
    if (cooldownRemain.value <= 0) {
      cooldownRemain.value = 0
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

/** 复位退避状态（解锁成功 / 恢复流程切模式时） */
function resetBackoff() {
  failCount.value = 0
  cooldownRemain.value = 0
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
  }
}

// 冷却期间用剩余秒数提示替代原错误文案，避免误导
const errorText = computed(() =>
  cooldownRemain.value > 0
    ? t('lock.errorBackoff', { sec: cooldownRemain.value })
    : vaultState.lockError,
)

async function onSubmit() {
  if (cooldownRemain.value > 0) return
  if (isCreateMode.value && password.value !== confirmPassword.value) {
    vaultState.lockError = t('lock.errorPwMismatch')
    return
  }
  await handleUnlock(password.value)
  // 仅解锁模式计数失败（创建模式没有既存保险箱可暴力破解）
  if (!isCreateMode.value && !vaultState.isUnlocked) {
    if (vaultState.lockError) {
      failCount.value += 1
      if (failCount.value >= FAIL_BACKOFF_THRESHOLD) startBackoffCooldown()
    }
  } else if (vaultState.isUnlocked) {
    resetBackoff()
  }
}

// R5 修复：恢复/绑定成功后 initialized 翻转为 true，界面从创建模式切到解锁模式，
// 清空密码输入框与错误提示，避免旧输入残留（同时复位 P3-9 退避状态）
watch(
  () => vaultState.initialized,
  () => {
    password.value = ''
    confirmPassword.value = ''
    vaultState.lockError = ''
    resetBackoff()
  },
)

onMounted(() => {
  if (window.LockParticles) window.LockParticles.start()
  // D9 修复：非安全上下文（http 非 localhost / file://）下 Web Crypto 不可用，
  // 对齐原版 main.js init——阻断创建/解锁并给出明确提示，解锁按钮禁用
  if (!window.isSecureContext) {
    blocked.value = true
    vaultState.lockError = window.location.protocol === 'file:'
      ? '本地文件环境（file://）加密功能受限。建议使用本地 HTTP 服务器（python -m http.server）以获得最佳体验，或双击 index.html 直接运行。'
      : '当前通过 http 访问，浏览器禁用了加密功能（Web Crypto）。请改用 https 访问，或本地双击 index.html 使用。'
    return
  }
  // D11 修复：创建模式防浏览器密码管理器异步自动填充（对齐原版 main.js init），
  // 等浏览器完成自动填充后清空密码框，避免主密码被错误预填
  if (isCreateMode.value) {
    setTimeout(() => {
      const master = document.getElementById('master-password')
      const confirm = document.getElementById('confirm-password')
      if (document.activeElement !== master && document.activeElement !== confirm) {
        // P3-7 修复：清 ref（v-model 真源）而非只清 DOM value，避免 DOM 与 v-model 失同步
        password.value = ''
        confirmPassword.value = ''
      }
    }, 250)
  }
})

onBeforeUnmount(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
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

      <!-- P2-10 修复：创建模式显式警示「主密码无法找回」（对齐 spec §5.3 风险表与密码管理器行业惯例） -->
      <div v-if="isCreateMode" class="lock-warning" role="alert">
        <span v-html="Icons.alert(14)"></span>
        <span>{{ t('lock.masterPwWarning') }}</span>
      </div>

      <form id="lock-form" class="lock-form" @submit.prevent="onSubmit">
        <div class="input-group">
          <input
            id="master-password"
            v-model="password"
            :type="showPw ? 'text' : 'password'"
            :placeholder="isCreateMode ? t('lock.pwPlaceholderCreate') : t('lock.pwPlaceholderUnlock')"
            :autocomplete="isCreateMode ? 'new-password' : 'current-password'"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            tabindex="1"
            @input="updateStrength"
          />
          <button class="toggle-pw" type="button" title="显示/隐藏" tabindex="-1" @click="toggleShowPw">
            <span v-if="!showPw" v-html="Icons.eyeOpen(16)"></span>
            <span v-else v-html="Icons.eyeClosed(16)"></span>
          </button>
        </div>

        <div v-if="isCreateMode" id="confirm-pw-group" class="input-group">
          <input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            :placeholder="t('lock.pwConfirmPlaceholder')"
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

        <div id="lock-error" v-if="errorText" class="text-danger text-sm mt-1" role="alert">{{ errorText }}</div>

        <button id="unlock-btn" class="btn btn-primary btn-full" type="submit" :disabled="blocked || vaultState.lockBusy || cooldownRemain > 0" tabindex="3">
          {{ cooldownRemain > 0 ? t('lock.errorBackoffBtn', { sec: cooldownRemain }) : btnText }}
        </button>

        <!-- 忘记主密码：离线加密无找回可能，主动管理预期并引导备份恢复/销毁重建 -->
        <button
          v-if="!isCreateMode"
          id="forgot-pw-link"
          class="btn-link-plain text-muted text-sm"
          type="button"
          tabindex="3"
          @click="showForgotPassword"
        >忘记主密码？</button>

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
          <span v-html="Icons.upload(13)"></span>
          {{ t('lock.restoreFromFile') }}
        </button>
        <button
          v-if="canBindRestore"
          id="bind-restore-btn"
          class="btn btn-ghost btn-full"
          type="button"
          tabindex="5"
          @click="bindRestoreFromDirectory()"
        >
          <span v-html="Icons.folder(13)"></span>
          {{ t('lock.bindDirectory') }}
        </button>
      </form>

      <p class="lock-hint">{{ t('lock.hint') }}</p>
    </div>
  </div>
</template>
