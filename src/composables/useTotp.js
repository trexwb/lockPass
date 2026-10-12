/* LockPass — TOTP 响应式状态 composable
   提供当前条目的 TOTP 动态码 + 倒计时，自动按周期刷新

   性能约定（节流）：秒级心跳 tick 只做同步的剩余秒数更新；动态码
   （异步 Web Crypto HMAC）仅在「周期翻转（remaining 回升）/ 首次 /
   上次计算失败 / 手动刷新」时重新生成——异步加密调用从每秒一次
   降为每周期一次，对外接口与刷新语义不变 */

import { ref, computed, watch, onUnmounted } from 'vue'

/**
 * 为单个条目提供响应式 TOTP 动态码与倒计时
 * @param {import('vue').ComputedRef<object|null>} entryRef - 条目 computed（含 totp 字段）
 * @returns {object} { code, remaining, progress, refreshing, hasTotp, refresh, startTimer, stopTimer }
 */
export function useTotp(entryRef) {
  const code = ref('')
  const remaining = ref(0)
  const refreshing = ref(false)
  let timer = null
  /** 上一次心跳记录的剩余秒数：检测周期翻转（剩余秒数回升 = 进入新周期） */
  let lastRemaining = 0

  const period = computed(() => entryRef.value?.totp?.period || 30)
  const digits = computed(() => entryRef.value?.totp?.digits || 6)
  const hasTotp = computed(() => !!entryRef.value?.totp?.secret)

  const progress = computed(() => {
    const p = period.value
    return p > 0 ? remaining.value / p : 0
  })

  /** 重新生成动态码（异步 HMAC；成功/失败都同步剩余秒数基准） */
  async function generate() {
    const totp = entryRef.value?.totp
    if (!totp?.secret) {
      code.value = ''
      remaining.value = 0
      lastRemaining = 0
      return
    }
    try {
      refreshing.value = true
      code.value = await window.TOTPUtils.generateTOTP(totp.secret, {
        period: totp.period || 30,
        digits: totp.digits || 6
      })
      remaining.value = window.TOTPUtils.getRemainingSeconds(totp.period || 30)
      lastRemaining = remaining.value
    } catch {
      code.value = '------'
      remaining.value = 0
      lastRemaining = 0
    } finally {
      refreshing.value = false
    }
  }

  /**
   * 每秒心跳（节流）：remaining 每秒更新；动态码仅在需要时重算
   * （剩余秒数回升 = 周期翻转；code 为空/上次失败 = 需要补算）
   */
  async function tick() {
    const totp = entryRef.value?.totp
    if (!totp?.secret) {
      code.value = ''
      remaining.value = 0
      return
    }
    const rem = window.TOTPUtils.getRemainingSeconds(totp.period || 30)
    const needsNewCode = rem > lastRemaining || !code.value || code.value === '------'
    remaining.value = rem
    lastRemaining = rem
    if (needsNewCode) await generate()
  }

  /** 手动刷新：无条件重算动态码（对外语义与旧版一致） */
  async function refresh() {
    await generate()
  }

  function startTimer() {
    stopTimer()
    generate()
    timer = setInterval(tick, 1000)
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
