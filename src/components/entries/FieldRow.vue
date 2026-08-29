<script setup>
/**
 * 详情面板普通字段行（P2-7 重构：从 DetailPanel 六类型模板中抽取的复用组件）
 * 结构：label + 值（纯文本 / 安全链接）+ 可选复制按钮（走统一剪贴板安全链路）
 * props：
 *  - label        字段中文名
 *  - value        字段值
 *  - copyable     是否显示复制按钮
 *  - linkable     值为合法 http(s) URL 时渲染为链接（否则退回纯文本）
 *  - displaySuffix 链接/文本展示时追加的后缀（数据库地址的 :port）
 *  - pushRight    复制按钮右对齐（原 AI 服务名称行的 ml-auto 布局）
 */
import { useVault } from '../../composables/useVault'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: String, default: '' },
  copyable: { type: Boolean, default: false },
  linkable: { type: Boolean, default: false },
  displaySuffix: { type: String, default: '' },
  pushRight: { type: Boolean, default: false },
})

const { copyField } = useVault()

// P3-4：图标统一走 Utils.SvgIcons（消除与图标库的重复定义）
const Icons = window.Utils.SvgIcons

/** 仅 http/https 协议返回绝对地址，其余返回 null（防 javascript: 注入） */
function safeUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href
  } catch (e) {}
  return null
}

function displayText() {
  return String(props.value ?? '') + (props.displaySuffix || '')
}
</script>

<template>
  <div class="detail-field">
    <div class="detail-field-label">{{ label }}</div>
    <div class="detail-field-value">
      <a v-if="linkable && safeUrl(value)" :href="safeUrl(value)" target="_blank" rel="noopener">{{ displayText() }}</a>
      <template v-else>{{ displayText() }}</template>
      <button
        v-if="copyable"
        class="btn-icon btn-icon-sm"
        :class="{ 'ml-auto': pushRight }"
        title="复制"
        aria-label="复制"
        @click="copyField(value, $event.currentTarget)"
      >
        <span v-html="Icons.copy(14)"></span>
      </button>
    </div>
  </div>
</template>
