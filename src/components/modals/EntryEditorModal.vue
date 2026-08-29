<script setup>
/* LockPass — 密码条目编辑器（新增 / 编辑）
   Vue 3 迁移：对齐原生 editor.js —— app 类型（App ID/公钥/私钥）、
   密码生成面板（长度/字符集/排除歧义/强度条）、保存按钮 id=entry-editor-save */
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useVault, vaultState, ENTRY_TYPES } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'

const { getEntryById, saveEntry, closeModal, copyToClipboard } = useVault()

// P3-4：图标统一走 Utils.SvgIcons
const Icons = window.Utils.SvgIcons

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
  ai: ['password', 'url'],
  app: ['appId', 'password', 'privateKey'],
  other: ['username', 'password'],
}

const currentKeys = computed(() => TYPE_FIELD_KEYS[entryType.value] || TYPE_FIELD_KEYS.other)

// 切换类型时清除不属于新类型的残留字段，避免旧字段被持久化到加密 vault
watch(entryType, (newType) => {
  const keepKeys = new Set(TYPE_FIELD_KEYS[newType] || TYPE_FIELD_KEYS.other)
  if (newType === 'server') { keepKeys.add('rootUser'); keepKeys.add('rootPwd') }
  Object.keys(fields).forEach(k => {
    if (!keepKeys.has(k)) delete fields[k]
  })
  Object.keys(showFields).forEach(k => {
    if (!keepKeys.has(k)) delete showFields[k]
  })
  // 预置新类型的空字段
  ;(TYPE_FIELD_KEYS[newType] || TYPE_FIELD_KEYS.other).forEach(k => {
    if (fields[k] === undefined) fields[k] = ''
  })
  if (newType === 'server') {
    if (fields.rootUser === undefined) fields.rootUser = ''
    if (fields.rootPwd === undefined) fields.rootPwd = ''
  }
  updateStrength()
})

const allTagNames = computed(() => Object.keys(vaultState.tagDefs))

// 推荐标签 = 注册表中尚未选中的标签（原版 tag-suggestions 逻辑）
const availableTags = computed(() => allTagNames.value.filter(t => !selectedTags.value.includes(t)))

// 眼睛图标路径（与原版 SvgIcons.eyeOpenPaths / eyeClosedPaths 一致）
const windowEyeOpen = window.Utils?.SvgIcons?.eyeOpenPaths || ''
const windowEyeClosed = window.Utils?.SvgIcons?.eyeClosedPaths || ''

const isSecretField = (k) => k === 'password' || k === 'privateKey'

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

// 类型 tab 图标：复用旧版 SvgIcons.typeIcon
function typeIconSvg(id) {
  return window.Utils.SvgIcons.typeIcon(14, id)
}

function toggleTag(name) {
  const i = selectedTags.value.indexOf(name)
  if (i >= 0) selectedTags.value.splice(i, 1)
  else selectedTags.value.push(name)
}

function addNewTagByName(name) {
  if (!selectedTags.value.includes(name)) selectedTags.value.push(name)
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

// 复制文本到剪贴板（P2-9 修复：走 useVault 统一安全链路——
// 成功 Toast 反馈 + 30 秒自动清除，替代原来绕过链路的裸 navigator.clipboard 调用）
async function copyText(text, btnEl = null) {
  if (!text) return
  await copyToClipboard(text, null, btnEl)
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

// 局部生成：直接填入指定字段（原版 generatePasswordFor 等价，root 密码用）
function generateFor(k) {
  const pw = window.PasswordGenerator.generatePassword({
    length: 16, uppercase: true, lowercase: true, numbers: true, symbols: true, noAmbiguous: false,
  })
  fields[k] = pw
  showFields[k] = true
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

// 字段校验：返回错误消息或 null
function validateForm() {
  if (!title.value.trim()) return '请填写标题'
  const url = fields.url?.trim() || ''
  if (url) {
    // URL 校验：接受 http(s):// 或裸域名/IP
    const isUrl = /^https?:\/\/.+/i.test(url) || /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]+)?$/i.test(url) || /^(\d{1,3}\.){3}\d{1,3}$/.test(url)
    if (!isUrl) return '网址格式不正确'
  }
  const port = fields.port
  if (port !== undefined && port !== '' && port != null) {
    const p = Number(port)
    if (!Number.isInteger(p) || p < 1 || p > 65535) return '端口必须在 1-65535 范围内'
  }
  const username = fields.username?.trim() || ''
  if (username && username.includes('@')) {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)
    if (!isEmail) return '邮箱格式不正确'
  }
  return null
}

async function onSave() {
  const err = validateForm()
  if (err) {
    window.Utils.showToast(err, 'error')
    return
  }
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

/* ── 关闭时未保存警告 ─────────────────────────── */

// 记录初始快照，用于判断是否有未保存修改
let _initialSnapshot = null

function snapshotForm() {
  return JSON.stringify({
    title: title.value,
    entryType: entryType.value,
    fields: { ...fields },
    tags: selectedTags.value.slice(),
    notes: notes.value,
  })
}

function hasUnsavedChanges() {
  if (!_initialSnapshot) return false
  return snapshotForm() !== _initialSnapshot
}

async function handleClose() {
  if (hasUnsavedChanges()) {
    const ok = await window.Utils.confirm({
      title: '未保存的修改',
      message: '当前表单有未保存的修改，确定要关闭吗？',
      confirmText: '放弃修改',
      cancelText: '继续编辑',
      danger: true,
    })
    if (!ok) return
  }
  clearDraft()
  closeModal()
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

      // 恢复未保存的编辑草稿（v1.0.25：此前编辑模式草稿只写不读）
      const draft = loadDraft()
      if (draft) {
        title.value = draft.title || title.value
        if (draft.entryType) entryType.value = draft.entryType
        Object.keys(draft.fields || {}).forEach(k => { fields[k] = draft.fields[k] })
        selectedTags.value = (draft.tags || []).slice()
        if (draft.notes != null) notes.value = draft.notes
        window.Utils.showToast('已恢复上次未保存的编辑内容', 'info')
      }
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
  _initialSnapshot = snapshotForm()
})

watch([title, entryType, fields, selectedTags, notes], () => persistDraft(), { deep: true })
</script>

<template>
  <ModalBase :max-width="'560px'" @close="handleClose()">
    <div class="modal-header">
      <h3>{{ isEdit ? '编辑密码' : '添加密码' }}</h3>
      <button class="btn-icon" @click="handleClose()">
        <span v-html="Icons.close(16)"></span>
      </button>
    </div>

    <div class="modal-body">
      <!-- 类型切换（与原版 type-tabs 一致） -->
      <div class="type-tabs">
        <button
          v-for="t in ENTRY_TYPES"
          :key="t.id"
          class="type-tab"
          :class="{ active: entryType === t.id }"
          type="button"
          @click="entryType = t.id"
        >
          <span class="type-tab-icon" v-html="typeIconSvg(t.id)"></span>
          <span>{{ t.label }}</span>
        </button>
      </div>

      <!-- 标题 -->
      <div class="form-group">
        <label class="form-label">标题 <span class="text-danger">*</span></label>
        <input v-model="title" class="form-input" type="text" placeholder="例如：Gmail / 阿里云 ECS" maxlength="100" autocomplete="off" />
      </div>

      <!-- ══ website ══ -->
      <template v-if="entryType === 'website'">
        <div class="form-group">
          <label class="form-label">用户名</label>
          <input v-model="fields.username" class="form-input" type="text" placeholder="username@example.com" autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label">密码 <span class="text-danger">*</span></label>
          <div class="input-affix">
            <input v-model="fields.password" class="form-input mono" :type="showFields.password ? 'text' : 'password'" placeholder="输入或生成密码" autocomplete="off" @input="updateStrength()" />
            <div class="input-affix-btns">
              <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="toggleSecret('password')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
              </button>
              <button class="pw-gen-btn" type="button" title="生成密码" aria-label="生成密码" @click="toggleGenPanel()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
              </button>
            </div>
          </div>
          <div v-if="fields.password" class="pw-strength">
            <div class="pw-strength-bar-bg">
              <div class="pw-strength-bar" :style="{ width: strength.pct + '%', background: strength.color }"></div>
            </div>
            <div class="pw-strength-text">{{ strength.label }}</div>
          </div>
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
                <div class="pw-strength-text">{{ genStrength.label }}</div>
              </div>
              <button class="btn btn-primary btn-sm" type="button" @click="useGeneratedPassword()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
                使用此密码
              </button>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">网址</label>
          <input v-model="fields.url" class="form-input" type="url" placeholder="https://example.com" autocomplete="off" />
        </div>
      </template>

      <!-- ══ server ══ -->
      <template v-else-if="entryType === 'server'">
        <div class="form-group">
          <label class="form-label">连接地址</label>
          <div class="input-row">
            <div class="input-row-main">
              <input v-model="fields.url" class="form-input mono" type="text" placeholder="示例：ssh -p 22 user@1.2.3.4" autocomplete="off" />
            </div>
            <input v-model="fields.port" class="form-input mono input-port" type="number" placeholder="端口" min="1" max="65535" autocomplete="off" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">登录账号</label>
          <div class="input-row">
            <div class="input-row-main">
              <input v-model="fields.username" class="form-input" type="text" placeholder="账号" autocomplete="off" />
            </div>
            <button class="pw-gen-btn" type="button" title="复制账号" @click="copyText(fields.username, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">登录密码</label>
          <div class="input-row">
            <div class="input-row-main">
              <div class="input-affix">
                <input v-model="fields.password" class="form-input mono" :type="showFields.password ? 'text' : 'password'" placeholder="输入或生成密码" autocomplete="off" @input="updateStrength()" />
                <div class="input-affix-btns">
                  <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="toggleSecret('password')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
                  </button>
                  <button class="pw-gen-btn" type="button" title="生成密码" aria-label="生成密码" @click="toggleGenPanel()">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <button class="pw-gen-btn" type="button" title="复制密码" @click="copyText(fields.password, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
          <div v-if="fields.password" class="pw-strength">
            <div class="pw-strength-bar-bg">
              <div class="pw-strength-bar" :style="{ width: strength.pct + '%', background: strength.color }"></div>
            </div>
            <div class="pw-strength-text">{{ strength.label }}</div>
          </div>
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
                <div class="pw-strength-text">{{ genStrength.label }}</div>
              </div>
              <button class="btn btn-primary btn-sm" type="button" @click="useGeneratedPassword()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
                使用此密码
              </button>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">root 账号</label>
          <div class="input-row">
            <div class="input-row-main">
              <input v-model="fields.rootUser" class="form-input" type="text" placeholder="root" autocomplete="off" />
            </div>
            <button class="pw-gen-btn" type="button" title="复制账号" @click="copyText(fields.rootUser, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">root 密码</label>
          <div class="input-row">
            <div class="input-row-main">
              <div class="input-affix">
                <input v-model="fields.rootPwd" class="form-input mono" :type="showFields.rootPwd ? 'text' : 'password'" placeholder="root 密码" autocomplete="off" />
                <div class="input-affix-btns">
                  <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="toggleSecret('rootPwd')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.rootPwd ? windowEyeClosed : windowEyeOpen"></svg>
                  </button>
                  <button class="pw-gen-btn" type="button" title="生成密码" aria-label="生成密码" @click="generateFor('rootPwd')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <button class="pw-gen-btn" type="button" title="复制密码" @click="copyText(fields.rootPwd, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
      </template>

      <!-- ══ database ══ -->
      <template v-else-if="entryType === 'database'">
        <div class="form-group">
          <label class="form-label">数据库地址</label>
          <div class="input-row">
            <div class="input-row-main">
              <input v-model="fields.url" class="form-input mono" type="text" placeholder="示例：localhost 或 10.0.0.100" autocomplete="off" />
            </div>
            <input v-model="fields.port" class="form-input mono input-port" type="number" placeholder="端口" min="1" max="65535" autocomplete="off" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">用户名</label>
          <div class="input-row">
            <div class="input-row-main">
              <input v-model="fields.username" class="form-input" type="text" placeholder="数据库用户名" autocomplete="off" />
            </div>
            <button class="pw-gen-btn" type="button" title="复制用户名" @click="copyText(fields.username, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">密码</label>
          <div class="input-row">
            <div class="input-row-main">
              <div class="input-affix">
                <input v-model="fields.password" class="form-input mono" :type="showFields.password ? 'text' : 'password'" placeholder="数据库密码" autocomplete="off" @input="updateStrength()" />
                <div class="input-affix-btns">
                  <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="toggleSecret('password')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
                  </button>
                  <button class="pw-gen-btn" type="button" title="生成密码" aria-label="生成密码" @click="toggleGenPanel()">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <button class="pw-gen-btn" type="button" title="复制密码" @click="copyText(fields.password, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
          <div v-if="fields.password" class="pw-strength">
            <div class="pw-strength-bar-bg">
              <div class="pw-strength-bar" :style="{ width: strength.pct + '%', background: strength.color }"></div>
            </div>
            <div class="pw-strength-text">{{ strength.label }}</div>
          </div>
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
                <div class="pw-strength-text">{{ genStrength.label }}</div>
              </div>
              <button class="btn btn-primary btn-sm" type="button" @click="useGeneratedPassword()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
                使用此密码
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- ══ ai ══ -->
      <template v-else-if="entryType === 'ai'">
        <div class="form-group">
          <label class="form-label">服务名称</label>
          <input v-model="fields.username" class="form-input" type="text" placeholder="示例：DeepSeek / OpenAI / 通义千问 / Kimi" autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label">API 地址</label>
          <input v-model="fields.url" class="form-input" type="url" placeholder="https://api.deepseek.com / https://api.openai.com" autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label">Token <span class="text-danger">*</span></label>
          <div class="input-affix">
            <input v-model="fields.password" class="form-input mono" :type="showFields.password ? 'text' : 'password'" placeholder="输入 Token" autocomplete="off" />
            <div class="input-affix-btns">
              <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="toggleSecret('password')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- ══ app ══ -->
      <template v-else-if="entryType === 'app'">
        <div class="form-group">
          <label class="form-label">App ID</label>
          <input v-model="fields.appId" class="form-input mono" type="text" placeholder="示例：2019031163548107" autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label">公钥</label>
          <div class="input-affix mono-textarea-wrap">
            <textarea v-model="fields.password" class="form-input mono mono-textarea" rows="3" placeholder="输入公钥" autocomplete="off"></textarea>
            <div class="input-affix-btns">
              <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="toggleSecret('password')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
              </button>
              <button class="pw-gen-btn" type="button" title="复制" @click="copyText(fields.password, $event.currentTarget)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">私钥</label>
          <div class="input-affix mono-textarea-wrap">
            <textarea v-model="fields.privateKey" class="form-input mono mono-textarea" rows="3" placeholder="输入私钥（证书级长度）" autocomplete="off"></textarea>
            <div class="input-affix-btns">
              <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="toggleSecret('privateKey')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.privateKey ? windowEyeClosed : windowEyeOpen"></svg>
              </button>
              <button class="pw-gen-btn" type="button" title="复制" @click="copyText(fields.privateKey, $event.currentTarget)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- ══ other ══ -->
      <template v-else>
        <div class="form-group">
          <label class="form-label">凭证名称</label>
          <input v-model="fields.username" class="form-input" type="text" placeholder="示例：API 密钥 / 许可证 / 证书 / 授权码" autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label">凭证值 <span class="text-danger">*</span></label>
          <div class="input-affix">
            <input v-model="fields.password" class="form-input mono" :type="showFields.password ? 'text' : 'password'" placeholder="输入凭证值" autocomplete="off" />
            <div class="input-affix-btns">
              <button class="pw-gen-btn" type="button" title="显示/隐藏" aria-label="显示或隐藏密码" @click="toggleSecret('password')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- 标签 -->
      <div class="form-group">
        <label class="form-label">标签</label>
        <div class="tag-selector" id="tag-selector">
          <span
            v-for="name in selectedTags"
            :key="'s-' + name"
            class="tag-chip"
            @click="toggleTag(name)"
          >
            <span v-html="tagIconSvg(name)"></span>
            {{ name }}
            <span class="tag-chip-x">×</span>
          </span>
          <div class="tag-input-wrapper">
            <input
              v-model="newTag"
              type="text"
              id="e-tag-input"
              placeholder="输入标签后按 Enter"
              @keydown.enter.prevent="addNewTag()"
            />
          </div>
          <div v-if="availableTags.length" class="tag-suggestions">
            <button
              v-for="name in availableTags"
              :key="'a-' + name"
              type="button"
              class="tag-option"
              @click="addNewTagByName(name)"
            >
              <span v-html="tagIconSvg(name)"></span>
              <span>{{ name }}</span>
            </button>
          </div>
        </div>
        <div class="tag-hint">点击推荐标签或输入后按 Enter 添加；可在「设置 → 标签管理」中增删改颜色与图标</div>
      </div>

      <!-- 备注 -->
      <div class="form-group">
        <label class="form-label">备注 <span class="text-muted text-sm">(支持 Markdown)</span></label>
        <textarea
          v-model="notes"
          class="form-input notes-textarea"
          rows="3"
          maxlength="256"
          placeholder="支持 Markdown 格式..."
        ></textarea>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" @click="handleClose()">取消</button>
      <button id="entry-editor-save" class="btn btn-primary" @click="onSave()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
        保存
      </button>
    </div>
  </ModalBase>
</template>
