/* ═══════════════════════════════════════════════════════════════════
   LockPass — 条目管理模块
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 根据 ID 查找条目（先查活动条目，再查回收站）
 * @param {string} id - 条目 ID
 * @returns {Object|null}
 */
function getEntryById(id) {
  return App.state.entries.find(e => e.id === id) ||
         App.state.deleted.find(e => e.id === id) ||
         null;
}

/**
 * 选择条目
 */
// 切换条目时「收回再弹出」动画的定时器（防止快速连点造成动画错乱）
let detailAnimTimer = null;

function selectEntry(id, event) {
  if (event) event.stopPropagation();
  
  const panel = document.getElementById('detail-panel');
  const alreadyOpen = panel.classList.contains('open');
  const sameEntry = App.state.selectedEntry === id;
  
  App.state.selectedEntry = id;
  UI.renderEntries();
  
  const entry = getEntryById(id);
  if (!entry) return;
  
  if (alreadyOpen && !sameEntry) {
    // 已打开且切换不同条目 → 先收回，内容更新后再弹出（新内容淡入）
    clearTimeout(detailAnimTimer);
    panel.classList.remove('open');
    panel.classList.add('animating');
    detailAnimTimer = setTimeout(() => {
      renderDetailPanel(entry);
      panel.classList.add('open');
      detailAnimTimer = setTimeout(() => panel.classList.remove('animating'), 30);
    }, 320);
  } else {
    renderDetailPanel(entry);
    panel.classList.add('open');
  }
}

/**
 * 关闭详情面板
 */
function closeDetailPanel() {
  clearTimeout(detailAnimTimer);
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('open');
  panel.classList.remove('animating');
  App.state.selectedEntry = null;
  UI.renderEntries();
}

/**
 * 渲染详情面板
 */
function renderDetailPanel(entry) {
  document.getElementById('detail-title').textContent = entry.title || '未命名';
  
  // 同步收藏按钮状态
  const favBtn = document.getElementById('detail-fav-btn');
  if (favBtn) {
    const isFav = !!entry.favorite;
    favBtn.classList.toggle('active', isFav);
    favBtn.title = isFav ? '取消收藏' : '收藏';
    const svg = favBtn.querySelector('svg');
    if (svg) {
      svg.setAttribute('fill', isFav ? 'var(--warning)' : 'none');
      svg.setAttribute('stroke', isFav ? 'var(--warning)' : 'currentColor');
    }
  }
  
  // 判断是否处于回收站（回收站中隐藏收藏按钮）
  const isRecycle = App.state.deleted.some(e => e.id === entry.id);
  if (favBtn) favBtn.style.display = isRecycle ? 'none' : '';
  
  const body = document.getElementById('detail-body');
  const tagDefs = App.state.tagDefs || {};
  
  let html = '';

  // 按 entryType 渲染字段
  const type = entry.entryType || 'website';
  const root = entry.root || {};
  const password = entry.password || '';
  const showPw = entry.showPassword;
  const mask = (v) => showPw ? Utils.escHtml(v) : '••••••••';
  const pwRow = (label, val, copyVal) => `
    <div class="detail-field">
      <div class="detail-field-label">${label}</div>
      <div class="detail-field-value mono">
        <span class="${showPw ? '' : 'masked'}">${mask(val)}</span>
        <span style="margin-left:auto"></span>
        <button class="btn-icon" style="width:24px;height:24px" onclick="toggleDetailPassword()" title="${showPw ? '隐藏' : '显示'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${showPw
              ? Utils.SvgIcons.eyeClosedPaths
              : Utils.SvgIcons.eyeOpenPaths}
          </svg>
        </button>
        <button class="btn-icon" style="width:24px;height:24px" data-copy-val="${Utils.escHtml(copyVal || val)}" onclick="copyFieldByData(this)" title="复制">
          ${Utils.SvgIcons.copy(12)}
        </button>
      </div>
    </div>`;
  const textRow = (label, val, copyVal) => {
    if (!val) return '';
    return `
      <div class="detail-field">
        <div class="detail-field-label">${label}</div>
        <div class="detail-field-value">
          ${Utils.escHtml(val)}
          <button class="btn-icon" style="width:24px;height:24px;margin-left:auto" data-copy-val="${Utils.escHtml(copyVal || val)}" onclick="copyFieldByData(this)" title="复制">
            ${Utils.SvgIcons.copy(12)}
          </button>
        </div>
      </div>`;
  };
  const linkRow = (label, val) => {
    if (!val) return '';
    const safeHref = Utils.safeUrl(val);
    if (!safeHref) {
      // 非白名单协议降级为纯文本，避免 javascript: 等注入
      return `
        <div class="detail-field">
          <div class="detail-field-label">${label}</div>
          <div class="detail-field-value">${Utils.escHtml(val)}</div>
        </div>`;
    }
    return `
      <div class="detail-field">
        <div class="detail-field-label">${label}</div>
        <div class="detail-field-value">
          <a href="${Utils.escHtml(safeHref)}" target="_blank" rel="noopener">${Utils.escHtml(val)}</a>
        </div>
      </div>`;
  };

  // 命令行提示行（可一键复制）
  const cmdRow = (label, cmd, isMulti = false) => {
    if (!cmd) return '';
    const escaped = Utils.escHtml(cmd);
    return `
      <div class="detail-field cmd-field">
        <div class="detail-field-label">${label}</div>
        <div class="detail-field-value cmd-value ${isMulti ? 'cmd-multi' : ''}">
          <code class="cmd-text">${escaped}</code>
          <button class="btn-icon" data-copy-val="${escaped}" onclick="copyFieldByData(this)" title="复制命令">
            ${Utils.SvgIcons.copy(12)}
          </button>
        </div>
      </div>`;
  };

  if (type === 'website') {
    html += textRow('用户名', entry.username);
    html += pwRow('密码', password, password);
    html += linkRow('网址', entry.url);
  } else if (type === 'server') {
    html += linkRow('连接地址', entry.url);
    html += textRow('登录账号', entry.username);
    html += pwRow('登录密码', password, password);
    // 连接命令提示
    const sshPort = entry.port ? ` -p ${entry.port}` : '';
    if (entry.username && entry.url) {
      html += cmdRow('连接命令', `ssh${sshPort} ${entry.username}@${entry.url}`);
    }
    if (root.username || root.password) {
      html += `<div class="detail-section-divider"><span>root</span></div>`;
      html += textRow('root 账号', root.username);
      html += pwRow('root 密码', root.password, root.password);
      // root 通常无法直接 SSH 登录，不显示连接命令
    }
  } else if (type === 'database') {
    const addr = entry.port ? `${entry.url}:${entry.port}` : entry.url;
    html += linkRow('数据库地址', addr);
    html += textRow('用户名', entry.username);
    html += pwRow('密码', password, password);
    // 连接命令提示
    const dbPort = entry.port ? ` -P ${entry.port}` : '';
    if (entry.url && entry.username) {
      html += cmdRow('连接命令', `mysql -h ${entry.url}${dbPort} -u ${entry.username} -p`);
    }
  } else if (type === 'ai') {
    html += textRow('服务名称', entry.username);
    html += linkRow('API 地址', entry.url);
    html += pwRow('Token', password, password);
  } else if (type === 'app') {
    // 应用名称使用标题，不单独显示
    if (entry.appId) {
      html += textRow('App ID', entry.appId);
    }
    html += pwRow('公钥', password, password);
    if (entry.privateKey) {
      html += pwRow('私钥', entry.privateKey, entry.privateKey);
    }
  } else if (type === 'other') {
    html += textRow('凭证名称', entry.username);
    html += pwRow('凭证值', password, password);
  }

  // clipboard-note（统一放末尾，供 copyToClipboard 找到）
  html += `
    <div id="clipboard-note" class="clipboard-note mt-1 hidden">
      ${Utils.SvgIcons.check(12)}
      已复制，${App.state.clipboardClearMs / 1000}秒后清除
    </div>`;
  
  // 标签（统一标签，带颜色/图标）
  if (entry.tags && entry.tags.length) {
    html += `
      <div class="detail-field">
        <div class="detail-field-label">标签</div>
        <div class="detail-field-value tag-list" style="flex-wrap:wrap">
          ${entry.tags.map(t => Utils.renderTagChip(tagDefs, t, false)).join('')}
        </div>
      </div>
    `;
  }
  
  // 备注
  if (entry.notes) {
    html += `
      <div class="detail-field">
        <div class="detail-field-label">备注</div>
        <div class="detail-field-value markdown-body">${Utils.parseMarkdown(entry.notes)}</div>
      </div>
    `;
  }

  // 关联密码（同 IP / 同域名 / 同账号）
  html += RelatedEntries.renderRelatedSection(entry);

  body.innerHTML = html;
  
  // 根据是否在回收站渲染不同的底部操作（恢复/彻底删除 vs 编辑/复制/分享/删除）
  renderDetailFooter(entry, isRecycle);
}

/**
 * 渲染详情面板底部操作区
 * 回收站中的条目显示「恢复 / 彻底删除」，普通条目显示「编辑 / 复制 / 二维码 / 删除」
 * @param {Object} entry - 条目对象
 * @param {boolean} isRecycle - 是否处于回收站
 */
function renderDetailFooter(entry, isRecycle) {
  const footer = document.getElementById('detail-footer');
  if (!footer) return;
  
  if (isRecycle) {
    footer.innerHTML = `
      <button class="btn btn-secondary" style="flex:1" onclick="restoreEntry('${entry.id}')">
        ${Utils.SvgIcons.restore(14)}
        恢复
      </button>
      <button class="btn btn-danger" onclick="permanentDeleteEntry('${entry.id}')">
        ${Utils.SvgIcons.trash(14)}
        彻底删除
      </button>
    `;
  } else {
    footer.innerHTML = `
      <button class="btn btn-secondary" style="flex:1" onclick="editCurrentEntry()">
        ${Utils.SvgIcons.edit(14)}
        编辑
      </button>
      <button class="btn btn-secondary" onclick="copyDetailPassword()">
        ${Utils.SvgIcons.copy(14)}
        复制
      </button>
      <button class="btn btn-secondary" onclick="QR.openShareModal(App.state.selectedEntry)" title="分享为二维码">
        ${Utils.SvgIcons.qrCode(14)}
        二维码
      </button>
      <button class="btn btn-danger" onclick="deleteCurrentEntry()">
        ${Utils.SvgIcons.trash(14)}
        删除
      </button>
    `;
  }
}

/**
 * 切换密码可见性（详情面板）
 */
function toggleDetailPassword() {
  const entry = getEntryById(App.state.selectedEntry);
  if (!entry) return;
  
  entry.showPassword = !entry.showPassword;
  renderDetailPanel(entry);
}

/**
 * 复制详情面板中的密码
 */
function copyDetailPassword() {
  const entry = getEntryById(App.state.selectedEntry);
  if (!entry) return;
  const type = entry.entryType || 'website';
  // 按类型取主凭证值
  let val = entry.password;
  if (type === 'app') val = entry.appId || entry.password;
  copyToClipboard(val, entry.id);
}

/**
 * 复制密码到剪贴板（取 entry.password，server 等多密码场景用于独立复制按钮）
 */
async function copyPassword(id) {
  const entry = getEntryById(id);
  if (!entry) return;
  await copyToClipboard(entry.password || '', id);
}

/**
 * 复制字段值
 */
async function copyField(value) {
  await copyToClipboard(value, null);
}

/**
 * 从详情面板复制按钮的 data-copy-val 读取原始值并复制（避免内联字符串注入）
 * @param {HTMLElement} btn - 复制按钮
 */
function copyFieldByData(btn) {
  if (!btn || !btn.dataset) return;
  const val = btn.dataset.copyVal || '';
  copyToClipboard(val, App.state.selectedEntry, btn);
}

/**
 * 复制到剪贴板
 * @param {string} text - 要复制的文本
 * @param {string|null} entryId - 条目 ID（用于高亮按钮）
 * @param {HTMLElement|null} btnEl - 触发复制的按钮元素（用于浮动提示定位）
 */
async function copyToClipboard(text, entryId, btnEl = null) {
  try {
    await navigator.clipboard.writeText(text);
    Utils.showToast('已复制到剪贴板', 'success');

    // ── 浮动「已复制」提示（靠近按钮位置）──────────────────────
    let cleanupFloatTip = null;
    if (btnEl) {
      const floatTip = document.createElement('div');
      floatTip.textContent = '✓ 已复制';
      Object.assign(floatTip.style, {
        position: 'fixed',
        top: '-28px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--accent, #4f86f7)',
        color: '#fff',
        fontSize: '11px',
        padding: '2px 7px',
        borderRadius: '8px',
        pointerEvents: 'none',
        zIndex: '99999',
        whiteSpace: 'nowrap',
        opacity: '1',
        transition: 'opacity 0.4s',
      });
      const rect = btnEl.getBoundingClientRect();
      floatTip.style.left = rect.left + rect.width / 2 + 'px';
      floatTip.style.top = rect.top + 'px';
      document.body.appendChild(floatTip);
      cleanupFloatTip = () => floatTip.remove();
      setTimeout(() => {
        if (floatTip.parentNode) {
          floatTip.style.opacity = '0';
          setTimeout(() => floatTip.remove(), 400);
        }
      }, 1200);
    }

    // 清除旧的定时器
    clearTimeout(App.state.clipboardTimer);
    const prevCleanup = App.state._clipboardCleanup;
    App.state._clipboardCleanup = () => {
      if (cleanupFloatTip) cleanupFloatTip();
      if (prevCleanup) prevCleanup();
    };

    // 设置自动清除
    App.state.clipboardTimer = setTimeout(async () => {
      try {
        await navigator.clipboard.writeText('');
      } catch {}
      const note = document.getElementById('clipboard-note');
      if (note) note.classList.add('hidden');
      if (App.state._clipboardCleanup) {
        App.state._clipboardCleanup();
        App.state._clipboardCleanup = null;
      }
    }, App.state.clipboardClearMs);

    // 如果在详情面板中，显示倒计时
    if (entryId === App.state.selectedEntry) {
      const note = document.getElementById('clipboard-note');
      if (note) {
        note.classList.remove('hidden');
        let remaining = App.state.clipboardClearMs / 1000;
        const tick = setInterval(() => {
          remaining--;
          if (note) {
            note.innerHTML = `${Utils.SvgIcons.check(12)}已复制，${remaining}秒后清除`;
          }
          if (remaining <= 0) {
            clearInterval(tick);
            if (note) note.classList.add('hidden');
          }
        }, 1000);
      }
    }

    // 高亮复制按钮
    if (entryId) {
      const buttons = document.querySelectorAll(`.entry-card[onclick*="${entryId}"] .copy-btn`);
      buttons.forEach(b => {
        b.classList.add('copied');
        setTimeout(() => b.classList.remove('copied'), 1500);
      });
    }
  } catch {
    Utils.showToast('复制失败，请手动复制', 'error');
  }
}

/**
 * 切换收藏状态
 */
async function toggleFavorite(id) {
  const entry = App.state.entries.find(e => e.id === id);
  if (!entry) return;
  
  entry.favorite = !entry.favorite;
  entry.updatedAt = new Date().toISOString();
  
  await App.saveVault();
  UI.renderEntries();
  UI.renderSidebar();
  
  if (App.state.selectedEntry === id) {
    renderDetailPanel(entry);
  }
}

/**
 * 编辑当前条目
 */
function editCurrentEntry() {
  const entryId = App.state.selectedEntry;
  if (!entryId) return;
  closeDetailPanel();
  openEntryModal(entryId);
}

/**
 * 删除当前条目（软删除，移入回收站）
 * 移入回收站后可恢复或彻底删除，避免误删无法恢复
 */
async function deleteCurrentEntry() {
  if (!App.state.selectedEntry) return;
  
  const confirmed = await Utils.confirm({
    title: '删除密码',
    message: '将移入回收站，您可以在回收站中恢复或彻底删除。',
    confirmText: '移入回收站',
    danger: true
  });
  if (!confirmed) return;
  
  const idx = App.state.entries.findIndex(e => e.id === App.state.selectedEntry);
  if (idx === -1) return;
  
  const entry = App.state.entries[idx];
  entry.deletedAt = new Date().toISOString();
  App.state.entries.splice(idx, 1);
  App.state.deleted.push(entry);
  
  await App.saveVault();
  closeDetailPanel();
  UI.renderEntries();
  UI.renderSidebar();
  
  Utils.showToast('已移入回收站', 'success');
}

/**
 * 按 ID 删除条目（软删除，移入回收站）
 * 与 deleteCurrentEntry 逻辑一致，但按传入 id 查找而非依赖 selectedEntry
 * @param {string} id - 条目 ID
 */
async function deleteEntryById(id) {
  if (!id) return;
  
  const confirmed = await Utils.confirm({
    title: '删除密码',
    message: '将移入回收站，您可以在回收站中恢复或彻底删除。',
    confirmText: '移入回收站',
    danger: true
  });
  if (!confirmed) return;
  
  const idx = App.state.entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  
  const entry = App.state.entries[idx];
  entry.deletedAt = new Date().toISOString();
  App.state.entries.splice(idx, 1);
  App.state.deleted.push(entry);
  
  await App.saveVault();
  if (App.state.selectedEntry === id) closeDetailPanel();
  UI.renderEntries();
  UI.renderSidebar();
  
  Utils.showToast('已移入回收站', 'success');
}

/**
 * 从回收站恢复条目（保留标签等全部元数据）
 * @param {string} id - 条目 ID
 */
async function restoreEntry(id) {
  const idx = App.state.deleted.findIndex(e => e.id === id);
  if (idx === -1) return;
  
  const entry = App.state.deleted[idx];
  delete entry.deletedAt;
  App.state.deleted.splice(idx, 1);
  App.state.entries.push(entry);
  
  await App.saveVault();
  UI.renderSidebar();
  UI.renderEntries();
  if (App.state.selectedEntry === id) closeDetailPanel();
  Utils.showToast('已恢复', 'success');
}

/**
 * 从回收站彻底删除条目（不可恢复）
 * @param {string} id - 条目 ID
 */
async function permanentDeleteEntry(id) {
  const confirmed = await Utils.confirm({
    title: '彻底删除',
    message: '此操作不可撤销，密码将被永久删除。',
    confirmText: '彻底删除',
    danger: true
  });
  if (!confirmed) return;
  
  App.state.deleted = App.state.deleted.filter(e => e.id !== id);
  await App.saveVault();
  UI.renderSidebar();
  if (App.state.selectedEntry === id) closeDetailPanel();
  UI.renderEntries();
  Utils.showToast('已彻底删除', 'success');
}

/**
 * 清空回收站（彻底删除所有软删除条目）
 */
async function emptyRecycleBin() {
  if (!App.state.deleted.length) {
    Utils.showToast('回收站已经是空的', 'info');
    return;
  }
  
  const confirmed = await Utils.confirm({
    title: '清空回收站',
    message: '将永久删除回收站中的 ' + App.state.deleted.length + ' 项密码，此操作不可撤销。',
    confirmText: '清空',
    danger: true
  });
  if (!confirmed) return;
  
  App.state.deleted = [];
  await App.saveVault();
  UI.renderSidebar();
  if (App.state.currentFilter === 'recycle') {
    closeDetailPanel();
    UI.renderEntries();
  }
  Utils.showToast('回收站已清空', 'success');
}

// 导出模块
window.Entries = {
  getEntryById,
  selectEntry,
  closeDetailPanel,
  renderDetailPanel,
  renderDetailFooter,
  toggleDetailPassword,
  copyDetailPassword,
  copyPassword,
  copyField,
  copyToClipboard,
  toggleFavorite,
  editCurrentEntry,
  deleteCurrentEntry,
  deleteEntryById,
  restoreEntry,
  permanentDeleteEntry,
  emptyRecycleBin
};
