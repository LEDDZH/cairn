/* ============================================================================
 * Cairn · sw.js  (Service Worker)
 * ---------------------------------------------------------------------------
 * 作用：让装到手机桌面的 Cairn **断网也能打开**。
 *
 * 策略选择（这里做了刻意的取舍）：
 *
 *   1) 应用外壳（index.html / manifest / 图标）用「网络优先 + 缓存兜底」。
 *      为什么不用"缓存优先"：那样用户永远看不到新版本，每次改完都要手动清缓存，
 *      对课堂演示来说容易翻车。网络优先保证有网时一定是最新版，
 *      没网时才回退到缓存 —— 两种场景都不会白屏。
 *
 *   2) 缓存用"整体替换"而不是增量添加。Cairn 只有一个页面，
 *      版本号变了就整个换掉，不做复杂的增量合并 —— 少一个出错的地方。
 *
 *   3) 不做后台预缓存、不做推送、不做统计。
 *      产品立场是"数据不出本机、不打扰用户"，Service Worker 只干离线这一件事。
 *
 * 注意：Service Worker 只能通过 http/https 注册。
 * 双击本地文件（file://）打开时它不会生效，这是浏览器规范的限制 ——
 * 那种情况下应用本身照常工作，只是没有离线缓存。
 * ==========================================================================*/

var CACHE_NAME = 'cairn-v2.3.0';

/* 需要离线可用的资源。全部是本地文件，没有任何外部依赖。 */
var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

/* ---------------------------------------------------------------- 安装 --- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      /* 逐个添加而不是 addAll：addAll 只要有一个文件失败就会整体失败，
       * 那样一个图标缺失就会导致整个离线功能不可用。 */
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
          /* 单个资源失败不影响其余资源 —— 离线能力可以降级，不能整体失效 */
          return null;
        });
      }));
    }).then(function () {
      /* 立即接管，不等待旧标签页关闭 —— 用户装完就想要离线可用 */
      return self.skipWaiting();
    })
  );
});

/* ---------------------------------------------------------------- 激活 --- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME) return caches.delete(k);   /* 清掉旧版本缓存 */
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---------------------------------------------------------------- 请求 --- */
self.addEventListener('fetch', function (event) {
  var req = event.request;

  /* 只处理 GET；POST 等一律放行（Cairn 本身没有 POST，但这是基本防御） */
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  /* 只处理同源请求。Cairn 会向 DeepSeek 发请求（可选的 AI 拆解），
   * 那种跨域请求绝不能走缓存 —— 否则用户会拿到过期的 AI 结果。 */
  if (url.origin !== self.location.origin) return;

  /* 导航请求（打开应用本身）：网络优先，失败回退缓存 */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  /* 其余同源静态资源：缓存优先，未命中则联网并放进缓存 */
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        /* 离线且没缓存：返回一个最小的空响应而不是抛错，
         * 避免控制台刷一堆红色报错。 */
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
