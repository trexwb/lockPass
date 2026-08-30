/* ═══════════════════════════════════════════════════════════════════
   LockPass — 数据库模块
   IndexedDB 封装
   ═══════════════════════════════════════════════════════════════════ */

const DB_NAME = 'PasswordVaultDB';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_VAULT = 'vault';

let db = null;

/**
 * 打开数据库
 * 复用已打开的连接，避免重复 open 造成连接泄漏
 * （泄漏的旧连接不会自动关闭，会导致 deleteDatabase 触发 blocked 而删除失败/卡住）
 * @returns {Promise<IDBDatabase>}
 */
async function openDB() {
  // 已有可用连接则直接复用，不重复打开
  if (db) return db;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      
      // 创建 meta 存储（用于存储盐值等元数据）
      if (!database.objectStoreNames.contains(STORE_META)) {
        database.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      
      // 创建 vault 存储（用于存储加密数据）
      if (!database.objectStoreNames.contains(STORE_VAULT)) {
        database.createObjectStore(STORE_VAULT, { keyPath: 'id' });
      }
    };
    
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * 获取数据
 * @param {string} storeName - 存储名称
 * @param {string} key - 键名
 * @returns {Promise<any>}
 */
async function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 保存数据
 * @param {string} storeName - 存储名称
 * @param {any} value - 要保存的值
 * @returns {Promise<void>}
 */
async function dbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(value);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * 删除数据
 * @param {string} storeName - 存储名称
 * @param {string} key - 键名
 * @returns {Promise<void>}
 */
async function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * 获取所有数据
 * @param {string} storeName - 存储名称
 * @returns {Promise<Array>}
 */
async function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 清空存储
 * @param {string} storeName - 存储名称
 * @returns {Promise<void>}
 */
async function dbClear(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * 删除整个数据库
 * @returns {Promise<void>}
 */
async function deleteDatabase() {
  // 必须先关闭当前打开的连接，否则 deleteDatabase 会因连接占用而触发 blocked，删除永远无法完成
  if (db) {
    try { db.close(); } catch (e) {}
    db = null;
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    let settled = false;
    // 兜底超时：防止其他标签页长期占用导致删除永远挂起
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(window.I18n ? window.I18n.t('db.errDeleteTimeout') : '删除数据库超时，请关闭其他 LockPass 标签页后重试'));
      }
    }, 10000);
    request.onsuccess = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(request.error);
    };
    // 其他连接占用时不立即失败：占用连接关闭后删除会自动完成并触发 onsuccess，
    // 仅在超过兜底超时仍未完成时才报错，避免"数据已删但提示失败"
    request.onblocked = () => {};
  });
}

// 导出模块
window.DBUtils = {
  openDB,
  dbGet,
  dbPut,
  dbDelete,
  dbGetAll,
  dbClear,
  deleteDatabase,
  // 常量导出
  STORE_META,
  STORE_VAULT
};
