/* 1) pages.dev / netlify.app / deno.dev 多次探测稳定性  2) ntfy 突发上限冷却后复测 */
'use strict';
const https = require('https');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function head(host, path) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.request({ host, path: path || '/', method: 'GET', timeout: 9000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, headers: res.headers, body: Buffer.concat(chunks).toString().slice(0, 300) }));
    });
    req.on('error', (e) => resolve({ status: 0, ms: Date.now() - t0, err: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', ms: Date.now() - t0 }); });
    req.end();
  });
}

(async () => {
  console.log('=== A. 三个免费托管域名各探测 3 次 ===');
  for (const host of ['example.pages.dev', 'example.netlify.app', 'example.deno.dev']) {
    const rs = [];
    for (let i = 0; i < 3; i++) { const r = await head(host); rs.push(`${r.status}/${r.ms}ms`); await sleep(400); }
    console.log(`  ${host.padEnd(24)} ${rs.join('  ')}`);
  }

  console.log('\n=== B. pages.dev 响应头（确认是 Cloudflare 边缘）===');
  const p = await head('example.pages.dev');
  ['server', 'cf-ray', 'cf-cache-status', 'via'].forEach((k) => { if (p.headers && p.headers[k]) console.log(`  ${k}: ${p.headers[k]}`); });

  console.log('\n=== C. ntfy 突发上限冷却后复测（等 60s）===');
  await sleep(60000);
  const t = 'jzburst2' + Math.random().toString(36).slice(2, 8);
  let n = 0, firstFail = -1;
  for (let i = 0; i < 30; i++) {
    const r = await new Promise((res) => {
      const q = https.request({ host: 'ntfy.sh', path: '/' + t, method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Content-Length': 5 } },
        (s) => { s.resume(); s.on('end', () => res(s.statusCode)); });
      q.on('error', () => res(0)); q.write('burst'); q.end();
    });
    if (r === 200) n++; else { firstFail = i + 1; break; }
  }
  console.log(`  冷却后连续成功 ${n} 条，第 ${firstFail} 条失败`);

  console.log('\n=== D. ntfy 429 是按 IP 全局还是按 topic ===');
  const t2 = 'jzother' + Math.random().toString(36).slice(2, 8);
  const r2 = await new Promise((res) => {
    const q = https.request({ host: 'ntfy.sh', path: '/' + t2, method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': 4 } },
      (s) => { let d = ''; s.on('data', (c) => (d += c)); s.on('end', () => res({ s: s.statusCode, d })); });
    q.on('error', (e) => res({ s: 0, d: e.message })); q.write('test'); q.end();
  });
  console.log(`  换一个全新 topic 发 1 条 -> status=${r2.s}  ${r2.s !== 200 ? r2.d.slice(0, 100) : '成功'}`);
  process.exit(0);
})();
