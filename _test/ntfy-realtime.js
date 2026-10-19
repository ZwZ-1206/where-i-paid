/* ntfy 实时性实测：SSE 延迟 + 双向往返 */
'use strict';
const https = require('https');

function post(topic, body) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = https.request({
      host: 'ntfy.sh', path: '/' + topic, method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, body: d }));
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

/* 打开 SSE 流，每条消息回调 */
function sse(topic, onMsg, onErr) {
  const req = https.request({
    host: 'ntfy.sh', path: '/' + topic + '/sse', method: 'GET',
    headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
  }, (res) => {
    console.log('  SSE status:', res.statusCode, 'headers ACAO:', res.headers['access-control-allow-origin']);
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const p of parts) {
        const line = p.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try { onMsg(JSON.parse(line.slice(5).trim())); } catch (e) {}
      }
    });
    res.on('end', () => onErr && onErr('stream ended'));
  });
  req.on('error', (e) => onErr && onErr(e.message));
  req.end();
  return req;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const topic = 'jzrt' + Math.random().toString(36).slice(2, 10);
  console.log('topic:', topic);
  const recv = [];
  let resolveFirst;
  const first = new Promise((r) => (resolveFirst = r));
  const req = sse(topic, (m) => {
    if (m.event === 'open' || m.event === 'keepalive') return;
    const lat = Date.now() - Number(m.message);
    recv.push({ lat, msg: m.message });
    resolveFirst();
  }, (e) => console.log('  SSE err:', e));
  await sleep(1800);
  console.log('--- 发送一条，测端到端延迟 ---');
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await post(topic, String(t));
    await sleep(1200);
  }
  console.log('收到条数:', recv.length);
  recv.forEach((r, i) => console.log(`  #${i + 1} 端到端延迟 ${r.lat}ms`));
  req.destroy();

  console.log('\n--- 双向往返（模拟两机互推 5 轮）---');
  const t2 = 'jzrt' + Math.random().toString(36).slice(2, 10);
  const order = [];
  const r2 = sse(t2, (m) => { if (m.event !== 'open' && m.event !== 'keepalive') order.push(m.message); }, () => {});
  await sleep(1500);
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) {
    await post(t2, 'A' + i);
    await sleep(150);
    await post(t2, 'B' + i);
    await sleep(150);
  }
  await sleep(1500);
  r2.destroy();
  console.log('  发送 10 条，实收', order.length, '条，总耗时', Date.now() - t0, 'ms');
  console.log('  顺序:', order.join(','));

  console.log('\n--- 4KB 边界下的大消息延迟（全量快照分片模拟）---');
  const t3 = 'jzrt' + Math.random().toString(36).slice(2, 10);
  const got3 = [];
  const r3 = sse(t3, (m) => { if (m.event !== 'open' && m.event !== 'keepalive') got3.push(Date.now() - Number(m.message)); }, () => {});
  await sleep(1500);
  const pad = 'X'.repeat(3900);
  for (let i = 0; i < 5; i++) { await post(t3, Date.now() + ':' + pad); await sleep(400); }
  await sleep(1500);
  r3.destroy();
  console.log('  4KB 消息延迟:', got3.join('ms, ') + 'ms', ' 实收', got3.length, '条');
  process.exit(0);
})();
