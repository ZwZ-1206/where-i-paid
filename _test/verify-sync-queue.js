/* 同步 · outbox 队列（纯 Node，不启浏览器） */
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

const box = (dev) => dev.CS.state().outbox;

(async () => {
  const server = await makeServer();
  const A = makeDevice(server);

  // ---- 未配对 ----
  ok(A.CS.ready() === false, '没配对时 ready() 为假');
  ok(A.CS.hook({ kind: 'cptx.add', data: { id: 'x' } }) === false, '没配对时不入队');
  ok(box(A).length === 0, '没配对时队列是空的');

  // ---- 配对后 ----
  const pair = A.CS.pair();
  ok(A.CS.ready() === true, '配对后 ready() 为真');
  ok(A.CS.hook({ kind: 'cptx.add', data: { id: 't1', amount: 100 } }) === true, '配对后入队成功');
  ok(box(A).length === 1, '队列里 1 条');

  const firstOpId = box(A)[0].id;
  ok(typeof firstOpId === 'string' && firstOpId.length > 8, '入队时分配了 opId');

  // ---- 同一条实体只留最后状态 ----
  A.CS.hook({ kind: 'cptx.update', data: { id: 't1', amount: 200 } });
  ok(box(A).length === 1, '同 id 的 update 合并进同一条');
  ok(box(A)[0].kind === 'cptx.update', '留下的是最新 kind');
  ok(box(A)[0].data.amount === 200, '留下的是最新内容');
  ok(box(A)[0].id === firstOpId, '合并时复用同一个 opId（服务端幂等键不变）');

  A.CS.hook({ kind: 'cptx.remove', data: { id: 't1' } });
  ok(box(A).length === 1, 'add→update→remove 仍只有 1 条');
  ok(box(A)[0].kind === 'cptx.remove', 'remove 顶掉前面的 update');

  // ---- 不同实体各自排队 ----
  A.CS.hook({ kind: 'cptx.add', data: { id: 't2', amount: 50 } });
  ok(box(A).length === 2, '换一条账目就多一条队列项');

  // ---- 白名单 ----
  ok(A.CS.hook({ kind: 'subs.add', data: { id: 's1' } }) === false, '不在白名单里的 op 被丢弃');
  ok(A.CS.hook({ kind: 'settings.set', data: { id: 'cfg' } }) === false, '设置类 op 被丢弃');
  ok(A.CS.hook({ kind: 'cptx.add', data: null }) === false, '没有实体 id 的 op 被丢弃');
  ok(box(A).length === 2, '被拒的 op 没有污染队列');

  // ---- 旧调用点兼容：tx.add → cptx.add ----
  A.CS.hook({ kind: 'tx.add', data: { id: 't3', amount: 9 } });
  const t3 = box(A).find((e) => e.eid === 't3');
  ok(!!t3 && t3.kind === 'cptx.add', '骨架时期的 tx.add 被映射成 cptx.add');

  // ---- 推上去 ----
  const accepted = [];
  A.CS.onAccepted = (list) => accepted.push.apply(accepted, list);

  ok((await A.CS.outboxFlush()) === true, 'flush 成功');
  ok(box(A).length === 0, '成功后队列清空');
  ok(accepted.length === 3, '三条 op 都拿到了服务端 seq');
  ok(accepted.every((x) => typeof x.seq === 'number' && x.seq > 0), 'seq 都是正整数');
  ok(A.CS.state().created === true, '首次 push 建了房，created 置位');
  ok(server.stats.calls >= 1, '确实发了网络请求');

  // ---- 离线 ----
  server.setOffline(true);
  A.CS.hook({ kind: 'cptx.add', data: { id: 't9', amount: 1 } });
  ok(box(A).length === 1, '离线时照样入队（记账不受影响）');
  ok((await A.CS.outboxFlush()) === false, '离线时 flush 返回 false');
  ok(box(A).length === 1, '离线时队列不清空（不会丢）');
  ok(box(A)[0].tries === 1, '失败次数被记下来');
  ok(!!A.CS.state().lastError, '失败原因被记下来（状态灯据此变黄）');

  server.setOffline(false);
  ok((await A.CS.outboxFlush()) === true, '恢复网络后能补发');
  ok(box(A).length === 0, '补发成功后队列空');

  // ---- 批量上限 ----
  const B = makeDevice(server);
  const pairB = B.CS.pair();
  for (let i = 0; i < 60; i++) B.CS.outboxPush({ kind: 'cptx.add', data: { id: 'bulk' + i, amount: i } });
  ok(box(B).length === 60, '60 条都排队了');
  await B.CS.outboxFlush();
  ok(box(B).length === 10, '一次只发 50 条（MAX_BATCH）');
  await B.CS.outboxFlush();
  ok(box(B).length === 0, '再发一次把剩下的发完');

  // ---- 队列上限 ----
  for (let i = 0; i < 510; i++) B.CS.outboxPush({ kind: 'cptx.add', data: { id: 'cap' + i, amount: i } });
  ok(box(B).length === 500, '队列超过 500 条后丢掉最老的，不无限增长');

  // ---- join 之后不该再发 create ----
  const C = makeDevice(server);
  const r = await C.CS.join(pair);
  ok(r.ok === true, '用配对串加入成功');
  ok(C.CS.state().created === true, '加入方认为房间已存在，不再发 create');
  ok(C.CS.state().lastSeq === 0, '加入后从 0 开始拉，能拿到全部历史');

  const D = makeDevice(server);
  D.CS.pair();
  const roomBefore = D.CS.state().room;
  const rBad = await D.CS.join('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  ok(rBad.ok === false, '错的配对串被拒绝');
  ok(rBad.code === 'ROOM_NOT_FOUND' || rBad.code === 'BAD_AUTH' || rBad.code === 'BAD_PAIR', '拒绝原因可区分');
  ok(D.CS.state().room === roomBefore, '加入失败不破坏本机已有的配对');

  console.log('通过 ' + pass + ' / ' + total);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => {
  console.error(e);
  console.log('通过 ' + pass + ' / ' + total);
  process.exit(1);
});
