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
    // 桌面版（Tauri）无需 PWA Service Worker：前端资源已嵌入应用包，
    // 在 tauri.localhost 域上注册 SW 会拦截首屏请求，缓存清单与安装包
    // 资源不一致时导致首次启动返回 404（刷新后新 SW 接管才正常）。
    // 桌面版统一跳过注册，并注销历史版本残留的 SW 与缓存，避免升级后旧 SW 继续拦截。
    var isTauri = !!(window.__TAURI__ && window.__TAURI__.core &&
      typeof window.__TAURI__.core.invoke === 'function');
    if (isTauri) {
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
