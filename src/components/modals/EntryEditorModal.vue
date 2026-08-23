<script setup>
/* LockPass — 密码条目编辑器（新增 / 编辑） */
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
  server: ['host', 'port', 'username', 'password'],
  database: ['dbType', 'host', 'port', 'dbName', 'username', 'password'],
  ai: ['apiKey', 'organization', 'baseUrl'],
  app: ['account', 'password'],
  other: ['username', 'password'],
}

const FIELD_LABELS = {
  url: '网址',
  username: '用户名',
  password: '密码',
  host: '地址',
  port: '端口',
  dbType: '数据库类型',
  dbName: '数据库名',
  apiKey: 'API Key',
  organization: '组织 / 项目',
  baseUrl: 'Base URL',
  account: '账号',
}

const FIELD_PLACEHOLDERS = {
  url: 'https://example.com',
  username: '用户名 / 邮箱',
  password: '',
  host: '127.0.0.1',
  port: '3306',
  dbType: 'MySQL / PostgreSQL / ...',
  dbName: '数据库名',
  apiKey: 'sk-...',
  organization: 'org-...',
  baseUrl: 'https://api.openai.com',
  account: '账号',
}

const currentKeys = computed(() => TYPE_FIELD_KEYS[entryType.value] || TYPE_FIELD_KEYS.other)

const allTagNames = computed(() => Object.keys(vaultState.tagDefs))

const isSecretField = (k) => k === 'password' || k === 'apiKey'

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

function generatePw() {
  const pw = window.PasswordGenerator.generatePassword({
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    noAmbiguous: true,
  })
  fields.password = pw
}

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

onMounted(() => {
  if (isEdit.value) {
    const e = getEntryById(vaultState.editingEntryId)
    if (e) {
      title.value = e.title || ''
      entryType.value = e.entryType || 'website'
      currentKeys.value.forEach(k => { fields[k] = e[k] ?? '' })
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
          <input
            v-model="fields[k]"
            class="form-input"
            :type="isSecretField(k) ? (showFields[k] ? 'text' : 'password') : 'text'"
            :placeholder="FIELD_PLACEHOLDERS[k] || FIELD_LABELS[k]"
            autocomplete="off"
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
          <span class="form-field-label">{{ FIELD_LABELS[k] }}</span>
          <button
            v-if="k === 'password'"
            class="btn btn-ghost btn-sm"
            type="button"
            title="生成随机密码"
            @click="generatePw()"
          >
            生成
          </button>
        </div>

        <template v-if="entryType === 'server'">
          <div class="form-field-row">
            <input v-model="fields.rootUser" class="form-input" type="text" placeholder="root 用户名（可选）" autocomplete="off" />
            <span class="form-field-label">Root 用户</span>
          </div>
          <div class="form-field-row">
            <input v-model="fields.rootPwd" class="form-input" type="password" placeholder="root 密码（可选）" autocomplete="off" />
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
      <button class="btn btn-primary" @click="onSave()">保存</button>
    </div>
  </ModalBase>
</template>
