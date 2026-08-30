<script setup>
/**
 * LockPass — 详情面板自定义字段行（upgrade-design.md §1.4）
 * 结构：label + 值（敏感字段默认掩码）+ 眼睛切换（仅敏感）+ 复制按钮
 * 显隐状态由父级 DetailPanel 维护（customReveal map，按 cf.id 独立控制）
 */
import { useVault } from '../../composables/useVault'
import { useI18n } from '../../composables/useI18n'

defineProps({
  label: { type: String, required: true },
  value: { type: String, default: '' },
  sensitive: { type: Boolean, default: false },
  show: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle-reveal'])

const { copyField } = useVault()
const { t } = useI18n()

const Icons = window.Utils.SvgIcons
</script>

<template>
  <div class="detail-field">
    <div class="detail-field-label">{{ label }}</div>
    <div class="detail-field-value mono">
      <span :class="{ masked: sensitive && !show }">{{ sensitive && !show ? '••••••••' : String(value ?? '') }}</span>
      <span class="ml-auto"></span>
      <button
        v-if="sensitive"
        class="btn-icon btn-icon-sm"
        :title="show ? t('detail.custom.hide') : t('detail.custom.show')"
        :aria-label="show ? t('detail.custom.ariaHide') : t('detail.custom.ariaShow')"
        @click="emit('toggle-reveal')"
      >
        <span v-if="show" v-html="Icons.eyeClosed(12)"></span>
        <span v-else v-html="Icons.eyeOpen(12)"></span>
      </button>
      <button class="btn-icon btn-icon-sm" :title="t('detail.field.copy')" :aria-label="t('detail.field.copy')" @click="copyField(value, $event.currentTarget)">
        <span v-html="Icons.copy(14)"></span>
      </button>
    </div>
  </div>
</template>
