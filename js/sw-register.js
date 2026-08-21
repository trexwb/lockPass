/* ═══════════════════════════════════════════════════════════════════
   LockPass — Service Worker 注册模块
   页面渲染完再注册，不阻塞首屏
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 注册 PWA Service Worker（失败静默降级，不打扰用户）
 */
(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {
      // 静默失败：SW 不可用时应用仍可正常离线使用
    });
  });
})();
