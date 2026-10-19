/* 可持续发送速率 + 附件通道可行性 */
'use strict';
const https = require('https');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(opts, body) {
  return new Promise((resolve) => {
    const r = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks), h: res.headers }));
    });
    r.on('error', (e) => resolve({ status: 0, buf: Buffer.from(e.message), h: {} }));
    if (body) r.write(body);
    r.end();
  });
}
const postMsg = (topic, body) => req({ host: 'ntfy.sh', path: '/' + topic, method: 'POST',
  headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } }, body);

(async () => {
  console.log('=== A. 每 3 秒 1 条，持续 10 条 ===');
  const t1 = 'jzsus' + Math.random().toString(36).slice(2, 8);
  let ok = 0, fail = 0;
  for (let i = 0; i < 10; i++) {
    const r = await postMsg(t1, 's' + i);
    if (r.status === 200) ok++; else fail++;
    await sleep(3000);
  }
  console.log(`  成功 ${ok} 失败 ${fail}  → 3s/条 ${fail === 0 ? '可持续' : '不可持续'}`);

  console.log('\n=== B. 附件通道：上传 30KB 再下载回 ===');
  const t2 = 'jzatt' + Math.random().toString(36).slice(2, 8);
  const payload = Buffer.from('{"snapshot":"' + 'Z'.repeat(30000) + '"}', 'utf8');
  const up = await req({
    host: 'ntfy.sh', path: '/' + t2, method: 'PUT',
    headers: { 'Filename': 'snap.json', 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length },
  }, payload);
  console.log(`  上传 status=${up.status} 响应=${up.buf.toString('utf8').slice(0, 160)}`);
  let att = null;
  try { att = JSON.parse(up.buf.toString('utf8')).attachment; } catch (e) {}
  if (att) {
    console.log(`  attachment: name=${att.name} size=${att.size} url=${att.url}`);
    const down = await req({ host: 'ntfy.sh', path: new URL(att.url).pathname, method: 'GET' });
    console.log(`  下载 status=${down.status} 字节数=${down.buf.length} 一致=${down.buf.equals(payload)}`);
  } else {
    console.log('  没拿到 attachment 字段');
  }

  console.log('\n=== C. 附件上限探测：5MB 是否接受 ===');
  const t3 = 'jzatt2' + Math.random().toString(36).slice(2, 8);
  for (const mb of [1, 5]) {
    const p = Buffer.alloc(mb * 1024 * 1024, 0x41);
    const u = await req({ host: 'ntfy.sh', path: '/' + t3, method: 'PUT',
      headers: { Filename: `f${mb}.bin`, 'Content-Type': 'application/octet-stream', 'Content-Length': p.length } }, p);
    console.log(`  ${mb}MB -> ${u.status} ${u.status !== 200 ? u.buf.toString('utf8').slice(0, 100) : 'ok'}`);
    await sleep(2500);
  }
  process.exit(0);
})();
