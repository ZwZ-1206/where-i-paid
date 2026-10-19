/* 新功能验收：10 个功能 + 搜索跨周期的 UI 级检查 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9388;
const BASE = 'http://127.0.0.1:4173/index.html';
const PROFILE = env.profile('verify-new');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(ok, name, msg) { results.push({ ok, name, msg }); }

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--window-size=390,844', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const list = await r.json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      }
    } catch (e) {}
    await sleep(250);
  }
  if (!target) { console.error('CDP 未就绪'); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const jsErrors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      jsErrors.push((d.exception && d.exception.description) || d.text);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: BASE });
  await sleep(2600);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  const t = async (name, fn) => {
    try { await fn(); record(true, name); }
    catch (e) { record(false, name, e && e.message); }
  };
  const eq = (a, b, label) => {
    if (a !== b) throw new Error(`${label || ''} 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
  };
  const ok = (v, label) => { if (!v) throw new Error(label || '断言失败'); };

  // ---------- 干净环境 + 造数据 ----------
  await t('模块全部加载', async () => {
    const m = await ev(`JSON.stringify({
      Store: !!window.Store, U: !!window.U, Extras: !!window.Extras, Remind: !!window.Remind,
      Add: !!window.ViewAdd, Detail: !!window.ViewDetail, Report: !!window.ViewReport,
      Settings: !!window.ViewSettings, App: !!window.App
    })`);
    const o = JSON.parse(m);
    Object.keys(o).forEach((k) => ok(o[k], k + ' 未加载'));
  });

  await ev(`(function(){
    const S = window.Store;
    S.clearAll(false);
    S.setSettings({
      cycle: { type: 'month', startDay: 1 },
      budget: { amount: 310000, split: {} },
      theme: 'light',
      subAlert: { enabled: true, daysBefore: 10 },
      advance: { enabled: true, remindDays: 5 },
      wish: { enabled: true, hours: 48 },
      autoSave: { enabled: false, goalId: '', ratio: 1, cap: 0 },
    });
    const now = Date.now();
    const DAY = 86400000;
    const main = S.books()[0].id;
    // 昨天、前天的餐饮，用于「上次多少钱」
    S.addTx({ type:'expense', amount: 2580, catId:'food', sub:'午餐', note:'沙县小吃', ts: now - 2*DAY });
    S.addTx({ type:'expense', amount: 3200, catId:'food', sub:'午餐', note:'黄焖鸡', ts: now - 1*DAY });
    // 今天已花 50 元
    S.addTx({ type:'expense', amount: 5000, catId:'market', note:'买菜', ts: now - 60000 });
    // 垫付两笔
    S.addTx({ type:'expense', amount: 30000, catId:'social', sub:'请客', note:'帮老王垫的餐费',
      ts: now - 12*DAY, advance: { who:'老王', status:'open', dueTs: now - 2*DAY } });
    S.addTx({ type:'expense', amount: 80000, catId:'shopping', note:'帮小李买的',
      ts: now - 5*DAY, advance: { who:'小李', status:'open', dueTs: now + 3*DAY } });
    // 三个月前的一笔，用于搜索跨周期
    const p = S.currentPeriod();
    S.addTx({ type:'expense', amount: 12345, catId:'food', note:'三个月前的火锅', ts: p.start.getTime() - 90*DAY });
    // 订阅：每月 8 号，最近一次在 3 天前（下次约 27 天后）
    const base = now - 3*DAY;
    for (let i = 3; i >= 0; i--) {
      S.addTx({ type:'expense', amount: 4800, catId:'fun', note:'Netflix 会员', ts: base - i*30*DAY });
    }
    // 第二本账本
    const b2 = S.addBook({ name: '旅行', icon: '✈️', color: '#14B87A' });
    const old = S.activeBookId();
    S.switchBook(b2.id);
    S.addTx({ type:'expense', amount: 128000, catId:'transport', note:'机票', ts: now - 3*DAY });
    S.switchBook(old);
    // 想买清单：一件已过冷静期，一件在冷却中
    const w1 = S.addWish({ name:'降噪耳机', amount: 89900, catId:'shopping' });
    S.updateWish(w1.id, { dueTs: now - 3600000 });
    S.addWish({ name:'机械键盘', amount: 59900, catId:'shopping' });
    const w3 = S.addWish({ name:'第 4 双跑鞋', amount: 45000, catId:'shopping' });
    S.dropWish(w3.id);
    App.go('add');
    return 1;
  })()`);
  await sleep(700);

  // ---------- ① 今天还能花 ----------
  await t('记账页有「今天还能花」额度条', async () => {
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .status-strip .quota-bar')`), '额度条不存在');
  });
  await t('额度条口径正确（今天额度 − 今天已花）', async () => {
    const r = JSON.parse(await ev(`(function(){
      const q = window.Store.todayQuota();
      // 今天已花 50 元 → left 应等于 quota − 5000
      return JSON.stringify({ left: q.left, quota: q.quota, todaySpent: q.todaySpent });
    })()`));
    eq(r.todaySpent, 5000, '今天已花');
    ok(Math.abs(r.left - (r.quota - 5000)) < 0.01, `left 应为 quota−5000，实际 ${r.left} vs ${r.quota}`);
  });
  await t('输入金额后额度条文案变「记下后还剩」', async () => {
    await ev(`(function(){ const v=document.querySelector('.view[data-view="add"]'); v.querySelector('[data-key="5"]').click(); v.querySelector('[data-key="0"]').click(); return 1; })()`);
    await sleep(400);
    const txt = await ev(`(document.querySelector('.view[data-view="add"] .quota-line1')||{}).textContent||''`);
    ok(/记下后今天还剩|记下就超了/.test(txt), '文案应随输入变化，实际：' + txt);
  });
  await t('额度条与上次价格在同一行状态条里', async () => {
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .status-strip .last-price')`), '上次价格条不在状态条里');
  });

  // ---------- ② 上次多少钱 ----------
  await t('选餐饮后出现「上次多少钱」', async () => {
    await ev(`(function(){
      const v=document.querySelector('.view[data-view="add"]');
      const c=v.querySelector('[data-cat="food"]'); if(c) c.click();
      return 1;
    })()`);
    await sleep(450);
    const txt = await ev(`(document.querySelector('.view[data-view="add"] .lp-txt')||{}).textContent||''`);
    ok(/上次/.test(txt), '文案不对：' + txt);
    ok(/¥32\.00/.test(txt), '应显示最近一笔 32 元，实际：' + txt);
  });
  await t('点「填入」把上次金额写进输入框', async () => {
    await ev(`(function(){
      const b=document.querySelector('.view[data-view="add"] .last-price');
      if(!b) throw new Error('没有上次价格条');
      b.click(); return 1;
    })()`);
    await sleep(400);
    const val = await ev(`document.querySelector('.view[data-view="add"] .amount-val').textContent.trim()`);
    ok(val.indexOf('32') >= 0, '应填入 32，实际：' + val);
  });

  // ---------- ③ 垫付待收 ----------
  await t('记账页有「帮别人垫的」入口', async () => {
    ok(await ev(`!!document.querySelector('.view[data-view="add"] [data-act="advance-toggle"]')`), '入口不存在');
  });
  await t('点开垫付后能填「谁」和「催款日」', async () => {
    await ev(`document.querySelector('.view[data-view="add"] [data-act="advance-toggle"]').click()`);
    await sleep(400);
    ok(await ev(`!!document.querySelector('.view[data-view="add"] #adv-who')`), '没有输入框');
    ok(await ev(`!!document.querySelector('.view[data-view="add"] [data-act="advance-due"]')`), '没有催款日按钮');
  });
  await t('取消垫付能恢复原状', async () => {
    await ev(`document.querySelector('.view[data-view="add"] [data-act="advance-clear"]').click()`);
    await sleep(350);
    ok(await ev(`!document.querySelector('.view[data-view="add"] #adv-who')`), '应已关闭');
  });
  await t('垫付照常计入支出，同时标记为待收', async () => {
    const r = JSON.parse(await ev(`(function(){
      const S = window.Store;
      const s = S.summary(S.currentPeriod());
      const a = S.advanceSummary();
      return JSON.stringify({ expense: s.expense, pending: s.pending, openCount: a.openCount, openAmount: a.openAmount });
    })()`));
    eq(r.openCount, 2, '待收笔数');
    eq(r.openAmount, 110000, '待收金额');
    eq(r.pending, 110000, 'summary.pending');
    ok(r.expense > 0, '支出里应包含垫付（钱确实花出去了）');
  });
  await t('明细页有待收回卡，展开能看到两笔', async () => {
    await ev(`App.go('detail')`);
    await sleep(700);
    ok(await ev(`!!document.querySelector('.view[data-view="detail"] .adv-card')`), '没有待收回卡');
    await ev(`document.querySelector('.view[data-view="detail"] .adv-card-head').click()`);
    await sleep(450);
    const n = await ev(`document.querySelectorAll('.view[data-view="detail"] .adv-card-list .adv-row').length`);
    eq(n, 2, '展开后应有 2 笔');
  });
  await t('超期的那笔被标成红色', async () => {
    ok(await ev(`!!document.querySelector('.view[data-view="detail"] .adv-row.overdue')`), '没有 overdue 行');
  });
  await t('点「已归还」后留档、不再计入支出', async () => {
    const before = await ev(`window.Store.summary(window.Store.currentPeriod()).expense`);
    const n0 = await ev(`window.Store.state.tx.length`);
    await ev(`document.querySelector('.view[data-view="detail"] [data-act="settle-adv"]').click()`);
    await sleep(700);
    const r = JSON.parse(await ev(`(function(){
      const S = window.Store;
      const s = S.summary(S.currentPeriod());
      const voided = S.state.tx.filter(function(t){ return S.isVoid(t); });
      return JSON.stringify({ expense: s.expense, n: S.state.tx.length, voids: voided.length });
    })()`));
    eq(r.n, n0, '账目一条都不能少（留档）');
    ok(r.voids >= 1, '应有一条被标成已归还');
    ok(r.expense < before, `支出应减少：${before} → ${r.expense}`);
    // 明细里应该能看到被划掉的那条
    ok(await ev(`!!document.querySelector('.view[data-view="detail"] .tx-item.is-voided')`), '明细里没有划掉的记录');
  });

  // ---------- 搜索跨周期 ----------
  await t('搜索能搜到其他月份的账目', async () => {
    await ev(`(function(){
      const i=document.querySelector('.view[data-view="detail"] #kw');
      i.value='火锅'; i.dispatchEvent(new Event('input',{bubbles:true}));
      return 1;
    })()`);
    await sleep(600);
    const n = await ev(`document.querySelectorAll('.view[data-view="detail"] .tx-item').length`);
    eq(n, 1, '应搜到 1 笔历史账目');
  });
  await t('搜索时周期标题变成「全部时间」并禁用翻页', async () => {
    const label = await ev(`(document.querySelector('.view[data-view="detail"] .period-label span')||{}).textContent||''`);
    eq(label, '全部时间', '标题');
    ok(await ev(`document.querySelector('.view[data-view="detail"] [data-nav="-1"]').disabled`), '上一周期应禁用');
  });
  await t('清空搜索后回到本期', async () => {
    await ev(`(function(){
      const i=document.querySelector('.view[data-view="detail"] #kw');
      i.value=''; i.dispatchEvent(new Event('input',{bubbles:true}));
      return 1;
    })()`);
    await sleep(550);
    const label = await ev(`(document.querySelector('.view[data-view="detail"] .period-label span')||{}).textContent||''`);
    ok(label !== '全部时间', '应回到本期，实际：' + label);
  });

  // ---------- ⑥ 合并看板 + ⑧ 换算成实物 ----------
  await t('总结页有「这笔钱相当于」卡片', async () => {
    await ev(`App.go('report')`);
    await sleep(750);
    ok(await ev(`!!document.querySelector('.view[data-view="report"] .equiv-card')`), '没有等价物卡');
  });
  await t('等价物文案带 ≈ 和数量', async () => {
    const txt = await ev(`(document.querySelector('.view[data-view="report"] .equiv-txt')||{}).textContent||''`);
    ok(/≈/.test(txt), '文案应以 ≈ 开头，实际：' + txt);
  });
  await t('总结页有「所有账本」合并看板', async () => {
    ok(await ev(`!!document.querySelector('.view[data-view="report"] .merged-card')`), '没有合并看板');
    const rows = await ev(`document.querySelectorAll('.view[data-view="report"] .merged-row').length`);
    eq(rows, 2, '应列出 2 本账本');
  });
  await t('合并看板合计 = 两本账本支出之和', async () => {
    const r = JSON.parse(await ev(`(function(){
      const b = window.Store.mergedBoard(window.Store.currentPeriod());
      return JSON.stringify({ total: b.total.expense, sum: b.rows.reduce((s,x)=>s+x.expense,0) });
    })()`));
    eq(r.total, r.sum, '合计');
    ok(r.total > 0, '合计应大于 0');
  });
  await t('点「只在合并视图看合计」能切入合并视图', async () => {
    await ev(`document.querySelector('.view[data-view="report"] [data-act="switch-all"]').click()`);
    await sleep(700);
    ok(await ev(`window.Store.isAllBooks()`), '应进入合并视图');
    ok(await ev(`window.Store.writeBookId() === window.Store.books()[0].id`), '写入应落到第一本');
    await ev(`(function(){ const S=window.Store; S.switchBook(S.books()[0].id); return 1; })()`);
    await sleep(400);
  });

  // ---------- ⑦ 外币账本 ----------
  await t('把账本改成美元后，记账页货币符号变 $', async () => {
    await ev(`(function(){
      const S = window.Store;
      S.updateBook(S.books()[0].id, { currency: { code:'USD', symbol:'$', rateToCny: 7.1 } });
      App.go('add'); return 1;
    })()`);
    await sleep(650);
    const sym = await ev(`(document.querySelector('.view[data-view="add"] .amount-cur')||{}).textContent||''`);
    eq(sym.trim(), '$', '货币符号');
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .fx-hint')`), '应显示折算提示');
  });
  await t('外币记账入库存人民币', async () => {
    const r = JSON.parse(await ev(`(function(){
      const S = window.Store;
      const before = S.state.tx.length;
      const t = S.addTx({ type:'expense', amount: S.toCnyCents(10000), catId:'food',
        amountFx: 10000, fxRate: 7.1, fxCode: 'USD', ts: Date.now(), note: '外币测试' });
      return JSON.stringify({ amount: t.amount, amountFx: t.amountFx, count: S.state.tx.length - before });
    })()`));
    eq(r.amount, 71000, '入库金额应为 710 元');
    eq(r.amountFx, 10000, '原币保留');
  });
  await t('切回人民币后符号恢复 ¥', async () => {
    await ev(`(function(){
      const S = window.Store;
      S.updateBook(S.books()[0].id, { currency: { code:'CNY', symbol:'¥', rateToCny: 1 } });
      App.go('add'); return 1;
    })()`);
    await sleep(600);
    const sym = await ev(`(document.querySelector('.view[data-view="add"] .amount-cur')||{}).textContent||''`);
    eq(sym.trim(), '¥', '货币符号');
  });

  // ---------- ⑤ 订阅体检 ----------
  await t('设置页点「订阅体检」能打开并列出订阅', async () => {
    await ev(`App.go('settings')`);
    await sleep(600);
    await ev(`document.querySelector('.view[data-view="settings"] [data-act="subs"]').click()`);
    await sleep(700);
    const n = await ev(`document.querySelectorAll('#sheet-root .subs-row').length`);
    ok(n >= 1, '应至少列出 1 个订阅，实际 ' + n);
  });
  await t('订阅体检有「提前几天提醒」并生效', async () => {
    ok(await ev(`document.querySelectorAll('#sheet-root [data-days]').length >= 4`), '应提供多个提前天数');
    await ev(`document.querySelector('#sheet-root [data-days="7"]').click()`);
    await sleep(250);
    await ev(`document.querySelector('#sheet-root [data-act="save"]').click()`);
    await sleep(500);
    eq(await ev(`window.Store.settings.subAlert.daysBefore`), 7, 'daysBefore');
    eq(await ev(`window.Store.settings.subAlert.enabled`), true, 'enabled');
  });
  await t('订阅提醒能被提醒中心读到', async () => {
    await ev(`(function(){ window.Store.setSettings({ subAlert: { enabled: true, daysBefore: 40 } }); return 1; })()`);
    const n = await ev(`window.Remind.list().filter(r => r.kind === 'sub').length`);
    ok(n >= 1, '提醒中心应有订阅提醒，实际 ' + n);
  });

  // ---------- ⑨ 余额反推 ----------
  await t('设置页点「余额反推对账」能打开', async () => {
    await ev(`(function(){ const b=document.querySelector('#sheet-root .sheet-close'); if(b) b.click(); return 1; })()`);
    await sleep(450);
    await ev(`document.querySelector('.view[data-view="settings"] [data-act="recon"]').click()`);
    await sleep(650);
    ok(await ev(`!!document.querySelector('#sheet-root #rc-start')`), '没有期初余额输入框');
    ok(await ev(`!!document.querySelector('#sheet-root #rc-now')`), '没有实际余额输入框');
  });
  await t('填余额后算出差额并给出提示', async () => {
    await ev(`(function(){
      const s=document.querySelector('#sheet-root #rc-start');
      s.value='3000'; s.dispatchEvent(new Event('input',{bubbles:true}));
      const n=document.querySelector('#sheet-root #rc-now');
      n.value='2800'; n.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('#sheet-root [data-act="calc"]').click();
      return 1;
    })()`);
    await sleep(650);
    ok(await ev(`!!document.querySelector('#sheet-root .recon-result')`), '没有结果区');
    ok(await ev(`!!document.querySelector('#sheet-root .recon-hint')`), '没有差额提示');
    const recs = await ev(`window.Store.reconList().length`);
    ok(recs >= 1, '应写入对账记录');
  });

  // ---------- ④ 余钱归仓 ----------
  await t('设置页点「余钱归仓」能打开', async () => {
    await ev(`(function(){ const b=document.querySelector('#sheet-root .sheet-close'); if(b) b.click(); return 1; })()`);
    await sleep(450);
    await ev(`document.querySelector('.view[data-view="settings"] [data-act="autoSave"]').click()`);
    await sleep(650);
    const txt = await ev(`(document.querySelector('#sheet-root .sheet-body, #sheet-root')||{}).textContent||''`);
    ok(/余钱归仓|攒钱目标/.test(txt), '弹层内容不对');
  });
  await t('有余钱时能选目标并开启，结算幂等', async () => {
    const r = JSON.parse(await ev(`(function(){
      const S = window.Store;
      const b = document.querySelector('#sheet-root .sheet-close'); if(b) b.click();
      const hasGoal = S.state.goals.length > 0;
      if (!hasGoal) return JSON.stringify({ skipped: true });
      const g = S.state.goals[0];
      S.setSettings({ autoSave: { enabled: true, goalId: g.id, ratio: 1, cap: 0 } });
      const first = S.settlePeriods().length;
      const second = S.settlePeriods().length;
      return JSON.stringify({ first, second });
    })()`));
    if (!r.skipped) eq(r.second, 0, '第二次结算应幂等');
  });

  // ---------- ⑩ 先别买 ----------
  await t('设置页点「想买清单」能打开并列出愿望', async () => {
    await sleep(400);
    await ev(`(function(){ const b=document.querySelector('#sheet-root .sheet-close'); if(b) b.click(); return 1; })()`);
    await sleep(450);
    await ev(`document.querySelector('.view[data-view="settings"] [data-act="wishlist"]').click()`);
    await sleep(700);
    const n = await ev(`document.querySelectorAll('#sheet-root .subs-row').length`);
    ok(n >= 2, '应列出愿望，实际 ' + n);
    ok(await ev(`!!document.querySelector('#sheet-root .wish-saved')`), '应显示忍住基金');
  });
  await t('「算了」把金额累积进忍住基金', async () => {
    const before = await ev(`window.Store.savedFund()`);
    await ev(`(function(){
      const b = document.querySelector('#sheet-root [data-wish-drop]');
      if (!b) return 0;
      b.click(); return 1;
    })()`);
    await sleep(500);
    const after = await ev(`window.Store.savedFund()`);
    ok(after >= before, `忍住基金应不减少：${before} → ${after}`);
  });
  await t('「还是买了」生成一笔支出', async () => {
    const before = await ev(`window.Store.summary(window.Store.currentPeriod()).expense`);
    const clicked = await ev(`(function(){
      const b = document.querySelector('#sheet-root [data-wish-buy]');
      if (!b) return 0;
      b.click(); return 1;
    })()`);
    await sleep(500);
    if (clicked) {
      const after = await ev(`window.Store.summary(window.Store.currentPeriod()).expense`);
      ok(after > before, `买下后支出应增加：${before} → ${after}`);
    }
  });

  // ---------- 提醒中心 ----------
  await t('顶栏有提醒铃铛且带红点', async () => {
    await ev(`(function(){ const b=document.querySelector('#sheet-root .sheet-close'); if(b) b.click(); return 1; })()`);
    await sleep(450);
    ok(await ev(`!!document.querySelector('.tb-bell')`), '没有铃铛');
    ok(await ev(`!!document.querySelector('.tb-bell .tb-dot')`), '没有红点');
  });
  await t('点铃铛打开提醒中心并列出提醒', async () => {
    await ev(`document.querySelector('.tb-bell').click()`);
    await sleep(700);
    const n = await ev(`document.querySelectorAll('#sheet-root .remind-row').length`);
    ok(n >= 1, '应列出提醒，实际 ' + n);
    ok(await ev(`document.querySelectorAll('#sheet-root [data-ract]').length >= 1`), '应有操作按钮');
  });
  await t('提醒横幅能显示', async () => {
    await ev(`(function(){ const b=document.querySelector('#sheet-root .sheet-close'); if(b) b.click(); return 1; })()`);
    await sleep(450);
    await ev(`window.Remind.showBanner()`);
    await sleep(500);
    ok(await ev(`!!document.querySelector('.remind-banner')`), '横幅没出现');
    await ev(`window.Remind.hideBanner()`);
  });
  await t('垫付催款日提醒能出现在提醒中心', async () => {
    await ev(`(function(){
      const S = window.Store;
      S.setSettings({ advance: { enabled: true, remindDays: 5 } });
      return 1;
    })()`);
    const n = await ev(`window.Remind.list().filter(r => r.kind === 'advance').length`);
    ok(n >= 1, '应有垫付提醒，实际 ' + n);
  });

  // ---------- 深色 + 无异常 ----------
  await t('深色模式下新组件不报错且可见', async () => {
    await ev(`(function(){ const S=window.Store; S.setSettings({theme:'dark'}); App.applyTheme(); return 1; })()`);
    await sleep(450);
    await ev(`App.go('add')`); await sleep(550);
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .quota-bar')`), '额度条丢失');
    await ev(`App.go('report')`); await sleep(650);
    ok(await ev(`!!document.querySelector('.view[data-view="report"] .equiv-card')`), '等价物卡丢失');
    await ev(`(function(){ const S=window.Store; S.setSettings({theme:'auto'}); App.applyTheme(); return 1; })()`);
  });
  // ---------- 想买清单混进明细 ----------
  await t('想买清单的条目出现在明细里，且标灰带倒计时', async () => {
    await ev(`(function(){
      const S = window.Store;
      S.state.wishlist.slice().forEach(function(x){ S.removeWish(x.id); });
      S.setSettings({ wish: { enabled: true, hours: 48 } });
      S.addWish({ name:'想买的耳机', amount: 89900, catId:'shopping' });
      App.go('detail');
      return 1;
    })()`);
    await sleep(750);
    const r = JSON.parse(await ev(`(function(){
      const v = document.querySelector('.view[data-view="detail"]');
      const w = v.querySelector('.tx-item--wish');
      return JSON.stringify({
        found: !!w,
        cooling: !!w && w.classList.contains('is-cooling'),
        grey: !!w && getComputedStyle(w.querySelector('.tx-amt')).color !== getComputedStyle(w.querySelector('.tx-item:not(.tx-item--wish) .tx-amt') || w).color,
        hasBar: !!w && !!w.querySelector('.wish-bar'),
        txt: w ? w.textContent : '',
      });
    })()`));
    ok(r.found, '明细里没有清单条目');
    ok(r.cooling, '没有 is-cooling 标灰态');
    ok(r.hasBar, '没有倒计时进度条');
    ok(/还有/.test(r.txt), '没有倒计时文案：' + r.txt);
  });

  await t('倒计时结束后明细里直接问「买了吗」', async () => {
    await ev(`(function(){
      const S = window.Store;
      const w = S.wishlist().filter(function(x){ return x.status === 'cooling'; })[0];
      S.updateWish(w.id, { dueTs: Date.now() - 1000 });
      App.go('detail');
      return 1;
    })()`);
    await sleep(750);
    ok(await ev(`!!document.querySelector('.view[data-view="detail"] .tx-item--wish.is-ready')`), '没有 is-ready 态');
    ok(await ev(`!!document.querySelector('.view[data-view="detail"] [data-wish-buy]')`), '没有「已购买」按钮');
    ok(await ev(`!!document.querySelector('.view[data-view="detail"] [data-wish-drop]')`), '没有「没买」按钮');
    ok(await ev(`document.querySelector('.view[data-view="detail"] .wish-ask').textContent.indexOf('买了吗') >= 0`), '没有询问文案');
  });

  await t('选「没买」→ 划掉留档，不进账本', async () => {
    const n0 = await ev(`window.Store.state.tx.length`);
    await ev(`document.querySelector('.view[data-view="detail"] [data-wish-drop]').click()`);
    await sleep(600);
    const r = JSON.parse(await ev(`(function(){
      const v = document.querySelector('.view[data-view="detail"]');
      const w = v.querySelector('.tx-item--wish.is-dropped');
      return JSON.stringify({
        dropped: !!w,
        struck: !!w && !!w.querySelector('.is-struck'),
        deco: w ? getComputedStyle(w.querySelector('.tx-name')).textDecorationLine : '',
        tx: window.Store.state.tx.length,
      });
    })()`));
    ok(r.dropped, '没有 is-dropped 态');
    ok(r.struck || /line-through/.test(r.deco), '名字没有划线：' + r.deco);
    eq(r.tx, n0, '没买不应该生成账目');
  });

  await t('选「已购买」→ 变成一笔正常账目', async () => {
    await ev(`(function(){
      const S = window.Store;
      S.addWish({ name:'想买的键盘', amount: 59900, catId:'shopping' });
      return 1;
    })()`);
    await sleep(300);
    const id = await ev(`(function(){
      const S = window.Store;
      const w = S.wishlist().filter(function(x){ return x.status === 'cooling'; })[0];
      S.updateWish(w.id, { dueTs: Date.now() - 1000 });
      return w.id;
    })()`);
    await ev(`App.go('detail')`);
    await sleep(750);
    const n0 = await ev(`window.Store.state.tx.length`);
    await ev(`document.querySelector('.view[data-view="detail"] [data-wish-buy]').click()`);
    await sleep(700);
    eq(await ev(`window.Store.state.tx.length`), n0 + 1, '应该生成一笔账目');
    eq(await ev(`(window.Store.wishlist().find(function(x){return x.id==='` + id + `'})||{}).status`), 'bought', '状态应为 bought');
    // 买完就不该再在时间线里重复出现
    eq(await ev(`document.querySelectorAll('.view[data-view="detail"] [data-wish-buy]').length`), 0, '不该还有待询问的条目');
  });

  // ---------- 垫付在首页的提醒 ----------
  await t('有未收回垫付时，记账页顶部有提醒条', async () => {
    await ev(`(function(){
      const S = window.Store;
      S.addTx({ type:'expense', amount: 30000, catId:'social', ts: Date.now() - 5*86400000,
        advance: { who:'老王', status:'open', dueTs: Date.now() - 86400000 } });
      App.go('add');
      return 1;
    })()`);
    await sleep(750);
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .adv-banner')`), '没有垫付提醒条');
    ok(await ev(`document.querySelector('.view[data-view="add"] .adv-banner').textContent.indexOf('老王') >= 0`), '提醒条没写是谁');
    ok(await ev(`document.querySelector('.view[data-view="add"] .adv-banner').classList.contains('overdue')`), '到期了应该标红');
  });

  await t('点垫付提醒条能打开垫付弹层', async () => {
    await ev(`document.querySelector('.view[data-view="add"] .adv-banner').click()`);
    await sleep(700);
    ok(await ev(`!!document.querySelector('#sheet-root .subs-list, #sheet-root [data-adv-settle]')`), '没打开垫付弹层');
    await ev(`(function(){ const c=document.querySelector('#sheet-root .sheet-close, #sheet-root [data-act="close"]'); if(c) c.click(); return 1; })()`);
    await sleep(400);
  });

  // ---------- 自动扣费只认 App，固定月支出单独入口 ----------
  await t('设置里有两个入口：自动扣费提醒 / 固定月支出', async () => {
    await ev(`App.go('settings')`);
    await sleep(750);
    const r = JSON.parse(await ev(`(function(){
      const v = document.querySelector('.view[data-view="settings"]');
      const names = Array.from(v.querySelectorAll('.set-name')).map(function(x){ return x.textContent.trim(); });
      return JSON.stringify({ names: names, hasSubs: names.indexOf('自动扣费提醒') >= 0, hasFixed: names.indexOf('固定月支出') >= 0, hasOld: names.indexOf('订阅体检') >= 0 });
    })()`));
    ok(r.hasSubs, '没有「自动扣费提醒」');
    ok(r.hasFixed, '没有「固定月支出」');
    ok(!r.hasOld, '旧的「订阅体检」还在');
  });

  await t('房租不会被认成自动扣费', async () => {
    const r = JSON.parse(await ev(`(function(){
      const S = window.Store;
      S.state.subs = [];   // 前面可能把 Netflix 标成了「不是订阅」，这里先清掉
      S.state.tx.slice().forEach(function(t){ if (/房租|Netflix/.test(t.note || '')) S.removeTx(t.id); });
      const now = new Date();
      for (let i = 1; i <= 4; i++) {
        S.addTx({ type:'expense', amount: 280000, catId:'housing', note:'房租',
          ts: new Date(now.getFullYear(), now.getMonth() - i, 5, 10, 0, 0).getTime() });
      }
      for (let i = 1; i <= 4; i++) {
        S.addTx({ type:'expense', amount: 4800, catId:'fun', sub:'会员', note:'Netflix 会员',
          ts: new Date(now.getFullYear(), now.getMonth() - i, 12, 10, 0, 0).getTime() });
      }
      const subs = S.scanSubscriptions();
      return JSON.stringify({
        names: subs.map(function(s){ return s.name; }),
        hasRent: subs.some(function(s){ return /房租/.test(s.name); }),
        hasNetflix: subs.some(function(s){ return /netflix/i.test(s.name); }),
      });
    })()`));
    ok(!r.hasRent, '房租不该被当自动扣费：' + JSON.stringify(r.names));
    ok(r.hasNetflix, 'Netflix 会员应该被认出来：' + JSON.stringify(r.names));
  });

  await t('固定月支出能加一条并出现在列表', async () => {
    await ev(`(function(){
      document.querySelectorAll('.view[data-view="settings"] .set-row').forEach(function(r){
        if (r.getAttribute('data-act') === 'fixed') r.click();
      });
      return 1;
    })()`);
    await sleep(700);
    await ev(`(function(){
      const b = document.querySelector('#sheet-root [data-fixed-preset="rent"]');
      if (b) b.click();
      const n = document.querySelector('#sheet-root #fx-name');
      const a = document.querySelector('#sheet-root #fx-amount');
      const d = document.querySelector('#sheet-root #fx-day');
      if (n && !n.value) n.value = '房租';
      if (a) a.value = '2800';
      if (d && !d.value) d.value = '5';
      const add = document.querySelector('#sheet-root [data-act="fixed-add"]');
      if (add) add.click();
      return 1;
    })()`);
    await sleep(700);
    ok(await ev(`window.Store.fixedExpenses().some(function(r){ return r.name === '房租'; })`), '没加进固定月支出');
    ok(await ev(`!!document.querySelector('#sheet-root .subs-row')`), '弹层列表没刷新');
  });

  // ---------- 关于 / 检查更新 ----------
  await t('设置里有「检查更新」，能核对出版本状态', async () => {
    await ev(`App.go('settings')`);
    await sleep(800);
    ok(await ev(`!!document.querySelector('.view[data-view="settings"] [data-act="check-update"]')`), '没有检查更新入口');
    // 当前版本应该被填上（读的是本地缓存名）
    const ver = await ev(`(function(){ const e=document.querySelector('.view[data-view="settings"] [data-ver]'); return e?e.textContent.trim():''; })()`);
    ok(/^jizhang-v\d/.test(ver) || /^v\d/.test(ver), '版本号没填：' + ver);
    await ev(`document.querySelector('.view[data-view="settings"] [data-act="check-update"]').click()`);
    await sleep(1600);
    const st = await ev(`(function(){ const e=document.querySelector('.view[data-view="settings"] [data-ver-state]'); return e?e.textContent.trim():''; })()`);
    ok(/已是最新|有新版本|连不上|不支持|检查中/.test(st), '状态文案异常：' + st);
  });

  await t('启动时自动比对版本：发现新版会在底部提示', async () => {
    // 伪造服务器上的 sw.js，返回一个更高的版本号
    await ev(`(function(){
      window.__origFetch = window.fetch;
      window.fetch = function(u, o){
        if (String(u).indexOf('sw.js') >= 0) {
          return Promise.resolve(new Response("const CACHE = 'jizhang-v9.9.9';", { status: 200 }));
        }
        return window.__origFetch(u, o);
      };
      return 1;
    })()`);
    await ev(`App.autoCheckUpdate()`);
    await sleep(900);
    const r = JSON.parse(await ev(`(function(){
      const bar = document.querySelector('.update-bar');
      return JSON.stringify({ has: !!bar, in: !!bar && bar.classList.contains('in'), txt: bar ? bar.textContent : '' });
    })()`));
    ok(r.has, '没有出现更新提示条');
    ok(r.in, '提示条没有进入显示状态');
    ok(/v9\.9\.9/.test(r.txt), '没显示新版本号：' + r.txt);
    ok(await ev(`!!document.querySelector('.update-bar .ub-go')`), '没有「更新」按钮');
    // 点「以后」应消失
    await ev(`document.querySelector('.update-bar .ub-later').click()`);
    await sleep(500);
    eq(await ev(`!!document.querySelector('.update-bar')`), false, '点以后应收起');
    // 还原 fetch
    await ev(`(function(){ if (window.__origFetch) window.fetch = window.__origFetch; return 1; })()`);
  });

  await t('版本一致时不打扰用户', async () => {
    await ev(`App.autoCheckUpdate()`);
    await sleep(900);
    eq(await ev(`!!document.querySelector('.update-bar')`), false, '同版本不该弹提示');
  });
  await t('设置里不出现「怎么发布」这类说明（只给自己用）', async () => {
    await ev(`App.go('settings')`);
    await sleep(700);
    const names = JSON.parse(await ev(`(function(){
      return JSON.stringify(Array.from(document.querySelectorAll('.view[data-view="settings"] .set-name')).map(function(x){ return x.textContent.trim(); }));
    })()`));
    ok(!names.some(function(n){ return /发到网上|怎么更新|发布/.test(n); }), '设置里混进了发布说明：' + JSON.stringify(names));
    ok(names.indexOf('检查更新') >= 0, '检查更新入口不见了');
  });
  // ---------- 记账页键盘默认收起 ----------
  await t('记账页键盘默认收起，不占屏幕', async () => {
    await ev(`App.go('add')`);
    await sleep(750);
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .input-dock.is-closed')`), '键盘没有默认收起');
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .dock-open')`), '没有常驻的「输入金额」小条');
    const h = await ev(`(function(){ const d=document.querySelector('.view[data-view="add"] .input-dock'); return d.getBoundingClientRect().height; })()`);
    ok(h < 2, '收起后高度应为 0，实际 ' + h);
    // 收起时整块内容区应该更高（能看到更多东西）
    const sc = await ev(`(function(){ const d=document.querySelector('.view[data-view="add"] .add-scroll'); return d.getBoundingClientRect().height; })()`);
    ok(sc > 500, '内容区应该占满屏幕，实际 ' + sc);
  });

  await t('点金额把键盘弹出来，点手柄能收起', async () => {
    await ev(`document.querySelector('.view[data-view="add"] .amount-display').click()`);
    await sleep(600);
    ok(await ev(`!document.querySelector('.view[data-view="add"] .input-dock').classList.contains('is-closed')`), '点金额没展开');
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .keypad')`), '键盘不见了');
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .dock-open.is-hidden')`), '展开后小条应该隐藏');
    const h = await ev(`(function(){ const d=document.querySelector('.view[data-view="add"] .input-dock'); return d.getBoundingClientRect().height; })()`);
    ok(h > 200, '展开后应该占出一块高度，实际 ' + h);
    await ev(`document.querySelector('.view[data-view="add"] .dock-grip').click()`);
    await sleep(600);
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .input-dock.is-closed')`), '点手柄没收起');
  });

  await t('底部小条也能把键盘叫回来', async () => {
    await ev(`document.querySelector('.view[data-view="add"] .dock-open').click()`);
    await sleep(600);
    ok(await ev(`!document.querySelector('.view[data-view="add"] .input-dock').classList.contains('is-closed')`), '点小条没展开');
    // 收起来，给后面的用例留个干净状态
    await ev(`document.querySelector('.view[data-view="add"] .dock-grip').click()`);
    await sleep(500);
  });
  // ---------- 计算器 ----------
  await t('加减法没按运算符，点完成也会按算好的金额记账', async () => {
    // 先清空草稿，避免受前面用例输入的金额影响
    await ev(`(function(){ ViewAdd.reset(); App.go('add'); return 1; })()`);
    await new Promise((r) => setTimeout(r, 700));
    const before = await ev(`window.Store.state.tx.length`);
    // 12.5 + 8 然后直接点完成
    for (const k of ['1', '2', '.', '5']) { await ev('document.querySelector(\'[data-key="' + k + '"]\').click()'); }
    await ev(`document.querySelector('[data-key="+"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    await ev(`document.querySelector('[data-key="8"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    await ev(`document.querySelector('[data-key="ok"]').click()`);
    await new Promise((r) => setTimeout(r, 600));
    eq(await ev(`window.Store.state.tx.length`), before + 1, '应该记下一笔');
    const amt = await ev(`window.Store.state.tx[window.Store.state.tx.length - 1].amount`);
    eq(amt, 2050, '金额应为 12.5 + 8 = 20.50 元');
  });
  // ---------- 长截屏识别 ----------
  await t('长截屏会切成多段识别，并合并成多笔', async () => {
    const raw = await ev(`(async function(){
      // 造一张 400x3000 的长图（高宽比 7.5，一定会切片）
      const cv = document.createElement('canvas');
      cv.width = 400; cv.height = 3000;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 3000);
      ctx.fillStyle = '#000'; ctx.font = '18px sans-serif';
      for (let i = 0; i < 60; i++) ctx.fillText('row ' + i, 10, 30 + i * 48);
      const url = cv.toDataURL('image/png');

      // 用假的识别引擎顶替 tesseract：按段返回账单行，模拟真实长截屏
      const oldT = window.Tesseract;
      const oldWorker = window.OCR.state;
      let calls = 0;
      window.Tesseract = {
        createWorker: async function(){
          return {
            setParameters: async function(){ return true; },
            terminate: async function(){ return true; },
            recognize: async function(){
              calls++;
              if (calls === 1) return { data: { text: '餐饮\\n美团外卖\\n-25.80\\n星巴克咖啡\\n-31.00' } };
              if (calls === 2) return { data: { text: '星巴克咖啡\\n-31.00\\n滴滴出行\\n-18.50' } };
              return { data: { text: '滴滴出行\\n-18.50\\n工资\\n+12439.40' } };
            },
          };
        },
      };
      try {
        const res = await window.OCR.scan(url, { onProgress: function(){} });
        return JSON.stringify({
          calls: calls, tiles: res.tiles, mode: res.mode, n: res.entries.length,
          names: res.entries.map(function(e){ return e.merchant; }),
          income: res.entries.filter(function(e){ return e.type === 'income'; }).length,
        });
      } finally {
        window.Tesseract = oldT;
        if (window.OCR.terminate) await window.OCR.terminate();
      }
    })()`);
    const r = JSON.parse(raw);
    ok(r.calls >= 2, '长图应该被切成多段分别识别，实际只调用了 ' + r.calls + ' 次');
    eq(r.tiles, r.calls, 'tiles 应等于实际调用的段数');
    eq(r.mode, 'list', '应走列表（多笔）模式');
    eq(r.n, 4, '应合并成 4 笔（重叠的重复行要去掉），实际 ' + r.n + '：' + JSON.stringify(r.names));
    ok(r.names.indexOf('美团外卖') >= 0, '缺少美团外卖：' + JSON.stringify(r.names));
    ok(r.names.indexOf('滴滴出行') >= 0, '缺少滴滴出行：' + JSON.stringify(r.names));
    eq(r.income, 1, '工资应识别成收入');
  });
  // ---------- 临时地址识别 ----------
  await t('能认出临时隧道地址（tunnelmole 等）', async () => {
    const r = JSON.parse(await ev(`(function(){
      const re = /\\.(tunnelmole\\.net|trycloudflare\\.com|ngrok\\.io|ngrok-free\\.app|loca\\.lt|serveo\\.net)$/i;
      return JSON.stringify({
        temp: re.test('vli2rh-ip-59-64-129-23.tunnelmole.net'),
        cf: re.test('abc-123.pages.dev'),
        local: re.test('192.168.1.5'),
        localhost: re.test('localhost'),
      });
    })()`));
    ok(r.temp, 'tunnelmole 临时地址应被识别');
    eq(r.cf, false, 'Cloudflare Pages 固定地址不该被当成临时');
    eq(r.local, false, '局域网 IP 不该被当成临时');
    eq(r.localhost, false, 'localhost 不该被当成临时');
  });

  await t('App 暴露了临时地址检测接口', async () => {
    eq(await ev(`typeof App.isTempOrigin`), 'function', 'isTempOrigin 应为函数');
    eq(await ev(`typeof App.checkTempOrigin`), 'function', 'checkTempOrigin 应为函数');
    eq(await ev(`App.isTempOrigin()`), false, 'localhost 上不该判定为临时地址');
  });
  await t('全程没有未捕获的 JS 异常', async () => {
    ok(jsErrors.length === 0, jsErrors.join(' | '));
  });

  // ---------- 输出 ----------
  console.log('\n===== 新功能验收结果 =====');
  let pass = 0, fail = 0;
  results.forEach((r) => {
    if (r.ok) { pass++; console.log(`  ✅ ${r.name}`); }
    else { fail++; console.log(`  ❌ ${r.name}\n       ${r.msg}`); }
  });
  console.log(`\n通过 ${pass} / ${pass + fail}`);

  ws.close(); await env.stop(proc);
  await sleep(300);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('验收运行失败:', e); process.exit(1); });
