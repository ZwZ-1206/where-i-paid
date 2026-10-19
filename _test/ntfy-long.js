/* ntfy 长连接稳定性 + 双订阅广播 + 限流边界 */
'use strict';
const https = require('https');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(topic, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'ntfy.sh', path: '/' + topic, method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.write(body); req.end();
  });
}
function sse(topic, tag, onMsg) {
  const st = { tag, closed: false, count: 0, openedAt: Date.now() };
  const req = https.request({ host: 'ntfy.sh', path: '/' + topic + '/sse', method: 'GET', headers: { Accept: 'text/event-stream' } }, (res) => {
    st.status = res.statusCode;
    let buf = '';
    res.on('data', (c) => {
      buf += c.toString('utf8');
      const parts = buf.split('\n\n'); buf = parts.pop();
      for (const p of parts) {
        const line = p.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try { const m = JSON.parse(line.slice(5).trim()); if (m.event === 'message') { st.count++; onMsg(m); } } catch (e) {}
      }
    });
    res.on('end', () => { st.closed = true; st.endAt = Date.now(); });
  });
  req.on('error', (e) => { st.closed = true; st.err = e.message; });
  req.end(); st.req = req; return st;
}

(async () => {
  const topic = 'jzlong' + Math.random().toString(36).slice(2, 8);

  console.log('=== A. 双订阅广播（模拟两台手机同时在线）===');
  const gotA = [], gotB = [];
  const sA = sse(topic, 'A', (m) => gotA.push(m.message));
  const sB = sse(topic, 'B', (m) => gotB.push(m.message));
  await sleep(1800);
  for (let i = 0; i < 3; i++) { await post(topic, 'msg' + i); await sleep(300); }
  await sleep(1200);
  console.log(`  设备A 收到 ${gotA.length} 条: ${gotA.join(',')}`);
  console.log(`  设备B 收到 ${gotB.length} 条: ${gotB.join(',')}`);
  console.log(`  广播正确: ${gotA.length === 3 && gotB.length === 3}`);

  console.log('\n=== B. 长连接存活 40 秒（看服务端会不会主动断）===');
  const before = sA.count;
  for (let i = 0; i < 8; i++) { await sleep(5000); await post(topic, 'hb' + i); }
  await sleep(1500);
  console.log(`  A 流仍开着: ${!sA.closed}   新增消息: ${sA.count - before} 条 (期望 8)`);
  if (sA.closed) console.log(`  断开原因: ${sA.err || '服务端关闭'}  存活 ${((sA.endAt - sA.openedAt) / 1000).toFixed(1)}s`);
  sA.req.destroy(); sB.req.destroy();

  console.log('\n=== C. 连续发布限流边界（同一 topic 灌 40 条）===');
  const t2 = 'jzburst' + Math.random().toString(36).slice(2, 8);
  let ok = 0, fail = 0, firstFail = -1;
  for (let i = 0; i < 40; i++) {
    const s = await post(t2, 'b' + i);
    if (s === 200) ok++; else { fail++; if (firstFail < 0) firstFail = i; }
  }
  console.log(`  成功 ${ok} 失败 ${fail}${firstFail >= 0 ? ` 首次失败在第 ${firstFail + 1} 条` : ''}`);

  console.log('\n=== D. 所有消息是否落盘可回放（新设备补历史）===');
  const back = await new Promise((resolve) => {
    const req = https.request({ host: 'ntfy.sh', path: '/' + topic + '/json?poll=1&since=all' }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d));
    }); req.end();
  });
  const lines = back.split('\n').filter((l) => l.includes('"event":"message"'));
  console.log(`  回放拿到 ${lines.length} 条历史（含前面 3+8=11 条为期望）`);
  process.exit(0);
})();
