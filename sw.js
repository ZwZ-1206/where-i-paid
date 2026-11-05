/* 花哪儿了 Service Worker
 * 策略：页面导航与本地脚本/样式一律「网络优先」，保证改完代码刷新就见效；
 *       离线时回落到缓存，仍然可用。
 * 说明：早期版本用「缓存优先」+ 后台更新，导致改完代码要刷新两次才看到新版。
 *       已改为网络优先。 */
'use strict';

const CACHE = 'jizhang-v1.20.1';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/css/couple.css',
  './assets/js/icons.js',
  './assets/js/utils.js',
  './assets/js/charts.js',
  './assets/js/store.js',
  './assets/js/widget.js',
  './assets/js/ui.js',
  './assets/js/ai.js',
  './assets/js/ocr.js',
  './assets/js/extras.js',
  './assets/js/tips.js',
  './assets/js/scan.js',
  './assets/js/pdf-text.js',
  './assets/js/bills.js',
  './assets/js/remind.js',
  './assets/js/couple-sync.js',
  './assets/js/view-add.js',
  './assets/js/view-detail.js',
  './assets/js/view-report.js',
  './assets/js/view-goals.js',
  './assets/js/view-settings.js',
  './assets/js/view-sync.js',
  './assets/js/view-couple.js',
  './assets/js/safety.js',
  './assets/js/app.js',
  './assets/couple/tongcheng.jpg',
  './assets/couple/yidi.jpg',
  './assets/img/wechat-pay.png',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png',
];

// 这些请求走「网络优先」，确保拿到最新版本。
// 注意：index.html 里引用资源带 ?v=1.17.1 查询串，所以必须拿 pathname 去匹配，
// 不能拿完整 URL —— 否则 'app.js?v=1.17.1' 不以 '.js' 结尾，规则失效，
// 脚本会被当成「静态资源」走缓存优先，改完代码用户刷新也拿不到新版。
const NET_FIRST = /\.(?:js|css|html|webmanifest|json)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 我们的index.html 一定包含这一句；拿它当「这是不是我的页面」的判据
const APP_MARK = 'assets/js/app.js';
const NAV_TIMEOUT = 3200;

/**
 * 取导航响应，拿不到「真正的 App 页面」就返回 null
 * 会拦下：网络错误、超时、非 200、不是 HTML、以及「域名已停」这类替换页
 */
function fetchNav(req) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) { /* 忽略 */ } }, NAV_TIMEOUT) : 0;
  const opts = ctrl ? { signal: ctrl.signal } : undefined;
  return fetch(req, opts)
    .then((res) => {
      if (!res || !res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (ct.indexOf('text/html') < 0) return null;
      return res.clone().text().then((body) => {
        if (body.indexOf(APP_MARK) < 0) return null;   // 不是我们的页面
        if (isRedirected(res)) return rebuildFrom(body, res.headers);   // Safari 兼容
        return res;
      });
    })
    .catch(() => null)
    .then((r) => { if (timer) clearTimeout(timer); return r; });
}

// —— Safari 兼容：跟随重定向拿到的响应，必须「还原」后才能交给页面 ————————
// Safari 对 Service Worker 交出的响应有洁癖：只要这个响应是 fetch 自动跟随
// 301/308 得来的（res.redirected === true），它就整页报错
// 「Response served by service worker has redirections」，直接白屏；
// Chrome / Edge 只在控制台警告一句，照样显示——所以这个坑只在 iPhone 上现形。
// 本站部署在 Cloudflare Pages，访问 /app（漏了结尾斜杠）会被 308 跳到 /app/，
// 用户手打网址、旧书签、旧分享链接都会踩中。
// 更阴的是：这种响应一旦被 caches.put 存进缓存，以后每次从缓存命中照样炸，
// 清缓存才能好——所以缓存里也绝对不能存重定向响应。
// 办法：用已经读到的原文重建一个 status 200 的普通响应，
// 重定向痕迹一并去掉，再返回、再入缓存。
function isRedirected(res) {
  return !!res && (res.redirected === true || res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400));
}

function rebuildFrom(body, headers) {
  const h = new Headers();
  headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    // 原文重建，这两个头会说谎（原文是解压后的），必须丢掉
    if (lk === 'content-length' || lk === 'content-encoding') return;
    h.set(k, v);
  });
  return new Response(body, { status: 200, statusText: 'OK', headers: h });
}

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>暂时打不开</title>' +
    '<div style="font:15px/1.8 -apple-system,sans-serif;padding:48px 24px;color:#333">' +
    '<h2 style="font-size:18px">暂时打不开</h2>' +
    '<p>这个 App 还没在本机缓存好，现在又联不上网。</p>' +
    '<p>联网后再打开一次就好；之后就都能离线用了。</p>' +
    '</div>',
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNav = req.mode === 'navigate';
  const netFirst = isNav || NET_FIRST.test(url.pathname);

  // index.html 里用 ?v=x.y.z 引用脚本，缓存里存的是不带参数的版本。
  // 所以查缓存要 ignoreSearch，否则离线时会全部落空。
  const fromCache = () =>
    caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match(req));

  // 页面导航走**网络优先，但必须验货**
  // 关键教训：访问一个已经停掉的临时域名时，服务器会返回一个「域名不存在」的
  // 错误页——那是一个**成功的 HTTP 响应**，fetch 不会 reject。
  // 老的写法会把这张错误页当成 App 显示出来，用户就再也进不去了。
  // 所以这里多两道关：超时 + 内容里必须能找到我们自己的标记。
  if (isNav) {
    event.respondWith(
      fetchNav(req).then((res) => {
        if (res) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        }
        return caches.match('./index.html', { ignoreSearch: true })
          .then((r) => r || offlinePage());
      })
    );
    return;
  }

  if (netFirst) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            if (isRedirected(res)) {
              // 跟随重定向拿到的：还原成普通 200，再入缓存、再返回（Safari 兼容）
              return res.text().then((body) => {
                const clean = rebuildFrom(body, res.headers);
                const copy = clean.clone();
                caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
                return clean;
              });
            }
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => fromCache().then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 图片、字体等静态资源：缓存优先
  event.respondWith(
    fromCache().then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        if (isRedirected(res)) {
          // 重定向响应不入缓存（会毒化缓存），还原后直接返回（Safari 兼容）
          return res.text().then((body) => rebuildFrom(body, res.headers));
        }
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
