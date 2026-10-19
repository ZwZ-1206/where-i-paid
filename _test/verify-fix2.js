const env = require('./_env');
/* 三件事的真机验证：
   ① 记一笔情侣账：金额输入框不能有大黑框（focus 时无 outline）
   ② 下次见面：只允许选今天及以后；过去的点不动也不虚化矛盾
   ③ 小金库：有「目标金额」入口；存取面板分组清晰不重叠 */
const PORT = 9411;
const PROFILE = env.profile('fix2');
const fs = require('fs');
const { spawn } = require('child_process');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4180/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
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
  await S('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
  await S('Page.navigate', { url: URL });
  await sleep(2800);

  const errs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push((d.exception && d.exception.description) || d.text);
    }
  });

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try {
      const ok = await fn();
      if (ok) { pass++; console.log('  ✅ ' + name); }
      else { fail++; console.log('  ❌ ' + name); }
    } catch (e) { fail++; console.log('  ❌ ' + name + ' :: ' + e.message); }
  };

  // 造数据：开通 + 异地
  await ev(`(function(){
    const s = window.Store;
    s.clearAll();
    s.enableCouple({ meName:'小懒', peerName:'小满', mode:'remote',
      togetherSince:'2024-05-20', consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}});
    window.App.go('couple');
    window.ViewCouple.setStep('main');
    window.ViewCouple.setPage('home');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(700);

  console.log('\n=== ① 记账页金额输入框没有大黑框 ===');
  await ev(`(function(){
    const b = document.querySelector('#view-couple [data-cp="bill-add"]');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(700);
  await t('金额输入框存在且已获得焦点', () => ev(`(function(){
    const i = document.querySelector('#sheet-root #cbe-amount');
    return !!i && document.activeElement === i;
  })()`));
  await t('聚焦时 outline 为 none（不再有黑色描边）', () => ev(`(function(){
    const i = document.querySelector('#sheet-root #cbe-amount');
    const cs = getComputedStyle(i);
    return cs.outlineStyle === 'none' || cs.outlineWidth === '0px';
  })()`));
  await t('聚焦时没有大块 box-shadow 黑框', () => ev(`(function(){
    const i = document.querySelector('#sheet-root #cbe-amount');
    const sh = getComputedStyle(i).boxShadow;
    return sh === 'none' || !/rgb\\(0, 0, 0\\)/.test(sh);
  })()`));
  await t('金额输入框背景透明（不是深色块）', () => ev(`(function(){
    const i = document.querySelector('#sheet-root #cbe-amount');
    const bg = getComputedStyle(i).backgroundColor;
    return bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
  })()`));
  await ev(`(function(){ const c=document.querySelector('#sheet-root .sheet-close'); if(c) c.click(); return 1; })()`);
  await sleep(500);

  console.log('\n=== ② 下次见面只能选今天及以后 ===');
  await ev(`(function(){
    document.querySelector('#view-couple [data-cp="next-meet"]').click();
    return 1;
  })()`);
  await sleep(700);
  await t('日期选择器打开了', () => ev(`(function(){
    return !!document.querySelector('#sheet-root .dp-grid');
  })()`));
  await t('见面倒计时不再显示提示行（灰格子已经说明问题）', () => ev(`(function(){
    const tip = document.querySelector('#sheet-root .dp-tip');
    return !tip || tip.textContent.trim() === '';
  })()`));
  // 日期选择器现在会落在「已选的那个日子」所在月（见面日期常在 14 天后，
  // 可能是下个月），要先把日历翻回今天所在月，才谈得上「过去的日期」。
  //
  // m03610：不能用 .dp-nav 翻月 —— 日视图下这对箭头 visibility:hidden
  // （用户点不到，翻月靠点标题进月份网格），而且它的处理器是按年翻的
  // （view + d*12），点一下直接从 2026 跳到 2014，之后守卫把后续点击全吞掉。
  // 真实交互是：点标题 → 月份网格 → 点「N 月」→ 落到那个月的日视图。
  await ev(`(async function(){
    const todayTs = window.U.startOfDay(new Date()).getTime();
    const curM = new Date(todayTs).getMonth();
    const hasToday = () => !!document.querySelector('#sheet-root .dp-day[data-ts="' + todayTs + '"]');
    for (let i = 0; i < 3; i++) {
      if (hasToday()) return 'ok';
      const title = document.querySelector('#sheet-root [data-part="title"]');
      if (!title) return 'no-title';
      title.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 80));
      const cell = document.querySelector('#sheet-root .dp-cell[data-month="' + curM + '"]');
      if (!cell) return 'no-month-cell';
      // 今天的月份可能是 .off（已经在更早的可选月之前）——那说明今天本身就不可选，
      // 不是翻页问题，交给断言去报，别在这里空转。
      if (cell.classList.contains('off')) return 'month-off';
      cell.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 80));
      if (hasToday()) return 'ok';
      // 刚点的月份不在今天的年份里，回到日视图再来一轮
      const back = document.querySelector('#sheet-root [data-part="title"]');
      if (back) { back.click(); await new Promise((r) => setTimeout(r, 60)); }
    }
    return hasToday() ? 'ok' : 'never-reached';
  })()`);
  await sleep(400);
  await t('过去的日期带 .off（灰掉 + 划斜线 + 点不动）', () => ev(`(function(){
    const today = window.U.startOfDay(new Date()).getTime();
    const offs = Array.from(document.querySelectorAll('#sheet-root .dp-day.off'));
    // 今天如果是月初，当月根本没有更早的格子 —— 那也说明「今天以后才能选」是对的
    if (!offs.length) {
      const first = document.querySelector('#sheet-root .dp-day');
      return !!first && Number(first.dataset.ts) >= today;
    }
    return offs.every(function(n){ return Number(n.dataset.ts) < today; });
  })()`));
  await t('.off 的日期 pointer-events 为 none（真的点不动）', () => ev(`(function(){
    const n = document.querySelector('#sheet-root .dp-day.off');
    if (!n) return true; // 本月没有更早的日子，这条不适用
    return getComputedStyle(n).pointerEvents === 'none';
  })()`));
  await t('今天的日期是可选的（不在 .off 里）', () => ev(`(function(){
    const today = window.U.startOfDay(new Date()).getTime();
    const n = document.querySelector('#sheet-root .dp-day[data-ts="' + today + '"]');
    return !!n && !n.classList.contains('off');
  })()`));
  await t('过去日期点击后选中状态不改变（防绕过 pointer-events）', () => ev(`(function(){
    const n = document.querySelector('#sheet-root .dp-day.off');
    if (!n) return true;
    const sel0 = document.querySelector('#sheet-root .dp-day.sel');
    const before = sel0 ? sel0.dataset.ts : null;
    n.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const sel1 = document.querySelector('#sheet-root .dp-day.sel');
    const after = sel1 ? sel1.dataset.ts : null;
    return before === after;
  })()`));
  await t('「确定」拿到的日期不会早于今天', () => ev(`(async function(){
    return new Promise(function(res){
      window.__picked = null;
      window.UI.datePicker({
        title: 't', value: Date.now() - 30 * 86400000, min: window.U.startOfDay(new Date()).getTime(),
        onPick: function(ts){ window.__picked = ts; res(true); },
      });
      setTimeout(function(){
        const ok = document.querySelectorAll('#sheet-root [data-act="ok"]');
        ok[ok.length - 1].click();
      }, 60);
    }).then(function(){
      return window.__picked >= window.U.startOfDay(new Date()).getTime();
    });
  })()`));
  await sleep(400);
  await ev(`(function(){ const ss=document.querySelectorAll('#sheet-root .sheet-close'); ss.forEach(function(c){c.click();}); return 1; })()`);
  await sleep(500);

  console.log('\n=== ③ 小金库目标金额 + 存取面板 ===');
  await ev(`(function(){
    const g = window.Store.coupleVault();
    if (!g) window.Store.addGoal({ name:'我们的小金库', kind:'couple', slot:'vault', target:0, color:'#FF6A9B' });
    const g2 = window.Store.coupleVault();
    window.Store.updateGoal(g2.id, { saved: 0, target: 0 });
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(400);
  await ev(`(function(){
    document.querySelector('#view-couple .cp-vault-head').click();
    return 1;
  })()`);
  await sleep(700);
  await t('面板里有「目标金额」入口行', () => ev(`(function(){
    const r = document.querySelector('#sheet-root .cv-target-row');
    return !!r && /目标金额/.test(r.textContent);
  })()`));
  await t('没有目标时入口说「还没定，点这里定一个」', () => ev(`(function(){
    const r = document.querySelector('#sheet-root .cv-target-row');
    return !!r && /还没定/.test(r.textContent) && /未设置/.test(r.textContent);
  })()`));
  await t('点入口能打开定目标弹层', async () => {
    await ev(`(function(){ document.querySelector('#sheet-root .cv-target-row').click(); return 1; })()`);
    await sleep(500);
    return ev(`(function(){ return !!document.querySelector('#cvt-amount'); })()`);
  });
  await t('快捷金额按钮能填进去', async () => {
    await ev(`(function(){ document.querySelector('#sheet-root [data-qk="200000"]').click(); return 1; })()`);
    await sleep(200);
    return ev(`(function(){ return document.querySelector('#cvt-amount').value === '2000'; })()`);
  });
  await t('保存后目标真的写进去了', async () => {
    await ev(`(function(){
      const btns = Array.from(document.querySelectorAll('#sheet-root .sheet-foot .btn'));
      const ok = btns[btns.length - 1]; if (ok) ok.click(); return 1;
    })()`);
    await sleep(600);
    return ev(`(function(){ return window.Store.coupleVault().target === 200000; })()`);
  });
  await t('面板上的目标金额跟着变成 ¥2,000.00', () => ev(`(function(){
    const r = document.querySelector('#sheet-root .cv-target-row');
    return !!r && /2,000/.test(r.textContent) && /还差/.test(r.textContent);
  })()`));
  await t('面板元素没有重叠（金额/备注/按钮三行依次排开）', () => ev(`(function(){
    const q = function(s){ const e=document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const a = q('#sheet-root .cv-amount-row');
    const n = q('#sheet-root .cv-note');
    const b = q('#sheet-root .cv-acts');
    const tr = q('#sheet-root .cv-target-row');
    if (!a || !n || !b || !tr) return false;
    return tr.bottom <= a.top + 1 && a.bottom <= n.top + 1 && n.bottom <= b.top + 1;
  })()`));
  await t('两个操作按钮等宽且不挤成一团', () => ev(`(function(){
    const bs = Array.from(document.querySelectorAll('#sheet-root .cv-act'));
    if (bs.length !== 2) return false;
    const w1 = bs[0].getBoundingClientRect().width, w2 = bs[1].getBoundingClientRect().width;
    return Math.abs(w1 - w2) < 2 && w1 > 120;
  })()`));
  await t('存一笔后进度和记录都更新', async () => {
    await ev(`(function(){
      const i = document.querySelector('#sheet-root #cv-amount');
      i.value = '500'; i.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#sheet-root #cv-in').click();
      return 1;
    })()`);
    await sleep(600);
    return ev(`(function(){
      const g = window.Store.coupleVault();
      const logs = document.querySelectorAll('#sheet-root .cv-log').length;
      return g.saved === 50000 && logs === 1;
    })()`);
  });
  await t('记录行有日期和正负号金额', () => ev(`(function(){
    const l = document.querySelector('#sheet-root .cv-log');
    return !!l && /\\+/.test(l.textContent) && !!l.querySelector('.cv-log-date');
  })()`));

  console.log('\n');
  if (errs.length) console.log('JS 异常:', errs.slice(0, 3));
  else console.log('JS 异常: none');
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  ws.close(); await env.stop(proc);process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
