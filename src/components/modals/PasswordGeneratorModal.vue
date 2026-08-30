<script setup>
/* LockPass — 密码生成器独立弹窗（方案 C）
   · 基于 ModalBase（遮罩 @click.self 关闭、焦点陷阱、Escape 由 useShortcuts 统一分发）
   · 不占用 activeModal，可叠加在 EntryEditorModal 之上（ModalHost 独立挂载）
   · 入口：编辑器闪电按钮 / 全局右键 / 工具栏（无目标字段时隐藏「填入」）
   · 零依赖：window.PasswordGenerator（crypto.getRandomValues 拒绝采样）
 */
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { vaultState, useVault } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'

const { closePasswordGenerator, requestPwGenFill, copyToClipboard } = useVault()

const { t } = useI18n()
const Icons = window.Utils.SvgIcons

const visible = computed(() => vaultState.pwGenVisible)
// 有目标字段（编辑器打开中）：显示「填入」；否则仅复制
const hasTarget = computed(() => !!(vaultState.pwGenTarget && vaultState.pwGenTarget.source === 'entry' && vaultState.pwGenTarget.field))

const length = ref(16)
const opts = reactive({
  upper: true,
  lower: true,
  number: true,
  symbol: true,
  noAmbig: false,
  minEachSet: true,
  maxRepeat: false,
})
const preview = ref('')
const previewKey = ref(0)
const copied = ref(false)
const advOpen = ref(false)
const copyTimer = ref(null)
const debounceTimer = ref(null)
const emptySets = computed(() => !(opts.upper || opts.lower || opts.number || opts.symbol))

const strength = computed(() => {
  if (!preview.value) return { entropy: 0, label: '', color: 'var(--text-muted)', pct: 0 }
  const info = window.PasswordGenerator.calcStrength(preview.value)
  return {
    entropy: Math.round(info.entropy),
    label: info.label,
    color: info.color,
    pct: info.pct,
  }
})

const rangeStyle = computed(() => {
  const pct = ((length.value - 8) / (64 - 8)) * 100
  return {
    background: `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`,
  }
})

function genNow() {
  if (emptySets.value) {
    preview.value = ''
    return
  }
  const pw = window.PasswordGenerator.generatePassword({
    length: length.value,
    uppercase: opts.upper,
    lowercase: opts.lower,
    numbers: opts.number,
    symbols: opts.symbol,
    noAmbiguous: opts.noAmbig,
    minEachSet: opts.minEachSet,
    maxRepeat: opts.maxRepeat ? 1 : 0,
  })
  preview.value = pw
  previewKey.value++
}

function debounceGen() {
  clearTimeout(debounceTimer.value)
  debounceTimer.value = setTimeout(genNow, 120)
}

async function copyPw(pw) {
  if (!pw) return
  await copyToClipboard(pw, null, null)
  // 复制胶囊反馈
  copied.value = true
  clearTimeout(copyTimer.value)
  copyTimer.value = setTimeout(() => { copied.value = false }, 1600)
}

function fillPw() {
  if (!preview.value || !hasTarget.value) return
  requestPwGenFill(preview.value)
  closePasswordGenerator()
}

function onClose() {
  closePasswordGenerator()
}

watch(visible, (v) => {
  if (v) {
    copied.value = false
    genNow()
  } else {
    clearTimeout(debounceTimer.value)
  }
})

onBeforeUnmount(() => {
  clearTimeout(copyTimer.value)
  clearTimeout(debounceTimer.value)
})
</script>

<template>
  <ModalBase v-if="visible" max-width="520px" aria-label="pwgen" @close="onClose">
    <div class="pwgen-modal">
      <!-- 头部 -->
      <div class="modal-header pwgen-header">
        <h2>{{ t('pwgen.title') }}</h2>
        <button class="btn-icon" type="button" :aria-label="t('pwgen.close')" :title="t('pwgen.close')" @click="onClose">
          <span v-html="Icons?.close?.(16) || '×'"></span>
        </button>
      </div>

      <!-- 预览区 -->
      <div class="pwgen-body">
        <div class="pwgen-preview" :class="{ 'is-copied': copied }" @click="copyPw(preview)">
          <div class="pwgen-preview-pw mono" :class="{ 'is-weak': strength.entropy > 0 && strength.entropy < 40 }">
            <template v-if="preview">
              <span v-for="(c, i) in preview.split('')" :key="previewKey + '-' + i" class="pwgen-char" :style="{ animationDelay: Math.min(i * 0.022, 0.3) + 's' }">{{ c }}</span>
            </template>
            <span v-else class="pwgen-empty">{{ t('pwgen.noSets') }}</span>
          </div>
          <div class="pwgen-preview-tip" v-if="copied">{{ t('pwgen.copied') }}</div>
          <div class="pwgen-preview-tip" v-else>{{ t('pwgen.clickToCopy') }}</div>
          <div class="pwgen-actions">
            <button class="mini-btn" type="button" :title="t('pwgen.refresh')" @click="genNow()">
              <span v-html="Icons?.refresh?.(13)"></span>{{ t('pwgen.refresh') }}
            </button>
            <button class="mini-btn" type="button" :title="t('pwgen.copy')" @click="copyPw(preview)">
              <span v-html="Icons?.copy?.(13)"></span>{{ t('pwgen.copy') }}
            </button>
            <button v-if="hasTarget" class="mini-btn mini-btn-fill" type="button" :title="t('pwgen.fill')" @click="fillPw">
              <span v-html="Icons?.check?.(13)"></span>{{ t('pwgen.fill') }}
            </button>
          </div>
        </div>

        <!-- 强度 -->
        <div class="pwgen-strength">
          <div class="pwgen-strength-row">
            <span class="lbl">{{ t('pwgen.strength') }}</span>
            <span class="val mono" :style="{ color: strength.color }">
              {{ strength.label }}<template v-if="strength.entropy"> · {{ t('pwgen.entropy', { bits: strength.entropy }) }}</template>
            </span>
          </div>
          <div class="pwgen-strength-bar">
            <div class="pwgen-strength-fill" :style="{ width: strength.pct + '%', background: strength.color }"></div>
          </div>
        </div>

        <div class="pwgen-sep"></div>

        <!-- 长度滑杆 -->
        <div class="pwgen-ctl-row">
          <span class="lbl">{{ t('pwgen.length') }}</span>
          <input class="pwgen-range" type="range" min="8" max="64" step="1" v-model.number="length" :style="rangeStyle" @input="debounceGen" :aria-label="t('pwgen.length')" />
          <span class="num mono">{{ length }}</span>
        </div>

        <!-- 字符集 -->
        <div class="pwgen-chips">
          <label class="chip" :class="{ on: opts.upper }">
            <span class="box"><span v-if="opts.upper" class="box-check">✓</span></span>
            <span class="chip-name">{{ t('pwgen.setUpper') }}</span>
            <span class="hint mono">A-Z</span>
            <input type="checkbox" v-model="opts.upper" @change="genNow" class="chip-input" />
          </label>
          <label class="chip" :class="{ on: opts.lower }">
            <span class="box"><span v-if="opts.lower" class="box-check">✓</span></span>
            <span class="chip-name">{{ t('pwgen.setLower') }}</span>
            <span class="hint mono">a-z</span>
            <input type="checkbox" v-model="opts.lower" @change="genNow" class="chip-input" />
          </label>
          <label class="chip" :class="{ on: opts.number }">
            <span class="box"><span v-if="opts.number" class="box-check">✓</span></span>
            <span class="chip-name">{{ t('pwgen.setNumber') }}</span>
            <span class="hint mono">0-9</span>
            <input type="checkbox" v-model="opts.number" @change="genNow" class="chip-input" />
          </label>
          <label class="chip" :class="{ on: opts.symbol }">
            <span class="box"><span v-if="opts.symbol" class="box-check">✓</span></span>
            <span class="chip-name">{{ t('pwgen.setSymbol') }}</span>
            <span class="hint mono">!@#$…</span>
            <input type="checkbox" v-model="opts.symbol" @change="genNow" class="chip-input" />
          </label>
          <label class="chip chip-wide" :class="{ on: opts.noAmbig }">
            <span class="box"><span v-if="opts.noAmbig" class="box-check">✓</span></span>
            <span class="chip-name">{{ t('pwgen.noAmbig') }}</span>
            <input type="checkbox" v-model="opts.noAmbig" @change="genNow" class="chip-input" />
          </label>
        </div>

        <!-- 高级选项折叠 -->
        <div class="pwgen-adv" :class="{ open: advOpen }">
          <div class="pwgen-adv-head" @click="advOpen = !advOpen" role="button" tabindex="0" :aria-expanded="advOpen" @keydown.enter="advOpen = !advOpen">
            <span v-html="Icons?.settings?.(13)"></span>
            <span>{{ t('pwgen.advance') }}</span>
            <span class="chev">▾</span>
          </div>
          <div class="pwgen-adv-body">
            <div class="pwgen-adv-inner">
              <label class="switch-row">
                <span>{{ t('pwgen.minEachSet') }}</span>
                <span class="switch" :class="{ on: opts.minEachSet }">
                  <input type="checkbox" v-model="opts.minEachSet" @change="genNow" />
                  <span class="switch-slider"></span>
                </span>
              </label>
              <label class="switch-row">
                <span>{{ t('pwgen.maxRepeat') }}</span>
                <span class="switch" :class="{ on: opts.maxRepeat }">
                  <input type="checkbox" v-model="opts.maxRepeat" @change="genNow" />
                  <span class="switch-slider"></span>
                </span>
              </label>
            </div>
          </div>
        </div>

      </div>

      <!-- 底部 -->
      <div class="modal-footer pwgen-footer">
        <button class="btn btn-ghost" type="button" @click="onClose">{{ t('pwgen.cancel') }}</button>
        <button v-if="hasTarget" class="btn btn-primary" type="button" :disabled="!preview" @click="fillPw">{{ t('pwgen.fillThis') }}</button>
        <button v-else class="btn btn-primary" type="button" :disabled="!preview" @click="copyPw(preview)">{{ t('pwgen.copy') }}</button>
      </div>
    </div>
  </ModalBase>
</template>
