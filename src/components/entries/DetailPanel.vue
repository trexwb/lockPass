<script setup>
/* LockPass — 密码详情面板
   Vue 3 迁移：复刻原生 entries.js 的 renderDetailPanel / renderDetailFooter，
   含各类型字段行、命令提示行、root 分区、markdown 备注、关联密码、回收站分支。
   P2-7 重构：六类型字段块抽取为 FieldRow / SecretFieldRow 复用组件，消除约 10 处复制粘贴。 */
import { computed } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import FieldRow from './FieldRow.vue'
import SecretFieldRow from './SecretFieldRow.vue'

const {
  getEntryById, closeDetail, toggleFavorite, copyPassword, copyField,
  softDelete, permanentDelete, restoreEntry, openEntryModal, openModal,
  rollbackEntry, snapDiffers, describeHistoryFields,
} = useVault()

const entry = computed(() => (vaultState.selectedEntry ? getEntryById(vaultState.selectedEntry) : null))

const isRecycleView = computed(() => vaultState.currentFilter === 'recycle')
// 密码显隐：从 vaultState.showPasswordMap 读取（独立于 entry 数据对象）
const showPw = computed(() => !!(entry.value && vaultState.showPasswordMap[entry.value.id]))

// P2-6 修复：面板 open/animating 类由响应式状态驱动（selectEntry 维护）
const panelOpen = computed(() => !!entry.value && vaultState.detailAnim !== 'collapse')
const panelAnimating = computed(() => vaultState.detailAnim === 'collapse' || vaultState.detailAnim === 'reopen')

function maskValue(v) {
  return showPw.value ? String(v ?? '') : '••••••••'
}

function tagStyle(name) {
  const def = vaultState.tagDefs[name]
  if (!def) return {}
  // 复审修复：--chip-color 注入前过十六进制白名单（对齐 P3-6 的 safeTagColor 链路）
  return { '--chip-color': window.Utils.safeTagColor(def.color) }
}

// 标签 chip 图标：复用旧版 renderTagChip 的 getCategoryIcon
function tagIconSvg(name) {
  const def = vaultState.tagDefs[name] || {}
  return window.Utils.getCategoryIcon(def.icon || 'other', def.color || '#8b949e')
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch (e) {
    return ''
  }
}

function formatDateTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${formatDate(iso)} ${hh}:${mm}`
  } catch (e) {
    return ''
  }
}

/* ── 修改历史（最新在前，回收站视图不展示；回滚前由 rollbackEntry 内置确认弹窗防误操作） ── */

const historyList = computed(() => {
  const e = entry.value
  if (!e) return []
  return vaultState.history[e.id] || []
})

async function onRollback(snap) {
  if (!entry.value) return
  // 回滚成功后不关闭面板：entry 为响应式对象，字段值与按钮禁用态自动刷新；
  // 被执行的那条记录会被删除并从列表移除
  await rollbackEntry(entry.value.id, snap.at)
}

function historyPw(snap) {
  const pw = snap.snap ? snap.snap.password : snap.password
  return showPw.value ? String(pw ?? '') : '••••••••'
}

function historyChanged(snap) {
  return snap.snap ? ('变更：' + (describeHistoryFields(snap.fields) || '全部字段')) : '旧版记录 · 仅密码'
}

// 关联密码条目类型图标（对齐原版 related.js renderRelatedSection）
function relatedTypeIcon(type) {
  return window.Utils?.SvgIcons?.typeIcon(12, type || 'website') || ''
}

/* ── 命令提示行（server / database）；
   P3-1 修复：改 computed，避免每次重渲染重复执行拼串 ── */

const sshCommand = computed(() => {
  const e = entry.value
  if (!e || !e.username || !e.url) return ''
  const sshPort = e.port ? ` -p ${e.port}` : ''
  return `ssh${sshPort} ${e.username}@${e.url}`
})

const mysqlCommand = computed(() => {
  const e = entry.value
  if (!e || !e.url || !e.username) return ''
  const dbPort = e.port ? ` -P ${e.port}` : ''
  return `mysql -h ${e.url}${dbPort} -u ${e.username} -p`
})

/* ── 关联密码（core/related.js 已挂载到 window.RelatedEntries） ── */

const relatedEntries = computed(() => {
  const e = entry.value
  if (!e || !window.RelatedEntries) return []
  return window.RelatedEntries.getRelatedEntries(e)
})

function selectRelated(id) {
  vaultState.selectedEntry = id
}

function onDelete() {
  softDelete(entry.value?.id)
}

// P3-1 修复：renderNotes 改 computed（内容随 entry.notes 变化时才重新解析 Markdown）
const renderedNotes = computed(() => {
  if (!entry.value?.notes || !window.Utils?.parseMarkdown) return ''
  return window.Utils.parseMarkdown(entry.value.notes)
})
</script>

<template>
  <div id="detail-backdrop" @click="closeDetail()" aria-hidden="true"></div>
  <aside id="detail-panel" :class="{ open: panelOpen, animating: panelAnimating }">
    <template v-if="entry">
      <div class="detail-header">
        <h3 id="detail-title">{{ entry.title || '未命名' }}</h3>
        <div class="detail-header-actions">
          <button
            v-if="!isRecycleView"
            id="detail-fav-btn"
            class="btn-icon"
            :class="{ active: entry.favorite }"
            title="收藏"
            :aria-label="entry.favorite ? '取消收藏' : '收藏'"
            @click="toggleFavorite(entry.id)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" :fill="entry.favorite ? 'var(--warning)' : 'none'" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button class="btn-icon" title="关闭" aria-label="关闭详情" @click="closeDetail()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div class="detail-body">
        <div class="detail-fields">
          <!-- 网站 -->
          <template v-if="(entry.entryType || 'website') === 'website'">
            <FieldRow v-if="entry.username" label="用户名" :value="entry.username" copyable />
            <SecretFieldRow label="密码" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id" />
            <FieldRow v-if="entry.url" label="网址" :value="entry.url" linkable />
          </template>

          <!-- 服务器 -->
          <template v-else-if="entry.entryType === 'server'">
            <FieldRow v-if="entry.url" label="连接地址" :value="entry.url" linkable />
            <FieldRow v-if="entry.username" label="登录账号" :value="entry.username" copyable />
            <SecretFieldRow label="登录密码" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id" />
            <div v-if="sshCommand" class="detail-field cmd-field">
              <div class="detail-field-label">连接命令</div>
              <div class="detail-field-value cmd-value">
                <code class="cmd-text">{{ sshCommand }}</code>
                <button class="btn-icon" title="复制命令" aria-label="复制命令" @click="copyField(sshCommand, $event.currentTarget)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
              </div>
            </div>
            <template v-if="entry.root && (entry.root.username || entry.root.password)">
              <div class="detail-section-divider"><span>root</span></div>
              <FieldRow v-if="entry.root.username" label="root 账号" :value="entry.root.username" copyable />
              <SecretFieldRow label="root 密码" :value="entry.root.password" :show="showPw" copy-mode="value" />
            </template>
          </template>

          <!-- 数据库 -->
          <template v-else-if="entry.entryType === 'database'">
            <FieldRow
              v-if="entry.url"
              label="数据库地址"
              :value="entry.url"
              linkable
              :display-suffix="entry.port ? ':' + entry.port : ''"
            />
            <FieldRow v-if="entry.username" label="用户名" :value="entry.username" copyable />
            <SecretFieldRow label="密码" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id" />
            <div v-if="mysqlCommand" class="detail-field cmd-field">
              <div class="detail-field-label">连接命令</div>
              <div class="detail-field-value cmd-value">
                <code class="cmd-text">{{ mysqlCommand }}</code>
                <button class="btn-icon" title="复制命令" aria-label="复制命令" @click="copyField(mysqlCommand, $event.currentTarget)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
              </div>
            </div>
          </template>

          <!-- AI -->
          <template v-else-if="entry.entryType === 'ai'">
            <FieldRow v-if="entry.username" label="服务名称" :value="entry.username" copyable push-right />
            <FieldRow v-if="entry.url" label="API 地址" :value="entry.url" linkable />
            <SecretFieldRow v-if="entry.password" label="Token" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id" />
          </template>

          <!-- 应用 -->
          <template v-else-if="entry.entryType === 'app'">
            <FieldRow v-if="entry.appId" label="App ID" :value="entry.appId" copyable />
            <SecretFieldRow label="公钥" :value="entry.password" :show="showPw" copy-mode="value" />
            <SecretFieldRow v-if="entry.privateKey" label="私钥" :value="entry.privateKey" :show="showPw" copy-mode="value" />
          </template>

          <!-- 其他 -->
          <template v-else>
            <FieldRow v-if="entry.username" label="凭证名称" :value="entry.username" copyable />
            <SecretFieldRow label="凭证值" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id" />
          </template>
        </div>

        <div v-if="entry.tags && entry.tags.length" class="detail-field">
          <div class="detail-field-label">标签</div>
          <div class="detail-field-value tag-list">
            <span v-for="t in entry.tags" :key="t" class="tag-chip" :style="tagStyle(t)">{{ t }}</span>
          </div>
        </div>

        <div v-if="entry.notes" class="detail-field">
          <div class="detail-field-label">备注</div>
          <div class="detail-field-value markdown-body" v-html="renderedNotes"></div>
        </div>

        <!-- 修改历史（任意字段变更均记录，默认保留最近 5 版；不参与导入导出） -->
        <div v-if="!isRecycleView && historyList.length" class="detail-field history-section">
          <div class="detail-field-label">修改历史（{{ historyList.length }}）</div>
          <div class="history-list">
            <div v-for="snap in historyList" :key="snap.at" class="history-item">
              <div class="history-meta">
                <span class="history-time">{{ formatDateTime(snap.at) }}</span>
                <span class="history-pw mono">{{ historyPw(snap) }}</span>
                <span class="history-changed">{{ historyChanged(snap) }}</span>
              </div>
              <button
                class="btn btn-secondary btn-sm"
                :disabled="!snapDiffers(entry, snap)"
                @click="onRollback(snap)"
              >回滚</button>
            </div>
          </div>
        </div>

        <!-- 关联密码（同 IP / 同域名 / 同账号） -->
        <div v-if="relatedEntries.length" class="detail-field related-section">
          <div class="detail-field-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            关联密码（{{ relatedEntries.length }}）
          </div>
          <div class="related-list">
            <div
              v-for="item in relatedEntries"
              :key="item.entry.id"
              class="related-item"
              role="button"
              tabindex="0"
              :aria-label="`查看关联密码 ${item.entry.title}`"
              @click="selectRelated(item.entry.id)"
              @keydown.enter="selectRelated(item.entry.id)"
            >
              <div class="entry-icon" v-html="relatedTypeIcon(item.entry.type)"></div>
              <div class="entry-info">
                <div class="entry-title">{{ item.entry.title }}</div>
                <div class="entry-meta">
                  <span v-if="item.entry.username">{{ item.entry.username }}</span>
                  <span class="entry-date">{{ formatDate(item.entry.updatedAt || item.entry.createdAt) }}</span>
                </div>
              </div>
              <div class="related-reasons">
                <span
                  v-for="reason in item.reasons"
                  :key="reason.type + reason.label"
                  class="related-reason"
                  :class="reason.type"
                  :title="reason.detail"
                >{{ reason.label }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

        <div id="clipboard-note" class="clipboard-note mt-1 hidden"></div>
      <div class="detail-footer">
        <template v-if="isRecycleView">
          <button class="btn btn-secondary flex-1" @click="restoreEntry(entry.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><polyline points="3 3 3 8 8 8" /></svg>
            恢复
          </button>
          <button class="btn btn-danger" @click="permanentDelete(entry.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
            彻底删除
          </button>
        </template>
        <template v-else>
          <button class="btn btn-secondary flex-1" @click="openEntryModal(entry.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            编辑
          </button>
          <button
            class="btn btn-secondary"
            :title="entry.entryType === 'app' ? '复制 App ID（公钥/私钥请在详情行单独复制）' : '复制密码'"
            :aria-label="entry.entryType === 'app' ? '复制 App ID' : '复制密码'"
            @click="copyPassword(entry.id, $event.currentTarget)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            {{ entry.entryType === 'app' ? '复制 App ID' : '复制' }}
          </button>
          <button class="btn btn-secondary" title="分享为二维码" @click="openModal('qr-share')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3z" /><path d="M21 14v3h-3" /></svg>
            二维码
          </button>
          <button class="btn btn-danger" @click="onDelete()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
            删除
          </button>
        </template>
      </div>
    </template>
  </aside>
</template>
