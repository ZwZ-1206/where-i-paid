/* 深度验证 pages.dev 在国内的可用性（这是关键结论，必须扎实） */
'use strict';
const https = require('https');
const dns = require('dns').promises;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchUrl(host, path, method, body) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const opts = { host, path: path || '/', method: method || 'GET', timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json,text/html,*/*' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(body); }
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, h: res.headers, body: Buffer.concat(chunks).toString().slice(0, 200) }));
    });
    req.on('error', (e) => resolve({ status: 0, ms: Date.now() - t0, err: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', ms: Date.now() - t0 }); });
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  console.log('=== 多个真实 pages.dev 站点（验证不是个别站点侥幸）===');
  const sites = [
    'cloudflare-pages-example.pages.dev',
    'pages-functions-example.pages.dev',
    'developers.cloudflare.com',
  ];
  for (const h of sites) {
    const r = await fetchUrl(h, '/');
    console.log(`  ${h.padEnd(40)} ${String(r.status).padEnd(6)} ${String(r.ms).padStart(5)}ms  server=${r.h && r.h.server || '-'}`);
    await sleep(300);
  }

  console.log('\n=== POST 到 pages.dev（模拟写接口，看是否被拦）===');
  const p = await fetchUrl('pages-functions-example.pages.dev', '/api/whatever', 'POST', JSON.stringify({ a: 1 }));
  console.log(`  POST /api/whatever -> status=${p.status} time=${p.ms}ms body=${(p.body || '').slice(0, 120)}`);

  console.log('\n=== 同一 IP 段连续 10 次采样（看有没有间歇性阻断）===');
  const lat = [];
  let fails = 0;
  for (let i = 0; i < 10; i++) {
    const r = await fetchUrl('cloudflare-pages-example.pages.dev', '/');
    if (r.status === 200) lat.push(r.ms); else fails++;
    await sleep(500);
  }
  lat.sort((a, b) => a - b);
  console.log(`  成功 ${lat.length}/10  失败 ${fails}  最快 ${lat[0]}ms  中位 ${lat[Math.floor(lat.length / 2)]}ms  最慢 ${lat[lat.length - 1]}ms`);

  console.log('\n=== 对比：workers.dev 连续 3 次 ===');
  for (let i = 0; i < 3; i++) {
    const r = await fetchUrl('example.workers.dev', '/');
    console.log(`  workers.dev #${i + 1} -> ${r.status} ${r.ms}ms`);
    await sleep(500);
  }

  console.log('\n=== TLS 证书是否正常（中间人/劫持检测）===');
  for (const h of ['cloudflare-pages-example.pages.dev', 'ntfy.sh']) {
    await new Promise((resolve) => {
      const req = https.request({ host: h, path: '/', method: 'GET', timeout: 10000 }, (res) => {
        const c = res.socket.getPeerCertificate();
        console.log(`  ${h.padEnd(40)} issuer=${c && c.issuer && c.issuer.O} CN=${c && c.subject && c.subject.CN}`);
        res.destroy(); resolve();
      });
      req.on('error', () => { console.log(`  ${h} TLS FAIL`); resolve(); });
      req.end();
    });
  }
  process.exit(0);
})();
