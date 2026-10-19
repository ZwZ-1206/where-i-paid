/**
 * DELETE /api/couple/room —— 删云端房间
 *
 * 持有配对串（= 持有 authKey）才有权删。真删，不是标记。
 * 请求体：{ room, confirm: "DELETE" }
 */
import { json, bad, readAuth, checkRoom, ROOM_RE } from './_lib.js';

export async function onRequestDelete({ request, env }) {
  if (!env || !env.DB) return bad('SERVER_ERROR', 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return bad('BAD_REQUEST', 400);
  }
  if (!body || body.confirm !== 'DELETE') return bad('BAD_REQUEST', 400);
  if (!ROOM_RE.test(String(body.room || ''))) return bad('BAD_REQUEST', 400);

  const authKey = readAuth(request);
  if (!authKey) return bad('BAD_AUTH', 401);

  const room = String(body.room);
  const state = await checkRoom(env, room, authKey);
  if (state === 'notfound') return bad('ROOM_NOT_FOUND', 404);
  if (state !== 'ok') return bad('BAD_AUTH', 401);

  const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM ops WHERE room = ?1').bind(room).first();
  const deleted = before ? Number(before.n) : 0;

  await env.DB.prepare('DELETE FROM ops WHERE room = ?1').bind(room).run();
  await env.DB.prepare('DELETE FROM rooms WHERE room = ?1').bind(room).run();

  return json({ ok: true, deleted });
}

export async function onRequest() {
  return bad('BAD_REQUEST', 405);
}
