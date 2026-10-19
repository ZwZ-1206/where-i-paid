/* 同步 · 收敛性（两台设备随机交错 200 轮，最后必须一模一样） */
'use strict';
require('./_sqlite');
const { makeServer, makeDevice } = require('./_syncenv');

let pass = 0;
let total = 0;
function ok(cond, name) {
  total++;
  if (cond) pass++;
  else console.log('  ✗ ' + name);
}

/** 固定种子，失败可复现 */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function snap(list) {
  return list
    .map((t) => {
      const o = {};
      Object.keys(t).sort().forEach((k) => { o[k] = t[k]; });
      return JSON.stringify(o);
    })
    .sort();
}

(async () => {
  // ============================================================
  // 场景 1：两人随机记账 200 轮，中间断网、乱序、互删
  // ============================================================
  const server = await makeServer();
  const A = makeDevice(server);
  const pair = A.CS.pair();

  A.add('seed', 100, '第一笔');
  await A.CS.syncOnce();              // 建房 + 推第一笔

  const B = makeDevice(server);
  const jr = await B.CS.join(pair);
  ok(jr.ok === true, 'B 用配对串加入');
  await B.CS.syncOnce();
  ok(B.txs.length === 1 && B.txs[0].id === 'seed', 'B 拉到 A 的历史账');
  ok(B.txs[0].amount === 100, '拉到的金额一致');

  const rand = rng(20261019);
  let n = 0;
  for (let i = 0; i < 200; i++) {
    const dev = rand() < 0.5 ? A : B;
    const r = rand();

    if (r < 0.38) {
      dev.add('t' + n++, 100 + Math.floor(rand() * 900), 'note' + i);
    } else if (r < 0.68) {
      const pool = dev.txs;
      if (pool.length) dev.edit(pool[Math.floor(rand() * pool.length)].id, { amount: Math.floor(rand() * 1000) });
    } else if (r < 0.84) {
      const pool = dev.txs;
      if (pool.length) dev.remove(pool[Math.floor(rand() * pool.length)].id);
    } else {
      server.setOffline(!server.stats.offline);
    }

    if (!server.stats.offline && rand() < 0.45) {
      await dev.CS.syncOnce();
    }
  }
  server.setOffline(false);

  // 双方各同步三轮，确保队列和拉取都排干净
  for (let k = 0; k < 3; k++) {
    await A.CS.syncOnce();
    await B.CS.syncOnce();
  }

  const sa = snap(A.txs);
  const sb = snap(B.txs);

  ok(sa.length === sb.length, '200 轮后两台设备账目条数相同（' + sa.length + ' 条）');
  ok(JSON.stringify(sa) === JSON.stringify(sb), '200 轮后两台设备逐字段完全一致');

  const leftA = A.CS.state().outbox.length;
  const leftB = B.CS.state().outbox.length;
  ok(leftA === 0 && leftB === 0, '两台设备的待发队列都为空');

  const rows = server.rows('SELECT COUNT(*) AS n FROM ops')[0].n;
  ok(rows > 20, '服务端确实存了一批 op（' + rows + ' 条）');

  const seqs = server.rows('SELECT seq FROM ops ORDER BY seq ASC').map((x) => x.seq);
  const uniq = new Set(seqs).size;
  ok(uniq === seqs.length, 'seq 没有重复（唯一索引兜住了）');
  ok(seqs[0] === 1 && seqs[seqs.length - 1] === seqs.length, 'seq 连续无空洞');

  const cipherAll = server.rows('SELECT cipher FROM ops').map((x) => x.cipher).join('|');
  // 旧写法是查子串 'note' —— 可 base64 的字母表里本来就有 n/o/t/e，
  // 随机密文偶尔真能拼出这四个字母，跑几千轮就假红一次（本轮碰上过：21/22）。
  // 改成查带引号的 JSON 键：引号不在 base64 字母表里，永远不会误报。
  ok(cipherAll.indexOf('"note"') < 0, '库里没有备注明文');

  // ============================================================
  // 场景 2：A 删、B 离线改 —— 删除必须赢，且不能复活
  // ============================================================
  const s2 = await makeServer();
  const A2 = makeDevice(s2);
  const pair2 = A2.CS.pair();
  A2.add('x', 500, '要删的');
  await A2.CS.syncOnce();

  const B2 = makeDevice(s2);
  await B2.CS.join(pair2);
  await B2.CS.syncOnce();
  ok(B2.txs.length === 1, 'B2 拿到了这笔');

  A2.remove('x');
  await A2.CS.syncOnce();                    // remove 进服务端
  B2.edit('x', { amount: 999 });             // B 离线改，还没发
  ok(B2.CS.state().outbox.length === 1, 'B 的修改进了队列');

  await B2.CS.syncOnce();                    // 先拉（应拿到 remove 并清队列）再推
  ok(B2.txs.length === 0, '对方删掉的账，本机也跟着消失');
  ok(B2.CS.state().outbox.length === 0, '被放弃的本地改动从队列里清掉了（不会推回去复活）');
  ok(B2.CS.state().dropped >= 1, '被放弃的改动被计数（UI 要能说出来）');

  await A2.CS.syncOnce();
  ok(A2.txs.length === 0, 'A 那边仍然是删掉的状态，没有被 B 的旧改动复活');

  // ============================================================
  // 场景 3：同一笔两边同时改 —— 服务端 seq 大的赢，两台看到同一个值
  // ============================================================
  const s3 = await makeServer();
  const A3 = makeDevice(s3);
  const pair3 = A3.CS.pair();
  A3.add('y', 100, '同改');
  await A3.CS.syncOnce();

  const B3 = makeDevice(s3);
  await B3.CS.join(pair3);
  await B3.CS.syncOnce();

  A3.edit('y', { amount: 111 });
  await A3.CS.syncOnce();          // seq 2
  B3.edit('y', { amount: 222 });
  await B3.CS.syncOnce();          // 先拉到 111，再推 222 → seq 3
  await A3.CS.syncOnce();

  ok(A3.txs[0].amount === 222, 'A 收到 B 更晚的修改（seq 3 胜）');
  ok(B3.txs[0].amount === 222, 'B 保持自己的修改');
  ok(A3.txs[0].amount === B3.txs[0].amount, '两边最终看到同一个金额');

  // ============================================================
  // 场景 4：清空浏览器的设备用配对串恢复
  // ============================================================
  const s4 = await makeServer();
  const A4 = makeDevice(s4);
  const pair4 = A4.CS.pair();
  A4.add('r1', 10, '甲');
  A4.add('r2', 20, '乙');
  await A4.CS.syncOnce();

  const Phone = makeDevice(s4);           // 全新设备，等同清过数据
  await Phone.CS.join(pair4);
  const pr = await Phone.CS.pullSince(0);
  ok(pr.ok === true && pr.added === 2, '新设备一次拉回全部历史（2 笔）');
  ok(Phone.txs.length === 2, '恢复后账本里是 2 笔');

  const Wrong = makeDevice(s4);
  const bad = await Wrong.CS.join(A4.CS.pairString().replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')));
  ok(bad.ok === false && bad.code === 'BAD_AUTH', '配对串错一位 → BAD_AUTH（明确的「配对串不对」）');

  console.log('通过 ' + pass + ' / ' + total);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => {
  console.error(e);
  console.log('通过 ' + pass + ' / ' + total);
  process.exit(1);
});
