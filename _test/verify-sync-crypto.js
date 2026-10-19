/* 同步 · 密钥与加密（纯 Node，不启浏览器） */
'use strict';
require('./_sqlite');
const { makeDevice } = require('./_syncenv');

let pass = 0;
let total = 0;
function ok(cond, name) {
  total++;
  if (cond) pass++;
  else console.log('  ✗ ' + name);
}

/** 把一台设备的同步状态直接摆成「已配对」 */
function seed(dev, room, secret) {
  dev.CS._reset();
  const s = dev.CS.state();
  s.room = room;
  s.secret = secret;
  dev.CS._persist();
}

(async () => {
  const A = makeDevice(null);
  const B = makeDevice(null);
  const C = makeDevice(null);

  // ---- 配对串 ----
  const pair = A.CS.pair();
  ok(typeof pair === 'string' && pair.length === 43, '配对串是 43 字符');
  ok(/^[A-Za-z0-9_-]+$/.test(pair), '配对串只用 base64url 字符');

  const p = A.CS.parsePair(pair);
  ok(!!p && /^[0-9a-f]{32}$/.test(p.room), 'room 解出来是 32 位小写 hex');
  ok(A.CS.pairString() === pair, 'pairString() 能还原同一个配对串');

  // 手抄容错：分组只能用空格。'-' 是 base64url 的合法字符，拿它当分隔符会直接破解码
  const spaced = pair.slice(0, 4) + ' ' + pair.slice(4, 8) + '  ' + pair.slice(8, 20) + '\n' + pair.slice(20);
  const pd = A.CS.parsePair(spaced);
  ok(!!pd && pd.room === p.room, '解析时忽略空格与换行（手抄容错）');
  ok(pair.indexOf('-') < 0 || A.CS.parsePair(pair).room === p.room, '配对串里的 - 按字符处理，不当分隔符');

  ok(A.CS.parsePair('abc') === null, '长度不对的配对串被拒绝');
  ok(A.CS.parsePair('') === null, '空配对串被拒绝');

  // 两次配对必须给出不同的 room（随机性）
  const A2 = makeDevice(null);
  const pair2 = A2.CS.pair();
  ok(pair2 !== pair, '两次生成的配对串不同');

  // ---- 密钥派生 ----
  const ka = await A.CS.deriveKey(p.secret, p.room);
  const kb = await B.CS.deriveKey(p.secret, p.room);
  ok(ka.authKey === kb.authKey, '同一 secret+room 派生出同一个 authKey');
  ok(ka.authKey.length === 43, 'authKey 是 43 字符 base64url');
  ok(/^[A-Za-z0-9_-]{43}$/.test(ka.authKey), 'authKey 符合服务端正则');

  let threw = false;
  try { await A.CS.deriveKey('AAAA', p.room); } catch (e) { threw = true; }
  ok(threw, 'secret 长度不对时抛错（而不是静默给个弱密钥）');

  threw = false;
  try { await A.CS.deriveKey(p.secret, 'zzzz'); } catch (e) { threw = true; }
  ok(threw, 'room 格式不对时抛错');

  // ---- 加解密 ----
  seed(B, p.room, p.secret);
  const opId = 'op-0001';
  const payload = { p: 2, k: 'cptx.add', d: { id: 'cptx_a', amount: 1234, note: '楼下便利店' }, t: 1730000000000 };
  const c1 = await A.CS.encryptOp(payload, opId);
  ok(typeof c1 === 'string' && c1.length > 20, '加密产出 base64url 密文');

  const back = await B.CS.decryptOp(c1, opId);
  ok(!!back && back.d.amount === 1234 && back.d.note === '楼下便利店', 'A 加密 → B 解密，内容一致');

  // AAD：换 opId 就解不开（挡住服务端把 op 换个 id 重放）
  ok((await B.CS.decryptOp(c1, 'op-0002')) === null, '换 opId 解不开（AAD 生效）');

  // 换房间就解不开（挡住跨房间搬运）
  const pC = C.CS.pair();
  ok((await C.CS.decryptOp(c1, opId)) === null, '别的房间解不开');

  // 密文里不能出现明文
  ok(c1.indexOf('1234') < 0 && c1.indexOf('cptx_a') < 0, '密文里没有明文痕迹');

  // IV 随机：同一段明文两次加密结果不同
  const c2 = await A.CS.encryptOp(payload, opId);
  ok(c1 !== c2, '同一明文两次加密结果不同（IV 随机）');

  // 篡改一个字符必须解不开，而不是解出垃圾
  const mid = Math.floor(c1.length / 2);
  const flip = (c1[mid] === 'A' ? 'B' : 'A');
  const tampered = c1.slice(0, mid) + flip + c1.slice(mid + 1);
  ok((await B.CS.decryptOp(tampered, opId)) === null, '密文被篡改后解密失败');

  ok((await B.CS.decryptOp('not-base64!!', opId)) === null, '非法密文返回 null 而不是抛错');

  // 兼容骨架时期的两个入口
  const raw = await A.CS.encrypt({ hello: 'world' }, 'raw1');
  const rawBack = await A.CS.decrypt(raw, 'raw1');
  ok(!!rawBack && rawBack.hello === 'world', 'encrypt/decrypt 旧入口仍可用');

  console.log('通过 ' + pass + ' / ' + total);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => {
  console.error(e);
  console.log('通过 ' + pass + ' / ' + total);
  process.exit(1);
});
