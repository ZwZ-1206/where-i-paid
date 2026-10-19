/* 离线可用性本地验证：localhost 属于安全上下文，Service Worker 可以直接跑，无需 HTTPS 隧道 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9391;
const BASE = 'http://127.0.0.1:4173/index.html';
const PROFILE = env.profile('offline-local');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const rec = (ok, name, msg) => results.push({ ok, name, msg });

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
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  const t = async (name, fn) => {
    try { await fn(); rec(true, name); } catch (e) { rec(false, name, e && e.message); }
  };
  const ok = (v, label) => { if (!v) throw new Error(label || '断言失败'); };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(2800);

  await t('Service Worker 已注册并激活', async () => {
    const state = await ev(`(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.active ? reg.active.state : 'none';
    })()`);
    ok(state === 'activated', 'SW 状态：' + state);
  });

  // 版本号每次发版都会变，所以从 sw.js 里读出来比对，而不是写死
  await t('缓存名与 sw.js 的 CACHE 一致', async () => {
    const want = await ev(`(async () => {
      const r = await fetch('/sw.js', { cache: 'no-store' });
      const m = /CACHE\\s*=\\s*'([^']+)'/.exec(await r.text());
      return m ? m[1] : 'none';
    })()`);
    const keys = await ev(`caches.keys()`);
    ok(want !== 'none' && keys.indexOf(want) >= 0, '期望 ' + want + '，实际缓存：' + JSON.stringify(keys));
  });

  await t('新模块 extras.js / remind.js / view-couple.js 已进缓存', async () => {
    const r = await ev(`(async () => {
      const out = {};
      for (const k of ['extras.js', 'remind.js', 'store.js', 'view-couple.js', 'view-settings.js']) {
        out[k] = !!(await caches.match(new URL('./assets/js/' + k, location.href).href, { ignoreSearch: true }));
      }
      return JSON.stringify(out);
    })()`);
    const o = JSON.parse(r);
    Object.keys(o).forEach((k) => ok(o[k], k + ' 未缓存'));
  });

  // 造一点数据，确保离线后能验证功能仍在
  await ev(`(function(){
    const S = window.Store;
    S.setSettings({ budget: { amount: 300000, split: {} }, theme: 'light' });
    S.addTx({ type:'expense', amount: 2580, catId:'food', ts: Date.now() - 86400000 });
    S.addTx({ type:'expense', amount: 1200, catId:'food', ts: Date.now() });
    return 1;
  })()`);
  await sleep(500);

  // 真断网
  await send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await sleep(300);

  await t('断网后重新加载，页面仍能渲染', async () => {
    await send('Page.reload', { ignoreCache: false });
    await sleep(3000);
    ok(await ev(`!!document.querySelector('.tabbar')`), '底部导航没渲染');
    ok(await ev(`!!document.querySelector('.view')`), '视图没渲染');
  });

  await t('断网后数据还在', async () => {
    const n = await ev(`window.Store.state.tx.length`);
    ok(n >= 2, '账目数：' + n);
  });

  await t('断网后新功能仍可用（额度条 / 铃铛 / 模块）', async () => {
    ok(await ev(`!!window.Extras && !!window.Remind`), '模块未加载');
    ok(await ev(`!!document.querySelector('.tb-bell')`), '没有提醒铃铛');
    await ev(`App.go('add')`);
    await sleep(700);
    ok(await ev(`!!document.querySelector('.view[data-view="add"] .quota-bar')`), '没有额度条');
  });

  await t('断网后还能继续记账', async () => {
    const r = await ev(`(function(){
      const S = window.Store;
      const before = S.state.tx.length;
      S.addTx({ type:'expense', amount: 500, catId:'food', ts: Date.now(), note: '离线记一笔' });
      return S.state.tx.length - before;
    })()`);
    ok(r === 1, '新增笔数：' + r);
  });

  await t('断网后总结页的等价物 / 合并看板仍在', async () => {
    await ev(`App.go('report')`);
    await sleep(900);
    ok(await ev(`!!document.querySelector('.view[data-view="report"] .equiv-card')`), '没有等价物卡');
  });

  console.log('\n===== 离线可用性（本地 localhost）=====');
  let pass = 0, fail = 0;
  results.forEach((r) => {
    if (r.ok) { pass++; console.log(`  ✅ ${r.name}`); }
    else { fail++; console.log(`  ❌ ${r.name}\n       ${r.msg}`); }
  });
  console.log(`\n通过 ${pass} / ${pass + fail}`);

  ws.close(); await env.stop(proc);
  await sleep(300);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('离线验证运行失败:', e); process.exit(1); });
