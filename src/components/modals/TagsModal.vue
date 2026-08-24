<script setup>
/* LockPass — 标签管理模态框（Vue 迁移）
   复刻原生 settings.js 标签管理：列表（默认排前 + 计数 + 颜色样本）、
   新增/编辑表单（名称 / 颜色选择器 / 图标选择器）、重命名同步条目、删除 */
import { ref, computed, onMounted } from 'vue'
import { useVault, vaultState, TAG_COLOR_OPTIONS, TAG_ICON_OPTIONS } from '../../composables/useVault'
import ModalBase from '../common/ModalBase.vue'

const { closeModal, saveVault } = useVault()

/* ── 视图状态：list | form ── */
const view = ref('list')
const editingName = ref(null) // null=新增，string=编辑
const formName = ref('')
const formColor = ref('#58a6ff')
const formIcon = ref('other')

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
  if (!name) { window.Utils.showToast('请输入标签名称', 'error'); return }
  if (name.length > 20) { window.Utils.showToast('标签名称最多 20 个字符', 'error'); return }

  const defs = tagDefs.value
  // 新增/改名时检查重名
  if (!editingName.value && defs[name]) { window.Utils.showToast('标签已存在', 'error'); return }
  if (editingName.value && name !== editingName.value && defs[name]) { window.Utils.showToast('标签名称冲突', 'error'); return }

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
    editingName.value && name !== editingName.value ? '标签已重命名'
      : editingName.value ? '标签已更新' : '标签已添加',
    'success',
  )
}

async function confirmDeleteTag(name) {
  const usedCount = tagCounts.value[name] || 0
  const confirmed = await window.Utils.confirm({
    title: '删除标签',
    message: `确定删除标签「${name}」？${usedCount > 0 ? `该标签被 ${usedCount} 条密码使用，删除后这些条目将不再拥有此标签。` : ''}`,
    confirmText: '删除',
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
  window.Utils.showToast('标签已删除', 'success')
}

function tagIconSvg(name) {
  const def = tagDefs.value[name]
  return window.Utils.getCategoryIcon(def ? def.icon : 'other', def ? def.color : '#8b949e')
}

function pickerIconSvg(iconId) {
  return window.Utils.getCategoryIcon(iconId, formColor.value)
}
</script>

<template>
  <ModalBase :max-width="'560px'" @close="closeModal()">
    <!-- 列表视图 -->
    <template v-if="view === 'list'">
      <div class="modal-header">
        <h2>标签管理</h2>
        <button class="btn-icon" @click="closeModal()" tabindex="-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div class="modal-body p-0">
        <div class="tag-manage-list">
          <div v-if="!sortedTags.length" class="empty-state-lg">暂无标签</div>
          <div v-for="name in sortedTags" :key="name" class="tag-manage-row">
            <div class="tag-manage-icon" v-html="tagIconSvg(name)"></div>
            <div class="tag-manage-info">
              <div class="tag-manage-name">{{ name }}</div>
              <div class="tag-manage-meta">
                <span class="tag-manage-count">{{ tagCounts[name] || 0 }} 条密码</span>
                <span v-if="tagDefs[name] && tagDefs[name].isDefault" class="tag-manage-badge">默认</span>
              </div>
            </div>
            <div class="tag-manage-color-swatch" :style="{ background: tagDefs[name].color }" title="颜色"></div>
            <div class="tag-manage-actions">
              <button class="btn btn-ghost btn-sm" @click="openEditForm(name)" title="编辑">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                编辑
              </button>
              <button v-if="!(tagDefs[name] && tagDefs[name].isDefault)" class="btn btn-ghost btn-sm btn-danger-ghost" @click="confirmDeleteTag(name)" title="删除">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                删除
              </button>
            </div>
          </div>
        </div>
        <div class="tag-manage-add">
          <button class="btn btn-primary btn-full" @click="openAddForm()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            添加新标签
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="closeModal()">关闭</button>
      </div>
    </template>

    <!-- 表单视图（新增/编辑） -->
    <template v-else>
      <div class="modal-header">
        <h2>{{ editingName ? '编辑标签' : '添加标签' }}</h2>
        <button class="btn-icon" @click="view = 'list'" tabindex="-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">标签名称 <span class="text-danger">*</span></label>
          <input v-model="formName" class="form-input" type="text" placeholder="例如：社交" maxlength="20" />
          <div v-if="editingIsDefault" class="tag-hint">默认标签不可删除名称，可修改颜色与图标</div>
        </div>
        <div class="form-group">
          <label class="form-label">颜色</label>
          <div class="color-picker-grid">
            <button v-for="c in TAG_COLOR_OPTIONS" :key="c" type="button"
              class="color-swatch-btn" :class="{ selected: formColor === c }"
              :style="{ background: c }" :title="c" @click="selectColor(c)">
            </button>
          </div>
        </div>
        <div class="form-group mb-0">
          <label class="form-label">图标</label>
          <div class="icon-picker-grid">
            <button v-for="iconId in TAG_ICON_OPTIONS" :key="iconId" type="button"
              class="icon-pick-btn" :class="{ selected: formIcon === iconId }"
              :title="iconId" @click="selectIcon(iconId)">
              <span v-html="pickerIconSvg(iconId)"></span>
            </button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="view = 'list'">取消</button>
        <button class="btn btn-primary" @click="saveTagForm()">保存</button>
      </div>
    </template>
  </ModalBase>
</template>