/**
 * GET /api/couple/health
 *
 * 只回答「服务可达吗」，不暴露任何房间信息，不验 auth。
 * 客户端用它区分「连不上服务器」和「配对串不对」——这个顺序很重要。
 */
import { json } from './_lib.js';

export async function onRequestGet() {
  return json({ ok: true, v: 2, time: Math.floor(Date.now() / 1000) });
}

export async function onRequest() {
  return json({ ok: false, code: 'BAD_REQUEST' }, 405);
}
