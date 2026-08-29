<script setup>
/* LockPass — 密码条目编辑器（新增 / 编辑）
   Vue 3 迁移：对齐原生 editor.js —— app 类型（App ID/公钥/私钥）、
   密码生成面板（长度/字符集/排除歧义/强度条）、保存按钮 id=entry-editor-save */
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useVault, vaultState, ENTRY_TYPES } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'
import { useCtxMenu } from '../../composables/useCtxMenu'
import CtxMenu from '../common/CtxMenu.vue'

const { getEntryById, saveEntry, closeModal, copyToClipboard, openModal } = useVault()

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
  ai: ['username', 'url', 'password'],
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

// 秘密字段自动隐藏计时器（按字段 key 管理，避免重复计时）
const _secretTimers = {}
const SECRET_AUTO_HIDE_MS = 5000

/**
 * 显示秘密字段后 5 秒自动隐藏
 * @param {string} k - 字段 key（password / privateKey / rootPwd 等）
 */
function _scheduleAutoHide(k) {
  if (_secretTimers[k]) clearTimeout(_secretTimers[k])
  _secretTimers[k] = setTimeout(() => {
    showFields[k] = false
    delete _secretTimers[k]
  }, SECRET_AUTO_HIDE_MS)
}

function toggleSecret(k) {
  showFields[k] = !showFields[k]
  if (showFields[k]) _scheduleAutoHide(k)
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
  _scheduleAutoHide('password')
  genPanelOpen.value = false
}

function generatePw() {
  // 快捷生成：直接填入密码字段（与原生"生成"按钮等价）
  const pw = genPasswordNow()
  fields.password = pw
  showFields.password = true
  _scheduleAutoHide('password')
  updateStrength()
}

// 局部生成：直接填入指定字段（原版 generatePasswordFor 等价，root 密码用）
function generateFor(k) {
  const pw = window.PasswordGenerator.generatePassword({
    length: 16, uppercase: true, lowercase: true, numbers: true, symbols: true, noAmbiguous: false,
  })
  fields[k] = pw
  showFields[k] = true
  _scheduleAutoHide(k)
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

/* ════════════════════════════════════════════════════════════════
   右键菜单（类型 Tab / 字段 / 生成面板 / 标签 / 保存 等）
   ════════════════════════════════════════════════════════════════ */

const { ctxMenu, handleCtxMenu, onCtxAction } = useCtxMenu(async (action, payload) => {
  const kind = payload?.kind
  switch (kind) {
    case 'type-tab': {
      const t = payload.type
      if (action === 'switch' && t) entryType.value = t
      return
    }
    case 'form-input': {
      const fieldKey = payload.fieldKey
      const val = payload.value
      if (action === 'copy-value' && val) copyText(val)
      else if (action === 'paste-value' && fieldKey) {
        try {
          const t = await window.Utils.readClipboard()
          if (t != null) {
            if (fieldKey === '__title') title.value = t
            else if (fieldKey === '__notes') notes.value = t
            else if (fieldKey === '__newTag') newTag.value = t
            else fields[fieldKey] = t
          }
        } catch (_e) { window.Utils.showToast?.('剪贴板读取失败，请手动粘贴', 'warning') }
      } else if (action === 'clear-field' && fieldKey) {
        if (fieldKey === '__title') title.value = ''
        else if (fieldKey === '__notes') notes.value = ''
        else if (fieldKey === '__newTag') newTag.value = ''
        else fields[fieldKey] = ''
      }
      return
    }
    case 'pw-input': {
      const fieldKey = payload.fieldKey || 'password'
      const val = fields[fieldKey]
      if (action === 'copy-value' && val) copyText(val)
      else if (action === 'generate-here') generateFor(fieldKey)
      else if (action === 'toggle') toggleSecret(fieldKey)
      else if (action === 'clear-field') fields[fieldKey] = ''
      return
    }
    case 'gen-preview': {
      const val = genPreview.value
      if (action === 'copy-preview' && val) copyText(val)
      else if (action === 'regen') genPasswordNow()
      else if (action === 'use') useGeneratedPassword()
      return
    }
    case 'gen-charset': {
      const cs = payload.cs
      const map = { upper: 'upper', lower: 'lower', number: 'number', symbol: 'symbol', noAmbig: 'noAmbig' }
      const key = map[cs]
      if (!key) return
      if (action === 'toggle') genOptions[key] = !genOptions[key]
      if (genPanelOpen.value) genPasswordNow()
      return
    }
    case 'tag-chip': {
      const name = payload.name
      if (!name) return
      if (action === 'toggle-off') toggleTag(name)
      else if (action === 'copy-name') window.Utils.copyText(name)
      else if (action === 'manage') {
        openModal('tags')
      }
      return
    }
    case 'tag-option': {
      const name = payload.name
      if (!name) return
      if (action === 'add') addNewTagByName(name)
      else if (action === 'copy-name') window.Utils.copyText(name)
      else if (action === 'manage') {
        openModal('tags')
      }
      return
    }
    case 'footer-btn': {
      if (payload.target === 'save') {
        if (action === 'save-close') await onSave()
        else if (action === 'clear-draft') {
          clearDraft()
          window.Utils.showToast?.('已清空本次草稿', 'info')
        }
      } else if (payload.target === 'cancel') {
        if (action === 'close-discard') await handleClose()
        else if (action === 'keep-draft') { closeModal() }
      }
      return
    }
  }
})

const editorCtxItems = computed(() => {
  const p = ctxMenu.payload
  if (!p) return []
  const list = []
  const I = Icons || window.Utils.SvgIcons
  switch (p?.kind) {
    case 'type-tab': {
      const t = ENTRY_TYPES.find(x => x.id === p.type)
      list.push({ key: 'switch', label: '切换到 ' + (t?.label || p.type), iconHtml: I?.changeType?.(14) || I?.settings(14), accent: true })
      return list
    }
    case 'form-input': {
      const label = p.label || '输入框'
      if (p.value) list.push({ key: 'copy-value', label: '复制当前 ' + label, iconHtml: I?.copy?.(14), accent: true })
      list.push({ key: 'paste-value', label: '从剪贴板粘贴到此处', iconHtml: I?.share?.(14) })
      list.push({ key: 'clear-field', label: '清空此字段', iconHtml: I?.close?.(14), danger: true })
      return list
    }
    case 'pw-input': {
      const label = p.label ? `（${p.label}）` : ''
      list.push({ key: 'toggle', label: '显示 / 隐藏切换' + label, iconHtml: I?.eye?.(14), accent: true })
      list.push({ key: 'generate-here', label: '一键生成随机密码', iconHtml: I?.refresh?.(14) || I?.share?.(14) })
      const val = fields[p.fieldKey || 'password']
      if (val) list.push({ key: 'copy-value', label: '复制当前值', iconHtml: I?.copy?.(14) })
      list.push({ key: 'clear-field', label: '清空此字段', iconHtml: I?.close?.(14), danger: true })
      return list
    }
    case 'gen-preview': {
      const val = genPreview.value
      list.push({ key: 'use', label: '使用此密码到主字段', iconHtml: I?.edit?.(14), accent: true, disabled: !val })
      list.push({ key: 'regen', label: '重新生成', iconHtml: I?.refresh?.(14) || I?.share?.(14) })
      if (val) list.push({ key: 'copy-preview', label: '复制预览密码', iconHtml: I?.copy?.(14) })
      return list
    }
    case 'gen-charset': {
      const labels = { upper: '大写字母', lower: '小写字母', number: '数字', symbol: '符号', noAmbig: '排除歧义字符' }
      const label = labels[p.cs] || p.cs
      list.push({ key: 'toggle', label: '切换：' + label, iconHtml: I?.edit?.(14), accent: true })
      return list
    }
    case 'tag-chip': {
      list.push({ key: 'toggle-off', label: '从选中移除该标签', iconHtml: I?.close?.(14), accent: true })
      list.push({ key: 'copy-name', label: '复制标签名：' + p.name, iconHtml: I?.copy?.(14) })
      list.push({ key: 'manage', label: '打开标签管理器', iconHtml: I?.palette?.(14) })
      return list
    }
    case 'tag-option': {
      list.push({ key: 'add', label: '快速添加到本条：' + p.name, iconHtml: I?.edit?.(14), accent: true })
      list.push({ key: 'copy-name', label: '复制标签名', iconHtml: I?.copy?.(14) })
      list.push({ key: 'manage', label: '打开标签管理器', iconHtml: I?.palette?.(14) })
      return list
    }
    case 'footer-btn': {
      if (p.target === 'save') {
        list.push({ key: 'save-close', label: '保存并关闭（与按钮一致）', iconHtml: I?.edit?.(14), accent: true })
        list.push({ key: 'clear-draft', label: '清空当前编辑草稿', iconHtml: I?.trash?.(14) })
      } else {
        list.push({ key: 'close-discard', label: '放弃修改并关闭', iconHtml: I?.close?.(14), accent: true })
        list.push({ key: 'keep-draft', label: '直接关闭（保留草稿）', iconHtml: I?.copy?.(14) })
      }
      return list
    }
  }
  return list
})
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
          :title="t.label + '（右键快速切换）'"
          @click="entryType = t.id"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'type-tab', type: t.id }, { w: 220, h: 100 })"
        >
          <span class="type-tab-icon" v-html="typeIconSvg(t.id)"></span>
          <span>{{ t.label }}</span>
        </button>
      </div>

      <!-- 标题 -->
      <div class="form-group">
        <label class="form-label">标题 <span class="text-danger">*</span></label>
        <input
          v-model="title"
          class="form-input"
          type="text"
          placeholder="例如：Gmail / 阿里云 ECS"
          maxlength="100"
          autocomplete="off"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: '__title', label: '标题', value: title }, { w: 240, h: 170 })"
        />
      </div>

      <!-- ══ website ══ -->
      <template v-if="entryType === 'website'">
        <div class="form-group">
          <label class="form-label">用户名</label>
          <input
            v-model="fields.username"
            class="form-input"
            type="text"
            placeholder="username@example.com"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'username', label: '用户名', value: fields.username }, { w: 240, h: 170 })"
          />
        </div>
        <div class="form-group">
          <label class="form-label">密码 <span class="text-danger">*</span></label>
          <div
            class="input-affix"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password' }, { w: 260, h: 220 })"
          >
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
            <div
              class="pw-gen-preview"
              title="右键：使用 / 重新生成 / 复制"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'gen-preview' }, { w: 260, h: 200 })"
            >
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
                <label
                  class="charset-label"
                  @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'gen-charset', cs: 'upper' }, { w: 220, h: 100 })"
                ><input v-model="genOptions.upper" type="checkbox" @change="genPasswordNow()" /> 大写字母 (A-Z)</label>
                <label
                  class="charset-label"
                  @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'gen-charset', cs: 'lower' }, { w: 220, h: 100 })"
                ><input v-model="genOptions.lower" type="checkbox" @change="genPasswordNow()" /> 小写字母 (a-z)</label>
                <label
                  class="charset-label"
                  @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'gen-charset', cs: 'number' }, { w: 220, h: 100 })"
                ><input v-model="genOptions.number" type="checkbox" @change="genPasswordNow()" /> 数字 (0-9)</label>
                <label
                  class="charset-label"
                  @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'gen-charset', cs: 'symbol' }, { w: 220, h: 100 })"
                ><input v-model="genOptions.symbol" type="checkbox" @change="genPasswordNow()" /> 符号 (!@#$…)</label>
              </div>
              <div class="pw-gen-row gap-8 mt-1">
                <label
                  class="charset-label min-w-auto"
                  @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'gen-charset', cs: 'noAmbig' }, { w: 220, h: 100 })"
                ><input v-model="genOptions.noAmbig" type="checkbox" @change="genPasswordNow()" /> 排除歧义字符</label>
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
          <input
            v-model="fields.url"
            class="form-input"
            type="url"
            placeholder="https://example.com"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'url', label: '网址', value: fields.url }, { w: 240, h: 170 })"
          />
        </div>
      </template>

      <!-- ══ server ══ -->
      <template v-else-if="entryType === 'server'">
        <div class="form-group">
          <label class="form-label">连接地址</label>
          <div class="input-row">
            <div class="input-row-main">
              <input
                v-model="fields.url"
                class="form-input mono"
                type="text"
                placeholder="示例：ssh -p 22 user@1.2.3.4"
                autocomplete="off"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'url', label: '连接地址', value: fields.url }, { w: 240, h: 170 })"
              />
            </div>
            <input
              v-model="fields.port"
              class="form-input mono input-port"
              type="number"
              placeholder="端口"
              min="1"
              max="65535"
              autocomplete="off"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'port', label: '端口', value: fields.port }, { w: 240, h: 170 })"
            />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">登录账号</label>
          <div class="input-row">
            <div class="input-row-main">
              <input
                v-model="fields.username"
                class="form-input"
                type="text"
                placeholder="账号"
                autocomplete="off"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'username', label: '登录账号', value: fields.username }, { w: 240, h: 170 })"
              />
            </div>
            <button class="pw-gen-btn" type="button" title="复制账号" @click="copyText(fields.username, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">登录密码</label>
          <div class="input-row">
            <div
              class="input-row-main"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password' }, { w: 260, h: 220 })"
            >
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
            <div
              class="pw-gen-preview"
              title="右键：使用 / 重新生成 / 复制"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'gen-preview' }, { w: 260, h: 200 })"
            >
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
              <input
                v-model="fields.rootUser"
                class="form-input"
                type="text"
                placeholder="root"
                autocomplete="off"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'rootUser', label: 'root 账号', value: fields.rootUser }, { w: 240, h: 170 })"
              />
            </div>
            <button class="pw-gen-btn" type="button" title="复制账号" @click="copyText(fields.rootUser, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">root 密码</label>
          <div class="input-row">
            <div
              class="input-row-main"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'rootPwd' }, { w: 260, h: 220 })"
            >
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
              <input
                v-model="fields.url"
                class="form-input mono"
                type="text"
                placeholder="示例：localhost 或 10.0.0.100"
                autocomplete="off"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'url', label: '数据库地址', value: fields.url }, { w: 240, h: 170 })"
              />
            </div>
            <input
              v-model="fields.port"
              class="form-input mono input-port"
              type="number"
              placeholder="端口"
              min="1"
              max="65535"
              autocomplete="off"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'port', label: '端口', value: fields.port }, { w: 240, h: 170 })"
            />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">用户名</label>
          <div class="input-row">
            <div class="input-row-main">
              <input
                v-model="fields.username"
                class="form-input"
                type="text"
                placeholder="数据库用户名"
                autocomplete="off"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'username', label: '用户名', value: fields.username }, { w: 240, h: 170 })"
              />
            </div>
            <button class="pw-gen-btn" type="button" title="复制用户名" @click="copyText(fields.username, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">密码</label>
          <div class="input-row">
            <div
              class="input-row-main"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password' }, { w: 260, h: 220 })"
            >
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
            <div
              class="pw-gen-preview"
              title="右键：使用 / 重新生成 / 复制"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'gen-preview' }, { w: 260, h: 200 })"
            >
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
          <input
            v-model="fields.username"
            class="form-input"
            type="text"
            placeholder="示例：DeepSeek / OpenAI / 通义千问 / Kimi"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'username', label: '服务名称', value: fields.username }, { w: 240, h: 170 })"
          />
        </div>
        <div class="form-group">
          <label class="form-label">API 地址</label>
          <input
            v-model="fields.url"
            class="form-input"
            type="url"
            placeholder="https://api.deepseek.com / https://api.openai.com"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'url', label: 'API 地址', value: fields.url }, { w: 240, h: 170 })"
          />
        </div>
        <div class="form-group">
          <label class="form-label">Token <span class="text-danger">*</span></label>
          <div
            class="input-affix"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password' }, { w: 260, h: 220 })"
          >
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
          <input
            v-model="fields.appId"
            class="form-input mono"
            type="text"
            placeholder="示例：2019031163548107"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'appId', label: 'App ID', value: fields.appId }, { w: 240, h: 170 })"
          />
        </div>
        <div class="form-group">
          <label class="form-label">公钥</label>
          <div
            class="input-affix mono-textarea-wrap"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password', label: '公钥' }, { w: 260, h: 220 })"
          >
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
          <div
            class="input-affix mono-textarea-wrap"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'privateKey', label: '私钥' }, { w: 260, h: 220 })"
          >
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
          <input
            v-model="fields.username"
            class="form-input"
            type="text"
            placeholder="示例：API 密钥 / 许可证 / 证书 / 授权码"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'username', label: '凭证名称', value: fields.username }, { w: 240, h: 170 })"
          />
        </div>
        <div class="form-group">
          <label class="form-label">凭证值 <span class="text-danger">*</span></label>
          <div
            class="input-affix"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password', label: '凭证值' }, { w: 260, h: 220 })"
          >
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
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'tag-chip', name }, { w: 220, h: 140 })"
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
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: '__newTag', label: '标签输入', value: newTag }, { w: 240, h: 170 })"
            />
          </div>
          <div v-if="availableTags.length" class="tag-suggestions">
            <button
              v-for="name in availableTags"
              :key="'a-' + name"
              type="button"
              class="tag-option"
              @click="addNewTagByName(name)"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'tag-option', name }, { w: 220, h: 140 })"
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
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: '__notes', label: '备注', value: notes }, { w: 240, h: 170 })"
        ></textarea>
      </div>
    </div>

    <div class="modal-footer">
      <button
        class="btn btn-secondary"
        @click="handleClose()"
        @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'footer-btn', target: 'cancel' }, { w: 200, h: 100 })"
      >取消</button>
      <button
        id="entry-editor-save"
        class="btn btn-primary"
        @click="onSave()"
        @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'footer-btn', target: 'save' }, { w: 200, h: 100 })"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
        保存
      </button>
    </div>
  </ModalBase>
  <CtxMenu
    :menu="ctxMenu"
    :items="editorCtxItems"
    @action="onCtxAction"
  />
</template>
