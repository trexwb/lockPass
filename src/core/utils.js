/* ═══════════════════════════════════════════════════════════════════
   LockPass — 工具函数模块
   ═══════════════════════════════════════════════════════════════════ */

/* i18n：弹窗默认文案在调用时求值（window.I18n 由 core/i18n.js 挂载） */
const t = (k, p) => window.I18n.t(k, p);

/* Toast 反馈定时器时长（毫秒） */
const TOAST_VISIBLE_DURATION = 3000; // 显示时长
const TOAST_FADE_OUT_DELAY = 300;    // 淡出结束后移除延迟

/**
 * P3-6 修复：标签颜色白名单校验——仅放行 #RGB / #RRGGBB 十六进制色值。
 * 导入的恶意 vault 的 tagDefs.color 可能注入任意 CSS/SVG 属性，校验失败回落灰色。
 * @param {string} color - 待校验的颜色值
 * @param {string} [fallback] - 校验失败时的回落色
 * @returns {string} 安全的颜色值
 */
function safeTagColor(color, fallback) {
  if (color && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(color))) return color
  return fallback || '#8b949e'
}

/**
 * 获取分类图标 SVG
 * @param {string} iconId - 图标 ID
 * @param {string} [color] - 图标颜色
 * @returns {string} SVG HTML
 */
function getCategoryIcon(iconId, color) {
  // P3-6 修复：颜色入 SVG 属性前先过白名单（null 时走 currentColor）
  color = color ? safeTagColor(color) : null
  const icons = {
    social: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    email: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    finance: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    work: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
    dev: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    life: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    other: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
    bookmark: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
    star: `<svg width="15" height="15" viewBox="0 0 24 24" fill="${color || 'currentColor'}" stroke="${color || 'currentColor'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    key: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`,
    lock: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    cloud: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`,
    globe: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    shield: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    heart: `<svg width="15" height="15" viewBox="0 0 24 24" fill="${color || 'currentColor'}" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
    tag: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
    folder: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  };
  return icons[iconId] || icons.other;
}

/**
 * 获取分类图标颜色（CSS 变量，与暗色主题协调）
 * @param {string} iconId - 图标 ID
 * @returns {string} CSS 颜色变量
 */
function getCategoryColor(iconId) {
  const colors = {
    social: 'var(--cat-social)',
    email: 'var(--cat-email)',
    finance: 'var(--cat-finance)',
    work: 'var(--cat-work)',
    dev: 'var(--cat-dev)',
    life: 'var(--cat-life)',
    other: 'var(--cat-other)'
  };
  return colors[iconId] || colors.other;
}

/**
 * HTML 转义
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 格式化日期
 * @param {string} iso - ISO 8601 日期字符串
 * @returns {string} 格式化后的日期
 */
function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * 格式化日期（用于文件名）
 * @param {Date} date
 * @returns {string} YYYYMMDD 格式
 */
function formatDateFilename(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * 下载文件
 * @param {string} filename - 文件名
 * @param {string} content - 文件内容
 * @param {string} type - MIME 类型
 */
function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * 打开外部链接（跨端统一入口）
 * Tauri 桌面：调用 Rust 命令 open_url（协议/字符白名单校验）交由系统默认
 * 浏览器打开；命令失败时降级为新窗口打开。
 * 浏览器：window.open 原行为。
 * 替代裸 window.open —— Tauri WebView 中 target=_blank 静默失败且不会调起
 * 系统浏览器，tauri-bridge 的 click 委托只拦截 <a target="_blank">，脚本
 * 内 window.open 必须显式走本入口。
 * @param {string} url - 外部链接
 * @returns {Promise<void>}
 */
async function openExternal(url) {
  if (!url) return;
  let u = String(url);
  if (!/^https?:\/\//i.test(u) && !/^mailto:/i.test(u)) u = 'https://' + u;
  const LT = window.LockTauri || {};
  if (LT.isTauri && typeof LT.invoke === 'function') {
    try {
      await LT.invoke('open_url', { url: u });
      return;
    } catch (e) {
      console.error('[LockPass] open_url 命令失败，降级新窗口:', e);
    }
  }
  window.open(u, '_blank', 'noopener,noreferrer');
}

/**
 * 复制文本到剪贴板（跨端统一入口）
 * Tauri 桌面优先走 LockClipboard（macOS 主线程 arboard 命令，绕开 WebKit
 * 竞态与无手势场景权限问题；其余平台走已覆盖的 plugin shim）。
 * 浏览器回退 navigator.clipboard.writeText。
 * @param {string|number|null|undefined} text
 * @returns {Promise<void>}
 */
async function copyText(text) {
  const value = String(text == null ? '' : text);
  if (window.LockClipboard && typeof window.LockClipboard.write === 'function') {
    return window.LockClipboard.write(value);
  }
  return navigator.clipboard.writeText(value);
}

/**
 * 从剪贴板读取文本（跨端统一入口）
 * macOS WKWebView 的 navigator.clipboard.readText 在非手势/权限受限上下文
 * 会被拦截，桌面端统一走 Rust 命令 clipboard_read_text（主线程 arboard）。
 * @returns {Promise<string>}
 */
async function readClipboard() {
  if (window.LockClipboard && typeof window.LockClipboard.read === 'function') {
    return window.LockClipboard.read();
  }
  return navigator.clipboard.readText();
}

/**
 * 解析 CSV 行（RFC 4180：支持引号字段内的逗号、引号转义 "" 与换行）
 * @param {string} line - CSV 行
 * @returns {Array<string>} 字段数组
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      // 引号转义："" 表示字面引号
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char; // 引号内的换行也作为字段内容保留
    }
  }
  
  result.push(current);
  return result;
}

/**
 * 按引号状态切分 CSV 文本为多行（RFC 4180：引号字段内的换行属于字段内容，不切行）
 * @param {string} text - CSV 文本
 * @returns {Array<string>} 行数组（每行不含末尾 \r）
 */
function splitCSVLines(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
    } else if (char === '\n' && !inQuotes) {
      if (current.endsWith('\r')) current = current.slice(0, -1);
      lines.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.endsWith('\r')) current = current.slice(0, -1);
  if (current !== '') lines.push(current);
  return lines;
}

/**
 * 显示 Toast 消息
 * @param {string} message - 消息内容
 * @param {string} type - 类型: 'success' | 'error' | 'warning'
 * @param {Object} [options] - 可选配置
 * @param {Object} [options.action] - 操作按钮
 * @param {string} options.action.label - 按钮文字
 * @param {Function} options.action.callback - 点击回调
 */
function showToast(message, type = 'success', options = {}) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    warning: '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };
  
  toast.innerHTML = `${icons[type] || ''}<span class="toast-msg">${escHtml(message)}</span>`;

  if (options.action) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-action';
    actionBtn.textContent = options.action.label;
    actionBtn.addEventListener('click', () => {
      try { options.action.callback(); } catch (e) {}
      toast.remove();
    });
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);

  const duration = options.duration || TOAST_VISIBLE_DURATION;
  // 进度条与实际 duration 对齐（CSS 通过 --toast-duration 变量读取）
  toast.style.setProperty('--toast-duration', duration + 'ms');

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    setTimeout(() => toast.remove(), TOAST_FADE_OUT_DELAY);
  }, duration);
}

/**
 * Element 风格确认弹窗（替代系统 confirm，手机端可用）
 * @param {Object} options - 配置项
 * @param {string} [options.title='请确认'] - 标题
 * @param {string} options.message - 消息内容（支持 \n 换行）
 * @param {string} [options.confirmText='确定'] - 确认按钮文字
 * @param {string} [options.cancelText='取消'] - 取消按钮文字
 * @param {boolean} [options.danger=false] - 确认按钮是否使用红色危险样式
 * @returns {Promise<boolean>} resolve(true)=确认 / resolve(false)=取消
 */
function confirmDialog(options) {
  return new Promise(resolve => {
    const opts = {
      title: t('confirm.default.title'),
      confirmText: t('confirm.default.ok'),
      cancelText: t('confirm.default.cancel'),
      danger: false,
      ...(options || {})
    };
    
    let overlay = document.getElementById('confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'confirm-overlay';
      overlay.className = 'confirm-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      document.body.appendChild(overlay);
    }
    
    const messageHtml = escHtml(opts.message || '').replace(/\n/g, '<br>');
    const confirmBtnClass = opts.danger ? 'btn btn-danger' : 'btn btn-primary';
    
    overlay.innerHTML = `
      <div class="modal confirm-dialog">
        <div class="modal-header">
          <h2>${escHtml(opts.title)}</h2>
        </div>
        <div class="modal-body">
          <div class="confirm-message">${messageHtml}</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary confirm-cancel" tabindex="1">${escHtml(opts.cancelText)}</button>
          <button class="${confirmBtnClass} confirm-ok" tabindex="2">${escHtml(opts.confirmText)}</button>
        </div>
      </div>
    `;
    
    overlay.classList.remove('hidden');
    
    // 焦点策略：危险操作默认焦点落在「取消」，防 Enter 连按误确认破坏性操作
    const focusTarget = overlay.querySelector(opts.danger ? '.confirm-cancel' : '.confirm-ok');
    if (focusTarget) focusTarget.focus();
    
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      overlay.classList.add('hidden');
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    };
    
    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    };
    
    overlay.querySelector('.confirm-ok').addEventListener('click', () => finish(true));
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => finish(false));
    // 点击遮罩视为取消
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    document.addEventListener('keydown', onKeydown);
  });
}

/**
 * Element 风格输入弹窗（替代系统 prompt，打包应用/手机端可用）
 * 与 confirmDialog 共用 #confirm-overlay 容器与 .modal 结构，仅多一个输入框。
 * @param {Object} options - 配置项
 * @param {string} [options.title='请输入'] - 标题
 * @param {string} [options.message=''] - 说明文字（支持 \n 换行，可附可选列表）
 * @param {string} [options.value=''] - 输入框默认值
 * @param {string} [options.placeholder=''] - 输入框占位符
 * @param {string} [options.confirmText='确定'] - 确认按钮文字
 * @param {string} [options.cancelText='取消'] - 取消按钮文字
 * @param {boolean} [options.selectAll=true] - 聚焦时是否全选已有文本（默认全选便于直接覆盖）
 * @returns {Promise<string|null>} resolve(输入值) / resolve(null)=取消
 */
function promptDialog(options) {
  return new Promise(resolve => {
    const opts = {
      title: t('confirm.default.promptTitle'),
      message: '',
      value: '',
      placeholder: '',
      confirmText: t('confirm.default.ok'),
      cancelText: t('confirm.default.cancel'),
      selectAll: true,
      ...(options || {})
    };

    let overlay = document.getElementById('confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'confirm-overlay';
      overlay.className = 'confirm-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      document.body.appendChild(overlay);
    }

    const messageHtml = escHtml(opts.message || '').replace(/\n/g, '<br>');

    overlay.innerHTML = `
      <div class="modal confirm-dialog prompt-dialog">
        <div class="modal-header">
          <h2>${escHtml(opts.title)}</h2>
        </div>
        <div class="modal-body">
          ${messageHtml ? `<div class="confirm-message">${messageHtml}</div>` : ''}
          <input class="prompt-input" type="text" value="${escHtml(opts.value)}" placeholder="${escHtml(opts.placeholder)}" autocomplete="off" spellcheck="false" />
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary confirm-cancel" tabindex="1">${escHtml(opts.cancelText)}</button>
          <button class="btn btn-primary confirm-ok" tabindex="2">${escHtml(opts.confirmText)}</button>
        </div>
      </div>
    `;

    overlay.classList.remove('hidden');

    const input = overlay.querySelector('.prompt-input');
    if (input) {
      input.focus();
      if (opts.selectAll) {
        try { input.select(); input.setSelectionRange?.(0, input.value.length); } catch (_e) {}
      }
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      overlay.classList.add('hidden');
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    };

    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(input?.value ?? '');
      }
    };

    overlay.querySelector('.confirm-ok').addEventListener('click', () => finish(input?.value ?? ''));
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => finish(null));
    // 点击遮罩视为取消
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
    document.addEventListener('keydown', onKeydown);
  });
}

/**
 * URL 协议白名单校验
 * 仅允许 http/https/mailto，其余协议（如 javascript:）返回空字符串
 * @param {string} url - 待校验 URL
 * @returns {string} 安全 URL（原样返回）或空字符串
 */
function safeUrl(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (!s) return '';
  try {
    const u = new URL(s, 'https://local.invalid');
    const proto = u.protocol.toLowerCase();
    if (proto === 'http:' || proto === 'https:' || proto === 'mailto:') return s;
  } catch (e) { /* 非法 URL 解析失败 */ }
  return '';
}

/**
 * 简单 Markdown 解析器
 * 支持：粗体、斜体、代码、链接、列表、标题、分割线、围栏代码块、GFM 表格
 * @param {string} text - Markdown 文本
 * @returns {string} HTML
 */
function parseMarkdown(text) {
  if (!text) return '';
  
  // 先转义 HTML
  let html = escHtml(text);
  
  // 按行处理
  const lines = html.split('\n');
  const result = [];
  let inList = false;
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeLines = [];
  let inQuote = false;
  let quoteLines = [];

  // 表格单元格行内格式（粗体/斜体/行内代码/链接）
  const inlineFormat = (content) => {
    return content
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, linkText, linkUrl) => {
        const safe = safeUrl(linkUrl);
        return safe ? `<a href="${escHtml(safe)}" target="_blank" rel="noopener">${linkText}</a>` : linkText;
      });
  };

  // 解析表格行（去掉首尾 |，按 | 切分）
  const parseTableRow = (rowLine) => {
    let s = rowLine.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  };

  // 是否为表格行（首尾均含 |）
  const isTableRow = (s) => /^\s*\|.*\|\s*$/.test(s);
  // 是否为表格分隔行（仅含 - | : 空格，且至少一个 -）
  const isTableSep = (s) => /^\s*\|?[\s:\-|]+\|?\s*$/.test(s) && s.includes('-');
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 围栏代码块（``` 或 ~~~，支持语言标记）
    const fenceMatch = line.match(/^(`{3}|~{3})(\w*)\s*$/);
    if (inCodeBlock) {
      if (fenceMatch) {
        result.push(`<pre><code${codeBlockLang ? ` class="language-${codeBlockLang}"` : ''}>${codeLines.join('\n')}</code></pre>`);
        inCodeBlock = false;
        codeBlockLang = '';
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (fenceMatch) {
      inCodeBlock = true;
      codeBlockLang = fenceMatch[2] || '';
      codeLines = [];
      continue;
    }

    // 空行处理
    if (!line.trim()) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      if (inQuote) {
        result.push('<blockquote>' + quoteLines.map(inlineFormat).join('<br/>') + '</blockquote>');
        inQuote = false;
        quoteLines = [];
      }
      continue;
    }
    
    // GFM 表格：表头行 + 分隔行（| 列 | 列 | / | --- | --- |）
    if (isTableRow(line) && lines[i + 1] && isTableSep(lines[i + 1])) {
      if (inList) { result.push('</ul>'); inList = false; }
      const headCells = parseTableRow(line).map(c => '<th>' + inlineFormat(c) + '</th>').join('');
      const bodyRows = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        const cells = parseTableRow(lines[j]).map(c => '<td>' + inlineFormat(c) + '</td>').join('');
        bodyRows.push('<tr>' + cells + '</tr>');
        j++;
      }
      result.push('<div class="table-wrap"><table><thead><tr>' + headCells + '</tr></thead>');
      if (bodyRows.length) result.push('<tbody>' + bodyRows.join('') + '</tbody>');
      result.push('</table></div>');
      i = j - 1;
      continue;
    }
    
    // 标题 (h1-h6)
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^##\s+(.+)$/);
    const h3Match = line.match(/^###\s+(.+)$/);
    const h4Match = line.match(/^####\s+(.+)$/);
    const h5Match = line.match(/^#####\s+(.+)$/);
    const h6Match = line.match(/^######\s+(.+)$/);
    
    if (h1Match) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h1>' + h1Match[1] + '</h1>');
      continue;
    }
    if (h2Match) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h2>' + h2Match[1] + '</h2>');
      continue;
    }
    if (h3Match) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h3>' + h3Match[1] + '</h3>');
      continue;
    }
    if (h4Match) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h4>' + h4Match[1] + '</h4>');
      continue;
    }
    if (h5Match) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h5>' + h5Match[1] + '</h5>');
      continue;
    }
    if (h6Match) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h6>' + h6Match[1] + '</h6>');
      continue;
    }
    
    // 分割线
    if (line.match(/^(---|\*\*\*)$/)) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (inQuote) {
        result.push('<blockquote>' + quoteLines.map(inlineFormat).join('<br/>') + '</blockquote>');
        inQuote = false;
        quoteLines = [];
      }
      result.push('<hr/>');
      continue;
    }
    
    // 引用块（> 开头，行内支持粗体/斜体/行内代码/链接）
    const quoteMatch = line.match(/^\s*&gt;\s?(.*)$/);
    if (quoteMatch) {
      if (inList) { result.push('</ul>'); inList = false; }
      inQuote = true;
      quoteLines.push(quoteMatch[1]);
      continue;
    } else if (inQuote) {
      result.push('<blockquote>' + quoteLines.map(inlineFormat).join('<br/>') + '</blockquote>');
      inQuote = false;
      quoteLines = [];
    }
    
    // 无序列表项
    const unorderedMatch = line.match(/^[\t ]*[-*+]\s+(.+)$/);
    // 有序列表项
    const orderedMatch = line.match(/^[\t ]*\d+\.\s+(.+)$/);
    
    if (unorderedMatch || orderedMatch) {
      if (!inList) {
        result.push('<ul>');
        inList = true;
      }
      let content = unorderedMatch ? unorderedMatch[1] : orderedMatch[1];
      // 处理行内格式
      content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      content = content.replace(/\*(.+?)\*/g, '<em>$1</em>');
      content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
      content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, linkText, linkUrl) => {
        const safe = safeUrl(linkUrl);
        return safe ? `<a href="${escHtml(safe)}" target="_blank" rel="noopener">${linkText}</a>` : linkText;
      });
      result.push('<li>' + content + '</li>');
    } else {
      // 普通段落
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      // 处理行内格式
      line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      line = line.replace(/\*(.+?)\*/g, '<em>$1</em>');
      line = line.replace(/_(.+?)_/g, '<em>$1</em>');
      line = line.replace(/`([^`]+)`/g, '<code>$1</code>');
      line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, linkText, linkUrl) => {
        const safe = safeUrl(linkUrl);
        return safe ? `<a href="${escHtml(safe)}" target="_blank" rel="noopener">${linkText}</a>` : linkText;
      });
      result.push('<p>' + line + '</p>');
    }
  }
  
  // 关闭未闭合的列表
  if (inList) {
    result.push('</ul>');
  }

  // 关闭未闭合的引用块
  if (inQuote) {
    result.push('<blockquote>' + quoteLines.map(inlineFormat).join('<br/>') + '</blockquote>');
  }

  // 未闭合的代码块兜底输出（防止内容被吞）
  if (inCodeBlock) {
    result.push(`<pre><code${codeBlockLang ? ` class="language-${codeBlockLang}"` : ''}>${codeLines.join('\n')}</code></pre>`);
  }
  
  return result.join('\n');
}

/**
 * 标签颜色调色板（hex）
 * 默认 7 个来自 DEFAULT_TAGS；其余 13 个为新增（深色主题下区分度高的色调）
 */
const TAG_COLOR_PALETTE = [
  '#58a6ff', '#f85149', '#3fb950', '#d29922', '#bc8cff', '#79c0ff', '#8b949e', // 7 个默认
  '#ff7b72', '#d2a8ff', '#ffa657', '#7ee787', '#ffdf5d', '#f778ba', '#e3b341',
  '#56d4dd', '#db61a2', '#f0883e', '#a371f7', '#1f6feb', '#cf222e', '#bf8700'
];

/**
 * 标签图标调色板（id）
 * 前 7 个为默认；其余 8 个为新增
 */
const TAG_ICON_PALETTE = [
  'social', 'email', 'finance', 'work', 'dev', 'life', 'other',
  'bookmark', 'star', 'key', 'lock', 'cloud', 'globe', 'shield', 'folder'
];

/**
 * 为新标签随机分配颜色和图标，尽量避免与现有 tagDefs 重复
 * @param {Object} tagDefs - 现有 tagDefs 字典 { [name]: { color, icon } }
 * @returns {{ color: string, icon: string }}
 */
function getRandomTagAttrs(tagDefs) {
  tagDefs = tagDefs || {};
  const usedColors = new Set();
  const usedIcons = new Set();
  Object.values(tagDefs).forEach(d => {
    if (d && d.color) usedColors.add(d.color);
    if (d && d.icon) usedIcons.add(d.icon);
  });
  const availColors = TAG_COLOR_PALETTE.filter(c => !usedColors.has(c));
  const availIcons = TAG_ICON_PALETTE.filter(i => !usedIcons.has(i));
  const color = availColors.length
    ? availColors[Math.floor(Math.random() * availColors.length)]
    : TAG_COLOR_PALETTE[Math.floor(Math.random() * TAG_COLOR_PALETTE.length)];
  const icon = availIcons.length
    ? availIcons[Math.floor(Math.random() * availIcons.length)]
    : TAG_ICON_PALETTE[Math.floor(Math.random() * TAG_ICON_PALETTE.length)];
  return { color, icon };
}

/**
 * 根据标签名获取标签定义（含 color/icon），缺失则返回兜底（其他/灰）
 * @param {Object} tagDefs
 * @param {string} name
 */
function getTagDef(tagDefs, name) {
  if (tagDefs && tagDefs[name]) return tagDefs[name];
  return { color: '#8b949e', icon: 'other', isDefault: false };
}

/**
 * 渲染标签 chip（带 color+icon），可选择是否带关闭按钮
 * @param {Object} tagDefs
 * @param {string} name
 * @param {boolean} removable
 * @returns {string} HTML
 */
function renderTagChip(tagDefs, name, removable = false) {
  const def = getTagDef(tagDefs, name);
  // P3-6 修复：颜色注入 style 属性前过十六进制白名单
  const chipColor = safeTagColor(def.color);
  const close = removable
    ? `<span class="remove-tag-x" aria-label="${t('common.remove')}">×</span>`
    : '';
  return `<span class="tag-chip" data-tag="${escHtml(name)}" style="--chip-color:${chipColor}">${getCategoryIcon(def.icon, chipColor)}<span class="tag-chip-name">${escHtml(name)}</span>${close}</span>`;
}

/* ── 共享 SVG 图标注册表 ─────────────────────────────────────── */
const _SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"';
const _SVG_ATTRS_FILLED = 'viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"';

/**
 * 生成 SVG 字符串（统一 viewBox，参数化尺寸）
 * @param {number} size - 宽高像素
 * @param {string} inner - SVG 内部标签
 * @param {boolean} filled - 是否填充模式
 * @returns {string} SVG HTML
 */
function _svg(size, inner, filled) {
  return `<svg width="${size}" height="${size}" ${filled ? _SVG_ATTRS_FILLED : _SVG_ATTRS}>${inner}</svg>`;
}

/**
 * 共享 SVG 图标库 — 每个方法返回指定尺寸的 SVG 字符串
 * 消除 app.js / editor.js / entries.js 等模块中的 SVG 重复定义
 */
const SvgIcons = {
  /** 眼睛-开（密码可见） */
  eyeOpen: (s = 12) => _svg(s, '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  /** 眼睛-闭（密码隐藏） */
  eyeClosed: (s = 12) => _svg(s, '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'),
  /** 眼睛-开 SVG 内部路径（用于设置已有 SVG 元素的 innerHTML） */
  eyeOpenPaths: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  /** 眼睛-闭 SVG 内部路径（用于设置已有 SVG 元素的 innerHTML） */
  eyeClosedPaths: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  /** 复制 */
  copy: (s = 12) => _svg(s, '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  /** 关闭 X */
  close: (s = 16) => _svg(s, '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  /** 星标-空心 */
  starOutline: (s = 13) => _svg(s, '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
  /** 星标-实心 */
  starFilled: (s = 13, color) => {
    const attr = color ? `viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="2"` : _SVG_ATTRS_FILLED;
    return `<svg width="${s}" height="${s}" ${attr}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  },
  /** 垃圾桶 */
  trash: (s = 14) => _svg(s, '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  /** 编辑铅笔 */
  edit: (s = 14) => _svg(s, '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  /** 钥匙（生成密码） */
  key: (s = 15) => _svg(s, '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),
  /** 恢复 */
  restore: (s = 13) => _svg(s, '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>'),
  /** 勾选 */
  check: (s = 12) => _svg(s, '<polyline points="20 6 9 17 4 12"/>'),
  /** 二维码 */
  qrCode: (s = 14) => _svg(s, '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M21 14v3h-3"/>'),
  /* ── P3-4 收敛新增：以下图标取自组件内联 SVG（消除双体系重复） ── */
  /** 挂锁 */
  lock: (s = 14) => _svg(s, '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  /** 盾牌（生物识别解锁） */
  shield: (s = 14) => _svg(s, '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  /** 上传 */
  upload: (s = 14) => _svg(s, '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
  /** 文件夹 */
  folder: (s = 14) => _svg(s, '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  /** 警告三角 */
  alert: (s = 14) => _svg(s, '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  /** 宫格（全部/概览） */
  grid: (s = 20) => _svg(s, '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  /** 标签 */
  tag: (s = 16) => _svg(s, '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
  /** 类型图标（网站/服务器/数据库/AI/应用/其他） */
  typeIcon: (s = 12, type) => {
    const icons = {
      website:  '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
      server:   '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
      database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 5v14a9 3 0 0 1-18 0V5"/><path d="M3 12a9 3 0 0 1 18 0"/>',
      ai:       '<path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73A2 2 0 0 1 10 4a2 2 0 0 1 2-2z"/>',
      app:      '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      other:    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
    };
    return _svg(s, icons[type] || icons.website);
  },
  /* ── v1.0.32 新增：补齐右键菜单 & 快捷操作所需图标（仅 transform / opacity 友好） ── */
  /** 用户/账号 */
  user: (s = 14) => _svg(s, '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  /** 链接 */
  link: (s = 14) => _svg(s, '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  /** 外链打开 */
  external: (s = 14) => _svg(s, '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
  /** 终端/命令行 */
  terminal: (s = 14) => _svg(s, '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'),
  /** 二维码（别名 qr = qrCode，便于调用） */
  qr: (s = 14) => SvgIcons.qrCode(s),
  /** 收藏/书签（实心） */
  bookmark: (s = 14) => _svg(s, '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
  /** 云 */
  cloud: (s = 14) => _svg(s, '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>'),
  /** 下载 */
  download: (s = 14) => _svg(s, '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  /** 刷新 */
  refresh: (s = 14) => _svg(s, '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
  /** 导出/离开 */
  logoutIcon: (s = 14) => _svg(s, '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  /** 合并 */
  merge: (s = 14) => _svg(s, '<polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>'),
  /** 调色板 */
  palette: (s = 14) => _svg(s, '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a6 6 0 0 0 6-6c0-5-4.5-8.8-10-8.8z"/>'),
  /** 眼睛小图标（别名） */
  eye: (s = 14) => SvgIcons.eyeOpen(s),
  /** 搜索（小） */
  search: (s = 14) => _svg(s, '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  /** 设置（齿轮） */
  settings: (s = 14) => _svg(s, '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  /** 分享（曲线） */
  share: (s = 14) => _svg(s, '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>'),
};

// 导出模块
window.Utils = {
  escHtml,
  formatDate,
  formatDateFilename,
  downloadFile,
  openExternal,
  copyText,
  readClipboard,
  parseCSVLine,
  splitCSVLines,
  showToast,
  confirm: confirmDialog,
  prompt: promptDialog,
  getCategoryIcon,
  getCategoryColor,
  safeTagColor,
  safeUrl,
  parseMarkdown,
  getRandomTagAttrs,
  getTagDef,
  renderTagChip,
  SvgIcons,
  TAG_COLOR_PALETTE,
  TAG_ICON_PALETTE
};