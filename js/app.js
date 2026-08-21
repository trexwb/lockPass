/* ═══════════════════════════════════════════════════════════════════
   LockPass — 主应用模块
   支持 5 种条目类型：网站、服务器、AI、应用、其他。
   默认推荐标签（预设 7 个），用户可增删改标签颜色与图标。
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 应用版本号
 */
const APP_VERSION = 'v1.0.3';

/**
 * Session Storage 键名（用于刷新后自动恢复）
 */
const SESSION_KEY = 'lockpass_session';
const SESSION_NONCE_KEY = 'lockpass_session_nonce';

/**
 * 生成随机 nonce
 */
function generateNonce() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 使用 XOR 混淆密码（基于 nonce）
 * 注意：这不是强加密，只是防止明码存储在 storage 中
 */
function obfuscatePassword(password, nonce) {
  if (!password || !nonce) return '';
  const nonceBytes = nonce.match(/.{2}/g).map(h => parseInt(h, 16));
  let result = '';
  for (let i = 0; i < password.length; i++) {
    const charCode = password.charCodeAt(i) ^ nonceBytes[i % nonceBytes.length];
    result += String.fromCharCode(charCode);
  }
  // Base64 encode to handle binary chars
  return btoa(result);
}

/**
 * 解混淆密码
 */
function deobfuscatePassword(obfuscated, nonce) {
  if (!obfuscated || !nonce) return '';
  try {
    const nonceBytes = nonce.match(/.{2}/g).map(h => parseInt(h, 16));
    const password = atob(obfuscated);
    let result = '';
    for (let i = 0; i < password.length; i++) {
      const charCode = password.charCodeAt(i) ^ nonceBytes[i % nonceBytes.length];
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch (e) {
    return '';
  }
}

/**
 * 保存会话到 sessionStorage（刷新后自动恢复）
 * 使用 XOR 混淆，避免明码存储
 */
function saveSession(password) {
  try {
    const nonce = generateNonce();
    const obfuscated = obfuscatePassword(password, nonce);
    sessionStorage.setItem(SESSION_KEY, obfuscated);
    sessionStorage.setItem(SESSION_NONCE_KEY, nonce);
  } catch (e) {}
}

/**
 * 获取会话密码
 */
function getSession() {
  try {
    const obfuscated = sessionStorage.getItem(SESSION_KEY);
    const nonce = sessionStorage.getItem(SESSION_NONCE_KEY);
    if (!obfuscated || !nonce) return '';
    return deobfuscatePassword(obfuscated, nonce);
  } catch (e) {
    return '';
  }
}

/**
 * 清除会话（退出登录）
 */
function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_NONCE_KEY);
  } catch (e) {}
}

/**
 * 从 localStorage 读取整数设置（失败或非法时返回默认值）
 */
function loadSettingInt(key, fallback) {
  try {
    const v = parseInt(localStorage.getItem(key) || '', 10);
    if (!isNaN(v) && v >= 0) return v;
  } catch (e) {}
  return fallback;
}

/**
 * 应用状态
 */
const AppState = {
  entries: [],           // 解密后的密码条目
  tagDefs: {},           // 标签注册表 { [name]: { color, icon, isDefault? } }
  tags: [],              // 标签列表
  deleted: [],           // 回收站（软删除的密码条目，不参与导入导出）
  isUnlocked: false,     // 是否已解锁
  cryptoKey: null,       // AES-256-GCM 密钥
  selectedEntry: null,   // 当前选中的条目 ID
  currentFilter: 'all',  // 当前筛选条件
  searchQuery: '',       // 搜索关键词
  clipboardTimer: null,  // 剪贴板清除定时器
  lockTimer: null,       // 自动锁定定时器
  lockTimeoutMs: loadSettingInt('lockpass_lock_timeout', 5 * 60 * 1000), // 自动锁定时间 (默认5分钟，持久化)
  clipboardClearMs: loadSettingInt('lockpass_clipboard_clear', 30 * 1000), // 剪贴板清除时间 (默认30秒，持久化)
};

/**
 * 默认推荐标签（可增删改，isDefault 标记默认标签）
 */
const DEFAULT_TAGS = [
  { name: '社交',    icon: 'social',   color: '#58a6ff', isDefault: true  },
  { name: '邮箱',    icon: 'email',    color: '#f85149', isDefault: true  },
  { name: '金融',    icon: 'finance',  color: '#3fb950', isDefault: true  },
  { name: '工作',    icon: 'work',     color: '#d29922', isDefault: true  },
  { name: '开发',    icon: 'dev',      color: '#bc8cff', isDefault: true  },
  { name: '生活',    icon: 'life',     color: '#79c0ff', isDefault: true  },
  { name: '其他',    icon: 'other',    color: '#8b949e', isDefault: true  },
];

/**
 * 所有可用图标列表（标签管理中使用）
 */
const TAG_ICON_OPTIONS = [
  'social', 'email', 'finance', 'work', 'dev', 'life', 'other',
  'bookmark', 'star', 'key', 'lock', 'cloud', 'globe', 'shield',
  'heart', 'tag', 'folder',
];

/**
 * 所有可选颜色列表（标签管理中使用）
 */
const TAG_COLOR_OPTIONS = [
  '#58a6ff', '#f85149', '#3fb950', '#d29922', '#bc8cff',
  '#79c0ff', '#8b949e', '#f778ba', '#39c5cf', '#ffa657',
  '#56d364', '#e3b341', '#ff7b72', '#d2a8ff', '#a5d6ff',
];

/**
 * 条目类型定义
 * @type {{ id: string, label: string, icon: string }[]}
 */
const ENTRY_TYPES = [
  { id: 'website', label: '网站',    icon: 'globe'   },
  { id: 'server',  label: '服务器',  icon: 'server'   },
  { id: 'database',label: '数据库',  icon: 'database' },
  { id: 'ai',      label: 'AI',      icon: 'ai'       },
  { id: 'app',     label: '应用',    icon: 'app'       },
  { id: 'other',   label: '其他',    icon: 'other'     },
];

/**
 * 从默认标签注册表生成初始状态
 * @returns {Object} { [name]: { color, icon, isDefault } }
 */
function buildDefaultTagDefs() {
  const defs = {};
  DEFAULT_TAGS.forEach(t => {
    defs[t.name] = { color: t.color, icon: t.icon, isDefault: t.isDefault };
  });
  return defs;
}

/**
 * 生成默认标签注册表（分类升级为标签，保留原颜色/图标；常用标签随机分配）
 * @returns {Object} { [name]: { color, icon, isDefault } }
 */
function seedDefaultTagDefs() {
  const tagDefs = {};
  // 默认推荐标签 → 标签定义（保留原颜色/图标，标记为默认）
  DEFAULT_TAGS.forEach(t => {
    tagDefs[t.name] = { color: t.color, icon: t.icon, isDefault: true };
  });
  // 常用标签（无预设颜色/图标，随机分配）
  // 常用标签（无预设颜色/图标，随机分配）；默认标签已有 7 个，共 15 个可用标签
  const popular = ['重要', '工作', '个人', '购物', '娱乐', '测试', '临时', '常用'];
  popular.forEach(name => {
    if (tagDefs[name]) return;
    const attrs = Utils.getRandomTagAttrs(tagDefs);
    tagDefs[name] = { color: attrs.color, icon: attrs.icon, isDefault: false };
  });
  return tagDefs;
}

/**
 * 将旧版本 vault 数据迁移为「统一标签」模型（幂等）
 * - 旧 `categories` + `entry.category` 升级为 `tagDefs` + `entry.tags`
 * - 所有标签补齐颜色/图标定义
 * @param {Object} data - 解密后的旧负载
 * @returns {{ entries, tagDefs, tags, deleted, changed }}
 */
function migrateVaultData(data) {
  data = data || {};
  const tagDefs = {};
  let changed = false;

  // 默认推荐标签 → 标签定义（保证默认标签颜色/图标一致保留）
  DEFAULT_TAGS.forEach(t => {
    tagDefs[t.name] = { color: t.color, icon: t.icon, isDefault: true };
  });
  // 旧分类（含自定义）→ 升级为标签定义
  const legacyCategories = data.categories || [];
  legacyCategories.forEach(c => {
    tagDefs[c.name] = { color: c.color, icon: c.icon, isDefault: true };
  });

  // 已有 tagDefs（前向兼容）
  if (data.tagDefs) {
    Object.keys(data.tagDefs).forEach(name => {
      if (!tagDefs[name]) tagDefs[name] = data.tagDefs[name];
    });
  }

  const migrateEntry = (e) => {
    const tags = e.tags ? e.tags.slice() : [];
    if (e.category) {
      const cat = legacyCategories.find(c => c.id === e.category);
      const catName = cat ? cat.name : e.category;
      if (!tags.includes(catName)) tags.push(catName);
      changed = true;
    }
    // 旧条目无 entryType 默认为 website
    if (!e.entryType) e.entryType = 'website';
    const { category, ...rest } = e;
    rest.tags = tags;
    // 补齐标签定义
    (rest.tags || []).forEach(t => {
      if (!tagDefs[t]) {
        const attrs = Utils.getRandomTagAttrs(tagDefs);
        tagDefs[t] = { color: attrs.color, icon: attrs.icon, isDefault: false };
      }
    });
    return rest;
  };

  const entries = (data.entries || []).map(migrateEntry);
  const deleted = (data.deleted || []).map(migrateEntry);

  // 旧有分类且无 tagDefs → 视为发生了迁移
  if (legacyCategories.length && !data.tagDefs) changed = true;

  return {
    entries,
    tagDefs,
    tags: data.tags || [],
    deleted,
    changed
  };
}

/* ═══════════════════════════════════════════════════════════════════
   保险箱管理
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 检查保险箱是否已初始化
 * @returns {Promise<boolean>}
 */
async function isVaultInitialized() {
  await DBUtils.openDB();
  const saltRecord = await DBUtils.dbGet(DBUtils.STORE_META, 'salt');
  return !!saltRecord;
}

/**
 * 创建保险箱
 * @param {string} password - 主密码
 * @returns {Promise<{salt: Uint8Array, key: CryptoKey}>}
 */
async function createVault(password) {
  const salt = CryptoUtils.generateSalt();
  const saltBase64 = CryptoUtils.arrayBufferToBase64(salt);
  const key = await CryptoUtils.deriveKey(password, salt);
  
  const initialData = {
    entries: [],
    tagDefs: seedDefaultTagDefs(),
    tags: [],
    deleted: []
  };
  
  const { iv, data } = await CryptoUtils.encrypt(initialData, key);
  
  await DBUtils.dbPut(DBUtils.STORE_META, { key: 'salt', value: saltBase64 });
  await DBUtils.dbPut(DBUtils.STORE_META, { key: 'iterations', value: 100000 });
  await DBUtils.dbPut(DBUtils.STORE_META, { key: 'version', value: 1 });
  await DBUtils.dbPut(DBUtils.STORE_VAULT, { id: 'main', iv, data });
  
  // 已绑定本地目录则同步写入文件（未绑定时内部静默跳过）
  await FileSync.syncNow();
  
  return { salt, key };
}

/**
 * 解锁保险箱
 * @param {string} password - 主密码
 * @returns {Promise<{key: CryptoKey, data: Object}>}
 */
async function unlockVault(password) {
  const saltRecord = await DBUtils.dbGet(DBUtils.STORE_META, 'salt');
  if (!saltRecord) {
    throw new Error('未找到保险箱数据');
  }
  
  const salt = CryptoUtils.base64ToArrayBuffer(saltRecord.value);
  const key = await CryptoUtils.deriveKey(password, new Uint8Array(salt));
  
  const vaultRecord = await DBUtils.dbGet(DBUtils.STORE_VAULT, 'main');
  if (!vaultRecord) {
    throw new Error('未找到加密数据');
  }
  
  try {
    const decrypted = await CryptoUtils.decrypt(vaultRecord.data, vaultRecord.iv, key);
    return { key, data: decrypted };
  } catch (e) {
    throw new Error('密码错误');
  }
}

/**
 * 保存保险箱
 */
async function saveVault() {
  if (!AppState.cryptoKey) return;
  
  const { iv, data } = await CryptoUtils.encrypt(
    {
      entries: AppState.entries,
      tagDefs: AppState.tagDefs,
      tags: AppState.tags,
      deleted: AppState.deleted
    },
    AppState.cryptoKey
  );
  
  await DBUtils.dbPut(DBUtils.STORE_VAULT, { id: 'main', iv, data });
  
  // 同步到本地文件（已绑定时；失败不阻断主流程）
  await FileSync.syncNow();
}

/* ═══════════════════════════════════════════════════════════════════
   锁定 / 退出
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 锁定保险箱（显示锁定屏幕，清除会话，刷新后需重新输入密码）
 */
function lockVault() {
  try {
    AppState.isUnlocked = false;
    AppState.cryptoKey = null;
    clearSession(); // 清除 sessionStorage，刷新后需重新输入密码
    
    clearTimeout(AppState.lockTimer);
    
    showLockScreen();
    
    // 重置表单
    document.getElementById('master-password').value = '';
    document.getElementById('confirm-password').value = '';
    document.getElementById('confirm-pw-group').classList.add('hidden');
    document.getElementById('unlock-btn').disabled = false;
    document.getElementById('lock-title').textContent = '密码保险箱';
    document.getElementById('lock-subtitle').textContent = '输入主密码解锁您的密码库';
    document.getElementById('lock-error').classList.add('hidden');
    
    // 关闭详情面板
    if (typeof closeDetailPanel === 'function') {
      closeDetailPanel();
    }
  } catch (e) {
    // 兜底：即使 UI 清理出错也确保会话已清除、界面切回锁定屏
    console.error('[LockPass] 锁定流程异常:', e);
    AppState.isUnlocked = false;
    clearSession();
    const lockScreen = document.getElementById('lock-screen');
    const appEl = document.getElementById('app-shell');
    if (lockScreen) lockScreen.classList.remove('hidden');
    if (appEl) appEl.classList.add('hidden');
    if (window.LockParticles) window.LockParticles.start();
  }
}

/**
 * 退出登录（清除会话，需要重新输入密码）
 */
function logout() {
  // 清除会话密码
  clearSession();
  
  // 清除敏感状态
  AppState.cryptoKey = null;
  AppState.isUnlocked = false;
  AppState.entries = [];
  AppState.tagDefs = {};
  AppState.tags = [];
  
  // 清除自动锁定定时器
  if (AppState.lockTimer) {
    clearTimeout(AppState.lockTimer);
    AppState.lockTimer = null;
  }
  
  // 显示锁定屏幕
  showLockScreen();
  
  // 重置锁定屏幕表单
  const pwInput = document.getElementById('master-password');
  const confirmInput = document.getElementById('confirm-password');
  const btn = document.getElementById('unlock-btn');
  const btnText = document.getElementById('unlock-btn-text');
  const errorEl = document.getElementById('lock-error');
  
  if (pwInput) pwInput.value = '';
  if (confirmInput) confirmInput.value = '';
  if (btn) btn.disabled = false;
  if (btnText) btnText.textContent = '解锁';
  if (errorEl) errorEl.classList.add('hidden');
  
  // 重置标题
  document.getElementById('lock-title').textContent = '密码保险箱';
  document.getElementById('lock-subtitle').textContent = '输入主密码解锁您的密码库';
  document.getElementById('confirm-pw-group').classList.add('hidden');
  
  Utils.showToast('已退出登录', 'success');
}

/* ═══════════════════════════════════════════════════════════════════
   自动锁定
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 重置锁定定时器
 */
function resetLockTimer() {
  clearTimeout(AppState.lockTimer);
  if (AppState.lockTimeoutMs > 0) {
    AppState.lockTimer = setTimeout(lockVault, AppState.lockTimeoutMs);
  }
}

// 监听用户活动
// mousemove 需节流：仅当坐标变化且距上次重置超过 10s 才重置定时器，
// 避免触控板悬停/鼠标微动持续触发 mousemove 导致倒计时永远无法走完
let _lastMouseResetAt = 0;
let _lastMousePos = '';
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(event => {
  document.addEventListener(event, (e) => {
    if (!AppState.isUnlocked) return;
    if (event === 'mousemove') {
      const now = Date.now();
      const pos = (e.clientX || 0) + ',' + (e.clientY || 0);
      if (pos === _lastMousePos || now - _lastMouseResetAt < 10000) return;
      _lastMousePos = pos;
      _lastMouseResetAt = now;
    }
    resetLockTimer();
  }, { passive: true });
});

/* ═══════════════════════════════════════════════════════════════════
   UI 控制
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 显示锁定屏幕
 */
function showLockScreen() {
  document.getElementById('lock-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  if (window.LockParticles) window.LockParticles.start();
}

/**
 * 显示主应用
 */
function showApp() {
  document.getElementById('lock-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  if (window.LockParticles) window.LockParticles.stop();
}

/**
 * 解锁成功后的处理
 */
async function afterUnlock() {
  showApp();
  closeModal();
  // 从 URL hash 恢复筛选状态
  const savedFilter = UI.restoreFilterFromHash();
  if (savedFilter && savedFilter !== 'all') {
    App.state.currentFilter = savedFilter;
  }
  renderSidebar();
  renderEntries();
  resetLockTimer();
  
  // 清空密码输入框，重置按钮状态
  const pwInput = document.getElementById('master-password');
  const confirmInput = document.getElementById('confirm-password');
  const btn = document.getElementById('unlock-btn');
  const btnText = document.getElementById('unlock-btn-text');
  const errorEl = document.getElementById('lock-error');
  
  if (pwInput) pwInput.value = '';
  if (confirmInput) confirmInput.value = '';
  if (btn) btn.disabled = false;
  if (btnText) btnText.textContent = '解锁';
  if (errorEl) errorEl.classList.add('hidden');
}

/**
 * 打开模态框
 */
function openModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');

  // ── 焦点陷阱：Tab 键循环在模态框内，Escape 关闭 ──────────────
  const modal = document.getElementById('modal');
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // 保存关闭前焦点的元素，关闭后还原
  const prevFocus = document.activeElement;

  const trapHandler = (e) => {
    if (e.key !== 'Tab' && e.key !== 'Escape') return;
    if (e.key === 'Escape') { closeModal(); return; }

    const focusables = [...modal.querySelectorAll(FOCUSABLE)];
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey) {
      // Shift+Tab：从第一个跳到最后一个
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab：从最后一个跳到第一个
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  overlay.addEventListener('keydown', trapHandler);
  overlay._trapHandler = trapHandler;
  overlay._prevFocus = prevFocus;

  // 聚焦第一个可聚焦元素
  const firstFocusable = modal.querySelector(FOCUSABLE);
  if (firstFocusable) firstFocusable.focus();
}

/**
 * 关闭模态框
 */
function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay._trapHandler) {
    overlay.removeEventListener('keydown', overlay._trapHandler);
    overlay._trapHandler = null;
  }
  overlay.classList.add('hidden');

  // 还原关闭前焦点的元素
  const prevFocus = overlay._prevFocus;
  if (prevFocus && prevFocus.focus) {
    try { prevFocus.focus(); } catch {}
  }
  overlay._prevFocus = null;
}

/**
 * 处理遮罩层点击（已禁用：点击遮罩层不再关闭窗口，防止误操作）
 */
function handleOverlayClick(event) {
  // 点击遮罩层不关闭窗口，必须通过「取消」或「保存」按钮关闭
}

/**
 * 抖动并显示错误
 */
function shakeAndShowError(msg) {
  const input = document.getElementById('master-password');
  const errorEl = document.getElementById('lock-error');
  const form = document.getElementById('lock-form');
  
  form.classList.remove('shake');
  void form.offsetWidth; // 触发重绘
  form.classList.add('shake');
  
  input.classList.add('error');
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
  
  setTimeout(() => {
    input.classList.remove('error');
  }, 600);
}

/* ═══════════════════════════════════════════════════════════════════
   解锁处理
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 处理解锁按钮点击
 * @param {string} [autoPassword] - 自动解锁时传入主密码，省略则读取输入框
 */
async function handleUnlock(autoPassword) {
  const pwInput = document.getElementById('master-password');
  const confirmInput = document.getElementById('confirm-password');
  const confirmGroup = document.getElementById('confirm-pw-group');
  const errorEl = document.getElementById('lock-error');
  const btnText = document.getElementById('unlock-btn-text');
  const btn = document.getElementById('unlock-btn');
  
  const password = autoPassword || pwInput.value;
  if (!password) {
    shakeAndShowError('请输入主密码');
    return;
  }
  
  btn.disabled = true;
  btnText.textContent = '…';
  errorEl.classList.add('hidden');
  
  let initialized = false;
  try {
    initialized = await isVaultInitialized();
    
    if (!initialized) {
      // 首次使用：创建保险箱
      const confirmPw = confirmInput.value;
      if (password.length < 8) {
        shakeAndShowError('主密码至少需要 8 位');
        btnText.textContent = '创建';
        btn.disabled = false;
        return;
      }
      if (password !== confirmPw) {
        // 区分「确认框未输入」与「两框输入不一致」，便于识别浏览器自动填充干扰
        shakeAndShowError(confirmPw ? '两次密码不一致' : '请再次输入确认密码');
        btnText.textContent = '创建';
        btn.disabled = false;
        return;
      }
      
      btnText.textContent = '创建中…';
      const { key } = await createVault(password);
      AppState.cryptoKey = key;
      AppState.isUnlocked = true;
      AppState.entries = [];
      AppState.tagDefs = seedDefaultTagDefs();
      AppState.tags = [];
      AppState.deleted = [];
      
      // 保存会话密码（刷新后自动恢复）
      saveSession(password);
      
      await afterUnlock();
      // 首次创建成功后，若未绑定数据目录则引导绑定（防止数据丢失）
      await showBindBannerIfNeeded();
    } else {
      // 解锁已有保险箱
      btnText.textContent = '解密中…';
      const { key, data } = await unlockVault(password);
      AppState.cryptoKey = key;
      AppState.isUnlocked = true;
      const migrated = migrateVaultData(data);
      AppState.entries = migrated.entries;
      AppState.tagDefs = migrated.tagDefs;
      AppState.tags = migrated.tags;
      AppState.deleted = migrated.deleted;
      // 迁移后写回新格式（分类 -> 统一标签），老代码无法再读取本 vault
      if (migrated.changed) {
        await App.saveVault();
      }
      
      // 保存会话密码（刷新后自动恢复）
      saveSession(password);
      
      await afterUnlock();
      // 解锁已有保险箱后，若未绑定数据目录且本会话未提示过则引导绑定
      await showBindBannerIfNeeded();
    }
  } catch (e) {
    shakeAndShowError(e.message || '密码错误');
    btnText.textContent = initialized ? '解锁' : '创建';
    btn.disabled = false;
  }
}

/**
 * 若未绑定数据目录则在页面顶部显示醒目横幅（替代弹窗，更可靠更显眼）
 * 触发场景：首次创建保险箱 + 解锁已有保险箱；已绑定数据目录则不显示
 * 「暂不」后本次会话不再显示（sessionStorage 键 lp_bind_prompted，异常时降级为内存变量），
 * 刷新页面 / 重新登录后仍会再次提醒
 * 同一时刻只保留一个横幅实例；任何异常静默忽略，不阻塞用户进入工作区
 */
let _bindBannerDismissedFallback = false; // sessionStorage 不可用时的内存降级标记
async function showBindBannerIfNeeded() {
  // macOS 桌面应用：数据已自动保存在本地文件（应用数据目录），
  // 且 WebView 无文件系统访问权限，无需也无法绑定数据目录 → 不显示绑定横幅
  if (window.FileStore && window.FileStore.isTauri &&
      navigator.platform.toUpperCase().indexOf('MAC') >= 0) {
    return;
  }
  try {
    // 本会话已点过「暂不」则不再显示：优先读 sessionStorage 标记，异常时用内存变量
    let dismissed = false;
    try {
      dismissed = !!sessionStorage.getItem('lp_bind_prompted');
    } catch (e) {
      dismissed = _bindBannerDismissedFallback;
    }
    if (dismissed) return;

    // 同一时刻只保留一个横幅实例：先移除旧的再创建
    const old = document.getElementById('lp-bind-banner');
    if (old) old.remove();

    const handle = await FileSync.getDirHandle();
    if (handle) return; // 已绑定数据目录，不显示横幅

    const unsupported = !FileSync.isSupported();
    const banner = document.createElement('div');
    banner.id = 'lp-bind-banner';
    banner.setAttribute('role', 'alert');

    const text = unsupported
      ? '当前浏览器不支持本地文件同步，请使用 Chrome / Edge 打开本页面后绑定数据目录'
      : '建议绑定数据目录：绑定后每次修改密码库会自动写入加密的 LockPass-vault.json 文件，即使浏览器清空缓存，数据也不会丢失';

    banner.innerHTML =
      '<div class="lp-bind-banner-inner">' +
        '<span class="lp-bind-banner-text">' + Utils.escHtml(text) + '</span>' +
        '<span class="lp-bind-banner-actions">' +
          (unsupported ? '' : '<button class="btn btn-primary btn-sm" id="lp-bind-banner-bind">立即绑定</button>') +
          '<button class="btn btn-secondary btn-sm" id="lp-bind-banner-dismiss">暂不</button>' +
        '</span>' +
      '</div>';

    document.body.insertBefore(banner, document.body.firstChild);

    const bindBtn = document.getElementById('lp-bind-banner-bind');
    if (bindBtn) {
      bindBtn.addEventListener('click', async () => {
        try {
          await Settings.bindDataDirectory();
          // 仅当确认已保存目录句柄（绑定成功）才移除横幅并刷新状态；用户取消/失败时保留横幅，允许再次尝试
          const bound = await FileSync.getDirHandle();
          if (bound) {
            banner.remove();
            if (typeof refreshFileSyncStatus === 'function') refreshFileSyncStatus();
          }
        } catch (e) {
          // 绑定失败：保留横幅，允许再次尝试
        }
      });
    }

    const dismissBtn = document.getElementById('lp-bind-banner-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        banner.remove();
        try { sessionStorage.setItem('lp_bind_prompted', '1'); } catch (e) { _bindBannerDismissedFallback = true; }
      });
    }
  } catch (e) {
    // 静默忽略：横幅展示失败不阻塞用户进入工作区
  }
}

/**
 * 切换密码可见性（锁定屏幕）
 */
function toggleLockPw() {
  const input = document.getElementById('master-password');
  const icon = document.getElementById('lock-eye-icon');

  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = Utils.SvgIcons.eyeClosedPaths;
  } else {
    input.type = 'password';
    icon.innerHTML = Utils.SvgIcons.eyeOpenPaths;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   标签管理
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 获取标签使用量（按条目数量排序）
 * @returns {Object} { [tagName]: count }
 */
function getTagCounts() {
  const counts = {};
  AppState.entries.forEach(entry => {
    (entry.tags || []).forEach(t => {
      counts[t] = (counts[t] || 0) + 1;
    });
  });
  return counts;
}

/**
 * 获取热门标签（按使用频率排序，最多显示指定数量）
 * @param {number} limit - 最多返回数量
 * @returns {string[]} 标签名数组
 */
function getTopTags(limit = 8) {
  const counts = getTagCounts();
  return Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
    .slice(0, limit);
}

/**
 * 添加标签到注册表（若不存在则自动分配颜色和图标）
 * @param {string} name - 标签名
 * @param {Object} [attrs] - 可选：{ color, icon }
 */
function registerTag(name, attrs) {
  if (!AppState.tagDefs) AppState.tagDefs = {};
  if (!AppState.tagDefs[name]) {
    const def = attrs || Utils.getRandomTagAttrs(AppState.tagDefs);
    AppState.tagDefs[name] = { color: def.color, icon: def.icon, isDefault: false };
  }
}

/**
 * 删除标签（仅从注册表删除，不影响已有条目）
 * @param {string} name - 标签名
 */
function unregisterTag(name) {
  if (!AppState.tagDefs) return;
  delete AppState.tagDefs[name];
}

// 导出模块
window.App = {
  version: APP_VERSION,
  state: AppState,
  ENTRY_TYPES,
  isVaultInitialized,
  createVault,
  unlockVault,
  saveVault,
  lockVault,
  logout,
  resetLockTimer,
  showLockScreen,
  showApp,
  openModal,
  closeModal,
  handleOverlayClick,
  handleUnlock,
  toggleLockPw,
  showBindBannerIfNeeded,
  saveSession,
  getSession,
  clearSession,
  getTagCounts,
  getTopTags,
  registerTag,
  unregisterTag,
};
