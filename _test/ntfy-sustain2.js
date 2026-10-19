/* 冷却后测可持续速率：每 6 秒 1 条 */
'use strict';
const https = require('https');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function post(topic, body) {
  return new Promise((res) => {
    const r = https.request({ host: 'ntfy.sh', path: '/' + topic, method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } },
      (s) => { let d = ''; s.on('data', (c) => (d += c)); s.on('end', () => res({ s: s.statusCode, d })); });
    r.on('error', (e) => res({ s: 0, d: e.message }));
    r.write(body); r.end();
  });
}
(async () => {
  const t = 'jzrep' + Math.random().toString(36).slice(2, 8);
  console.log('=== 每 6 秒 1 条，共 12 条（约 72 秒）===');
  let ok = 0, fail = 0;
  for (let i = 0; i < 12; i++) {
    const r = await post(t, 'x' + i);
    if (r.s === 200) ok++; else { fail++; console.log('  第' + (i + 1) + '条失败', r.s, r.d.slice(0, 90)); }
    await sleep(6000);
  }
  console.log('  结果: 成功', ok, '失败', fail);
  process.exit(0);
})();
