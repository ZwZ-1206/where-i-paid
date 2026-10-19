/* 测试「部署后的实际应用域名」在国内是否可达（不是官网，是真实 App 域名） */
'use strict';
const https = require('https');
const dns = require('dns').promises;
const targets = [
  'https://example.vercel.app',
  'https://vercel.com',
  'https://example.netlify.app',
  'https://example.deno.dev',
  'https://example.pages.dev',
  'https://example.workers.dev',
  'https://example.gitee.io',
  'https://ntfy.sh',
  'https://0.peerjs.com',
  'https://stun.l.google.com:19302',
];
function probe(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const t0 = Date.now();
    const req = https.request({ host: u.hostname, path: u.pathname || '/', method: 'HEAD', timeout: 8000 }, (res) => {
      resolve({ url, status: res.statusCode, ms: Date.now() - t0 });
      res.destroy();
    });
    req.on('error', (e) => resolve({ url, status: 'ERR', ms: Date.now() - t0, err: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ url, status: 'TIMEOUT', ms: Date.now() - t0 }); });
    req.end();
  });
}
(async () => {
  console.log('=== DNS 解析 ===');
  for (const url of targets) {
    const h = new URL(url).hostname;
    try { const a = await dns.resolve4(h); console.log(`  ${h.padEnd(28)} -> ${a.slice(0, 2).join(', ')}`); }
    catch (e) { console.log(`  ${h.padEnd(28)} -> DNS FAIL (${e.code})`); }
  }
  console.log('\n=== HTTP 可达性 ===');
  for (const url of targets) {
    const r = await probe(url);
    const tag = r.status === 200 || r.status === 404 ? '可达' : r.status === 'ERR' || r.status === 'TIMEOUT' ? '不可达' : `HTTP ${r.status}`;
    console.log(`  ${url.padEnd(38)} ${String(r.status).padEnd(8)} ${String(r.ms).padStart(6)}ms  ${tag}${r.err ? ' ' + r.err : ''}`);
  }
  process.exit(0);
})();
