const env = require('./_env');
/* 情侣账本 · 步骤 1 截图 */
const PORT = 9401;
const PROFILE = env.profile('couple');
const OUT = env.shots('shoot-couple'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
const fs = require('fs');
const { spawn } = require('child_process');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', URL], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
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
  const page = targets.targetInfos.find((t) => t.type === 'page' && !/devtools|extension/.test(t.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: URL });
  await sleep(2800);

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(require('path').join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  shot:', name);
  };

  const errs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push((d.exception && d.exception.description) || d.text);
    }
  });

  // 1) 新底栏
  await ev("App.go('add')"); await sleep(700);
  await shot('cp1-tabbar');

  // 2) 情侣页引导
  await ev("App.go('couple')"); await sleep(800);
  await shot('cp2-intro');

  // 3) 协议页
  await ev("document.querySelector('[data-cp=\"to-consent\"]').click()"); await sleep(600);
  await shot('cp3-consent');

  // 4) 滚到底 + 勾选
  await ev(`(function(){
    const sc = document.querySelector('#cp-consent-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
    return 1;
  })()`);
  await sleep(400);
  await ev(`(function(){
    const cb = document.querySelector('#cp-agree');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    return 1;
  })()`);
  await sleep(400);
  await shot('cp4-consent-checked');

  // 5) 同意 -> 必填资料
  await ev("document.querySelector('#cp-consent-ok').click()"); await sleep(600);
  await shot('cp5-profile-empty');

  // 6) 填好资料
  await ev(`(function(){
    const me = document.querySelector('#cp-me'); const peer = document.querySelector('#cp-peer');
    me.value = '小懒'; me.dispatchEvent(new Event('input', { bubbles: true }));
    peer.value = '小满'; peer.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
  await sleep(300);
  await shot('cp6-profile-filled');

  // 7) 选日期（直接写设置再重渲染，避免依赖日期弹层）
  await ev(`(function(){
    const s = window.Store;
    s.setSettings({ couple: { togetherSince: '2024-05-20' } });
    if (window.ViewCouple) { window.ViewCouple.setStep('profile'); window.ViewCouple.render(document.querySelector('#view-couple')); }
    return 1;
  })()`);
  await sleep(600);
  await shot('cp7-profile-done');

  // 8) 继续 -> 模式选择
  await ev("document.querySelector('#cp-profile-ok').click()"); await sleep(700);
  await shot('cp8-mode');

  // 9) 选同城 —— 真点，会走 enableCouple + 切账本
  await ev("document.querySelector('[data-mode=\"local\"]').click()"); await sleep(900);
  await shot('cp9-mode-local');

  // 10) 造一批情侣账目（四种印记都有），再拍主界面
  await ev(`(function(){
    const s = window.Store;
    const cat = ['food','fun','transport','shopping','market','travel'];
    const note = ['一起吃的火锅','看电影','打车回家','买了个小摆件','超市补给','周末去海边'];
    const ids = ['me','peer','both','mutual'];
    s.cpTxs().length = 0;
    for (let i = 0; i < 24; i++) {
      s.cpAddTx({
        type: 'expense', amount: 1800 + i * 470, catId: cat[i % 6],
        sub: '', note: note[i % 6], attrib: ids[i % 4],
        ts: Date.now() - (i % 14) * 86400000 - i * 600000,
      });
    }
    // 小金库存一点，让双心靠拢
    const g = s.coupleVault();
    if (g) { g.saved = 186000; g.target = 500000; }
    s.save && s.save();
    window.ViewCouple.setStep('main');
    window.ViewCouple.setPage('home');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    App.refreshTopbar && App.refreshTopbar();
    return 1;
  })()`);
  await sleep(800);
  await shot('cp10-main-local');

  // 11) 情侣账单页（「情侣」栏里自己的页面，和「记一笔」无关）
  await ev(`(function(){
    window.ViewCouple.setPage('bill');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    App.refreshTopbar && App.refreshTopbar();
    return 1;
  })()`);
  await sleep(700);
  await shot('cp14-bill');

  // 12) 情侣记账弹层（四种印记 + 「互相请」那句小字）
  await ev(`(function(){
    const b = document.querySelector('#view-couple [data-cp="bill-add"]');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(800);
  await shot('cp15-bill-editor');

  await ev(`(function(){
    const inp = document.querySelector('#sheet-root #cbe-amount');
    if (inp) { inp.value = '128'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    const m = document.querySelector('#sheet-root [data-e="attrib"][data-attrib="mutual"]');
    if (m) m.click();
    return 1;
  })()`);
  await sleep(400);
  await shot('cp15b-bill-editor-mutual');

  // 关掉弹层
  await ev(`(function(){
    const c = document.querySelector('#sheet-root .sheet-close');
    if (c) c.click();
    return 1;
  })()`);
  await sleep(500);

  // 13) 明细页：个人账目里完全没有情侣的痕迹
  await ev("App.go('detail')"); await sleep(900);
  await shot('cp16-detail-clean');

  // 14) 双心进度：50%
  await ev(`(function(){
    const s = window.Store;
    const g = s.coupleVault();
    g.saved = 250000; g.target = 500000;
    App.go('couple');
    window.ViewCouple.setStep('main');
    window.ViewCouple.setPage('home');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(800);
  await shot('cp17-vault-half');

  // 15) 双心存满（合成一颗）
  await ev(`(function(){
    const s = window.Store;
    const g = s.coupleVault();
    g.saved = 500000; g.target = 500000;
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(600);
  await shot('cp18-vault-full');

  // 16) 异地模式（见面倒计时 + TA 的时钟）
  await ev(`(function(){
    const s = window.Store;
    const d = new Date(Date.now() + 23 * 86400000);
    s.setSettings({ couple: { mode: 'remote', nextMeet: window.U.ymd(d), tzOffset: 1 } });
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(700);
  await shot('cp11-main-remote');

  // 17) 深色
  await ev(`(function(){
    const s = window.Store;
    s.setSettings({ theme: 'dark' });
    App.applyTheme();
    return 1;
  })()`);
  await sleep(500);
  await shot('cp12-main-dark');

  // 18) 目标页：情侣金库带「我们的」标记
  await ev(`(function(){
    window.Store.setSettings({ theme: 'light' });
    App.applyTheme();
    App.go('goals');
    return 1;
  })()`);
  await sleep(800);
  await shot('cp19-goals-couple');

  // 19) 回忆小票墙（同城）
  await ev(`(function(){
    const s = window.Store;
    s.setSettings({ couple: { mode: 'local' } });
    App.go('couple');
    window.ViewCouple.setPage('memories');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    window.App.refreshTopbar();
    return 1;
  })()`);
  await sleep(900);
  await shot('cp20-memories');

  // 20) 重要日子
  await ev(`(function(){
    window.ViewCouple.setPage('days');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    window.App.refreshTopbar();
    return 1;
  })()`);
  await sleep(700);
  await shot('cp21-days');

  // 21) 关闭后再次进入：重新打开入口
  await ev(`(function(){
    window.Store.disableCouple();
    window.ViewCouple.setPage('home');
    window.ViewCouple.setStep('intro');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    window.App.refreshTopbar();
    return 1;
  })()`);
  await sleep(700);
  await shot('cp22-resume');

  // 22) 回忆小票墙（深色）
  await ev(`(function(){
    const s = window.Store;
    s.enableCouple({ enabled: true });
    s.setSettings({ theme: 'dark' });
    App.applyTheme();
    window.ViewCouple.setPage('memories');
    window.ViewCouple.setStep('main');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    window.App.refreshTopbar();
    return 1;
  })()`);
  await sleep(900);
  await shot('cp23-memories-dark');

  // 23) 设置页（齿轮入口）
  await ev("window.Store.setSettings({ theme: 'light' }); App.applyTheme(); App.go('settings')");
  await sleep(800);
  await shot('cp13-settings');

  // 24) 小金库卡：没设金库时（整行可点 + 建一个）
  await ev(`(function(){
    const s = window.Store;
    s.setSettings({ couple: { mode: 'local' } });
    const g = s.coupleVault();
    if (g) { g.saved = 0; g.target = 0; }
    App.go('couple');
    window.ViewCouple.setStep('main');
    window.ViewCouple.setPage('home');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(700);
  await shot('cp24-vault-empty');

  // 25) 小金库存取面板
  await ev(`(function(){
    const s = window.Store;
    const g = s.coupleVault();
    g.saved = 186000; g.target = 500000;
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const h = document.querySelector('#view-couple .cp-vault-head');
    if (h) h.click();
    return 1;
  })()`);
  await sleep(700);
  await shot('cp25-vault-sheet');

  await ev(`(function(){
    const c = document.querySelector('#sheet-root .sheet-close');
    if (c) c.click();
    return 1;
  })()`);
  await sleep(500);

  // 26) 「只在本机」告知弹窗：底部一条长条气泡，只有一个「知道了」
  await ev(`(function(){
    const b = document.querySelector('#view-couple [data-cp="sync-soon"]');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(700);
  await shot('cp26-sync-one-btn');

  await ev(`(function(){
    const b = document.querySelector('#modal-root [data-act="ok"]');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(500);

  // 27) 见面倒计时带时分：异地首页
  await ev(`(function(){
    const s = window.Store;
    s.setSettings({ couple: { mode:'remote', nextMeet: '2026-11-01 20:30', tzOffset: -5 } });
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(600);
  await shot('cp27-remote-countdown');

  // 28) 只选日期还是选日期+时间：日期选择器底部的时分选择
  await ev(`(function(){
    const b = document.querySelector('#view-couple [data-cp="next-meet"]');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(800);
  await shot('cp28-meet-picker');

  // 28b) 点开气泡后的时间面板（小时/分钟胶囊）
  await ev(`(function(){
    const b = document.querySelector('#sheet-root .dp-blob');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(500);
  await shot('cp28b-meet-time');

  // 28c) 深色下的时间面板
  await ev(`(function(){
    window.App.applyTheme('dark');
    return 1;
  })()`);
  await sleep(600);
  await shot('cp28c-meet-time-dark');

  await ev(`(function(){
    window.App.applyTheme('light');
    const c = document.querySelector('#sheet-root .sheet-close');
    if (c) c.click();
    return 1;
  })()`);
  await sleep(500);

  // 29) 见面基金攒满：问一句「快和 TA 见一面吧」
  await ev(`(function(){
    const s = window.Store;
    let g = s.coupleMeetFund();
    if (!g) g = s.addGoal({ name:'下次见面基金', icon:'✈️', target: 0, color:'#FF6A9B', kind:'couple', slot:'meet' });
    s.updateGoal(g.id, { target: 300000, saved: 299900 });
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const b = document.querySelector('#view-couple [data-cp="fund-goal-go"]');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(700);
  await ev(`(function(){
    const a = document.querySelector('#sheet-root #cv-amount');
    if (a) { a.value = '1'; document.querySelector('#sheet-root #cv-in').click(); }
    return 1;
  })()`);
  await sleep(800);
  await shot('cp29-fund-full');

  // ---- 2026-10 新界面：日历 / 月报 / 历史账本删除 ----
  // 30) 日历（同城，亮色）—— 回忆小票墙改造成的日历
  await ev(`(function(){
    const s = window.Store;
    s.enableCouple({ enabled: true });
    s.setSettings({ theme: 'light', couple: { mode: 'local' } });
    App.applyTheme();
    window.ViewCouple.setStep('main');
    window.ViewCouple.setPage('memories');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    window.App.refreshTopbar();
    return 1;
  })()`);
  await sleep(800);
  await shot('cp30-calendar');

  // 31) 点某一天，展开那天做了什么
  await ev(`(function(){
    const c = document.querySelector('#view-couple .cp-cal-cell.has');
    if (c) c.click();
    return !!c;
  })()`);
  await sleep(600);
  await shot('cp31-calendar-day');

  // 32) 月报
  await ev(`(function(){
    const b = document.querySelector('#view-couple [data-cp="to-report"]');
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(800);
  await shot('cp32-report');

  // 33) 月报（深色）
  await ev("window.Store.setSettings({ theme: 'dark' }); App.applyTheme();");
  await sleep(600);
  await shot('cp33-report-dark');

  // 34) 历史账本：只列关掉的那几本，每行带「永久删除」
  await ev(`(function(){
    const s = window.Store;
    s.setSettings({ theme: 'light' });
    App.applyTheme();
    // 造一本「关掉的」历史账本出来
    if (s.cpBooks().length < 2) {
      s.startNewCpBook({});
      s.enableCouple({ meName: '阿岚', peerName: '阿柚', mode: 'remote', togetherSince: '2023-09-01' });
      s.closeCouple('pause');
      const first = s.cpBooks()[0];
      s.openCpBook(first.id);
    }
    window.ViewCouple.setStep('main');
    window.ViewCouple.setPage('home');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    window.App.refreshTopbar();
    return 1;
  })()`);
  await sleep(700);
  await shot('cp34-home-minimal');
  await ev("document.querySelector('#view-couple [data-cp=\"books\"]').click()");
  await sleep(700);
  await shot('cp35-books-list');

  // 36) 永久删除第一关
  await ev(`(function(){
    const all = Array.from(document.querySelectorAll('#sheet-root .sheet'));
    const top = all[all.length - 1];
    const d = top && top.querySelector('[data-del]');
    if (d) d.click();
    return !!d;
  })()`);
  await sleep(700);
  await shot('cp36-books-delete');

  // 37) 永久删除第二关（输入「删除」）
  await ev(`(function(){
    const all = Array.from(document.querySelectorAll('#sheet-root .sheet'));
    const top = all[all.length - 1];
    const n = top && top.querySelector('[data-cq="next"]');
    if (n) n.click();
    return !!n;
  })()`);
  await sleep(700);
  await ev(`(function(){
    const i = document.querySelector('#cpq-del-input');
    if (i) { i.value = '删除'; i.dispatchEvent(new Event('input', { bubbles: true })); }
    return !!i;
  })()`);
  await sleep(400);
  await shot('cp37-books-delete-2');

  // 38) 开通页：必填资料加了「你的生日 / TA 的生日」
  await ev(`(function(){
    const s = window.Store;
    s.closeCouple('');
    window.App.go('couple');
    const v = document.querySelector('#view-couple');
    window.ViewCouple.setStep('profile');
    window.ViewCouple.render(v);
    return 1;
  })()`);
  await sleep(700);
  await shot('cp38-profile-birthday');

  // 39) 同城 / 异地：两张卡均分整屏
  await ev(`(function(){
    window.ViewCouple.setStep('mode');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(700);
  await shot('cp39-mode-fill');

  // 40) 首页「来自 TA 的偏爱」
  await ev(`(function(){
    const s = window.Store;
    s.enableCouple({ enabled: true });
    s.setSettings({ couple: { mode: 'local' } });
    s.cpAddTx({ type: 'expense', amount: 880, catId: 'redpacket', sub: 'TA 给的',
      note: '给你买奶茶', ts: Date.now() - 7200000, attrib: 'peer', rpFrom: 'peer' });
    s.cpAddTx({ type: 'expense', amount: 520, catId: 'redpacket', sub: '发给 TA',
      note: '买点好吃的', ts: Date.now() - 3600000, attrib: 'me', rpFrom: 'me' });
    window.ViewCouple.setStep('main');
    window.ViewCouple.setPage('home');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    window.App.refreshTopbar();
    return 1;
  })()`);
  await sleep(800);
  await shot('cp40-favor-card');

  // 41) 记账弹层里选了「红包」之后的归属提示
  await ev(`(function(){
    const b = document.querySelector('#view-couple [data-cp="bill-add"]');
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(600);
  await ev(`(function(){
    const p = document.querySelector('#sheet-root .cp-item[data-id="redpacket"]');
    if (p) p.click();
    return !!p;
  })()`);
  await sleep(500);
  await shot('cp41-redpacket-hint');

  if (errs.length) console.log('JS 异常:', errs.slice(0, 3));
  else console.log('JS 异常: none');

  ws.close(); await env.stop(proc);console.log('done');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
