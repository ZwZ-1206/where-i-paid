/* 同步 · 合并内核（只按 seq，纯函数） */
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

const tx = (id, amount, extra) => Object.assign({ id, amount, cpBookId: 'cp1' }, extra || {});

(async () => {
  const dev = makeDevice(null);
  const CS = dev.CS;

  // ---- 新增 ----
  let list = [];
  let tomb = {};
  let r = CS.mergeList(list, tomb, [{ seq: 1, kind: 'cptx.add', data: tx('a', 100) }]);
  ok(list.length === 1 && list[0].amount === 100, 'add：新实体被插入');
  ok(list[0]._seq === 1, '插入时把 seq 记在 _seq 上');
  ok(r.changed === 1 && r.dropped === 0, '返回值统计正确');

  // ---- 幂等 ----
  r = CS.mergeList(list, tomb, [{ seq: 1, kind: 'cptx.add', data: tx('a', 100) }]);
  ok(list.length === 1 && r.changed === 0, '同一条 op 重复应用不产生第二次变更');

  // ---- 乱序到达 ----
  r = CS.mergeList(list, tomb, [{ seq: 5, kind: 'cptx.update', data: tx('a', 500) }]);
  ok(list[0].amount === 500 && list[0]._seq === 5, 'seq 更大的 update 覆盖');
  r = CS.mergeList(list, tomb, [{ seq: 3, kind: 'cptx.update', data: tx('a', 300) }]);
  ok(list[0].amount === 500, 'seq 更小的 update 被忽略（旧改动不会覆盖新的）');
  ok(r.changed === 0, '被忽略时不报变更');

  // ---- 同一批里乱序 ----
  list = [];
  tomb = {};
  CS.mergeList(list, tomb, [
    { seq: 9, kind: 'cptx.update', data: tx('b', 900) },
    { seq: 2, kind: 'cptx.add', data: tx('b', 200) },
  ]);
  ok(list.length === 1 && list[0].amount === 900, '同一批里乱序也按 seq 排序后应用');

  // ---- 删除 ----
  list = [tx('c', 300)];
  tomb = {};
  r = CS.mergeList(list, tomb, [{ seq: 7, kind: 'cptx.remove', data: { id: 'c' } }]);
  ok(list.length === 0, 'remove：实体真的被摘掉（不是标 isVoid）');
  ok(tomb.c === 7, 'remove：留下墓碑 seq');

  // ---- 墓碑挡旧改动 ----
  r = CS.mergeList(list, tomb, [{ seq: 6, kind: 'cptx.update', data: tx('c', 1) }]);
  ok(list.length === 0 && r.dropped === 1, '墓碑挡住 seq 更小的旧 update（不复活）');
  r = CS.mergeList(list, tomb, [{ seq: 7, kind: 'cptx.update', data: tx('c', 2) }]);
  ok(list.length === 0, '和墓碑同 seq 的 update 也被挡（边界取 <=）');

  // ---- 更晚的改动会复活（既定语义） ----
  r = CS.mergeList(list, tomb, [{ seq: 8, kind: 'cptx.update', data: tx('c', 888) }]);
  ok(list.length === 1 && list[0].amount === 888, 'seq 大于墓碑的改动会让这笔回来（后到者胜）');

  // ---- 删一个本地不存在的 id ----
  tomb = {};
  list = [];
  CS.mergeList(list, tomb, [{ seq: 4, kind: 'cptx.remove', data: { id: 'ghost' } }]);
  ok(tomb.ghost === 4, '删一个本地不存在的 id 也要记墓碑');
  r = CS.mergeList(list, tomb, [{ seq: 2, kind: 'cptx.add', data: tx('ghost', 5) }]);
  ok(list.length === 0 && r.dropped === 1, '墓碑能挡住后来才到的旧 add');

  // ---- 墓碑取最大 ----
  tomb = { d: 10 };
  list = [];
  CS.mergeList(list, tomb, [{ seq: 3, kind: 'cptx.remove', data: { id: 'd' } }]);
  ok(tomb.d === 10, '墓碑不会被更小的 seq 覆盖');

  // ---- 脏数据 ----
  list = [];
  tomb = {};
  r = CS.mergeList(list, tomb, [
    { seq: 1, kind: 'cptx.add', data: null },
    { seq: 2, kind: 'cptx.add', data: {} },
    { seq: 3, kind: 'cptx.add', data: { amount: 1 } },
  ]);
  ok(list.length === 0 && r.changed === 0, '没有 id 的 op 被跳过，不污染账本');

  r = CS.mergeList(list, tomb, []);
  ok(r.changed === 0 && r.dropped === 0, '空批次安全');

  r = CS.mergeList(null, null, [{ seq: 1, kind: 'cptx.add', data: tx('e', 1) }]);
  ok(r.changed === 0, '传入 null 不抛错（同步层可能给空数据）');

  // ---- 只改 _seq，不改业务字段 ----
  list = [];
  tomb = {};
  CS.mergeList(list, tomb, [{ seq: 2, kind: 'cptx.add', data: tx('f', 66, { note: '午饭' }) }]);
  const keys = Object.keys(list[0]).sort().join(',');
  ok(keys.indexOf('_seq') >= 0 && list[0].note === '午饭', '只额外加 _seq，业务字段原样保留');

  console.log('通过 ' + pass + ' / ' + total);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => {
  console.error(e);
  console.log('通过 ' + pass + ' / ' + total);
  process.exit(1);
});
