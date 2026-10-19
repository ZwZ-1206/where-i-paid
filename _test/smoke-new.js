const env = require('./_env');
/* 新功能冒烟检查：控制台错误 + 关键 DOM 是否渲染 */
const PORT = 9381;
const PROFILE = env.profile('smoke');
const fs = require('fs');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';

function rm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  rm(PROFILE);
  const proc = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=390,844', URL,
  ], { stdio: 'ignore', detached: false });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { ver = await r.json(); break; }
    } catch (e) {}
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

  const WebSocket = global.WebSocket;
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params: params || {}, sessionId }));
  });

  const targets = await send('Target.getTargets');
  const page = targets.targetInfos.find((t) => t.type === 'page' && !/devtools/.test(t.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  await S('Runtime.enable');
  await S('Page.enable');
  await S('Log.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: URL });
  await sleep(2600);

  const evalJs = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || ''));
  console.log('JS exceptions:', errs.length ? errs : 'none');

  const mods = await evalJs(`JSON.stringify({
    Store: !!window.Store, Extras: !!window.Extras, Remind: !!window.Remind,
    Settings: !!window.ViewSettings, Report: !!window.ViewReport
  })`);
  console.log('modules:', mods);

  const api = await evalJs(`(function(){
    const S = window.Store;
    try {
      const q = S.todayQuota();
      const adv = S.advanceSummary();
      const subs = S.scanSubscriptions();
      const mb = S.mergedBoard();
      const q2 = S.quotaAfter(5000);
      return JSON.stringify({
        quota: q && typeof q.left === 'number',
        quotaAfter: typeof q2 === 'number',
        advSummary: !!adv && typeof adv.openCount === 'number',
        subsCount: subs.length,
        mergedRows: mb.rows.length,
        cur: S.currencyOf('USD').symbol,
        wishes: Array.isArray(S.wishlist()),
        recon: Array.isArray(S.reconList()),
        extras: !!window.Extras.forMoney(123400, 'food')
      });
    } catch (e) { return 'ERR ' + e.message; }
  })()`);
  console.log('api:', api);

  const addDom = await evalJs(`(function(){
    const v = document.querySelector('.view[data-view="add"]');
    return JSON.stringify({
      quota: !!v.querySelector('.quota-bar'),
      lastPrice: !!v.querySelector('.last-price'),
      advToggle: !!v.querySelector('.adv-toggle'),
      wishEntry: !!v.querySelector('.wish-entry'),
      quotaText: (v.querySelector('.quota-line1')||{}).textContent || ''
    });
  })()`);
  console.log('add view:', addDom);

  await evalJs(`App.go('detail')`);
  await sleep(600);
  const detDom = await evalJs(`(function(){
    const v = document.querySelector('.view[data-view="detail"]');
    return JSON.stringify({ advCard: !!v.querySelector('.adv-card'), search: !!v.querySelector('#kw') });
  })()`);
  console.log('detail view:', detDom);

  await evalJs(`App.go('report')`);
  await sleep(700);
  const repDom = await evalJs(`(function(){
    const v = document.querySelector('.view[data-view="report"]');
    return JSON.stringify({ equiv: !!v.querySelector('.equiv-card'), merged: !!v.querySelector('.merged-card'), tabs: v.querySelectorAll('.seg-tab').length });
  })()`);
  console.log('report view:', repDom);

  await evalJs(`App.go('settings')`);
  await sleep(600);
  const setDom = await evalJs(`(function(){
    const v = document.querySelector('.view[data-view="settings"]');
    return JSON.stringify({
      currency: !!v.querySelector('[data-act="currency"]'),
      autoSave: !!v.querySelector('[data-act="autoSave"]'),
      subs: !!v.querySelector('[data-act="subs"]'),
      advances: !!v.querySelector('[data-act="advances"]'),
      wishlist: !!v.querySelector('[data-act="wishlist"]'),
      recon: !!v.querySelector('[data-act="recon"]'),
      bell: !!document.querySelector('.tb-bell')
    });
  })()`);
  console.log('settings view:', setDom);

  const errs2 = events.filter((e) => e.method === 'Runtime.exceptionThrown');
  console.log('JS exceptions after nav:', errs2.length ? errs2.map((e) => e.params.exceptionDetails.text) : 'none');

  ws.close();
  await env.stop(proc);
  console.log('done');
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
