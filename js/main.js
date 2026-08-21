/* ═══════════════════════════════════════════════════════════════════
   LockPass — 主初始化模块
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 应用初始化
 */
async function init() {
  // 安全清理：移除旧版本「记住主密码」功能遗留的明文（功能已下线）
  localStorage.removeItem('lp_remember_pw');

  // 清除「暂不」标记：刷新/重新进入页面后，未绑定数据目录时仍会再次显示顶部提醒横幅
  try {
    sessionStorage.removeItem('lp_bind_prompted');
  } catch (e) {
    // 忽略：sessionStorage 不可用时横幅降级为每页面一次
  }

  // 环境检测：Web Crypto（crypto.subtle）仅在 secure context 可用
  // （https / localhost / file://）；http 非 localhost 下加密功能不可用，
  // 直接阻断并提示，避免创建/解锁在加密环节报莫名错误
  if (!window.isSecureContext) {
    const errorEl = document.getElementById('lock-error');
    const btn = document.getElementById('unlock-btn');
    const isFileProtocol = window.location.protocol === 'file:';
    if (errorEl) {
      if (isFileProtocol) {
        errorEl.textContent = '本地文件环境（file://）加密功能受限。建议使用本地 HTTP 服务器（python -m http.server）以获得最佳体验，或双击 index.html 直接运行。';
      } else {
        errorEl.textContent = '当前通过 http 访问，浏览器禁用了加密功能（Web Crypto）。请改用 https 访问，或本地双击 index.html 使用。';
      }
      errorEl.classList.remove('hidden');
    }
    if (btn) btn.disabled = true;
    return;
  }

  // 恢复热门标签折叠状态（本地持久化，默认展开）
  applyTagSectionState();

  // 初始化快捷键
  SearchShortcuts.initKeyboardShortcuts();
  
  // 检查是否已初始化保险箱
  try {
    const initialized = await App.isVaultInitialized();
    
    if (initialized) {
      // 已有保险箱，显示解锁界面
      document.getElementById('lock-title').textContent = '密码保险箱';
      document.getElementById('lock-subtitle').textContent = '输入主密码解锁您的密码库';
      document.getElementById('unlock-btn-text').textContent = '解锁';
      // 解锁场景：主密码框标记为已存密码，允许浏览器密码管理器填充
      document.getElementById('master-password').setAttribute('autocomplete', 'current-password');
      
      // 检查 sessionStorage 是否有会话密码（刷新后自动恢复）
      const sessionPw = App.getSession();
      if (sessionPw) {
        pwInputAutoFill(sessionPw);
        await App.handleUnlock(sessionPw);
      }
    } else {
      // 首次使用，显示创建界面（直接展示主密码 + 确认密码两个输入框，一步创建）
      document.getElementById('lock-title').textContent = '创建密码保险箱';
      document.getElementById('lock-subtitle').textContent = '设置一个强主密码来保护您的所有密码';
      document.getElementById('unlock-btn-text').textContent = '创建';
      document.getElementById('confirm-pw-group').classList.remove('hidden');

      // 明确告知浏览器这是「新密码」输入框，并清空可能的自动填充值，
      // 避免网页环境下浏览器密码管理器/生成器向两个框填入不同值导致「两次密码不一致」
      const masterInput = document.getElementById('master-password');
      const confirmInput = document.getElementById('confirm-password');
      masterInput.setAttribute('autocomplete', 'new-password');
      confirmInput.setAttribute('autocomplete', 'new-password');
      masterInput.value = '';
      confirmInput.value = '';
      // 移动端浏览器/密码管理器常在页面加载完成后异步填充（晚于上方同步清空），
      // 延迟再清空一次；仅当两个框均未被聚焦时执行，避免误清用户已输入内容
      setTimeout(function () {
        if (document.activeElement !== masterInput && document.activeElement !== confirmInput) {
          masterInput.value = '';
          confirmInput.value = '';
        }
      }, 250);
      
      // 首次使用且 IndexedDB 为空时，始终提供「从本地文件恢复」入口
      // （使用 <input type="file">，所有浏览器均可用）
      document.getElementById('restore-file-btn').classList.remove('hidden');
      // 浏览器环境额外提供「绑定已有数据目录」：目录中存在 LockPass-vault.json
      // 时可直接恢复并绑定（Tauri 桌面版数据在本地文件，无需目录绑定，不显示）
      if (!(window.FileStore && window.FileStore.isTauri) && FileSync.isSupported()) {
        document.getElementById('bind-restore-btn').classList.remove('hidden');
      }

      // 显示主密码强度指示
      renderMasterPwStrength();
    }
  } catch (e) {
    console.error('初始化失败:', e);
    Utils.showToast('初始化失败，请刷新页面重试', 'error');
  }
}

/**
 * 自动解锁时将记住的主密码填入输入框（界面可见）
 */
function pwInputAutoFill(pw) {
  const input = document.getElementById('master-password');
  if (input) input.value = pw;
}

/**
 * 从本地文件恢复（IndexedDB 为空时使用）
 * 用户选择 .vault 导出备份或 LockPass-vault.json 同步文件 → 读取加密负载
 * → 重建 IndexedDB → 进入解锁界面（输入主密码后即可解密使用）
 */
function restoreFromLocalFile() {
  const input = document.getElementById('restore-file-input');
  if (input) input.click();
}

/**
 * 处理恢复文件选择：校验格式并重建 IndexedDB
 */
async function handleRestoreFileSelect(event) {
  const file = event.target.files[0];
  event.target.value = ''; // 允许重复选择同一文件
  if (!file) return;

  try {
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error('文件解析失败，可能不是有效的 LockPass 备份');
    }
    if (!payload.salt || !payload.iv || !payload.data) {
      throw new Error('文件格式不正确，不是有效的 LockPass 备份');
    }

    // 重建 IndexedDB（不绑定目录，一次性恢复）
    await FileSync.restorePayload(payload);
    switchToUnlockAfterRestore('已从本地文件恢复，输入主密码解锁');
    Utils.showToast('已从本地文件恢复数据', 'success');
  } catch (e) {
    Utils.showToast(e.message || '恢复失败', 'error');
  }
}

/**
 * 绑定已有数据目录并恢复（IndexedDB 为空、目录中已有 LockPass-vault.json 时使用）
 * 与「从本地文件恢复」的区别：恢复的同时完成目录绑定，后续修改自动同步
 */
async function bindRestoreFromDirectory() {
  if (!FileSync.isSupported()) {
    Utils.showToast('当前浏览器不支持文件系统访问 API，请使用 Chrome / Edge', 'error');
    return;
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    return; // 用户取消选择
  }
  try {
    // 仅当目录中已有同步文件才恢复+绑定；避免绑定空目录导致后续困惑
    const existingFile = await FileSync._getExistingSyncFile(handle);
    if (!existingFile) {
      Utils.showToast('所选目录中没有 LockPass-vault.json，无法恢复', 'error');
      return;
    }
    await FileSync.restoreFromDirectory(handle);
    switchToUnlockAfterRestore('已从绑定目录恢复，输入主密码解锁');
    Utils.showToast('已绑定数据目录并恢复数据', 'success');
  } catch (e) {
    Utils.showToast(e.message || '绑定恢复失败', 'error');
  }
}

/** 恢复成功后切换为解锁界面（两个恢复入口共用） */
function switchToUnlockAfterRestore(subtitle) {
  document.getElementById('lock-title').textContent = '密码保险箱';
  document.getElementById('lock-subtitle').textContent = subtitle;
  document.getElementById('unlock-btn-text').textContent = '解锁';
  document.getElementById('confirm-pw-group').classList.add('hidden');
  document.getElementById('restore-file-btn').classList.add('hidden');
  document.getElementById('bind-restore-btn').classList.add('hidden');
  document.getElementById('lock-error').classList.add('hidden');
}

/**
 * 页面加载完成后初始化
 */
document.addEventListener('DOMContentLoaded', init);

/**
 * 绑定事件监听
 */
document.addEventListener('DOMContentLoaded', () => {
  // 解锁按钮
  document.getElementById('unlock-btn').addEventListener('click', App.handleUnlock);
  
  // 主密码输入框回车
  document.getElementById('master-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      App.handleUnlock();
    }
  });
  
  // 确认密码输入框回车
  document.getElementById('confirm-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      App.handleUnlock();
    }
  });
  
  // 模态框遮罩层点击（已禁用：点击遮罩层不再关闭窗口，防止误操作）
  // document.getElementById('modal-overlay').addEventListener('click', App.handleOverlayClick);
  
  // 全局搜索
  document.getElementById('global-search').addEventListener('input', SearchShortcuts.handleSearch);
});

// 全局函数绑定（用于 HTML onclick）
window.handleUnlock = App.handleUnlock;
window.toggleLockPw = App.toggleLockPw;
window.setFilter = UI.setFilter;
window.selectEntry = Entries.selectEntry;
window.closeDetailPanel = Entries.closeDetailPanel;
window.toggleDetailPassword = Entries.toggleDetailPassword;
window.copyDetailPassword = Entries.copyDetailPassword;
window.copyPassword = Entries.copyPassword;
window.copyField = Entries.copyField;
window.toggleFavorite = Entries.toggleFavorite;
window.editCurrentEntry = Entries.editCurrentEntry;
window.deleteCurrentEntry = Entries.deleteCurrentEntry;
window.restoreEntry = Entries.restoreEntry;
window.permanentDeleteEntry = Entries.permanentDeleteEntry;
window.emptyRecycleBin = Entries.emptyRecycleBin;
window.openEntryModal = EntryEditor.openEntryModal;
window.toggleEntryPwVisibility = EntryEditor.toggleEntryPwVisibility;
window.toggleGenPanel = EntryEditor.toggleGenPanel;
window.generateNewPassword = EntryEditor.generateNewPassword;
window.useGeneratedPassword = EntryEditor.useGeneratedPassword;
window.updateStrengthBar = EntryEditor.updateStrengthBar;
window.saveEntry = EntryEditor.saveEntry;
window.openExportModal = ImportExport.openExportModal;
window.exportVault = ImportExport.exportVault;
window.exportCSV = ImportExport.exportCSV;
window.openImportModal = ImportExport.openImportModal;
window.handleFileDrop = ImportExport.handleFileDrop;
window.handleFileSelect = ImportExport.handleFileSelect;
window.processFile = ImportExport.processFile;
window.confirmImport = ImportExport.confirmImport;
window.openSettingsModal = Settings.openSettingsModal;
window.updateLockTimeout = Settings.updateLockTimeout;
window.updateClipboardClear = Settings.updateClipboardClear;
window.openChangePasswordModal = Settings.openChangePasswordModal;
window.changePassword = Settings.changePassword;
window.destroyVault = Settings.destroyVault;
window.restoreFromLocalFile = restoreFromLocalFile;
window.handleRestoreFileSelect = handleRestoreFileSelect;

// 「添加密码」下拉菜单
window.toggleAddDropdown = function (e) {
  e.stopPropagation();
  const menu = document.getElementById('add-dropdown-menu');
  if (!menu) return;
  const willOpen = menu.classList.contains('hidden');
  closeAddDropdown();
  if (willOpen) menu.classList.remove('hidden');
};
window.closeAddDropdown = function () {
  const menu = document.getElementById('add-dropdown-menu');
  if (menu) menu.classList.add('hidden');
};
document.addEventListener('click', function (e) {
  const dd = document.getElementById('add-entry-dropdown');
  if (dd && !dd.contains(e.target)) closeAddDropdown();
});

// 热门标签折叠/展开（UI 偏好，localStorage 持久化；默认展开）
const TAGS_COLLAPSE_KEY = 'lockpass_tags_collapsed';
function applyTagSectionState() {
  const nav = document.getElementById('nav-categories');
  if (!nav) return;
  let collapsed = false;
  try { collapsed = localStorage.getItem(TAGS_COLLAPSE_KEY) === '1'; } catch (e) {}
  nav.classList.toggle('collapsed', collapsed);
  const toggle = document.getElementById('tags-toggle');
  const chevron = toggle ? toggle.querySelector('.tag-chevron') : null;
  if (chevron) chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
}
window.toggleTagSection = function () {
  const nav = document.getElementById('nav-categories');
  if (!nav) return;
  const collapsed = nav.classList.contains('collapsed');
  nav.classList.toggle('collapsed', !collapsed);
  const toggle = document.getElementById('tags-toggle');
  const chevron = toggle ? toggle.querySelector('.tag-chevron') : null;
  if (chevron) chevron.style.transform = collapsed ? '' : 'rotate(-90deg)';
  try { localStorage.setItem(TAGS_COLLAPSE_KEY, collapsed ? '0' : '1'); } catch (e) {}
};

/**
 * 渲染主密码强度指示（仅首次创建界面显示）
 * 解锁场景（confirm-pw-group 隐藏）无论密码是否为空都不显示强度提示
 */
function renderMasterPwStrength() {
  const wrap = document.getElementById('master-pw-strength-wrap');
  if (!wrap) return;

  // 解锁场景判断：确认密码输入框不可见（confirm-pw-group 含 hidden）即为解锁界面
  const confirmPwGroup = document.getElementById('confirm-pw-group');
  if (confirmPwGroup && confirmPwGroup.classList.contains('hidden')) {
    wrap.classList.add('hidden');
    return;
  }

  const pw = document.getElementById('master-password')?.value || '';
  if (!pw) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const s = PasswordGenerator.calcStrength(pw);
  const bar = document.getElementById('master-pw-strength-bar');
  const txt = document.getElementById('master-pw-strength-text');
  if (bar) {
    bar.style.width = s.pct + '%';
    bar.style.background = s.color;
  }
  if (txt) {
    txt.textContent = `密码强度：${s.label}`;
    txt.style.color = s.color;
  }
}

window.renderMasterPwStrength = renderMasterPwStrength;
