/* 复查 ntfy 历史回放 + 限流恢复 */
'use strict';
const https = require('https');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function post(topic, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: 'ntfy.sh', path: '/' + topic, method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.write(body); req.end();
  });
}
function get(path) {
  return new Promise((resolve) => {
    const req = https.request({ host: 'ntfy.sh', path, method: 'GET' }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d, h: res.headers }));
    }); req.end();
  });
}
(async () => {
  const t = 'jzreplay' + Math.random().toString(36).slice(2, 8);
  console.log('topic:', t);
  for (let i = 0; i < 3; i++) { console.log('  post', i, '->', await post(t, 'hello' + i)); }
  await sleep(2000);

  for (const q of ['/json?poll=1&since=all', '/json?poll=1', '/raw?poll=1&since=all', '/json?poll=1&since=1h']) {
    const r = await get('/' + t + q);
    const lines = r.body.split('\n').filter((l) => l.trim());
    const msgs = lines.filter((l) => l.includes('"event":"message"'));
    console.log(`  ${q}  status=${r.status}  行数=${lines.length}  message条数=${msgs.length}`);
    if (q.includes('raw') && lines.length) console.log('     raw内容:', JSON.stringify(r.body.slice(0, 80)));
  }

  console.log('\n=== 限流恢复测试：等 30 秒后连发 5 条 ===');
  await sleep(30000);
  let ok = 0;
  for (let i = 0; i < 5; i++) { const s = await post(t, 'after' + i); if (s === 200) ok++; }
  console.log('  恢复后成功:', ok, '/5');
  process.exit(0);
})();
