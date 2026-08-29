/* LockPass — 主题管理（自定义主题：深色 / 浅色 / 跟随系统 + 强调色）
   实现：
   - 主题模式存 localStorage（lockpass_theme: 'dark' | 'light' | 'system'），
     默认 'dark'（产品暗色优先原则）
   - 强调色存 localStorage（lockpass_accent: 'blue' | 'green' | 'purple' |
     'orange' | 'red' | 'cyan'），默认 'blue'
   - 实际生效值写到 <html> 的 data-theme / data-accent 属性，
     CSS 侧由 base.css 的 :root[data-theme="light"] 与 :root[data-accent=*] 响应
   - 'system' 模式监听 prefers-color-scheme 变化，实时跟随
   - init() 必须在 Vue 挂载前同步调用（main.js），避免首帧主题闪屏 */
import { ref } from 'vue'

const THEME_KEY = 'lockpass_theme'
const ACCENT_KEY = 'lockpass_accent'

const ACCENTS = ['blue', 'green', 'purple', 'orange', 'red', 'cyan']

export const themeMode = ref('dark')
export const accentName = ref('blue')

let mediaQuery = null

function resolveMode() {
  if (themeMode.value !== 'system') return themeMode.value
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch (e) {
    return 'dark'
  }
}

function applyTheme() {
  const root = document.documentElement
  root.setAttribute('data-theme', resolveMode())
  root.setAttribute('data-accent', accentName.value)
  // 粒子 canvas 颜色跟随主题（实例未创建时静默跳过；挂载前调用无副作用）
  try {
    if (window.LockParticles && window.LockParticles.refresh) window.LockParticles.refresh()
  } catch (e) {}
}

function persist() {
  try { localStorage.setItem(THEME_KEY, themeMode.value) } catch (e) {}
  try { localStorage.setItem(ACCENT_KEY, accentName.value) } catch (e) {}
}

function onSystemChange() {
  // 仅 system 模式需要响应系统切换；手动 dark/light 时忽略
  if (themeMode.value === 'system') applyTheme()
}

export function useTheme() {
  function init() {
    try {
      const t = localStorage.getItem(THEME_KEY)
      if (t === 'dark' || t === 'light' || t === 'system') themeMode.value = t
    } catch (e) {}
    try {
      const a = localStorage.getItem(ACCENT_KEY)
      if (ACCENTS.includes(a)) accentName.value = a
    } catch (e) {}

    if (mediaQuery) {
      try { mediaQuery.removeEventListener('change', onSystemChange) } catch (e) {}
    }
    try {
      mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
      mediaQuery.addEventListener('change', onSystemChange)
    } catch (e) {}

    applyTheme()
  }

  function setMode(mode) {
    if (mode !== 'dark' && mode !== 'light' && mode !== 'system') return
    themeMode.value = mode
    persist()
    applyTheme()
    flashThemeTransition()
  }

  function setAccent(name) {
    if (!ACCENTS.includes(name)) return
    accentName.value = name
    persist()
    applyTheme()
    flashThemeTransition()
  }

  return { themeMode, accentName, ACCENTS, init, setMode, setAccent }
}
