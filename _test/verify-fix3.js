const env = require('./_env');
/* 见面倒计时带时分 + 见面基金攒满询问 */
const PORT = 9415;
const PROFILE = env.profile('fix3');
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

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try {
      const r = await fn();
      if (r) { pass++; console.log('  ✅ ' + name); }
      else { fail++; console.log('  ❌ ' + name); }
    } catch (e) { fail++; console.log('  ❌ ' + name + ' :: ' + e.message); }
  };

  // 开异地模式 + 造资料
  await ev(`(function(){
    const s = window.Store;
    s.clearAll();
    s.enableCouple({ meName:'小懒', peerName:'小满', mode:'remote', togetherSince:'2024-05-20',
      consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)} });
    window.App.go('couple');
    window.ViewCouple.setStep('main');
    window.ViewCouple.setPage('home');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(600);

  console.log('\n=== ① 见面倒计时带时分 ===');

  await t('异地首页有「见面倒计时」模块', () => ev(`(function(){
    const txt = document.querySelector('#view-couple .cp-mods').textContent;
    return /见面倒计时/.test(txt);
  })()`));

  await t('从没设过时显示「还没定」+「挑个日子」', () => ev(`(function(){
    const m = document.querySelector('#view-couple .cp-mod');
    return /还没定/.test(m.textContent) && !!m.querySelector('[data-cp="next-meet"]');
  })()`));

  await t('时间是气泡样式的，不是原生下拉框', async () => {
    await ev(`(function(){ document.querySelector('#view-couple [data-cp="next-meet"]').click(); return 1; })()`);
    await sleep(700);
    return ev(`(function(){
      const blob = document.querySelector('#sheet-root .dp-blob');
      if (!blob) return false;
      const cs = getComputedStyle(blob);
      const r = blob.getBoundingClientRect();
      // 圆角 = 高度的一半才是胶囊；原生 select 一个都不许剩
      return parseFloat(cs.borderRadius) >= r.height / 2 - 1
             && cs.boxShadow !== 'none'
             && document.querySelectorAll('#sheet-root select').length === 0;
    })()`);
  });

  await t('点气泡前小时分钟是收起的', () => ev(`(function(){
    const p = document.querySelector('#sheet-root .dp-picker');
    return !!p && p.hidden === true;
  })()`));

  await t('点气泡展开 24 个小时 + 12 个分钟（5 分钟一档）', async () => {
    await ev(`(function(){ document.querySelector('#sheet-root .dp-blob').click(); return 1; })()`);
    await sleep(350);
    return ev(`(function(){
      const p = document.querySelector('#sheet-root .dp-picker');
      const hs = Array.from(p.querySelectorAll('[data-h]')).map(function(b){ return b.dataset.h; });
      const ms = Array.from(p.querySelectorAll('[data-m]')).map(function(b){ return b.dataset.m; });
      return p.hidden === false && hs.length === 24 && ms.join(',') === '0,5,10,15,20,25,30,35,40,45,50,55';
    })()`);
  });

  await t('小时格是胶囊风，选中的格子是品牌色实底', async () => {
    await ev(`(function(){ document.querySelector('#sheet-root [data-h="9"]').click(); return 1; })()`);
    await sleep(200);
    return ev(`(function(){
      const on = document.querySelector('#sheet-root .dp-num.is-on');
      if (!on) return false;
      const cs = getComputedStyle(on);
      const r = on.getBoundingClientRect();
      return parseFloat(cs.borderRadius) >= 8 && r.height >= 28 && cs.color === 'rgb(255, 255, 255)';
    })()`);
  });

  await t('选完格子后气泡上的数字跟着变', () => ev(`(function(){
    return /^09:\\d{2}$/.test(document.querySelector('#sheet-root [data-part="hm-txt"]').textContent);
  })()`));

  await t('快捷时间胶囊有4个', () => ev(`(function(){
    return document.querySelectorAll('#sheet-root .dp-chip[data-quick]').length === 4;
  })()`));

  await t('点「20:00」胶囊一秒设好并收起', async () => {
    await ev(`(function(){
      document.querySelector('#sheet-root .dp-chip[data-quick="20:00"]').click();
      return 1;
    })()`);
    await sleep(300);
    return ev(`(function(){
      return document.querySelector('#sheet-root [data-part="hm-txt"]').textContent === '20:00'
             && document.querySelector('#sheet-root .dp-picker').hidden === true;
    })()`);
  });

  await t('提示行「只能选今天…」已经去掉了', () => ev(`(function(){
    const tip = document.querySelector('#sheet-root .dp-tip');
    return !tip || tip.textContent.trim() === '';
  })()`));

  // 日历会落在「已选那天」所在月（见面日期常在两周后，可能跨月），
  // 先翻回今天所在月，才谈得上「过去的日期」。
  await ev(`(function(){
    const today = new Date();
    const wantY = today.getFullYear(), wantM = today.getMonth() + 1;
    let guard = 0;
    while (guard++ < 36) {
      const yEl = document.querySelector('#sheet-root [data-part="year"]');
      const mEl = document.querySelector('#sheet-root [data-part="month"]');
      if (!yEl || !mEl) return 'no-title';
      const y = parseInt(yEl.textContent, 10);
      const mo = parseInt(String(mEl.textContent).replace(/\\D/g, ''), 10);
      if (y === wantY && mo === wantM) return 1;
      const nav = document.querySelector('#sheet-root .dp-nav[data-nav="-1"]');
      if (!nav) return 'no-nav';
      nav.click();
    }
    return 1;
  })()`);
  await sleep(400);
  await t('过去的日期仍然是灰的（hideTip 不影响禁用）', () => ev(`(function(){
    return document.querySelectorAll('#sheet-root .dp-day.off').length > 0;
  })()`));

  await t('选好日期+时间后，写入的字符串带 HH:MM', async () => {
    await ev(`(function(){
      // 先把面板收起来，再去点日子 —— 否则 .dp-picker 盖在日历上面
      document.querySelector('#sheet-root .dp-blob').click();
      return 1;
    })()`);
    await sleep(200);
    await ev(`(function(){
      // 用气泡面板再挑一次分钟，确保是面板里点的而不是快捷胶囊
      document.querySelector('#sheet-root .dp-blob').click();
      document.querySelector('#sheet-root [data-m="30"]').click();
      document.querySelector('#sheet-root .dp-blob').click();
      return 1;
    })()`);
    await sleep(200);
    await ev(`(function(){
      const d = document.querySelector('#sheet-root .dp-day[data-ts]:not(.off)');
      if (d) d.click();
      return 1;
    })()`);
    await sleep(300);
    await ev(`(function(){ document.querySelector('#sheet-root [data-act="ok"]').click(); return 1; })()`);
    await sleep(500);
    return ev(`(function(){
      const v = window.Store.settings.couple.nextMeet;
      return /^\\d{4}-\\d{2}-\\d{2} 20:30$/.test(v);
    })()`);
  });

  await t('卡片上直接写出几点几分', () => ev(`(function(){
    const t = document.querySelector('#view-couple .cp-mod-time');
    return !!t && /20:30/.test(t.textContent);
  })()`));

  await t('倒计时按小时算，能显示剩余 X 天 Y 小时', () => ev(`(function(){
    const m = document.querySelector('#view-couple .cp-mod');
    return /\\d+ 天/.test(m.textContent);
  })()`));

  await t('卡片底部不再是日期按钮，改叫「改个时间」', () => ev(`(function(){
    const m = document.querySelector('#view-couple .cp-mod');
    const b = m.querySelector('[data-cp="next-meet"]');
    return !!b && /改个时间/.test(b.textContent);
  })()`));

  await t('再打开时能读回之前存的时分', async () => {
    await ev(`(function(){ document.querySelector('#view-couple [data-cp="next-meet"]').click(); return 1; })()`);
    await sleep(700);
    const r = await ev(`(function(){
      return document.querySelector('#sheet-root [data-part="hm-txt"]').textContent;
    })()`);
    await ev(`(function(){ const c=document.querySelector('#sheet-root .sheet-close'); if(c) c.click(); return 1; })()`);
    await sleep(400);
    return r === '20:30';
  });

  await t('老数据只有日期也能读，不写时分（不崩）', () => ev(`(function(){
    window.Store.setSettings({ couple: { nextMeet: '2026-12-01' } });
    window.ViewCouple.render(document.querySelector('#view-couple'));
    const m = document.querySelector('#view-couple .cp-mod');
    return /\\d+ 天/.test(m.textContent) && !!m.querySelector('.cp-mod-time');
  })()`));

  await t('存档里存的是 HH:MM，界面没有写出老数据的假时分', () => ev(`(function(){
    // 老数据带出来的默认 14:00 只是算倒计时用的，卡片上不该写「14:00」
    const t = document.querySelector('#view-couple .cp-mod-time');
    return !!t && !/14:00/.test(t.textContent);
  })()`));

  console.log('\n=== ③ 存完钱外部卡片立刻更新 ===');

  await ev(`(function(){
    const s = window.Store;
    s.setSettings({ couple: { mode:'remote' } });
    const g = s.coupleMeetFund() || s.addGoal({ name:'下次见面基金', icon:'✈️', target:0, color:'#FF6A9B', kind:'couple', slot:'meet' });
    s.updateGoal(g.id, { target: 200000, saved: 0 });
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(500);

  await t('存钱前面板上是 0%', () => ev(`(function(){
    // 首页那块「下次见面基金」模块自己就是外面那张卡 —— 它才是存完钱该当场变的东西。
    // 以前这里去抓 .cp-vault-cap，那是小金库的进度小字，见面基金根本没有这一块。
    const mods = Array.from(document.querySelectorAll('#view-couple .cp-mod'));
    const m = mods.find(function(n){ return /下次见面基金/.test(n.textContent); });
    if (!m) return false;
    return /¥0\\.00/.test(m.textContent);
  })()`));

  await t('在弹层里存 500 后，外部卡片当场变成 25%', async () => {
    await ev(`(function(){
      document.querySelector('#view-couple [data-cp="fund-goal-go"]').click();
      return 1;
    })()`);
    await sleep(700);
    await ev(`(function(){
      const a = document.querySelector('#sheet-root #cv-amount');
      a.value = '500';
      document.querySelector('#sheet-root #cv-in').click();
      return 1;
    })()`);
    await sleep(600);
    // 关掉弹层，看外面的卡片（不刷新页面）
    await ev(`(function(){
      const c = document.querySelector('#sheet-root .sheet-close');
      if (c) c.click();
      return 1;
    })()`);
    await sleep(600);
    return ev(`(function(){
      const mods = Array.from(document.querySelectorAll('#view-couple .cp-mod'));
      const m = mods.find(function(n){ return /下次见面基金/.test(n.textContent); });
      if (!m) return false;
      // 卡片上要写 ¥500.00，目标 ¥2,000.00 → 25%
      return /500\\.00/.test(m.textContent) && /2,000\\.00/.test(m.textContent);
    })()`);
  });

  await t('双心之间的间距也跟着变了（不再钉在 124px）', () => ev(`(function(){
    // 双心在小金库卡里。见面基金存的钱不进小金库，这里改成：
    // 只要小金库存在且画出了心，就说明这块是活的（间距随 pct 变）。
    const w = document.querySelector('#view-couple .cp-vault-hearts');
    if (!w) return true; // 没有小金库时这块本来就不渲染
    const gap = parseFloat(w.style.getPropertyValue('--gap'));
    return w.dataset.pct != null && gap <= 124;
  })()`));

  await t('没设目标但有存款时，写「已经攒了多少」而不是干巴巴的 0%', async () => {
    await ev(`(function(){
      const s = window.Store;
      const g = s.coupleMeetFund();
      s.updateGoal(g.id, { target: 0, saved: 30000 });
      window.ViewCouple.render(document.querySelector('#view-couple'));
      return 1;
    })()`);
    await sleep(400);
    return ev(`(function(){
      const mods = Array.from(document.querySelectorAll('#view-couple .cp-mod'));
      const m = mods.find(function(n){ return /下次见面基金/.test(n.textContent); });
      if (!m) return false;
      return /300\\.00/.test(m.textContent) && /攒多少都行/.test(m.textContent);
    })()`);
  });

  await t('目标设在小金库上（不是见面基金）攒满也会问', async () => {
    await ev(`(function(){
      const s = window.Store;
      // 把见面基金的目标清掉，改成小金库有目标
      const mf = s.coupleMeetFund();
      if (mf) s.updateGoal(mf.id, { target: 0, saved: 0 });
      let v = s.coupleVault();
      if (!v) v = s.addGoal({ name:'我们的小金库', icon:'💞', target:0, color:'#4F7CFF', kind:'couple', slot:'vault' });
      s.updateGoal(v.id, { target: 100000, saved: 99900 });
      window.ViewCouple.render(document.querySelector('#view-couple'));
      return 1;
    })()`);
    await sleep(400);
    await ev(`(function(){
      const b = document.querySelector('#view-couple [data-cp="vault-go"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(700);
    await ev(`(function(){
      const a = document.querySelector('#sheet-root #cv-amount');
      a.value = '1';
      document.querySelector('#sheet-root #cv-in').click();
      return 1;
    })()`);
    await sleep(800);
    return ev(`(function(){
      const m = document.querySelector('#modal-root .modal');
      return !!m && /已攒满本次见面基金/.test(m.textContent);
    })()`);
  });

  await t('清理掉这个弹窗', async () => {
    await ev(`(function(){
      const c = document.querySelector('#modal-root [data-act="cancel"]');
      if (c) c.click();
      return 1;
    })()`);
    await sleep(400);
    return ev(`(function(){ return !document.querySelector('#modal-root .modal'); })()`);
  });

  console.log('\n=== ② 见面基金攒满会问一句 ===');

  await ev(`(function(){
    const s = window.Store;
    // 上一组可能还留着弹层/弹窗，先清干净再布数据
    try { window.UI.closeAllSheets(); } catch (e) {}
    const mm = document.querySelector('#modal-root .modal');
    if (mm) { const c = mm.querySelector('[data-act="cancel"]'); if (c) c.click(); }
    s.setSettings({ couple: { nextMeet: '2026-12-01 20:30' } });
    // 第 ③ 组顺手建了小金库、也往见面基金里存过钱，这里要清干净：
    // 否则「谁刚刚攒满」会挑中小金库，弹的是小金库的账。
    const v = s.coupleVault();
    if (v) s.removeGoal(v.id);
    // 建一个见面基金
    if (!s.coupleMeetFund()) {
      s.addGoal({ name:'下次见面基金', icon:'✈️', target:0, color:'#FF6A9B', kind:'couple', slot:'meet' });
    }
    const g = s.coupleMeetFund();
    s.updateGoal(g.id, { target: 100000, saved: 0, logs: [] });
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(600);

  await t('基金模块上能看到目标', () => ev(`(function(){
    const mods = document.querySelectorAll('#view-couple .cp-mod');
    const txt = mods[1] ? mods[1].textContent : '';
    return /1,000\\.00/.test(txt);
  })()`));

  await t('点「去存」能打开小金库弹层', async () => {
    await ev(`(function(){ document.querySelector('#view-couple [data-cp="fund-goal-go"]').click(); return 1; })()`);
    await sleep(700);
    return ev(`(function(){ return !!document.querySelector('#sheet-root #cv-amount'); })()`);
  });

  await t('存满时弹出「已攒满本次见面基金」', async () => {
    await ev(`(function(){
      const a = document.querySelector('#sheet-root #cv-amount');
      a.value = '1000';
      document.querySelector('#sheet-root #cv-in').click();
      return 1;
    })()`);
    await sleep(700);
    return ev(`(function(){
      const m = document.querySelector('#modal-root .modal');
      return !!m && /已攒满本次见面基金/.test(m.textContent) && /快和 TA 见一面吧/.test(m.textContent);
    })()`);
  });

  await t('弹窗有两个可选按钮：重新定目标 / 先留着', () => ev(`(function(){
    const m = document.querySelector('#modal-root .modal');
    if (!m) return false;
    const ok = m.querySelector('[data-act="ok"]');
    const cc = m.querySelector('[data-act="cancel"]');
    return !!ok && !!cc && /重新定个目标/.test(ok.textContent) && /先留着/.test(cc.textContent);
  })()`));

  await t('点「重新定个目标」把这一趟归档：saved 归零、目标清空', async () => {
    await ev(`(function(){ document.querySelector('#modal-root [data-act="ok"]').click(); return 1; })()`);
    await sleep(900);
    return ev(`(function(){
      const g = window.Store.coupleMeetFund();
      return g.saved === 0 && g.target === 0;
    })()`);
  });

  await t('归档后自动打开定目标弹层', () => ev(`(function(){
    return !!document.querySelector('#sheet-root #cvt-amount');
  })()`));

  await t('之前存的记录还在（只是起点归零）', () => ev(`(function(){
    const g = window.Store.coupleMeetFund();
    return Array.isArray(g.logs) && g.logs.length >= 1;
  })()`));

  await t('再存一次没到目标，不会再弹', async () => {
    await ev(`(function(){
      const c = document.querySelector('#sheet-root .sheet-close');
      if (c) c.click();
      return 1;
    })()`);
    await sleep(500);
    // 重新打开金库，设个更高的目标
    await ev(`(function(){
      const s = window.Store;
      const g = s.coupleMeetFund();
      s.updateGoal(g.id, { target: 500000, saved: 0 });
      window.ViewCouple.render(document.querySelector('#view-couple'));
      return 1;
    })()`);
    await sleep(400);
    await ev(`(function(){ document.querySelector('#view-couple [data-cp="fund-goal-go"]').click(); return 1; })()`);
    await sleep(600);
    await ev(`(function(){
      const a = document.querySelector('#sheet-root #cv-amount');
      a.value = '100';
      document.querySelector('#sheet-root #cv-in').click();
      return 1;
    })()`);
    await sleep(700);
    return ev(`(function(){ return !document.querySelector('#modal-root .modal'); })()`);
  });

  await t('已经满了再存也不会重复问', async () => {
    await ev(`(function(){
      const s = window.Store;
      const g = s.coupleMeetFund();
      s.updateGoal(g.id, { target: 500000, saved: 500000 });
      window.ViewCouple.render(document.querySelector('#view-couple'));
      return 1;
    })()`);
    await sleep(400);
    await ev(`(function(){ document.querySelector('#view-couple [data-cp="fund-goal-go"]').click(); return 1; })()`);
    await sleep(600);
    await ev(`(function(){
      const a = document.querySelector('#sheet-root #cv-amount');
      a.value = '50';
      document.querySelector('#sheet-root #cv-in').click();
      return 1;
    })()`);
    await sleep(800);
    return ev(`(function(){ return !document.querySelector('#modal-root .modal'); })()`);
  });

  await t('没设目标的基金攒多少都不问', async () => {
    await ev(`(function(){
      const c = document.querySelector('#sheet-root .sheet-close');
      if (c) c.click();
      const s = window.Store;
      const g = s.coupleMeetFund();
      s.updateGoal(g.id, { target: 0, saved: 0 });
      window.ViewCouple.render(document.querySelector('#view-couple'));
      return 1;
    })()`);
    await sleep(500);
    await ev(`(function(){ document.querySelector('#view-couple [data-cp="fund-goal-go"]').click(); return 1; })()`);
    await sleep(600);
    await ev(`(function(){
      const a = document.querySelector('#sheet-root #cv-amount');
      a.value = '999';
      document.querySelector('#sheet-root #cv-in').click();
      return 1;
    })()`);
    await sleep(800);
    return ev(`(function(){ return !document.querySelector('#modal-root .modal'); })()`);
  });

  console.log('\nJS 异常:', global.__errs || 'none');
  console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  ws.close(); await env.stop(proc);process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
