/* ═══════════════════════════════════════════════════════════════════
   LockPass — 条目编辑模块
   支持 5 种条目类型：网站、服务器、AI、应用、其他。
   ═══════════════════════════════════════════════════════════════════ */

let editingEntryId = null;
let currentEntryType = 'website';

// ── 表单字段跨类型缓存（切换 entry type 时保留字段数据）────────────────
// { fieldId: value }  value 为字符串，密码掩码字段存还原后的明文
const _formFieldCache = {};

function cacheCurrentFormFields() {
  const form = document.getElementById(`form-${currentEntryType}`);
  if (!form) return;
  form.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach(el => {
    const id = el.id;
    if (!id) return;
    // 密码字段：若处于掩码态，优先取 data 属性中的明文
    if (el.type === 'password') {
      _formFieldCache[id] = el.dataset.masked === '1' ? (el._plainValue || el.value) : el.value;
    } else {
      _formFieldCache[id] = el.value;
    }
  });
}

function restoreFormFields(type) {
  const form = document.getElementById(`form-${type}`);
  if (!form) return;
  form.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach(el => {
    const id = el.id;
    if (!id || !(id in _formFieldCache)) return;
    const cached = _formFieldCache[id];
    // 直接还原值。普通 input[type=password] 天然掩码显示，无需打 masked 标记；
    // 若错误标记 masked，saveEntry 会误用 _plainValue（未定义）把密码清空
    el.value = cached;
  });
}

/**
 * 获取条目中特定字段的值（兼容不同 entryType 的字段映射）
 * @param {Object} entry
 * @param {string} field  'username'|'password'|'url'|'port'|'appId'|'privateKey'|'rootUser'|'rootPwd'
 */
function getEntryField(entry, field) {
  const e = entry || {};
  switch (field) {
    case 'username':    return e.username || '';
    case 'password':   return e.password || '';
    case 'url':        return e.url || '';
    case 'port':       return e.port != null ? String(e.port) : '';
    case 'appId':      return e.appId || '';
    case 'privateKey':  return e.privateKey || '';
    case 'rootUser':   return (e.root || {}).username || '';
    case 'rootPwd':    return (e.root || {}).password || '';
    default: return '';
  }
}

/**
 * 根据类型切换表单 DOM 中的 label 显示（运行时更新，无需重建 DOM）
 */
function syncFieldLabels(type) {
  const labels = {
    website: { u: '用户名', p: '密码',      u2: '网址',    hint: '输入或生成密码' },
    server:  { u: '登录账号', p: '登录密码', u2: '连接地址', hint: '示例：ssh -p 22 user@1.2.3.4' },
    ai:      { u: '服务名称', p: 'Token',   u2: '官网',    hint: '示例：DeepSeek / OpenAI / 通义千问' },
    app:     { u: '应用名称', p: '公钥',    u2: '开发者平台', hint: '示例：支付宝 / GitHub' },
    other:   { u: '凭证名称', p: '凭证值',  u2: '',         hint: '示例：API 密钥 / 许可证 / 证书' },
  };
  const lbl = labels[type] || labels.website;
  const form = document.getElementById(`form-${type}`);
  const elUser = form?.querySelector('[data-field="username-label"]');
  const elPw   = form?.querySelector('[data-field="password-label"]');
  const elUrl  = form?.querySelector('[data-field="url-label"]');
  if (elUser) elUser.textContent = lbl.u;
  if (elPw)   elPw.textContent  = lbl.p;
  if (elUrl) {
    elUrl.parentElement.style.display = lbl.u2 ? '' : 'none';
    elUrl.textContent = lbl.u2;
    const urlInput = form?.querySelector('[data-field="url"]');
    if (urlInput) urlInput.placeholder = lbl.hint;
  }
  // 更新密码强度 label
  updateStrengthBar();
}

/**
 * 根据 entryType 切换主密码行的提示文字
 */
function getPasswordPlaceholder(type) {
  const map = {
    website: '输入或生成密码',
    server:  '输入或生成密码',
    ai:      '输入 Token',
    app:     '输入公钥',
    other:   '输入凭证值',
  };
  return map[type] || '输入或生成密码';
}

/**
 * 获取缓存键（新条目使用统一键，内部存储类型信息）
 */
function getDraftKey(entryId = null) {
  return entryId ? `lockpass_draft_edit_${entryId}` : 'lockpass_draft_new';
}

/**
 * 缓存表单数据（排除私钥等敏感长文本）
 */
function cacheFormData() {
  const type = currentEntryType;
  const form = document.getElementById(`form-${type}`);
  if (!form) return;

  const data = {
    type,
    title: document.getElementById('e-title')?.value || '',
    username: form.querySelector('[data-field="username"]')?.value || '',
    password: form.querySelector('[data-field="password"]')?.value || '',
    url: form.querySelector('[data-field="url"]')?.value || '',
    port: form.querySelector('[data-field="port"]')?.value || '',
    notes: document.getElementById('e-notes')?.value || '',
    tags: getSelectedTags(),
    timestamp: Date.now(),
  };

  // server 类型额外缓存 root 字段
  if (type === 'server') {
    data.rootUser = form.querySelector('[data-field="root-user"]')?.value || '';
    data.rootPwd = form.querySelector('[data-field="root-pwd"]')?.value || '';
  }

  // app 类型额外缓存 appId（排除 privateKey）
  if (type === 'app') {
    data.appId = form.querySelector('[data-field="appid"]')?.value || '';
    // 私钥不缓存：太长且敏感
  }

  try {
    sessionStorage.setItem(getDraftKey(editingEntryId), JSON.stringify(data));
  } catch (e) {
    // 忽略缓存失败
  }
}

/**
 * 恢复表单数据
 */
function restoreFormData(entryId = null) {
  const key = getDraftKey(entryId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // 缓存超过 24 小时视为过期
    if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
      sessionStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

/**
 * 清除表单缓存
 */
function clearFormCache(entryId = null) {
  try {
    sessionStorage.removeItem(getDraftKey(entryId));
  } catch (e) {
    // 忽略
  }
}

/**
 * 打开条目编辑模态框
 */
function openEntryModal(entryId = null) {
  editingEntryId = entryId;
  const entry = entryId ? App.state.entries.find(e => e.id === entryId) : null;
  // 新条目默认 website；已有条目读取其类型
  currentEntryType = entry && entry.entryType ? entry.entryType : 'website';

  const modal = document.getElementById('modal');
  modal.style.maxWidth = '560px';

  // 类型切换 tab
  const typeTabs = App.ENTRY_TYPES.map(t => {
    const active = t.id === currentEntryType;
    return `<button class="type-tab ${active ? 'active' : ''}" data-type="${t.id}" onclick="switchEntryType('${t.id}')" tabindex="-1">
      <span class="type-tab-icon">${getTypeIconSvg(t.id)}</span>
      <span>${t.label}</span>
    </button>`;
  }).join('');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>${entry ? '编辑' : '添加'}凭证</h2>
      <button class="btn-icon" onclick="cancelEntryModal()" tabindex="-1">
        ${Utils.SvgIcons.close(16)}
      </button>
    </div>
    <div class="modal-body">
      <!-- 类型切换 -->
      <div class="type-tabs">${typeTabs}</div>

      <!-- 标题 -->
      <div class="form-group">
        <label class="form-label">标题 <span class="text-danger">*</span></label>
        <input class="form-input" id="e-title" type="text" placeholder="例如：Gmail / 阿里云 ECS" maxlength="100" value="${entry ? Utils.escHtml(entry.title) : ''}" tabindex="1" />
      </div>

      <!-- === website === -->
      <div id="form-website" class="entry-type-form" style="display:${currentEntryType === 'website' ? '' : 'none'}">
        ${buildWebsiteFields(entry)}
      </div>

      <!-- === server === -->
      <div id="form-server" class="entry-type-form" style="display:${currentEntryType === 'server' ? '' : 'none'}">
        ${buildServerFields(entry)}
      </div>

      <!-- === database === -->
      <div id="form-database" class="entry-type-form" style="display:${currentEntryType === 'database' ? '' : 'none'}">
        ${buildDatabaseFields(entry)}
      </div>

      <!-- === ai === -->
      <div id="form-ai" class="entry-type-form" style="display:${currentEntryType === 'ai' ? '' : 'none'}">
        ${buildAiFields(entry)}
      </div>

      <!-- === app === -->
      <div id="form-app" class="entry-type-form" style="display:${currentEntryType === 'app' ? '' : 'none'}">
        ${buildAppFields(entry)}
      </div>

      <!-- === other === -->
      <div id="form-other" class="entry-type-form" style="display:${currentEntryType === 'other' ? '' : 'none'}">
        ${buildOtherFields(entry)}
      </div>

      <!-- 标签 -->
      <div class="form-group">
        <label class="form-label">标签</label>
        <div class="tag-selector" id="tag-selector" tabindex="6">
          <div class="tag-input-wrapper">
            <input type="text" id="e-tag-input" placeholder="输入标签后按 Enter" onkeydown="handleTagInput(event)" />
          </div>
        </div>
        <div class="tag-hint">点击推荐标签或输入后按 Enter 添加；可在「设置 → 标签管理」中增删改颜色与图标</div>
      </div>

      <!-- 备注 -->
      <div class="form-group">
        <label class="form-label">备注 <span class="text-muted text-sm">(支持 Markdown)</span></label>
        <textarea class="form-input notes-textarea" id="e-notes" placeholder="支持 Markdown 格式...&#10;&#10;例如：&#10;- **使用场景**：VPN 连接&#10;- **步骤**：&#10;  1. 连接 VPN&#10;  2. 打开网站&#10;  3. 输入账号密码" tabindex="7">${entry ? Utils.escHtml(entry.notes || '') : ''}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cancelEntryModal()" tabindex="8">取消</button>
      <button class="btn btn-primary" onclick="saveEntry()" tabindex="9">
        ${Utils.SvgIcons.check(14)}
        保存
      </button>
    </div>
  `;

  App.openModal();
  initTagSelector(entry && entry.tags ? entry.tags : []);
  // 初始化密码强度条
  if (currentEntryType === 'website' || currentEntryType === 'server') updateStrengthBar();

  // 恢复缓存的表单数据（编辑模式且有 entry 时不恢复，以 entry 数据为准）
  if (!entryId || !entry) {
    const draft = restoreFormData(entryId);
    if (draft) {
      // 恢复数据
      if (draft.title) document.getElementById('e-title').value = draft.title;
      if (draft.notes) document.getElementById('e-notes').value = draft.notes;
      // 切换到缓存的类型
      if (draft.type && draft.type !== currentEntryType) {
        switchEntryType(draft.type);
      }
      // 恢复类型特定字段
      const form = document.getElementById(`form-${draft.type || currentEntryType}`);
      if (form) {
        const usernameEl = form.querySelector('[data-field="username"]');
        const passwordEl = form.querySelector('[data-field="password"]');
        const urlEl = form.querySelector('[data-field="url"]');
        const portEl = form.querySelector('[data-field="port"]');
        if (usernameEl && draft.username) usernameEl.value = draft.username;
        if (passwordEl && draft.password) passwordEl.value = draft.password;
        if (urlEl && draft.url) urlEl.value = draft.url;
        if (portEl && draft.port) portEl.value = draft.port;
        // server 类型恢复 root 字段
        if ((draft.type || currentEntryType) === 'server') {
          const rootUserEl = form.querySelector('[data-field="root-user"]');
          const rootPwdEl = form.querySelector('[data-field="root-pwd"]');
          if (rootUserEl && draft.rootUser) rootUserEl.value = draft.rootUser;
          if (rootPwdEl && draft.rootPwd) rootPwdEl.value = draft.rootPwd;
        }
        // app 类型恢复 appId
        if ((draft.type || currentEntryType) === 'app') {
          const appIdEl = form.querySelector('[data-field="appid"]');
          if (appIdEl && draft.appId) appIdEl.value = draft.appId;
        }
      }
      // 恢复标签
      if (draft.tags && draft.tags.length) {
        draft.tags.forEach(tag => addTag(tag));
      }
      // 更新密码强度条
      if ((draft.type || currentEntryType) === 'website' || (draft.type || currentEntryType) === 'server') {
        updateStrengthBar();
      }
    }
  }

  // 绑定表单输入事件，实时缓存
  setTimeout(() => {
    const formContainer = document.getElementById('modal');
    if (formContainer) {
      formContainer.querySelectorAll('input, textarea').forEach(el => {
        el.addEventListener('input', cacheFormData);
      });
    }
  }, 0);
}

/**
 * 取消编辑/添加，清除缓存并关闭模态框
 */
function cancelEntryModal() {
  // 关闭时不清空缓存，只有保存成功时才清空
  // 这样用户关闭后重新打开可以继续编辑
  App.closeModal();
}

/**
 * 切换条目类型
 */
function switchEntryType(type) {
  // 切换前缓存当前表单字段
  cacheCurrentFormFields();
  // 隐藏所有表单
  document.querySelectorAll('.entry-type-form').forEach(el => el.style.display = 'none');
  // 取消所有 tab 选中
  document.querySelectorAll('.type-tab').forEach(btn => btn.classList.remove('active'));
  // 选中对应 tab
  const tab = document.querySelector(`.type-tab[data-type="${type}"]`);
  if (tab) tab.classList.add('active');
  // 显示对应表单
  const form = document.getElementById(`form-${type}`);
  if (form) form.style.display = '';
  currentEntryType = type;
  // 从缓存恢复新类型表单字段
  restoreFormFields(type);
  // 更新密码强度条
  updateStrengthBar();
}

/**
 * 返回各类型的类型图标 SVG
 * @param {string} type - 条目类型
 * @returns {string} SVG HTML
 */
function getTypeIconSvg(type) {
  return Utils.SvgIcons.typeIcon(14, type);
}

/**
 * 构建 website 类型字段
 */
function buildWebsiteFields(entry) {
  return `
    <div class="form-group">
      <label class="form-label" data-field="username-label">用户名</label>
      <input class="form-input" data-field="username" type="text" placeholder="username@example.com" value="${Utils.escHtml(getEntryField(entry, 'username'))}" tabindex="2" />
    </div>
    <div class="form-group">
      <label class="form-label" data-field="password-label">密码 <span class="text-danger">*</span></label>
      <div class="input-affix">
        <input class="form-input mono" data-field="password" type="password" placeholder="输入或生成密码" value="${Utils.escHtml(getEntryField(entry, 'password'))}" oninput="updateStrengthBar()" tabindex="3" />
        <div class="input-affix-btns">
          <button class="pw-gen-btn" onclick="toggleEntryPwVisibility()" title="显示/隐藏" tabindex="-1">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" data-field="password-eye">${Utils.SvgIcons.eyeOpenPaths}</svg>
          </button>
          <button class="pw-gen-btn" onclick="toggleGenPanel()" title="生成密码" tabindex="-1">
            ${Utils.SvgIcons.key(15)}
          </button>
        </div>
      </div>
      <div class="pw-strength" data-field="strength-container" style="display:${getEntryField(entry, 'password') ? 'block' : 'none'}">
        <div class="pw-strength-bar-bg">
          <div class="pw-strength-bar" data-field="strength-bar" style="width:0%"></div>
        </div>
        <div class="pw-strength-text" data-field="strength-text"></div>
      </div>
      <div data-field="gen-panel" class="pw-gen-panel hidden">
        ${renderGenPanel()}
      </div>
    </div>
    <div class="form-group" data-field="url-group">
      <label class="form-label" data-field="url-label">网址</label>
      <input class="form-input" data-field="url" type="url" placeholder="https://example.com" value="${Utils.escHtml(getEntryField(entry, 'url'))}" tabindex="4" />
    </div>`;
}

/**
 * 构建 server 类型字段
 */
function buildServerFields(entry) {
  return `
    <div class="form-group">
      <label class="form-label" data-field="url-label">连接地址</label>
      <div class="input-row">
        <div class="input-row-main">
          <input class="form-input mono" data-field="url" type="text" placeholder="示例：1.2.3.4 或 ssh://1.2.3.4" value="${Utils.escHtml(getEntryField(entry, 'url'))}" tabindex="2" />
        </div>
        <input class="form-input mono" data-field="port" type="number" placeholder="端口" min="1" max="65535" value="${Utils.escHtml(getEntryField(entry, 'port'))}" tabindex="3" style="width:90px;flex-shrink:0;" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">登录账号</label>
      <div class="input-row">
        <div class="input-row-main">
          <input class="form-input" data-field="username" type="text" placeholder="账号" value="${Utils.escHtml(getEntryField(entry, 'username'))}" tabindex="4" />
        </div>
        <button class="pw-gen-btn" onclick="copyFieldById('username')" title="复制账号" tabindex="-1">
          ${Utils.SvgIcons.copy(15)}
        </button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">登录密码</label>
      <div class="input-row">
        <div class="input-row-main">
          <div class="input-affix">
            <input class="form-input mono" data-field="password" type="password" placeholder="密码" value="${Utils.escHtml(getEntryField(entry, 'password'))}" oninput="updateStrengthBar()" tabindex="5" />
            <div class="input-affix-btns">
              <button class="pw-gen-btn" onclick="toggleEntryPwVisibility()" title="显示/隐藏" tabindex="-1">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" data-field="password-eye">${Utils.SvgIcons.eyeOpenPaths}</svg>
              </button>
              <button class="pw-gen-btn" onclick="toggleGenPanel()" title="生成密码" tabindex="-1">
                ${Utils.SvgIcons.key(15)}
              </button>
            </div>
          </div>
        </div>
        <button class="pw-gen-btn" onclick="copyFieldById('password')" title="复制密码" tabindex="-1">
          ${Utils.SvgIcons.copy(15)}
        </button>
      </div>
      <div class="pw-strength" data-field="strength-container" style="display:${getEntryField(entry, 'password') ? 'block' : 'none'}">
        <div class="pw-strength-bar-bg">
          <div class="pw-strength-bar" data-field="strength-bar" style="width:0%"></div>
        </div>
        <div class="pw-strength-text" data-field="strength-text"></div>
      </div>
      <div data-field="gen-panel" class="pw-gen-panel hidden">
        ${renderGenPanel()}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">root 账号</label>
      <div class="input-row">
        <div class="input-row-main">
          <input class="form-input" data-field="root-user" type="text" placeholder="root" value="${Utils.escHtml(getEntryField(entry, 'rootUser'))}" tabindex="6" />
        </div>
        <button class="pw-gen-btn" onclick="copyFieldById('root-user')" title="复制账号" tabindex="-1">
          ${Utils.SvgIcons.copy(15)}
        </button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">root 密码</label>
      <div class="input-row">
        <div class="input-row-main">
          <div class="input-affix">
            <input class="form-input mono" data-field="root-pwd" type="password" placeholder="root 密码" value="${Utils.escHtml(getEntryField(entry, 'rootPwd'))}" tabindex="7" />
            <div class="input-affix-btns">
              <button class="pw-gen-btn" onclick="toggleFieldVisibility('root-pwd', this)" title="显示/隐藏" tabindex="-1">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${Utils.SvgIcons.eyeOpenPaths}</svg>
              </button>
              <button class="pw-gen-btn" onclick="generatePasswordFor('root-pwd')" title="生成密码" tabindex="-1">
                ${Utils.SvgIcons.key(15)}
              </button>
            </div>
          </div>
        </div>
        <button class="pw-gen-btn" onclick="copyFieldById('root-pwd')" title="复制密码" tabindex="-1">
          ${Utils.SvgIcons.copy(15)}
        </button>
      </div>
    </div>`;
}

/**
 * 构建 database 类型字段（无 root 层级，仅账号+密码）
 */
function buildDatabaseFields(entry) {
  return `
    <div class="form-group">
      <label class="form-label">数据库地址</label>
      <div class="input-row">
        <div class="input-row-main">
          <input class="form-input mono" data-field="url" type="text" placeholder="示例：localhost 或 10.0.0.100" value="${Utils.escHtml(getEntryField(entry, 'url'))}" tabindex="2" />
        </div>
        <input class="form-input mono" data-field="port" type="number" placeholder="端口" min="1" max="65535" value="${Utils.escHtml(getEntryField(entry, 'port'))}" tabindex="3" style="width:90px;flex-shrink:0;" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">用户名</label>
      <div class="input-row">
        <div class="input-row-main">
          <input class="form-input" data-field="username" type="text" placeholder="数据库用户名" value="${Utils.escHtml(getEntryField(entry, 'username'))}" tabindex="4" />
        </div>
        <button class="pw-gen-btn" onclick="copyFieldById('username')" title="复制用户名" tabindex="-1">
          ${Utils.SvgIcons.copy(15)}
        </button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" data-field="password-label">密码</label>
      <div class="input-row">
        <div class="input-row-main">
          <div class="input-affix">
            <input class="form-input mono" data-field="password" type="password" placeholder="数据库密码" value="${Utils.escHtml(getEntryField(entry, 'password'))}" oninput="updateStrengthBar()" tabindex="5" />
            <div class="input-affix-btns">
              <button class="pw-gen-btn" onclick="toggleEntryPwVisibility()" title="显示/隐藏" tabindex="-1">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" data-field="password-eye">${Utils.SvgIcons.eyeOpenPaths}</svg>
              </button>
              <button class="pw-gen-btn" onclick="toggleGenPanel()" title="生成密码" tabindex="-1">
                ${Utils.SvgIcons.key(15)}
              </button>
            </div>
          </div>
        </div>
        <button class="pw-gen-btn" onclick="copyFieldById('password')" title="复制密码" tabindex="-1">
          ${Utils.SvgIcons.copy(15)}
        </button>
      </div>
      <div class="pw-strength" data-field="strength-container" style="display:${getEntryField(entry, 'password') ? 'block' : 'none'}">
        <div class="pw-strength-bar-bg">
          <div class="pw-strength-bar" data-field="strength-bar" style="width:0%"></div>
        </div>
        <div class="pw-strength-text" data-field="strength-text"></div>
      </div>
      <div data-field="gen-panel" class="pw-gen-panel hidden">
        ${renderGenPanel()}
      </div>
    </div>`;
}

/**
 * 构建 ai 类型字段
 */
function buildAiFields(entry) {
  return `
    <div class="form-group">
      <label class="form-label">服务名称</label>
      <input class="form-input" data-field="username" type="text" placeholder="示例：DeepSeek / OpenAI / 通义千问 / Kimi" value="${Utils.escHtml(getEntryField(entry, 'username'))}" tabindex="2" />
    </div>
    <div class="form-group">
      <label class="form-label">API 地址</label>
      <input class="form-input" data-field="url" type="url" placeholder="https://api.deepseek.com / https://api.openai.com" value="${Utils.escHtml(getEntryField(entry, 'url'))}" tabindex="3" />
    </div>
    <div class="form-group">
      <label class="form-label" data-field="password-label">Token <span class="text-danger">*</span></label>
      <div class="input-affix">
        <input class="form-input mono" data-field="password" type="password" placeholder="输入 Token" value="${Utils.escHtml(getEntryField(entry, 'password'))}" tabindex="4" />
        <div class="input-affix-btns">
          <button class="pw-gen-btn" onclick="toggleEntryPwVisibility()" title="显示/隐藏" tabindex="-1">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" data-field="password-eye">${Utils.SvgIcons.eyeOpenPaths}</svg>
          </button>
        </div>
      </div>
    </div>`;
}

/**
 * 构建 app 类型字段
 */
function buildAppFields(entry) {
  return `
    <div class="form-group">
      <label class="form-label">App ID</label>
      <input class="form-input mono" data-field="appid" type="text" placeholder="示例：2019031163548107" value="${Utils.escHtml(getEntryField(entry, 'appId'))}" tabindex="2" />
    </div>
    <div class="form-group">
      <label class="form-label" data-field="password-label">公钥</label>
      <div class="input-affix mono-textarea-wrap">
        <textarea class="form-input mono mono-textarea" data-field="password" rows="3" placeholder="输入公钥" tabindex="3">${Utils.escHtml(getEntryField(entry, 'password'))}</textarea>
        <div class="input-affix-btns">
          <button class="pw-gen-btn" onclick="toggleFieldVisibility('password', this)" title="显示/隐藏" tabindex="-1">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${Utils.SvgIcons.eyeOpenPaths}</svg>
          </button>
          <button class="pw-gen-btn" onclick="copyFieldById('password')" title="复制" tabindex="-1">
            ${Utils.SvgIcons.copy(15)}
          </button>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">私钥</label>
      <div class="input-affix mono-textarea-wrap">
        <textarea class="form-input mono mono-textarea" data-field="private-key" rows="3" placeholder="输入私钥（证书级长度）" tabindex="4">${Utils.escHtml(getEntryField(entry, 'privateKey'))}</textarea>
        <div class="input-affix-btns">
          <button class="pw-gen-btn" onclick="toggleFieldVisibility('private-key', this)" title="显示/隐藏" tabindex="-1">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${Utils.SvgIcons.eyeOpenPaths}</svg>
          </button>
          <button class="pw-gen-btn" onclick="copyFieldById('private-key')" title="复制" tabindex="-1">
            ${Utils.SvgIcons.copy(15)}
          </button>
        </div>
      </div>
    </div>`;
}

/**
 * 构建 other 类型字段
 */
function buildOtherFields(entry) {
  return `
    <div class="form-group">
      <label class="form-label">凭证名称</label>
      <input class="form-input" data-field="username" type="text" placeholder="示例：API 密钥 / 许可证 / 证书 / 授权码" value="${Utils.escHtml(getEntryField(entry, 'username'))}" tabindex="2" />
    </div>
    <div class="form-group">
      <label class="form-label" data-field="password-label">凭证值 <span class="text-danger">*</span></label>
      <div class="input-affix">
        <input class="form-input mono" data-field="password" type="password" placeholder="输入凭证值" value="${Utils.escHtml(getEntryField(entry, 'password'))}" tabindex="3" />
        <div class="input-affix-btns">
          <button class="pw-gen-btn" onclick="toggleEntryPwVisibility()" title="显示/隐藏" tabindex="-1">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" data-field="password-eye">${Utils.SvgIcons.eyeOpenPaths}</svg>
          </button>
        </div>
      </div>
    </div>`;
}

/**
 * 切换指定 input 的密码可见性（用于 server/app 的多个密码字段）
 */
function toggleFieldVisibility(inputId, btnEl) {
  // 从当前激活的表单里找输入框（字段已统一 data-field 命名，回退兼容旧 id）
  const form = document.getElementById(`form-${currentEntryType}`);
  const input = form?.querySelector(`[data-field="${inputId}"]`) || document.getElementById(inputId);
  if (!input) return;
  const isTextarea = input.tagName === 'TEXTAREA';

  if (isTextarea) {
    // textarea：掩码时用 · 替换换行符（保留原始内容用于保存）
    const isMasked = input.dataset.masked === '1';
    if (isMasked) {
      // 恢复：直接还原原始值（之前已保存）
      input.value = input._plainValue || '';
      delete input.dataset.masked;
    } else {
      // 掩码：保存原始值，每行替换为 ·（保持行数结构）
      input._plainValue = input.value;
      input.value = input.value
        .split('\n')
        .map(line => '·'.repeat(Math.max(8, line.length)))
        .join('\n');
      input.dataset.masked = '1';
    }
  } else {
    // 普通 input[type=password] 直接切换 type
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  // 更新眼睛图标
  const eye = btnEl ? btnEl.querySelector('svg') : null;
  if (!eye) return;
  if (isTextarea) {
    eye.innerHTML = input.dataset.masked === '1'
      ? Utils.SvgIcons.eyeClosedPaths
      : Utils.SvgIcons.eyeOpenPaths;
  } else {
    eye.innerHTML = input.type === 'password'
      ? Utils.SvgIcons.eyeOpenPaths
      : Utils.SvgIcons.eyeClosedPaths;
  }
}

/**
 * 通过 input ID 复制字段值
 */
function copyFieldById(fieldName) {
  // 字段已统一为 data-field 命名，回退兼容旧 id
  const form = document.getElementById(`form-${currentEntryType}`);
  const el = form?.querySelector(`[data-field="${fieldName}"]`) || document.getElementById(fieldName);
  const val = el?.value;
  if (val) copyField(val);
}

/**
 * 切换密码输入框可见性
 */
function toggleEntryPwVisibility() {
  // 从当前激活的表单里找密码框（避免 ID 冲突）
  const form = document.getElementById(`form-${currentEntryType}`);
  const input = form?.querySelector('[data-field="password"]');
  if (!input) return;
  
  input.type = input.type === 'password' ? 'text' : 'password';
  
  // 更新眼睛图标（优先从当前表单找）
  const eye = form?.querySelector('[data-field="password-eye"]');
  if (eye) {
    eye.innerHTML = input.type === 'password'
      ? Utils.SvgIcons.eyeOpenPaths
      : Utils.SvgIcons.eyeClosedPaths;
  }
}

/**
 * 切换密码生成器面板
 */
function toggleGenPanel() {
  // 从当前激活的表单里找 gen-panel（避免 ID 冲突）
  const form = document.getElementById(`form-${currentEntryType}`);
  const panel = form?.querySelector('#gen-panel') || document.getElementById('gen-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    generateNewPassword();
  }
}

/**
 * 渲染密码生成器面板
 */
function renderGenPanel() {
  return `
    <div class="pw-gen-preview">
      <span class="pw-gen-preview-text" data-field="gen-preview-text">点击生成</span>
      <button class="btn-icon" style="width:26px;height:26px;flex-shrink:0" onclick="generateNewPassword()" title="重新生成" tabindex="-1">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      </button>
    </div>
    <div class="pw-gen-controls">
      <div class="pw-gen-row">
        <label>长度</label>
        <input type="range" data-field="gen-length" min="8" max="64" value="16" oninput="setGenLengthValue(this)" tabindex="-1" />
        <span data-field="gen-len-val">16</span>
      </div>
      <div class="pw-gen-charsets">
        <label class="charset-label"><input type="checkbox" data-field="gen-upper" checked onchange="generateNewPassword()" tabindex="-1" /> 大写字母 (A-Z)</label>
        <label class="charset-label"><input type="checkbox" data-field="gen-lower" checked onchange="generateNewPassword()" tabindex="-1" /> 小写字母 (a-z)</label>
        <label class="charset-label"><input type="checkbox" data-field="gen-number" checked onchange="generateNewPassword()" tabindex="-1" /> 数字 (0-9)</label>
        <label class="charset-label"><input type="checkbox" data-field="gen-symbol" checked onchange="generateNewPassword()" tabindex="-1" /> 符号 (!@#$…)</label>
      </div>
      <div class="pw-gen-row" style="gap:8px;margin-top:4px">
        <label class="charset-label" style="min-width:auto"><input type="checkbox" data-field="gen-noambig" onchange="generateNewPassword()" tabindex="-1" /> 排除歧义字符</label>
      </div>
      <div data-field="gen-strength-container">
        <div class="pw-strength-bar-bg">
          <div class="pw-strength-bar" data-field="gen-strength-bar" style="width:0%"></div>
        </div>
        <div class="pw-strength-text" data-field="gen-strength-text"></div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="useGeneratedPassword()" tabindex="-1">
        ${Utils.SvgIcons.check(13)}
        使用此密码
      </button>
    </div>
  `;
}

/**
 * 生成新密码
 */
function generateNewPassword() {
  const length = parseInt(document.getElementById('gen-length')?.value || 16);
  const upper = document.getElementById('gen-upper')?.checked;
  const lower = document.getElementById('gen-lower')?.checked;
  const number = document.getElementById('gen-number')?.checked;
  const symbol = document.getElementById('gen-symbol')?.checked;
  const noAmbig = document.getElementById('gen-noambig')?.checked;
  
  const password = PasswordGenerator.generatePassword({
    length,
    uppercase: upper,
    lowercase: lower,
    numbers: number,
    symbols: symbol,
    noAmbiguous: noAmbig
  });
  
  const preview = document.getElementById('gen-preview-text');
  if (preview) preview.textContent = password;
  
  // 更新强度显示
  const info = PasswordGenerator.calcStrength(password);
  const bar = document.getElementById('gen-strength-bar');
  const text = document.getElementById('gen-strength-text');
  
  if (bar) {
    bar.style.width = info.pct + '%';
    bar.style.background = info.color;
  }
  if (text) {
    text.textContent = `${info.label} · ${info.entropy.toFixed(0)} 位熵`;
  }
  
  return password;
}

/**
 * 使用生成的密码
 */
function useGeneratedPassword() {
  const preview = document.getElementById('gen-preview-text');
  if (!preview || preview.textContent === '点击生成') return;
  
  const password = preview.textContent;
  // 从当前激活的表单里找密码输入框（避免多表单 DOM 冲突）
  const form = document.getElementById(`form-${currentEntryType}`);
  const input = form?.querySelector('[data-field="password"]');
  if (!input) return;
  
  input.value = password;
  input.type = 'text';
  
  // 更新眼睛图标（优先从当前表单找）
  const eye = form?.querySelector('[data-field="password-eye"]');
  if (eye) {
    eye.innerHTML = Utils.SvgIcons.eyeClosedPaths;
  }
  
  updateStrengthBar();
  toggleGenPanel();
}

/**
 * 为指定输入框生成密码
 */
function generatePasswordFor(field) {
  // 从当前激活的表单里找输入框（避免 ID 冲突）
  const form = document.getElementById(`form-${currentEntryType}`);
  const input = form?.querySelector(`[data-field="${field}"]`);
  if (!input) return;
  
  // 使用默认配置生成密码
  const config = { length: 16, uppercase: true, lowercase: true, numbers: true, symbols: true };
  const password = PasswordGenerator.generatePassword(config);
  
  input.value = password;
  input.type = 'text'; // 生成后显示明文方便查看
  
  // 更新眼睛图标为"睁眼"状态
  const btn = input.closest('.input-affix')?.querySelector('.input-affix-btns button');
  if (btn) {
    const eye = btn.querySelector('svg');
    if (eye) {
      eye.innerHTML = Utils.SvgIcons.eyeClosedPaths;
    }
  }
  
  Utils.showToast('密码已生成', 'success');
}

/**
 * 更新密码强度条
 */
function updateStrengthBar() {
  // 从当前激活的表单里找 e-password（避免 ID 冲突）
  const form = document.getElementById(`form-${currentEntryType}`);
  const password = form?.querySelector('[data-field="password"]')?.value || '';
  const container = form?.querySelector('[data-field="strength-container"]');
  const bar = form?.querySelector('[data-field="strength-bar"]');
  const text = form?.querySelector('[data-field="strength-text"]');
  
  if (!container || !bar || !text) return;
  
  if (!password) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'block';
  
  const info = PasswordGenerator.calcStrength(password);
  bar.style.width = info.pct + '%';
  bar.style.background = info.color;
  text.textContent = `${info.label} · ${info.entropy.toFixed(0)} 位熵`;
}

/**
 * 保存条目（支持 5 种 entryType）
 */
async function saveEntry() {
  const title = document.getElementById('e-title')?.value.trim();
  const notes = document.getElementById('e-notes')?.value.trim();
  const tags = getSelectedTags();
  const type = currentEntryType;

  if (!title) {
    Utils.showToast('请输入标题', 'error');
    return;
  }

  // 从当前激活的表单容器读取字段（表单字段已统一为 data-field 命名，回退兼容旧 id）
  const form = document.getElementById(`form-${type}`);
  const $ = (name) => form?.querySelector(`[data-field="${name}"]`) || document.getElementById(name);

  // 按类型收集字段
  const username = $('username')?.value.trim() || '';
  // app 类型的公钥输入框可能处于掩码态，先还原再取值，避免把掩码点保存入库
  // 兼容两种掩码存储：toggleFieldVisibility 存 _plainValue，历史遗留 data 属性也兜底
  const pwField = $('password');
  if (pwField && pwField.dataset.masked === '1') pwField.value = pwField._plainValue || pwField.dataset.plainValue || '';
  const password = pwField?.value || '';
  const url     = $('url')?.value.trim() || '';
  // port：server / database 才有
  const port     = (type === 'server' || type === 'database')
    ? parseInt($('port')?.value, 10) || undefined
    : undefined;

  // 各类型的必要字段验证
  if ((type === 'website' || type === 'server' || type === 'database') && !password) {
    Utils.showToast('请输入密码', 'error');
    return;
  }
  if (type === 'ai' && !password) {
    Utils.showToast('请输入 Token', 'error');
    return;
  }
  if (type === 'other' && !password) {
    Utils.showToast('请输入凭证值', 'error');
    return;
  }

  const now = new Date().toISOString();

  if (editingEntryId) {
    const entry = App.state.entries.find(e => e.id === editingEntryId);
    if (entry) {
      Object.assign(entry, {
        title,
        entryType: type,
        username,
        password,
        url,
        port,
        tags,
        notes,
        updatedAt: now,
      });
      // database: 单独存储 port
      if (type === 'database') {
        entry.port = port;
      }
      // server: 更新 root 字段
      if (type === 'server') {
        entry.root = {
          username: $('root-user')?.value.trim() || '',
          password: $('root-pwd')?.value || '',
        };
      }
      // app: 更新 appId / privateKey（textarea 可能处于掩码态，需先还原）
      if (type === 'app') {
        entry.appId = $('appid')?.value.trim() || '';
        const pkEl = $('private-key');
        if (pkEl) {
          if (pkEl.dataset.masked === '1') pkEl.value = pkEl._plainValue || '';
          entry.privateKey = pkEl.value || '';
        }
      }
    }
  } else {
    const base = {
      id: CryptoUtils.uuid(),
      title,
      entryType: type,
      username,
      password,
      url,
      port,
      tags,
      notes,
      favorite: false,
      showPassword: false,
      createdAt: now,
      updatedAt: now,
      lastCopied: null,
    };
    if (type === 'database') {
      base.port = port;
    }
    if (type === 'server') {
      base.root = {
        username: $('root-user')?.value.trim() || '',
        password: $('root-pwd')?.value || '',
      };
    }
    if (type === 'app') {
      base.appId = $('appid')?.value.trim() || '';
      const pkEl = $('private-key');
      if (pkEl) {
        if (pkEl.dataset.masked === '1') pkEl.value = pkEl._plainValue || '';
        base.privateKey = pkEl.value || '';
      }
    }
    App.state.entries.push(base);
  }
  
  await App.saveVault();
  clearFormCache(editingEntryId); // 保存成功后清除缓存
  App.closeModal();
  UI.renderEntries();
  UI.renderSidebar();
  
  // 更新详情面板
  if (App.state.selectedEntry) {
    const updated = App.state.entries.find(e => e.id === App.state.selectedEntry);
    if (updated) {
      Entries.renderDetailPanel(updated);
    }
  }
  
  Utils.showToast(editingEntryId ? '密码已更新' : '密码已添加', 'success');
  editingEntryId = null;
}

/**
 * 常用/热门标签预设
 */
/**
 * 初始化标签选择器
 */
function initTagSelector(selectedTags = []) {
  const selector = document.getElementById('tag-selector');
  const inputWrapper = selector.querySelector('.tag-input-wrapper');
  const input = document.getElementById('e-tag-input');
  
  // 统一标签注册表 tagDefs 即推荐来源（含默认标签与用户已创建标签）
  const suggestedTags = Object.keys(App.state.tagDefs || {});
  
  // 渲染已选标签
  selectedTags.forEach(tag => {
    const tagEl = createSelectedTagElement(tag);
    selector.insertBefore(tagEl, inputWrapper);
  });
  
  // 渲染推荐标签区域（基于实时已选状态）
  renderTagSuggestions();
}

/**
 * 渲染推荐标签区域
 */
function renderTagSuggestions() {
  // 移除旧的推荐区域
  const oldSection = document.getElementById('tag-suggestions');
  if (oldSection) oldSection.remove();
  
  const selector = document.getElementById('tag-selector');
  const inputWrapper = selector.querySelector('.tag-input-wrapper');
  const tagDefs = App.state.tagDefs || {};
  const selected = getSelectedTags();
  
  // 推荐标签 = 注册表中尚未选中的标签
  const available = Object.keys(tagDefs).filter(t => !selected.includes(t));
  if (available.length === 0) return;
  
  // 创建推荐区域
  const section = document.createElement('div');
  section.id = 'tag-suggestions';
  section.className = 'tag-suggestions';
  section.innerHTML = ``;
  
  available.forEach(name => {
    const def = tagDefs[name] || { color: '#8b949e', icon: 'other' };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-option';
    btn.dataset.tag = name;
    btn.innerHTML = `${Utils.getCategoryIcon(def.icon, def.color)}<span>${Utils.escHtml(name)}</span>`;
    btn.onclick = (e) => {
      e.preventDefault();
      addTag(name);
    };
    section.appendChild(btn);
  });
  
  selector.insertBefore(section, inputWrapper);
}

/**
 * 创建已选标签元素
 */
function createSelectedTagElement(tag) {
  const el = document.createElement('span');
  el.className = 'selected-tag';
  el.dataset.tag = tag;
  const def = Utils.getTagDef(App.state.tagDefs, tag);
  el.innerHTML = `
    ${Utils.getCategoryIcon(def.icon, def.color)}<span class="selected-tag-name">${Utils.escHtml(tag)}</span>
    <span class="remove-tag">
      ${Utils.SvgIcons.close(12)}
    </span>
  `;
  el.onclick = () => removeTag(tag);
  return el;
}

/**
 * 处理标签输入
 */
function handleTagInput(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    const input = document.getElementById('e-tag-input');
    const tag = input.value.trim();
    
    if (tag && !isTagSelected(tag)) {
      addTag(tag);
    }
    input.value = '';
  }
}

/**
 * 添加标签
 */
function addTag(tag) {
  if (!tag) return;
  const selector = document.getElementById('tag-selector');
  const inputWrapper = selector.querySelector('.tag-input-wrapper');
  
  // 新增标签：分配随机颜色/图标并落盘，避免重复
  if (!App.state.tagDefs) App.state.tagDefs = {};
  if (!App.state.tagDefs[tag]) {
    const attrs = Utils.getRandomTagAttrs(App.state.tagDefs);
    App.state.tagDefs[tag] = { color: attrs.color, icon: attrs.icon, isDefault: false };
    if (typeof App.saveVault === 'function') App.saveVault();
  }
  
  if (!isTagSelected(tag)) {
    const tagEl = createSelectedTagElement(tag);
    selector.insertBefore(tagEl, inputWrapper);
  }
  // 重新渲染推荐区：已选标签自动从推荐消失；删除后重新可选中（修复二次选中 bug）
  renderTagSuggestions();
}

/**
 * 移除标签
 */
function removeTag(tag) {
  const selector = document.getElementById('tag-selector');
  // 仅匹配已选中的 chip（推荐按钮也带 data-tag，需限定 .selected-tag）
  const tagEl = selector.querySelector(`.selected-tag[data-tag="${CSS.escape(tag)}"]`);
  if (tagEl) {
    tagEl.remove();
  }
  // 重新渲染推荐区：被移除的标签重新进入推荐列表，可再次选中（修复二次选中 bug）
  renderTagSuggestions();
}

/**
 * 检查标签是否已选中
 */
function isTagSelected(tag) {
  const selector = document.getElementById('tag-selector');
  // 仅匹配已选中的 chip（推荐按钮也带 data-tag，需限定 .selected-tag）
  return !!selector.querySelector(`.selected-tag[data-tag="${CSS.escape(tag)}"]`);
}

/**
 * 获取已选标签列表
 */
function getSelectedTags() {
  const selector = document.getElementById('tag-selector');
  const tags = [];
  selector.querySelectorAll('.selected-tag').forEach(el => {
    tags.push(el.dataset.tag);
  });
  return tags;
}

/**
 * 更新标签建议（预留，可后续实现下拉建议）
 */
function updateTagSuggestions() {
  // 预留：可根据输入内容显示已有标签建议
}

// 导出模块
window.EntryEditor = {
  openEntryModal,
  cancelEntryModal,
  switchEntryType,
  toggleEntryPwVisibility,
  toggleFieldVisibility,
  toggleGenPanel,
  generateNewPassword,
  useGeneratedPassword,
  generatePasswordFor,
  updateStrengthBar,
  saveEntry,
};
