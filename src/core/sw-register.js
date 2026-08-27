/* ═══════════════════════════════════════════════════════════════════
   LockPass — Service Worker 注册模块
   页面渲染完再注册，不阻塞首屏
   新 SW 激活后自动刷新页面，确保用户立即使用最新版本
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 注册 PWA Service Worker（失败静默降级，不打扰用户）
 * 检测到新 SW 接管时自动刷新页面一次
 */
(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  /* 桌面版（Tauri）：跳过 SW 注册 + 立即清残留。
     不能只看 window.__TAURI__ —— 个别 Windows 构建该全局注入缺失，
     会把桌面误判为浏览器而在 tauri.localhost 注册 SW，旧 SW 拦截首屏
     导致 404（点刷新才恢复）。统一用 tauri-env.js 的双信号判定，
     且不等 load、脚本求值期立即清理，尽量缩小旧 SW 干扰窗口。 */
  var lt = window.LockTauri || {};
  if (lt.isTauri) {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      registrations.forEach(function (reg) { reg.unregister(); });
    }).catch(function () {});
    if (window.caches) {
      window.caches.keys().then(function (keys) {
        keys.forEach(function (key) { window.caches.delete(key); });
      }).catch(function () {});
    }
    return;
  }

  // 浏览器版：等页面渲染完再注册，不阻塞首屏
  window.addEventListener('load', function () {
    // A2 修复：相对路径注册，兼容子路径部署（/lockPass/sw.js）
    navigator.serviceWorker.register('./sw.js').catch(function () {
      // 静默失败：SW 不可用时应用仍可正常离线使用
    });

    // 新 SW 激活并接管页面时，刷新一次以加载最新资源
    var refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });
  });
})();
