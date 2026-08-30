<script setup>
/* LockPass — 密码条目编辑器（新增 / 编辑）
   Vue 3 迁移：对齐原生 editor.js —— app 类型（App ID/公钥/私钥）、
   密码生成面板（长度/字符集/排除歧义/强度条）、保存按钮 id=entry-editor-save */
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useVault, vaultState, ENTRY_TYPES } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'
import { useCtxMenu } from '../../composables/useCtxMenu'
import CtxMenu from '../common/CtxMenu.vue'
import { useI18n } from '../../composables/useI18n'
import { CUSTOM_FIELD_TYPES, FIELD_TEMPLATES, createCustomField } from '../../core/templates'

const { getEntryById, saveEntry, closeModal, copyToClipboard, openModal, openPasswordGenerator } = useVault()
const { t } = useI18n()

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

/* ── 自定义字段（upgrade-design.md §1.4：编辑弹窗区块） ── */
const customFields = ref([])
const cfType = ref('text')
const cfLabel = ref('')
const cfReveal = reactive({})
const customTplKeys = ['bank', 'email', 'wifi', 'server', 'social', 'custom']

/* ── 自定义字段操作（upgrade-design.md §1.4） ── */
function applyTemplate(key) {
  const tpl = FIELD_TEMPLATES[key]
  if (!tpl) return
  const items = tpl.fields.map(f => createCustomField(f.label, f.type))
  customFields.value.push(...items)
}

function addCustomField() {
  const label = cfLabel.value.trim()
  customFields.value.push(createCustomField(label, cfType.value))
  cfLabel.value = ''
}

function moveCustomField(i, dir) {
  const j = i + dir
  if (i < 0 || j < 0 || j >= customFields.value.length) return
  const arr = customFields.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

function removeCustomField(i) {
  if (i < 0 || i >= customFields.value.length) return
  customFields.value.splice(i, 1)
}

function toggleCfReveal(id) {
  cfReveal[id] = !cfReveal[id]
}

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
  if (showFields[k]) {
    _scheduleAutoHide(k)
    window.Utils.showToast(t('editor.toastRevealed'), 'info')
  }
}

// 密码生成器「填入」回填：弹窗 requestPwGenFill 递增 nonce 后，回填目标字段并 5s 自动隐藏
watch(() => vaultState.pwGenFillNonce, (n) => {
  if (!n) return
  const val = vaultState.pwGenFillValue
  const field = vaultState.pwGenTarget?.field
  if (!val || !field || !(field in fields)) return
  fields[field] = val
  showFields[field] = true
  _scheduleAutoHide(field)
  updateStrength()
  window.Utils.showToast?.(t('editor.toastPwGenFilled'), 'success')
})

// 复制文本到剪贴板（P2-9 修复：走 useVault 统一安全链路——
// 成功 Toast 反馈 + 30 秒自动清除，替代原来绕过链路的裸 navigator.clipboard 调用）
async function copyText(text, btnEl = null) {
  if (!text) return
  await copyToClipboard(text, null, btnEl)
}

/* ── 密码生成器（方案 C：独立弹窗，替代原内嵌展开面板） ────── */

// 唤起独立弹窗：target 携带来源与目标字段，回填时由弹窗 requestPwGenFill 驱动
function openPwGen(fieldKey) {
  openPasswordGenerator({ source: 'entry', field: fieldKey || 'password' })
}

// 局部生成：直接填入指定字段（原版 generatePasswordFor 等价，root 密码用）
function generateFor(k) {
  openPwGen(k)
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
    strength.value = { label: `${info.label} · ${t('editor.strength.entropy', { bits: info.entropy.toFixed(0) })}`, pct: info.pct, color: info.color }
  } catch (e) {
    strength.value = { label: '', pct: 0, color: '' }
  }
}

/* ── 保存 ─────────────────────────────────────── */

// 字段校验：返回错误消息或 null
function validateForm() {
  if (!title.value.trim()) return t('editor.errTitleRequired')
  const url = fields.url?.trim() || ''
  if (url) {
    // URL 校验：接受 http(s):// 或裸域名/IP
    const isUrl = /^https?:\/\/.+/i.test(url) || /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]+)?$/i.test(url) || /^(\d{1,3}\.){3}\d{1,3}$/.test(url)
    if (!isUrl) return t('editor.errUrlFormat')
  }
  const port = fields.port
  if (port !== undefined && port !== '' && port != null) {
    const p = Number(port)
    if (!Number.isInteger(p) || p < 1 || p > 65535) return t('editor.errPortRange')
  }
  const username = fields.username?.trim() || ''
  if (username && username.includes('@')) {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)
    if (!isEmail) return t('editor.errEmailFormat')
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
    // 自定义字段扩展（upgrade-design.md §1.1）：深拷贝避免引用 vault 数据
    customFields: customFields.value.map(cf => ({ ...cf })),
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
    customFields: customFields.value.map(cf => ({ ...cf })),
  })
}

function hasUnsavedChanges() {
  if (!_initialSnapshot) return false
  return snapshotForm() !== _initialSnapshot
}

async function handleClose() {
  if (hasUnsavedChanges()) {
    const ok = await window.Utils.confirm({
      title: t('editor.confirmUnsavedTitle'),
      message: t('editor.confirmUnsavedMsg'),
      confirmText: t('editor.confirmDiscard'),
      cancelText: t('editor.confirmKeepEditing'),
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
      customFields.value = (e.customFields || []).map(cf => ({ ...cf }))

      // 恢复未保存的编辑草稿（v1.0.25：此前编辑模式草稿只写不读）
      const draft = loadDraft()
      if (draft) {
        title.value = draft.title || title.value
        if (draft.entryType) entryType.value = draft.entryType
        Object.keys(draft.fields || {}).forEach(k => { fields[k] = draft.fields[k] })
        selectedTags.value = (draft.tags || []).slice()
        if (draft.notes != null) notes.value = draft.notes
        if (Array.isArray(draft.customFields)) customFields.value = draft.customFields.map(cf => ({ ...cf }))
        window.Utils.showToast(t('editor.toastDraftRestored'), 'info')
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
      if (Array.isArray(draft.customFields)) customFields.value = draft.customFields.map(cf => ({ ...cf }))
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

watch([title, entryType, fields, selectedTags, notes, customFields], () => persistDraft(), { deep: true })

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
        } catch (_e) { window.Utils.showToast?.(t('editor.toastPasteFail'), 'warning') }
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
          window.Utils.showToast?.(t('editor.toastDraftCleared'), 'info')
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
      const te = ENTRY_TYPES.find(x => x.id === p.type)
      list.push({ key: 'switch', label: t('editor.ctxSwitchTo', { type: te ? t(te.labelKey) : p.type }), iconHtml: I?.changeType?.(14) || I?.settings(14), accent: true })
      return list
    }
    case 'form-input': {
      const label = p.label || t('editor.ctx.inputFallback')
      if (p.value) list.push({ key: 'copy-value', label: t('editor.ctx.copyCurrent', { label }), iconHtml: I?.copy?.(14), accent: true })
      list.push({ key: 'paste-value', label: t('editor.ctx.pasteHere'), iconHtml: I?.share?.(14) })
      list.push({ key: 'clear-field', label: t('editor.ctx.clearField'), iconHtml: I?.close?.(14), danger: true })
      return list
    }
    case 'pw-input': {
      const label = p.label ? t('editor.ctx.parenWrap', { label: p.label }) : ''
      list.push({ key: 'toggle', label: t('editor.ctx.toggleShowHide', { label }), iconHtml: I?.eye?.(14), accent: true })
      list.push({ key: 'generate-here', label: t('editor.ctx.genHere'), iconHtml: I?.refresh?.(14) || I?.share?.(14) })
      const val = fields[p.fieldKey || 'password']
      if (val) list.push({ key: 'copy-value', label: t('editor.ctx.copyValue'), iconHtml: I?.copy?.(14) })
      list.push({ key: 'clear-field', label: t('editor.ctx.clearField'), iconHtml: I?.close?.(14), danger: true })
      return list
    }
    case 'tag-chip': {
      list.push({ key: 'toggle-off', label: t('editor.ctx.removeSelectedTag'), iconHtml: I?.close?.(14), accent: true })
      list.push({ key: 'copy-name', label: t('editor.ctx.copyTagName', { name: p.name }), iconHtml: I?.copy?.(14) })
      list.push({ key: 'manage', label: t('editor.ctx.openTagManager'), iconHtml: I?.palette?.(14) })
      return list
    }
    case 'tag-option': {
      list.push({ key: 'add', label: t('editor.ctx.quickAddTag', { name: p.name }), iconHtml: I?.edit?.(14), accent: true })
      list.push({ key: 'copy-name', label: t('editor.ctx.copyTagNameOnly'), iconHtml: I?.copy?.(14) })
      list.push({ key: 'manage', label: t('editor.ctx.openTagManager'), iconHtml: I?.palette?.(14) })
      return list
    }
    case 'footer-btn': {
      if (p.target === 'save') {
        list.push({ key: 'save-close', label: t('editor.ctx.saveAndClose'), iconHtml: I?.edit?.(14), accent: true })
        list.push({ key: 'clear-draft', label: t('editor.ctx.clearDraft'), iconHtml: I?.trash?.(14) })
      } else {
        list.push({ key: 'close-discard', label: t('editor.ctx.discardClose'), iconHtml: I?.close?.(14), accent: true })
        list.push({ key: 'keep-draft', label: t('editor.ctx.keepDraftClose'), iconHtml: I?.copy?.(14) })
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
      <h3>{{ isEdit ? t('editor.titleEdit') : t('editor.titleAdd') }}</h3>
      <button class="btn-icon" @click="handleClose()">
        <span v-html="Icons.close(16)"></span>
      </button>
    </div>

    <div class="modal-body">
      <!-- 类型切换（与原版 type-tabs 一致） -->
      <div class="type-tabs">
        <button
          v-for="ty in ENTRY_TYPES"
          :key="ty.id"
          class="type-tab"
          :class="{ active: entryType === ty.id }"
          type="button"
          :title="t('editor.tipTypeTab', { type: t(ty.labelKey) })"
          @click="entryType = ty.id"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'type-tab', type: ty.id }, { w: 220, h: 100 })"
        >
          <span class="type-tab-icon" v-html="typeIconSvg(ty.id)"></span>
          <span>{{ t(ty.labelKey) }}</span>
        </button>
      </div>

      <!-- 标题 -->
      <div class="form-group">
        <label class="form-label">{{ t('editor.label.title') }} <span class="text-danger">*</span></label>
        <input
          v-model="title"
          class="form-input"
          type="text"
          :placeholder="t('editor.ph.title')"
          maxlength="100"
          autocomplete="off"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: '__title', label: t('editor.label.title'), value: title }, { w: 240, h: 170 })"
        />
      </div>

      <!-- ══ website ══ -->
      <template v-if="entryType === 'website'">
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.username') }}</label>
          <input
            v-model="fields.username"
            class="form-input"
            type="text"
            placeholder="username@example.com"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'username', label: t('editor.label.username'), value: fields.username }, { w: 240, h: 170 })"
          />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.password') }} <span class="text-danger">*</span></label>
          <div
            class="input-affix"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password' }, { w: 260, h: 220 })"
          >
            <input v-model="fields.password" class="form-input mono" :type="showFields.password ? 'text' : 'password'" :placeholder="t('editor.ph.password')" autocomplete="off" @input="updateStrength()" />
            <div class="input-affix-btns">
              <button class="pw-gen-btn" type="button" :title="t('editor.tipShowHide')" :aria-label="t('editor.ariaShowHidePw')" @click="toggleSecret('password')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
              </button>
              <button class="pw-gen-btn" type="button" :title="t('editor.tipGenPw')" :aria-label="t('editor.tipGenPw')" @click="openPwGen('password')">
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
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.websiteUrl') }}</label>
          <input
            v-model="fields.url"
            class="form-input"
            type="url"
            placeholder="https://example.com"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'url', label: t('editor.label.websiteUrl'), value: fields.url }, { w: 240, h: 170 })"
          />
        </div>
      </template>

      <!-- ══ server ══ -->
      <template v-else-if="entryType === 'server'">
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.host') }}</label>
          <div class="input-row">
            <div class="input-row-main">
              <input
                v-model="fields.url"
                class="form-input mono"
                type="text"
                :placeholder="t('editor.ph.host')"
                autocomplete="off"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'url', label: t('editor.label.host'), value: fields.url }, { w: 240, h: 170 })"
              />
            </div>
            <input
              v-model="fields.port"
              class="form-input mono input-port"
              type="number"
              :placeholder="t('editor.label.port')"
              min="1"
              max="65535"
              autocomplete="off"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'port', label: t('editor.label.port'), value: fields.port }, { w: 240, h: 170 })"
            />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.loginAccount') }}</label>
          <div class="input-row">
            <div class="input-row-main">
              <input
                v-model="fields.username"
                class="form-input"
                type="text"
                :placeholder="t('editor.ph.account')"
                autocomplete="off"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'username', label: t('editor.label.loginAccount'), value: fields.username }, { w: 240, h: 170 })"
              />
            </div>
            <button class="pw-gen-btn" type="button" :title="t('editor.tipCopyAccount')" @click="copyText(fields.username, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.loginPassword') }}</label>
          <div class="input-row">
            <div
              class="input-row-main"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password' }, { w: 260, h: 220 })"
            >
              <div class="input-affix">
                <input v-model="fields.password" class="form-input mono" :type="showFields.password ? 'text' : 'password'" :placeholder="t('editor.ph.password')" autocomplete="off" @input="updateStrength()" />
                <div class="input-affix-btns">
                  <button class="pw-gen-btn" type="button" :title="t('editor.tipShowHide')" :aria-label="t('editor.ariaShowHidePw')" @click="toggleSecret('password')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
                  </button>
                  <button class="pw-gen-btn" type="button" :title="t('editor.tipGenPw')" :aria-label="t('editor.tipGenPw')" @click="openPwGen('password')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <button class="pw-gen-btn" type="button" :title="t('editor.tipCopyPw')" @click="copyText(fields.password, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
          <div v-if="fields.password" class="pw-strength">
            <div class="pw-strength-bar-bg">
              <div class="pw-strength-bar" :style="{ width: strength.pct + '%', background: strength.color }"></div>
            </div>
            <div class="pw-strength-text">{{ strength.label }}</div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.rootUser') }}</label>
          <div class="input-row">
            <div class="input-row-main">
              <input
                v-model="fields.rootUser"
                class="form-input"
                type="text"
                placeholder="root"
                autocomplete="off"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'rootUser', label: t('editor.label.rootUser'), value: fields.rootUser }, { w: 240, h: 170 })"
              />
            </div>
            <button class="pw-gen-btn" type="button" :title="t('editor.tipCopyAccount')" @click="copyText(fields.rootUser, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.rootPwd') }}</label>
          <div class="input-row">
            <div
              class="input-row-main"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'rootPwd' }, { w: 260, h: 220 })"
            >
              <div class="input-affix">
                <input v-model="fields.rootPwd" class="form-input mono" :type="showFields.rootPwd ? 'text' : 'password'" :placeholder="t('editor.label.rootPwd')" autocomplete="off" />
                <div class="input-affix-btns">
                  <button class="pw-gen-btn" type="button" :title="t('editor.tipShowHide')" :aria-label="t('editor.ariaShowHidePw')" @click="toggleSecret('rootPwd')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.rootPwd ? windowEyeClosed : windowEyeOpen"></svg>
                  </button>
                  <button class="pw-gen-btn" type="button" :title="t('editor.tipGenPw')" :aria-label="t('editor.tipGenPw')" @click="openPwGen('rootPwd')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <button class="pw-gen-btn" type="button" :title="t('editor.tipCopyPw')" @click="copyText(fields.rootPwd, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
      </template>

      <!-- ══ database ══ -->
      <template v-else-if="entryType === 'database'">
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.dbHost') }}</label>
          <div class="input-row">
            <div class="input-row-main">
              <input
                v-model="fields.url"
                class="form-input mono"
                type="text"
                :placeholder="t('editor.ph.dbHost')"
                autocomplete="off"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'url', label: t('editor.label.dbHost'), value: fields.url }, { w: 240, h: 170 })"
              />
            </div>
            <input
              v-model="fields.port"
              class="form-input mono input-port"
              type="number"
              :placeholder="t('editor.label.port')"
              min="1"
              max="65535"
              autocomplete="off"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'port', label: t('editor.label.port'), value: fields.port }, { w: 240, h: 170 })"
            />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.username') }}</label>
          <div class="input-row">
            <div class="input-row-main">
              <input
                v-model="fields.username"
                class="form-input"
                type="text"
                :placeholder="t('editor.ph.dbUsername')"
                autocomplete="off"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'username', label: t('editor.label.username'), value: fields.username }, { w: 240, h: 170 })"
              />
            </div>
            <button class="pw-gen-btn" type="button" :title="t('editor.tipCopyUsername')" @click="copyText(fields.username, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.password') }}</label>
          <div class="input-row">
            <div
              class="input-row-main"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password' }, { w: 260, h: 220 })"
            >
              <div class="input-affix">
                <input v-model="fields.password" class="form-input mono" :type="showFields.password ? 'text' : 'password'" :placeholder="t('editor.ph.dbPassword')" autocomplete="off" @input="updateStrength()" />
                <div class="input-affix-btns">
                  <button class="pw-gen-btn" type="button" :title="t('editor.tipShowHide')" :aria-label="t('editor.ariaShowHidePw')" @click="toggleSecret('password')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
                  </button>
                  <button class="pw-gen-btn" type="button" :title="t('editor.tipGenPw')" :aria-label="t('editor.tipGenPw')" @click="openPwGen('password')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <button class="pw-gen-btn" type="button" :title="t('editor.tipCopyPw')" @click="copyText(fields.password, $event.currentTarget)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
          </div>
          <div v-if="fields.password" class="pw-strength">
            <div class="pw-strength-bar-bg">
              <div class="pw-strength-bar" :style="{ width: strength.pct + '%', background: strength.color }"></div>
            </div>
            <div class="pw-strength-text">{{ strength.label }}</div>
          </div>
        </div>
      </template>

      <!-- ══ ai ══ -->
      <template v-else-if="entryType === 'ai'">
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.serviceName') }}</label>
          <input
            v-model="fields.username"
            class="form-input"
            type="text"
            :placeholder="t('editor.ph.serviceName')"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'username', label: t('editor.label.serviceName'), value: fields.username }, { w: 240, h: 170 })"
          />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.apiHost') }}</label>
          <input
            v-model="fields.url"
            class="form-input"
            type="url"
            placeholder="https://api.deepseek.com / https://api.openai.com"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'url', label: t('editor.label.apiHost'), value: fields.url }, { w: 240, h: 170 })"
          />
        </div>
        <div class="form-group">
          <label class="form-label">Token <span class="text-danger">*</span></label>
          <div
            class="input-affix"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password' }, { w: 260, h: 220 })"
          >
            <input v-model="fields.password" class="form-input mono" :type="showFields.password ? 'text' : 'password'" :placeholder="t('editor.ph.token')" autocomplete="off" />
            <div class="input-affix-btns">
              <button class="pw-gen-btn" type="button" :title="t('editor.tipShowHide')" :aria-label="t('editor.ariaShowHidePw')" @click="toggleSecret('password')">
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
            :placeholder="t('editor.ph.appId')"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'appId', label: 'App ID', value: fields.appId }, { w: 240, h: 170 })"
          />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.publicKey') }}</label>
          <div
            class="input-affix mono-textarea-wrap"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password', label: t('editor.label.publicKey') }, { w: 260, h: 220 })"
          >
            <textarea v-model="fields.password" class="form-input mono mono-textarea" rows="3" :placeholder="t('editor.ph.publicKey')" autocomplete="off"></textarea>
            <div class="input-affix-btns">
              <button class="pw-gen-btn" type="button" :title="t('editor.tipShowHide')" :aria-label="t('editor.ariaShowHidePw')" @click="toggleSecret('password')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
              </button>
              <button class="pw-gen-btn" type="button" :title="t('editor.tipCopy')" @click="copyText(fields.password, $event.currentTarget)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.privateKey') }}</label>
          <div
            class="input-affix mono-textarea-wrap"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'privateKey', label: t('editor.label.privateKey') }, { w: 260, h: 220 })"
          >
            <textarea v-model="fields.privateKey" class="form-input mono mono-textarea" rows="3" :placeholder="t('editor.ph.privateKey')" autocomplete="off"></textarea>
            <div class="input-affix-btns">
              <button class="pw-gen-btn" type="button" :title="t('editor.tipShowHide')" :aria-label="t('editor.ariaShowHidePw')" @click="toggleSecret('privateKey')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.privateKey ? windowEyeClosed : windowEyeOpen"></svg>
              </button>
              <button class="pw-gen-btn" type="button" :title="t('editor.tipCopy')" @click="copyText(fields.privateKey, $event.currentTarget)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- ══ other ══ -->
      <template v-else>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.credName') }}</label>
          <input
            v-model="fields.username"
            class="form-input"
            type="text"
            :placeholder="t('editor.ph.credName')"
            autocomplete="off"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: 'username', label: t('editor.label.credName'), value: fields.username }, { w: 240, h: 170 })"
          />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('editor.label.credValue') }} <span class="text-danger">*</span></label>
          <div
            class="input-affix"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'pw-input', fieldKey: 'password', label: t('editor.label.credValue') }, { w: 260, h: 220 })"
          >
            <input v-model="fields.password" class="form-input mono" :type="showFields.password ? 'text' : 'password'" :placeholder="t('editor.ph.credValue')" autocomplete="off" />
            <div class="input-affix-btns">
              <button class="pw-gen-btn" type="button" :title="t('editor.tipShowHide')" :aria-label="t('editor.ariaShowHidePw')" @click="toggleSecret('password')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="showFields.password ? windowEyeClosed : windowEyeOpen"></svg>
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- 标签 -->
      <div class="form-group">
        <label class="form-label">{{ t('editor.label.tags') }}</label>
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
              :placeholder="t('editor.ph.tagInput')"
              @keydown.enter.prevent="addNewTag()"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: '__newTag', label: t('editor.label.tagInput'), value: newTag }, { w: 240, h: 170 })"
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
        <div class="tag-hint">{{ t('editor.tagHint') }}</div>
      </div>

      <!-- 备注 -->
      <div class="form-group">
        <label class="form-label">{{ t('editor.label.notes') }} <span class="text-muted text-sm">{{ t('editor.markdownHint') }}</span></label>
        <textarea
          v-model="notes"
          class="form-input notes-textarea"
          rows="3"
          maxlength="256"
          :placeholder="t('editor.ph.notes')"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'form-input', fieldKey: '__notes', label: t('editor.label.notes'), value: notes }, { w: 240, h: 170 })"
        ></textarea>
      </div>

      <!-- ══ 自定义字段（upgrade-design.md §1.4） ══ -->
      <div class="form-group">
        <label class="form-label">{{ t('editor.custom.title') }}</label>
        <div class="cf-tpl-row">
          <span class="cf-tpl-label">{{ t('editor.custom.tpl') }}</span>
          <button
            v-for="key in customTplKeys"
            :key="key"
            type="button"
            class="btn btn-secondary btn-sm cf-tpl-btn"
            :title="t('editor.custom.applyTemplate')"
            @click="applyTemplate(key)"
          >{{ t('editor.custom.tpl.' + key) }}</button>
        </div>
        <div class="cf-add-row">
          <select v-model="cfType" class="form-input cf-type-select" :aria-label="t('editor.custom.addHint')">
            <option v-for="tp in CUSTOM_FIELD_TYPES" :key="tp" :value="tp">{{ t('editor.custom.type.' + tp) }}</option>
          </select>
          <input
            v-model="cfLabel"
            class="form-input"
            type="text"
            :placeholder="t('editor.custom.phLabel')"
            maxlength="50"
            autocomplete="off"
            @keydown.enter.prevent="addCustomField()"
          />
          <button type="button" class="btn btn-secondary btn-sm" @click="addCustomField()">{{ t('editor.custom.add') }}</button>
        </div>
        <div v-if="customFields.length" class="cf-list">
          <div v-for="(cf, i) in customFields" :key="cf.id" class="cf-row">
            <div class="cf-row-head">
              <input v-model="cf.label" class="form-input" type="text" :placeholder="t('editor.custom.phLabel')" maxlength="50" autocomplete="off" />
              <div class="cf-row-ops">
                <button type="button" class="btn-icon btn-icon-sm" :title="t('editor.custom.moveUp')" :aria-label="t('editor.custom.moveUp')" :disabled="i === 0" @click="moveCustomField(i, -1)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15" /></svg>
                </button>
                <button type="button" class="btn-icon btn-icon-sm" :title="t('editor.custom.moveDown')" :aria-label="t('editor.custom.moveDown')" :disabled="i === customFields.length - 1" @click="moveCustomField(i, 1)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                <button type="button" class="btn-icon btn-icon-sm cf-remove" :title="t('editor.custom.remove')" :aria-label="t('editor.custom.remove')" @click="removeCustomField(i)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>
            <div class="cf-row-main">
              <div class="cf-row-value">
                <input
                  v-model="cf.value"
                  class="form-input mono"
                  :type="cf.sensitive && !cfReveal[cf.id] ? 'password' : 'text'"
                  :placeholder="t('editor.custom.phValue')"
                  autocomplete="off"
                />
                <button
                  v-if="cf.sensitive"
                  type="button"
                  class="pw-gen-btn"
                  :title="cfReveal[cf.id] ? t('editor.custom.hide') : t('editor.custom.show')"
                  :aria-label="cfReveal[cf.id] ? t('editor.custom.ariaHide') : t('editor.custom.ariaShow')"
                  @click="toggleCfReveal(cf.id)"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" v-html="cfReveal[cf.id] ? windowEyeClosed : windowEyeOpen"></svg>
                </button>
              </div>
              <select v-model="cf.type" class="form-input cf-type-select">
                <option v-for="tp in CUSTOM_FIELD_TYPES" :key="tp" :value="tp">{{ t('editor.custom.type.' + tp) }}</option>
              </select>
              <label class="cf-sensitive-toggle">
                <input type="checkbox" v-model="cf.sensitive" />
                <span>{{ t('editor.custom.sensitive') }}</span>
              </label>
            </div>
          </div>
        </div>
        <div class="tag-hint">{{ t('editor.custom.addHint') }}</div>
      </div>
    </div>

    <div class="modal-footer">
      <button
        class="btn btn-secondary"
        @click="handleClose()"
        @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'footer-btn', target: 'cancel' }, { w: 200, h: 100 })"
      >{{ t('editor.btnCancel') }}</button>
      <button
        id="entry-editor-save"
        class="btn btn-primary"
        @click="onSave()"
        @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'footer-btn', target: 'save' }, { w: 200, h: 100 })"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
        {{ t('editor.btnSave') }}
      </button>
    </div>
  </ModalBase>
  <CtxMenu
    :menu="ctxMenu"
    :items="editorCtxItems"
    @action="onCtxAction"
  />
</template>
