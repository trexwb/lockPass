/* ═══════════════════════════════════════════════════════════════════
   LockPass PWA — Service Worker
   策略：
     • 首次访问 → 缓存所有静态资源
     • 再次访问 → 缓存优先（秒开）
     • 在线更新 → 网络优先，发现新版本后静默更新缓存
   不缓存的内容：任何带 ?timestamp= 或 query 的动态请求
   ═══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'lockpass-v1.0.8';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/js/template.js',
  '/js/crypto.js',
  '/js/database.js',
  '/js/file-store.js',
  '/js/file-sync.js',
  '/js/generator.js',
  '/js/utils.js',
  '/js/tauri-bridge.js',
  '/js/related.js',
  '/js/particles.js',
  '/js/app.js',
  '/js/ui.js',
  '/js/entries.js',
  '/js/editor.js',
  '/js/import-export.js',
  '/js/qr-sync.js',
  '/js/settings.js',
  '/js/shortcuts.js',
  '/js/main.js',
  '/manifest.json',
  '/assets/icons/favicon.svg',
];

// ═══════════════════════════════════════════════════════════════════
// 安装：预缓存所有资源
// ═══════════════════════════════════════════════════════════════════
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // 立即激活，跳过等待
      return self.skipWaiting();
    })
  );
});

// ═══════════════════════════════════════════════════════════════════
// 激活：清理旧版本缓存
// ═══════════════════════════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('lockpass-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // 立即接管所有页面
      return self.clients.claim();
    })
  );
});

// ═══════════════════════════════════════════════════════════════════
// 拦截请求：缓存优先，失败则网络回退
// ═══════════════════════════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 仅处理同源 GET 请求
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // 动态请求（带 query string）→ 网络优先，避免缓存过期数据
  if (url.search) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // 静态资源 → 缓存优先，秒开体验
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // 缓存有效的响应（非 opaque）
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // 网络全挂 → 返回离线页（如果有）
        return caches.match('/index.html');
      });
    })
  );
});
