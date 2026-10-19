/**
 * GET /api/couple/pull?room=<32hex>&since=<seq>&limit=<1..200>
 *
 * 增量拉取。鉴权失败（401 BAD_AUTH）是「配对串不对」的唯一判据，
 * 比「拉到密文解不开」更早、更明确。
 */
import { json, bad, readAuth, checkRoom, ROOM_RE } from './_lib.js';

export async function onRequestGet({ request, env }) {
  if (!env || !env.DB) return bad('SERVER_ERROR', 500);

  const url = new URL(request.url);
  const room = url.searchParams.get('room') || '';
  if (!ROOM_RE.test(room)) return bad('BAD_REQUEST', 400);

  const authKey = readAuth(request);
  if (!authKey) return bad('BAD_AUTH', 401);

  const state = await checkRoom(env, room, authKey);
  if (state === 'notfound') return bad('ROOM_NOT_FOUND', 404);
  if (state !== 'ok') return bad('BAD_AUTH', 401);

  const since = Math.max(0, Math.floor(Number(url.searchParams.get('since') || 0)) || 0);
  const limitRaw = Math.floor(Number(url.searchParams.get('limit') || 200));
  const limit = Math.min(200, Math.max(1, limitRaw >= 1 ? limitRaw : 200));

  const { results } = await env.DB.prepare(
    `SELECT seq, op_id, ts, cipher FROM ops
     WHERE room = ?1 AND seq > ?2 ORDER BY seq ASC LIMIT ?3`
  )
    .bind(room, since, limit + 1)
    .all();

  const rows = results || [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const next = page.length ? Number(page[page.length - 1].seq) : since;

  return json({
    ok: true,
    room,
    ops: page.map((r) => ({ seq: Number(r.seq), opId: r.op_id, ts: Number(r.ts), cipher: r.cipher })),
    next,
    hasMore,
  });
}

export async function onRequest() {
  return bad('BAD_REQUEST', 405);
}
