/* 双人同步 · 配对面板与状态灯（浏览器套件） */
'use strict';
const fs = require('fs');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9419;
const PROFILE = env.profile('sync-ui');
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
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: URL });
  await sleep(2800);

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  const click = async (sel, wait) => {
    const ok = await ev(`(function(){ const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true; })()`);
    if (!ok) throw new Error('点不到 ' + sel);
    await sleep(wait == null ? 450 : wait);
    return true;
  };
  const lampCls = () => ev(`(function(){ const b=document.querySelector('#view-couple [data-cp="sync"]'); return b ? b.className : ''; })()`);

  console.log('\n=== 1. 进入情侣主页 ===');
  await ev(`(function(){
    window.Store.clearAll();
    window.CoupleSync._reset();
    window.CoupleSync.leave();
    window.Store.enableCouple({
      meName: '甲', peerName: '乙', mode: 'local',
      togetherSince: '2024-01-01',
      consent:{ agreed: true, at: Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) }
    });
    if (window.ViewCouple.setStep) window.ViewCouple.setStep('home');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(500);
  await ev(`App.go('couple')`);
  await sleep(900);

  await t('情侣主页右上角有同步灯', () => ev(`!!document.querySelector('#view-couple [data-cp="sync"]')`));
  await t('没配对时右上角是显眼的「配对」按钮（不只是颗灰点）', async () => {
    const r = await ev(`(function(){
      const b = document.querySelector('#view-couple [data-cp=\"sync\"]');
      if (!b) return null;
      const cs = getComputedStyle(b), box = b.getBoundingClientRect();
      return { cls: b.className, txt: b.textContent.trim(),
        h: Math.round(box.height), w: Math.round(box.width),
        bg: cs.backgroundColor, bgImg: cs.backgroundImage };
    })()`);
    return !!r && /cp-pair--off/.test(r.cls) && r.txt === '配对'
      && r.h >= 28 && r.w >= 44
      && (r.bgImg.indexOf('gradient') >= 0 || r.bg !== 'rgba(0, 0, 0, 0)');
  });
  await t('旧入口 sync-soon 已经不存在', () => ev(`!document.querySelector('#view-couple [data-cp="sync-soon"]')`));

  console.log('\n=== 1.5 「TA 刚记了 N 笔」提示条 ===');
  await t('没有新账时不显示提示条', () => ev(`!document.querySelector('#view-couple .cp-peernew')`));
  await ev(`(function(){ window.dispatchEvent(new CustomEvent('couple:peer-tx', { detail: { n: 2 } })); return 1; })()`);
  await sleep(200);
  await t('拉到对方新账后出现「TA 刚记了 2 笔」', () => ev(`(function(){
    const b = document.querySelector('#view-couple .cp-peernew');
    if (!b) return false;
    const txt = b.textContent.replace(/\\s+/g, '');
    return /TA刚记了2笔/.test(txt) && /去看看/.test(txt);
  })()`));
  await t('提示条贴在头部下面、占满一行（没有浮在别的卡片上）', () => ev(`(function(){
    const b = document.querySelector('#view-couple .cp-peernew');
    const h = document.querySelector('#view-couple .cp-head');
    const entry = document.querySelector('#view-couple .cp-bill-entry');
    if (!b || !h || !entry) return false;
    const r1 = b.getBoundingClientRect(), r2 = h.getBoundingClientRect(), r3 = entry.getBoundingClientRect();
    return r1.top > r2.top + 16 && r1.bottom <= r3.top + 1 && r1.width > 200;
  })()`));
  await t('又拉到 3 笔会累加，且改成「新记了」（离开久了不是「刚」）', async () => {
    await ev(`window.dispatchEvent(new CustomEvent('couple:peer-tx', { detail: { n: 3 } }))`);
    await sleep(150);
    return ev(`document.querySelector('#view-couple .cp-peernew').textContent.replace(/\\s+/g, '').indexOf('TA新记了5笔') >= 0`);
  });
  await click('#view-couple [data-cp="peernew"]', 600);
  await t('点提示条进账单页，条子自己消失', () => ev(`window.ViewCouple.page === 'bill' && !document.querySelector('#view-couple .cp-peernew')`));
  await t('人已经在账单页时不再累计（列表本来就会刷新）', async () => {
    await ev(`window.dispatchEvent(new CustomEvent('couple:peer-tx', { detail: { n: 4 } }))`);
    await sleep(150);
    const n = await ev(`(function(){
      window.ViewCouple.setPage('home');
      window.ViewCouple.render(document.querySelector('#view-couple'));
      return document.querySelectorAll('#view-couple .cp-peernew').length;
    })()`);
    return n === 0;
  });

  console.log('\n=== 1.6 同步后自动重画 ===');
  await t('同步写进来的账会自动出现在页面上（不用手动刷新）', async () => {
    const before = await ev(`document.querySelector('#view-couple .cp-bill-entry-sub').textContent.replace(/\\s+/g, ' ')`);
    const added = await ev(`(function(){
      const book = window.Store.cpBooks()[0];
      const r = window.Store.applyRemoteOps([{ seq: 995001, kind: 'cptx.add', opId: 'auto1',
        data: { id: 'auto_sync_1', amount: 4321, ts: Date.now(), type: 'expense',
                catId: 'food', note: '自动刷新', cpBookId: book.id } }]);
      return r.txNew;
    })()`);
    await sleep(500);
    const after = await ev(`document.querySelector('#view-couple .cp-bill-entry-sub').textContent.replace(/\\s+/g, ' ')`);
    return added === 1 && after !== before && /1 笔/.test(after);
  });
  await t('自动重画不会把人弹回顶部（滚动位置保留）', async () => {
    const before = await ev(`(function(){
      const v = document.querySelector('.view.active');
      const max = Math.max(0, v.scrollHeight - v.clientHeight);
      const want = Math.min(260, max);
      v.scrollTop = want;
      return { max: max, want: want, now: v.scrollTop };
    })()`);
    // 首页内容不够高时这条没有意义（想滚都没得滚），直接当通过
    if (!before || before.max < 100) return true;
    await ev(`(function(){
      const book = window.Store.cpBooks()[0];
      window.Store.applyRemoteOps([{ seq: 995002, kind: 'cptx.add', opId: 'auto2',
        data: { id: 'auto_sync_2', amount: 777, ts: Date.now(), type: 'expense',
                catId: 'food', note: '滚动', cpBookId: book.id } }]);
      return 1;
    })()`);
    await sleep(500);
    const top = await ev(`document.querySelector('.view.active').scrollTop`);
    return Math.abs(top - before.want) <= 4;
  });

  console.log('\n=== 2. 未配对面板 ===');
  await click('#view-couple [data-cp="sync"]', 600);
  await t('点灯能打开「双人同步」面板', () => ev(`(function(){
    const s = document.querySelector('#sheet-root .sheet');
    return !!s && s.textContent.indexOf('双人同步') >= 0;
  })()`));
  await t('面板给出两个入口：发起 / 加入', () => ev(`(function(){
    return !!document.querySelector('[data-sync="create"]') && !!document.querySelector('[data-sync="to-join"]');
  })()`));
  await t('面板写明了「配对码就是钥匙，别发群里」', () => ev(`document.querySelector('#sheet-root .sheet').textContent.indexOf('别发到群里') >= 0`));

  console.log('\n=== 3. 加入时的格式校验 ===');
  await click('[data-sync="to-join"]', 300);
  await t('切到粘贴视图，有输入框', () => ev(`!!document.querySelector('[data-input]')`));
  await ev(`(function(){ const t=document.querySelector('[data-input]'); t.value='AbCd EfGh'; return 1; })()`);
  await click('[data-sync="join"]', 700);
  await t('位数不对时明确说「43 个字符」', () => ev(`(function(){
    const e = document.querySelector('[data-err]');
    return !!e && e.classList.contains('in') && e.textContent.indexOf('43') >= 0;
  })()`));
  await t('校验失败时不关闭面板', () => ev(`!!document.querySelector('#sheet-root .sheet')`));
  await click('[data-sync="back"]', 300);

  console.log('\n=== 4. 发起配对 ===');
  await click('[data-sync="create"]', 900);
  await t('生成后显示配对码', () => ev(`!!document.querySelector('[data-code]')`));
  const code = await ev(`(function(){
    const el = document.querySelector('[data-code]');
    return el ? el.textContent.replace(/[^A-Za-z0-9_-]/g, '') : '';
  })()`);
  await t('配对码是 43 个字符', () => code.length === 43);
  await t('配对码按 4 个一组显示（便于核对）', () => ev(`(function(){
    const el = document.querySelector('[data-code]');
    if (!el) return false;
    const txt = el.textContent.trim();
    return txt.indexOf(' ') === 4 && txt.charAt(5) !== ' ' && txt.split(' ').length === 11;
  })()`));
  await t('同步引擎进入已配对状态', () => ev(`window.CoupleSync.ready() === true`));
  await t('配对串能解出 32 位 hex 的 room', () => ev(`(function(){
    const p = window.CoupleSync.parsePair(window.CoupleSync.pairString());
    return !!p && /^[0-9a-f]{32}$/.test(p.room);
  })()`));
  await t('面板写着「把这串发给 TA」', () => ev(`document.querySelector('#sheet-root .sheet').textContent.indexOf('把这串发给 TA') >= 0`));

  console.log('\n=== 5. 已配对视图 ===');
  await click('[data-sync="done"]', 1200);
  await t('切到已配对视图（有「立即同步」）', () => ev(`!!document.querySelector('[data-sync="now"]')`));
  await t('已配对视图有「解除连接」', () => ev(`!!document.querySelector('[data-sync="unbind"]')`));
  await t('已配对视图有「删除云端数据」（协议里承诺的那一条）', () => ev(`(function(){
    const b = document.querySelector('[data-sync="wipe"]');
    return !!b && /删除云端/.test(b.textContent);
  })()`));
  await t('显示了「上次同步」一行', () => ev(`document.querySelector('#sheet-root .sheet').textContent.indexOf('上次同步') >= 0`));

  await click('#sheet-root .sheet-close', 700);
  await t('关掉面板后灯不再是灰色', async () => (await lampCls()).indexOf('cp-pair--off') < 0);

  console.log('\n=== 6. 「再看一次」配对码 ===');
  await click('#view-couple [data-cp="sync"]', 600);
  await t('重新打开直接是已配对视图（不再要求发起）', () => ev(`!!document.querySelector('[data-sync="now"]')`));
  await click('[data-sync="show-code"]', 400);
  const code2 = await ev(`(function(){
    const el = document.querySelector('[data-code]');
    return el ? el.textContent.replace(/[^A-Za-z0-9_-]/g, '') : '';
  })()`);
  await t('再看一次拿到的还是同一串', () => code2 === code);

  console.log('\n=== 7. 解除连接 ===');
  await click('[data-sync="done"]', 500);
  await click('[data-sync="unbind"]', 500);
  await t('解除前会二次确认', () => ev(`!!document.querySelector('#modal-root .modal')`));
  await click('#modal-root [data-act="ok"]', 800);
  await t('解除后回到未配对', () => ev(`window.CoupleSync.ready() === false`));
  await t('解除后灯变回灰色', async () => (await lampCls()).indexOf('cp-pair--off') >= 0);

  console.log('\n=== 8. 计数口径 ===');
  await t('只数「新增的账」：同一笔改动 / 删除都不算「TA 刚记了」', () => ev(`(function(){
    const S = window.Store;
    const id = 'peer_probe_1';
    const add = S.applyRemoteOps([{ seq: 990001, kind: 'cptx.add', opId: 'p1',
      data: { id: id, amount: 1000, ts: Date.now(), type: 'expense' } }]);
    const upd = S.applyRemoteOps([{ seq: 990002, kind: 'cptx.update', opId: 'p2',
      data: { id: id, amount: 1200, ts: Date.now(), type: 'expense' } }]);
    const del = S.applyRemoteOps([{ seq: 990003, kind: 'cptx.remove', opId: 'p3',
      data: { id: id } }]);
    return add.txNew === 1 && upd.txNew === 0 && del.txNew === 0;
  })()`));

  console.log('\n=== 9. 无 JS 异常 ===');
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
