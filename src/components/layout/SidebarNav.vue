<script setup>
/* LockPass — 侧边栏（添加 / 个人筛选 / 类型筛选 / 热门标签 / 退出） */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useVault, vaultState, ENTRY_TYPES } from '../../composables/useVault'

const {
  setFilter, openEntryModal, openModal, computeSidebarStats, getTopTags, logout,
} = useVault()

const addDropdownOpen = ref(false)
const tagSectionOpen = ref(true)
const sidebarOpen = ref(false)

const stats = computed(() => computeSidebarStats())
const topTags = computed(() => getTopTags(8))

const typeLabels = {
  website: '网站', server: '服务器', database: '数据库', ai: 'AI', app: '应用', other: '其他',
}

function selectFilter(f) {
  setFilter(f)
  sidebarOpen.value = false
}

function onDocClick(e) {
  if (addDropdownOpen.value && !e.target.closest('#add-entry-dropdown')) {
    addDropdownOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})

// 类型图标：复用 window.Utils.SvgIcons.typeIcon
function typeIconSvg(type, size = 14) {
  return window.Utils?.SvgIcons?.typeIcon(size, type) || ''
}

// 标签图标：复用旧版 getCategoryIcon
function tagIconSvg(name) {
  const def = vaultState.tagDefs[name] || {}
  return window.Utils.getCategoryIcon(def.icon || 'other', def.color || '#8b949e')
}
</script>

<template>
  <aside id="sidebar" :class="{ 'sidebar-open': vaultState.sidebarOpen }">
    <div class="sidebar-scroll">
      <div class="sidebar-section">
        <div class="btn-dropdown" id="add-entry-dropdown">
          <button class="btn btn-primary btn-full btn-dropdown-main" @click="openEntryModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            添加密码
          </button>
          <button class="btn btn-primary btn-dropdown-toggle" aria-label="更多添加方式" title="更多添加方式" @click="addDropdownOpen = !addDropdownOpen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div class="btn-dropdown-menu" :class="{ hidden: !addDropdownOpen }">
            <button @click="openModal('qr-import'); addDropdownOpen = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 14h3v3h-3z" /><path d="M21 14v3h-3" />
              </svg>
              二维码添加
            </button>
            <button @click="openModal('import'); addDropdownOpen = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              批量导入
            </button>
          </div>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title">个人</div>
        <nav id="nav-personal">
          <div
            class="nav-item"
            :class="{ active: vaultState.currentFilter === 'all' }"
            @click="selectFilter('all')"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            全部密码
            <span class="nav-badge">{{ stats.total }}</span>
          </div>
          <div
            class="nav-item"
            :class="{ active: vaultState.currentFilter === 'favorites' }"
            @click="selectFilter('favorites')"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" :fill="vaultState.currentFilter === 'favorites' ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            收藏
            <span class="nav-badge">{{ stats.favorites }}</span>
          </div>
          <div
            class="nav-item"
            :class="{ active: vaultState.currentFilter === 'recycle' }"
            @click="selectFilter('recycle')"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            回收站
            <span v-if="stats.recycle" class="count">{{ stats.recycle }}</span>
          </div>
        </nav>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title">类型筛选</div>
        <nav id="nav-types" class="nav-types">
          <div
            v-for="t in ENTRY_TYPES"
            :key="t.id"
            class="nav-item"
            :class="[{ active: vaultState.currentFilter === 'type:' + t.id }, 'type-' + t.id]"
            @click="selectFilter('type:' + t.id)"
          >
            <span class="type-icon" v-html="typeIconSvg(t.id)"></span>
            {{ typeLabels[t.id] }}
            <span class="nav-badge">{{ stats.byType[t.id] || 0 }}</span>
          </div>
        </nav>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-title sidebar-title-clickable" id="tags-toggle" title="折叠/展开热门标签" @click="tagSectionOpen = !tagSectionOpen">
          热门标签
          <svg class="tag-chevron" :class="{ rotated: !tagSectionOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        <nav id="nav-categories" v-show="tagSectionOpen">
          <div
            v-for="tag in topTags"
            :key="tag.name"
            class="nav-item"
            :class="{ active: vaultState.currentFilter === tag.name }"
            @click="selectFilter(tag.name)"
          >
            <span v-html="tagIconSvg(tag.name)"></span>
            {{ tag.name }}
            <span class="count">{{ tag.count }}</span>
          </div>
        </nav>
      </div>
    </div>

    <div class="sidebar-footer">
      <button class="btn btn-ghost btn-sm btn-full" @click="logout()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        退出
      </button>
    </div>
  </aside>
</template>
