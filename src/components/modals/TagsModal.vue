<script setup>
/* LockPass — 标签管理模态框（Vue 迁移）
   复刻原生 settings.js 标签管理：列表（默认排前 + 计数 + 颜色样本）、
   新增/编辑表单（名称 / 颜色选择器 / 图标选择器）、重命名同步条目、删除 */
import { ref, computed, onMounted } from 'vue'
import { useVault, vaultState, TAG_COLOR_OPTIONS, TAG_ICON_OPTIONS } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'
import { useCtxMenu } from '../../composables/useCtxMenu'
import CtxMenu from '../common/CtxMenu.vue'
import { useI18n } from '../../composables/useI18n'

const { closeModal, saveVault } = useVault()
const { t } = useI18n()

// P3-4：图标统一走 Utils.SvgIcons
const Icons = window.Utils.SvgIcons

/* ── 视图状态：list | form | merge ── */
const view = ref('list')
const editingName = ref(null) // null=新增，string=编辑
const formName = ref('')
const formColor = ref('#58a6ff')
const formIcon = ref('other')
const mergeFrom = ref(null)
const mergeTo = ref('')

const tagDefs = computed(() => vaultState.tagDefs || {})
const tagCounts = computed(() => {
  const map = {}
  vaultState.entries.forEach(e => {
    ;(e.tags || []).forEach(t => { map[t] = (map[t] || 0) + 1 })
  })
  return map
})

const sortedTags = computed(() => {
  const defs = tagDefs.value
  return Object.keys(defs).sort((a, b) => {
    const aDef = defs[a]
    const bDef = defs[b]
    if (aDef.isDefault && !bDef.isDefault) return -1
    if (!aDef.isDefault && bDef.isDefault) return 1
    return a.localeCompare(b)
  })
})

const editingIsDefault = computed(() => {
  if (!editingName.value) return false
  const def = tagDefs.value[editingName.value]
  return def ? !!def.isDefault : false
})

/* ── 表单操作 ── */

function openAddForm() {
  editingName.value = null
  formName.value = ''
  formColor.value = '#58a6ff'
  formIcon.value = 'other'
  view.value = 'form'
}

function openEditForm(name) {
  const def = tagDefs.value[name] || {}
  editingName.value = name
  formName.value = name
  formColor.value = def.color || '#58a6ff'
  formIcon.value = def.icon || 'other'
  view.value = 'form'
}

function selectColor(c) {
  formColor.value = c
}

function selectIcon(icon) {
  formIcon.value = icon
}

async function saveTagForm() {
  const name = formName.value.trim()
  if (!name) { window.Utils.showToast(t('tags.errNameRequired'), 'error'); return }
  if (name.length > 20) { window.Utils.showToast(t('tags.errNameTooLong'), 'error'); return }

  const defs = tagDefs.value
  // 新增/改名时检查重名
  if (!editingName.value && defs[name]) { window.Utils.showToast(t('tags.errExists'), 'error'); return }
  if (editingName.value && name !== editingName.value && defs[name]) { window.Utils.showToast(t('tags.errNameConflict'), 'error'); return }

  // 改名时：更新所有条目的 tags 数组
  if (editingName.value && name !== editingName.value) {
    vaultState.entries.forEach(entry => {
      if (entry.tags) {
        const idx = entry.tags.indexOf(editingName.value)
        if (idx !== -1) entry.tags[idx] = name
      }
    })
  }

  const oldDef = defs[editingName.value || name]
  defs[name] = {
    color: formColor.value,
    icon: formIcon.value,
    isDefault: oldDef ? oldDef.isDefault : false,
  }
  if (editingName.value && name !== editingName.value) {
    delete defs[editingName.value]
  }

  await saveVault()
  view.value = 'list'
  window.Utils.showToast(
    editingName.value && name !== editingName.value ? t('tags.renamed')
      : editingName.value ? t('tags.updated') : t('tags.added'),
    'success',
  )
}

async function confirmDeleteTag(name) {
  const usedCount = tagCounts.value[name] || 0
  const confirmed = await window.Utils.confirm({
    title: t('tags.deleteTitle'),
    message: t('tags.deleteConfirm', { name }) + (usedCount > 0 ? t('tags.deleteConfirmUsed', { n: usedCount }) : ''),
    confirmText: t('tags.deleteAction'),
    danger: true,
  })
  if (!confirmed) return

  // 从所有条目中移除该标签
  vaultState.entries.forEach(entry => {
    if (entry.tags) {
      entry.tags = entry.tags.filter(t => t !== name)
    }
  })
  delete tagDefs.value[name]
  await saveVault()
  window.Utils.showToast(t('tags.deleted'), 'success')
}

/* ── 标签合并 ── */
function openMergeForm(name) {
  mergeFrom.value = name
  mergeTo.value = ''
  view.value = 'merge'
}

const mergeTargetTags = computed(() => {
  return sortedTags.value.filter(t => t !== mergeFrom.value)
})

const mergeAffectedCount = computed(() => tagCounts.value[mergeFrom.value] || 0)

async function confirmMergeTag() {
  if (!mergeFrom.value || !mergeTo.value) {
    window.Utils.showToast(t('tags.errMergeTarget'), 'error')
    return
  }
  if (mergeFrom.value === mergeTo.value) {
    window.Utils.showToast(t('tags.errMergeSelf'), 'error')
    return
  }

  const confirmed = await window.Utils.confirm({
    title: t('tags.mergeTitle'),
    message: t('tags.mergeConfirm', { from: mergeFrom.value, to: mergeTo.value }),
    confirmText: t('tags.mergeAction'),
  })
  if (!confirmed) return

  // 遍历所有条目，替换源标签为目标标签（去重）
  vaultState.entries.forEach(entry => {
    if (entry.tags) {
      const idx = entry.tags.indexOf(mergeFrom.value)
      if (idx !== -1) {
        if (entry.tags.includes(mergeTo.value)) {
          // 目标标签已存在，移除源标签即可
          entry.tags.splice(idx, 1)
        } else {
          entry.tags[idx] = mergeTo.value
        }
      }
    }
  })

  delete tagDefs.value[mergeFrom.value]
  await saveVault()
  window.Utils.showToast(t('tags.merged', { from: mergeFrom.value, to: mergeTo.value }), 'success')
  view.value = 'list'
}

function tagIconSvg(name) {
  const def = tagDefs.value[name]
  return window.Utils.getCategoryIcon(def ? def.icon : 'other', def ? def.color : '#8b949e')
}

function pickerIconSvg(iconId) {
  return window.Utils.getCategoryIcon(iconId, formColor.value)
}

/* ════════════════════════════════════════════════════════════════
   右键菜单（标签行 / 颜色点 / 图标按钮）
   ════════════════════════════════════════════════════════════════ */

const { ctxMenu, handleCtxMenu, onCtxAction } = useCtxMenu(async (action, payload) => {
  const kind = payload?.kind
  const name = payload?.name

  if (kind === 'tag-row') {
    if (!name) return
    if (action === 'edit') openEditForm(name)
    else if (action === 'merge') openMergeForm(name)
    else if (action === 'delete') confirmDeleteTag(name)
    else if (action === 'filter') {
      // 切回主视图筛选该标签
      vaultState.currentFilter = name
      closeModal()
      window.Utils.showToast(t('tags.filtered', { name }), 'info')
    } else if (action === 'copy-name') {
      window.Utils.copyText(name)
      window.Utils.showToast?.(t('tags.copiedName'), 'info')
    } else if (action === 'copy-color') {
      const color = tagDefs.value[name]?.color || ''
      if (color) window.Utils.copyText(color)
      window.Utils.showToast?.(t('tags.copiedColor'), 'info')
    }
  } else if (kind === 'color-swatch') {
    const color = payload?.color
    if (!color) return
    if (action === 'copy-color') {
      window.Utils.copyText(color)
      window.Utils.showToast?.(t('tags.copiedColorValue', { color }), 'info')
    } else if (action === 'apply') {
      selectColor(color)
    }
  } else if (kind === 'icon-pick') {
    const iconId = payload?.icon
    if (!iconId) return
    if (action === 'apply') selectIcon(iconId)
  }
})

const tagsCtxItems = computed(() => {
  const p = ctxMenu.payload
  if (!p) return []
  const list = []
  const name = p?.name
  const isDef = name && tagDefs.value[name]?.isDefault

  switch (p?.kind) {
    case 'tag-row': {
      list.push({ key: 'edit', label: t('tags.ctxEdit'), iconHtml: Icons?.edit(14), accent: true })
      list.push({ key: 'filter', label: t('tags.ctxFilter'), iconHtml: Icons?.grid(14) })
      list.push({ key: 'copy-name', label: t('tags.ctxCopyName'), iconHtml: Icons?.copy(14) })
      list.push({ key: 'copy-color', label: t('tags.ctxCopyColor'), iconHtml: Icons?.palette(14) })
      if (!isDef) {
        list.push({ divider: true })
        list.push({ key: 'merge', label: t('tags.ctxMerge'), iconHtml: Icons?.merge?.(14) || Icons?.share(14) })
        list.push({ key: 'delete', label: t('tags.ctxDelete'), iconHtml: Icons?.trash(14), danger: true })
      }
      return list
    }
    case 'color-swatch': {
      list.push({ key: 'apply', label: t('tags.ctxPickColor'), iconHtml: Icons?.palette(14), accent: true })
      list.push({ key: 'copy-color', label: t('tags.ctxCopyColorWith', { color: p.color || '' }), iconHtml: Icons?.copy(14) })
      return list
    }
    case 'icon-pick': {
      list.push({ key: 'apply', label: t('tags.ctxPickIcon'), iconHtml: Icons?.edit(14), accent: true })
      return list
    }
  }
  return list
})
</script>

<template>
  <ModalBase :max-width="'560px'" @close="closeModal()">
    <!-- 列表视图 -->
    <template v-if="view === 'list'">
      <div class="modal-header">
        <h2>{{ t('tags.title') }}</h2>
        <button class="btn-icon" @click="closeModal()" tabindex="-1">
          <span v-html="Icons.close(16)"></span>
        </button>
      </div>
      <div class="modal-body p-0">
        <div class="tag-manage-list">
          <div v-if="!sortedTags.length" class="empty-state-lg">{{ t('tags.empty') }}</div>
          <div
            v-for="name in sortedTags"
            :key="name"
            class="tag-manage-row"
            @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'tag-row', name }, { w: 260, h: 260 })"
            :title="t('tags.rowTip', { name })"
          >
            <div class="tag-manage-icon" v-html="tagIconSvg(name)"></div>
            <div class="tag-manage-info">
              <div class="tag-manage-name">{{ name }}</div>
              <div class="tag-manage-meta">
                <span class="tag-manage-count">{{ t('tags.nEntries', { n: tagCounts[name] || 0 }) }}</span>
                <span v-if="tagDefs[name] && tagDefs[name].isDefault" class="tag-manage-badge">{{ t('tags.defaultBadge') }}</span>
              </div>
            </div>
            <div
              class="tag-manage-color-swatch"
              :style="{ background: tagDefs[name].color }"
              :title="t('tags.tipColorCopy')"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'color-swatch', color: tagDefs[name].color }, { w: 220, h: 120 })"
            ></div>
            <div class="tag-manage-actions">
              <button class="btn btn-ghost btn-sm" @click="openEditForm(name)" :title="t('tags.editBtn')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                {{ t('tags.editBtn') }}
              </button>
              <button v-if="!(tagDefs[name] && tagDefs[name].isDefault)" class="btn btn-ghost btn-sm" @click="openMergeForm(name)" :title="t('tags.tipMerge')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7h8l-2-2"/><path d="M16 17H8l2 2"/><path d="M3 12h18"/></svg>
                {{ t('tags.mergeAction') }}
              </button>
              <button v-if="!(tagDefs[name] && tagDefs[name].isDefault)" class="btn btn-ghost btn-sm btn-danger-ghost" @click="confirmDeleteTag(name)" :title="t('tags.deleteAction')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                {{ t('tags.deleteAction') }}
              </button>
            </div>
          </div>
        </div>
        <div class="tag-manage-add">
          <button class="btn btn-primary btn-full" @click="openAddForm()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {{ t('tags.addNew') }}
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="closeModal()">{{ t('modal.close') }}</button>
      </div>
    </template>

    <!-- 表单视图（新增/编辑） -->
    <template v-else-if="view === 'form'">
      <div class="modal-header">
        <h2>{{ editingName ? t('tags.editTitle') : t('tags.addTitle') }}</h2>
        <button class="btn-icon" @click="view = 'list'" tabindex="-1">
          <span v-html="Icons.close(16)"></span>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">{{ t('tags.formName') }} <span class="text-danger">*</span></label>
          <input v-model="formName" class="form-input" type="text" :placeholder="t('tags.namePlaceholder')" maxlength="20" />
          <div v-if="editingIsDefault" class="tag-hint">{{ t('tags.defaultHint') }}</div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('tags.formColor') }}</label>
          <div class="color-picker-grid">
            <button v-for="c in TAG_COLOR_OPTIONS" :key="c" type="button"
              class="color-swatch-btn" :class="{ selected: formColor === c }"
              :style="{ background: c }" :title="t('tags.tipSwatchCopy', { color: c })" @click="selectColor(c)"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'color-swatch', color: c }, { w: 220, h: 120 })"
            >
            </button>
          </div>
        </div>
        <div class="form-group mb-0">
          <label class="form-label">{{ t('tags.formIcon') }}</label>
          <div class="icon-picker-grid">
            <button v-for="iconId in TAG_ICON_OPTIONS" :key="iconId" type="button"
              class="icon-pick-btn" :class="{ selected: formIcon === iconId }"
              :title="t('tags.tipIconQuick', { icon: iconId })" @click="selectIcon(iconId)"
              @contextmenu.prevent.stop="handleCtxMenu($event, { kind: 'icon-pick', icon: iconId }, { w: 200, h: 100 })"
            >
              <span v-html="pickerIconSvg(iconId)"></span>
            </button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="view = 'list'">{{ t('confirm.default.cancel') }}</button>
        <button class="btn btn-primary" @click="saveTagForm()">{{ t('tags.saveBtn') }}</button>
      </div>
    </template>

    <!-- 合并视图 -->
    <template v-else-if="view === 'merge'">
      <div class="modal-header">
        <h2>{{ t('tags.mergeTitle') }}</h2>
        <button class="btn-icon" @click="view = 'list'" tabindex="-1">
          <span v-html="Icons.close(16)"></span>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">{{ t('tags.mergeSource') }}</label>
          <div class="merge-source-info">
            <span class="tag-manage-color-swatch" :style="{ background: tagDefs[mergeFrom]?.color }"></span>
            <span class="merge-source-name">{{ mergeFrom }}</span>
            <span class="tag-manage-count">{{ t('tags.nEntries', { n: mergeAffectedCount }) }}</span>
          </div>
        </div>
        <div class="form-group mb-0">
          <label class="form-label">{{ t('tags.mergeInto') }} <span class="text-danger">*</span></label>
          <select v-model="mergeTo" class="form-input">
            <option value="" disabled>{{ t('tags.mergePlaceholder') }}</option>
            <option v-for="tag in mergeTargetTags" :key="tag" :value="tag">{{ t('tags.mergeOption', { name: tag, n: tagCounts[tag] || 0 }) }}</option>
          </select>
          <div class="tag-hint">{{ t('tags.mergeHint') }}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="view = 'list'">{{ t('confirm.default.cancel') }}</button>
        <button class="btn btn-primary" @click="confirmMergeTag()">{{ t('tags.mergeAction') }}</button>
      </div>
    </template>

    <CtxMenu :menu="ctxMenu" :items="tagsCtxItems" :aria-label="t('tags.ctxAria')" @action="onCtxAction" />
  </ModalBase>
</template>