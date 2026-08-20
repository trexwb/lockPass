/* ═══════════════════════════════════════════════════════════════════
   LockPass — 本地文件存储模块（Tauri 专属）
   ───────────────────────────────────────────────────────────────────
   仅 Tauri 桌面环境生效：用应用数据目录下的 JSON 文件替代 IndexedDB，
   数据真正落盘为本地文件（可备份、可迁移）。
   
   • window.FileStore：Rust 命令（file_store_*）的薄封装
   • 文件版 DBUtils：与 js/database.js 完全同接口（openDB / dbGet /
     dbPut / dbDelete / dbGetAll / dbClear / deleteDatabase），Tauri
     环境下自动替换 window.DBUtils，业务代码零改动。
   
   存储结构（数据根目录内）：
     meta.json    { "salt": {...}, "iterations": {...}, ... }  按 key 索引
     vault.json   { "main": {...} }                            按 id 索引
   
   写操作串行化（Promise 队列），避免并发写覆盖丢数据。
   浏览器环境本文件自动降级（不替换 DBUtils），完全不影响 Web 版。
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var T = window.__TAURI__;
  var isTauri = !!(T && T.core && typeof T.core.invoke === 'function');
  if (!isTauri) return; // 浏览器：保持 IndexedDB

  var invoke = T.core.invoke;
  var FILE_META = 'meta.json';
  var FILE_VAULT = 'vault.json';

  /* ── 1. FileStore：底层文件 API 封装 ──────────────────────────── */
  var FileStore = {
    isTauri: true,

    /** 写入文本文件（自动建目录） */
    write: function (relativePath, contents) {
      return invoke('file_store_write', { relativePath: relativePath, contents: contents });
    },

    /** 读取文本文件 */
    read: function (relativePath) {
      return invoke('file_store_read', { relativePath: relativePath });
    },

    /** 判断文件是否存在 */
    exists: function (relativePath) {
      return invoke('file_store_exists', { relativePath: relativePath });
    },

    /** 删除文件（不存在时静默成功） */
    remove: function (relativePath) {
      return invoke('file_store_delete', { relativePath: relativePath });
    },

    /** 数据根目录绝对路径（设置界面展示用） */
    dataDir: function () {
      return invoke('file_store_data_dir');
    }
  };
  window.FileStore = FileStore;

  /* ── 2. 写队列：串行化落盘，防止并发写丢数据 ─────────────────── */
  var writeQueue = Promise.resolve();
  function enqueueWrite(fn) {
    var run = writeQueue.then(fn, fn); // 前一个失败不阻断后续
    writeQueue = run.catch(function () {});
    return run;
  }

  /* ── 3. 读缓存 + JSON 解析 ────────────────────────────────────── */
  var cache = {};

  async function readJson(file) {
    if (file in cache) return cache[file];
    var obj = {};
    try {
      if (await FileStore.exists(file)) {
        obj = JSON.parse(await FileStore.read(file)) || {};
      }
    } catch (e) {
      console.error('[LockPass/FileStore] 读取 ' + file + ' 失败，使用空数据:', e);
      obj = {};
    }
    cache[file] = obj;
    return obj;
  }

  function fileOf(storeName) {
    return storeName === 'meta' ? FILE_META : FILE_VAULT;
  }

  function keyOf(storeName, value) {
    // 与 IndexedDB 的 keyPath 对齐：meta 用 key，vault 用 id
    return storeName === 'meta' ? value.key : value.id;
  }

  /* ── 4. 文件版 DBUtils（接口与 js/database.js 完全一致） ──────── */
  var DBUtilsFile = {
    STORE_META: 'meta',
    STORE_VAULT: 'vault',

    /** 文件存储无需打开连接 */
    openDB: async function () {},

    /** 按 key 读取单条 */
    dbGet: async function (storeName, key) {
      var obj = await readJson(fileOf(storeName));
      return obj[key];
    },

    /** 按 keyPath 写入单条 */
    dbPut: async function (storeName, value) {
      var file = fileOf(storeName);
      var obj = await readJson(file);
      obj[keyOf(storeName, value)] = value;
      cache[file] = obj;
      await enqueueWrite(function () {
        return FileStore.write(file, JSON.stringify(obj));
      });
    },

    /** 按 key 删除单条 */
    dbDelete: async function (storeName, key) {
      var file = fileOf(storeName);
      var obj = await readJson(file);
      if (key in obj) {
        delete obj[key];
        cache[file] = obj;
        await enqueueWrite(function () {
          return FileStore.write(file, JSON.stringify(obj));
        });
      }
    },

    /** 获取全部记录 */
    dbGetAll: async function (storeName) {
      var obj = await readJson(fileOf(storeName));
      return Object.keys(obj).map(function (k) { return obj[k]; });
    },

    /** 清空存储 */
    dbClear: async function (storeName) {
      var file = fileOf(storeName);
      cache[file] = {};
      await enqueueWrite(function () {
        return FileStore.write(file, '{}');
      });
    },

    /** 删除整个数据库（移除两个数据文件） */
    deleteDatabase: async function () {
      cache = {};
      await Promise.all([
        FileStore.remove(FILE_META).catch(function () {}),
        FileStore.remove(FILE_VAULT).catch(function () {})
      ]);
    }
  };

  // 替换 IndexedDB 版，后续业务代码（app / settings / import-export / file-sync）全部走文件
  window.DBUtils = DBUtilsFile;

  // 打印数据目录便于排查
  FileStore.dataDir().then(function (dir) {
    console.info('[LockPass] 桌面文件存储已启用，数据目录: ' + dir);
  }).catch(function (e) {
    console.warn('[LockPass] 获取数据目录失败:', e);
  });
})();
