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

  // 桌面判定统一走 tauri-env.js（__TAURI__ 缺失时经 __TAURI_INTERNALS__ 兜底）；
  // 若这里失效，桌面会被误判为浏览器：file 存储不启用 → 暴露「绑定目录」
  // 入口 → 句柄经 JSON 落盘退化 → 每次写入报错
  const LT = window.LockTauri || {};
  if (!LT.isTauri) return; // 真·浏览器环境：保持 IndexedDB

  const invoke = LT.invoke;
  const FILE_META = 'meta.json';
  const FILE_VAULT = 'vault.json';

  /* ── 1. FileStore：底层文件 API 封装 ──────────────────────────── */
  const FileStore = {
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
  let writeQueue = Promise.resolve();
  function enqueueWrite(fn) {
    const run = writeQueue.then(fn, fn); // 前一个失败不阻断后续
    writeQueue = run.catch(function () {});
    return run;
  }

  /* ── 3. 读缓存 + JSON 解析 ────────────────────────────────────── */
  let cache = {};

  async function readJson(file, force) {
    // R7 修复：force 为 true 时跳过缓存直接读磁盘并刷新缓存，
    // 保证外部变更（其他窗口/进程写入）能被读到，避免脏读。
    if (!force && file in cache) return cache[file];
    let obj = {};
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
  const DBUtilsFile = {
    STORE_META: 'meta',
    STORE_VAULT: 'vault',

    /** 文件存储无需打开连接 */
    openDB: async function () {},

    /** 按 key 读取单条 */
    dbGet: async function (storeName, key) {
      // R7 修复：强制重读磁盘，保证读到外部变更，避免缓存脏读
      const obj = await readJson(fileOf(storeName), true);
      return obj[key];
    },

    /** 按 keyPath 写入单条 */
    dbPut: async function (storeName, value) {
      const file = fileOf(storeName);
      const obj = await readJson(file);
      obj[keyOf(storeName, value)] = value;
      cache[file] = obj;
      await enqueueWrite(function () {
        return FileStore.write(file, JSON.stringify(obj));
      });
    },

    /** 按 key 删除单条 */
    dbDelete: async function (storeName, key) {
      const file = fileOf(storeName);
      const obj = await readJson(file);
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
      // R7 修复：强制重读磁盘，保证读到外部变更，避免缓存脏读
      const obj = await readJson(fileOf(storeName), true);
      return Object.keys(obj).map(function (k) { return obj[k]; });
    },

    /** 清空存储 */
    dbClear: async function (storeName) {
      const file = fileOf(storeName);
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

  /* ── 5. 历史数据一次性迁移：IndexedDB（浏览器误判期产物）→ 文件存储 ──
     背景：__TAURI__ 全局注入异常的 Windows 环境里，本模块曾整段早退，
     桌面按浏览器模式运行，密码库落在 http://tauri.localhost 的
     IndexedDB（PasswordVaultDB）。FileStore 启用后若文件为空而该库有
     salt，则把加密负载整体搬入文件，避免用户看到「创建保险箱」空屏。
     只搬运 meta.salt/iterations/version 与 vault/main 加密记录；
     刻意排除 dirHandle（浏览器版目录句柄，禁止带入桌面）。 */
  function openLegacyIdb() {
    return new Promise(function (resolve) {
      var req
      try { req = indexedDB.open('PasswordVaultDB', 1) } catch (e) { return resolve(null) }
      req.onsuccess = function () { resolve(req.result) }
      req.onerror = function () { resolve(null) }
      req.onblocked = function () { resolve(null) }
    })
  }

  function idbGetAll(db, store) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(store)
        var req = tx.objectStore(store).getAll()
        req.onsuccess = function () { resolve(req.result || []) }
        req.onerror = function () { resolve([]) }
      } catch (e) { resolve([]) }
    })
  }

  var legacyMigration = null
  function migrateFromLegacyIdb() {
    return openLegacyIdb().then(function (db) {
      if (!db) return
      return Promise.all([idbGetAll(db, 'meta'), idbGetAll(db, 'vault')]).then(function (lists) {
        var metaRows = lists[0], vaultRows = lists[1]
        var find = function (rows, keyName, keyVal) {
          for (var i = 0; i < rows.length; i++) if (rows[i][keyName] === keyVal) return rows[i]
          return null
        }
        var saltRow = find(metaRows, 'key', 'salt')
        var mainRow = null
        for (var j = 0; j < vaultRows.length; j++) if (vaultRows[j].id === 'main') mainRow = vaultRows[j]
        if (!saltRow || !mainRow) return

        // 目的地已有数据（meta.salt 存在）则不覆盖，尊重文件为准
        return readJson(FILE_META, true).then(function (curMeta) {
          if (curMeta && curMeta['salt']) return
          return readJson(FILE_VAULT, true).then(function (curVault) {
            ['salt', 'iterations', 'version'].forEach(function (k) {
              var row = find(metaRows, 'key', k)
              if (row) curMeta[k] = row
            })
            curVault['main'] = mainRow
            cache[FILE_META] = curMeta
            cache[FILE_VAULT] = curVault
            return enqueueWrite(function () {
              return Promise.all([
                FileStore.write(FILE_META, JSON.stringify(curMeta)),
                FileStore.write(FILE_VAULT, JSON.stringify(curVault))
              ]).then(function () {
                console.info('[LockPass/FileStore] 已将历史 IndexedDB 密码库迁移至本地文件存储')
              })
            })
          })
        })
      }).catch(function (e) {
        console.warn('[LockPass/FileStore] 历史 IndexedDB 迁移跳过:', e)
      })
    })
  }

  // 所有读写都先经 openDB —— 在此挂迁移闸门，保证 boot 首读前完成搬运判定
  var _origOpenDB = DBUtilsFile.openDB
  DBUtilsFile.openDB = function () {
    if (!legacyMigration) legacyMigration = migrateFromLegacyIdb()
    return legacyMigration.then(function () { return _origOpenDB.call(DBUtilsFile) })
  }

  // 打印数据目录便于排查
  FileStore.dataDir().then(function (dir) {
    console.info('[LockPass] 桌面文件存储已启用，数据目录: ' + dir);
  }).catch(function (e) {
    console.warn('[LockPass] 获取数据目录失败:', e);
  });
})();
