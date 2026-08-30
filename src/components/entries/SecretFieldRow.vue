<script setup>
/**
 * 详情面板敏感字段行（P2-7 重构：从 DetailPanel 六类型模板中抽取的复用组件）
 * 结构：label + 密文值（•••••••• / 明文）+ 眼睛切换 + 复制按钮
 * 行为与原模板一致：
 *  - 显隐由父级 vaultState.showPasswordMap 驱动（toggleDetailPassword 按当前选中条目切换）
 *  - copyMode='entry'：复制走 copyPassword(entryId)（app 类型取 App ID 的既有语义）
 *  - copyMode='value'：直接复制传入值（root 密码 / 私钥）
 * 复制均走统一剪贴板安全链路（成功提示 + 30 秒自动清除）
 */
import { useVault } from '../../composables/useVault'
import { useI18n } from '../../composables/useI18n'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: String, default: '' },
  show: { type: Boolean, default: false },
  copyMode: { type: String, default: 'value' },
  entryId: { type: String, default: null },
})

const { copyField, copyPassword, toggleDetailPassword } = useVault()
const { t } = useI18n()

// P3-4：图标统一走 Utils.SvgIcons（消除与图标库的重复定义）
const Icons = window.Utils.SvgIcons

function onCopy(e) {
  if (props.copyMode === 'entry' && props.entryId) {
    copyPassword(props.entryId, e.currentTarget)
  } else {
    copyField(props.value, e.currentTarget)
  }
}
</script>

<template>
  <div class="detail-field">
    <div class="detail-field-label">{{ label }}</div>
    <div class="detail-field-value mono">
      <span :class="{ masked: !show }">{{ show ? String(value ?? '') : '••••••••' }}</span>
      <span class="ml-auto"></span>
      <button
        class="btn-icon btn-icon-sm"
        :title="show ? t('detail.field.hide') : t('detail.field.show')"
        :aria-label="show ? t('detail.field.ariaHidePw') : t('detail.field.ariaShowPw')"
        @click="toggleDetailPassword()"
      >
        <span v-if="show" v-html="Icons.eyeClosed(12)"></span>
        <span v-else v-html="Icons.eyeOpen(12)"></span>
      </button>
      <button class="btn-icon btn-icon-sm" :title="t('detail.field.copy')" :aria-label="t('detail.field.copy')" @click="onCopy($event)">
        <span v-html="Icons.copy(14)"></span>
      </button>
    </div>
  </div>
</template>
