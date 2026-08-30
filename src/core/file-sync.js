/* ═══════════════════════════════════════════════════════════════════
   LockPass — 本地文件同步模块
   通过 File System Access API 将 IndexedDB 数据同步到本地文件
   （用户选择的目录下直接生成 vault.json），IndexedDB 被清空时从文件恢复。
   
   说明：
   - 首次使用需在设置中「绑定数据目录」一次，获得浏览器授权后自动同步；
   - IndexedDB 被清空后，句柄随之丢失，需重新选择目录完成恢复；
   - 本地文件为 AES-256-GCM 密文，无主密码无法解密，可放心存放。
   ═══════════════════════════════════════════════════════════════════ */

const FILE_SYNC_NAME = 'LockPass-vault.json';

/* i18n：Toast 在调用时求值（window.I18n 由 core/i18n.js 挂载） */
const t = (k, p) => window.I18n.t(k, p);
const LS_SYNC_BOUND = 'lp_sync_bound'; // 标记曾绑定过（用于 UI 引导提示）

const FileSync = {
  /** 最近一次同步失败信息（null 表示无失败；供设置面板展示，不阻断主流程） */
  lastSyncError: null,

  /** 是否支持文件系统访问 API */
  isSupported() {
    return typeof window.showDirectoryPicker === 'function';
  },

  /** 是否为可用的目录句柄
   *  FileSystemDirectoryHandle 无法经 JSON 序列化还原（方法全部丢失），
   *  浏览器/WebView 引擎升级也可能使存储的句柄退化为普通对象；
   *  此类句柄调用 getFileHandle 会抛 "not a function"。 */
  isUsableDirHandle(handle) {
    return !!handle && typeof handle.getFileHandle === 'function';
  },

  /** 获取已绑定的目录句柄 */
  async getDirHandle() {
    await DBUtils.openDB();
    const rec = await DBUtils.dbGet(DBUtils.STORE_META, 'dirHandle');
    return rec ? rec.value : null;
  },

  /** 获取可用目录句柄；句柄损坏时自动解绑并只提示一次（自愈，防每次写入都报错）
   *  返回可用句柄或 null（未绑定 / 已失效清除） */
  async ensureUsableDirHandle() {
    const handle = await this.getDirHandle();
    if (!handle) return null;
    if (this.isUsableDirHandle(handle)) return handle;
    console.warn('[FileSync] 存储的目录句柄无效，已自动解绑:', handle);
    await this.clearDirHandle();
    try { localStorage.removeItem(LS_SYNC_BOUND); } catch (e) {}
    this.lastSyncError = null;
    try {
      Utils.showToast(t('sync.stoppedInvalidHandle'), 'warning');
    } catch (e) {}
    return null;
  },

  /** 保存目录句柄 */
  async saveDirHandle(handle) {
    await DBUtils.openDB();
    await DBUtils.dbPut(DBUtils.STORE_META, { key: 'dirHandle', value: handle });
  },

  /** 清除目录句柄 */
  async clearDirHandle() {
    await DBUtils.openDB();
    await DBUtils.dbDelete(DBUtils.STORE_META, 'dirHandle');
  },

  /**
   * 获取 vault.json 文件句柄
   * 直接在用户选择的目录下创建/使用文件
   */
  async _getDataFileHandle(dirHandle, create) {
    return dirHandle.getFileHandle(FILE_SYNC_NAME, { create: !!create });
  },

  /** 读取当前 IndexedDB 中的完整加密负载（不触发解密） */
  async _readPayload() {
    await DBUtils.openDB();
    const saltRec = await DBUtils.dbGet(DBUtils.STORE_META, 'salt');
    const iterRec = await DBUtils.dbGet(DBUtils.STORE_META, 'iterations');
    const verRec = await DBUtils.dbGet(DBUtils.STORE_META, 'version');
    const vaultRec = await DBUtils.dbGet(DBUtils.STORE_VAULT, 'main');
    if (!saltRec || !vaultRec) return null;
    return {
      format: 'LockPass-file-sync',
      version: verRec ? verRec.value : 1,
      salt: saltRec.value,
      iterations: iterRec ? iterRec.value : window.CryptoUtils.LEGACY_ITERATIONS,
      iv: vaultRec.iv,
      data: vaultRec.data,
      updatedAt: new Date().toISOString()
    };
  },

  /** 将当前 IndexedDB 数据同步写入本地文件（静默失败，不阻断主流程） */
  async syncNow() {
    try {
      const handle = await this.ensureUsableDirHandle();
      if (!handle) return { ok: false, reason: 'unbound' };
      const payload = await this._readPayload();
      if (!payload) return { ok: false, reason: 'empty' };
      const fileHandle = await this._getDataFileHandle(handle, true);
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
      this.lastSyncError = null;
      return { ok: true };
    } catch (e) {
      console.error('[FileSync] 同步失败:', e);
      this.lastSyncError = e;
      try { Utils.showToast(t('sync.syncFailed', { msg: e.message || e }), 'error'); } catch (_) {}
      return { ok: false, reason: 'error', error: e };
    }
  },

  /** 判断 IndexedDB 中是否已有保险箱数据（meta.salt 存在即已初始化） */
  async _dbHasVault() {
    await DBUtils.openDB();
    const rec = await DBUtils.dbGet(DBUtils.STORE_META, 'salt');
    return !!rec;
  },

  /** 获取目录中的同步文件句柄（不存在返回 null） */
  async _getExistingSyncFile(dirHandle) {
    try {
      return await dirHandle.getFileHandle(FILE_SYNC_NAME);
    } catch (e) {
      return null;
    }
  },

  /** 弹出目录选择并绑定，立即同步一次 */
  async bindDirectory() {
    // 桌面版数据由应用本地文件管理，目录同步是浏览器版专属能力；
    // 硬拒绝以防句柄经 JSON 落盘退化为空壳后每次写入都报错
    if ((window.FileStore && window.FileStore.isTauri) || window.__TAURI_INTERNALS__) {
      throw new Error(window.I18n ? window.I18n.t('sync.desktopNoBind') : '桌面版数据已由本地文件自动保存，无需绑定同步目录');
    }
    if (!this.isSupported()) {
      throw new Error(window.I18n.t('sync.errNoFsApi'));
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });

    const dbHasVault = await this._dbHasVault();
    const existingFile = await this._getExistingSyncFile(handle);

    // 目录中已有同步文件：优先用已有文件恢复，禁止静默覆盖旧文件
    if (existingFile) {
      if (!dbHasVault) {
        // IndexedDB 全新状态：直接用已有文件恢复并绑定（恢复失败时不保存句柄、不写文件）
        const payload = await this.restoreFromDirectory(handle);
        return { restored: true, handle, payload };
      }
      // IndexedDB 已有数据（可能是刚创建的空库）：让用户明确选择，防止误覆盖旧同步文件
      // 使用项目自定义确认弹窗（替代系统 confirm，桌面/手机/Pad 表现一致）
      const useFile = await Utils.confirm({
        title: t('sync.existingTitle'),
        message: t('sync.existingMsg'),
        confirmText: t('sync.restoreFile'),
        cancelText: t('sync.keepData')
      });
      if (useFile) {
        const payload = await this.restoreFromDirectory(handle);
        return { restored: true, handle, payload };
      }
      // 用户明确选择保留当前数据，继续走正常绑定 + 覆盖
    }

    // 普通绑定路径：先保存句柄再同步（恢复场景不经过此处，避免恢复失败后误绑定）
    await this.saveDirHandle(handle);
    localStorage.setItem(LS_SYNC_BOUND, '1');
    const result = await this.syncNow();
    return { handle, result };
  },

  /** 解绑（保留本地文件不删除） */
  async unbindDirectory() {
    await this.clearDirHandle();
    localStorage.removeItem(LS_SYNC_BOUND);
  },

  /** 将备份负载写入 IndexedDB（重建 vault 加密数据，不触发解密） */
  async restorePayload(payload) {
    await DBUtils.openDB();
    await DBUtils.dbPut(DBUtils.STORE_META, { key: 'salt', value: payload.salt });
    await DBUtils.dbPut(DBUtils.STORE_META, { key: 'iterations', value: payload.iterations || window.CryptoUtils.LEGACY_ITERATIONS });
    await DBUtils.dbPut(DBUtils.STORE_META, { key: 'version', value: payload.version || 1 });
    await DBUtils.dbPut(DBUtils.STORE_VAULT, {
      id: 'main',
      iv: payload.iv,
      data: payload.data
    });
  },

  /**
   * 从用户选择的目录恢复：读取 vault.json → 重建 IndexedDB
   * @returns {Promise<Object>} 恢复的负载（含 salt/iv/data）
   */
  async restoreFromDirectory(dirHandle) {
    let fileHandle;
    try {
      fileHandle = await dirHandle.getFileHandle(FILE_SYNC_NAME);
    } catch (e) {
      throw new Error(window.I18n.t('sync.errNoVault'));
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error(window.I18n.t('sync.errParseFailed'));
    }
    if (!payload.salt || !payload.iv || !payload.data) {
      throw new Error(window.I18n.t('sync.errBadFormat'));
    }
    // 写入 IndexedDB
    await this.restorePayload(payload);
    // 绑定该目录，后续自动同步
    await this.saveDirHandle(dirHandle);
    localStorage.setItem(LS_SYNC_BOUND, '1');
    return payload;
  },

  /** 是否曾绑定过（用于引导提示） */
  wasBound() {
    try { return localStorage.getItem(LS_SYNC_BOUND) === '1'; } catch (e) { return false; }
  },

  /**
   * 从已绑定的数据目录恢复（C1 修复：锁屏「从绑定目录恢复」入口专用）
   * 若绑定句柄已丢失（如 IndexedDB 被清空、句柄不可序列化），返回 null，
   * 由调用方引导用户通过「绑定已有数据目录」重新选择。
   * @returns {Promise<Object|null>} 恢复的负载，或 null（句柄不可用）
   */
  async restoreFromBoundDir() {
    const handle = await this.getDirHandle();
    if (!handle) return null;
    return this.restoreFromDirectory(handle);
  },

  /** 删除本地同步文件（销毁保险箱时调用） */
  async deleteLocalFile() {
    try {
      const handle = await this.getDirHandle();
      if (!handle) return;
      try {
        await handle.removeEntry(FILE_SYNC_NAME);
      } catch (e) { /* 文件不存在则忽略 */ }
    } catch (e) {
      console.error('[FileSync] 删除本地文件失败:', e);
    }
  }
};

// 导出模块
window.FileSync = FileSync;
