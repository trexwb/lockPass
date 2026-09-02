import { ref } from 'vue'

/**
 * 生物识别解锁（Passkey，macOS 桌面单端 MVP）状态组合式函数。
 * 统一「平台判定 + 状态拉取」，供 AuthView（锁屏）与 SettingsModal（设置）复用，
 * 消除两处重复的 status 查询逻辑；并以 window.LockPasskey.isDesktopMac 作为
 * 唯一平台判定来源（bridge 内部即 isTauri && isMac）。
 * @returns {{ supported: import('vue').Ref<boolean>, enabled: import('vue').Ref<boolean>, refresh: () => Promise<void> }}
 */
export function usePasskey() {
  const supported = ref(false)
  const enabled = ref(false)

  /** 查询状态；非桌面 macOS 一律置 false（UI 隐藏入口），失败视为不可用 */
  async function refresh() {
    if (!window.LockPasskey || !window.LockPasskey.isDesktopMac) {
      supported.value = false
      enabled.value = false
      return
    }
    try {
      const st = await window.LockPasskey.status()
      supported.value = !!st.available
      enabled.value = !!st.enabled
    } catch (e) {
      supported.value = false
      enabled.value = false
    }
  }

  return { supported, enabled, refresh }
}
