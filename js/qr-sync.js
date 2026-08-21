/* ═══════════════════════════════════════════════════════════════════
   LockPass — 二维码同步模块
   单条密码通过二维码跨设备传输：
   - 生成：条目 JSON → AES-256-GCM 加密(主密码派生密钥+随机salt/IV) → base64 → 二维码
   - 识别：上传二维码图片 / 直接粘贴图片 → jsQR 解码 → 主密码解密 → 导入
   二维码内容格式前缀：LockPass-QR v1
   硬约束：数据不落网、无 HTTP 服务、纯本地离线运行（依赖 assets/vendor 本地库）
   ═══════════════════════════════════════════════════════════════════ */

const QR_FORMAT = 'LockPass-QR v1';
const QR_VERSION = 1;

/**
 * Vendor 库按需懒加载器
 * 首次调用时动态注入 <script>，后续命中缓存直接 resolve
 * @param {string} src - 脚本路径
 * @param {Function} check - 检测全局变量是否就绪
 * @returns {Promise<void>}
 */
const _vendorCache = {};
function _loadVendor(src, check) {
  if (check()) return Promise.resolve();
  if (_vendorCache[src]) return _vendorCache[src];
  _vendorCache[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => {
      if (check()) resolve();
      else reject(new Error('库加载完成但未就绪：' + src));
    };
    s.onerror = () => reject(new Error('库加载失败：' + src));
    document.head.appendChild(s);
  });
  return _vendorCache[src];
}

/** 懒加载 jsQR（二维码识别） */
function _ensureJsQR() {
  return _loadVendor('assets/vendor/jsQR.js?v=1.1.2', () => typeof jsQR === 'function');
}

/** 懒加载 qrcode.min.js（二维码生成） */
function _ensureQRCode() {
  return _loadVendor('assets/vendor/qrcode.min.js?v=1.1.2', () => typeof QRCode === 'function');
}

const QR = {

  /* ─────────────────────────────────────────────────────────────
     核心编解码
     ───────────────────────────────────────────────────────────── */

  /**
   * 将单条条目加密为二维码文本
   * @param {Object} entry - 密码条目
   * @param {string} masterPassword - 用户主密码
   * @returns {Promise<string>} 二维码文本（JSON）
   */
  async entryToQrString(entry, masterPassword) {
    const salt = CryptoUtils.generateSalt();
    const key = await CryptoUtils.deriveKey(masterPassword, salt);

    // 携带跨设备必要字段；统一标签模型仅携带 tags，不再携带 category
    const payload = {
      title: entry.title || '',
      username: entry.username || '',
      password: entry.password || '',
      url: entry.url || '',
      notes: entry.notes || '',
      // 统一标签模型：仅携带 tags
      tags: entry.tags || [],
      // 条目类型（6 种凭证类型）
      entryType: entry.entryType || 'website',
      // server / database 端口
      port: entry.port != null ? entry.port : undefined,
      // server 特有字段
      root: entry.root || null,
      // app 特有字段
      appId: entry.appId || '',
      privateKey: entry.privateKey || '',
    };

    const { iv, data } = await CryptoUtils.encrypt(payload, key);
    return JSON.stringify({
      format: QR_FORMAT,
      v: QR_VERSION,
      salt: CryptoUtils.arrayBufferToBase64(salt),
      iv,
      data
    });
  },

  /**
   * 从二维码文本解密出条目
   * @param {string} qrText - 二维码文本
   * @param {string} masterPassword - 用户主密码
   * @returns {Promise<Object>} 解密后的条目数据
   */
  async qrStringToEntry(qrText, masterPassword) {
    let obj;
    try {
      obj = JSON.parse(String(qrText).trim());
    } catch (e) {
      throw new Error('不是有效的 LockPass 二维码内容');
    }
    if (!obj || obj.format !== QR_FORMAT) {
      throw new Error('不是 LockPass 二维码');
    }
    if (!obj.salt || !obj.iv || !obj.data) {
      throw new Error('二维码内容不完整');
    }
    try {
      const salt = CryptoUtils.base64ToArrayBuffer(obj.salt);
      const key = await CryptoUtils.deriveKey(masterPassword, new Uint8Array(salt));
      return await CryptoUtils.decrypt(obj.data, obj.iv, key);
    } catch (e) {
      throw new Error('主密码错误或二维码已损坏');
    }
  },

  /**
   * 从图片文件 / Blob 中解码二维码文本
   * @param {File|Blob} file - 图片文件
   * @returns {Promise<string>} 解码出的二维码文本
   */
  async decodeImageFile(file) {
    await _ensureJsQR();
    return new Promise((resolve, reject) => {
      if (typeof jsQR !== 'function') {
        reject(new Error('二维码解码库加载失败'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            // 限制最大尺寸，提升解码性能；按比例缩放
            const MAX = 1024;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // 优先快速识别，失败后尝试反色识别
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert'
            });
            if (code && code.data) {
              resolve(code.data);
              return;
            }
            const codeInverted = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth'
            });
            if (codeInverted && codeInverted.data) {
              resolve(codeInverted.data);
              return;
            }
            reject(new Error('未在图片中找到二维码'));
          } catch (e) {
            reject(new Error('图片解码失败'));
          }
        };
        img.onerror = () => reject(new Error('图片读取失败'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  },

  /* ─────────────────────────────────────────────────────────────
     分享（生成二维码）
     ───────────────────────────────────────────────────────────── */

  /**
   * 打开「分享为二维码」模态框
   * @param {string} entryId - 条目 ID
   */
  openShareModal(entryId) {
    const entry = App.state.entries.find(e => e.id === entryId);
    if (!entry) return;

    App.state.qrShareEntry = entry;

    const modal = document.getElementById('modal');
    const spinnerHtml = `<div class="spinner-col"><div class="spinner"></div><span class="text-muted text-sm">正在生成…</span></div>`;
    modal.innerHTML = `
      <div class="modal-header">
        <h2>分享为二维码</h2>
        <button class="btn-icon" onclick="App.closeModal()" tabindex="-1">
          ${Utils.SvgIcons.close(16)}
        </button>
      </div>
      <div class="modal-body">
        <div class="text-muted text-sm mb-3">
          将「${Utils.escHtml(entry.title || '未命名')}」加密为二维码，可在另一台设备扫码导入
        </div>
        <div id="qr-share-result" class="mt-4 text-center">
          <div id="qr-share-canvas" class="qr-paper">
            ${spinnerHtml}
          </div>
          <p class="text-muted text-sm mt-2">二维码已加密，另一台设备扫码后自动导入</p>
          <button class="btn btn-secondary btn-sm hidden" id="qr-share-download" onclick="QR.downloadShareQr()" tabindex="2">下载二维码图片</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()" tabindex="3">关闭</button>
      </div>
    `;
    App.openModal();
    QR.generateShareQr();
  },

  /**
   * 生成并展示二维码（使用当前解锁会话的主密码，无需再次输入）
   */
  async generateShareQr() {
    const password = getSession();
    if (!password) {
      QR._showShareError('未找到会话主密码，请重新解锁后重试');
      return;
    }
    const entry = App.state.qrShareEntry;
    if (!entry) return;

    try {
      await _ensureQRCode();
      const qrText = await QR.entryToQrString(entry, password);
      // 预检：QR 容量上限（M 纠错级 V40 约 2331 字节），超出直接提示，避免渲染越界崩溃
      const byteLen = new TextEncoder().encode(qrText).length;
      if (byteLen > 2200) {
        QR._showShareError(`二维码容量不足（内容约 ${(byteLen / 1024).toFixed(1)}KB，上限约 2.2KB）。请精简备注或字段后重试，或改用文件同步传输`);
        return;
      }
      if (byteLen > 1800) {
        Utils.showToast(`⚠️ 内容较大（${(byteLen / 1024).toFixed(1)}KB），扫码时需保持光线充足`, 'warning');
      }
      App.state.qrShareText = qrText;
      const container = document.getElementById('qr-share-canvas');
      container.innerHTML = '';

      new QRCode(container, {
        text: qrText,
        width: 320,
        height: 320,
        correctLevel: QRCode.CorrectLevel.M,
        colorDark: '#000000',
        colorLight: '#ffffff'
      });

      const downloadBtn = document.getElementById('qr-share-download');
      if (downloadBtn) downloadBtn.classList.remove('hidden');
    } catch (e) {
      QR._showShareError('生成失败：' + e.message);
    }
  },

  /**
   * 在分享弹窗中展示错误信息（替换"正在生成"占位）
   */
  _showShareError(msg) {
    const container = document.getElementById('qr-share-canvas');
    if (!container) return;
    container.innerHTML = `<div class="text-danger text-sm p-6">${Utils.escHtml(msg)}</div>`;
  },

  /**
   * 下载已生成的二维码图片（640px 高清）
   */
  async downloadShareQr() {
    const entry = App.state.qrShareEntry || {};
    const qrText = App.state.qrShareText;
    const safeTitle = (entry.title || 'entry').replace(/[\\/:*?"<>|]/g, '_');
    if (!qrText) {
      Utils.showToast('尚未生成二维码', 'error');
      return;
    }
    await _ensureQRCode();
    // 用隐藏容器重渲染高清二维码后导出
    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-9999px';
    document.body.appendChild(holder);
    let href = null;
    try {
      new QRCode(holder, {
        text: qrText,
        width: 640,
        height: 640,
        correctLevel: QRCode.CorrectLevel.M,
        colorDark: '#000000',
        colorLight: '#ffffff'
      });
      const node = holder.querySelector('canvas, img');
      href = node.tagName === 'CANVAS' ? node.toDataURL('image/png') : node.src;
    } catch (e) {
      Utils.showToast('生成图片失败', 'error');
    } finally {
      holder.remove();
    }
    if (!href) return;
    const link = document.createElement('a');
    link.href = href;
    link.download = `LockPass-QR-${safeTitle}.png`;
    link.click();
  },

  /* ─────────────────────────────────────────────────────────────
     导入（识别二维码）
     ───────────────────────────────────────────────────────────── */

  /**
   * 打开「二维码添加」模态框：粘贴 / 上传 / 拖拽图片后自动识别并同步
   */
  openImportModal() {
    App.state.qrImportText = null;
    App.state.qrImportEntry = null;

    const modal = document.getElementById('modal');
    modal.innerHTML = `
      <div class="modal-header">
        <h2>二维码添加</h2>
        <button class="btn-icon" onclick="QR.closeImportModal()" tabindex="-1">
          ${Utils.SvgIcons.close(16)}
        </button>
      </div>
      <div class="modal-body">
        <div class="file-drop" id="qr-import-drop" onclick="document.getElementById('qr-import-file').click()" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="QR.handleImportDrop(event)" tabindex="1" role="button">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto mb-3">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <path d="M14 14h3v3h-3z"/>
            <path d="M21 14v3h-3"/>
          </svg>
          <div>粘贴 / 上传 / 拖拽二维码图片</div>
          <div class="text-muted text-sm mt-1">支持 PNG / JPG；可直接复制二维码图片后按 <kbd>Ctrl</kbd>+<kbd>V</kbd> 粘贴，或拖拽图片到此处</div>
          <input type="file" id="qr-import-file" accept="image/*" onchange="QR.handleImportFile(event)" />
        </div>
        <div id="qr-import-status" class="hidden mt-3"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="QR.closeImportModal()" tabindex="1">取消</button>
      </div>
    `;
    App.openModal();
    QR._registerPaste();
  },

  /**
   * 关闭扫码导入模态框
   */
  closeImportModal() {
    QR._unregisterPaste();
    App.closeModal();
  },

  /**
   * 处理拖放图片
   */
  handleImportDrop(event) {
    event.preventDefault();
    event.target.classList.remove('dragover');
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file && file.type && file.type.startsWith('image/')) {
      QR._processImage(file);
    } else {
      Utils.showToast('请拖入图片文件', 'error');
    }
  },

  /**
   * 处理文件选择
   */
  handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (file) QR._processImage(file);
  },

  /**
   * 注册粘贴监听（仅模态框打开时生效）
   */
  _registerPaste() {
    QR._unregisterPaste();
    QR._pasteHandler = (e) => {
      // 仅当扫码导入模态框存在且处于打开状态时响应
      const drop = document.getElementById('qr-import-drop');
      if (!drop || !drop.isConnected) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.startsWith('image/')) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (file) QR._processImage(file);
          return;
        }
      }
      // 非图片粘贴：给予提示
      e.preventDefault();
      Utils.showToast('请粘贴图片格式的二维码（截图或右键复制图片）', 'warning');
    };
    document.addEventListener('paste', QR._pasteHandler);
  },

  /**
   * 移除粘贴监听
   */
  _unregisterPaste() {
    if (QR._pasteHandler) {
      document.removeEventListener('paste', QR._pasteHandler);
      QR._pasteHandler = null;
    }
  },

  /**
   * 处理图片识别
   * @param {File} file - 图片文件
   */
  async _processImage(file) {
    const status = document.getElementById('qr-import-status');
    status.classList.remove('hidden');
    status.innerHTML = '<div class="text-sm text-muted">正在识别二维码…</div>';

    try {
      const qrText = await QR.decodeImageFile(file);
      App.state.qrImportText = qrText;

      // 复用当前解锁会话的主密码自动解密，无需再次输入
      const password = getSession();
      if (!password) {
        status.innerHTML = '<div class="text-danger text-sm">未找到会话主密码，请先解锁保险箱后重试</div>';
        return;
      }
      const entry = await QR.qrStringToEntry(qrText, password);
      App.state.qrImportEntry = entry;

      status.innerHTML = `
        <div class="text-success text-sm flex items-center gap-2">
          ${Utils.SvgIcons.check(13)}
          二维码识别成功，正在自动同步…
        </div>
      `;
      await QR._autoImport(entry);
    } catch (e) {
      status.innerHTML = `<div class="text-danger text-sm">${Utils.escHtml(e.message)}</div>`;
    }
  },

  /**
   * 确认导入（兼容旧入口，直接走自动同步）
   */
  async confirmImport() {
    const entry = App.state.qrImportEntry;
    if (!entry) return;
    await QR._autoImport(entry);
  },

  /**
   * 自动同步导入：无重复直接插入；有重复询问是否替换
   * @param {Object} entry - 解密后的条目
   */
  async _autoImport(entry) {
    // 按「标题 + 用户名」去重，相同则提示是否替换
    const dup = QR._findDuplicate(entry);
    if (dup) {
      const dupLabel = `${entry.title || '未命名'}${entry.username ? '（' + entry.username + '）' : ''}`;
      const ok = await Utils.confirm({
        title: '发现重复条目',
        message: `已存在相同条目「${dupLabel}」，是否替换？`,
        confirmText: '替换',
        danger: true
      });
      if (!ok) {
        Utils.showToast('已跳过，可继续扫码', 'info');
        return;  // 保持模态框打开，可继续扫下一张
      }
      App.state.entries = App.state.entries.filter(e => e.id !== dup.id);
    }

    // 统一标签模型：旧二维码可能带 category（名称），并入 tags
    const entryTags = (entry.tags || []).slice();
    if (entry.category && !entryTags.includes(entry.category)) {
      entryTags.push(entry.category);
    }

    // 构建导入条目（完整保留 entryType 及各类型字段）
    const newEntry = {
      id: CryptoUtils.uuid(),
      title: entry.title || '',
      username: entry.username || '',
      password: entry.password || '',
      url: entry.url || '',
      notes: entry.notes || '',
      tags: entryTags,
      // 旧二维码可能无 entryType，默认 website
      entryType: entry.entryType || 'website',
      // server / database 端口
      port: entry.port != null ? entry.port : undefined,
      favorite: false,
      showPassword: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // server 类型：携带 root 账号/密码
    if (entry.root) {
      newEntry.root = {
        username: entry.root.username || '',
        password: entry.root.password || '',
      };
    }

    // app 类型：携带 App ID、公钥、私钥
    if (entry.appId) newEntry.appId = entry.appId;
    if (entry.privateKey) newEntry.privateKey = entry.privateKey;

    App.state.entries.push(newEntry);

    await App.saveVault();
    UI.renderEntries();
    UI.renderSidebar();
    Utils.showToast(dup ? '导入成功（已替换原条目）' : '导入成功', 'success');

    // 短暂停留：保持模态框打开，用户可继续扫码导入下一张
    setTimeout(() => {
      if (!document.getElementById('qr-import-drop')) return; // 模态框已关闭则跳过
      QR.closeImportModal();
    }, 2000);
  },

  /**
   * 查找相同条目（标题 + 用户名）
   * @param {Object} entry - 待检查条目
   * @returns {Object|undefined} 已存在的条目
   */
  _findDuplicate(entry) {
    return App.state.entries.find(e =>
      (e.title || '') === (entry.title || '') &&
      (e.username || '') === (entry.username || '')
    );
  }
};

// 导出模块
window.QR = QR;
