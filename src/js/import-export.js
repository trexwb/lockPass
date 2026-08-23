/* ═══════════════════════════════════════════════════════════════════
   LockPass — 导入导出模块
   ═══════════════════════════════════════════════════════════════════ */

let importType = null;
let importData = null;

/**
 * 打开导出模态框
 */
function openExportModal() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-header">
      <h2>导出密码库</h2>
      <button class="btn-icon" onclick="App.closeModal()" tabindex="-1">
        ${Utils.SvgIcons.close(16)}
      </button>
    </div>
    <div class="modal-body">
      <p class="mb-4 text-muted">选择导出格式：</p>
      <div class="export-options">
        <div class="export-option" onclick="exportVault()" tabindex="1" role="button">
          <div class="export-option-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div class="export-option-info">
            <h4>加密备份 (.vault)</h4>
            <p>AES-256 加密，可安全传输和存储</p>
          </div>
        </div>
        <div class="export-option" onclick="exportCSV()" tabindex="2" role="button">
          <div class="export-option-icon text-warning">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </div>
          <div class="export-option-info">
            <h4>明文 CSV</h4>
            <p>⚠️ 未加密，仅用于迁移到其他应用</p>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="App.closeModal()" tabindex="3">取消</button>
    </div>
  `;
  App.openModal();
}

/**
 * 导出加密备份
 */
async function exportVault() {
  const modal = document.getElementById('modal');
  modal.querySelector('.modal-body').innerHTML = `
    <div class="spinner-wrap">
      <div class="spinner mx-auto mb-4"></div>
      <div>正在加密并导出…</div>
    </div>
  `;
  modal.querySelector('.modal-footer').innerHTML = '';

  try {
    const now = new Date();
    const dateStr = Utils.formatDateFilename(now);

    const { iv, data } = await CryptoUtils.encrypt(
    {
      entries: App.state.entries,
      tagDefs: App.state.tagDefs,
      tags: App.state.tags
    },
    App.state.cryptoKey
  );
  
  const saltRecord = await DBUtils.dbGet(DBUtils.STORE_META, 'salt');
  const iterRecord = await DBUtils.dbGet(DBUtils.STORE_META, 'iterations');
  
  const exportData = {
    version: 1,
    exportedAt: now.toISOString(),
    format: 'encrypted',
    salt: saltRecord.value,
    iterations: iterRecord ? (Number(iterRecord.value) || 100000) : 100000,
    iv,
    data,
    tagDefs: App.state.tagDefs
  };
  
    const ok = await Utils.downloadFile(
      `LockPass-备份-${dateStr}.vault`,
      JSON.stringify(exportData, null, 2),
      'application/json'
    );
    if (!ok) { App.closeModal(); return; }

    Utils.showToast('密码库已导出', 'success');
  } finally {
    App.closeModal();
  }
}

/**
 * 导出 CSV
 */
async function exportCSV() {
  const confirmed = await Utils.confirm({
    title: '导出 CSV',
    message: '⚠️ CSV 文件为明文格式，包含所有密码！\n\n请确保导出后妥善保管该文件，使用后立即删除。\n\n是否继续？',
    confirmText: '继续导出',
    danger: true
  });
  if (!confirmed) return;

  const modal = document.getElementById('modal');
  modal.querySelector('.modal-body').innerHTML = `
    <div class="spinner-wrap">
      <div class="spinner mx-auto mb-4"></div>
      <div>正在生成 CSV 文件…</div>
    </div>
  `;
  modal.querySelector('.modal-footer').innerHTML = '';

  try {
    // 含 entryType + 各类型专有字段；未使用的字段留空
    const headers = [
      'entryType', 'title',
      'username', 'password', 'url', 'port',
      'rootUsername', 'rootPassword',   // server
      'appId',                             // app
      'privateKey',                        // app
      'tags', 'notes'
    ];
    const rows = [headers.join(',')];

    App.state.entries.forEach(entry => {
      const type = entry.entryType || 'website';
      const root = entry.root || {};
      rows.push([
        type,
        `"${(entry.title || '').replace(/"/g, '""')}"`,
        `"${(entry.username || '').replace(/"/g, '""')}"`,
        `"${(entry.password || '').replace(/"/g, '""')}"`,
        `"${(entry.url || '').replace(/"/g, '""')}"`,
        (type === 'server' || type === 'database') && entry.port != null ? entry.port : '""',
        type === 'server' ? `"${(root.username || '').replace(/"/g, '""')}"` : '""',
        type === 'server' ? `"${(root.password || '').replace(/"/g, '""')}"` : '""',
        type === 'app' ? `"${(entry.appId || '').replace(/"/g, '""')}"` : '""',
        type === 'app' ? `"${(entry.privateKey || '').replace(/"/g, '""')}"` : '""',
        `"${(entry.tags || []).join(';').replace(/"/g, '""')}"`,
        `"${(entry.notes || '').replace(/"/g, '""')}"`
      ].join(','));
    });

    const dateStr = Utils.formatDateFilename(new Date());
    const ok = await Utils.downloadFile(
      `LockPass-备份-${dateStr}.csv`,
      rows.join('\n'),
      'text/csv'
    );
    if (!ok) { App.closeModal(); return; }

    Utils.showToast('CSV 文件已导出，请妥善保管', 'warning');
  } finally {
    App.closeModal();
  }
}

/**
 * 打开导入模态框
 */
function openImportModal() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-header">
      <h2>导入密码</h2>
      <button class="btn-icon" onclick="App.closeModal()" tabindex="-1">
        ${Utils.SvgIcons.close(16)}
      </button>
    </div>
    <div class="modal-body">
      <div class="file-drop" id="file-drop" onclick="document.getElementById('import-file').click()" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="handleFileDrop(event)" tabindex="1" role="button">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto mb-3">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <div>拖拽文件到这里，或点击选择文件</div>
        <div class="text-muted text-sm mt-1">支持 .vault (加密) 或 .csv (明文)</div>
        <!-- accept 追加通用 MIME：iOS 文件选择器按 UTI 匹配，.vault/.csv 等自定义扩展名无对应 UTI 会显示灰色不可选，application/octet-stream / text/csv 可放开 -->
        <input type="file" id="import-file" accept=".vault,.json,.csv,application/octet-stream,application/json,text/csv" onchange="handleFileSelect(event)" />
      </div>
      <div id="import-preview" class="hidden mt-4">
        <div class="divider"></div>
        <div id="import-preview-content"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="App.closeModal()" tabindex="1">取消</button>
      <button class="btn btn-primary" id="import-confirm-btn" onclick="confirmImport()" disabled tabindex="2">
        ${Utils.SvgIcons.check(14)}
        导入
      </button>
    </div>
    <div id="import-progress" class="hidden content-pad">
      <div class="progress-bar">
        <div class="progress-fill" id="import-progress-fill" style="width:0%"></div>
      </div>
      <div class="text-sm text-muted mt-1" id="import-progress-text">正在导入…</div>
      <button class="btn btn-secondary btn-sm mt-2 align-self-end" id="import-cancel-btn" onclick="cancelImport()">取消</button>
    </div>
  `;
  App.openModal();
}

/**
 * 处理文件拖放
 */
function handleFileDrop(event) {
  event.preventDefault();
  event.target.classList.remove('dragover');
  
  const file = event.dataTransfer.files[0];
  if (file) processFile(file);
}

/**
 * 处理文件选择
 */
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) processFile(file);
}

/**
 * 处理文件
 */
async function processFile(file) {
  const name = file.name.toLowerCase();
  
  if (name.endsWith('.csv')) {
    importType = 'csv';
    const text = await file.text();
    previewCSV(text);
  } else if (name.endsWith('.vault') || name.endsWith('.json')) {
    importType = 'vault';
    const text = await file.text();
    previewVault(text);
  } else {
    Utils.showToast('不支持的文件格式', 'error');
    return;
  }
}

/**
 * 预览 CSV
 */
function previewCSV(text) {
  const lines = Utils.splitCSVLines(text);
  if (lines.length < 2) {
    Utils.showToast('CSV 文件为空或格式错误', 'error');
    return;
  }
  
  const headerLine = lines[0];
  const headers = Utils.parseCSVLine(headerLine);
  const count = lines.length - 1;
  
  document.getElementById('import-preview').classList.remove('hidden');
  document.getElementById('import-preview-content').innerHTML = `
    <div class="text-sm"><strong>CSV 文件</strong></div>
    <div class="text-muted text-sm mt-1">共 ${count} 条记录（不含表头） · 字段：${Utils.escHtml(headers.join(', '))}</div>
    <div class="text-warning text-sm mt-2">⚠️ CSV 为明文格式；累加模式；重复条目将逐条询问；点「确认」开始导入</div>
  `;
  
  importData = text;
  document.getElementById('import-confirm-btn').disabled = false;
}

/**
 * 预览加密备份
 */
function previewVault(text) {
  try {
    const data = JSON.parse(text);
    
    // 判断是加密格式还是明文格式
    if (data.format === 'encrypted' && data.data) {
      // 加密格式：需要主密码解密
      document.getElementById('import-preview').classList.remove('hidden');
      document.getElementById('import-preview-content').innerHTML = `
        <div class="text-sm"><strong>加密备份文件</strong></div>
        <div class="text-muted text-sm mt-1">导出时间：${Utils.escHtml(data.exportedAt || '未知')}</div>
        <div class="text-muted text-sm">需要主密码才能解密导入；导入采用合并模式，与现有数据冲突的条目将作为新数据添加</div>
        <div class="form-group mt-2 mb-0">
          <input class="form-input" id="import-password" type="password" placeholder="输入主密码解密" tabindex="2" />
        </div>
      `;
      importData = { ...data, type: 'encrypted-vault' };
    } else if (data.entries) {
      // 明文格式（兼容旧版）
      const count = (data.entries || []).length;
      document.getElementById('import-preview').classList.remove('hidden');
      document.getElementById('import-preview-content').innerHTML = `
        <div class="text-sm"><strong>明文备份文件</strong></div>
        <div class="text-muted text-sm mt-1">包含 ${count} 条密码记录</div>
        <div class="text-warning text-sm">⚠️ 此文件包含明文密码，请妥善保管；导入采用合并模式，与现有数据冲突的条目将作为新数据添加</div>
      `;
      importData = { ...data, type: 'plaintext-vault' };
    } else {
      Utils.showToast('不支持的文件格式', 'error');
      return;
    }
    
    document.getElementById('import-confirm-btn').disabled = false;
  } catch {
    Utils.showToast('文件格式错误', 'error');
  }
}

/**
 * 确认导入
 */

// ── 批量导入取消机制 ──────────────────────────────────────────────
let _importCancelled = false;
function cancelImport() {
  _importCancelled = true;
  const cancelBtn = document.getElementById('import-cancel-btn');
  if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.textContent = '取消中…'; }
}

async function confirmImport() {
  if (!importData) return;

  _importCancelled = false;
  const cancelBtn = document.getElementById('import-cancel-btn');
  if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.textContent = '取消'; }

  document.getElementById('import-preview').classList.add('hidden');
  document.getElementById('import-progress').classList.remove('hidden');
  
  try {
    if (importType === 'csv') {
      await importCSV(importData);
    } else if (importType === 'vault') {
      if (importData.type === 'encrypted-vault') {
        await importEncryptedVault(importData);
      } else {
        await importPlaintextVault(importData);
      }
    }
  } catch (e) {
    document.getElementById('import-progress').classList.add('hidden');
    document.getElementById('import-preview').classList.remove('hidden');
    Utils.showToast('导入失败：' + e.message, 'error');
  }
}

/**
 * 查找相同条目（标题 + 用户名），与 QR._findDuplicate 保持一致风格
 * @param {string} title - 标题
 * @param {string} username - 用户名
 * @returns {Object|undefined} 已存在的条目
 */
function findDuplicateByTitleUser(title, username) {
  return App.state.entries.find(e =>
    (e.title || '') === (title || '') &&
    (e.username || '') === (username || '')
  );
}

/**
 * 导入 CSV（累加模式：不清空、不重建现有数据）
 * 每条记录按「标题 + 用户名」查重；重复时询问替换/跳过：
 *  - 替换：用新数据覆盖原条目字段，保留原 id 与 createdAt
 *  - 跳过：忽略该行
 */
async function importCSV(text) {
  const lines = Utils.splitCSVLines(text);
  const headerLine = lines[0];
  const headers = Utils.parseCSVLine(headerLine).map(h => h.toLowerCase().trim());

  const titleIdx = headers.indexOf('title');
  const usernameIdx = headers.indexOf('username');
  const passwordIdx = headers.indexOf('password');
  const urlIdx = headers.indexOf('url');
  const entryTypeIdx = headers.indexOf('entrytype');
  const categoryIdx = headers.indexOf('category');
  const tagsIdx = headers.indexOf('tags');
  const notesIdx = headers.indexOf('notes');
  // server 字段
  const rootUserIdx = headers.indexOf('rootusername');
  const rootPwdIdx = headers.indexOf('rootpassword');
  // app 字段
  const appIdIdx = headers.indexOf('appid');
  const privateKeyIdx = headers.indexOf('privatekey');
  // server / database 字段
  const portIdx = headers.indexOf('port');

  if (titleIdx === -1 || passwordIdx === -1) {
    throw new Error('CSV 必须包含 title 和 password 列');
  }

  let added = 0;
  let replaced = 0;
  let skipped = 0;
  let emptySkipped = 0;
  const rows = lines.slice(1);

  for (let i = 0; i < rows.length; i++) {
    const cols = Utils.parseCSVLine(rows[i]);
    const title = cols[titleIdx];
    const password = cols[passwordIdx];

    if (!title && !password) { emptySkipped++; continue; }
    if (!title || !password) { emptySkipped++; continue; }

    const now = new Date().toISOString();
    const entryType = entryTypeIdx !== -1 ? (cols[entryTypeIdx] || '').trim().toLowerCase() : 'website';

    // 兼容旧 CSV：category 列并入 tags
    const csvTags = [];
    if (categoryIdx !== -1 && cols[categoryIdx]) {
      const c = cols[categoryIdx].trim();
      if (c) csvTags.push(c);
    }
    if (tagsIdx !== -1 && cols[tagsIdx]) {
      cols[tagsIdx].split(';').forEach(t => {
        const s = t.trim();
        if (s && !csvTags.includes(s)) csvTags.push(s);
      });
    }

    const username = usernameIdx !== -1 ? (cols[usernameIdx] || '').trim() : '';

    const fields = {
      title,
      entryType,
      password,
      username,
      url: urlIdx !== -1 ? (cols[urlIdx] || '').trim() : '',
      notes: notesIdx !== -1 ? (cols[notesIdx] || '').trim() : '',
      tags: csvTags,
    };

    // server / database：携带 port
    if ((entryType === 'server' || entryType === 'database') && portIdx !== -1) {
      const p = parseInt(cols[portIdx], 10);
      if (!isNaN(p)) fields.port = p;
    }

    // server 类型：携带 root 账号/密码
    if (entryType === 'server') {
      if (rootUserIdx !== -1 || rootPwdIdx !== -1) {
        fields.root = {
          username: rootUserIdx !== -1 ? (cols[rootUserIdx] || '').trim() : '',
          password: rootPwdIdx !== -1 ? (cols[rootPwdIdx] || '').trim() : '',
        };
      }
    }

    // app 类型：携带 App ID、私钥
    if (entryType === 'app') {
      if (appIdIdx !== -1) fields.appId = (cols[appIdIdx] || '').trim();
      if (privateKeyIdx !== -1) fields.privateKey = (cols[privateKeyIdx] || '').trim();
    }

    // 标题 + 用户名查重（与二维码导入一致）
    const dup = findDuplicateByTitleUser(title, username);
    if (dup) {
      const dupLabel = `${title || '未命名'}${username ? '（' + username + '）' : ''}`;
      const ok = await Utils.confirm({
        title: '发现重复条目',
        message: `已存在相同条目「${dupLabel}」，是否替换？`,
        confirmText: '替换',
        cancelText: '跳过',
        danger: true
      });
      if (ok) {
        // 替换：新数据覆盖原条目字段，保留原 id 与 createdAt，保留 favorite/showPassword
        Object.keys(fields).forEach(k => {
          dup[k] = fields[k];
        });
        dup.updatedAt = now;
        replaced++;
      } else {
        skipped++;
      }
    } else {
      // 新增：仅在现有数据上累加，不清空不重建
      App.state.entries.push({
        ...fields,
        id: CryptoUtils.uuid(),
        favorite: false,
        showPassword: false,
        createdAt: now,
        updatedAt: now,
      });
      added++;
    }

    if (i % 10 === 0) {
      document.getElementById('import-progress-fill').style.width = Math.round((i / rows.length) * 100) + '%';
      await new Promise(r => setTimeout(r, 0));
      // 支持中途取消
      if (_importCancelled) {
        document.getElementById('import-progress-fill').style.width = '100%';
        document.getElementById('import-progress-text').textContent = `已取消：新增 ${added} 条、替换 ${replaced} 条、跳过 ${skipped} 条（未保存）`;
        await App.saveVault();
        UI.renderEntries();
        UI.renderSidebar();
        setTimeout(() => {
          App.closeModal();
          Utils.showToast(`已取消导入：新增 ${added} 条`, 'warning');
        }, 1200);
        return;
      }
    }
  }

  document.getElementById('import-progress-fill').style.width = '100%';
  const emptyHint = emptySkipped > 0 ? `（含 ${emptySkipped} 条空行已跳过）` : '';
  document.getElementById('import-progress-text').textContent = `导入完成：新增 ${added} 条、替换 ${replaced} 条、跳过 ${skipped} 条${emptyHint}`;

  await App.saveVault();
  UI.renderEntries();
  UI.renderSidebar();

  setTimeout(() => {
    App.closeModal();
    Utils.showToast(`导入完成：新增 ${added} 条、替换 ${replaced} 条、跳过 ${skipped} 条${emptyHint}`, 'success');
  }, 1200);
}

/**
 * 导入加密备份
 */
async function importEncryptedVault(data) {
  const pwInput = document.getElementById('import-password');
  const password = pwInput ? pwInput.value : '';
  
  if (!password) {
    throw new Error('请输入主密码');
  }
  
  try {
    // 使用文件的 salt、iterations 和 iv 解密（兼容性：旧文件无 iterations 字段时默认 100000）
    const salt = CryptoUtils.base64ToArrayBuffer(data.salt);
    const iterations = Number(data.iterations) || 100000;
    const key = await CryptoUtils.deriveKey(password, new Uint8Array(salt), iterations);
    const decrypted = await CryptoUtils.decrypt(data.data, data.iv, key);
    
    let added = 0;
    for (const entry of (decrypted.entries || [])) {
      // 旧 category 字段升级为标签
      const e = { ...entry };
      if (e.category) {
        const cat = (decrypted.categories || []).find(c => c.id === e.category);
        const name = cat ? cat.name : e.category;
        e.tags = (e.tags || []).slice();
        if (!e.tags.includes(name)) e.tags.push(name);
        delete e.category;
      }
      // 合并模式：不跳过冲突，直接作为新条目添加
      App.state.entries.push({
        ...e,
        entryType: e.entryType || 'website',
        id: CryptoUtils.uuid(),
        createdAt: e.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      added++;
    }
    
    // 合并标签注册表（前向兼容：旧 .vault 的 categories 升级为 tagDefs）
    App.state.tagDefs = App.state.tagDefs || {};
    const mergeTagDef = (name, def) => {
      if (!name || App.state.tagDefs[name]) return;
      App.state.tagDefs[name] = def;
    };
    (decrypted.categories || []).forEach(c => {
      mergeTagDef(c.name, { color: c.color, icon: c.icon, isDefault: true });
    });
    if (decrypted.tagDefs) {
      Object.keys(decrypted.tagDefs).forEach(name => mergeTagDef(name, decrypted.tagDefs[name]));
    }
    
    document.getElementById('import-progress-fill').style.width = '100%';
    document.getElementById('import-progress-text').textContent = `成功导入 ${added} 条记录`;
    
    await App.saveVault();
    UI.renderEntries();
    UI.renderSidebar();
    
    setTimeout(() => {
      App.closeModal();
      Utils.showToast(`已导入 ${added} 条密码`, 'success');
    }, 1200);
  } catch (e) {
    throw new Error('密码错误或文件损坏');
  }
}

/**
 * 导入明文备份
 */
async function importPlaintextVault(data) {
  const { entries, categories, tagDefs } = data;
  let added = 0;
  
  for (const entry of (entries || [])) {
    // 合并模式：不跳过冲突，直接作为新条目添加
    App.state.entries.push({
      ...entry,
      entryType: entry.entryType || 'website',
      id: CryptoUtils.uuid(),
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    added++;
  }
  
  // 合并标签注册表（旧明文备份的 categories 升级为 tagDefs）
  App.state.tagDefs = App.state.tagDefs || {};
  const mergeTagDef = (name, def) => {
    if (!name || App.state.tagDefs[name]) return;
    App.state.tagDefs[name] = def;
  };
  if (categories) {
    categories.forEach(c => mergeTagDef(c.name, { color: c.color, icon: c.icon, isDefault: true }));
  }
  if (tagDefs) {
    Object.keys(tagDefs).forEach(name => mergeTagDef(name, tagDefs[name]));
  }
  
  document.getElementById('import-progress-fill').style.width = '100%';
  document.getElementById('import-progress-text').textContent = `成功导入 ${added} 条记录`;
  
  await App.saveVault();
  UI.renderEntries();
  UI.renderSidebar();
  
  setTimeout(() => {
    App.closeModal();
    Utils.showToast(`已导入 ${added} 条密码`, 'success');
  }, 1200);
}

// 导出模块
window.ImportExport = {
  openExportModal,
  exportVault,
  exportCSV,
  openImportModal,
  handleFileDrop,
  handleFileSelect,
  processFile,
  previewCSV,
  previewVault,
  confirmImport,
  importCSV,
  importEncryptedVault,
  importPlaintextVault
};
