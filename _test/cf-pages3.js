/* 最终验证：pages.dev 能否当真正的写入型后端（含 JSON POST 往返、并发、大响应） */
'use strict';
const https = require('https');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function call(host, path, method, body, extraHeaders) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const headers = Object.assign({ 'User-Agent': 'Mozilla/5.0', Accept: '*/*' }, extraHeaders || {});
    const opts = { host, path, method, timeout: 15000, headers };
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, h: res.headers, len: Buffer.concat(chunks).length, body: Buffer.concat(chunks).toString().slice(0, 150) }));
    });
    req.on('error', (e) => resolve({ status: 0, ms: Date.now() - t0, err: e.code }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', ms: Date.now() - t0 }); });
    if (body) req.write(body);
    req.end();
  });
}
(async () => {
  const H = 'cloudflare-pages-example.pages.dev';
  console.log('=== A. 连续 20 次 GET，看限流与抖动 ===');
  const lat = []; let bad = 0;
  for (let i = 0; i < 20; i++) {
    const r = await call(H, '/');
    if (r.status === 200) lat.push(r.ms); else { bad++; if (bad <= 2) console.log(`  异常 ${r.status} ${r.err || ''}`); }
    await sleep(250);
  }
  lat.sort((a, b) => a - b);
  console.log(`  成功 ${lat.length}/20  异常 ${bad}  P50 ${lat[Math.floor(lat.length/2)]}ms  P95 ${lat[Math.floor(lat.length*0.95)]}ms`);

  console.log('\n=== B. 并发 10 个请求 ===');
  const t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: 10 }, () => call(H, '/')));
  console.log(`  10 并发耗时 ${Date.now() - t0}ms  成功 ${rs.filter(r => r.status === 200).length}/10`);

  console.log('\n=== C. 带 JSON body 的 POST（真实接口形态）===');
  const payload = JSON.stringify({ topic: 'couple-abc', op: 'upsert', tx: { id: 'x1', amount: 32.5, cat: 'food' } });
  const p = await call('pages-functions-example.pages.dev', '/api/push', 'POST', payload);
  console.log(`  POST ${payload.length}B -> ${p.status} ${p.ms}ms 响应长度=${p.len}`);

  console.log('\n=== D. 请求头 CORS（浏览器直连必需）===');
  const c = await call(H, '/', 'OPTIONS', null, { Origin: 'https://abc.pages.dev', 'Access-Control-Request-Method': 'POST' });
  ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'].forEach((k) => {
    console.log(`  ${k}: ${(c.h && c.h[k]) || '(未返回)'}`);
  });

  console.log('\n=== E. pages.dev 与 ntfy.sh 延迟对比 ===');
  const a = [], b = [];
  for (let i = 0; i < 5; i++) {
    const x = await call(H, '/'); if (x.status === 200) a.push(x.ms);
    const y = await call('ntfy.sh', '/'); if (y.status === 200) b.push(y.ms);
    await sleep(300);
  }
  console.log(`  pages.dev: ${a.join(', ')}ms`);
  console.log(`  ntfy.sh  : ${b.join(', ')}ms`);
  process.exit(0);
})();
