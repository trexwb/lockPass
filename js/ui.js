/* ═══════════════════════════════════════════════════════════════════
   LockPass — UI 渲染模块
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 渲染侧边栏
 * - 类型筛选：按 entryType 筛选
 * - 固定项目：全部密码 / 收藏 / 回收站
 * - 热门标签：按使用频率取前 8 个（仅显示有使用记录的标签）
 */
function renderSidebar() {
  // 渲染类型筛选
  const typeContainer = document.getElementById('nav-types');
  if (typeContainer) {
    const typeLabels = { website: '网站', server: '服务器', database: '数据库', ai: 'AI', app: '应用', other: '其他' };
    const typeCounts = {};
    App.ENTRY_TYPES.forEach(t => {
      typeCounts[t.id] = App.state.entries.filter(e => (e.entryType || 'website') === t.id).length;
    });
    let typeHtml = '';
    App.ENTRY_TYPES.forEach(t => {
      const isActive = App.state.currentFilter === `type:${t.id}`;
      typeHtml += `
        <div class="nav-item type-${t.id} ${isActive ? 'active' : ''}" onclick="setFilter('type:${t.id}')">
          <span class="type-icon">${Utils.SvgIcons.typeIcon(14, t.id)}</span>
          ${typeLabels[t.id]}
          <span class="count">${typeCounts[t.id]}</span>
        </div>
      `;
    });
    typeContainer.innerHTML = typeHtml;
  }

  // 渲染个人区域（全部密码 / 收藏 / 回收站）
  const personalContainer = document.getElementById('nav-personal');
  if (personalContainer) {
    const favCount = App.state.entries.filter(e => e.favorite).length;
    const total = App.state.entries.length;
    personalContainer.innerHTML = `
      <div class="nav-item ${App.state.currentFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">
        ${Utils.SvgIcons.typeIcon(15, 'app')}
        全部密码
        <span class="count">${total}</span>
      </div>
      <div class="nav-item ${App.state.currentFilter === 'favorites' ? 'active' : ''}" onclick="setFilter('favorites')">
        ${App.state.currentFilter === 'favorites' ? Utils.SvgIcons.starFilled(15) : Utils.SvgIcons.starOutline(15)}
        收藏
        <span class="count">${favCount}</span>
      </div>
      <div class="nav-item ${App.state.currentFilter === 'recycle' ? 'active' : ''}" onclick="setFilter('recycle')">
        ${Utils.SvgIcons.trash(15)}
        回收站
        <span class="count">${App.state.deleted.length}</span>
      </div>
    `;
  }

  // 渲染热门标签
  const container = document.getElementById('nav-categories');
  const counts = App.getTagCounts();
  const tagDefs = App.state.tagDefs || {};
  const topTags = App.getTopTags(8); // 最多显示 8 个热门标签

  let html = '';
  if (topTags.length) {
    topTags.forEach(name => {
      const def = tagDefs[name] || { color: '#8b949e', icon: 'other' };
      const iconSvg = Utils.getCategoryIcon(def.icon, def.color);
      html += `
        <div class="nav-item ${App.state.currentFilter === name ? 'active' : ''}" data-filter="${Utils.escHtml(name)}" onclick="setFilterFromEl(this)">
          ${iconSvg}
          ${Utils.escHtml(name)}
          <span class="count">${counts[name]}</span>
        </div>
      `;
    });
  }

  container.innerHTML = html;
}

/**
 * 设置筛选条件
 */
function setFilter(filter, skipHashUpdate = false) {
  App.state.currentFilter = filter;
  App.state.searchQuery = document.getElementById('global-search').value;
  closeDetailPanel();
  renderSidebar();
  renderEntries();

  // 移动端关闭侧边栏
  if (window.innerWidth <= 768) {
    closeSidebar();
  }

  // 更新内容区标题
  const titles = {
    all: '全部密码',
    favorites: '收藏',
    recycle: '回收站',
  };
  const typeLabels = { website: '网站', server: '服务器', database: '数据库', ai: 'AI', app: '应用', other: '其他' };
  if (filter.startsWith('type:')) {
    const type = filter.slice(5);
    document.getElementById('content-title').textContent = typeLabels[type] || type;
  } else {
    document.getElementById('content-title').textContent = titles[filter] || filter;
  }

  // 更新 URL hash（用于刷新后保持状态）
  if (!skipHashUpdate) {
    const hash = filter === 'all' ? '' : `#${encodeURIComponent(filter)}`;
    history.replaceState(null, '', hash || window.location.pathname);
  }
}

/**
 * 从 URL hash 恢复筛选状态
 */
function restoreFilterFromHash() {
  const hash = window.location.hash.slice(1); // 去掉 #
  if (!hash) return 'all';
  try {
    return decodeURIComponent(hash);
  } catch (e) {
    return 'all';
  }
}

/**
 * 从侧边栏标签项读取 data-filter 并切换筛选（避免标签名注入到 JS 字符串字面量）
 * @param {HTMLElement} el
 */
function setFilterFromEl(el) {
  // 切换标签筛选时清空搜索框，避免残留搜索词导致"有密码却不显示"的困惑
  const searchInput = document.getElementById('global-search');
  if (searchInput && searchInput.value) {
    App.state.searchQuery = '';
    searchInput.value = '';
    renderEntries();
  }
  setFilter(el.dataset.filter);
}

/**
 * 获取筛选后的条目列表
 */
function getFilteredEntries() {
  let list;
  
  // 回收站：直接基于已删除条目，跳过分类/收藏筛选
  if (App.state.currentFilter === 'recycle') {
    list = App.state.deleted;
  } else {
    list = App.state.entries;
    // 按分类筛选
    if (App.state.currentFilter === 'favorites') {
      list = list.filter(e => e.favorite);
    } else if (App.state.currentFilter.startsWith('type:')) {
      const type = App.state.currentFilter.slice(5);
      list = list.filter(e => (e.entryType || 'website') === type);
    } else if (App.state.currentFilter !== 'all') {
      list = list.filter(e => (e.tags || []).includes(App.state.currentFilter));
    }
  }
  
  // 按关键词搜索
  const query = App.state.searchQuery.trim().toLowerCase();
  if (query) {
    list = list.filter(e =>
      (e.title || '').toLowerCase().includes(query) ||
      (e.username || '').toLowerCase().includes(query) ||
      (e.url || '').toLowerCase().includes(query) ||
      (e.tags || []).some(t => t.toLowerCase().includes(query))
    );
  }
  
  // 回收站：按删除时间倒序（最近删除的排在前面）
  if (App.state.currentFilter === 'recycle') {
    return list.slice().sort((a, b) => {
      return new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0);
    });
  }
  
  // 排序：收藏优先，然后按更新时间
  return list.sort((a, b) => {
    if ((b.favorite || false) !== (a.favorite || false)) {
      return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    }
    return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
  });
}

/**
 * 渲染密码条目列表
 */
/**
 * 构建单张密码卡片 HTML
 */
/**
 * 获取卡片类型图标 SVG（委托给 SvgIcons 统一注册表）
 */
function getCardTypeIcon(type) {
  return Utils.SvgIcons.typeIcon(12, type);
}

/**
 * 获取卡片副标题（按 entryType 语义化显示）
 */
function getCardSubtitle(entry) {
  const type = entry.entryType || 'website';
  const root = entry.root || {};
  if (type === 'website') {
    return entry.username || entry.url || '';
  } else if (type === 'server') {
    return entry.username ? `${entry.username} @ ${entry.url}` : (entry.url || '');
  } else if (type === 'database') {
    return entry.username ? `${entry.username} @ ${entry.url}` : (entry.url || '');
  } else if (type === 'ai') {
    return entry.url || '';
  } else if (type === 'app') {
    return entry.appId || '';
  } else if (type === 'other') {
    return entry.username || '';
  }
  return entry.username || '';
}

function buildEntryCard(entry) {
  const isRecycle = App.state.currentFilter === 'recycle';
  const tagDefs = App.state.tagDefs || {};
  const type = entry.entryType || 'website';
  const typeIcon = getCardTypeIcon(type);
  const subtitle = getCardSubtitle(entry);
  const favIcon = entry.favorite
    ? Utils.SvgIcons.starFilled(13, 'var(--warning)')
    : Utils.SvgIcons.starOutline(13);

  // 回收站中的卡片：隐藏收藏星标，改为「恢复」快捷按钮
  const actions = isRecycle
    ? `
        <button class="restore-btn" onclick="restoreEntry('${entry.id}')" title="恢复">
          ${Utils.SvgIcons.restore(13)}
        </button>
        <button class="copy-btn" onclick="copyPassword('${entry.id}')" title="复制密码">
          ${Utils.SvgIcons.copy(13)}
        </button>`
    : `
        <button class="star-btn ${entry.favorite ? 'active' : ''}" onclick="toggleFavorite('${entry.id}')" title="收藏">
          ${favIcon}
        </button>
        <button class="copy-btn" onclick="copyPassword('${entry.id}')" title="复制">
          ${Utils.SvgIcons.copy(13)}
        </button>
        <button class="delete-btn" onclick="deleteEntryById('${entry.id}')" title="删除">
          ${Utils.SvgIcons.trash(13)}
        </button>`;

  return `
    <div class="entry-card ${entry.favorite && !isRecycle ? 'fav' : ''} ${isRecycle ? 'recycled' : ''} ${App.state.selectedEntry === entry.id ? 'selected' : ''}" onclick="selectEntry('${entry.id}', event)">
      <div class="entry-icon">
        <span class="type-icon-badge type-icon-${type}" title="${Utils.escHtml(type)}">${typeIcon}</span>
      </div>
      <div class="entry-info">
        <div class="entry-title">${Utils.escHtml(entry.title)}</div>
        <div class="entry-meta">
          ${subtitle ? `<span class="entry-subtitle">${Utils.escHtml(subtitle)}</span>` : ''}
          ${(entry.tags || []).slice(0, 3).map(t => Utils.renderTagChip(tagDefs, t, false)).join('')}
          ${(entry.tags && entry.tags.length > 3) ? `<span class="entry-tag-more">+${entry.tags.length - 3}</span>` : ''}
          <span class="entry-date">${isRecycle ? '已删除' : Utils.formatDate(entry.updatedAt || entry.createdAt)}</span>
        </div>
      </div>
      <div class="entry-actions" onclick="event.stopPropagation()">
        ${actions}
      </div>
    </div>
  `;
}

/* ── 虚拟滚动 ──────────────────────────────────────────────── */
const VS_GAP = 8;          // 卡片间距（与 CSS .entry-card margin-bottom 一致）
const VS_OVERSCAN = 5;     // 视口外缓冲条数
const VS_MIN_ITEMS = 60;   // 低于此数量走全量渲染
const VS_ESTIMATE_H = 66 + VS_GAP; // 估算卡片高度（首次渲染用，避免双重 innerHTML）
let _vsList = null;        // 当前虚拟滚动条目
let _vsItemH = 0;          // 单条高度（含间距）
let _vsRaf = 0;
let _vsDirty = false;      // 列表内容是否变化（替代 innerHTML 字符串比较）
let _vsLastRange = '';     // 上次渲染的 start-end 索引，用于 O(1) 跳过判断
let _lastSearchQuery = '';
let _lastFilter = '';

function _vsContainer() { return document.getElementById('entries-list'); }
function _vsScroller() { return document.getElementById('content'); }

function _vsOffsetTop() {
  const scroller = _vsScroller();
  const container = _vsContainer();
  if (!scroller || !container) return 0;
  const sr = scroller.getBoundingClientRect();
  const cr = container.getBoundingClientRect();
  // getBoundingClientRect 是视口坐标，差值含滚动位移；加回 scrollTop 得到列表在滚动容器内的固定偏移
  return (cr.top - sr.top) + scroller.scrollTop;
}

/**
 * 按当前滚动位置渲染可见窗口
 * 优化：首次渲染用估算高度直接渲染，渲染后从 DOM 测量真实高度，避免 _vsMeasure 的双重 innerHTML
 */
function vsRender() {
  const container = _vsContainer();
  const scroller = _vsScroller();
  if (!container || !scroller || !_vsList || _vsList.length === 0) return;

  const topOffset = _vsOffsetTop();
  const scrollTop = scroller.scrollTop;
  const viewH = scroller.clientHeight || 600;

  // 首次渲染：用估算高度，渲染后从真实 DOM 测量
  var itemH = _vsItemH || VS_ESTIMATE_H;
  var total = _vsList.length;

  var viewTop = Math.max(0, scrollTop - topOffset);
  var viewBottom = viewTop + viewH;

  var start = Math.max(0, Math.floor(viewTop / itemH) - VS_OVERSCAN);
  var end = Math.min(total, Math.ceil(viewBottom / itemH) + VS_OVERSCAN);
  if (start >= end) end = Math.min(total, start + 1);

  var topPad = start * itemH;
  var bottomPad = (total - end) * itemH;

  // O(1) 跳过：如果可见窗口索引未变且列表未变，无需更新 DOM
  var rangeKey = start + '-' + end;
  if (!_vsDirty && _vsLastRange === rangeKey) return;
  _vsLastRange = rangeKey;

  var html = '<div class="vs-spacer" style="height:' + topPad + 'px"></div>' +
    _vsList.slice(start, end).map(buildEntryCard).join('') +
    '<div class="vs-spacer" style="height:' + bottomPad + 'px"></div>';

  container.innerHTML = html;
  _vsDirty = false;

  // 首次渲染后从真实 DOM 测量卡片高度（修正估算误差）
  if (!_vsItemH) {
    var first = container.querySelector('.entry-card');
    if (first) {
      _vsItemH = first.offsetHeight + VS_GAP;
      // 如果测量值与估算差异大，重新渲染以修正 padding
      if (Math.abs(_vsItemH - VS_ESTIMATE_H) > 4) {
        vsRender();
      }
    }
  }
}

function _onVsScroll() {
  if (_vsRaf) return;
  _vsRaf = requestAnimationFrame(() => {
    _vsRaf = 0;
    vsRender();
  });
}

// 滚动与尺寸变化监听
(function initVirtualScroll() {
  const scroller = _vsScroller();
  if (scroller) scroller.addEventListener('scroll', _onVsScroll, { passive: true });
  window.addEventListener('resize', () => {
    _vsItemH = 0; // 断点/横竖屏切换后卡片高度可能变化，重新测量
    _onVsScroll();
  });
})();

/**
 * 渲染密码条目列表（虚拟滚动）
 */
function renderEntries() {
  const list = getFilteredEntries();
  const container = document.getElementById('entries-list');
  const emptyState = document.getElementById('empty-state');
  const countEl = document.getElementById('entry-count');
  
  countEl.textContent = `${list.length} 项`;
  
  // 仅在回收站且有内容时显示「清空回收站」按钮
  const emptyRecycleBtn = document.getElementById('empty-recycle-btn');
  if (emptyRecycleBtn) {
    emptyRecycleBtn.classList.toggle('hidden', !(App.state.currentFilter === 'recycle' && list.length > 0));
  }
  
  if (list.length === 0) {
    _vsList = null;
    container.innerHTML = '';
    document.getElementById('content-inner').classList.add('empty-active');
    emptyState.classList.remove('hidden');
    
    const query = App.state.searchQuery.trim();
    if (App.state.currentFilter === 'recycle') {
      document.getElementById('empty-title').textContent = '回收站为空';
      document.getElementById('empty-desc').textContent = '删除的密码会暂时保存在这里，可恢复或彻底删除';
    } else if (query) {
      document.getElementById('empty-title').textContent = '没有找到匹配项';
      document.getElementById('empty-desc').textContent = `没有找到包含「${query}」的密码`;
      // 搜索无结果时自动聚焦搜索框，方便用户重新输入
      const searchInput = document.getElementById('global-search');
      if (searchInput) searchInput.focus();
    } else if (App.state.currentFilter === 'favorites') {
      document.getElementById('empty-title').textContent = '暂无收藏';
      document.getElementById('empty-desc').textContent = '点击密码卡片的星标收藏常用密码';
    } else {
      document.getElementById('empty-title').textContent = '还没有密码';
      document.getElementById('empty-desc').textContent = '点击上方「添加密码」开始构建您的密码库';
    }
    
    // 回收站空状态下隐藏「添加密码」按钮
    const emptyAddBtn = document.querySelector('#empty-state .btn-empty');
    if (emptyAddBtn) emptyAddBtn.classList.toggle('hidden', App.state.currentFilter === 'recycle');
    return;
  }
  
  emptyState.classList.add('hidden');
  document.getElementById('content-inner').classList.remove('empty-active');

  // 搜索词/筛选变化时回到列表顶部
  const query = App.state.searchQuery.trim();
  const filter = App.state.currentFilter;
  if (query !== _lastSearchQuery || filter !== _lastFilter) {
    _lastSearchQuery = query;
    _lastFilter = filter;
    const scroller = _vsScroller();
    if (scroller) scroller.scrollTop = 0;
  }

  _vsList = list;
  _vsDirty = true; // 标记列表已变化，vsRender 需更新 DOM
  _vsLastRange = ''; // 重置索引缓存，强制重新渲染

  if (list.length < VS_MIN_ITEMS) {
    container.innerHTML = list.map(buildEntryCard).join('');
    return;
  }
  vsRender();
}

// 导出模块
window.UI = {
  renderSidebar,
  setFilter,
  restoreFilterFromHash,
  getFilteredEntries,
  renderEntries
};

/**
 * 切换侧边栏（移动端）
 */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('active');
}

/**
 * 关闭侧边栏（移动端）
 */
function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.remove('open');
  overlay.classList.remove('active');
}

// 全局函数绑定
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
