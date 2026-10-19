/* 同步 · 服务端接口（真 Functions + 真 SQLite） */
'use strict';
require('./_sqlite');
const { makeServer } = require('./_syncenv');

let pass = 0;
let total = 0;
function ok(cond, name) {
  total++;
  if (cond) pass++;
  else console.log('  ✗ ' + name);
}

(async () => {
  const s = await makeServer();
  const H = {
    health: s.mods.health.onRequestGet,
    push: s.mods.push.onRequestPost,
    pull: s.mods.pull.onRequestGet,
    room: s.mods.room.onRequestDelete,
  };

  /** 发一个请求，返回 {status, body} */
  async function call(fn, path, { method, auth, body } = {}) {
    const headers = {};
    if (auth) headers['x-couple-auth'] = auth;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const req = new Request('http://local.test' + path, {
      method: method || (body !== undefined ? 'POST' : 'GET'),
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const res = await fn({ request: req, env: s.env });
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    return { status: res.status, body: json };
  }

  // 造一对合法的 room / auth
  const { webcrypto } = require('crypto');
  const { bytesToB64url } = await import('../functions/api/couple/_lib.js');
  const roomB = webcrypto.getRandomValues(new Uint8Array(16));
  const room = Array.from(roomB, (b) => b.toString(16).padStart(2, '0')).join('');
  const authKey = bytesToB64url(webcrypto.getRandomValues(new Uint8Array(32)));
  const badAuth = bytesToB64url(webcrypto.getRandomValues(new Uint8Array(32)));
  const dummy = 'AAAA';

  // ---- health ----
  let r = await call(H.health, '/api/couple/health');
  ok(r.status === 200 && r.body.ok === true, 'health 返回 200');
  ok(r.body.v === 2, 'health 报协议版本 2');
  ok(typeof r.body.time === 'number' && r.body.time > 1600000000, 'health 带时间戳');
  ok(!('room' in r.body), 'health 不泄露任何房间信息');

  // ---- push 鉴权 ----
  r = await call(H.push, '/api/couple/push', { body: { room, ops: [{ opId: 'a', cipher: dummy }] } });
  ok(r.status === 401 && r.body.code === 'BAD_AUTH', '不带 auth 的 push 被拒（401）');

  r = await call(H.push, '/api/couple/push', { auth: 'short', body: { room, ops: [{ opId: 'a', cipher: dummy }] } });
  ok(r.status === 401, '格式不对的 auth 被拒');

  r = await call(H.push, '/api/couple/push', { auth: badAuth, body: { room, ops: [{ opId: 'a', cipher: dummy }] } });
  ok(r.status === 404 && r.body.code === 'ROOM_NOT_FOUND', '房间不存在且没带 create → ROOM_NOT_FOUND');

  // ---- 参数校验 ----
  r = await call(H.push, '/api/couple/push', { auth: authKey, body: { room: 'XYZ', ops: [{ opId: 'a', cipher: dummy }], create: true } });
  ok(r.status === 400 && r.body.code === 'BAD_REQUEST', 'room 格式不对 → 400');

  r = await call(H.push, '/api/couple/push', { auth: authKey, body: { room, ops: [], create: true } });
  ok(r.status === 400, '空 ops → 400');

  r = await call(H.push, '/api/couple/push', {
    auth: authKey,
    body: { room, create: true, ops: Array.from({ length: 51 }, (_, i) => ({ opId: 'z' + i, cipher: dummy })) },
  });
  ok(r.status === 413 && r.body.code === 'TOO_MANY_OPS', '超过 50 条 → TOO_MANY_OPS');

  r = await call(H.push, '/api/couple/push', {
    auth: authKey,
    body: { room, create: true, ops: [{ opId: 'big', cipher: 'A'.repeat(5000) }] },
  });
  ok(r.status === 400, 'cipher 超 4KB → 400');

  // ---- 建房 ----
  r = await call(H.push, '/api/couple/push', { auth: authKey, body: { room, create: true, ops: [{ opId: 'op1', ts: 1730000000000, cipher: dummy }] } });
  ok(r.status === 200 && r.body.ok === true, '带 create 的首次 push 成功');
  ok(r.body.created === true, '首次 push 建了房');
  ok(r.body.accepted === 1 && r.body.seqs[0].seq === 1, '第一条 op 拿到 seq=1');

  // ---- 幂等 ----
  r = await call(H.push, '/api/couple/push', { auth: authKey, body: { room, ops: [{ opId: 'op1', cipher: dummy }] } });
  ok(r.status === 200 && r.body.seqs[0].seq === 1, '重复推同一条 op 返回原来的 seq（幂等）');
  ok(r.body.created === false, '第二次不再报 created');

  const cnt = s.rows('SELECT COUNT(*) AS n FROM ops WHERE room = ?', room)[0].n;
  ok(cnt === 1, '重复推没有多存一条');

  // ---- 抢注 ----
  r = await call(H.push, '/api/couple/push', { auth: badAuth, body: { room, create: true, ops: [{ opId: 'evil', cipher: dummy }] } });
  ok(r.status === 409 && r.body.code === 'ROOM_TAKEN', '带 create 撞上别人的房间 → 409 ROOM_TAKEN');

  r = await call(H.push, '/api/couple/push', { auth: badAuth, body: { room, ops: [{ opId: 'evil2', cipher: dummy }] } });
  ok(r.status === 401 && r.body.code === 'BAD_AUTH', '不带 create 的错 auth → 401（两种错误要能区分）');

  const roomTaken = Array.from(webcrypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  await call(H.push, '/api/couple/push', { auth: authKey, body: { room: roomTaken, create: true, ops: [{ opId: 'x1', cipher: dummy }] } });
  r = await call(H.push, '/api/couple/push', { auth: badAuth, body: { room: roomTaken, create: true, ops: [{ opId: 'x2', cipher: dummy }] } });
  ok(r.status === 409, '抢注已有房间被拒，且不覆盖原 auth_hash');
  const hashKept = s.rows('SELECT auth_hash FROM rooms WHERE room = ?', roomTaken);
  ok(hashKept.length === 1 && hashKept[0].auth_hash.length === 43, '原来的 auth_hash 还在（没被抢注者覆盖）');

  // ---- pull ----
  await call(H.push, '/api/couple/push', { auth: authKey, body: { room, ops: [{ opId: 'op2', cipher: dummy }, { opId: 'op3', cipher: dummy }] } });

  r = await call(H.pull, '/api/couple/pull?room=' + room + '&since=0&limit=2', { auth: authKey });
  ok(r.status === 200 && r.body.ops.length === 2, 'pull 按 limit 返回 2 条');
  ok(r.body.ops[0].seq === 1 && r.body.ops[1].seq === 2, '顺序按 seq 升序');
  ok(r.body.hasMore === true, '还有更多时 hasMore 为真');
  ok(r.body.next === 2, 'next 是最后一条的 seq');

  r = await call(H.pull, '/api/couple/pull?room=' + room + '&since=2&limit=200', { auth: authKey });
  ok(r.body.ops.length === 1 && r.body.ops[0].seq === 3, 'since 之后只剩 1 条');
  ok(r.body.hasMore === false, '取完时 hasMore 为假');

  r = await call(H.pull, '/api/couple/pull?room=' + room + '&since=3', { auth: authKey });
  ok(r.body.ops.length === 0, 'since=最新 时返回空数组');
  ok(r.body.next === 3, '空结果时 next 保持在 since');

  r = await call(H.pull, '/api/couple/pull?room=' + room + '&since=0', { auth: badAuth });
  ok(r.status === 401 && r.body.code === 'BAD_AUTH', '错 auth 的 pull → 401（配对失败的判据）');

  r = await call(H.pull, '/api/couple/pull?room=' + room + '&since=0');
  ok(r.status === 401, '不带 auth 的 pull → 401');

  r = await call(H.pull, '/api/couple/pull?room=00000000000000000000000000000000', { auth: authKey });
  ok(r.status === 404 && r.body.code === 'ROOM_NOT_FOUND', '不存在的房间 → 404');

  r = await call(H.pull, '/api/couple/pull?room=bad', { auth: authKey });
  ok(r.status === 400, 'room 格式不对的 pull → 400');

  // ---- 服务端不存明文 ----
  const secret16 = webcrypto.getRandomValues(new Uint8Array(16));
  const ikm = await webcrypto.subtle.importKey('raw', secret16, 'HKDF', false, ['deriveKey']);
  const encKey = await webcrypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: roomB, info: new TextEncoder().encode('jz1/enc/v1') },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(room + '|plaincheck|2');
  const ct = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad }, encKey,
    new TextEncoder().encode(JSON.stringify({ id: 'cptx_x', amount: 1234, note: '楼下便利店' }))
  ));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv); all.set(ct, iv.length);
  await call(H.push, '/api/couple/push', { auth: authKey, body: { room, ops: [{ opId: 'plaincheck', cipher: bytesToB64url(all) }] } });

  const stored = s.rows('SELECT cipher FROM ops WHERE room = ?', room).map((x) => x.cipher).join('|');
  ok(stored.indexOf('便利店') < 0, '库里没有备注明文');
  ok(stored.indexOf('1234') < 0, '库里没有金额明文');
  ok(stored.indexOf('cptx_x') < 0, '库里没有实体 id 明文');

  // ---- 删除 ----
  r = await call(H.room, '/api/couple/room', { method: 'DELETE', auth: authKey, body: { room, confirm: 'no' } });
  ok(r.status === 400, 'confirm 不对 → 400');

  r = await call(H.room, '/api/couple/room', { method: 'DELETE', auth: badAuth, body: { room, confirm: 'DELETE' } });
  ok(r.status === 401, '错 auth 不能删云端');

  r = await call(H.room, '/api/couple/room', { method: 'DELETE', auth: authKey, body: { room, confirm: 'DELETE' } });
  ok(r.status === 200 && r.body.deleted === 4, '删除返回删掉的 op 条数');

  const left = s.rows('SELECT COUNT(*) AS n FROM ops WHERE room = ?', room)[0].n;
  const rooms = s.rows('SELECT COUNT(*) AS n FROM rooms WHERE room = ?', room)[0].n;
  ok(left === 0 && rooms === 0, '删除是真删（ops 与 rooms 都清掉）');

  r = await call(H.pull, '/api/couple/pull?room=' + room + '&since=0', { auth: authKey });
  ok(r.status === 404, '删完之后 pull → ROOM_NOT_FOUND');

  console.log('通过 ' + pass + ' / ' + total);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => {
  console.error(e);
  console.log('通过 ' + pass + ' / ' + total);
  process.exit(1);
});
