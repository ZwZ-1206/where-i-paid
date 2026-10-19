/**
 * 生成一对配对串，给 curl 自测用（M1 的 Step 5）。
 *
 *   node _test/sync-pairgen.js
 *   → { room, secret, auth, pair }
 *
 * room  32 位小写 hex，接口里用这个
 * auth  43 字符 base64url，放到请求头 x-couple-auth
 * pair  43 字符，给用户扫/贴的那串
 */
'use strict';
require('./_sqlite');
const { makeDevice } = require('./_syncenv');

(async () => {
  const dev = makeDevice(null);
  const pair = dev.CS.pair();
  const p = dev.CS.parsePair(pair);
  if (!p) throw new Error('生成的配对串解析失败');
  const k = await dev.CS.deriveKey(p.secret, p.room);
  const out = { room: p.room, secret: p.secret, auth: k.authKey, pair };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
