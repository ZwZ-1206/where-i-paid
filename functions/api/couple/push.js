/**
 * POST /api/couple/push
 *
 * 收 op、建房（create:true）、验 auth、分配 seq、幂等。
 * 请求头：x-couple-auth: <43 字符 base64url authKey>
 * 请求体：{ room, create?, ops: [{ opId, ts, cipher }] }
 *
 * 为什么建房并在这里：少一个接口、少一次往返，也不会出现
 * 「忘了先建房导致第一条 op 404」这种顺序 bug。
 */
import { json, bad, readAuth, checkRoom, sha256b64url, safeEq, ROOM_RE, MAX_CIPHER, MAX_OPS } from './_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env || !env.DB) return bad('SERVER_ERROR', 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return bad('BAD_REQUEST', 400);
  }
  if (!body || typeof body !== 'object') return bad('BAD_REQUEST', 400);
  if (!ROOM_RE.test(String(body.room || ''))) return bad('BAD_REQUEST', 400);

  const authKey = readAuth(request);
  if (!authKey) return bad('BAD_AUTH', 401);

  const raw = Array.isArray(body.ops) ? body.ops : [];
  if (!raw.length) return bad('BAD_REQUEST', 400);
  if (raw.length > MAX_OPS) return bad('TOO_MANY_OPS', 413);

  const ops = [];
  for (const op of raw) {
    if (!op || typeof op.opId !== 'string') return bad('BAD_REQUEST', 400);
    if (!op.opId || op.opId.length > 64) return bad('BAD_REQUEST', 400);
    if (typeof op.cipher !== 'string') return bad('BAD_REQUEST', 400);
    if (!op.cipher || op.cipher.length > MAX_CIPHER) return bad('BAD_REQUEST', 400);
    ops.push({ opId: op.opId, cipher: op.cipher, ts: Number(op.ts) || Date.now() });
  }

  const room = String(body.room);
  const authHash = await sha256b64url(authKey);

  let state = await checkRoom(env, room, authKey);
  let created = false;

  if (state === 'notfound') {
    if (!body.create) return bad('ROOM_NOT_FOUND', 404);
    const now = Date.now();
    await env.DB
      .prepare('INSERT OR IGNORE INTO rooms (room, created_at, last_at, auth_hash) VALUES (?1, ?2, ?2, ?3)')
      .bind(room, now, authHash)
      .run();
    // 抢注检查：如果刚才被别人先插进去了，auth_hash 会是对方的
    state = await checkRoom(env, room, authKey);
    if (state === 'bad' || state === 'notfound') return bad('ROOM_TAKEN', 409);
    created = true;
  }
  if (state === 'bad') {
    // 带 create 撞上别人的房间 = 「这串配对串对应的房间被占了」，
    // 不是「你的钥匙错」。两者给用户的提示完全不同，别混成一个 401。
    return body.create ? bad('ROOM_TAKEN', 409) : bad('BAD_AUTH', 401);
  }
  if (state === 'notfound') return bad('ROOM_NOT_FOUND', 404);

  const seqs = [];
  for (const op of ops) {
    // 一条语句：不存在才插，seq 取 MAX+1；已存在则不插、返回空行
    const ins = await env.DB
      .prepare(
        `INSERT INTO ops (room, op_id, seq, cipher, ts)
         SELECT ?1, ?2, COALESCE((SELECT MAX(seq) FROM ops WHERE room = ?1), 0) + 1, ?3, ?4
         WHERE NOT EXISTS (SELECT 1 FROM ops WHERE room = ?1 AND op_id = ?2)
         RETURNING seq`
      )
      .bind(room, op.opId, op.cipher, op.ts)
      .first();

    let seq = ins && ins.seq != null ? Number(ins.seq) : null;

    if (seq == null) {
      // 幂等命中：把原来那条的 seq 还回去
      const old = await env.DB
        .prepare('SELECT seq FROM ops WHERE room = ?1 AND op_id = ?2')
        .bind(room, op.opId)
        .first();
      if (!old) return bad('SERVER_ERROR', 500); // 极罕见：插入未发生但查不到
      seq = Number(old.seq);
    }
    seqs.push({ opId: op.opId, seq });
  }

  await env.DB.prepare('UPDATE rooms SET last_at = ?2 WHERE room = ?1').bind(room, Date.now()).run();

  return json({ ok: true, accepted: seqs.length, created, seqs });
}

/** 方法不对时给一句人话，别让 wrangler 的默认 405 页把调试带偏 */
export async function onRequest() {
  return bad('BAD_REQUEST', 405);
}
