<script setup>
/* LockPass — 密码详情面板
   v1.0.32：为标题/字段/标签/关联/历史 增加右键快捷菜单 */
import { computed } from 'vue'
import { useVault, vaultState } from '../../composables/useVault'
import { useCtxMenu } from '../../composables/useCtxMenu'
import FieldRow from './FieldRow.vue'
import SecretFieldRow from './SecretFieldRow.vue'
import CtxMenu from '../common/CtxMenu.vue'

const {
  getEntryById, closeDetail, toggleFavorite, copyPassword, copyField,
  softDelete, permanentDelete, restoreEntry, openEntryModal, openModal,
  rollbackEntry, snapDiffers, describeHistoryFields, saveVault,
  toggleDetailPassword,
} = useVault()

const Icons = window.Utils?.SvgIcons

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
  return snap.snap ? ('变更：' + (describeHistoryFields(snap.fields) || '全部字段')) : '旧版记录 · 仅密码'
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
        // 先写 sessionStorage 草稿，再打开编辑器（onMounted 会立即读取）
        try {
          sessionStorage.setItem('lockpass_draft_new', JSON.stringify({
            title: (e.title || '未命名') + ' 副本',
            entryType: e.entryType || 'website',
            tags: e.tags || [],
            notes: e.notes || '',
            fields: {
              username: e.username || '', password: e.password || '', url: e.url || '',
              port: e.port ? String(e.port) : '', appId: e.appId || '',
              privateKey: e.privateKey || '',
              rootUser: e.root?.username || '', rootPwd: e.root?.password || '',
            },
          }))
        } catch (_e) {}
        openEntryModal(null)
        window.Utils.showToast('已复制为新条目草稿', 'info')
      }
      else if (action === 'fav') toggleFavorite(id)
      else if (action === 'qr-share') openModal('qr-share')
      else if (action === 'copy-pw') copyPassword(id)
      else if (action === 'copy-user') copyField(e.username || '')
      else if (action === 'copy-url') copyField(e.url || '')
      else if (action === 'copy-all') {
        const text = [
          e.title && `# ${e.title}`,
          e.username && `用户名: ${e.username}`,
          e.password && `密码: ${e.password}`,
          e.url && `地址: ${e.url}`,
          e.port && `端口: ${e.port}`,
          e.appId && `App ID: ${e.appId}`,
          e.tags?.length && `标签: ${e.tags.join('、')}`,
          e.notes && `\n备注:\n${e.notes}`,
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
        // 复用 toggleDetailPassword 的计时器管理（统一 5 秒自动隐藏）
        if (!vaultState.showPasswordMap[id]) toggleDetailPassword()
        else { toggleDetailPassword(); toggleDetailPassword() } // 先关再开，重置计时
        window.Utils.showToast('已临时显示（5 秒后自动隐藏）', 'info')
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
    case 'tag': {
      const name = payload.name
      if (!name) return
      if (action === 'filter') { vaultState.currentFilter = name; closeDetail(); return }
      if (action === 'manage') openModal('tags')
      if (action === 'remove') {
        if (!e.tags || !e.tags.includes(name)) return
        e.tags = e.tags.filter(t => t !== name)
        e.updatedAt = new Date().toISOString()
        await saveVault()
        window.Utils.showToast(`已从条目移除标签「${name}」`, 'success')
      }
      if (action === 'rename-here') {
        const newName = await window.Utils.prompt({
          title: '重命名字段标签',
          message: `将该条目中的「${name}」改为：`,
          value: name,
          confirmText: '重命名',
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
        window.Utils.showToast('已修改该条目标签', 'success')
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
      list.push({ key: 'edit', label: '编辑条目', iconHtml: Icons?.edit(14), accent: true })
      list.push({ key: 'duplicate', label: '复制为新条目…', iconHtml: Icons?.copy(14) })
      list.push({ key: 'fav', label: e.favorite ? '取消收藏' : '加入收藏', iconHtml: e.favorite ? Icons?.starFilled(14) : Icons?.starOutline(14) })
      list.push({ key: 'qr-share', label: '分享为二维码', iconHtml: Icons?.qr(14) })
      list.push({ divider: true })
      list.push({ key: 'copy-pw', label: e.entryType === 'app' ? '复制 App ID' : '复制密码', iconHtml: Icons?.copy(14) })
      if (e.username) list.push({ key: 'copy-user', label: '复制用户名', iconHtml: Icons?.user(14) })
      if (e.url) list.push({ key: 'copy-url', label: '复制网址/地址', iconHtml: Icons?.link(14) })
      list.push({ key: 'copy-all', label: '复制全部（纯文本）', iconHtml: Icons?.share(14) })
      if (e.url) list.push({ key: 'open-url', label: '在浏览器打开', iconHtml: Icons?.external(14) })
      if (e.entryType === 'server' && sshCommand.value) list.push({ key: 'copy-ssh', label: '复制 SSH 命令', iconHtml: Icons?.terminal(14) })
      if (e.entryType === 'database' && mysqlCommand.value) list.push({ key: 'copy-mysql', label: '复制 MySQL 命令', iconHtml: Icons?.terminal(14) })
      list.push({ divider: true })
      list.push({ key: 'close-detail', label: '关闭详情面板', iconHtml: Icons?.close(14) })
      if (recycled) {
        list.push({ key: 'restore', label: '恢复条目', iconHtml: Icons?.restore(14), accent: true })
        list.push({ key: 'purge', label: '彻底删除', iconHtml: Icons?.trash(14), danger: true })
      } else {
        list.push({ key: 'soft-delete', label: '删除（移入回收站）', iconHtml: Icons?.trash(14), danger: true })
      }
      return list
    }
    case 'field': {
      const { label, value, secret, url } = p
      list.push({ key: 'copy-field', label: '复制 ' + (label || '字段值'), iconHtml: Icons?.copy(14), accent: true, disabled: !value })
      if (secret) list.push({ key: 'reveal-once', label: '临时显示 5 秒', iconHtml: Icons?.eye(14) })
      if (url) list.push({ key: 'open-url', label: '在浏览器打开', iconHtml: Icons?.external(14) })
      return list
    }
    case 'cmd': {
      list.push({ key: 'copy-field', label: '复制命令', iconHtml: Icons?.copy(14), accent: true, disabled: !p.value })
      return list
    }
    case 'tag': {
      const name = p.name
      list.push({ key: 'filter', label: `筛选标签：${name}`, iconHtml: tagIconSvg(name), accent: true })
      list.push({ key: 'manage', label: '管理标签（改色/改图标）', iconHtml: Icons?.palette(14) })
      list.push({ key: 'rename-here', label: '仅为本条目改名…', iconHtml: Icons?.edit(14) })
      list.push({ key: 'remove', label: '从该条目移除此标签', iconHtml: Icons?.close(14), danger: true })
      return list
    }
    case 'related': {
      const rel = vaultState.entries.find(x => x.id === p.id) || relatedEntries.value.find(r => r.entry?.id === p.id)?.entry
      const title = rel?.title || '该条目'
      list.push({ key: 'open', label: `打开「${title}」`, iconHtml: Icons?.grid(14), accent: true })
      list.push({ key: 'open-new', label: '打开并立即编辑', iconHtml: Icons?.edit(14) })
      list.push({ key: 'copy-pw', label: '复制其密码', iconHtml: Icons?.copy(14) })
      if (rel?.url) list.push({ key: 'copy-url', label: '复制其网址/地址', iconHtml: Icons?.link(14) })
      return list
    }
    case 'history': {
      const snap = p.snap
      const differ = snap && snapDiffers(e, snap)
      list.push({ key: 'rollback', label: '回滚到此版本', iconHtml: Icons?.restore(14), accent: true, disabled: !differ })
      list.push({ key: 'copy-pw', label: '复制当时密码', iconHtml: Icons?.copy(14) })
      list.push({ key: 'copy-snap', label: '复制该版本完整内容', iconHtml: Icons?.share(14) })
      return list
    }
    case 'note': {
      list.push({ key: 'copy-field', label: '复制备注', iconHtml: Icons?.copy(14), accent: true })
      list.push({ key: 'edit', label: '编辑条目（含备注）', iconHtml: Icons?.edit(14) })
      return list
    }
  }
  return list
})
</script>

<template>
  <div id="detail-backdrop" @click="closeDetail()" aria-hidden="true"></div>
  <aside id="detail-panel" :class="{ open: panelOpen, animating: panelAnimating }">
    <template v-if="entry">
      <div
        class="detail-header"
        @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'title' }, { w: 280, h: 400 })"
      >
        <h3 id="detail-title" title="右键：条目快捷操作">{{ entry.title || '未命名' }}</h3>
        <div class="detail-header-actions">
          <button
            v-if="!isRecycleView"
            id="detail-fav-btn"
            class="btn-icon"
            :class="{ active: entry.favorite }"
            title="收藏（右键条目标题有更多操作）"
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

      <div class="detail-body" @contextmenu.prevent.stop.self="handleCtxMenu($event, { kind: 'entry' }, { w: 280, h: 400 })">
        <div class="detail-fields">
          <!-- 网站 -->
          <template v-if="(entry.entryType || 'website') === 'website'">
            <FieldRow v-if="entry.username" label="用户名" :value="entry.username" copyable
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '用户名', value: entry.username }, { w: 220, h: 120 })" />
            <SecretFieldRow label="密码" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id"
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '密码', value: entry.password, secret: true }, { w: 240, h: 160 })" />
            <FieldRow v-if="entry.url" label="网址" :value="entry.url" linkable
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '网址', value: entry.url, url: true }, { w: 240, h: 160 })" />
          </template>

          <!-- 服务器 -->
          <template v-else-if="entry.entryType === 'server'">
            <FieldRow v-if="entry.url" label="连接地址" :value="entry.url" linkable
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '连接地址', value: entry.url, url: true }, { w: 240, h: 160 })" />
            <FieldRow v-if="entry.username" label="登录账号" :value="entry.username" copyable
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '登录账号', value: entry.username }, { w: 220, h: 120 })" />
            <SecretFieldRow label="登录密码" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id"
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '登录密码', value: entry.password, secret: true }, { w: 240, h: 160 })" />
            <div
              v-if="sshCommand"
              class="detail-field cmd-field"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'cmd', label: 'SSH 命令', value: sshCommand }, { w: 200, h: 110 })"
            >
              <div class="detail-field-label">连接命令</div>
              <div class="detail-field-value cmd-value">
                <code class="cmd-text">{{ sshCommand }}</code>
                <button class="btn-icon" title="复制命令" aria-label="复制命令" @click="copyField(sshCommand, $event.currentTarget)"><span v-html="Icons.copy(14)"></span></button>
              </div>
            </div>
            <template v-if="entry.root && (entry.root.username || entry.root.password)">
              <div class="detail-section-divider"><span>root</span></div>
              <FieldRow v-if="entry.root.username" label="root 账号" :value="entry.root.username" copyable
                @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: 'root 账号', value: entry.root.username }, { w: 220, h: 120 })" />
              <SecretFieldRow label="root 密码" :value="entry.root.password" :show="showPw" copy-mode="value"
                @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: 'root 密码', value: entry.root.password, secret: true }, { w: 240, h: 160 })" />
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
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '数据库地址', value: entry.url, url: true }, { w: 240, h: 160 })"
            />
            <FieldRow v-if="entry.username" label="用户名" :value="entry.username" copyable
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '用户名', value: entry.username }, { w: 220, h: 120 })" />
            <SecretFieldRow label="密码" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id"
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '密码', value: entry.password, secret: true }, { w: 240, h: 160 })" />
            <div
              v-if="mysqlCommand"
              class="detail-field cmd-field"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'cmd', label: 'MySQL 命令', value: mysqlCommand }, { w: 200, h: 110 })"
            >
              <div class="detail-field-label">连接命令</div>
              <div class="detail-field-value cmd-value">
                <code class="cmd-text">{{ mysqlCommand }}</code>
                <button class="btn-icon" title="复制命令" aria-label="复制命令" @click="copyField(mysqlCommand, $event.currentTarget)"><span v-html="Icons.copy(14)"></span></button>
              </div>
            </div>
          </template>

          <!-- AI -->
          <template v-else-if="entry.entryType === 'ai'">
            <FieldRow v-if="entry.username" label="服务名称" :value="entry.username" copyable push-right
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '服务名称', value: entry.username }, { w: 220, h: 120 })" />
            <FieldRow v-if="entry.url" label="API 地址" :value="entry.url" linkable
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: 'API 地址', value: entry.url, url: true }, { w: 240, h: 160 })" />
            <SecretFieldRow v-if="entry.password" label="Token" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id"
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: 'Token', value: entry.password, secret: true }, { w: 240, h: 160 })" />
          </template>

          <!-- 应用 -->
          <template v-else-if="entry.entryType === 'app'">
            <FieldRow v-if="entry.appId" label="App ID" :value="entry.appId" copyable
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: 'App ID', value: entry.appId }, { w: 220, h: 120 })" />
            <SecretFieldRow label="公钥" :value="entry.password" :show="showPw" copy-mode="value"
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '公钥', value: entry.password, secret: true }, { w: 240, h: 160 })" />
            <SecretFieldRow v-if="entry.privateKey" label="私钥" :value="entry.privateKey" :show="showPw" copy-mode="value"
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '私钥', value: entry.privateKey, secret: true }, { w: 240, h: 160 })" />
          </template>

          <!-- 其他 -->
          <template v-else>
            <FieldRow v-if="entry.username" label="凭证名称" :value="entry.username" copyable
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '凭证名称', value: entry.username }, { w: 220, h: 120 })" />
            <SecretFieldRow label="凭证值" :value="entry.password" :show="showPw" copy-mode="entry" :entry-id="entry.id"
              @contextmenu.prevent.stop.native="handleCtxMenu($event, { kind: 'field', label: '凭证值', value: entry.password, secret: true }, { w: 240, h: 160 })" />
          </template>
        </div>

        <div v-if="entry.tags && entry.tags.length" class="detail-field">
          <div class="detail-field-label">标签</div>
          <div class="detail-field-value tag-list">
            <span
              v-for="t in entry.tags"
              :key="t"
              class="tag-chip"
              :style="tagStyle(t)"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'tag', name: t }, { w: 280, h: 200 })"
              :title="t + '（右键更多操作）'"
            >{{ t }}</span>
          </div>
        </div>

        <div
          v-if="entry.notes"
          class="detail-field"
          @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'note' }, { w: 240, h: 130 })"
        >
          <div class="detail-field-label">备注</div>
          <div class="detail-field-value markdown-body" v-html="renderedNotes"></div>
        </div>

        <!-- 修改历史 -->
        <div v-if="!isRecycleView && historyList.length" class="detail-field history-section">
          <div class="detail-field-label">修改历史（{{ historyList.length }}）</div>
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
              >回滚</button>
            </div>
          </div>
        </div>

        <!-- 关联密码 -->
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

    <!-- 详情面板统一右键菜单（Teleport 到 body，避免被 aside overflow 裁切） -->
    <CtxMenu :menu="ctxMenu" :items="detailCtxItems" aria-label="详情快捷操作" @action="onCtxAction" />
  </aside>
</template>
