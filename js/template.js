/*
 * LockPass — UI 模板模块
 * @Author: LockPass Project
 * @Date: 2026-08-20
 * Copyright (c) 2026 LockPass, All Rights Reserved.
 */
/* ═══════════════════════════════════════════════════════════════════
   LockPass — UI 模板模块
   将全部页面结构以模板字符串注入 #app，由 JS 动态渲染输出
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 完整 UI 模板（与原静态 HTML 结构一致，主界面外壳为 #app-shell）
 * 包含：锁屏 #lock-screen、主界面 #app-shell、弹窗 #modal-overlay、Toast #toast-container
 * @type {string}
 */
window.UI_TEMPLATE = `
<!-- ── Lock Screen ────────────────────────────────────────────── -->
<div id="lock-screen">
  <canvas id="lock-bg" aria-hidden="true"></canvas>
  <div class="lock-box">
    <div class="empty-illustration lock-illustration">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </div>
    
    <h1 id="lock-title" class="lock-title">密码保险箱</h1>
    <p id="lock-subtitle" class="lock-subtitle">输入主密码解锁您的密码库</p>
    
    <div id="lock-form" class="lock-form">
      <div class="input-group">
        <input id="master-password" type="password" placeholder="输入主密码" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" oninput="renderMasterPwStrength()" tabindex="1" />
        <button class="toggle-pw" onclick="toggleLockPw()" title="显示/隐藏" tabindex="-1">
          <svg id="lock-eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>
      
      <div id="confirm-pw-group" class="input-group hidden">
        <input id="confirm-password" type="password" placeholder="再次输入主密码确认" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" tabindex="2" />
      </div>

      <div id="master-pw-strength-wrap" class="hidden mt-2">
        <div class="pw-strength-bar-bg pw-strength-bg-border">
          <div id="master-pw-strength-bar" class="pw-strength-bar" style="width:0%"></div>
        </div>
        <div id="master-pw-strength-text" class="text-muted pw-strength-text"></div>
      </div>

      <div id="lock-error" class="text-danger text-sm mt-1 hidden"></div>
      
      <button id="unlock-btn" class="btn btn-primary btn-full" tabindex="3">
        <span id="unlock-btn-text">解锁</span>
      </button>
      
      <button id="restore-file-btn" class="btn btn-ghost btn-full hidden" onclick="restoreFromLocalFile()" title="从本地文件恢复（.vault 备份或 LockPass-vault.json 同步文件）" tabindex="4">
        从本地文件恢复
      </button>
      <button id="bind-restore-btn" class="btn btn-ghost btn-full hidden" onclick="bindRestoreFromDirectory()" title="绑定已有数据目录并恢复（目录中需存在 LockPass-vault.json）" tabindex="5">
        绑定已有数据目录
      </button>
      <input type="file" id="restore-file-input" accept=".vault,.json" class="hidden" onchange="handleRestoreFileSelect(event)" />
    </div>
  </div>
</div>

<!-- ── Main App ────────────────────────────────────────────────── -->
<div id="app-shell" class="hidden">
  
  <!-- Header -->
  <header id="header">
    <button class="btn-icon hamburger-btn" id="hamburger-btn" onclick="toggleSidebar()" aria-label="菜单">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
    <div class="logo">
      <svg width="24" height="24" viewBox="0 0 100 100">
        <rect width="100" height="100" rx="20" fill="var(--accent)" opacity="0.15"/>
        <rect x="25" y="45" width="50" height="35" rx="6" fill="none" stroke="var(--accent)" stroke-width="4"/>
        <path d="M35 45V32a15 15 0 0 1 30 0v13" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>
        <circle cx="50" cy="62" r="5" fill="var(--accent)"/>
      </svg>
      密码保险箱
    </div>
    
    <div class="header-search">
      <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input id="global-search" type="text" placeholder="搜索密码 (⌘ + K)" />
    </div>
    
    <div class="header-actions">
      <button class="btn btn-ghost btn-sm" onclick="Settings.openSettingsModal()" title="设置" tabindex="-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span>设置</span>
      </button>
    </div>
  </header>
  
  <!-- Main Layout -->
  <div id="main-layout">
    <!-- Sidebar overlay (mobile) -->
    <div id="sidebar-overlay" onclick="closeSidebar()"></div>
    
    <!-- Sidebar -->
    <aside id="sidebar">
      <div class="sidebar-scroll">
      <div class="sidebar-section">
        <div class="btn-dropdown" id="add-entry-dropdown">
          <button class="btn btn-primary btn-full btn-dropdown-main" onclick="openEntryModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            添加密码
          </button>
          <button class="btn btn-primary btn-dropdown-toggle" onclick="toggleAddDropdown(event)" aria-label="更多添加方式" title="更多添加方式">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="btn-dropdown-menu hidden" id="add-dropdown-menu">
            <button onclick="QR.openImportModal(); closeAddDropdown()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M21 14v3h-3"/></svg>
              二维码添加
            </button>
            <button onclick="ImportExport.openImportModal(); closeAddDropdown()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              批量导入
            </button>
          </div>
        </div>
      </div>
      
      <!-- 个人筛选 -->
      <div class="sidebar-section">
        <div class="sidebar-section-title">个人</div>
        <nav id="nav-personal"></nav>
      </div>
      
      <!-- 类型筛选 -->
      <div class="sidebar-section">
        <div class="sidebar-section-title">类型筛选</div>
        <nav id="nav-types" class="nav-types"></nav>
      </div>
      
      <!-- 热门标签 -->
      <div class="sidebar-section">
        <div class="sidebar-section-title sidebar-title-clickable" id="tags-toggle" onclick="toggleTagSection()" title="折叠/展开热门标签">
          热门标签
          <svg class="tag-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <nav id="nav-categories"></nav>
      </div>
      </div>
      
      <div class="sidebar-footer">
        <button class="btn btn-ghost btn-sm btn-full" onclick="App.logout()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          退出
        </button>
      </div>
    </aside>
    
    <!-- Main Content -->
    <main id="content">
      <canvas id="workspace-bg" aria-hidden="true"></canvas>
      <div id="content-inner">
        
        <div class="content-toolbar">
          <h2 id="content-title">全部密码</h2>
          <div class="toolbar-right">
            <span id="entry-count" class="text-muted text-sm">0 项</span>
            <button id="empty-recycle-btn" class="btn btn-ghost btn-sm hidden" onclick="emptyRecycleBin()" title="清空回收站">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              清空回收站
            </button>
          </div>
        </div>
        
        <div id="entries-list"></div>
        
        <div id="empty-state" class="empty-state hidden">
          <div class="empty-illustration">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h3 id="empty-title">还没有密码</h3>
          <p id="empty-desc">点击上方「添加密码」开始构建您的密码库</p>
          <button class="btn btn-primary btn-empty" onclick="openEntryModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            添加第一个密码
          </button>
          <div class="empty-features">
            <span>离线加密存储</span>
            <span>二维码同步</span>
            <span>本地文件备份</span>
          </div>
        </div>
        
      </div>
    </main>
    
    <!-- Detail Panel -->
    <aside id="detail-panel">
      <div class="detail-header">
        <h3 id="detail-title">密码详情</h3>
        <div class="detail-header-actions">
          <button class="btn-icon" id="detail-fav-btn" onclick="toggleFavorite(App.state.selectedEntry)" title="收藏">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
          <button class="btn-icon" onclick="closeDetailPanel()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="detail-body" id="detail-body"></div>
      <div class="detail-footer" id="detail-footer">
        <button class="btn btn-secondary flex-1" onclick="editCurrentEntry()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          编辑
        </button>
        <button class="btn btn-secondary" onclick="copyDetailPassword()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          复制
        </button>
        <button class="btn btn-secondary" onclick="QR.openShareModal(App.state.selectedEntry)" title="分享为二维码">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <path d="M14 14h3v3h-3z"/>
            <path d="M21 14v3h-3"/>
          </svg>
          二维码
        </button>
        <button class="btn btn-danger" onclick="deleteCurrentEntry()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
          删除
        </button>
      </div>
    </aside>
    
  </div>
</div>

<!-- ── Modal Overlay ────────────────────────────────────────────── -->
<div id="modal-overlay" class="hidden">
  <div id="modal"></div>
</div>

<!-- ── Toast Container ───────────────────────────────────────────── -->
<div id="toast-container"></div>
`;

/**
 * 渲染应用外壳：把 UI 模板注入 #app 根节点
 * 必须在其他业务模块读取 DOM 之前执行（脚本按顺序加载，本文件放在 vendor 之后、业务脚本之前）
 */
(function renderAppShell() {
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.innerHTML = window.UI_TEMPLATE;
  }
})();
