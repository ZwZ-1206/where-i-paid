/**
 * 同步 · 实机冒烟（打真正跑起来的 Worker + D1 binding）
 *
 * 前面五个 verify-sync-* 跑的是「真 handler + 真 SQLite」，但 Request/Response
 * 用的是 Node 的实现。这个脚本换个方向：客户端引擎原封不动，网络那层换成
 * 真实 HTTP，打到 `wrangler pages dev` 起的 workerd 上 —— 也就是线上那一套。
 *
 * 用之前先起服务：
 *   npx wrangler pages dev dist --d1 DB=<id> --port 8788
 * 然后：
 *   node _test/verify-sync-live.js
 *   SYNC_BASE=https://xxx.pages.dev node _test/verify-sync-live.js   # 打线上
 */
'use strict';
require('./_sqlite');
const { makeDevice } = require('./_syncenv');

const BASE = (process.env.SYNC_BASE || 'http://127.0.0.1:8788').replace(/\/$/, '');

let pass = 0;
let total = 0;
function ok(cond, name) {
  total++;
  if (cond) pass++;
  else console.log('  ✗ ' + name);
}

(async () => {
  // 先确认服务在
  let up = false;
  try {
    const r = await fetch(BASE + '/api/couple/health');
    const j = await r.json();
    up = r.ok && j.ok === true && j.v === 2;
  } catch (e) {
    up = false;
  }
  if (!up) {
    console.log('✗ ' + BASE + ' 上没有跑着的同步服务');
    console.log('  先执行：npx wrangler pages dev dist --d1 DB=<id> --port 8788');
    console.log('通过 0 / 1');
    process.exit(1);
  }
  ok(true, 'health 可达且 v=2');

  // 两台「手机」，网络层换成真 HTTP
  const live = { fetchFn: (p, init) => fetch(BASE + p, init) };
  const A = makeDevice(live);
  const B = makeDevice(live);

  const pairStr = A.CS.pair();
  const parsed = A.CS.parsePair(pairStr);

  // A 记一笔并推上去（首次 push 会建房）
  A.add('live1', 2333, '实机冒烟');
  const r1 = await A.CS.syncOnce();
  ok(r1.ok === true, 'A 首次同步成功（建房 + 推送）');
  ok(A.CS.state().created === true, 'A 记住了房间已建好');
  ok(A.CS.state().outbox.length === 0, 'A 的队列已清空');
  ok(A.CS.state().lastError === '', 'A 没有残留错误');

  // B 用配对串加入，拉到 A 的那一笔
  const jr = await B.CS.join(pairStr);
  ok(jr.ok === true, 'B 用配对串加入成功');
  await B.CS.syncOnce();
  const got = B.txs.find((t) => t.id === 'live1');
  ok(!!got, 'B 拉到了 A 记的那一笔');
  ok(got && got.amount === 2333, '金额一致（密文在 workerd 里存、在客户端解）');
  ok(got && got.note === '实机冒烟', '备注一致（服务端确实看不到明文）');

  // B 改一笔，A 能收到
  B.edit('live1', { amount: 2500 });
  await B.CS.syncOnce();
  await A.CS.syncOnce();
  const after = A.txs.find((t) => t.id === 'live1');
  ok(after && after.amount === 2500, 'B 的修改同步回 A（按 seq 后到者胜）');

  // 鉴权反例：用真 HTTP 打
  const wrong = 'A'.repeat(43);
  let res = await fetch(BASE + '/api/couple/pull?room=' + parsed.room + '&since=0', {
    headers: { 'x-couple-auth': wrong },
  });
  let body = await res.json().catch(() => ({}));
  ok(res.status === 401 && body.code === 'BAD_AUTH', '错 auth 的 pull 返回 401 BAD_AUTH');

  res = await fetch(BASE + '/api/couple/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-couple-auth': wrong },
    body: JSON.stringify({ room: parsed.room, create: true, ops: [{ opId: 'evil', cipher: 'AAAA' }] }),
  });
  body = await res.json().catch(() => ({}));
  ok(res.status === 409 && body.code === 'ROOM_TAKEN', '带 create 抢注已有房间返回 409 ROOM_TAKEN');

  res = await fetch(BASE + '/api/couple/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room: parsed.room, ops: [{ opId: 'x', cipher: 'AAAA' }] }),
  });
  ok(res.status === 401, '不带 auth 的 push 返回 401');

  // 收拾现场：把这次建的房间真删掉
  const key = await A.CS.deriveKey(parsed.secret, parsed.room);
  res = await fetch(BASE + '/api/couple/room', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', 'x-couple-auth': key.authKey },
    body: JSON.stringify({ room: parsed.room, confirm: 'DELETE' }),
  });
  body = await res.json().catch(() => ({}));
  ok(res.ok && body.ok === true && body.deleted >= 2, '删除云端：真删了 ' + (body.deleted || 0) + ' 条 op');

  res = await fetch(BASE + '/api/couple/pull?room=' + parsed.room + '&since=0', {
    headers: { 'x-couple-auth': key.authKey },
  });
  ok(res.status === 404, '删完之后再拉返回 404');

  console.log('通过 ' + pass + ' / ' + total);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => {
  console.error(e);
  console.log('通过 ' + pass + ' / ' + total);
  process.exit(1);
});
