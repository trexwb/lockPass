/* ═══════════════════════════════════════════════════════════════════
   LockPass — Service Worker（Vue/Vite 构建产物适配版）
   策略：导航请求缓存优先（秒开）+ 后台刷新；静态资源 stale-while-revalidate；
        install 阶段预缓存首屏关键路径（index.html + 主逻辑 JS，CSS 已内联其中）
   注意：仅标准构建产物（HTTP 部署/Tauri WebView）生效；file:// 双击模式浏览器禁用 SW
   ═══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'lockpass-__APP_VERSION__';
// 相对路径：随 SW 脚本解析到部署子路径（如 GitHub Pages 的 /lockPass/），
// 避免在子路径部署时请求站点根目录导致预缓存 404 错误页
// 首屏关键路径：iife 单 chunk 产物（vite entryFileNames 固定 assets/js/index.js、
// 无 hash、CSS 内联其中），故可安全硬编码预缓存，消除「首日 JS 未入缓存导致
// 次日冷启动/弱网下重新下载 650KB 主逻辑」的白屏等待。
const PRECACHE_URLS = [
  './',
  './index.html',
  './assets/js/index.js',
];

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

  // 导航请求：缓存优先（命中立即渲染，消除弱网下网络优先的长时间等待），
  // 后台 fetch 刷新缓存（stale-while-revalidate）；缓存未命中回退网络。
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((resp) => {
            if (resp && resp.status === 200) {
              const clone = resp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return resp;
          })
          .catch(() => cached);
        return cached || network;
      })
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
