/* ═══════════════════════════════════════════════════════════════════
   LockPass PWA — Service Worker
   策略：
     • 首次访问 → 预缓存所有静态资源
     • 导航请求 (index.html) → 网络优先，确保用户拿到最新 HTML
     • 静态资源 (JS/CSS) → Stale-While-Revalidate：缓存秒开 + 后台更新
     • 动态请求 (带 query) → 网络优先，离线回退缓存
     • 离线 → 回退 index.html 保底
   更新机制：每次发版改 CACHE_NAME → SW 字节变化 → 自动激活 →
   导航请求走网络拿到新版 HTML → 引用的 JS/CSS 后台 SWR 更新 →
   用户下次打开 PWA 即使用最新代码
   ═══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'lockpass-v1.0.1';
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
  '/js/sw-register.js',
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
// 拦截请求：按资源类型分策略
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

  // 导航请求 (HTML 页面) → 网络优先
  // 确保用户每次打开 PWA 先尝试拿最新 index.html
  // 网络失败时回退缓存（离线可用）
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request).then((response) => {
        // 成功拿到新版 → 更新缓存
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // 离线 → 返回缓存的 index.html
        return caches.match(request).then((cached) => cached || caches.match('/index.html'));
      })
    );
    return;
  }

  // 静态资源 (JS/CSS/图片等) → Stale-While-Revalidate
  // 先返回缓存（秒开），同时后台拉取新版写入缓存，下次打开生效
  event.respondWith(
    caches.match(request).then((cached) => {
      // 后台更新：无论是否有缓存，都尝试拉新版
      const fetchPromise = fetch(request).then((response) => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached); // 网络失败静默忽略，保持缓存不变

      // 有缓存 → 先返回缓存，后台更新不阻塞用户
      // 无缓存 → 等网络响应
      return cached || fetchPromise;
    })
  );
});
