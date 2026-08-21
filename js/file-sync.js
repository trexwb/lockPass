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
const LS_SYNC_BOUND = 'lp_sync_bound'; // 标记曾绑定过（用于 UI 引导提示）

const FileSync = {
  /** 最近一次同步失败信息（null 表示无失败；供设置面板展示，不阻断主流程） */
  lastSyncError: null,

  /** 是否支持文件系统访问 API */
  isSupported() {
    return typeof window.showDirectoryPicker === 'function';
  },

  /** 获取已绑定的目录句柄 */
  async getDirHandle() {
    await DBUtils.openDB();
    const rec = await DBUtils.dbGet(DBUtils.STORE_META, 'dirHandle');
    return rec ? rec.value : null;
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
      iterations: iterRec ? iterRec.value : 100000,
      iv: vaultRec.iv,
      data: vaultRec.data,
      updatedAt: new Date().toISOString()
    };
  },

  /** 将当前 IndexedDB 数据同步写入本地文件（静默失败，不阻断主流程） */
  async syncNow() {
    try {
      const handle = await this.getDirHandle();
      if (!handle) return { ok: false, reason: 'unbound' };
      const payload = await this._readPayload();
      if (!payload) return { ok: false, reason: 'empty' };
      const fileHandle = await this._getDataFileHandle(handle, true);
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
      return { ok: true };
    } catch (e) {
      console.error('[FileSync] 同步失败:', e);
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
    if (!this.isSupported()) {
      throw new Error('当前浏览器不支持文件系统访问 API，请使用 Chrome / Edge 打开');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await this.saveDirHandle(handle);
    localStorage.setItem(LS_SYNC_BOUND, '1');

    // IndexedDB 无数据但目录中已有同步文件：用已有文件恢复（浏览器清空缓存后的找回场景）
    const dbHasVault = await this._dbHasVault();
    const existingFile = await this._getExistingSyncFile(handle);
    if (!dbHasVault && existingFile) {
      try {
        const payload = await this.restoreFromDirectory(handle);
        return { restored: true, handle, payload };
      } catch (e) {
        // 文件存在但校验/恢复失败：明确报错，防止用户误以为已恢复后新建库覆盖旧文件
        throw new Error('目录中已有 LockPass-vault.json 但恢复失败：' + (e && e.message ? e.message : e));
      }
    }

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
    await DBUtils.dbPut(DBUtils.STORE_META, { key: 'iterations', value: payload.iterations || 100000 });
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
      throw new Error('没有找到 vault.json，请确认选择的是正确的数据目录');
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error('vault.json 解析失败，文件可能已损坏');
    }
    if (!payload.salt || !payload.iv || !payload.data) {
      throw new Error('vault.json 格式不正确，不是有效的 LockPass 同步文件');
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
