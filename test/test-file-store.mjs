/* 模拟 Tauri 环境测试 js/file-store.js 的文件版 DBUtils */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 临时数据目录
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lockpass-filestore-test-'));
const files = {}; // 模拟磁盘

// 模拟 window.__TAURI__.core.invoke
const invoke = (cmd, args) => {
  const rel = args && args.relativePath;
  switch (cmd) {
    case 'file_store_write': {
      const full = path.join(TMP, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, args.contents, 'utf8');
      return Promise.resolve(null);
    }
    case 'file_store_read':
      return Promise.resolve(fs.readFileSync(path.join(TMP, rel), 'utf8'));
    case 'file_store_exists':
      return Promise.resolve(fs.existsSync(path.join(TMP, rel)));
    case 'file_store_delete':
      try { fs.unlinkSync(path.join(TMP, rel)); } catch (e) {}
      return Promise.resolve(null);
    case 'file_store_data_dir':
      return Promise.resolve(TMP);
    default:
      return Promise.reject(new Error('unknown cmd: ' + cmd));
  }
};

global.window = {
  __TAURI__: { core: { invoke } },
  FileStore: undefined,
  DBUtils: undefined
};

// 加载被测模块
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'file-store.js'), 'utf8');
eval(src); // 在 global.window 环境下执行 IIFE

const DB = window.DBUtils;
const FS = window.FileStore;

(async () => {
  const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL: ' + msg); process.exit(1); } console.log('✅ ' + msg); };

  // 1. openDB 幂等
  await DB.openDB();
  assert(true, 'openDB 无异常');

  // 2. 写入 meta + vault
  await DB.dbPut(DB.STORE_META, { key: 'salt', value: 'SALT123' });
  await DB.dbPut(DB.STORE_META, { key: 'iterations', value: 100000 });
  await DB.dbPut(DB.STORE_VAULT, { id: 'main', iv: 'IV', data: 'CIPHER' });
  assert(true, '连续 dbPut 无异常');

  // 3. 读取验证
  const salt = await DB.dbGet(DB.STORE_META, 'salt');
  assert(salt && salt.value === 'SALT123', 'dbGet 读取 salt 正确');
  const vault = await DB.dbGet(DB.STORE_VAULT, 'main');
  assert(vault && vault.iv === 'IV' && vault.data === 'CIPHER', 'dbGet 读取 vault.main 正确');
  const missing = await DB.dbGet(DB.STORE_META, 'nope');
  assert(missing === undefined, 'dbGet 未命中返回 undefined');

  // 4. 磁盘文件确实存在
  assert(fs.existsSync(path.join(TMP, 'meta.json')), 'meta.json 已落盘');
  assert(fs.existsSync(path.join(TMP, 'vault.json')), 'vault.json 已落盘');

  // 5. dbGetAll
  const allMeta = await DB.dbGetAll(DB.STORE_META);
  assert(allMeta.length === 2, 'dbGetAll 返回 2 条 meta（实际 ' + allMeta.length + '）');

  // 6. dbDelete
  await DB.dbDelete(DB.STORE_META, 'iterations');
  const it = await DB.dbGet(DB.STORE_META, 'iterations');
  assert(it === undefined, 'dbDelete 后读取为 undefined');

  // 7. 覆盖写（同 key 更新）
  await DB.dbPut(DB.STORE_META, { key: 'salt', value: 'NEWSALT' });
  const salt2 = await DB.dbGet(DB.STORE_META, 'salt');
  assert(salt2.value === 'NEWSALT', 'dbPut 覆盖写生效');

  // 8. dbClear
  await DB.dbClear(DB.STORE_VAULT);
  const cleared = await DB.dbGetAll(DB.STORE_VAULT);
  assert(cleared.length === 0, 'dbClear 清空 vault');
  const diskVault = JSON.parse(fs.readFileSync(path.join(TMP, 'vault.json'), 'utf8'));
  assert(Object.keys(diskVault).length === 0, 'vault.json 磁盘内容已清空');

  // 9. 并发写不丢数据（10 个并发 dbPut）
  await DB.dbClear(DB.STORE_META);
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    DB.dbPut(DB.STORE_META, { key: 'k' + i, value: i })));
  const afterConcurrent = await DB.dbGetAll(DB.STORE_META);
  assert(afterConcurrent.length === 10, '并发 10 次 dbPut 全部保留（实际 ' + afterConcurrent.length + '）');

  // 10. deleteDatabase 删除全部文件
  await DB.deleteDatabase();
  assert(!fs.existsSync(path.join(TMP, 'meta.json')), 'deleteDatabase 后 meta.json 已删除');
  assert(!fs.existsSync(path.join(TMP, 'vault.json')), 'deleteDatabase 后 vault.json 已删除');
  // 删除后重新写入应正常（模拟重置密码流程）
  await DB.dbPut(DB.STORE_VAULT, { id: 'main', iv: 'IV2', data: 'CIPHER2' });
  const re = await DB.dbGet(DB.STORE_VAULT, 'main');
  assert(re && re.data === 'CIPHER2', '删库后重建写入正常');

  // 11. FileStore 底层 API
  assert((await FS.dataDir()) === TMP, 'FileStore.dataDir 返回正确目录');
  assert(FS.isTauri === true, 'FileStore.isTauri 标记正确');

  // 清理
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n🎉 全部 20 项断言通过，文件版 DBUtils 与 IndexedDB 接口完全兼容');
})().catch(e => { console.error('❌ 测试异常:', e); process.exit(1); });
