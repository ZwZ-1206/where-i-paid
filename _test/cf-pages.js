/* 验证 Cloudflare Pages 能否作为国内可用的免费后端（对比 workers.dev） */
'use strict';
const https = require('https');
const dns = require('dns').promises;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(host, path, method) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.request({ host, path: path || '/', method: method || 'GET', timeout: 10000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, h: res.headers }));
    });
    req.on('error', (e) => resolve({ status: 0, ms: Date.now() - t0, err: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', ms: Date.now() - t0 }); });
    req.end();
  });
}

(async () => {
  console.log('=== Cloudflare 各子域解析对比 ===');
  for (const h of ['example.pages.dev', 'example.workers.dev', 'dash.cloudflare.com', 'api.cloudflare.com', 'cloudflare.com']) {
    try { const a = await dns.resolve4(h); console.log(`  ${h.padEnd(26)} -> ${a.join(', ')}`); }
    catch (e) { console.log(`  ${h.padEnd(26)} -> DNS FAIL ${e.code}`); }
  }

  console.log('\n=== 关键：一个真实带 Functions 的 pages.dev 站点 ===');
  // 找一个公开的 pages.dev 站点测试 /api 路由
  const candidates = [
    ['example.pages.dev', '/'],
    ['cloudflare-pages-example.pages.dev', '/'],
    ['pages-functions-example.pages.dev', '/'],
  ];
  for (const [h, p] of candidates) {
    const r = await get(h, p);
    console.log(`  ${h.padEnd(38)} ${String(r.status).padEnd(8)} ${r.ms}ms`);
  }

  console.log('\n=== Cloudflare API 官端点（部署时需要）===');
  for (const h of ['api.cloudflare.com', 'dash.cloudflare.com']) {
    const r = await get(h, '/client/v4/user/tokens/verify');
    console.log(`  ${h.padEnd(26)} ${String(r.status).padEnd(8)} ${r.ms}ms`);
  }

  console.log('\n=== pages.dev 长期稳定性：6 次采样 ===');
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('example.pages.dev', '/');
    samples.push(`${r.status}/${r.ms}ms`);
    await sleep(700);
  }
  console.log('  ' + samples.join('  '));

  console.log('\n=== 对比 workers.dev 同时段 ===');
  const w = await get('example.workers.dev', '/');
  console.log(`  example.workers.dev ${w.status} ${w.ms}ms ${w.err || ''}`);
  process.exit(0);
})();
