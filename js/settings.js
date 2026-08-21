/* ═══════════════════════════════════════════════════════════════════
   LockPass — 设置模块
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 打开设置模态框
 */
function openSettingsModal() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-header">
      <h2>设置</h2>
      <button class="btn-icon" onclick="App.closeModal()" tabindex="-1">
        ${Utils.SvgIcons.close(16)}
      </button>
    </div>
    <div class="modal-body">
      <div class="settings-group">
        <div class="settings-group-title">安全</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">自动锁定</div>
            <div class="settings-desc">无操作后自动锁定保险箱</div>
          </div>
          <select class="form-input" id="setting-lock-timeout" style="width:120px" onchange="updateLockTimeout()">
            <option value="60000" ${App.state.lockTimeoutMs === 60000 ? 'selected' : ''}>1 分钟</option>
            <option value="300000" ${App.state.lockTimeoutMs === 300000 ? 'selected' : ''}>5 分钟</option>
            <option value="900000" ${App.state.lockTimeoutMs === 900000 ? 'selected' : ''}>15 分钟</option>
            <option value="1800000" ${App.state.lockTimeoutMs === 1800000 ? 'selected' : ''}>30 分钟</option>
            <option value="0" ${App.state.lockTimeoutMs === 0 ? 'selected' : ''}>从不</option>
          </select>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">剪贴板清除</div>
            <div class="settings-desc">复制密码后自动清除剪贴板</div>
          </div>
          <select class="form-input" id="setting-clipboard-clear" style="width:120px" onchange="updateClipboardClear()">
            <option value="10000" ${App.state.clipboardClearMs === 10000 ? 'selected' : ''}>10 秒</option>
            <option value="30000" ${App.state.clipboardClearMs === 30000 ? 'selected' : ''}>30 秒</option>
            <option value="60000" ${App.state.clipboardClearMs === 60000 ? 'selected' : ''}>60 秒</option>
          </select>
        </div>
      </div>
      
      <div class="settings-group">
        <div class="settings-group-title">本地文件同步</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">数据目录</div>
            <div class="settings-desc" id="file-sync-status">检查中…</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="file-sync-btn" onclick="bindDataDirectory()">绑定</button>
        </div>
        <div class="settings-desc" style="padding:0 0 6px;color:var(--text-muted);font-size:0.8rem">
          绑定后在所选目录下直接生成 LockPass-vault.json；浏览器清空 IndexedDB 后可重新选择目录恢复。
        </div>
      </div>
      
      <div class="settings-group">
        <div class="settings-group-title">标签管理</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">管理标签</div>
            <div class="settings-desc">增删改标签名称、颜色和图标</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="openTagManagementModal()">
            标签管理
          </button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">数据说明</div>
        <div class="data-info-cards">
          <div class="data-info-card">
            <div class="data-info-card-label">密码条目</div>
            <div class="data-info-card-value" id="data-info-entries">…</div>
          </div>
          <div class="data-info-card">
            <div class="data-info-card-label">标签</div>
            <div class="data-info-card-value" id="data-info-tags">…</div>
          </div>
          <div class="data-info-card">
            <div class="data-info-card-label">数据大小</div>
            <div class="data-info-card-value" id="data-info-size">…</div>
          </div>
          <div class="data-info-card">
            <div class="data-info-card-label">文件同步</div>
            <div class="data-info-card-value" id="data-info-sync">…</div>
          </div>
        </div>
        <div class="data-info-arch">
          <div class="data-info-arch-title">存储架构</div>
          <div class="data-info-arch-item">
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">IndexedDB <span class="tag tag-info">数据库</span></span>
              <span class="tag tag-ok">正常</span>
            </div>
            <div class="data-info-arch-desc">密码库主存储（AES-256-GCM 加密）</div>
          </div>
          <div class="data-info-arch-item">
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">本地 JSON 文件 <span class="tag tag-info">备份</span></span>
              <span class="tag tag-muted" id="data-info-file">未绑定</span>
            </div>
            <div class="data-info-arch-desc">LockPass-vault.json · 磁盘文件，清缓存不丢数据</div>
          </div>
          <div class="data-info-arch-item">
            <div class="data-info-arch-row">
              <span class="data-info-arch-name">localStorage <span class="tag tag-muted">仅缓存</span></span>
            </div>
            <div class="data-info-arch-desc">仅存放同步标记等本机配置</div>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">数据管理</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">导入备份</div>
            <div class="settings-desc">从加密备份或 CSV 文件导入</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="ImportExport.openImportModal()">
            导入
          </button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">扫码导入</div>
            <div class="settings-desc">上传或粘贴二维码图片，导入单条密码</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="QR.openImportModal()">
            扫码导入
          </button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">导出备份</div>
            <div class="settings-desc">将密码库导出为加密文件</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="ImportExport.openExportModal()">
            导出
          </button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label">修改主密码</div>
            <div class="settings-desc">更改解锁保险箱的主密码</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="openChangePasswordModal()">
            修改
          </button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-label text-danger">销毁保险箱</div>
            <div class="settings-desc">删除所有数据，此操作不可撤销</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="destroyVault()">
            销毁
          </button>
        </div>
      </div>
      
      <div class="settings-group">
        <div class="settings-group-title">快捷键</div>
        <div id="settings-shortcuts-table"></div>
      </div>
      
      <div class="settings-group">
        <div class="settings-group-title">关于</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">版本</div>
            <div class="settings-desc">${APP_VERSION}</div>
          </div>
        </div>
      </div>
    </div>
  `;
  App.openModal();
  renderShortcutsTable();
  refreshFileSyncStatus();
  refreshDataInfo();
}

/**
 * 渲染快捷键说明表格（数据源：SearchShortcuts.SHORTCUT_DEFS，随平台显示对应按键文字）
 */
function renderShortcutsTable() {
  const container = document.getElementById('settings-shortcuts-table');
  if (!container) return;
  const defs = (window.SearchShortcuts && SearchShortcuts.SHORTCUT_DEFS) || [];
  if (!defs.length) {
    container.innerHTML = '<div style="font-size:0.85rem;color:var(--text-muted)">暂无可用的快捷键。</div>';
    return;
  }
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const rows = defs.map(d => {
    // 符号化组合键（如 '⌘ + ⇧ + E'）：按 '+' 拆分为按键名，每个按键单独 kbd 徽标，中间用 '+' 连接
    const keys = (isMac ? d.mac : d.win).split('+').map(s => s.trim());
    const kbdHtml = keys.map(k => '<kbd>' + Utils.escHtml(k) + '</kbd>')
      .join('<span class="shortcut-plus"> + </span>');
    return '<tr>' +
      '<td class="shortcut-name">' + Utils.escHtml(d.name) + '</td>' +
      '<td class="shortcut-keys">' + kbdHtml + '</td>' +
    '</tr>';
  }).join('');
  container.innerHTML =
    '<div class="shortcut-table-wrap">' +
      '<table class="shortcut-table">' +
        '<thead><tr><th>操作</th><th>快捷键</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}

/**
 * 刷新数据说明区统计（密码条目数、标签数、数据大小、文件同步状态）
 */
async function refreshDataInfo() {
  const entriesEl = document.getElementById('data-info-entries');
  if (!entriesEl) return;
  entriesEl.textContent = (AppState.entries || []).length + ' 条';
  const tagsEl = document.getElementById('data-info-tags');
  if (tagsEl) tagsEl.textContent = (AppState.tags || []).length + ' 个';
  
  // 数据大小：读取 vault 加密负载（密文 base64 解码后的字节数）
  try {
    await DBUtils.openDB();
    const rec = await DBUtils.dbGet(DBUtils.STORE_VAULT, 'main');
    let bytes = 0;
    if (rec && rec.data) {
      try { bytes = atob(rec.data).length; } catch (e) { bytes = Math.floor(rec.data.length * 3 / 4); }
    }
    const sizeEl = document.getElementById('data-info-size');
    if (sizeEl) sizeEl.textContent = formatBytes(bytes);
  } catch (e) {
    const sizeEl = document.getElementById('data-info-size');
    if (sizeEl) sizeEl.textContent = '—';
  }
  
  // 文件同步状态
  const syncEl = document.getElementById('data-info-sync');
  const fileEl = document.getElementById('data-info-file');
  // Tauri 桌面版：数据已通过本地文件存储
  if (window.FileStore && window.FileStore.isTauri) {
    if (syncEl) syncEl.textContent = '桌面文件';
    if (fileEl) { fileEl.textContent = '已启用'; fileEl.className = 'tag tag-ok'; }
  } else if (FileSync.isSupported()) {
    const handle = await FileSync.getDirHandle();
    if (handle) {
      if (FileSync.lastSyncError) {
        if (syncEl) syncEl.textContent = '同步失败';
        if (fileEl) { fileEl.textContent = '同步失败'; fileEl.className = 'tag tag-danger'; }
      } else {
        if (syncEl) syncEl.textContent = '已绑定';
        if (fileEl) { fileEl.textContent = '已同步'; fileEl.className = 'tag tag-ok'; }
      }
    } else {
      if (syncEl) syncEl.textContent = '未绑定';
      if (fileEl) { fileEl.textContent = '未绑定'; fileEl.className = 'tag tag-muted'; }
    }
  } else {
    if (syncEl) syncEl.textContent = '不支持';
    if (fileEl) { fileEl.textContent = '不支持'; fileEl.className = 'tag tag-muted'; }
  }
}

/** 字节数格式化为可读字符串 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

/**
 * 刷新本地文件同步状态（异步）
 */
async function refreshFileSyncStatus() {
  const statusEl = document.getElementById('file-sync-status');
  const btn = document.getElementById('file-sync-btn');
  if (!statusEl || !btn) return;
  
  // Tauri 桌面版：数据已通过本地文件存储，无需目录绑定
  if (window.FileStore && window.FileStore.isTauri) {
    statusEl.textContent = '数据已保存在桌面本地文件';
    btn.style.display = 'none';
    try {
      const dir = await window.FileStore.dataDir();
      if (dir) statusEl.textContent = '数据目录：' + dir;
    } catch (e) { /* 目录获取失败时保留默认文案 */ }
    return;
  }
  
  if (!FileSync.isSupported()) {
    statusEl.textContent = '当前浏览器不支持（请用 Chrome / Edge）';
    btn.style.display = 'none';
    return;
  }
  
  try {
    const handle = await FileSync.getDirHandle();
    if (handle) {
      statusEl.textContent = '已绑定：' + handle.name + ' → LockPass-vault.json';
      btn.textContent = '重新绑定';
      btn.onclick = bindDataDirectory;
    } else {
      statusEl.textContent = '未绑定，数据仅保存在浏览器内';
      btn.textContent = '绑定';
      btn.onclick = bindDataDirectory;
    }
  } catch (e) {
    statusEl.textContent = '状态读取失败';
  }
}

/**
 * 绑定本地数据目录（弹出目录选择）
 */
async function bindDataDirectory() {
  try {
    const { result } = await FileSync.bindDirectory();
    if (result.ok) {
      Utils.showToast('已绑定本地目录，数据将自动同步', 'success');
    } else if (result.reason === 'empty') {
      Utils.showToast('目录已绑定，创建保险箱后将自动同步', 'success');
    } else {
      Utils.showToast('目录已绑定，但同步未完成', 'warning');
    }
    refreshFileSyncStatus();
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 用户取消
    Utils.showToast(e.message || '绑定失败', 'error');
  }
}

/**
 * 更新自动锁定时间
 * 设置为本机配置，仅存 localStorage，不随密码数据同步到其他端
 */
function updateLockTimeout() {
  const value = parseInt(document.getElementById('setting-lock-timeout').value);
  App.state.lockTimeoutMs = value;
  try { localStorage.setItem('lockpass_lock_timeout', String(value)); } catch (e) {}
  
  if (value > 0) {
    App.resetLockTimer();
  } else {
    clearTimeout(App.state.lockTimer);
  }
  
  Utils.showToast('设置已保存', 'success');
}

/**
 * 更新剪贴板清除时间
 * 设置为本机配置，仅存 localStorage，不随密码数据同步到其他端
 */
function updateClipboardClear() {
  const value = parseInt(document.getElementById('setting-clipboard-clear').value);
  App.state.clipboardClearMs = value;
  try { localStorage.setItem('lockpass_clipboard_clear', String(value)); } catch (e) {}
  Utils.showToast('设置已保存', 'success');
}

/**
 * 打开修改主密码模态框
 */
function openChangePasswordModal() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-header">
      <h2>修改主密码</h2>
      <button class="btn-icon" onclick="openSettingsModal()" tabindex="-1">
        ${Utils.SvgIcons.close(16)}
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">当前主密码</label>
        <input class="form-input" id="change-old-pw" type="password" placeholder="输入当前主密码" tabindex="1" />
      </div>
      <div class="form-group">
        <label class="form-label">新主密码</label>
        <input class="form-input" id="change-new-pw" type="password" placeholder="至少 8 位" tabindex="2" />
      </div>
      <div class="form-group">
        <label class="form-label">确认新密码</label>
        <input class="form-input" id="change-confirm-pw" type="password" placeholder="再次输入新密码" tabindex="3" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="openSettingsModal()" tabindex="4">取消</button>
      <button class="btn btn-primary" id="change-pw-confirm-btn" onclick="changePassword()" tabindex="5">确认修改</button>
    </div>
  `;
}

/**
 * 修改主密码
 */
async function changePassword() {
  const oldPw = document.getElementById('change-old-pw').value;
  const newPw = document.getElementById('change-new-pw').value;
  const confirmPw = document.getElementById('change-confirm-pw').value;
  const btn = document.getElementById('change-pw-confirm-btn');

  if (!oldPw) {
    Utils.showToast('请输入当前主密码', 'error');
    return;
  }
  if (newPw.length < 8) {
    Utils.showToast('新密码至少需要 8 位', 'error');
    return;
  }
  if (newPw !== confirmPw) {
    Utils.showToast('两次输入的新密码不一致', 'error');
    return;
  }

  // Loading 状态
  if (btn) {
    btn.disabled = true;
    btn.textContent = '修改中…';
  }

  try {
    // 验证旧密码
    const saltRecord = await DBUtils.dbGet(DBUtils.STORE_META, 'salt');
    const salt = CryptoUtils.base64ToArrayBuffer(saltRecord.value);
    const iterRecord = await DBUtils.dbGet(DBUtils.STORE_META, 'iterations');
    const iterations = iterRecord ? (Number(iterRecord.value) || 100000) : 100000;
    const oldKey = await CryptoUtils.deriveKey(oldPw, new Uint8Array(salt), iterations);

    // 尝试解密验证
    const vaultRecord = await DBUtils.dbGet(DBUtils.STORE_VAULT, 'main');
    await CryptoUtils.decrypt(vaultRecord.data, vaultRecord.iv, oldKey);

    // 生成新盐值和密钥（沿用当前 iterations，保证派生参数一致）
    const newSalt = CryptoUtils.generateSalt();
    const newKey = await CryptoUtils.deriveKey(newPw, newSalt, iterations);

    // 重新加密数据
    const { iv, data } = await CryptoUtils.encrypt(
      {
        entries: App.state.entries,
        tagDefs: App.state.tagDefs,
        tags: App.state.tags,
        deleted: App.state.deleted
      },
      newKey
    );

    // 保存新的盐值和加密数据
    await DBUtils.dbPut(DBUtils.STORE_META, { key: 'salt', value: CryptoUtils.arrayBufferToBase64(newSalt) });
    await DBUtils.dbPut(DBUtils.STORE_VAULT, { id: 'main', iv, data });

    // 更新内存中的密钥
    App.state.cryptoKey = newKey;

    // 同步本地文件（已绑定目录时；未绑定时内部静默跳过）
    await FileSync.syncNow();

    App.closeModal();
    Utils.showToast('主密码已修改', 'success');
  } catch (e) {
    Utils.showToast('当前主密码错误', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '确认修改';
    }
  }
}

/**
 * 销毁保险箱
 */
async function destroyVault() {
  const confirmed = await Utils.confirm({
    title: '销毁保险箱',
    message: '⚠️ 此操作将删除所有密码数据，且无法恢复！\n\n确定要销毁保险箱吗？',
    confirmText: '销毁',
    danger: true
  });
  if (!confirmed) return;
  
  const doubleConfirm = await Utils.confirm({
    title: '最后确认',
    message: '您真的要销毁所有数据吗？',
    confirmText: '确认销毁',
    danger: true
  });
  if (!doubleConfirm) return;
  
  try {
    // 先清理本地同步文件与目录绑定：目录句柄存在 IndexedDB 中，须在删库前执行
    await FileSync.deleteLocalFile();
    await FileSync.unbindDirectory();
    // 删除 IndexedDB 数据库（内部会先关闭连接，避免删除被阻塞）
    await DBUtils.deleteDatabase();
    // 刷新页面，回到首次使用界面
    Utils.showToast('保险箱已销毁', 'success');
    
    setTimeout(() => {
      location.reload();
    }, 800);
  } catch (e) {
    Utils.showToast('销毁失败：' + (e.message || e), 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   标签管理模态框
   增删改标签名称、颜色、图标
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 打开标签管理模态框
 */
function openTagManagementModal() {
  App.openModal();
  const modal = document.getElementById('modal');
  modal.style.maxWidth = '560px';
  renderTagManagementBody(modal);
}

/**
 * 渲染标签管理主体内容
 * @param {HTMLElement} modal - 模态框容器
 */
function renderTagManagementBody(modal) {
  const tagDefs = App.state.tagDefs || {};
  const counts = App.getTagCounts();
  // 按字母顺序排列，默认标签排前
  const sorted = Object.keys(tagDefs).sort((a, b) => {
    const aDef = tagDefs[a];
    const bDef = tagDefs[b];
    if (aDef.isDefault && !bDef.isDefault) return -1;
    if (!aDef.isDefault && bDef.isDefault) return 1;
    return a.localeCompare(b);
  });

  modal.innerHTML = `
    <div class="modal-header">
      <h2>标签管理</h2>
      <button class="btn-icon" onclick="App.closeModal()" tabindex="-1">
        ${Utils.SvgIcons.close(16)}
      </button>
    </div>
    <div class="modal-body" style="padding:0">
      <div id="tag-manage-list" class="tag-manage-list">
        ${sorted.length === 0 ? '<div style="padding:32px;text-align:center;color:var(--text-muted)">暂无标签</div>' : ''}
        ${sorted.map(name => renderTagManageRow(name, tagDefs[name], counts[name] || 0)).join('')}
      </div>
      <div class="tag-manage-add">
        <button class="btn btn-primary btn-full" onclick="openAddTagForm()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          添加新标签
        </button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="App.closeModal()">关闭</button>
    </div>
  `;
}

/**
 * 渲染单个标签管理行
 */
function renderTagManageRow(name, def, count) {
  const color = def ? def.color : '#8b949e';
  const icon = def ? def.icon : 'other';
  const isDefault = def ? def.isDefault : false;
  const iconSvg = Utils.getCategoryIcon(icon, color);

  return `
    <div class="tag-manage-row" id="tag-row-${CSS.escape(name)}">
      <div class="tag-manage-icon">${iconSvg}</div>
      <div class="tag-manage-info">
        <div class="tag-manage-name">${Utils.escHtml(name)}</div>
        <div class="tag-manage-meta">
          <span class="tag-manage-count">${count} 条密码</span>
          ${isDefault ? '<span class="tag-manage-badge">默认</span>' : ''}
        </div>
      </div>
      <div class="tag-manage-color-swatch" style="background:${color}" title="颜色"></div>
      <div class="tag-manage-actions">
        <button class="btn btn-ghost btn-sm" data-edit-tag="${Utils.escHtml(name)}" onclick="openEditTagFromButton(this)" title="编辑">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          编辑
        </button>
        ${isDefault ? '' : `
        <button class="btn btn-ghost btn-sm btn-danger-ghost" data-delete-tag="${Utils.escHtml(name)}" onclick="confirmDeleteTagFromButton(this)" title="删除">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          删除
        </button>`}
      </div>
    </div>
  `;
}

/**
 * 打开新增标签表单
 */
function openAddTagForm() {
  showTagFormModal(null);
}

/**
 * 打开编辑标签表单
 * @param {string} name - 标签原名
 */
function openEditTagForm(name) {
  showTagFormModal(name);
}

/**
 * 从按钮 data 属性读取标签名并打开编辑表单（避免内联字符串注入）
 * @param {HTMLElement} btn - 触发按钮
 */
function openEditTagFromButton(btn) {
  if (!btn) return;
  openEditTagForm(btn.dataset.editTag || '');
}

/**
 * 从按钮 data 属性读取标签名并确认删除（避免内联字符串注入）
 * @param {HTMLElement} btn - 触发按钮
 */
function confirmDeleteTagFromButton(btn) {
  if (!btn) return;
  confirmDeleteTag(btn.dataset.deleteTag || '');
}

/**
 * 从保存按钮 data 属性读取编辑目标并保存（避免内联字符串注入）
 */
function saveTagFormFromButton() {
  const btn = document.querySelector('#modal .btn-primary[data-editing-name]');
  if (!btn) return;
  saveTagForm(btn.dataset.editingName || '');
}

/**
 * 标签表单模态框（新增或编辑）
 * @param {string|null} editingName - null=新增，string=编辑
 */
function showTagFormModal(editingName) {
  const tagDefs = App.state.tagDefs || {};
  const def = editingName ? tagDefs[editingName] : null;
  const isDefault = def ? def.isDefault : false;

  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-header">
      <h2>${editingName ? '编辑标签' : '添加标签'}</h2>
      <button class="btn-icon" onclick="renderTagManagementBody(document.getElementById('modal'))" tabindex="-1">
        ${Utils.SvgIcons.close(16)}
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">标签名称 <span class="text-danger">*</span></label>
        <input class="form-input" id="tag-form-name" type="text" placeholder="例如：社交" value="${editingName ? Utils.escHtml(editingName) : ''}" maxlength="20" tabindex="1" />
        ${isDefault ? '<div class="tag-hint">默认标签不可删除名称，可修改颜色与图标</div>' : ''}
      </div>
      <div class="form-group">
        <label class="form-label">颜色</label>
        <div class="color-picker-grid" id="tag-form-colors">
          ${TAG_COLOR_OPTIONS.map(c => `
            <button type="button" class="color-swatch-btn ${def && def.color === c ? 'selected' : ''}"
              style="background:${c}"
              data-color="${c}"
              onclick="selectTagColor('${c}')"
              title="${c}">
            </button>
          `).join('')}
        </div>
        <input type="hidden" id="tag-form-color" value="${def ? def.color : '#58a6ff'}" />
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">图标</label>
        <div class="icon-picker-grid" id="tag-form-icons">
          ${TAG_ICON_OPTIONS.map(iconId => `
            <button type="button" class="icon-pick-btn ${def && def.icon === iconId ? 'selected' : ''}"
              data-icon="${iconId}"
              onclick="selectTagIcon('${iconId}')"
              title="${iconId}">
              ${Utils.getCategoryIcon(iconId, def ? def.color : '#58a6ff')}
            </button>
          `).join('')}
        </div>
        <input type="hidden" id="tag-form-icon" value="${def ? def.icon : 'other'}" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="renderTagManagementBody(document.getElementById('modal'))" tabindex="4">取消</button>
      <button class="btn btn-primary" data-editing-name="${editingName ? Utils.escHtml(editingName) : ''}" onclick="saveTagFormFromButton()" tabindex="3">保存</button>
    </div>
  `;
}

/**
 * 选中颜色
 */
function selectTagColor(color) {
  document.getElementById('tag-form-color').value = color;
  document.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.color === color);
  });
  // 同步更新图标预览
  const icon = document.getElementById('tag-form-icon').value;
  const iconBtn = document.querySelector(`.icon-pick-btn[data-icon="${icon}"]`);
  if (iconBtn) {
    iconBtn.innerHTML = Utils.getCategoryIcon(icon, color);
  }
}

/**
 * 选中图标
 */
function selectTagIcon(icon) {
  document.getElementById('tag-form-icon').value = icon;
  document.querySelectorAll('.icon-pick-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.icon === icon);
  });
  // 同步更新颜色预览
  const color = document.getElementById('tag-form-color').value;
  const colorBtn = document.querySelector(`.color-swatch-btn[data-color="${color}"]`);
  if (colorBtn) {
    colorBtn.style.background = color;
  }
}

/**
 * 保存标签表单（新增或编辑）
 * @param {string} editingName - 原标签名（空=新增）
 */
async function saveTagForm(editingName) {
  const name = document.getElementById('tag-form-name').value.trim();
  const color = document.getElementById('tag-form-color').value;
  const icon = document.getElementById('tag-form-icon').value;

  if (!name) {
    Utils.showToast('请输入标签名称', 'error');
    return;
  }
  if (name.length > 20) {
    Utils.showToast('标签名称最多 20 个字符', 'error');
    return;
  }

  // 新增时检查重名
  if (!editingName && App.state.tagDefs && App.state.tagDefs[name]) {
    Utils.showToast('标签已存在', 'error');
    return;
  }

  // 编辑时检查是否改名冲突
  if (editingName && name !== editingName && App.state.tagDefs && App.state.tagDefs[name]) {
    Utils.showToast('标签名称冲突', 'error');
    return;
  }

  // 改名时：更新所有条目的 tags 数组
  if (editingName && name !== editingName) {
    App.state.entries.forEach(entry => {
      if (entry.tags) {
        const idx = entry.tags.indexOf(editingName);
        if (idx !== -1) entry.tags[idx] = name;
      }
    });
  }

  const oldDef = App.state.tagDefs[editingName || name];
  App.state.tagDefs[name] = {
    color,
    icon,
    isDefault: oldDef ? oldDef.isDefault : false,
  };

  // 删除旧名（改名场景）
  if (editingName && name !== editingName) {
    delete App.state.tagDefs[editingName];
  }

  await App.saveVault();
  renderTagManagementBody(document.getElementById('modal'));
  UI.renderSidebar();
  UI.renderEntries();

  Utils.showToast(editingName && name !== editingName ? '标签已重命名' : editingName ? '标签已更新' : '标签已添加', 'success');
}

/**
 * 确认删除标签
 * @param {string} name - 标签名
 */
async function confirmDeleteTag(name) {
  const usedCount = App.getTagCounts()[name] || 0;
  const confirmed = await Utils.confirm({
    title: '删除标签',
    message: `确定删除标签「${name}」？${usedCount > 0 ? `该标签被 ${usedCount} 条密码使用，删除后这些条目将不再拥有此标签。` : ''}`,
    confirmText: '删除',
    danger: true
  });
  if (!confirmed) return;

  // 从所有条目中移除该标签
  App.state.entries.forEach(entry => {
    if (entry.tags) {
      entry.tags = entry.tags.filter(t => t !== name);
    }
  });

  delete App.state.tagDefs[name];
  await App.saveVault();
  renderTagManagementBody(document.getElementById('modal'));
  UI.renderSidebar();
  UI.renderEntries();

  Utils.showToast('标签已删除', 'success');
}

// 导出模块
window.Settings = {
  openSettingsModal,
  updateLockTimeout,
  updateClipboardClear,
  openChangePasswordModal,
  changePassword,
  destroyVault,
  bindDataDirectory,
  openTagManagementModal,
  renderTagManagementBody,
  openAddTagForm,
  openEditTagForm,
  showTagFormModal,
  selectTagColor,
  selectTagIcon,
  saveTagForm,
  confirmDeleteTag,
};
