/* ═══════════════════════════════════════════════════════════════════
   LockPass — Service Worker（Vue/Vite 构建产物适配版）
   策略：导航请求网络优先、离线回退 index.html；静态资源 stale-while-revalidate
   注意：仅标准构建产物（HTTP 部署/Tauri WebView）生效；file:// 双击模式浏览器禁用 SW
   ═══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'lockpass-v1.0.16';
const PRECACHE_URLS = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 导航请求：网络优先，失败回退缓存首页
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 静态资源：SWR（先缓存后网络，网络成功后更新缓存）
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
