/* 精确测 ntfy 限流：突发上限 + 恢复速率 */
'use strict';
const https = require('https');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function post(topic, body) {
  return new Promise((resolve) => {
    const req = https.request({ host: 'ntfy.sh', path: '/' + topic, method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let d=''; res.on('data',c=>d+=c); res.on('end', () => resolve({ s: res.statusCode, ra: res.headers['retry-after'], body: d.slice(0,120) })); });
    req.on('error', (e) => resolve({ s: 0, body: e.message }));
    req.write(body); req.end();
  });
}
(async () => {
  const t = 'jzrate' + Math.random().toString(36).slice(2, 8);
  console.log('=== 突发上限：连发直到失败 ===');
  let n = 0, failAt = -1, ra = null, body = null;
  for (let i = 0; i < 80; i++) {
    const r = await post(t, 'r' + i);
    if (r.s === 200) n++;
    else { failAt = i + 1; ra = r.ra; body = r.body; break; }
  }
  console.log(`  连续成功 ${n} 条，第 ${failAt} 条失败  retry-after=${ra}`);
  console.log(`  失败响应: ${body}`);

  console.log('\n=== 恢复速率：每 3 秒发 1 条，看何时恢复 ===');
  for (let i = 0; i < 8; i++) {
    await sleep(3000);
    const r = await post(t, 'recover' + i);
    if (r.s === 200) { console.log(`  等待 ${(i + 1) * 3}s 后恢复成功`); break; }
  }

  console.log('\n=== 分片发送可行性：3.9KB × 20 片，每片间隔 1.2s ===');
  const t2 = 'jzchunk' + Math.random().toString(36).slice(2, 8);
  const pad = 'Y'.repeat(3800);
  const t0 = Date.now();
  let ok = 0;
  for (let i = 0; i < 20; i++) {
    const r = await post(t2, `P${i}/20:` + pad);
    if (r.s === 200) ok++; else { console.log(`  第 ${i + 1} 片失败 ${r.s}`); break; }
    await sleep(1200);
  }
  console.log(`  ${ok}/20 片成功，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s（约 ${(ok * 3.9).toFixed(0)}KB）`);
  process.exit(0);
})();
