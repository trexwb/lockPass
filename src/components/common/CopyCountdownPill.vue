<script setup>
/**
 * CopyCountdownPill — 复制成功倒计时胶囊
 *
 * 设计目标（替代旧版 5 路反馈）：
 *  - 合并 Toast「已复制」+ 浮动倒计时提示为统一胶囊
 *  - 由 vaultState.clipboardCountdown 响应式状态驱动，不再跨层 DOM 操控
 *  - 底部进度条直观展示剩余时间，颜色随紧迫度渐变
 *  - 可手动关闭；剪贴板清除后自动消失
 *
 * 状态来源：vaultState.clipboardCountdown = { active, remaining, total }
 * 剩余反馈保留：按钮高亮(.copied) + srAnnounce（均在 useVault 中维护）
 */
import { computed } from 'vue'
import { vaultState } from '../../composables/useVault'

const Icons = window.Utils.SvgIcons

const cd = computed(() => vaultState.clipboardCountdown)

/** 进度条宽度百分比（100% → 0%） */
const progressPct = computed(() => {
  const c = cd.value
  if (!c || !c.total || c.total <= 0) return 0
  return Math.max(0, Math.min(100, (c.remaining / c.total) * 100))
})

/** 倒计时颜色：>10s 绿 / ≤10s 琥珀 / ≤5s 红 */
const progressColor = computed(() => {
  const r = cd.value?.remaining ?? 0
  if (r <= 5) return 'var(--danger)'
  if (r <= 10) return 'var(--warning)'
  return 'var(--success)'
})

/** 手动关闭 */
function dismiss() {
  vaultState.clipboardCountdown.active = false
}
</script>

<template>
  <!-- Teleport 到 body：脱离 #app-shell 的 overflow:hidden 容器，
       确保 position:fixed 始终相对视口（避免 Tauri webview / 小窗口定位错乱） -->
  <Teleport to="body">
    <Transition name="pill-slide">
      <div
        v-if="cd.active"
        class="copy-pill"
        role="status"
        aria-live="polite"
        aria-label="已复制到剪贴板，剩余秒数后自动清除"
      >
        <span class="copy-pill-icon" v-html="Icons.check(14)"></span>
        <span class="copy-pill-text">已复制</span>
        <span class="copy-pill-count" :style="{ color: progressColor }">{{ cd.remaining }}s</span>
        <span class="copy-pill-suffix">后清除</span>
        <button
          class="copy-pill-dismiss"
          title="关闭"
          aria-label="关闭提示"
          @click="dismiss"
        >
          <span v-html="Icons.close(12)"></span>
        </button>
        <!-- 底边进度条：宽度百分比从 100 → 0，颜色随紧迫度变化 -->
        <div
          class="copy-pill-bar"
          :style="{ width: progressPct + '%', background: progressColor }"
        ></div>
      </div>
    </Transition>
  </Teleport>
</template>
