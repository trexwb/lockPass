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
