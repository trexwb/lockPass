/* LockPass — TOTP 响应式状态 composable
   提供当前条目的 TOTP 动态码 + 倒计时，自动按周期刷新 */

import { ref, computed, watch, onUnmounted } from 'vue'

/**
 * 为单个条目提供响应式 TOTP 动态码与倒计时
 * @param {import('vue').ComputedRef<object|null>} entryRef - 条目 computed（含 totp 字段）
 * @returns {object} { code, remaining, progress, refreshing, refresh }
 */
export function useTotp(entryRef) {
  const code = ref('')
  const remaining = ref(0)
  const refreshing = ref(false)
  let timer = null

  const period = computed(() => entryRef.value?.totp?.period || 30)
  const digits = computed(() => entryRef.value?.totp?.digits || 6)
  const hasTotp = computed(() => !!entryRef.value?.totp?.secret)

  const progress = computed(() => {
    const p = period.value
    return p > 0 ? remaining.value / p : 0
  })

  async function refresh() {
    const totp = entryRef.value?.totp
    if (!totp?.secret) {
      code.value = ''
      remaining.value = 0
      return
    }
    try {
      refreshing.value = true
      code.value = await window.TOTPUtils.generateTOTP(totp.secret, {
        period: totp.period || 30,
        digits: totp.digits || 6
      })
      remaining.value = window.TOTPUtils.getRemainingSeconds(totp.period || 30)
    } catch {
      code.value = '------'
      remaining.value = 0
    } finally {
      refreshing.value = false
    }
  }

  function startTimer() {
    stopTimer()
    refresh()
    timer = setInterval(refresh, 1000)
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  watch(hasTotp, (val) => {
    if (val) startTimer()
    else stopTimer()
  }, { immediate: true })

  onUnmounted(stopTimer)

  return { code, remaining, progress, refreshing, hasTotp, refresh, startTimer, stopTimer }
}
