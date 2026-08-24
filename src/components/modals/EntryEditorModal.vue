<script setup>
/* LockPass — 密码条目编辑器（新增 / 编辑）
   Vue 3 迁移：对齐原生 editor.js —— app 类型（App ID/公钥/私钥）、
   密码生成面板（长度/字符集/排除歧义/强度条）、保存按钮 id=entry-editor-save */
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useVault, vaultState, ENTRY_TYPES } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'

const { getEntryById, saveEntry, closeModal } = useVault()

const isEdit = computed(() => !!vaultState.editingEntryId)

const title = ref('')
const entryType = ref('website')
const fields = reactive({})
const selectedTags = ref([])
const notes = ref('')
const newTag = ref('')
const showFields = reactive({})

const TYPE_FIELD_KEYS = {
  website: ['url', 'username', 'password'],
  server: ['url', 'port', 'username', 'password'],
  database: ['dbType', 'url', 'port', 'dbName', 'username', 'password'],
  ai: ['password', 'organization', 'url'],
  app: ['appId', 'password', 'privateKey'],
  other: ['username', 'password'],
}

const FIELD_LABELS = {
  url: '网址',
  username: '用户名',
  password: '密码',
  port: '端口',
  dbType: '数据库类型',
  dbName: '数据库名',
  organization: '组织 / 项目',
  appId: 'App ID',
  privateKey: '私钥',
}

const FIELD_PLACEHOLDERS = {
  url: 'https://example.com',
  username: '用户名 / 邮箱',
  password: '',
  port: '3306',
  dbType: 'MySQL / PostgreSQL / ...',
  dbName: '数据库名',
  organization: 'org-...',
  appId: '示例：2019031163548107',
  privateKey: '输入私钥（证书级长度）',
}

const currentKeys = computed(() => TYPE_FIELD_KEYS[entryType.value] || TYPE_FIELD_KEYS.other)

const allTagNames = computed(() => Object.keys(vaultState.tagDefs))

const isSecretField = (k) => k === 'password' || k === 'privateKey'
// 语境化标签：url 在 server/database 显示"连接地址"、ai 显示"API 地址"；
// password 在 ai 语境语义为 Token / API Key；app 类型的 password 字段语义为公钥
const fieldLabel = (k) => {
  if (k === 'url') {
    if (entryType.value === 'server' || entryType.value === 'database') return '连接地址'
    if (entryType.value === 'ai') return 'API 地址'
    return FIELD_LABELS.url || '网址'
  }
  if (k === 'password' && entryType.value === 'ai') return 'Token / API Key'
  if (k === 'password' && entryType.value === 'app') return '公钥'
  return FIELD_LABELS[k] || k
}
const fieldPlaceholder = (k) => {
  if (k === 'url') {
    if (entryType.value === 'server' || entryType.value === 'database') return '127.0.0.1 或 host:port'
    if (entryType.value === 'ai') return 'https://api.openai.com'
    return FIELD_PLACEHOLDERS.url || 'https://example.com'
  }
  if (k === 'password' && entryType.value === 'ai') return 'sk-... / API Key'
  return FIELD_PLACEHOLDERS[k] || fieldLabel(k)
}
const isTextareaField = (k) => k === 'privateKey' || (k === 'password' && entryType.value === 'app')

const DRAFT_NEW_KEY = 'lockpass_draft_new'

function draftKey() {
  return vaultState.editingEntryId ? `lockpass_draft_edit_${vaultState.editingEntryId}` : DRAFT_NEW_KEY
}

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(draftKey())
    if (!raw) return null
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

function persistDraft() {
  try {
    sessionStorage.setItem(draftKey(), JSON.stringify({
      title: title.value,
      entryType: entryType.value,
      fields: { ...fields },
      tags: selectedTags.value,
      notes: notes.value,
    }))
  } catch (e) {}
}

function clearDraft() {
  try { sessionStorage.removeItem(draftKey()) } catch (e) {}
}

// 标签 chip 图标：复用旧版 getCategoryIcon
function tagIconSvg(name) {
  const def = vaultState.tagDefs[name] || {}
  return window.Utils.getCategoryIcon(def.icon || 'other', def.color || '#8b949e')
}

function toggleTag(name) {
  const i = selectedTags.value.indexOf(name)
  if (i >= 0) selectedTags.value.splice(i, 1)
  else selectedTags.value.push(name)
}

function addNewTag() {
  const name = newTag.value.trim()
  if (!name) return
  if (!vaultState.tagDefs[name]) {
    const attrs = window.Utils.getRandomTagAttrs(vaultState.tagDefs)
    vaultState.tagDefs[name] = { color: attrs.color, icon: attrs.icon, isDefault: false }
  }
  if (!selectedTags.value.includes(name)) selectedTags.value.push(name)
  newTag.value = ''
}

function toggleSecret(k) {
  showFields[k] = !showFields[k]
}

/* ── 密码生成面板 ─────────────────────────────── */

const genPanelOpen = ref(false)
const genOptions = reactive({
  length: 16,
  upper: true,
  lower: true,
  number: true,
  symbol: true,
  noAmbig: false,
})
const genPreview = ref('')

function genPasswordNow() {
  const pw = window.PasswordGenerator.generatePassword({
    length: genOptions.length,
    uppercase: genOptions.upper,
    lowercase: genOptions.lower,
    numbers: genOptions.number,
    symbols: genOptions.symbol,
    noAmbiguous: genOptions.noAmbig,
  })
  genPreview.value = pw
  return pw
}

const genStrength = computed(() => {
  if (!genPreview.value) return { label: '', pct: 0, color: '' }
  const info = window.PasswordGenerator.calcStrength(genPreview.value)
  return { label: `${info.label} · ${info.entropy.toFixed(0)} 位熵`, pct: info.pct, color: info.color }
})

function toggleGenPanel() {
  genPanelOpen.value = !genPanelOpen.value
  if (genPanelOpen.value && !genPreview.value) genPasswordNow()
}

function useGeneratedPassword() {
  if (!genPreview.value) return
  fields.password = genPreview.value
  showFields.password = true
  genPanelOpen.value = false
}

function generatePw() {
  // 快捷生成：直接填入密码字段（与原生“生成”按钮等价）
  const pw = genPasswordNow()
  fields.password = pw
  showFields.password = true
  updateStrength()
}

/* ── 密码强度条 ───────────────────────────────── */

const strength = ref({ label: '', pct: 0, color: '' })

function updateStrength() {
  const pw = fields.password
  if (!pw) {
    strength.value = { label: '', pct: 0, color: '' }
    return
  }
  try {
    const info = window.PasswordGenerator.calcStrength(pw)
    strength.value = { label: `${info.label} · ${info.entropy.toFixed(0)} 位熵`, pct: info.pct, color: info.color }
  } catch (e) {
    strength.value = { label: '', pct: 0, color: '' }
  }
}

/* ── 保存 ─────────────────────────────────────── */

async function onSave() {
  const payload = {
    title: title.value,
    type: entryType.value,
    fields: { ...fields },
    tags: selectedTags.value.slice(),
    notes: notes.value,
  }
  const ok = await saveEntry(payload)
  if (ok) clearDraft()
}

/* ── 旧数据兼容加载 ───────────────────────────────
   历史条目使用 host / baseUrl / apiKey 等旧字段名（旧版数据模型），
   编辑器统一为 url / password 模型，读取时回退到旧字段。 */
function legacyValue(e, k) {
  if (k === 'url') return e[k] ?? e.host ?? e.baseUrl ?? ''
  if (k === 'password' && e.entryType === 'ai') return e[k] ?? e.apiKey ?? ''
  return e[k] ?? ''
}

onMounted(() => {
  if (isEdit.value) {
    const e = getEntryById(vaultState.editingEntryId)
    if (e) {
      title.value = e.title || ''
      entryType.value = e.entryType || 'website'
      currentKeys.value.forEach(k => { fields[k] = legacyValue(e, k) })
      if (e.root) {
        fields.rootUser = e.root.username || ''
        fields.rootPwd = e.root.password || ''
      }
      selectedTags.value = (e.tags || []).slice()
      notes.value = e.notes || ''
    }
  } else {
    const draft = loadDraft()
    if (draft) {
      title.value = draft.title || ''
      entryType.value = draft.entryType || 'website'
      Object.keys(draft.fields || {}).forEach(k => { fields[k] = draft.fields[k] })
      selectedTags.value = (draft.tags || []).slice()
      notes.value = draft.notes || ''
    }
  }
  // 预置空字段
  currentKeys.value.forEach(k => {
    if (fields[k] === undefined) fields[k] = ''
  })
  if (entryType.value === 'server') {
    if (fields.rootUser === undefined) fields.rootUser = ''
    if (fields.rootPwd === undefined) fields.rootPwd = ''
  }
  updateStrength()
})

watch([title, entryType, fields, selectedTags, notes], () => persistDraft(), { deep: true })
</script>

<template>
  <ModalBase :max-width="'560px'" @close="closeModal()">
    <div class="modal-header">
      <h3>{{ isEdit ? '编辑密码' : '添加密码' }}</h3>
      <button class="btn-icon" @click="closeModal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">类型</label>
        <div class="type-selector">
          <button
            v-for="t in ENTRY_TYPES"
            :key="t.id"
            class="type-chip"
            :class="{ active: entryType === t.id }"
            type="button"
            @click="entryType = t.id"
          >
            {{ t.label }}
          </button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">标题 <span class="text-danger">*</span></label>
        <input v-model="title" class="form-input" type="text" placeholder="例如：GitHub 账号" autocomplete="off" />
      </div>

      <div class="form-group">
        <label class="form-label">字段</label>
        <div v-for="k in currentKeys" :key="k" class="form-field-row">
          <textarea
            v-if="isTextareaField(k)"
            v-model="fields[k]"
            class="form-input mono mono-textarea"
            rows="3"
            :placeholder="fieldPlaceholder(k)"
            autocomplete="off"
          ></textarea>
          <input
            v-else
            v-model="fields[k]"
            class="form-input"
            :class="{ mono: k === 'appId' }"
            :type="isSecretField(k) ? (showFields[k] ? 'text' : 'password') : 'text'"
            :placeholder="fieldPlaceholder(k)"
            autocomplete="off"
            @input="k === 'password' && updateStrength()"
          />
          <button
            v-if="isSecretField(k)"
            class="btn btn-ghost btn-sm"
            type="button"
            title="显示/隐藏"
            @click="toggleSecret(k)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path v-if="!showFields[k]" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle v-if="!showFields[k]" cx="12" cy="12" r="3" />
              <path v-if="showFields[k]" d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path v-if="showFields[k]" d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line v-if="showFields[k]" x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
          <span class="form-field-label">{{ fieldLabel(k) }}</span>
          <button
            v-if="k === 'password'"
            class="btn btn-ghost btn-sm"
            type="button"
            title="生成随机密码"
            @click="toggleGenPanel()"
          >
            生成
          </button>
        </div>

        <!-- 密码强度条 -->
        <div v-if="fields.password && !isTextareaField('password')" class="pw-strength mt-1">
          <div class="pw-strength-bar-bg">
            <div class="pw-strength-bar" :style="{ width: strength.pct + '%', background: strength.color }"></div>
          </div>
          <div class="pw-strength-text text-muted">{{ strength.label }}</div>
        </div>

        <!-- 生成面板 -->
        <div v-if="genPanelOpen" class="pw-gen-panel">
          <div class="pw-gen-preview">
            <span class="pw-gen-preview-text mono">{{ genPreview || '点击生成' }}</span>
            <button class="btn-icon btn-icon-xs" type="button" title="重新生成" @click="genPasswordNow()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            </button>
          </div>
          <div class="pw-gen-controls">
            <div class="pw-gen-row">
              <label>长度</label>
              <input v-model.number="genOptions.length" type="range" min="8" max="64" @input="genPasswordNow()" />
              <span>{{ genOptions.length }}</span>
            </div>
            <div class="pw-gen-charsets">
              <label class="charset-label"><input v-model="genOptions.upper" type="checkbox" @change="genPasswordNow()" /> 大写字母 (A-Z)</label>
              <label class="charset-label"><input v-model="genOptions.lower" type="checkbox" @change="genPasswordNow()" /> 小写字母 (a-z)</label>
              <label class="charset-label"><input v-model="genOptions.number" type="checkbox" @change="genPasswordNow()" /> 数字 (0-9)</label>
              <label class="charset-label"><input v-model="genOptions.symbol" type="checkbox" @change="genPasswordNow()" /> 符号 (!@#$…)</label>
            </div>
            <div class="pw-gen-row gap-8 mt-1">
              <label class="charset-label min-w-auto"><input v-model="genOptions.noAmbig" type="checkbox" @change="genPasswordNow()" /> 排除歧义字符</label>
            </div>
            <div>
              <div class="pw-strength-bar-bg">
                <div class="pw-strength-bar" :style="{ width: genStrength.pct + '%', background: genStrength.color }"></div>
              </div>
              <div class="pw-strength-text text-muted">{{ genStrength.label }}</div>
            </div>
            <button class="btn btn-primary btn-sm" type="button" @click="useGeneratedPassword()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
              使用此密码
            </button>
          </div>
        </div>

        <template v-if="entryType === 'server'">
          <div class="form-field-row">
            <input v-model="fields.rootUser" class="form-input" type="text" placeholder="root 用户名（可选）" autocomplete="off" />
            <span class="form-field-label">Root 用户</span>
          </div>
          <div class="form-field-row">
            <input v-model="fields.rootPwd" class="form-input" :type="showFields.rootPwd ? 'text' : 'password'" placeholder="root 密码（可选）" autocomplete="off" />
            <button class="btn btn-ghost btn-sm" type="button" title="显示/隐藏" @click="toggleSecret('rootPwd')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path v-if="!showFields.rootPwd" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle v-if="!showFields.rootPwd" cx="12" cy="12" r="3" />
                <path v-if="showFields.rootPwd" d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path v-if="showFields.rootPwd" d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line v-if="showFields.rootPwd" x1="1" y1="1" x2="23" y2="23" />
              </svg>
            </button>
            <span class="form-field-label">Root 密码</span>
          </div>
        </template>
      </div>

      <div class="form-group">
        <label class="form-label">标签</label>
        <div class="tag-picker">
          <span
            v-for="name in allTagNames"
            :key="name"
            class="tag-chip"
            :class="{ active: selectedTags.includes(name) }"
            @click="toggleTag(name)"
          >
            {{ name }}
          </span>
          <span class="tag-picker-add">
            <input
              v-model="newTag"
              class="form-input form-input-sm"
              type="text"
              placeholder="新标签"
              @keydown.enter.prevent="addNewTag()"
              @blur="addNewTag()"
            />
          </span>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea
          v-model="notes"
          class="form-input form-textarea"
          rows="3"
          placeholder="支持 Markdown 语法"
        ></textarea>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" @click="closeModal()">取消</button>
      <button id="entry-editor-save" class="btn btn-primary" @click="onSave()">保存</button>
    </div>
  </ModalBase>
</template>
