/* 检查 ntfy 限流头 + 浏览器 EventSource 可行性 */
'use strict';
const https = require('https');
function head(topic) {
  return new Promise((resolve) => {
    const req = https.request({ host: 'ntfy.sh', path: '/' + topic + '/json?poll=1', method: 'GET' }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, h: res.headers, body: d.trim() }));
    });
    req.on('error', (e) => resolve({ err: e.message }));
    req.end();
  });
}
(async () => {
  const topic = 'jzlmt' + Math.random().toString(36).slice(2, 8);
  console.log('=== 单次 poll 的响应头 ===');
  const r = await head(topic);
  const interesting = Object.keys(r.h).filter((k) => /limit|retry|ratelimit|ttl|cache/i.test(k));
  interesting.forEach((k) => console.log(`  ${k}: ${r.h[k]}`));
  console.log('  全部头:', Object.keys(r.h).join(', '));

  console.log('\n=== 连续 12 次 poll 看是否触发限流 ===');
  let blocked = 0;
  for (let i = 0; i < 12; i++) {
    const x = await head(topic);
    if (x.status !== 200) { blocked++; console.log(`  #${i + 1} status=${x.status} retry-after=${x.h && x.h['retry-after']}`); }
    await new Promise((s) => setTimeout(s, 300));
  }
  console.log(`  12 次中非 200 的次数: ${blocked}`);

  console.log('\n=== 检查 ntfy 是否声明了 CORS 的 EventSource 支持 ===');
  const c = await new Promise((resolve) => {
    const req = https.request({ host: 'ntfy.sh', path: '/' + topic + '/sse', method: 'GET', headers: { Accept: 'text/event-stream' } }, (res) => {
      resolve({ status: res.statusCode, h: res.headers });
      res.destroy();
    });
    req.on('error', (e) => resolve({ err: e.message }));
    req.end();
  });
  ['access-control-allow-origin', 'access-control-allow-headers', 'content-type', 'cache-control', 'x-accel-buffering'].forEach((k) => {
    if (c.h && c.h[k]) console.log(`  ${k}: ${c.h[k]}`);
  });
  process.exit(0);
})();
