/* 双人同步 · store 的出队接线（浏览器套件）
 *
 * 验的是「界面上做一件事 → outbox 里出现对应的 op」。
 * 这一层最容易漏：合并层写好了，但某个入口忘了调 syncHook，
 * 表现就是「我这边改了，TA 那边没反应」，而且不报错。
 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9421;
const PROFILE = env.profile('sync-store');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    const ok = await fn();
    if (ok) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name); }
  } catch (e) {
    fail++;
    console.log('  ❌ ' + name + ' — ' + (e && e.message));
  }
};

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', URL,
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) { /* 等 */ }
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const jsErrors = [];
  ws.addEventListener('message', (evt) => {
    const m = JSON.parse(evt.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      jsErrors.push((d.exception && d.exception.description) || d.text);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params: params || {}, sessionId }));
  });

  const targets = await send('Target.getTargets');
  const page = targets.targetInfos.find((x) => x.type === 'page' && !/devtools|extension/.test(x.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  await S('Page.enable');
  await S('Runtime.enable');
  await Emulation();
  async function Emulation() {
    await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await S('Page.navigate', { url: URL });
    await sleep(2600);
  }

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };

  const outbox = () => ev(`(function(){
    return window.CoupleSync.state().outbox.map(function(e){
      return { kind: e.kind, eid: e.eid, opId: e.id, data: e.data };
    });
  })()`);
  const kinds = async () => (await outbox()).map((e) => e.kind);
  const reset = () => ev(`(function(){
    var s = window.CoupleSync.state();
    s.outbox = []; s.dropped = 0; window.CoupleSync._persist(); return 1;
  })()`);

  console.log('\n=== 0. 准备：清空 + 配对 ===');
  await ev(`(function(){
    window.Store.clearAll();
    window.CoupleSync._reset();
    window.CoupleSync.leave();
    window.CoupleSync.pair();
    window.Store.enableCouple({
      meName:'甲', peerName:'乙', mode:'local', togetherSince:'2024-01-01',
      consent:{ agreed:true, at:Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) }
    });
    return 1;
  })()`);
  await sleep(400);
  await t('配对后 ready() 为真', () => ev(`window.CoupleSync.ready() === true`));
  await reset();

  console.log('\n=== 1. 情侣账目 ===');
  const txId = await ev(`(function(){ var t = window.Store.cpAddTx({ type:'expense', amount:1200, catId:'food', note:'午饭' }); return t.id; })()`);
  await sleep(200);
  let ob = await outbox();
  await t('记一笔 → 队列里出现 1 条 cptx.add', () => ob.length === 1 && ob[0].kind === 'cptx.add');
  await t('op 里带的是同一笔实体', () => ob[0] && ob[0].eid === txId && ob[0].data.note === '午饭');

  await ev(`window.Store.cpUpdateTx(${JSON.stringify(txId)}, { amount: 1500 })`);
  await sleep(200);
  ob = await outbox();
  await t('改一笔 → 合并成 1 条 cptx.update', () => ob.length === 1 && ob[0].kind === 'cptx.update');
  await t('合并后带的是新金额', () => ob[0] && ob[0].data.amount === 1500);

  await ev(`window.Store.cpRemoveTx(${JSON.stringify(txId)})`);
  await sleep(200);
  ob = await outbox();
  await t('删一笔 → 合并成 1 条 cptx.remove（不叠加）', () => ob.length === 1 && ob[0].kind === 'cptx.remove');

  console.log('\n=== 2. 情侣基金 / 个人目标 ===');
  await reset();
  const goalId = await ev(`(function(){
    var g = window.Store.addGoal({ name:'我们的小金库', kind:'couple', slot:'vault', target:100000 });
    return g.id;
  })()`);
  await sleep(200);
  await t('建情侣基金 → 队列里有 goal.add', async () => (await kinds()).indexOf('goal.add') === 0);

  await reset();
  await ev(`window.Store.depositGoal(${JSON.stringify(goalId)}, 5000)`);
  await sleep(200);
  ob = await outbox();
  await t('往基金存钱 → 队列里是 goal.deposit', () => ob.length === 1 && ob[0].kind === 'goal.deposit');
  await t('存钱带上了整条目标（含 logs）', () => ob[0] && ob[0].data.saved === 5000 && Array.isArray(ob[0].data.logs));

  await reset();
  await ev(`window.Store.addGoal({ name:'个人买相机', kind:'normal', target:800000 })`);
  await sleep(200);
  await t('个人目标不进同步队列', async () => (await outbox()).length === 0);

  console.log('\n=== 3. 资料 ===');
  await reset();
  await ev(`window.Store.setCoupleConfig({ mode:'local', tzOffset: 8 })`);
  await sleep(200);
  ob = await outbox();
  await t('改资料 → profile.set 一条', () => ob.length === 1 && ob[0].kind === 'profile.set');
  await t('profile.set 带了 bookId（接收侧才知道往哪本上落）', () => ob[0] && typeof ob[0].data.bookId === 'string' && ob[0].data.bookId.length > 0);

  console.log('\n=== 4. 账本生命周期 ===');
  await reset();
  const newBook = await ev(`(function(){
    var b = window.Store.startNewCpBook({ meName:'甲', peerName:'乙', mode:'local', togetherSince:'2025-01-01' });
    return { id: b.id, order: b.order };
  })()`);
  await sleep(200);
  await t('换新本 → 队列里有 book.add', async () => (await kinds()).indexOf('book.add') >= 0);
  await t('换新本 → 也把老本标成已关闭（book.close）', async () => (await kinds()).indexOf('book.close') >= 0);
  await t('开着同步时新本 id 是随机的（不再是 cp+order）', () => newBook.id !== 'cp' + newBook.order);

  await reset();
  await ev(`window.Store.closeCouple('test')`);
  await sleep(200);
  await t('关闭这本 → 发出 book.close', async () => (await kinds()).indexOf('book.close') >= 0);

  await reset();
  const wiped = await ev(`(function(){
    window.Store.openCpBook(${JSON.stringify(newBook.id)});
    var t = window.Store.cpAddTx({ type:'expense', amount: 800, catId:'food' });
    var before = window.CoupleSync.state().outbox.length;
    window.Store.wipeCpBook(${JSON.stringify(newBook.id)});
    var after = window.CoupleSync.state().outbox.map(function(e){ return e.kind; });
    return { before: before, after: after };
  })()`);
  await sleep(200);
  await t('整本删除 → 发出 book.wipe', () => wiped.after.indexOf('book.wipe') >= 0);
  await t('整本删除 → 这本待发的账目 op 被清掉（不会推回去复活）', () => wiped.after.indexOf('cptx.add') < 0);

  console.log('\n=== 5. 首次配对的全量补推 ===');
  await reset();
  const boot = await ev(`(function(){
    window.CoupleSync.leave();
    window.CoupleSync.pair();
    window.Store.cpAddTx({ type:'expense', amount: 300, catId:'food' });
    // 模拟「账已经在本地、但队列是空的」：先清空，再全量补推
    var s = window.CoupleSync.state();
    s.outbox = []; s.dropped = 0; window.CoupleSync._persist();
    var n = window.Store.syncBootstrap();
    var ids = window.CoupleSync.state().outbox.map(function(e){ return e.id; });
    return { n: n, ids: ids };
  })()`);
  await sleep(200);
  await t('syncBootstrap 把本机数据排队推上去', () => boot.n >= 1);
  await t('补推的 opId 是 boot_ 前缀（重推幂等）', () => boot.ids.every((x) => x.indexOf('boot_') === 0));

  console.log('\n=== 6. 无 JS 异常 ===');
  await t('整个过程没有未捕获异常', () => jsErrors.length === 0);
  if (jsErrors.length) console.log('    ' + jsErrors.slice(0, 3).join('\n    '));

  console.log('\n通过 ' + pass + ' / ' + (pass + fail) + (fail === 0 ? '' : '（失败 ' + fail + '）'));
  env.stop(proc);
  await sleep(300);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  console.log('通过 ' + pass + ' / ' + (pass + fail + 1));
  process.exit(1);
});
