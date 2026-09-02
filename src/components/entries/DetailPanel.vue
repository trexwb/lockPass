<script setup>
/* LockPass — 密码详情面板
   v1.0.32：为标题/字段/标签/关联/历史 增加右键快捷菜单 */
import { computed, reactive } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import { useCtxMenu } from '../../composables/useCtxMenu'
import { useSwipeClose } from '../../composables/useSwipeClose'
import FieldRow from './FieldRow.vue'
import SecretFieldRow from './SecretFieldRow.vue'
import CustomFieldRow from './CustomFieldRow.vue'
import CtxMenu from '../common/CtxMenu.vue'
import { useI18n } from '../../composables/useI18n'
// S1 修复（分级缓存）：复制入口的预填草稿改走分级 store（内存全量明文，
// sessionStorage 仅落非敏感脱敏子集），不再把含密码明文 JSON 直写 sessionStorage
import { saveDraft as memSaveDraft } from '../../composables/editorDraftStore.js'

const {
  getEntryById, closeDetail, toggleFavorite, copyPassword, copyField,
  softDelete, permanentDelete, restoreEntry, openEntryModal, openModal,
  rollbackEntry, snapDiffers, describeHistoryFields, saveVault,
  toggleDetailPassword, revealDetailPasswordOnce,
} = useVault()

const Icons = window.Utils?.SvgIcons

const { t } = useI18n()

const entry = computed(() => (vaultState.selectedEntry ? getEntryById(vaultState.selectedEntry) : null))

const isRecycleView = computed(() => vaultState.currentFilter === 'recycle')
// 密码显隐：从 vaultState.showPasswordMap 读取（独立于 entry 数据对象）
const showPw = computed(() => !!(entry.value && vaultState.showPasswordMap[entry.value.id]))

// P2-6 修复：面板 open/animating 类由响应式状态驱动（selectEntry 维护）
const panelOpen = computed(() => !!entry.value && vaultState.detailAnim !== 'collapse')
const panelAnimating = computed(() => vaultState.detailAnim === 'collapse' || vaultState.detailAnim === 'reopen')

// 右滑关闭手势（详情面板在右侧，手指右滑 → translateX 跟随 → 超阈值关闭）
// 仅移动端抽屉模式（≤1024px）且面板已打开时启用
const { dragOffset, isDragging, onTouchStart, onTouchMove, onTouchEnd } = useSwipeClose({
  direction: 'right',
  threshold: 80,
  onClose: () => closeDetail(),
  isEnabled: () => window.matchMedia('(max-width: 1024px)').matches && !!entry.value,
})
const panelStyle = computed(() => {
  if (!isDragging.value || !dragOffset.value) return null
  return { transform: `translateX(${dragOffset.value}px)`, transition: 'none' }
})

function maskValue(v) {
  return showPw.value ? String(v ?? '') : '••••••••'
}

/* ── 自定义字段分组（upgrade-design.md §1.4：敏感字段默认掩码、独立揭示） ── */

const customReveal = reactive({})
const visibleCustomFields = computed(() =>
  (entry.value?.customFields || []).filter(cf => cf && (String(cf.label ?? '').trim() || String(cf.value ?? '').trim()))
)
function toggleCustomReveal(id) {
  customReveal[id] = !customReveal[id]
}

function tagStyle(name) {
  const def = vaultState.tagDefs[name]
  if (!def) return {}
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

/* ── 修改历史 ── */

const historyList = computed(() => {
  const e = entry.value
  if (!e) return []
  return vaultState.history[e.id] || []
})

async function onRollback(snap) {
  if (!entry.value) return
  await rollbackEntry(entry.value.id, snap.at)
}

function historyPw(snap) {
  const pw = snap.snap ? snap.snap.password : snap.password
  return showPw.value ? String(pw ?? '') : '••••••••'
}

function historyChanged(snap) {
  return snap.snap ? t('detail.history.changed', { fields: describeHistoryFields(snap.fields) || t('detail.history.allFields') }) : t('detail.history.legacy')
}

// 关联密码条目类型图标
function relatedTypeIcon(type) {
  return window.Utils?.SvgIcons?.typeIcon(12, type || 'website') || ''
}

/* ── 命令提示行 ── */

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

/* ── 关联密码 ── */

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

const renderedNotes = computed(() => {
  if (!entry.value?.notes || !window.Utils?.parseMarkdown) return ''
  return window.Utils.parseMarkdown(entry.value.notes)
})

/* ════════════════════════════════════════════════════════════════
   详情面板右键菜单（payload.kind：entry/field/tag/related/history/note/title）
   ════════════════════════════════════════════════════════════════ */

const { ctxMenu, handleCtxMenu, onCtxAction } = useCtxMenu(async (action, payload) => {
  const e = entry.value
  if (!e) return
  const id = e.id

  switch (payload?.kind) {
    case 'entry':
    case 'title': {
      if (action === 'edit') openEntryModal(id)
      else if (action === 'duplicate') {
        // S1 修复（分级缓存）：先写分级草稿（内存全量明文 + 脱敏 storage），
        // 再打开编辑器 —— onMounted 从内存即时读到完整副本；不再直写明文 sessionStorage
        try {
          memSaveDraft('new', {
            title: (e.title || t('detail.untitled')) + ' ' + t('detail.copySuffix'),
            entryType: e.entryType || 'website',
            tags: e.tags || [],
            notes: e.notes || '',
            fields: {
              username: e.username || '', password: e.password || '', url: e.url || '',
              port: e.port ? String(e.port) : '', appId: e.appId || '',
              privateKey: e.privateKey || '',
              rootUser: e.root?.username || '', rootPwd: e.root?.password || '',
            },
          })
        } catch (_e) { /* 草稿写入失败不阻断打开编辑器 */ }
        // 草稿生命周期 v1.1.12b：复制为新条目的意图明确（立即编辑副本），
        // 传 draftAction:'use' 让编辑器直接应用草稿，不再重复弹「是否使用草稿」询问
        openEntryModal(null, { draftAction: 'use' })
        window.Utils.showToast(t('detail.toastCopiedDraft'), 'info')
      }
      else if (action === 'fav') toggleFavorite(id)
      else if (action === 'qr-share') openModal('qr-share')
      else if (action === 'copy-pw') copyPassword(id)
      else if (action === 'copy-user') copyField(e.username || '')
      else if (action === 'copy-url') copyField(e.url || '')
      else if (action === 'copy-all') {
        const text = [
          e.title && `# ${e.title}`,
          e.username && `${t('detail.copyAll.username')}: ${e.username}`,
          e.password && `${t('detail.copyAll.password')}: ${e.password}`,
          e.url && `${t('detail.copyAll.url')}: ${e.url}`,
          e.port && `${t('detail.copyAll.port')}: ${e.port}`,
          e.appId && `App ID: ${e.appId}`,
          e.tags?.length && `${t('detail.copyAll.tags')}: ${e.tags.join('、')}`,
          e.notes && `\n${t('detail.copyAll.notes')}:\n${e.notes}`,
        ].filter(Boolean).join('\n')
        copyField(text)
      }
      else if (action === 'open-url' && e.url) {
        let u = e.url
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u
        window.Utils.openExternal(u)
      }
      else if (action === 'copy-ssh') copyField(sshCommand.value)
      else if (action === 'copy-mysql') copyField(mysqlCommand.value)
      else if (action === 'close-detail') closeDetail()
      else if (action === 'soft-delete') softDelete(id)
      else if (action === 'restore') restoreEntry(id)
      else if (action === 'purge') permanentDelete(id)
      break
    }
    case 'field': {
      const { label, value, secret, url } = payload
      if (action === 'copy-field') copyField(value || '')
      else if (action === 'reveal-once' && secret) {
        // 已显示时重置计时，始终弹提示（使用独立函数避免翻转逻辑干扰）
        revealDetailPasswordOnce()
      }
      else if (action === 'open-url' && url) {
        let u = value || ''
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u
        window.Utils.openExternal(u)
      }
      break
    }
    case 'cmd': {
      if (action === 'copy-field') copyField(payload.value || '')
      break
    }
    case 'custom-field': {
      const cf = payload.cf
      if (!cf) break
      if (action === 'copy-field') copyField(String(cf.value ?? ''))
      else if (action === 'reveal-once') toggleCustomReveal(cf.id)
      break
    }
    case 'tag': {
      const name = payload.name
      if (!name) return
      if (action === 'filter') { vaultState.currentFilter = name; closeDetail(); return }
      if (action === 'manage') openModal('tags')
      if (action === 'remove') {
        if (!e.tags || !e.tags.includes(name)) return
        e.tags = e.tags.filter(tg => tg !== name)
        e.updatedAt = new Date().toISOString()
        await saveVault()
        window.Utils.showToast(t('detail.toastTagRemoved', { name }), 'success')
      }
      if (action === 'rename-here') {
        const newName = await window.Utils.prompt({
          title: t('detail.renameTagTitle'),
          message: t('detail.renameTagPrompt', { name }),
          value: name,
          confirmText: t('detail.renameConfirm'),
        })?.trim()
        if (!newName || newName === name) return
        if (!e.tags) return
        const idx = e.tags.indexOf(name)
        if (idx < 0) return
        if (!vaultState.tagDefs[newName]) {
          const attrs = window.Utils.getRandomTagAttrs(vaultState.tagDefs)
          vaultState.tagDefs[newName] = { color: attrs.color, icon: attrs.icon, isDefault: false }
        }
        if (!e.tags.includes(newName)) e.tags.splice(idx, 1, newName)
        else e.tags.splice(idx, 1)
        e.updatedAt = new Date().toISOString()
        await saveVault()
        window.Utils.showToast(t('detail.toastTagRenamed'), 'success')
      }
      break
    }
    case 'related': {
      const relId = payload?.id
      if (!relId) return
      if (action === 'open') selectRelated(relId)
      else if (action === 'open-new') { selectRelated(relId); openEntryModal(relId) }
      else if (action === 'copy-pw') copyPassword(relId)
      else if (action === 'copy-url') {
        const rel = vaultState.entries.find(x => x.id === relId)
        copyField(rel?.url || '')
      }
      break
    }
    case 'history': {
      const snap = payload?.snap
      if (!snap) return
      if (action === 'rollback') rollbackEntry(id, snap.at)
      else if (action === 'copy-pw') {
        const pw = snap.snap ? snap.snap.password : snap.password
        copyField(pw || '')
      }
      else if (action === 'copy-snap') {
        const s = snap.snap || { password: snap.password }
        const fieldsText = Object.keys(s).map(k => `${k}: ${String(s[k] ?? '')}`).join('\n')
        copyField(fieldsText)
      }
      break
    }
    case 'note': {
      if (action === 'copy-field') copyField(entry.value?.notes || '')
      else if (action === 'edit') openEntryModal(id)
      break
    }
  }
})

const detailCtxItems = computed(() => {
  const p = ctxMenu.payload
  const e = entry.value
  if (!p || !e) return []

  const list = []
  const recycled = isRecycleView.value

  switch (p.kind) {
    case 'entry':
    case 'title': {
      list.push({ key: 'edit', label: t('detail.ctx.edit'), iconHtml: Icons?.edit(14), accent: true })
      list.push({ key: 'duplicate', label: t('detail.ctx.duplicate'), iconHtml: Icons?.copy(14) })
      list.push({ key: 'fav', label: e.favorite ? t('detail.ctx.unfav') : t('detail.ctx.fav'), iconHtml: e.favorite ? Icons?.starFilled(14) : Icons?.starOutline(14) })
      list.push({ key: 'qr-share', label: t('detail.ctx.qrShare'), iconHtml: Icons?.qr(14) })
      list.push({ divider: true })
      list.push({ key: 'copy-pw', label: e.entryType === 'app' ? t('detail.ctx.copyAppId') : t('detail.ctx.copyPw'), iconHtml: Icons?.copy(14) })
      if (e.username) list.push({ key: 'copy-user', label: t('detail.ctx.copyUser'), iconHtml: Icons?.user(14) })
      if (e.url) list.push({ key: 'copy-url', label: t('detail.ctx.copyUrl'), iconHtml: Icons?.link(14) })
      list.push({ key: 'copy-all', label: t('detail.ctx.copyAll'), iconHtml: Icons?.share(14) })
      if (e.url) list.push({ key: 'open-url', label: t('detail.ctx.openUrl'), iconHtml: Icons?.external(14) })
      if (e.entryType === 'server' && sshCommand.value) list.push({ key: 'copy-ssh', label: t('detail.ctx.copySsh'), iconHtml: Icons?.terminal(14) })
      if (e.entryType === 'database' && mysqlCommand.value) list.push({ key: 'copy-mysql', label: t('detail.ctx.copyMysql'), iconHtml: Icons?.terminal(14) })
      list.push({ divider: true })
      list.push({ key: 'close-detail', label: t('detail.ctx.closeDetail'), iconHtml: Icons?.close(14) })
      if (recycled) {
        list.push({ key: 'restore', label: t('detail.ctx.restore'), iconHtml: Icons?.restore(14), accent: true })
        list.push({ key: 'purge', label: t('detail.ctx.purge'), iconHtml: Icons?.trash(14), danger: true })
      } else {
        list.push({ key: 'soft-delete', label: t('detail.ctx.softDelete'), iconHtml: Icons?.trash(14), danger: true })
      }
      return list
    }
    case 'field': {
      const { label, value, secret, url } = p
      list.push({ key: 'copy-field', label: t('detail.ctx.copyField', { label: label || t('detail.ctx.fieldValue') }), iconHtml: Icons?.copy(14), accent: true, disabled: !value })
      if (secret) list.push({ key: 'reveal-once', label: t('detail.ctx.revealOnce'), iconHtml: Icons?.eye(14) })
      if (url) list.push({ key: 'open-url', label: t('detail.ctx.openUrl'), iconHtml: Icons?.external(14) })
      return list
    }
    case 'custom-field': {
      const cf = p.cf
      if (!cf) return []
      list.push({ key: 'copy-field', label: t('detail.custom.ctxCopy'), iconHtml: Icons?.copy(14), accent: true, disabled: !cf.value })
      if (cf.sensitive) list.push({ key: 'reveal-once', label: t('detail.custom.ctxReveal'), iconHtml: Icons?.eye(14) })
      return list
    }
    case 'cmd': {
      list.push({ key: 'copy-field', label: t('detail.ctx.copyCmd'), iconHtml: Icons?.copy(14), accent: true, disabled: !p.value })
      return list
    }
    case 'tag': {
      const name = p.name
      list.push({ key: 'filter', label: t('side.ctxFilterTag', { tag: name }), iconHtml: tagIconSvg(name), accent: true })
      list.push({ key: 'manage', label: t('detail.ctx.manageTags'), iconHtml: Icons?.palette(14) })
      list.push({ key: 'rename-here', label: t('detail.ctx.renameHere'), iconHtml: Icons?.edit(14) })
      list.push({ key: 'remove', label: t('detail.ctx.removeTag'), iconHtml: Icons?.close(14), danger: true })
      return list
    }
    case 'related': {
      const rel = vaultState.entries.find(x => x.id === p.id) || relatedEntries.value.find(r => r.entry?.id === p.id)?.entry
      const title = rel?.title || t('detail.ctx.relatedFallback')
      list.push({ key: 'open', label: t('detail.ctx.openRelated', { title }), iconHtml: Icons?.grid(14), accent: true })
      list.push({ key: 'open-new', label: t('detail.ctx.openAndEdit'), iconHtml: Icons?.edit(14) })
      list.push({ key: 'copy-pw', label: t('detail.ctx.copyItsPw'), iconHtml: Icons?.copy(14) })
      if (rel?.url) list.push({ key: 'copy-url', label: t('detail.ctx.copyItsUrl'), iconHtml: Icons?.link(14) })
      return list
    }
    case 'history': {
      const snap = p.snap
      const differ = snap && snapDiffers(e, snap)
      list.push({ key: 'rollback', label: t('detail.ctx.rollback'), iconHtml: Icons?.restore(14), accent: true, disabled: !differ })
      list.push({ key: 'copy-pw', label: t('detail.ctx.copySnapPw'), iconHtml: Icons?.copy(14) })
      list.push({ key: 'copy-snap', label: t('detail.ctx.copySnapAll'), iconHtml: Icons?.share(14) })
      return list
    }
    case 'note': {
      list.push({ key: 'copy-field', label: t('detail.ctx.copyNotes'), iconHtml: Icons?.copy(14), accent: true })
      list.push({ key: 'edit', label: t('detail.ctx.editWithNotes'), iconHtml: Icons?.edit(14) })
      return list
    }
  }
  return list
})
</script>

<template>
  <div id="detail-backdrop" @click="closeDetail()" aria-hidden="true"></div>
  <aside
    id="detail-panel"
    :class="{ open: panelOpen, animating: panelAnimating, swiping: isDragging }"
    :style="panelStyle"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
    @touchcancel.passive="onTouchEnd"
  >
    <div class="swipe-hint" aria-hidden="true"></div>
    <template v-if="entry">
      <div
        class="detail-header"
        @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'title' }, { w: 280, h: 400 })"
      >
        <h3 id="detail-title" :title="t('detail.tipTitleCtx')">{{ entry.title || t('detail.untitled') }}</h3>
        <div class="detail-header-actions">
          <button
            v-if="!isRecycleView"
            id="detail-fav-btn"
            class="btn-icon"
            :class="{ active: entry.favorite }"
            :title="t('detail.tipFavCtx')"
            :aria-label="entry.favorite ? t('detail.ctx.unfav') : t('detail.fav')"
            @click="toggleFavorite(entry.id)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" :fill="entry.favorite ? 'var(--warning)' : 'none'" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button class="btn-icon" :title="t('detail.close')" :aria-label="t('detail.ariaCloseDetail')" @click="closeDetail()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div class="detail-body" @contextmenu.prevent.stop.self="handleCtxMenu($event, { kind: 'entry' }, { w: 280, h: 400 })">
        <div class="detail-fields">
          <!-- 网站 -->
          <template v-if="(entry.entryType || 'website') === 'website'">
            <FieldRow v-if="entry.username" :label="t('detail.field.username')" :value="entry.username" copyable
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.username'), value: entry.username }, { w: 220, h: 120 })" />
            <SecretFieldRow :label="t('detail.field.password')" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.password'), value: entry.password, secret: true }, { w: 240, h: 160 })" />
            <FieldRow v-if="entry.url" :label="t('detail.field.websiteUrl')" :value="entry.url" linkable
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.websiteUrl'), value: entry.url, url: true }, { w: 240, h: 160 })" />
          </template>

          <!-- 服务器 -->
          <template v-else-if="entry.entryType === 'server'">
            <FieldRow v-if="entry.url" :label="t('detail.field.host')" :value="entry.url" linkable
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.host'), value: entry.url, url: true }, { w: 240, h: 160 })" />
            <FieldRow v-if="entry.username" :label="t('detail.field.loginAccount')" :value="entry.username" copyable
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.loginAccount'), value: entry.username }, { w: 220, h: 120 })" />
            <SecretFieldRow :label="t('detail.field.loginPassword')" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.loginPassword'), value: entry.password, secret: true }, { w: 240, h: 160 })" />
            <div
              v-if="sshCommand"
              class="detail-field cmd-field"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'cmd', label: t('detail.field.sshCmd'), value: sshCommand }, { w: 200, h: 110 })"
            >
              <div class="detail-field-label">{{ t('detail.field.cmd') }}</div>
              <div class="detail-field-value cmd-value">
                <code class="cmd-text">{{ sshCommand }}</code>
                <button class="btn-icon" :title="t('detail.ctx.copyCmd')" :aria-label="t('detail.ctx.copyCmd')" @click="copyField(sshCommand, $event.currentTarget)"><span v-html="Icons.copy(14)"></span></button>
              </div>
            </div>
            <template v-if="entry.root && (entry.root.username || entry.root.password)">
              <div class="detail-section-divider"><span>root</span></div>
              <FieldRow v-if="entry.root.username" :label="t('detail.field.rootUser')" :value="entry.root.username" copyable
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.rootUser'), value: entry.root.username }, { w: 220, h: 120 })" />
              <SecretFieldRow :label="t('detail.field.rootPassword')" :value="entry.root.password" :show="showPw" copy-mode="value"
                @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.rootPassword'), value: entry.root.password, secret: true }, { w: 240, h: 160 })" />
            </template>
          </template>

          <!-- 数据库 -->
          <template v-else-if="entry.entryType === 'database'">
            <!-- C1 修复：展示 dbType/dbName（与编辑器 schema 对齐） -->
            <FieldRow v-if="entry.dbType" :label="t('detail.field.dbType')" :value="entry.dbType" copyable
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.dbType'), value: entry.dbType }, { w: 220, h: 120 })" />
            <FieldRow v-if="entry.dbName" :label="t('detail.field.dbName')" :value="entry.dbName" copyable
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.dbName'), value: entry.dbName }, { w: 220, h: 120 })" />
            <FieldRow
              v-if="entry.url"
              :label="t('detail.field.dbHost')"
              :value="entry.url"
              linkable
              :display-suffix="entry.port ? ':' + entry.port : ''"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.dbHost'), value: entry.url, url: true }, { w: 240, h: 160 })"
            />
            <FieldRow v-if="entry.username" :label="t('detail.field.username')" :value="entry.username" copyable
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.username'), value: entry.username }, { w: 220, h: 120 })" />
            <SecretFieldRow :label="t('detail.field.password')" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.password'), value: entry.password, secret: true }, { w: 240, h: 160 })" />
            <div
              v-if="mysqlCommand"
              class="detail-field cmd-field"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'cmd', label: t('detail.field.mysqlCmd'), value: mysqlCommand }, { w: 200, h: 110 })"
            >
              <div class="detail-field-label">{{ t('detail.field.cmd') }}</div>
              <div class="detail-field-value cmd-value">
                <code class="cmd-text">{{ mysqlCommand }}</code>
                <button class="btn-icon" :title="t('detail.ctx.copyCmd')" :aria-label="t('detail.ctx.copyCmd')" @click="copyField(mysqlCommand, $event.currentTarget)"><span v-html="Icons.copy(14)"></span></button>
              </div>
            </div>
          </template>

          <!-- AI -->
          <template v-else-if="entry.entryType === 'ai'">
            <FieldRow v-if="entry.username" :label="t('detail.field.serviceName')" :value="entry.username" copyable push-right
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.serviceName'), value: entry.username }, { w: 220, h: 120 })" />
            <FieldRow v-if="entry.url" :label="t('detail.field.apiHost')" :value="entry.url" linkable
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.apiHost'), value: entry.url, url: true }, { w: 240, h: 160 })" />
            <SecretFieldRow v-if="entry.password" label="Token" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: 'Token', value: entry.password, secret: true }, { w: 240, h: 160 })" />
          </template>

          <!-- 应用 -->
          <template v-else-if="entry.entryType === 'app'">
            <FieldRow v-if="entry.appId" label="App ID" :value="entry.appId" copyable
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: 'App ID', value: entry.appId }, { w: 220, h: 120 })" />
            <SecretFieldRow :label="t('detail.field.publicKey')" :value="entry.password" :show="showPw" copy-mode="value"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.publicKey'), value: entry.password, secret: true }, { w: 240, h: 160 })" />
            <SecretFieldRow v-if="entry.privateKey" :label="t('detail.field.privateKey')" :value="entry.privateKey" :show="showPw" copy-mode="value"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.privateKey'), value: entry.privateKey, secret: true }, { w: 240, h: 160 })" />
          </template>

          <!-- 其他 -->
          <template v-else>
            <FieldRow v-if="entry.username" :label="t('detail.field.credName')" :value="entry.username" copyable
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.credName'), value: entry.username }, { w: 220, h: 120 })" />
            <SecretFieldRow :label="t('detail.field.credValue')" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'field', label: t('detail.field.credValue'), value: entry.password, secret: true }, { w: 240, h: 160 })" />
          </template>
        </div>

        <!-- 自定义字段分组（upgrade-design.md §1.4：敏感字段默认掩码、点击揭示） -->
        <template v-if="visibleCustomFields.length">
          <div class="detail-section-divider"><span>{{ t('detail.custom.title', { n: visibleCustomFields.length }) }}</span></div>
          <CustomFieldRow
            v-for="cf in visibleCustomFields"
            :key="cf.id"
            :label="cf.label || t('detail.custom.unnamed')"
            :value="cf.value"
            :sensitive="!!cf.sensitive"
            :show="!!customReveal[cf.id]"
            @toggle-reveal="toggleCustomReveal(cf.id)"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'custom-field', cf }, { w: 230, h: 140 })"
          />
        </template>

        <div v-if="entry.tags && entry.tags.length" class="detail-field">
          <div class="detail-field-label">{{ t('detail.field.tags') }}</div>
          <div class="detail-field-value tag-list">
            <span
              v-for="tag in entry.tags"
              :key="tag"
              class="tag-chip"
              :style="tagStyle(tag)"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'tag', name: tag }, { w: 280, h: 200 })"
              :title="t('detail.tipTagCtx', { tag })"
            >{{ tag }}</span>
          </div>
        </div>

        <div
          v-if="entry.notes"
          class="detail-field"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'note' }, { w: 240, h: 130 })"
        >
          <div class="detail-field-label">{{ t('detail.field.notes') }}</div>
          <div class="detail-field-value markdown-body" v-html="renderedNotes"></div>
        </div>

        <!-- 修改历史 -->
        <div v-if="!isRecycleView && historyList.length" class="detail-field history-section">
          <div class="detail-field-label">{{ t('detail.history.title', { n: historyList.length }) }}</div>
          <div class="history-list">
            <div
              v-for="snap in historyList"
              :key="snap.at"
              class="history-item"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'history', snap }, { w: 260, h: 170 })"
            >
              <div class="history-meta">
                <span class="history-time">{{ formatDateTime(snap.at) }}</span>
                <span class="history-pw mono">{{ historyPw(snap) }}</span>
                <span class="history-changed">{{ historyChanged(snap) }}</span>
              </div>
              <button
                class="btn btn-secondary btn-sm"
                :disabled="!snapDiffers(entry, snap)"
                @click="onRollback(snap)"
              >{{ t('detail.rollbackBtn') }}</button>
            </div>
          </div>
        </div>

        <!-- 关联密码 -->
        <div v-if="relatedEntries.length" class="detail-field related-section">
          <div class="detail-field-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            {{ t('detail.related.title', { n: relatedEntries.length }) }}
          </div>
          <div class="related-list">
            <div
              v-for="item in relatedEntries"
              :key="item.entry.id"
              class="related-item"
              role="button"
              tabindex="0"
              :aria-label="t('detail.related.ariaView', { title: item.entry.title })"
              @click="selectRelated(item.entry.id)"
              @keydown.enter="selectRelated(item.entry.id)"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'related', id: item.entry.id, title: item.entry.title }, { w: 260, h: 180 })"
            >
              <div class="entry-icon" v-html="relatedTypeIcon(item.entry.entryType)"></div>
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

      <div class="detail-footer">
        <template v-if="isRecycleView">
          <button class="btn btn-secondary flex-1" @click="restoreEntry(entry.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><polyline points="3 3 3 8 8 8" /></svg>
            {{ t('detail.footer.restore') }}
          </button>
          <button class="btn btn-danger" @click="permanentDelete(entry.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
            {{ t('detail.ctx.purge') }}
          </button>
        </template>
        <template v-else>
          <button class="btn btn-secondary flex-1" @click="openEntryModal(entry.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            {{ t('detail.footer.edit') }}
          </button>
          <button
            class="btn btn-secondary"
            :title="entry.entryType === 'app' ? t('detail.footer.copyAppIdTip') : t('detail.ctx.copyPw')"
            :aria-label="entry.entryType === 'app' ? t('detail.ctx.copyAppId') : t('detail.ctx.copyPw')"
            @click="copyPassword(entry.id, $event.currentTarget)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            {{ entry.entryType === 'app' ? t('detail.ctx.copyAppId') : t('detail.field.copy') }}
          </button>
          <button class="btn btn-secondary" :title="t('detail.ctx.qrShare')" @click="openModal('qr-share')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3z" /><path d="M21 14v3h-3" /></svg>
            {{ t('detail.footer.qr') }}
          </button>
          <button class="btn btn-danger" @click="onDelete()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
            {{ t('detail.footer.delete') }}
          </button>
        </template>
      </div>
    </template>

    <!-- 详情面板统一右键菜单（Teleport 到 body，避免被 aside overflow 裁切） -->
    <CtxMenu :menu="ctxMenu" :items="detailCtxItems" :aria-label="t('detail.ariaCtxMenu')" @action="onCtxAction" />
  </aside>
</template>
