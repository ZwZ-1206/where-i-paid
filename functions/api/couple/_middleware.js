/**
 * 情侣同步 · CORS
 *
 * 为什么需要：
 *   APK 是一个「本地资源壳」，页面 origin 是
 *   `https://appassets.androidplatform.net`，而接口在
 *   `https://where-i-paid.pages.dev`。这是跨源请求，且带了
 *   `content-type: application/json` 和 `x-couple-auth` 两个非简单头，
 *   浏览器（WebView）会先发 OPTIONS 预检。
 *
 *   没有这一层时：网页版一切正常（同源），APK 里配对永远「连不上服务器」——
 *   因为预检没被放行，真正的 POST/GET 根本没发出去。
 *
 * 只放行白名单：官网、预览域名、安卓壳 origin、本地调试端口。
 * 不用 `*`：这个接口带密钥头，宁可少放行也不要给任意站点开洞。
 */

const EXACT = new Set([
  'https://where-i-paid.pages.dev',
  'https://appassets.androidplatform.net',
  'capacitor://localhost',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
]);

/** 每次部署的预览域名形如 https://e04b72d2.where-i-paid.pages.dev */
const PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.where-i-paid\.pages\.dev$/;

function originAllowed(origin) {
  if (!origin) return false;
  return EXACT.has(origin) || PREVIEW_RE.test(origin);
}

export async function onRequest(context) {
  const req = context.request;
  const origin = req.headers.get('Origin') || '';
  const allow = originAllowed(origin);

  const cors = new Headers();
  if (allow) {
    cors.set('Access-Control-Allow-Origin', origin);
    cors.set('Vary', 'Origin');
  }
  cors.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  cors.set('Access-Control-Allow-Headers', 'content-type,x-couple-auth');
  cors.set('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    // 预检：只回头，不进业务；不放行的 origin 直接 403
    return new Response(null, { status: allow ? 204 : 403, headers: cors });
  }

  const res = await context.next();
  // body 是流，必须重新包一层才能改头；显式写 status/headers，不依赖
  // 「把 Response 当 init」这种在部分运行时才成立的写法
  const out = new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
  cors.forEach((v, k) => out.headers.set(k, v));
  return out;
}
