// LockPass — Tauri 本地服务桥（桌面版专用）
//
// 职责：
//   1. 解锁后把明文条目经 Tauri invoke 同步到 Rust 内存（仅内存，不落盘）；
//   2. 锁定/登出时清空 Rust 内存；
//   3. 转发 Rust 侧「配对请求」事件给前端弹窗组件（PairRequestModal）；
//   4. 提供配对确认/拒绝的 invoke 封装。
//
// 仅当运行在 Tauri 环境（window.__TAURI__ 存在）时生效；
// 网页版（file:// / localhost dev / GitHub Pages）不加载本桥逻辑，
// 继续走原有页面桥（lockpass-bridge.js / ext-bridge.js）兼容路径。

(function () {
  'use strict';

  // 桌面判定统一走 tauri-env.js（双信号）
  const LT = window.LockTauri || {};
  const isTauri = !!LT.isTauri;
  if (!isTauri) return;

  const invoke = LT.invoke;

  function extractDomain(url) {
    try {
      const u = new URL(url);
      return u.hostname.toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function toDto(e) {
    return {
      id: e.id || '',
      title: e.title || '',
      username: e.username || '',
      password: e.password || '',
      url: e.url || '',
      entryType: e.entryType || 'website',
      domain: extractDomain(e.url || ''),
    };
  }

  const TauriServer = {
    isTauri: true,

    /** 解锁后标记服务就绪 */
    ready() {
      return invoke('server_ready');
    },

    /** 同步明文条目到 Rust 内存 */
    setEntries(entries) {
      const list = (entries || []).map(toDto);
      return invoke('server_set_entries', { entries: list });
    },

    /** 锁定/登出时清空内存 */
    lock() {
      return invoke('server_lock');
    },

    /** 查询待确认配对 nonce（供弹窗挂载时回查） */
    getPendingPair() {
      return invoke('server_get_pending_pair');
    },

    /** 用户点击「允许」：发放 token */
    confirmPair(nonce) {
      return invoke('server_pair_confirm', { nonce: nonce });
    },

    /** 用户点击「拒绝」：取消配对 */
    rejectPair(nonce) {
      return invoke('server_pair_reject', { nonce: nonce });
    },
  };

  window.TauriServer = TauriServer;

  // 转发 Rust 侧配对请求事件为 window 事件，供 PairRequestModal 监听
  try {
    const globalT = window.__TAURI__;
    if (globalT && globalT.event && typeof globalT.event.listen === 'function') {
      globalT.event.listen('lockpass:pair-request', (event) => {
        window.dispatchEvent(new CustomEvent('lockpass:pair-request', { detail: event.payload }));
      });
    }
  } catch (e) {
    console.warn('[LockPass/Tauri] 配对事件监听注册失败:', e);
  }
})();
