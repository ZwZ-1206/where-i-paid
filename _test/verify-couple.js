/* 情侣账本 · 引导流程回归验收 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9411;
const PROFILE = env.profile('couple-check');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    const ok = await fn();
    if (ok) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); }
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
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
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
  const page = targets.targetInfos.find((t2) => t2.type === 'page' && !/devtools|extension/.test(t2.url));
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

  console.log('\n=== 1. 入口改造 ===');
  // 每次跑测试都是一套全新的浏览器，但 ViewCouple 的 step 是内存里的模块状态，
  // 同一台机器上跑第二遍时可能还停在上一轮的 'mode' / 'profile'。先归零。
  await ev(`(function(){ window.Store.clearAll(); if (window.ViewCouple.setStep) window.ViewCouple.setStep('intro'); return 1; })()`);
  await sleep(300);
  await ev(`App.go('couple')`);
  await sleep(500);
  // 上一轮跑测试时浏览器可能还留着 __cpBound 与 lastAct（同一个页面复用的根节点），
  // 350ms 防抖会把这个新 click 吞掉。这里清掉守卫，让它重新绑一次。
  await ev(`(function(){
    const h = document.querySelector('#view-couple');
    if (h) delete h.__cpBound;
    return 1;
  })()`);
  await ev(`window.ViewCouple.render(document.querySelector('#view-couple'))`);
  await sleep(400);
  const probed = await ev(`(function(){
    const b = document.querySelector('#view-couple [data-cp="to-consent"]');
    if (!b) return 'no-button';
    b.click();
    return 'ok';
  })()`);
  await sleep(700);
  console.log('  起手 step =', await ev(`window.ViewCouple.step`), ' 有同意按钮 =', await ev(`!!document.querySelector('#cp-consent-ok')`), ' 点击 =', probed);
  await t('底栏 5 格且情侣在最后一格', () => ev(`(function(){
    const tabs = Array.from(document.querySelectorAll('.tabbar .tab'));
    if (tabs.length !== 5) return false;
    return tabs[4].getAttribute('data-tab') === 'couple';
  })()`));
  await t('「记一笔」在底栏正中间', () => ev(`(function(){
    const tabs = Array.from(document.querySelectorAll('.tabbar .tab'));
    return tabs[2].getAttribute('data-tab') === 'add' && tabs[2].classList.contains('tab--main');
  })()`));
  await t('底栏里已经没有「设置」', () => ev(`!document.querySelector('.tabbar .tab[data-tab="settings"]')`));
  await t('顶栏齿轮能进设置页', async () => {
    await ev(`document.querySelector('.tb-gear').click()`);
    await sleep(700);
    return ev(`!!document.querySelector('.view[data-view="settings"].active')`);
  });

  console.log('\n=== 2. 引导流程 ===');
  await ev(`App.go('couple')`); await sleep(800);
  // 前面第 1 组的探针已经点过「去同意」并把 step 推到 consent，
  // 要把页面拉回起手页再测「点进去」这一步。
  await ev(`(function(){
    window.ViewCouple.setStep('intro');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(400);
  await t('没开通时显示引导页，不是主界面', () => ev(`!!document.querySelector('#view-couple .cp-onboard, #view-couple [data-cp="to-consent"]')`));

  await ev(`document.querySelector('[data-cp="to-consent"]').click()`); await sleep(600);
  await t('同意页「同意并继续」初始是灰的', () => ev(`(function(){ const b=document.querySelector('#cp-consent-ok'); return !!b && b.disabled; })()`));
  // 灰必须看得出来：disabled 时背景要变成灰底、不能还是主色渐变
  await t('未勾选时按钮视觉上真的变灰（不是只点不动）', () => ev(`(function(){
    const b = document.querySelector('#cp-consent-ok');
    if (!b) return false;
    const cs = getComputedStyle(b);
    return cs.backgroundImage === 'none' && cs.boxShadow === 'none' && cs.pointerEvents === 'none';
  })()`));

  await ev(`(function(){ const sc=document.querySelector('#cp-consent-scroll'); if(sc) sc.scrollTop=sc.scrollHeight; return 1; })()`);
  await sleep(300);
  await ev(`(function(){ const cb=document.querySelector('#cp-agree'); if(cb){ cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true})); } return 1; })()`);
  await sleep(300);
  await t('滚到底并勾选后能解锁', () => ev(`(function(){ const b=document.querySelector('#cp-consent-ok'); return !!b && !b.disabled; })()`));
  await t('解锁后按钮恢复主色渐变', () => ev(`(function(){
    const b = document.querySelector('#cp-consent-ok');
    if (!b) return false;
    const cs = getComputedStyle(b);
    return cs.backgroundImage.indexOf('gradient') >= 0 && cs.pointerEvents !== 'none';
  })()`));

  await ev(`document.querySelector('#cp-consent-ok').click()`); await sleep(700);
  await t('同意后进入必填资料页', () => ev(`!!document.querySelector('#cp-me') && !!document.querySelector('#cp-peer')`));
  await t('资料没填时「继续」是灰的', () => ev(`(function(){ const b=document.querySelector('#cp-profile-ok'); return !!b && b.disabled; })()`));

  await ev(`(function(){
    const me=document.querySelector('#cp-me'), peer=document.querySelector('#cp-peer');
    me.value='小懒'; me.dispatchEvent(new Event('input',{bubbles:true}));
    peer.value='小满'; peer.dispatchEvent(new Event('input',{bubbles:true}));
    return 1;
  })()`);
  await sleep(300);
  await t('只填名字、没选日期时仍是灰的', () => ev(`(function(){ const b=document.querySelector('#cp-profile-ok'); return !!b && b.disabled; })()`));

  // 选日期：走真实的日期弹层
  await ev(`document.querySelector('#cp-since').click()`); await sleep(700);
  await t('点「选一个日子」能弹出日期选择器', () => ev(`!!document.querySelector('#sheet-root .dp, #sheet-root .date-picker, #sheet-root .dp-head')`));

  // 真点「确定」，走过 onPick → draft → validate
  await ev(`(function(){
    const b = document.querySelector('#sheet-root [data-act="ok"]');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(600);
  await t('选完日期后「继续」不再是灰的', () => ev(`(function(){ const b=document.querySelector('#cp-profile-ok'); return !!b && !b.disabled; })()`));

  await ev(`document.querySelector('#cp-profile-ok').click()`); await sleep(600);
  await t('资料齐全后进入模式选择页', () => ev(`!!document.querySelector('.cp-mode-grid [data-cp="mode"]')`));

  console.log('\n=== 3. 开通（步骤 2） ===');
  await ev(`document.querySelector('.cp-mode-grid [data-cp="mode"][data-mode="local"]').click()`);
  await sleep(800);
  await t('选完模式后正式开通，进入主界面', () => ev(`(function(){
    return window.Store.settings.couple.enabled === true
      && !!document.querySelector('#view-couple .cp-main');
  })()`));
  await t('开通后没有建任何「情侣账本」', () => ev(`(function(){
    const books = window.Store.books();
    return books.every((b) => b.kind !== 'couple');
  })()`));
  await t('开通后自动建了「我们的小金库」目标', () => ev(`(function(){
    const g = window.Store.coupleVault();
    return !!g && g.kind === 'couple';
  })()`));
  await t('开通后当前账本仍是普通账本', () => ev(`window.Store.bookKind() !== 'couple'`));
  await t('主界面显示双心小金库与本月支出', () => ev(`(function(){
    const root = document.querySelector('#view-couple');
    return !!root.querySelector('.cp-vault-hearts') && !!root.querySelector('.cp-vault-bar')
      && !!root.querySelector('.cp-stat-val');
  })()`));

  console.log('\n=== 4. 情侣账单是「情侣」栏的独立页面 ===');
  await t('主界面有「我们的账单」入口', () => ev(`!!document.querySelector('#view-couple [data-cp="to-bill"]')`));
  await ev(`document.querySelector('#view-couple [data-cp="to-bill"]').click()`);
  await sleep(700);
  await t('点进去进入账单页（page === bill）', () => ev(`window.ViewCouple.page === 'bill'`));
  await t('账单页有月份切换、大金额，没有「收入」筛选', () => ev(`(function(){
    const r = document.querySelector('#view-couple');
    return !!r.querySelector('.cp-bill-bar') && !!r.querySelector('.cp-bill-hero-val')
      && r.querySelectorAll('.cp-bill-tab').length === 0
      && r.textContent.indexOf('收入') < 0;
  })()`));
  await t('顶栏标题变成「情侣账单」', async () => {
    const txt = await ev(`(document.querySelector('#topbar .tb-title') || {}).textContent || ''`);
    return String(txt).indexOf('情侣账单') >= 0;
  });
  await t('账单页空态提示还能记一笔', () => ev(`!!document.querySelector('#view-couple .empty') || !!document.querySelector('#view-couple .cp-bill-foot')`));

  // 记 20 笔，四种印记都有
  await ev(`(function(){
    const S = window.Store;
    const ids = ['me','peer','both','mutual'];
    for (let i = 0; i < 20; i++) {
      S.cpAddTx({
        type: 'expense', amount: 1000 + i * 100, catId: 'food',
        note: '测试' + i, ts: Date.now() - i * 3600000,
        attrib: ids[i % 4],
      });
    }
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return S.cpTxs().length;
  })()`);
  await sleep(500);
  await t('20 笔都进了情侣账单并带上归属印记', () => ev(`(function(){
    const list = window.Store.cpTxs();
    if (list.length < 20) return false;
    return list.every((t) => ['me','peer','both','mutual'].indexOf(t.attrib) >= 0);
  })()`));
  await t('情侣账目一条都没混进个人账目', () => ev(`(function(){
    const S = window.Store;
    return S.state.tx.filter((t) => t.note && t.note.indexOf('测试') === 0).length === 0;
  })()`));
  await t('账单页把 20 笔渲染成列表', () => ev(`document.querySelectorAll('#view-couple .cp-bill-row').length >= 20`));
  await t('四个印记的次数统计正确（各 5 次）', () => ev(`(function(){
    const st = window.Store.attribStats(window.Store.cpTxIn(window.Store.monthPeriod(new Date())));
    return st.me === 5 && st.peer === 5 && st.both === 5 && st.mutual === 5 && st.total === 20;
  })()`));
  await t('归属印记不改金额：统计口径与全部计入一致', () => ev(`(function(){
    const S = window.Store;
    const p = S.monthPeriod(new Date());
    const list = S.cpTxIn(p);
    const sum = S.cpSummary(p);
    const raw = list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return sum.expense === raw;
  })()`));
  // 「收入」筛选已按设计删掉（情侣账本只记支出）。
  // 原来这两条点的是 [data-cp="bill-filter"]，现在那个按钮不存在了，
  // 改成验「账单页不该有它」和「没有筛选时 20 笔都在」。
  await t('账单页没有「收入」筛选入口', () => ev(`(function(){
    const r = document.querySelector('#view-couple');
    return !r.querySelector('[data-cp="bill-filter"]') && r.textContent.indexOf('收入') < 0;
  })()`));
  await t('不筛的时候 20 笔全在', () => ev(`document.querySelectorAll('#view-couple .cp-bill-row').length >= 20`));
  await t('翻到上个月，列表变空且标题跟着变', async () => {
    const before = await ev(`document.querySelector('#view-couple .cp-bill-month').textContent.trim()`);
    await ev(`document.querySelector('#view-couple [data-cp="bill-prev"]').click()`);
    await sleep(400);
    const after = await ev(`document.querySelector('#view-couple .cp-bill-month').textContent.trim()`);
    const empty = await ev(`document.querySelectorAll('#view-couple .cp-bill-row').length === 0`);
    return before !== after && empty;
  });
  await t('「下个月」能翻回本月且到本月后禁用', async () => {
    await ev(`document.querySelector('#view-couple [data-cp="bill-next"]').click()`);
    await sleep(400);
    return ev(`(function(){
      const b = document.querySelector('#view-couple [data-cp="bill-next"]');
      return !!b && b.disabled && window.ViewCouple.billState.offset === 0;
    })()`);
  });

  console.log('\n=== 5. 记一笔里完全没有情侣的影子 ===');
  await ev(`App.go('add')`); await sleep(800);
  await t('记账页没有归属印记选择器', () => ev(`document.querySelectorAll('#view-add [data-act="attrib"]').length === 0`));
  await t('记账页没有「♡ 和 XX」的账本胶囊', () => ev(`document.querySelectorAll('#view-add .book-pill-cp').length === 0`));
  await t('账本选择器里列不出情侣账本', () => ev(`window.Store.books().every((b) => b.kind !== 'couple')`));
  await t('在记账页记一笔只进个人账目', async () => {
    const before = await ev(`({ tx: window.Store.state.tx.length, cp: window.Store.cpTxs().length })`);
    await ev(`(function(){
      const S = window.Store;
      S.addTx({ type: 'expense', amount: 500, catId: 'food', note: '个人一笔', ts: Date.now() });
      return 1;
    })()`);
    await sleep(300);
    const after = await ev(`({ tx: window.Store.state.tx.length, cp: window.Store.cpTxs().length })`);
    return after.tx === before.tx + 1 && after.cp === before.cp;
  });

  console.log('\n=== 6. 明细与总结都看不到情侣账目 ===');
  await ev(`App.go('detail')`); await sleep(800);
  await t('明细里没有任何归属徽章', () => ev(`document.querySelectorAll('#view-detail .tx-tag--attrib').length === 0`));
  await t('明细里搜不到情侣账目的备注', () => ev(`(function(){
    const txt = document.querySelector('#view-detail').textContent;
    return txt.indexOf('测试0') < 0 && txt.indexOf('测试1') < 0;
  })()`));
  await ev(`App.go('report')`); await sleep(800);
  await t('总结页的金额不含情侣账目', () => ev(`(function(){
    const S = window.Store;
    const p = S.monthPeriod(new Date());
    const onlyMine = S.summary(p, S.txIn(p)).expense;
    const el = document.querySelector('#view-report .report-hero .rh-amount');
    if (!el) return false;
    const shown = Math.round(parseFloat(String(el.textContent).replace(/[^\\d.]/g, '')) * 100);
    return shown === onlyMine;
  })()`));

  console.log('\n=== 7. 记账弹层 ===');
  await ev(`App.go('couple')`); await sleep(600);
  await ev(`window.ViewCouple.setPage('bill'); window.ViewCouple.render(document.querySelector('#view-couple'))`);
  await sleep(500);
  await ev(`document.querySelector('#view-couple [data-cp="bill-add"]').click()`);
  await sleep(700);
  await t('点「记一笔情侣账」弹出记账层', () => ev(`!!document.querySelector('#sheet-root #cbe-amount')`));
  await t('弹层里有四个归属印记（红包排在互相请后面）', () => ev(`(function(){
    const chips = document.querySelectorAll('#sheet-root [data-e="attrib"]');
    if (chips.length !== 4) return false;
    const ids = Array.prototype.map.call(chips, (c) => c.getAttribute('data-attrib'));
    return ids.join('|') === 'me|peer|mutual|redpacket' && ids.indexOf('both') < 0;
  })()`));
  await t('弹层没有「记一笔情侣账」标题（只留右上角关闭）', () => ev(`(function(){
    const sheets = [].slice.call(document.querySelectorAll('#sheet-root .sheet'));
    const sheet = sheets.filter((s) => s.querySelector('#cbe-amount')).pop();
    if (!sheet) return false;
    return !sheet.querySelector('.sheet-title') && !!sheet.querySelector('.sheet-head--notitle');
  })()`));
  await t('「收了一笔」是有底色有描边的按钮，不是纯文字', () => ev(`(function(){
    const b = document.querySelector('#sheet-root [data-e="income"]');
    if (!b || b.tagName !== 'BUTTON') return false;
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return r.height >= 40 && parseFloat(cs.borderTopWidth) >= 1
      && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
  })()`));
  await t('弹层里默认「互相请」并带说明', () => ev(`(function(){
    const on = document.querySelector('#sheet-root [data-e="attrib"].on');
    const hint = document.querySelector('#sheet-root #cbe-hint');
    return !!on && on.getAttribute('data-attrib') === 'mutual' && !!hint && hint.textContent.length > 0;
  })()`));
  await t('点「互相请」会切过去并说出那句话', async () => {
    await ev(`document.querySelector('#sheet-root [data-e="attrib"][data-attrib="mutual"]').click()`);
    await sleep(300);
    return ev(`(function(){
      const on = document.querySelector('#sheet-root [data-e="attrib"].on');
      const hint = document.querySelector('#sheet-root #cbe-hint');
      return !!on && on.getAttribute('data-attrib') === 'mutual'
        && !!hint && /今天你请/.test(hint.textContent);
    })()`);
  });
  await t('填金额后保存，情侣账单多一笔', async () => {
    const before = await ev(`window.Store.cpTxs().length`);
    await ev(`(function(){
      const inp = document.querySelector('#sheet-root #cbe-amount');
      inp.value = '66.5';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#sheet-root #cbe-note').value = '弹层记的';
      const btns = Array.from(document.querySelectorAll('#sheet-root .sheet-foot .btn'));
      const ok = btns.find((b) => /记下来|保存/.test(b.textContent));
      ok.click();
      return 1;
    })()`);
    await sleep(800);
    const after = await ev(`(function(){
      const S = window.Store;
      const last = S.cpTxs()[S.cpTxs().length - 1];
      return { n: S.cpTxs().length, amount: last.amount, attrib: last.attrib, note: last.note };
    })()`);
    return after.n === before + 1 && after.amount === 6650 && after.attrib === 'mutual' && after.note === '弹层记的';
  });

  console.log('\n=== 8. 爱的账单 / 双心 ===');
  await t('账单页出现「爱的账单」次数卡', () => ev(`!!document.querySelector('#view-couple .cp-attribs')`));
  await t('次数卡只显示次数，不出现金额', () => ev(`(function(){
    const el = document.querySelector('#view-couple .cp-attribs');
    return !!el && el.textContent.indexOf('¥') < 0 && /次/.test(el.textContent);
  })()`));
  await t('差值 ≤2 次时说「请得挺匀的」', () => ev(`(function(){
    return window.Store.attribLine({ me: 8, peer: 7 }).indexOf('匀') >= 0;
  })()`));
  await t('我多 3 次以上时说「你更宠 TA」', () => ev(`(function(){
    return window.Store.attribLine({ me: 12, peer: 5 }).indexOf('更宠 TA') >= 0;
  })()`));
  await t('TA 多 3 次以上时说「TA 很宠你」', () => ev(`(function(){
    return window.Store.attribLine({ me: 3, peer: 9 }).indexOf('很宠你') >= 0;
  })()`));
  await t('月卡句式永不出现「比 TA 少」这种对账话', () => ev(`(function(){
    const cases = [{me:0,peer:9},{me:9,peer:0},{me:5,peer:5},{me:20,peer:1}];
    return cases.every((c) => {
      const s = window.Store.attribLine(c);
      return s.indexOf('比') < 0 && s.indexOf('%') < 0 && s.indexOf('少') < 0;
    });
  })()`));

  console.log('\n=== 9. 双心合拢组件 ===');
  await ev(`window.ViewCouple.setPage('home'); window.ViewCouple.render(document.querySelector('#view-couple'))`);
  await sleep(400);
  await t('进度 0 时两心相距最远', () => ev(`(function(){
    const g = window.Store.coupleVault();
    g.saved = 0; g.target = 100000;
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const el = document.querySelector('#view-couple .cp-vault-hearts');
    return !!el && el.style.getPropertyValue('--gap').trim() === '124px';
  })()`));
  await t('进度 50% 时两心靠近一半', () => ev(`(function(){
    const g = window.Store.coupleVault();
    g.saved = 50000; g.target = 100000;
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const el = document.querySelector('#view-couple .cp-vault-hearts');
    return !!el && el.style.getPropertyValue('--gap').trim() === '62px';
  })()`));
  await t('存满时合成一颗心并带 is-done', () => ev(`(function(){
    const g = window.Store.coupleVault();
    g.saved = 100000; g.target = 100000;
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const el = document.querySelector('#view-couple .cp-vault-hearts');
    return !!el && el.classList.contains('is-done')
      && !!document.querySelector('#view-couple .cp-heart--big');
  })()`));
  await t('存满时两颗旧心真的移除，不是留着空壳', () => ev(`(function(){
    const g = window.Store.coupleVault();
    g.saved = 100000; g.target = 100000;
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return document.querySelectorAll('#view-couple .cp-heart--l, #view-couple .cp-heart--r').length === 0
      && document.querySelectorAll('#view-couple .cp-heart--big').length === 1;
  })()`));
  await t('半存时两颗心都在，并写明还差多少', () => ev(`(function(){
    const g = window.Store.coupleVault();
    g.saved = 50000; g.target = 100000;
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const cap = document.querySelector('#view-couple .cp-vault-cap');
    return document.querySelectorAll('#view-couple .cp-heart--l, #view-couple .cp-heart--r').length === 2
      && !!cap && /靠拢了 50%/.test(cap.textContent) && /还差/.test(cap.textContent);
  })()`));
  await t('小金库卡头是可点的整行，不是右上角一个 12px 小字', () => ev(`(function(){
    const g = window.Store.coupleVault();
    g.saved = 20000; g.target = 100000;
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const head = document.querySelector('#view-couple .cp-vault-head');
    if (!head) return false;
    const r = head.getBoundingClientRect();
    return r.width > 280 && r.height >= 30 && head.getAttribute('data-cp') === 'vault-go';
  })()`));
  // 2026-10 回归：同城首页同时渲染了大金库卡和一张同名的 .cp-mod 小卡，
  // 同一个东西说两遍。用户原话「重复了会让用户觉得廉价」，只准留一张。
  await t('小金库在页面上只出现一次（不许大卡 + 小卡重复）', () => ev(`(function(){
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const v = document.querySelector('#view-couple');
    const titles = v.querySelectorAll('.cp-vault-head-title');
    const modNames = Array.from(v.querySelectorAll('.cp-mod-name')).filter((n) => /小金库/.test(n.textContent));
    const allText = v.textContent.split('小金库').length - 1;
    return titles.length === 1 && modNames.length === 0 && allText <= 2;
  })()`));
  await t('点卡头能打开小金库存取面板', async () => {
    await ev(`(function(){
      document.querySelector('#view-couple .cp-vault-head').click();
    })()`);
    await sleep(320);
    return ev(`(function(){
      const s = document.querySelector('#sheet-root .sheet');
      return !!s && /小金库/.test(s.textContent) && !!document.querySelector('#cv-amount');
    })()`);
  });
  await t('只有「知道了」一个按钮的弹窗不出现两个一样的按钮', async () => {
    await ev(`(function(){
      window.__oneBtn = window.UI.confirm({ title: 'T', desc: 'd', okText: '知道了', cancelText: '知道了' });
    })()`);
    await sleep(200);
    const r = await ev(`(function(){
      const box = document.querySelector('#modal-root .modal');
      if (!box) return { n: -1 };
      const btns = box.querySelectorAll('.modal-btns .btn');
      const ok = box.querySelector('[data-act="ok"]');
      const rect = ok ? ok.getBoundingClientRect() : null;
      return {
        n: btns.length,
        hasCancel: !!box.querySelector('[data-act="cancel"]'),
        w: rect ? Math.round(rect.width) : 0,
        h: rect ? Math.round(rect.height) : 0,
        radius: ok ? parseFloat(getComputedStyle(ok).borderRadius) : 0,
      };
    })()`);
    await ev(`(function(){ const b=document.querySelector('#modal-root [data-act="ok"]'); if(b) b.click(); })()`);
    await sleep(300);
    return r.n === 1 && r.hasCancel === false && r.w >= 260 && r.h >= 40 && r.radius >= 18;
  });

  console.log('\n=== 10. 模块数据来自本地 ===');
  await t('同城模式显示「在一起 N 天」并给出下一个里程碑', () => ev(`(function(){
    const S = window.Store;
    S.setSettings({ couple: { mode: 'local' } });
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const txt = document.querySelector('#view-couple .cp-mods').textContent;
    return /在一起/.test(txt) && /还有 \\d+ 天到第 \\d+ 天/.test(txt);
  })()`));
  await t('异地模式显示见面倒计时与 TA 那边的时钟', () => ev(`(function(){
    const S = window.Store;
    S.setSettings({ couple: { mode: 'remote' } });
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const txt = document.querySelector('#view-couple .cp-mods').textContent;
    return /见面倒计时/.test(txt) && /TA 那边现在/.test(txt);
  })()`));
  await t('设了见面日子后倒计时算出天数', () => ev(`(function(){
    const S = window.Store;
    const d = new Date(Date.now() + 30 * 86400000);
    S.setSettings({ couple: { nextMeet: window.U.ymd(d) } });
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const txt = document.querySelector('#view-couple .cp-mods').textContent;
    return /30/.test(txt) || /29/.test(txt);
  })()`));
  await t('TA 的时钟按时区算得出来', () => ev(`(function(){
    window.Store.setSettings({ couple: { tzOffset: 9 } });
    const c = window.ViewCouple.peerClock();
    return !!c && /^\\d{2}:\\d{2}$/.test(c.text) && c.mood.length > 0;
  })()`));
  await t('「只分享比例」开关已经删掉了', async () => {
    // 用户明确要求删掉：这功能给人一种有隐瞒的感觉。
    const has = await ev(`!!document.querySelector('#view-couple [data-cp="share-ratio"]')`);
    const text = await ev(`document.querySelector('#view-couple').textContent.indexOf('只分享比例') >= 0`);
    return has === false && text === false;
  });
  await t('「从首页收起」按钮也删掉了', async () => {
    const has = await ev(`!!document.querySelector('#view-couple [data-cp="hide"]')`);
    const text = await ev(`document.querySelector('#view-couple').textContent.indexOf('从首页收起') >= 0`);
    return has === false && text === false;
  });
  await t('保留了切换同城/异地、关闭账本、历史账本三个入口', async () => {
    const r = await ev(`(function(){
      const root = document.querySelector('#view-couple');
      return {
        mode: !!root.querySelector('[data-cp="switch-mode"]'),
        off: !!root.querySelector('[data-cp="off"]'),
        books: !!root.querySelector('[data-cp="books"]'),
      };
    })()`);
    return r.mode && r.off && r.books;
  });
  await t('「历史账本」入口做得不显眼（不是胶囊按钮，字更小更淡）', async () => {
    const r = await ev(`(function(){
      const el = document.querySelector('#view-couple .cp-hist-link');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const btn = document.querySelector('#view-couple [data-cp="off"]');
      const bcs = btn ? getComputedStyle(btn) : null;
      return {
        isBtn: el.tagName.toLowerCase() === 'button',
        opacity: parseFloat(cs.opacity),
        size: parseFloat(cs.fontSize),
        btnSize: bcs ? parseFloat(bcs.fontSize) : 99,
      };
    })()`);
    return !!r && r.isBtn && r.opacity < 0.9 && r.size < r.btnSize;
  });

  console.log('\n=== 11. 关闭只关开关 ===');
  await t('关闭情侣账单只关开关，账目与金库都还在', async () => {
    const before = await ev(`(function(){
      const S = window.Store;
      return { cp: S.cpTxs().length, goals: S.state.goals.length, books: S.books().length };
    })()`);
    await ev(`(function(){
      // 直接走 disableCouple，避免 confirm 弹层阻断
      window.Store.disableCouple();
      window.ViewCouple.setStep('intro');
      window.ViewCouple.render(document.querySelector('#view-couple'));
      return 1;
    })()`);
    await sleep(500);
    const after = await ev(`(function(){
      const S = window.Store;
      return { cp: S.cpTxs().length, goals: S.state.goals.length, books: S.books().length,
               enabled: S.settings.couple.enabled };
    })()`);
    return before.cp === after.cp && before.goals === after.goals
      && before.books === after.books && after.enabled === false;
  });

  console.log('\n=== 12. 回忆小票墙 / 重要日子 / 重新打开 ===');
  await t('关闭后再次进入显示「重新打开」快捷入口', async () => {
    // 第 11 步可能停在非 home 页，先归位
    await ev(`(function(){
      window.ViewCouple.setPage('home');
      window.ViewCouple.setStep('intro');
      window.ViewCouple.render(document.querySelector('#view-couple'));
      return 1;
    })()`);
    await sleep(400);
    return await ev(`!!document.querySelector('#view-couple [data-cp="resume"], #view-couple [data-cp="undo-close"]')`);
  });
  await t('点「重新打开」回到主界面，账目还在', async () => {
    await ev(`document.querySelector('#view-couple [data-cp="resume"], #view-couple [data-cp="undo-close"]').click()`);
    await sleep(500);
    const r = await ev(`(function(){
      return {
        home: window.ViewCouple.page === 'home',
        enabled: window.Store.settings.couple.enabled,
        cp: window.Store.cpTxs().length,
        hasEntry: !!document.querySelector('#view-couple .cp-bill-entry'),
      };
    })()`);
    return r.home && r.enabled === true && r.cp > 0 && r.hasEntry;
  });
  await t('点「回忆小票墙」进入子页并列出金额', async () => {
    // 第 10 步把模式切成了异地，回忆小票墙只在同城出现
    await ev(`(function(){
      window.Store.setSettings({ couple: { mode: 'local' } });
      window.ViewCouple.render(document.querySelector('#view-couple'));
      return 1;
    })()`);
    await sleep(500);
    await ev(`(function(){
      const b = document.querySelector('#view-couple [data-cp="to-memories"]');
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(400);
    // 2026-10 按设计方案把「回忆小票墙」原地改造成了日历（不并存两个时间视图）
    const r = await ev(`(function(){
      const root = document.querySelector('#view-couple');
      return {
        page: window.ViewCouple.page,
        isCal: !!root.querySelector('.cp-cal-grid'),
        cells: root.querySelectorAll('.cp-cal-cell:not(.is-blank)').length,
        hasDays: root.querySelectorAll('.cp-cal-cell.has').length,
        week: root.querySelectorAll('.cp-cal-week span').length,
        reportBtn: !!root.querySelector('[data-cp="to-report"]'),
        nums: Array.from(root.querySelectorAll('.cp-cal-title-num')).map((x) => x.textContent.trim()),
        title: (root.querySelector('.cp-cal-title') || {}).textContent.replace(/\\s+/g, ' ').trim() || '',
        money: !!root.querySelector('.cp-cal-cell [class*="amt"]'),
      };
    })()`);
    // 标题被拆成了「2026 年」「10 月」两个 .cp-cal-title-num 节点，
    // textContent 拼起来带换行和空格，先压平再判，不要拿原始串去正则。
    const nums = (r && r.nums) || [];
    const yearOk = /^20\d\d$/.test(nums[0] || '');
    const monthOk = /^\d{1,2}$/.test((nums[1] || '').replace(/月/g, ''));
    const titleOk = (yearOk && monthOk) || /20\d\d 年 \d{1,2} 月/.test((r && r.title) || '');
    return r.page === 'memories' && r.isCal && r.cells >= 28 && r.hasDays > 0
      && r.week === 7 && r.reportBtn && titleOk && !r.money;
  });
  await t('回忆小票墙的返回按钮回到主界面', async () => {
    await ev(`document.querySelector('#view-couple [data-cp="sub-back"]').click()`);
    await sleep(400);
    return await ev(`window.ViewCouple.page === 'home'`);
  });
  await t('点「在一起 N 天」进入重要日子子页', async () => {
    await ev(`document.querySelector('#view-couple [data-cp="to-days"]').click()`);
    await sleep(400);
    const r = await ev(`(function(){
      const root = document.querySelector('#view-couple');
      return {
        page: window.ViewCouple.page,
        n: root.querySelectorAll('.cp-day').length,
        hasStart: !!root.querySelector('.cp-day--start'),
      };
    })()`);
    return r.page === 'days' && r.n === 9 && r.hasStart;
  });
  await t('重要日子按里程碑渲染，已过的标 is-past', async () => {
    const r = await ev(`(function(){
      const root = document.querySelector('#view-couple');
      const past = root.querySelectorAll('.cp-day.is-past').length;
      const total = root.querySelectorAll('.cp-day.is-past, .cp-day:not(.is-past)').length;
      return { past, total };
    })()`);
    return r.total === 9 && r.past >= 0;
  });
  await t('重要日子返回主界面', async () => {
    await ev(`document.querySelector('#view-couple [data-cp="sub-back"]').click()`);
    await sleep(400);
    return await ev(`window.ViewCouple.page === 'home'`);
  });
  await t('setPage 只认 home/bill/mode/memories/days/report 六个值', async () => {
    const r = await ev(`(function(){
      const V = window.ViewCouple;
      V.setPage('memories'); const a = V.page;
      V.setPage('days'); const b = V.page;
      V.setPage('bill'); const c = V.page;
      V.setPage('report'); const e = V.page;
      V.setPage('随便什么'); const d = V.page;
      V.setPage('home');
      return [a, b, c, d, e];
    })()`);
    return r[0] === 'memories' && r[1] === 'days' && r[2] === 'bill' && r[4] === 'report' && r[3] === 'home';
  });

  // ---- 日历「年 + 月联动」选择器 ----
  // 用户原话：点年份可以选年，点月份可以切月，左右键是直接切换月份的。
  // 所以点「xx月」要弹一个「上半年份条 + 下半 3×4 月份网格」的组合面板，
  // 年和月在一个面板里改完一次关掉；左右键那段逻辑一行没动。
  await t('点「xx月」弹出「年 + 月」组合面板：年份条 + 12 个 3×4 月份格，热区 ≥44', async () => {
    await ev(`(function(){
      window.ViewCouple.setPage('memories');
      window.ViewCouple.render(document.querySelector('#view-couple'));
      return 1;
    })()`);
    await sleep(400);
    await ev(`(function(){
      const b = document.querySelector('#view-couple [data-cp="cal-pick-month"]');
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(500);
    const r = await ev(`(function(){
      // 前面套件可能留着别的弹层，只认「带月份网格」的那一个
      const all = [].slice.call(document.querySelectorAll('#sheet-root .sheet'));
      const sheet = all.filter((s) => s.querySelector('#cp-cal-mons')).pop() || null;
      if (!sheet) return { err: 'no-sheet' };
      const yrs = [].slice.call(sheet.querySelectorAll('[data-cp="cal-pick-year"]'));
      const mons = [].slice.call(sheet.querySelectorAll('[data-cp="cal-pick-month"][data-mon]'));
      const grid = sheet.querySelector('.cp-cal-mons');
      const R = (el) => { const b = el.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
      const hit = document.querySelector('#view-couple [data-cp="cal-pick-month"]');
      const yhit = document.querySelector('#view-couple [data-cp="cal-year"]');
      return {
        nY: yrs.length, nM: mons.length,
        cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
        m0: mons[0] ? R(mons[0]) : null,
        m11: mons[11] ? R(mons[11]) : null,
        hitH: hit ? R(hit).h : 0,
        yhitH: yhit ? R(yhit).h : 0,
      };
    })()`);
    return r.nM === 12 && r.nY >= 3 && r.cols === 3
      && r.m0 && r.m0.h >= 44 && r.m0.w >= 44
      && r.m11 && r.m11.h >= 44
      && r.hitH >= 44 && r.yhitH >= 44;
  });
  await t('组合面板里选 3 月：日历跳到那一年 3 月，面板一次关掉', async () => {
    await ev(`(function(){
      const b = document.querySelector('#sheet-root .sheet [data-cp="cal-pick-month"][data-mon="3"]');
      if (!b) return 'no-3';
      b.click();
      return 1;
    })()`);
    await sleep(700);
    const r = await ev(`(function(){
      const root = document.querySelector('#view-couple');
      const nums = [].slice.call(root.querySelectorAll('.cp-cal-title-num')).map((x) => x.textContent.trim());
      const first = root.querySelector('.cp-cal-cell:not(.is-blank)');
      // 「面板一次关掉」＝ 组合面板自己没了。前面套件可能还留着别的弹层（不退场动画
      // 320ms 也还在 DOM 上），所以只数「带月份网格的那一个」，别数 sheet 总数。
      const ours = [].slice.call(document.querySelectorAll('#sheet-root .sheet'))
        .filter((s) => s.querySelector('.cp-cal-mons')).length;
      return {
        nums: nums,
        ours: ours,
        first: first ? first.getAttribute('data-calday') : '',
      };
    })()`);
    return r.nums[1] === '3' && r.ours === 0 && /-03-01$/.test(r.first || '');
  });
  await t('左右键照旧翻月；面板里未来的月份 is-off 点不动', async () => {
    const nav = await ev(`(function(){
      const root = document.querySelector('#view-couple');
      const nums = () => [].slice.call(root.querySelectorAll('.cp-cal-title-num')).map((x) => x.textContent.trim()).join('-');
      const before = nums();
      root.querySelector('[data-cp="cal-prev"]').click();
      const prev = nums();
      root.querySelector('[data-cp="cal-next"]').click();
      const next = nums();
      return { before: before, prev: prev, next: next };
    })()`);
    // 左键退一个月、右键进一个月，回到原处 —— 这一段是既有逻辑，不能因为拆热区就坏
    // before 形如「2026-3」：prev 是它的上个月，next 回到原处
    const prevOf = (y_m) => {
      const p = y_m.split('-'); const y = +p[0], m = +p[1];   // 标题里是 1 起的月
      return m > 1 ? `${y}-${m - 1}` : `${y - 1}-12`;
    };
    const navOk = /^\d{4}-\d{1,2}$/.test(nav.before)
      && nav.prev === prevOf(nav.before) && nav.next === nav.before;
    await ev(`(function(){
      const b = document.querySelector('#view-couple [data-cp="cal-pick-month"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(600);
    const fut = await ev(`(function(){
      const nm = new Date().getMonth() + 2;           // 下个月（1 起）＝ 今年里的未来月
      if (nm > 12) return { skip: true };             // 12 月时今年没有未来月，这项无从验起
      const all = [].slice.call(document.querySelectorAll('#sheet-root .sheet'));
      const sheet = all.filter((s) => s.querySelector('.cp-cal-mons')).pop();
      if (!sheet) return { err: 'no-sheet' };
      const b = sheet.querySelector('[data-cp="cal-pick-month"][data-mon="' + nm + '"]');
      if (!b) return { err: 'no-future-month' };
      const num = () => [].slice.call(document.querySelectorAll('#view-couple .cp-cal-title-num')).map((x) => x.textContent.trim()).join('-');
      const before = num();
      const off = b.classList.contains('is-off');
      const pe = getComputedStyle(b).pointerEvents;
      b.click();                                       // 点不动 = 标题不动、面板不关
      return { off: off, pe: pe, same: num() === before, closed: !document.querySelectorAll('#sheet-root .sheet').length };
    })()`);
    return navOk && (fut.skip || (fut.off === true && fut.pe === 'none' && fut.same === true && fut.closed === false));
  });

  // ---- 回归：年/月/日气泡选完某天，要真的跳到那天 ----
  // 用户 m03602：选定年、月后，无论选哪天，点确定都只跳到那个月，选中日被清空，
  // 下面也没展开那天的简报 —— 看起来像「选了没用」。
  await t('点「年」进日期气泡，选 15 日确定后日历落到那天并展开简报', async () => {
    // 先关掉可能还开着的月份面板（上一条点了未来月，面板本来不关）
    await ev(`(function(){
      const m = document.querySelector('#sheet-root .sheet-mask'); if (m) m.click(); return 1;
    })()`);
    await sleep(450);
    await ev(`(function(){
      const b = document.querySelector('#view-couple [data-cp="cal-year"]');
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(600);
    const picked = await ev(`(function(){
      const cells = [].slice.call(document.querySelectorAll('#sheet-root .dp-day[data-ts]'));
      const d = cells.filter((n) => n.textContent.trim() === '15' && !n.classList.contains('mute')).pop();
      if (!d) return null;
      d.click();
      const fab = document.querySelector('#sheet-root .dp-fab');
      if (fab) fab.click();
      return { ts: d.getAttribute('data-ts') };
    })()`);
    await sleep(800);
    const r = await ev(`(function(){
      const root = document.querySelector('#view-couple');
      const on = root.querySelector('.cp-cal-cell.is-on');
      const brief = document.querySelector('#cp-cal-brief');
      const nums = [].slice.call(root.querySelectorAll('.cp-cal-title-num')).map((x) => x.textContent.trim());
      return {
        day: on ? on.getAttribute('data-calday') : '',
        y: nums[0] || '', m: nums[1] || '',
        briefTitle: brief ? ((brief.querySelector('.cp-brief-title') || {}).textContent || '') : '',
        sheetGone: !document.querySelector('#sheet-root .dp-fab'),
      };
    })()`);
    const d = picked && picked.ts ? new Date(+picked.ts) : null;
    const wantKey = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15` : '';
    return !!d && r.day === wantKey && r.briefTitle.indexOf('15 日') >= 0 && r.sheetGone
      && r.y === String(d.getFullYear()) && r.m === String(d.getMonth() + 1);
  });

  // 选中态是「数字印章」，不是整格半透明气泡：
  // 印章要水平居中（旧版整格铺底，数字贴在格子顶部，看着是偏的）；
  // 今天是「空心印章」（1px 描边 + 品牌字），选中是「实心印章」——
  // 两者形状一致、强弱分明，选完不会还被「今天」抢视线。
  await t('选中日：数字印章水平居中、实心底；今天是空心、不抢选中', async () => {
    // 先回到「本月」：前面的用例把日历翻到过 3 月，那里没有「今天」格子
    await ev(`(function(){
      const b = document.querySelector('#view-couple [data-cp="cal-pick-month"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(500);
    await ev(`(function(){
      const d = new Date();
      const sel = '#sheet-root .sheet [data-cp="cal-pick-month"][data-year="' + d.getFullYear()
        + '"][data-mon="' + (d.getMonth() + 1) + '"]';
      const b = document.querySelector(sel);
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(500);
    // 选一个「不是今天」的日子，才能同时看到两种状态
    await ev(`(function(){
      const cells = [].slice.call(document.querySelectorAll('#view-couple [data-calday]'));
      const c = cells.filter((x) => !x.classList.contains('is-today') && !x.classList.contains('is-future'))[0];
      if (c) c.click();
      return !!c;
    })()`);
    await sleep(400);
    return ev(`(function(){
      const cell = document.querySelector('#view-couple .cp-cal-cell.is-on');
      const today = document.querySelector('#view-couple .cp-cal-cell.is-today');
      if (!cell || !today) return 'no-cell';
      const num = cell.querySelector('.cp-cal-num');
      const tNum = today.querySelector('.cp-cal-num');
      if (!num || !tNum) return 'no-num';
      const cr = cell.getBoundingClientRect(), nr = num.getBoundingClientRect();
      const dx = Math.abs((nr.left + nr.width / 2) - (cr.left + cr.width / 2));
      const cs = getComputedStyle(num);
      const tcs = getComputedStyle(tNum);
      const solid = /^rgb\\(/.test(cs.backgroundColor) && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      // 今天必须是「空心印章」：没有实心底，只有一圈内描边
      const todayHollow = /rgba\\(0, 0, 0, 0\\)|transparent/.test(tcs.backgroundColor)
        && /inset/.test(tcs.boxShadow);
      // 旧版还有个「整格铺底 + 1.5px 描边」：现在格子上不该再有那圈内阴影
      const cellCs = getComputedStyle(cell);
      if (!(dx <= 1 && solid && todayHollow && cellCs.boxShadow === 'none')) {
        return { dx: dx, numBg: cs.backgroundColor, todayBg: tcs.backgroundColor,
          todayShadow: tcs.boxShadow, shadow: cellCs.boxShadow };
      }
      return true;
    })()`);
  });

  // ---- 日历补记：今天不开、往日开放 ----
  // 用户 m03610：给「回忆小票墙」加一个补记入口，但只对过去的日子开放。
  // 实现是「在你看的那一天的简报底部出现」，所以断言也按天来验。
  let pastKey = '';
  await t('日历补记：过去的日子有「补记这一天的账」，今天没有', async () => {
    // 先回到本月（前面的用例翻到过 3 月 / 换过选中日）
    await ev(`(function(){
      const b = document.querySelector('#view-couple [data-cp="cal-pick-month"]');
      if (b) b.click(); return 1;
    })()`);
    await sleep(450);
    await ev(`(function(){
      const d = new Date();
      const b = document.querySelector('#sheet-root .sheet [data-cp="cal-pick-month"][data-year="'
        + d.getFullYear() + '"][data-mon="' + (d.getMonth() + 1) + '"]');
      if (b) b.click(); return !!b;
    })()`);
    await sleep(500);
    // 挑一个「不是今天」的过去日子：优先 1 号，今天是 1 号就用 2 号
    pastKey = await ev(`(function(){
      const d = new Date(), todayK = window.U.ymd(d);
      let day = 1;
      const mk = (n) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(n).padStart(2, '0');
      if (mk(day) === todayK) day = 2;
      const k = mk(day);
      const c = document.querySelector('#view-couple [data-calday="' + k + '"]');
      if (c) c.click();
      return k;
    })()`);
    await sleep(400);
    const past = await ev(`(function(){
      const b = document.querySelector('#view-couple .cp-brief-add');
      return b ? { has: true, day: b.getAttribute('data-day'), h: Math.round(b.getBoundingClientRect().height),
        txt: b.textContent.replace(/\\s+/g, ' ').trim() } : { has: false };
    })()`);
    // 再点今天：入口必须消失
    const todayState = await ev(`(function(){
      const c = document.querySelector('#view-couple .cp-cal-cell.is-today');
      if (c) c.click();
      return { has: !!document.querySelector('#view-couple .cp-brief-add') };
    })()`);
    await sleep(300);
    return !!(past.has && past.day === pastKey && past.h >= 36 && /补记/.test(past.txt)
      && todayState.has === false);
  });

  await t('点补记：弹层写「补记一笔」，并说明记在哪一天', async () => {
    // 回到那个过去的日子，点补记
    await ev(`(function(){
      const c = document.querySelector('#view-couple [data-calday="${pastKey}"]');
      if (c) c.click(); return 1;
    })()`);
    await sleep(350);
    await ev(`(function(){
      const b = document.querySelector('#view-couple .cp-brief-add');
      if (b) b.click(); return 1;
    })()`);
    await sleep(650);
    const r = await ev(`(function(){
      const s = [].slice.call(document.querySelectorAll('#sheet-root .sheet'))
        .filter((x) => x.querySelector('#cbe-amount')).pop();
      if (!s) return { err: 'no-sheet' };
      const back = s.querySelector('.cbe-back');
      return { title: (s.querySelector('.sheet-title') || {}).textContent || '',
        back: back ? back.textContent.replace(/\\s+/g, ' ').trim() : '',
        hasAmount: !!s.querySelector('#cbe-amount') };
    })()`);
    return r.hasAmount && /补记一笔/.test(r.title) && /记在/.test(r.back) && /日/.test(r.back);
  });

  await t('补记存进去：落在选中那天中午 12 点，简报当场多一笔', async () => {
    await ev(`(function(){
      const inp = document.querySelector('#sheet-root #cbe-amount');
      inp.value = '33'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      const ok = [].slice.call(document.querySelectorAll('#sheet-root .sheet-foot .btn'))
        .find((b) => /记下来|保存/.test(b.textContent));
      ok.click(); return 1;
    })()`);
    await sleep(750);
    const r = await ev(`(function(){
      const S = window.Store;
      const t = S.cpTxs()[S.cpTxs().length - 1];
      const d = new Date(t.ts);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return { amount: t.amount, day: k, hour: d.getHours(),
        rows: document.querySelectorAll('#view-couple .cp-brief-row').length,
        page: window.ViewCouple.page,
        sheetGone: !document.querySelector('#sheet-root #cbe-amount') };
    })()`);
    return r.amount === 3300 && r.day === pastKey && r.hour === 12
      && r.rows >= 1 && r.page === 'memories' && r.sheetGone;
  });

  ws.close();
  await env.stop(proc);console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  if (jsErrors.length) console.log('JS 异常:', jsErrors.slice(0, 2));
  if (fail) process.exit(1);
})();