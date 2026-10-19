const env = require('./_env');
/* 新功能截图：今日额度 / 上次多少钱 / 垫付 / 想买 / 合并看板 / 等价物 / 订阅 / 对账 */
const PORT = 9382;
const PROFILE = env.profile('new');
const OUT = env.shots('shoot-new'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
const fs = require('fs');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';

function rm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  rm(PROFILE);
  const proc = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=390,844', URL,
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { ver = await r.json(); break; }
    } catch (e) {}
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params: params || {}, sessionId }));
  });

  const targets = await send('Target.getTargets');
  const page = targets.targetInfos.find((t) => t.type === 'page' && !/devtools|chrome-extension/.test(t.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: URL });
  await sleep(2600);

  const evalJs = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(require('path').join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  shot:', name);
  };
  const click = async (sel) => {
    await evalJs(`(function(){ const n = document.querySelector(${JSON.stringify(sel)}); if(!n) throw new Error('no node ${sel}'); n.click(); return 1; })()`);
    await sleep(420);
  };
  const closeSheet = async () => {
    await evalJs(`(function(){ const b = document.querySelector('#sheet-root .sheet-close'); if(b) b.click(); return 1; })()`);
    await sleep(420);
  };

  // ---- 首次打开：空账本 ----
  await evalJs(`(function(){
    const S = window.Store;
    if (S.state.tx.length) { S.clearAll(false); App.refresh(); }
    App.go('detail');
    return 1;
  })()`);
  await sleep(800);
  await shot('n0-empty-detail');
  await evalJs(`App.go('report')`);
  await sleep(800);
  await shot('n0b-empty-report');

  // ---- 造数据：第二本账本 + 垫付 + 想买 + 对账 ----
  await evalJs(`(function(){
    const S = window.Store, U = window.U;
    const now = Date.now();
    // 第二本账本
    if (S.books().length < 2) {
      const b = S.addBook({ name: '旅行', icon: '✈️', color: '#14B87A' });
      // 给旅行账本记几笔
      const old = S.activeBookId();
      S.switchBook(b.id);
      S.addTx({ type:'expense', amount: 128000, catId:'transport', sub:'机票', note:'往返机票', ts: now - 3*86400000 });
      S.addTx({ type:'expense', amount: 45000, catId:'housing', sub:'住宿', note:'酒店两晚', ts: now - 2*86400000 });
      S.switchBook(old);
    }
    // 垫付两笔（一笔超期、一笔 3 天后到期）
    const mainBook = S.books()[0].id;
    S.addTx({ type:'expense', amount: 30000, catId:'social', sub:'请客', note:'帮老王垫的餐费',
      ts: now - 12*86400000, bookId: mainBook,
      advance: { who:'老王', status:'open', dueTs: now - 2*86400000 } });
    S.addTx({ type:'expense', amount: 80000, catId:'shopping', sub:'日用品', note:'帮小李买的',
      ts: now - 5*86400000, bookId: mainBook,
      advance: { who:'小李', status:'open', dueTs: now + 3*86400000 } });
    // 想买清单：一件已过冷静期
    const w = S.addWish({ name:'降噪耳机', amount: 89900, catId:'shopping' });
    S.updateWish(w.id, { dueTs: now - 3600000 });
    const w2 = S.addWish({ name:'机械键盘', amount: 59900, catId:'shopping' });
    // 放弃一件，累积忍住基金
    const w3 = S.addWish({ name:'第 4 双跑鞋', amount: 45000, catId:'shopping' });
    S.dropWish(w3.id);
    // 订阅提醒配置
    S.setSettings({ subAlert: { enabled: true, daysBefore: 7 }, advance: { enabled: true, remindDays: 3 } });
    // 造一条订阅历史：Netflix 每月 48 元，连续 4 个月
    for (let m = 4; m >= 1; m--) {
      const d = new Date(); d.setMonth(d.getMonth() - m); d.setDate(12);
      S.addTx({ type:'expense', amount: 4800, catId:'fun', sub:'会员', note:'Netflix 会员', ts: d.getTime(), bookId: mainBook });
    }
    // 一条近期消费用于「上次多少钱」
    S.addTx({ type:'expense', amount: 2580, catId:'food', sub:'午餐', note:'沙县小吃', ts: now - 2*86400000, bookId: mainBook });
    window.ViewAdd.reset();
    return 1;
  })()`);
  await sleep(700);

  // ---- 记账页 ----
  await evalJs(`App.go('add')`); await sleep(600);
  await evalJs(`(function(){ const S=window.Store; window.ViewAdd.reset(); S.switchBook(S.books()[0].id); return 1; })()`);
  await sleep(400);
  // 记账页：键盘默认收起
  await evalJs(`(function(){ App.go('add'); return 1; })()`);
  await sleep(650);
  await shot('n1b-add-dock-closed');
  // 点金额弹出键盘
  await evalJs(`(function(){
    const b = document.querySelector('.view[data-view="add"] .amount-display');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(700);
  await shot('n1c-add-dock-open');
  await evalJs(`(function(){
    const b = document.querySelector('.view[data-view="add"] .dock-grip');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(600);
  // 重新打开以继续后面的用例
  await evalJs(`(function(){
    const b = document.querySelector('.view[data-view="add"] .amount-display');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(600);

  await shot('n1-add-quota');

  // 输入金额，看额度变化
  await evalJs(`(function(){ const b=document.querySelector('.view[data-view="add"] [data-key="8"]'); b.click(); document.querySelector('.view[data-view="add"] [data-key="8"]').click(); return 1; })()`);
  await sleep(500);
  await shot('n2-add-quota-typing');

  // 上次多少钱：选餐饮
  await evalJs(`(function(){
    const v=document.querySelector('.view[data-view="add"]');
    v.querySelector('[data-cat="food"]').click();
    return 1;
  })()`);
  await sleep(500);
  await shot('n3-add-lastprice');

  // 垫付开关
  await evalJs(`(function(){ const v=document.querySelector('.view[data-view="add"]'); v.querySelector('[data-act="advance-toggle"]').click(); return 1; })()`);
  await sleep(500);
  await shot('n4-add-advance');
  await evalJs(`(function(){ const v=document.querySelector('.view[data-view="add"]'); v.querySelector('[data-act="advance-clear"]').click(); return 1; })()`);
  await sleep(300);

  // 想买入口
  await evalJs(`(function(){
    const v=document.querySelector('.view[data-view="add"]');
    const m=v.querySelector('.mini-actions');
    if(m) m.scrollIntoView({block:'center'});
    return 1;
  })()`);
  await sleep(400);
  await shot('n5-add-wishentry');
  // 清单里有东西时按钮上应有件数徽标
  await evalJs(`(function(){
    const S = window.Store;
    const w = S.addWish({ name:'想买的耳机', amount: 89900, catId:'shopping' });
    S.updateWish(w.id, { dueTs: Date.now() - 1000 });
    const w2 = S.addWish({ name:'想买的键盘', amount: 59900, catId:'shopping' });
    App.go('add');
    return 1;
  })()`);
  await sleep(700);
  await evalJs(`(function(){
    const m=document.querySelector('.view[data-view="add"] .mini-actions');
    if(m) m.scrollIntoView({block:'center'});
    return 1;
  })()`);
  await sleep(400);
  await shot('n5b-add-wish-count');
  await evalJs(`(function(){ const S=window.Store; S.state.wishlist.slice().forEach(function(x){ S.removeWish(x.id); }); App.go('add'); return 1; })()`);
  await sleep(400);

  // ---- 设置页：想买清单入口 ----
  await evalJs(`(function(){
    const S = window.Store;
    S.addWish({ name:'降噪耳机', amount: 89900, catId:'shopping' });
    App.go('settings');
    return 1;
  })()`);
  await sleep(750);
  await evalJs(`(function(){
    const rows = document.querySelectorAll('.view[data-view="settings"] .set-row');
    for (const r of rows) { if (r.getAttribute('data-act') === 'wishlist') { r.scrollIntoView({block:'center'}); break; } }
    return 1;
  })()`);
  await sleep(450);
  await shot('n11b-settings-wish-row');

  // ---- 设置页：关于 / 检查更新 ----
  await evalJs(`(function(){ App.go('settings'); return 1; })()`);
  await sleep(800);
  await evalJs(`(function(){
    const rows = document.querySelectorAll('.view[data-view="settings"] .set-row');
    for (const r of rows) { if (r.getAttribute('data-act') === 'check-update') { r.scrollIntoView({block:'center'}); break; } }
    return 1;
  })()`);
  await sleep(450);
  await shot('n24-about-update');

  // 伪造一个更高版本，拍下「启动时发现新版」的提示条
  await evalJs(`(function(){
    window.__origFetch = window.fetch;
    window.fetch = function(u, o){
      if (String(u).indexOf('sw.js') >= 0) {
        return Promise.resolve(new Response("const CACHE = 'jizhang-v1.9.0';", { status: 200 }));
      }
      return window.__origFetch(u, o);
    };
    App.autoCheckUpdate();
    return 1;
  })()`);
  await sleep(900);
  await shot('n26-update-bar');
  await evalJs(`(function(){
    const b = document.querySelector('.update-bar .ub-later');
    if (b) b.click();
    if (window.__origFetch) window.fetch = window.__origFetch;
    return 1;
  })()`);
  await sleep(400);

  // ---- 明细页：想买清单混排 ----
  await evalJs(`(function(){
    const S = window.Store;
    S.state.wishlist.slice().forEach(function(x){ S.removeWish(x.id); });
    S.setSettings({ wish: { enabled: true, hours: 48 } });
    const a = S.addWish({ name:'降噪耳机', amount: 89900, catId:'shopping' });
    const b = S.addWish({ name:'机械键盘', amount: 59900, catId:'shopping' });
    const c = S.addWish({ name:'第 4 双跑鞋', amount: 45000, catId:'shopping' });
    S.updateWish(b.id, { dueTs: Date.now() - 1000 });
    S.dropWish(c.id);
    App.go('detail');
    return 1;
  })()`);
  await sleep(800);
  await shot('n6b-detail-wish');
  await evalJs(`(function(){
    const v = document.querySelector('.view[data-view="detail"]');
    const r = v.querySelector('.tx-item--wish.is-ready');
    if (r) r.scrollIntoView({ block:'center' });
    return 1;
  })()`);
  await sleep(450);
  await shot('n6c-detail-wish-ask');

  // ---- 记账页：垫付顶部提醒 ----
  await evalJs(`App.go('add')`);
  await sleep(700);
  await shot('n4b-add-adv-banner');

  // ---- 设置页：固定月支出弹层 ----
  await evalJs(`(function(){
    App.go('settings');
    return 1;
  })()`);
  await sleep(750);
  await evalJs(`(function(){
    document.querySelectorAll('.view[data-view="settings"] .set-row').forEach(function(r){
      if (r.getAttribute('data-act') === 'fixed') r.click();
    });
    return 1;
  })()`);
  await sleep(750);
  await shot('n14b-fixed-sheet');
  await evalJs(`(function(){ const c=document.querySelector('#sheet-root .sheet-close, #sheet-root [data-act="close"]'); if(c) c.click(); return 1; })()`);
  await sleep(400);

  // ---- 明细页：已归还的垫付（划掉留档） ----
  await evalJs(`(function(){
    const S = window.Store;
    const open = S.advances();
    if (open.length) S.settleAdvance(open[0].id);
    App.go('detail');
    return 1;
  })()`);
  await sleep(850);
  await evalJs(`(function(){
    const v = document.querySelector('.view[data-view="detail"]');
    const r = v.querySelector('.tx-item.is-voided');
    if (r) r.scrollIntoView({ block:'center' });
    return 1;
  })()`);
  await sleep(450);
  await shot('n6d-detail-voided');

  // ---- 明细页：待收回 ----
  await evalJs(`App.go('detail')`); await sleep(700);
  await evalJs(`(function(){ const v=document.querySelector('.view[data-view="detail"]'); const h=v.querySelector('.adv-card-head'); if(h) h.click(); return 1; })()`);
  await sleep(500);
  await shot('n6-detail-advances');

  // 搜索跨周期
  await evalJs(`(function(){
    const v=document.querySelector('.view[data-view="detail"]');
    const i=v.querySelector('#kw'); i.value='Netflix';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    return 1;
  })()`);
  await sleep(700);
  await shot('n7-detail-search-cross');

  await evalJs(`(function(){
    const v=document.querySelector('.view[data-view="detail"]');
    const i=v.querySelector('#kw'); i.value='';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    return 1;
  })()`);
  await sleep(500);

  // ---- 总结页 ----
  await evalJs(`App.go('report')`); await sleep(800);
  await shot('n8-report-equiv');
  await evalJs(`(function(){
    const v=document.querySelector('.view[data-view="report"]');
    const eq=v.querySelector('.equiv-card');
    if(eq) eq.scrollIntoView({block:'center'});
    return 1;
  })()`);
  await sleep(500);
  await shot('n8b-report-equiv-card');
  await evalJs(`(function(){
    const v=document.querySelector('.view[data-view="report"]');
    const m=v.querySelector('.merged-card');
    if(m) m.scrollIntoView({block:'center'});
    return 1;
  })()`);
  await sleep(500);
  await shot('n9-report-merged');

  // 合并视图
  await evalJs(`(function(){ const b=document.querySelector('.view[data-view="report"] [data-act="switch-all"]'); if(b) b.click(); return 1; })()`);
  await sleep(800);
  await shot('n10-report-all-books');
  await evalJs(`(function(){ const S=window.Store; S.switchBook(S.books()[0].id); return 1; })()`);
  await sleep(500);

  // ---- 设置页 ----
  await evalJs(`App.go('settings')`); await sleep(700);
  await evalJs(`(function(){ const v=document.querySelector('.view[data-view="settings"]'); v.scrollTop = 620; return 1; })()`);
  await sleep(400);
  await shot('n11-settings-groups');

  // 币种
  await evalJs(`ViewSettings.openCurrencySheet()`); await sleep(600);
  await shot('n12-currency-sheet');
  await closeSheet();

  // 余钱归仓
  await evalJs(`ViewSettings.openAutoSaveSheet()`); await sleep(600);
  await shot('n13-autosave-sheet');
  await closeSheet();

  // 订阅体检
  await evalJs(`ViewSettings.openSubsSheet()`); await sleep(700);
  await shot('n14-subs-sheet');
  await closeSheet();

  // 垫付待收
  await evalJs(`ViewSettings.openAdvancesSheet()`); await sleep(700);
  await shot('n15-advances-sheet');
  await closeSheet();

  // 想买清单
  await evalJs(`ViewSettings.openWishSheet()`); await sleep(700);
  await shot('n16-wish-sheet');
  await closeSheet();

  // 对账
  await evalJs(`ViewSettings.openReconSheet()`); await sleep(600);
  await shot('n17-recon-sheet');
  await closeSheet();

  // 提醒中心
  await evalJs(`(function(){ const b=document.querySelector('.tb-bell'); if(b) b.click(); return 1; })()`);
  await sleep(800);
  await shot('n18-remind-center');
  await closeSheet();

  // 提醒横幅
  await evalJs(`(function(){ if(window.Remind) window.Remind.showBanner(); return 1; })()`);
  await sleep(700);
  await shot('n19-remind-banner');

  // ---- 深色 ----
  await evalJs(`(function(){ const S=window.Store; S.setSettings({theme:'dark'}); window.App.applyTheme(); return 1; })()`);
  await sleep(600);
  await evalJs(`App.go('add')`); await sleep(600);
  await shot('n20-dark-add');
  await evalJs(`App.go('detail')`); await sleep(700);
  await shot('n21-dark-detail');
  await evalJs(`App.go('report')`); await sleep(800);
  await shot('n22-dark-report');
  await evalJs(`ViewSettings.openSubsSheet()`); await sleep(700);
  await shot('n23-dark-subs');
  await closeSheet();
  await evalJs(`(function(){ const S=window.Store; S.setSettings({theme:'auto'}); window.App.applyTheme(); return 1; })()`);

  ws.close();
  await env.stop(proc);
  console.log('done');
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
