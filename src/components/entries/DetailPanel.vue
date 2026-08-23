<script setup>
/* LockPass — 密码详情面板 */
import { computed } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'

const {
  getEntryById, closeDetail, toggleFavorite, copyPassword, copyField,
  softDelete, openEntryModal, openModal,
} = useVault()

const entry = computed(() => (vaultState.selectedEntry ? getEntryById(vaultState.selectedEntry) : null))

const FIELD_DEFS = {
  website: [
    { key: 'url', label: '网址' },
    { key: 'username', label: '用户名' },
    { key: 'password', label: '密码', secret: true },
  ],
  server: [
    { key: 'host', label: '地址' },
    { key: 'port', label: '端口' },
    { key: 'username', label: '用户名' },
    { key: 'password', label: '密码', secret: true },
  ],
  database: [
    { key: 'dbType', label: '类型' },
    { key: 'host', label: '地址' },
    { key: 'port', label: '端口' },
    { key: 'dbName', label: '数据库名' },
    { key: 'username', label: '用户名' },
    { key: 'password', label: '密码', secret: true },
  ],
  ai: [
    { key: 'apiKey', label: 'API Key', secret: true },
    { key: 'organization', label: '组织 / 项目' },
    { key: 'baseUrl', label: 'Base URL' },
  ],
  app: [
    { key: 'account', label: '账号' },
    { key: 'password', label: '密码', secret: true },
  ],
  other: [
    { key: 'username', label: '用户名 / 账号' },
    { key: 'password', label: '密码 / 凭证值', secret: true },
  ],
}

const visibleFields = computed(() => {
  if (!entry.value) return []
  const defs = FIELD_DEFS[entry.value.entryType] || FIELD_DEFS.other
  return defs.filter(f => {
    const v = entry.value[f.key]
    return v !== undefined && v !== null && String(v) !== ''
  })
})

const entryUrl = computed(() => {
  const u = entry.value?.url || ''
  return /^https?:\/\//i.test(u) ? u : u ? 'https://' + u : ''
})

function tagStyle(name) {
  const def = vaultState.tagDefs[name]
  return def
    ? { color: def.color, borderColor: def.color + '44', background: def.color + '18' }
    : {}
}

function safeOpenUrl() {
  if (!entryUrl.value) return
  const url = safeUrl(entryUrl.value)
  if (!url) return
  if (window.TauriBridge?.openExternal) window.TauriBridge.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

function safeUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href
  } catch (e) {}
  return null
}

async function onDelete() {
  await softDelete(entry.value?.id)
}
</script>

<template>
  <aside id="detail-panel" :class="{ open: !!entry }">
    <template v-if="entry">
      <div class="detail-header">
        <h3 id="detail-title">{{ entry.title }}</h3>
        <div class="detail-header-actions">
          <button
            class="btn-icon"
            :class="{ 'is-fav': entry.favorite }"
            title="收藏"
            @click="toggleFavorite(entry.id)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" :fill="entry.favorite ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button class="btn-icon" title="关闭" @click="closeDetail()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div class="detail-body">
        <div class="detail-entry-type">{{ entry.entryType || 'website' }}</div>

        <div v-if="visibleFields.length" class="detail-fields">
          <div v-for="f in visibleFields" :key="f.key" class="detail-field">
            <div class="detail-field-label">{{ f.label }}</div>
            <div class="detail-field-value">
              <span v-if="!f.secret">{{ entry[f.key] }}</span>
              <span v-else class="pw-dots">••••••••</span>
              <button
                v-if="f.secret"
                class="btn-icon btn-icon-sm"
                title="复制"
                @click="copyPassword(entry.id)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <button
                v-if="!f.secret && entry[f.key]"
                class="btn-icon btn-icon-sm"
                title="复制"
                @click="copyField(entry[f.key])"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div v-if="entry.tags && entry.tags.length" class="detail-tags">
          <span v-for="t in entry.tags" :key="t" class="detail-tag" :style="tagStyle(t)">{{ t }}</span>
        </div>

        <div v-if="entry.notes" class="detail-notes">
          <div class="detail-field-label">备注</div>
          <div class="notes-content">{{ entry.notes }}</div>
        </div>

        <a v-if="entryUrl" class="detail-url" href="#" @click.prevent="safeOpenUrl()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          打开网址
        </a>
      </div>

      <div class="detail-footer">
        <button class="btn btn-secondary flex-1" @click="openEntryModal(entry.id)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          编辑
        </button>
        <button class="btn btn-secondary" @click="copyPassword(entry.id)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          复制
        </button>
        <button class="btn btn-secondary" title="分享为二维码" @click="openModal('qr-share')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h3v3h-3z" />
            <path d="M21 14v3h-3" />
          </svg>
          二维码
        </button>
        <button class="btn btn-danger" @click="onDelete()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
          删除
        </button>
      </div>
    </template>
  </aside>
</template>
