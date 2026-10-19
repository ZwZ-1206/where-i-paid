/* 验收：攒钱目标的「目标日期」只能选今天之后
 *
 * 背景（真机反馈）：设目标时点开日期选择器，只有今天和过去能点，
 * 明天以后全是灰的 —— 目标日期挑不到未来，等于这个字段废了。
 *
 * 根因：view-goals 调 UI.datePicker 时没传 min/max，而 datePicker 的默认
 * max 是「明天 0 点」，整块日历就只剩今天可选。
 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9451;
const PROFILE = env.profile('goal-date');
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
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--window-size=390,844', URL,
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
  await sleep(2600);

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };

  // 页面脚本是逐个 <script> 加载的，偶尔 2.6 秒还没跑完（这台机器上会抖）。
  // 等到 U / Store / App 三个全局都就位再开始，别用固定 sleep 赌。
  for (let i = 0; i < 30; i++) {
    const ok = await ev('!!(window.U && window.Store && window.App)');
    if (ok) break;
    await sleep(200);
  }
  const click = async (sel, wait) => {
    const ok = await ev(`(function(){ const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true; })()`);
    if (!ok) throw new Error('点不到 ' + sel);
    await sleep(wait == null ? 450 : wait);
    return true;
  };

  // 基准时间：全部在页面里算，避免 Node 与浏览器时区不一致
  const times = await ev(`(function(){
    const t0 = window.U.startOfDay(new Date()).getTime();
    return { today: t0, tomorrow: t0 + 86400000, yesterday: t0 - 86400000 };
  })()`);

  console.log('\n=== 1. 新建目标：日期选择器只放行今天之后 ===');
  await ev(`(function(){
    window.Store.clearAll();
    window.App.go('goals');
    return 1;
  })()`);
  await sleep(600);
  await click('#view-goals [data-act="new"]', 500);

  await t('新建目标面板里有「目标日期」按钮', () => ev(`!!document.querySelector('#g-deadline')`));
  await click('#g-deadline', 600);

  // 默认值在 180 天后，日历打开时停在那个月。要验「今天那格是灰的」，
  // 得先翻回本月：点年 → 选当年 → 选当月（日历自己的三段式）。
  const ym = await ev(`(function(){
    const d = new Date(${times.tomorrow});
    return { y: d.getFullYear(), m: d.getMonth() };
  })()`);
  await click('[data-part="year"]', 350);
  await click('[data-year="' + ym.y + '"]', 350);
  await click('[data-month="' + ym.m + '"]', 350);

  await t('日期选择器的最小可选日是明天', async () => {
    const min = await ev(`document.querySelector('[data-dp-min]').getAttribute('data-dp-min')`);
    return Number(min) === times.tomorrow;
  });
  await t('今天那格是灰的、点不动（.off + pointer-events:none）', () => ev(`(function(){
    const c = document.querySelector('.dp-day[data-ts="${times.today}"]');
    if (!c) return false;
    return c.classList.contains('off') && getComputedStyle(c).pointerEvents === 'none';
  })()`));
  await t('昨天那格也是灰的', () => ev(`(function(){
    const c = document.querySelector('.dp-day[data-ts="${times.yesterday}"]');
    return !!c && c.classList.contains('off');
  })()`));
  await t('明天那格可以点（不再全灰）', () => ev(`(function(){
    const c = document.querySelector('.dp-day[data-ts="${times.tomorrow}"]');
    return !!c && !c.classList.contains('off');
  })()`));
  await t('提示行说清「只能选今天以后」', () => ev(`(function(){
    const tip = document.querySelector('.dp-tip');
    return !!tip && tip.textContent.indexOf('今天') >= 0 && tip.textContent.indexOf('以后') >= 0;
  })()`));

  console.log('\n=== 2. 选明天 → 落库 ===');
  await ev(`(function(){
    document.querySelector('.dp-day[data-ts="${times.tomorrow}"]').click();
    return 1;
  })()`);
  await sleep(300);
  await click('[data-act="ok"]', 600);
  await t('选完回到面板，按钮上写的是明天', () => ev(`(function(){
    const txt = document.querySelector('#g-deadline span').textContent.trim();
    const d = new Date(${times.tomorrow});
    return txt === d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  })()`));

  await ev(`(function(){
    const n = document.querySelector('#g-name');
    n.value = '测试目标'; n.dispatchEvent(new Event('input', { bubbles: true }));
    const a = document.querySelector('#g-target');
    a.value = '1000'; a.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
  await click('[data-act="save"]', 800);
  await t('保存后 deadline 就是明天', async () => {
    const want = await ev(`window.U.ymd(new Date(${times.tomorrow}))`);
    const got = await ev(`((window.Store.state.goals || []).filter(function(g){return g.name==="测试目标";})[0] || {}).deadline`);
    return got === want;
  });

  console.log('\n=== 3. 编辑一个「日期已过期」的旧目标 ===');
  const oldId = await ev(`(function(){
    const g = window.Store.addGoal({ name: '旧目标', target: 100000, deadline: '2020-01-01' });
    window.App.refresh();
    return g.id;
  })()`);
  await sleep(700);

  await t('旧目标确实存的是过去的日期（前置条件）', async () => {
    const d = await ev(`window.Store.state.goals.filter(function(g){return g.id===${JSON.stringify(oldId)};})[0].deadline`);
    return d === '2020-01-01';
  });

  await click(`#view-goals [data-goal="${oldId}"] [data-act="more"]`, 500);
  await click('#sheet-root [data-act="edit"]', 600);
  await t('编辑面板打开时带着旧的日期', () => ev(`document.querySelector('#g-deadline span').textContent.indexOf('2020') >= 0`));

  await click('#g-deadline', 600);
  await t('打开日历时不会停在过去的日期上（选中值不早于明天）', async () => {
    const sel = await ev(`Number(document.querySelector('[data-dp-sel]').getAttribute('data-dp-sel'))`);
    return sel >= times.tomorrow;
  });
  // 关掉而不点「确定」：点确定会把默认的未来日期真的选上，那就测不到「提交时拦」了
  await click('#sheet-root .sheet:last-of-type .sheet-close', 500);
  // 关掉日历后直接保存：cur.deadline 还是 2020-01-01，必须被拦下来
  await click('[data-act="save"]', 700);
  await t('保存被拦：提示「要选今天之后的」', () => ev(`(function(){
    const toasts = Array.from(document.querySelectorAll('#toast-host .toast'));
    return toasts.some(function(x){ return x.textContent.indexOf('今天之后') >= 0; });
  })()`));
  await t('被拦之后数据没被改（还是 2020-01-01）', async () => {
    const d = await ev(`window.Store.state.goals.filter(function(g){return g.id===${JSON.stringify(oldId)};})[0].deadline`);
    return d === '2020-01-01';
  });

  console.log('\n=== 4. 无 JS 异常 ===');
  await t('整个过程没有未捕获异常', () => jsErrors.length === 0);
  if (jsErrors.length) console.log('    ' + jsErrors.slice(0, 3).join('\n    '));

  console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  env.stop(proc);
  await sleep(300);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  console.log('通过 ' + pass + ' / ' + (pass + fail + 1));
  process.exit(1);
});
