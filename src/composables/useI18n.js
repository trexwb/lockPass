/* ═══════════════════════════════════════════════════════════════════
   LockPass — useI18n（Vue 响应式桥接，升级方案 §6.5）
   ───────────────────────────────────────────────────────────────────
   组件内：const { t, lang, setLang } = useI18n()
   - t(key, params)：模板/JS 通用；模板中语言切换自动重渲染
     （t 闭包读取响应式 i18nState.lang 建立依赖）
   - lang：computed，当前语言标识（'zh-CN' | 'en-US'）
   - setLang(l)：切换语言 + 持久化偏好（'system' | 'zh-CN' | 'en-US'）
   ═══════════════════════════════════════════════════════════════════ */
import { computed, reactive } from 'vue'

/** 语言状态（模块级单例，全部组件共享同一份响应式状态） */
const i18nState = reactive({ lang: window.I18n.getLang() })

export function useI18n() {
  /** 模板/JS 通用 t：读取响应式语言建立依赖，切换语言时使用方自动重渲染 */
  function t(key, params) {
    void i18nState.lang
    return window.I18n.t(key, params)
  }

  /** 切换语言并持久化偏好（'system' | 'zh-CN' | 'en-US'） */
  function setLang(pref) {
    window.I18n.setLangPref(pref)
    i18nState.lang = window.I18n.getLang()
  }

  return {
    t,
    lang: computed(() => i18nState.lang),
    pref: computed(() => window.I18n.getLangPref()),
    setLang,
  }
}
