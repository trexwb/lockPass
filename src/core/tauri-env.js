/* ═══════════════════════════════════════════════════════════════════
   LockPass — Tauri 环境统一探测（必须最先加载）
   ───────────────────────────────────────────────────────────────────
   所有「是否桌面环境」的判定统一走本模块挂载的 window.LockTauri。

   为什么不能只看 window.__TAURI__：
   - 个别 Windows 构建/时序下 withGlobalTauri 注入可能缺失，
     依赖它判定的模块（file-store / sw-register / 各桥）会集体把桌面
     误判为浏览器：SW 被注册拦截首屏致 404（需刷新）、出现目录绑定
     入口、句柄经 JSON 落盘退化等连锁问题。
   - __TAURI_INTERNALS__ 是 Tauri v2 IPC 底层入口，恒先于页面脚本存在。
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var globalT = window.__TAURI__;
  var internals = window.__TAURI_INTERNALS__;

  var invoke = null;
  if (globalT && globalT.core && typeof globalT.core.invoke === 'function') {
    invoke = function () {
      return globalT.core.invoke.apply(globalT.core, arguments);
    };
  } else if (internals && typeof internals.invoke === 'function') {
    invoke = function () {
      return internals.invoke.apply(internals, arguments);
    };
    console.warn('[LockPass] __TAURI__ 全局不可用，已回退 __TAURI_INTERNALS__ 桥接');
  }

  // 是否运行在 Tauri 桌面 WebView 中：
  // 有可用 invoke 即视为桌面；正常注入与兜底两种形态都覆盖
  window.LockTauri = {
    isTauri: typeof invoke === 'function',
    invoke: invoke,
  };
})();
