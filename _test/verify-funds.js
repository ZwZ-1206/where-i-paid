/* 验收：情侣栏的基金入口调整
 *  ① 存钱记录从小金库弹层/目标页搬出来，变成情侣栏独立入口
 *  ② 定目标可以填截止日期（非必填）
 *  ③ 约会基金 / 见面基金默认 ¥0.00，不再显示「没设」「建一个」
 *  ④ 关闭情侣账本不能一下点掉（先看这一轮的交互改造，后续补强）
 */
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9441;
const PROFILE = env.profile('funds');
const URL = process.env.URL || 'http://127.0.0.1:4180/index.html';
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

  let ws = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = list.find((t) => t.type === 'page');
      if (p) { ws = p.webSocketDebuggerUrl; break; }
    } catch (e) {}
    await sleep(250);
  }
  if (!ws) { console.log('连不上 Edge'); await env.stop(edge); process.exit(1); }

  const sock = new WebSocket(ws);
  let id = 0; const pending = new Map(); const errs = [];
  sock.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    }
  });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    sock.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.text + ' ' +
        ((r.result.exceptionDetails.exception || {}).description || ''));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    let ok = false, info = '';
    try { ok = await fn(); } catch (e) { info = ' · ' + e.message; }
    if (ok) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (info || '')); }
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: URL });
  await sleep(2400);

  // 造数据：开通 + 同城 + 建小金库并存入
  await ev(`(function(){
    const S = window.Store;
    S.clearAll();
    S.enableCouple({ meName:'小林', peerName:'阿青', mode:'local',
      togetherSince:'2024-05-20', consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)} });
    window.App.go('couple');
    window.ViewCouple.setPage('home');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(700);

  console.log('\n=== ③ 约会基金默认 0 ===');

  await t('约会基金显示 ¥0.00，不再是「没设」', () => ev(`(function(){
    const mods = Array.from(document.querySelectorAll('#view-couple .cp-mod'));
    const m = mods.find(function(x){ return /约会基金/.test(x.textContent); });
    if (!m) return false;
    return /0\\.00/.test(m.querySelector('.cp-mod-val').textContent)
        && !/没设/.test(m.textContent);
  })()`));

  await t('按钮写「去存」，不是「建一个」', () => ev(`(function(){
    const mods = Array.from(document.querySelectorAll('#view-couple .cp-mod'));
    const m = mods.find(function(x){ return /约会基金/.test(x.textContent); });
    const b = m.querySelector('.link-btn');
    return !!b && b.textContent.trim() === '去存';
  })()`));

  await t('点「去存」直接打开存取面板（不用先建一个）', async () => {
    await ev(`(function(){
      const mods = Array.from(document.querySelectorAll('#view-couple .cp-mod'));
      const m = mods.find(function(x){ return /约会基金/.test(x.textContent); });
      m.querySelector('.link-btn').click();
      return 1;
    })()`);
    await sleep(800);
    return ev(`(function(){
      return !!document.querySelector('#sheet-root #cv-amount')
          && !!window.Store.coupleDateFund();
    })()`);
  });

  await t('面板上半身是 0，还差多少就合上（说明没目标）', () => ev(`(function(){
    const t = document.querySelector('#sheet-root .cp-vault-cap') ||
              document.querySelector('#sheet-root .cv-hero');
    return !!t;
  })()`));

  await t('关掉面板', async () => {
    await ev(`(function(){ const c=document.querySelector('#sheet-root .sheet-close'); if(c) c.click(); return 1; })()`);
    await sleep(400);
    return true;
  });

  console.log('\n=== ② 定目标能填截止日期 ===');

  await ev(`(function(){
    const S = window.Store;
    // 第 ① 组可能已经把约会基金删掉或改了 slot，这里确认它在，不在就补一个
    let g = S.coupleDateFund();
    if (!g) {
      g = S.addGoal({ name: '约会基金', icon: '🎟️', target: 0, color: '#FF6A9B', kind: 'couple', slot: 'date' });
    } else if (g.slot !== 'date') {
      S.updateGoal(g.id, { slot: 'date' });
      g = S.coupleDateFund();
    }
    S.depositGoal(S.coupleDateFund().id, 20000, '第一次');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(500);

  // 这里点的是「约会基金」那块卡上的去存 —— 两块的 data-cp 一样，
  // 首页上先出现的是小金库，所以要按文字挑出约会基金那一块。
  await t('点目标那一行能开定目标面板', async () => {
    const opened = await ev(`(function(){
      const mods = Array.from(document.querySelectorAll('#view-couple .cp-mod'));
      const mod = mods.find(function(m){ return /约会基金/.test(m.textContent); })
               || document.querySelector('#view-couple');
      const b = mod.querySelector('[data-cp="date-goal"]') || mod.querySelector('[data-cp="date-goal-go"]');
      if (!b) return 'no-btn';
      b.click();
      return 'ok';
    })()`);
    if (opened !== 'ok') { console.log('    [dbg] 找不到约会基金按钮'); return false; }
    await sleep(700);
    await ev(`(function(){
      const row = document.querySelector('#sheet-root [data-cv="target"]');
      if (row) row.click();
      return 1;
    })()`);
    await sleep(700);
    return ev(`(function(){ return !!document.querySelector('#sheet-root #cvt-amount'); })()`);
  });

  await t('面板里有「截止日期 可不填」和选日子按钮', () => ev(`(function(){
    const dl = document.querySelector('#sheet-root .cv-dl');
    if (!dl) return false;
    return /截止日期/.test(dl.textContent) && /可不填/.test(dl.textContent)
        && !!dl.querySelector('[data-cvdl="pick"]');
  })()`));

  await t('没选日期时按钮写「选个日子」', () => ev(`(function(){
    const t = document.querySelector('#sheet-root [data-cvdl="txt"]');
    return t.textContent.trim() === '选个日子';
  })()`));

  await t('点按钮弹出日期选择器，且只能选明天以后', async () => {
    await ev(`(function(){
      document.querySelector('#sheet-root [data-cvdl="pick"]').click();
      return 1;
    })()`);
    await sleep(800);
    // 日期面板默认落在「传进来的那个日子」所在的月（这里是 90 天后），
    // 所以这个月里不会有今天，也就不会有灰格子。要验的是「今天真的选不了」：
    // 翻到今天的月份再看。
    const res = await ev(`(function(){
      const sheet = document.querySelector('#sheet-root');
      const head = sheet.querySelector('.dp-head');
      if (!head) return 'no-dp';
      const root = head.parentNode;
      const min = Number(root.getAttribute('data-dp-min'));
      const today = Number(root.getAttribute('data-dp-today'));
      const view = root.getAttribute('data-dp-view');
      return JSON.stringify({ min: min, today: today, view: view });
    })()`);
    const info = JSON.parse(res);
    if (info.min !== info.today + 86400000) return false;
    // 翻回今天所在月
    // m03610：dp-nav 是「按年翻页」的（view + d*12），点一下直接跳 12 个月，
    // 而且第一次点击后年份守卫会把后续点击全吞掉 —— 翻不动。
    // 日视图下这对箭头本来就是 visibility:hidden、用户点不到。
    // 真实交互是：点标题 → 月份网格 → 点这个月 → 落到日视图。
    // 还要先退回今天的年份：月份网格跟着 view 的年份走，
    // 在 2027 的月份网格里点是点不到 2026年10月 的。
    await (async () => {
      const sheet = await ev(`(function(){
        return document.querySelector('#sheet-root') ? 1 : 0;
      })()`);
      if (!sheet) return;
      const curYear = await ev(`(function(){
        const root = document.querySelector('#sheet-root .dp-head').parentNode;
        return Number(String(root.getAttribute('data-dp-view')).split('-')[0]);
      })()`);
      const todayYear = await ev(`(function(){
        const root = document.querySelector('#sheet-root .dp-head').parentNode;
        return new Date(Number(root.getAttribute('data-dp-today'))).getFullYear();
      })()`);
      if (curYear !== todayYear) {
        // 点标题进年份视图，再点今天的年份
        await ev(`(function(){
          const root = document.querySelector('#sheet-root .dp-head').parentNode;
          for (let i = 0; i < 3; i++) {
            const title = document.querySelector('#sheet-root [data-part="title"]');
            if (!title) return 0;
            const cells = document.querySelectorAll('#sheet-root [data-year]');
            if (cells.length) return 1;
            title.click();
          }
          return 0;
        })()`);
        await sleep(300);
        await ev(`(function(){
          const y = new Date(Number(document.querySelector('#sheet-root .dp-head')
            .parentNode.getAttribute('data-dp-today'))).getFullYear();
          const cell = document.querySelector('#sheet-root [data-year="' + y + '"]');
          if (cell && !cell.classList.contains('off')) cell.click();
          return 1;
        })()`);
        await sleep(400);
      }
      // 进月份视图点今天所在的月
      const clickMonth = await ev(`(function(){
        const root = document.querySelector('#sheet-root .dp-head').parentNode;
        const tm = new Date(Number(root.getAttribute('data-dp-today'))).getMonth();
        for (let i = 0; i < 3; i++) {
          const cells = document.querySelectorAll('#sheet-root [data-month]');
          if (cells.length) break;
          const title = document.querySelector('#sheet-root [data-part="title"]');
          if (!title) return 0;
          title.click();
        }
        const cell = document.querySelector('#sheet-root [data-month="' + tm + '"]');
        if (!cell || cell.classList.contains('off')) return 0;
        cell.click();
        return 1;
      })()`);
      return clickMonth;
    })();
    await sleep(400);
    return ev(`(function(){
      const body = document.querySelector('#sheet-root');
      const off = body.querySelectorAll('.dp-day.off').length;
      const today = body.querySelector('.dp-day.today');
      const clickable = body.querySelectorAll('.dp-day[data-ts]:not(.off)').length;
      return off > 0 && (!today || today.classList.contains('off')) && clickable > 0;
    })()`);
  });

  await t('挑一个可选日子后，按钮上写出日期', async () => {
    await ev(`(function(){
      const d = document.querySelector('#sheet-root .dp-day[data-ts]:not(.off)');
      d.click();
      document.querySelector('#sheet-root [data-act="ok"]').click();
      return 1;
    })()`);
    await sleep(700);
    return ev(`(function(){
      const t = document.querySelector('#sheet-root [data-cvdl="txt"]');
      return /\\d{4}年\\d{1,2}月\\d{1,2}日/.test(t.textContent);
    })()`);
  });

  await t('填了金额 + 日期后，提示会算出「每天存多少」', async () => {
    await ev(`(function(){
      const inp = document.querySelector('#sheet-root #cvt-amount');
      inp.value = '3000';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`);
    await sleep(300);
    return ev(`(function(){
      const h = document.querySelector('#sheet-root [data-cvdl="hint"]');
      return /还有 \\d+ 天/.test(h.textContent) && /每天存/.test(h.textContent);
    })()`);
  });

  // 日期选择器关掉之后，保存按钮在「定目标」这一层弹层的底部。
  // 两层 sheet 叠着（下面是小金库），所以要取最上面那一层。
  const topSheet = () => ev(`(function(){
    const list = Array.from(document.querySelectorAll('#sheet-root .sheet'));
    return list.length ? list[list.length - 1].querySelector('.sheet-foot .btn') ? 'ok' : 'no-foot' : 'none';
  })()`);

  await t('日期选择器关掉后回到定目标面板，保存按钮在上面那层', async () => {
    const where = await topSheet();
    return where === 'ok';
  });

  await t('保存后 target 和 deadline 都落库', async () => {
    await ev(`(function(){
      const list = Array.from(document.querySelectorAll('#sheet-root .sheet'));
      const top = list[list.length - 1];
      const btns = Array.from(top.querySelectorAll('.sheet-foot .btn'));
      const save = btns.find(function(b){ return /保存目标/.test(b.textContent); });
      save.click();
      return 1;
    })()`);
    await sleep(700);
    return ev(`(function(){
      const g = window.Store.coupleDateFund();
      return g.target === 300000 && /^\\d{4}-\\d{2}-\\d{2}$/.test(g.deadline || '');
    })()`);
  });

  await t('填了目标后，存取面板上写出「还差多少」', () => ev(`(function(){
    const row = document.querySelector('#sheet-root .cv-target-row');
    return !!row && /还差/.test(row.textContent) && /3,000\\.00/.test(row.textContent);
  })()`));

  await t('不填日期也能保存（deadline 清空，不算错）', async () => {
    await ev(`(function(){
      const row = document.querySelector('#sheet-root .cv-target-row');
      if (row) row.click();
      return 1;
    })()`);
    await sleep(700);
    await ev(`(function(){
      const list = Array.from(document.querySelectorAll('#sheet-root .sheet'));
      const top = list[list.length - 1];
      const inp = top.querySelector('#cvt-amount');
      inp.value = '1500';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const btns = Array.from(top.querySelectorAll('.sheet-foot .btn'));
      btns.find(function(b){ return /保存目标/.test(b.textContent); }).click();
      return 1;
    })()`);
    await sleep(700);
    return ev(`(function(){
      const g = window.Store.coupleDateFund();
      return g.target === 150000;
    })()`);
  });

  await t('清干净，回到首页', async () => {
    await ev(`(function(){
      document.querySelectorAll('#sheet-root .sheet-close').forEach(function(c){ c.click(); });
      return 1;
    })()`);
    await sleep(500);
    return true;
  });

  console.log('\n=== ① 「存钱的证据」已并进日历（用户要求删除）===');

  await t('情侣首页不再有「我们存钱的证据」入口', () => ev(`(function(){
    const v = document.querySelector('#view-couple');
    return !v.querySelector('[data-cp="to-logs"]') && v.textContent.indexOf('我们存钱的证据') < 0;
  })()`));

  await t('日历里能看到那一天存过钱（❤️ 标记）', async () => {
    // 存钱的痕迹不是消失了，而是挂到了日历的那一天上 ——
    // 用户的原话：「如果回忆小票墙按要求做好了 完全可以替代这个功能」
    await ev(`(function(){
      const v = document.querySelector('#view-couple');
      window.ViewCouple.setPage('memories');
      window.ViewCouple.render(v);
      return 1;
    })()`);
    await sleep(500);
    return ev(`(function(){
      const v = document.querySelector('#view-couple');
      return !!v.querySelector('.cp-cal-grid') && v.querySelectorAll('.cp-cal-heart').length > 0;
    })()`);
  });

  await t('点那一天能看到「我们一起存了」两条流水', async () => {
    const r = await ev(`(function(){
      const v = document.querySelector('#view-couple');
      const c = v.querySelector('.cp-cal-cell.has');
      if (c) c.click();
      return !!c;
    })()`);
    await sleep(450);
    return ev(`(function(){
      const v = document.querySelector('#view-couple');
      const rows = v.querySelectorAll('.cp-brief-row--dep');
      return rows.length > 0 && /我们一起存了/.test(v.querySelector('.cp-cal-brief').textContent);
    })()`);
  });

  await t('日历上放的是图标不是金额（不是催款单）', () => ev(`(function(){
    const cells = document.querySelectorAll('#view-couple .cp-cal-cell');
    for (let i = 0; i < cells.length; i++) {
      if (/¥/.test(cells[i].textContent)) return false;
    }
    return true;
  })()`));

  await t('返回按钮回到首页', async () => {
    await ev(`(function(){
      document.querySelector('#view-couple [data-cp="sub-back"]').click();
      return 1;
    })()`);
    await sleep(500);
    return ev(`(function(){ return window.ViewCouple.page === 'home'; })()`);
  });

  await t('「目标」页不再列出情侣基金', async () => {
    await ev(`(function(){ window.App.go('goals'); return 1; })()`);
    await sleep(600);
    return ev(`(function(){
      const cards = Array.from(document.querySelectorAll('#view-goals .goal-card'));
      return !cards.some(function(c){ return /我们的|小金库|约会基金/.test(c.textContent); });
    })()`);
  });

  // 用户明确要求删掉的：「目标」页里那块「两个人的钱在「情侣」栏 / 去情侣页看看」。
  // 理由是有对象的人自然会去情侣页，没对象的看到这句反而莫名其妙。
  await t('「目标」页不再有「去情侣页看看」这块路标', () => ev(`(function(){
    const v = document.querySelector('#view-goals');
    if (!v) return false;
    return !v.querySelector('[data-act="to-couple"]')
      && v.textContent.indexOf('去情侣页看看') < 0
      && v.textContent.indexOf('两个人的钱在') < 0;
  })()`));

  await t('「目标」页里也不再出现「情侣」两个字', () => ev(`(function(){
    const v = document.querySelector('#view-goals');
    return !!v && v.textContent.indexOf('情侣') < 0;
  })()`));

  console.log('\nJS 异常: ' + (errs.length ? errs.join('\n') : 'none'));
  console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  sock.close(); await env.stop(edge); await sleep(400);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
