/* Safari 白屏回归：Response served by service worker has redirections
 *
 * 背景（线上事故）：iPhone Safari 打开 where-i-paid.pages.dev/app（漏结尾斜杠）白屏，
 * 报 "Response served by service worker has redirections"。
 * 根因：Cloudflare Pages 对 /app 返回 308 → /app/，Service Worker 拦截导航后
 * fetch 自动跟随重定向，拿回 redirected:true 的响应；Safari 拒绝把这种响应交给页面，
 * 直接整页报错（Chrome 只是警告）。且该响应一旦被 caches.put 存下，以后每次缓存命中都炸。
 * 修复：sw.js 用原文重建 status 200 的普通响应后再返回/入缓存。
 *
 * 本测试在本地复刻该场景：
 *   4174 端口是个代理，访问 /app 返回 308 → /app/（模仿 Pages），其余转发给 4173 的 server.js。
 *   先打开 /index.html 让 SW 注册激活，再导航到 /app（会触发 308），
 *   断言：页面正常渲染、地址栏停在 /app、缓存里的 index.html 是干净的 200（redirected=false）、
 *         控制台没有 redirections 报错、再刷一次仍然好（覆盖「缓存被毒化」路径）。
 */
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const env = require('./_env');

let appPort = 0;   // 动态找空闲端口，避免撞上别人占用的 4173
let proxyPort = 0;
let cdpPort = 0;
const APP = () => 'http://127.0.0.1:' + proxyPort + '/index.html';
const REDIR = () => 'http://127.0.0.1:' + proxyPort + '/app'; // 会被 308 到 /app/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (ok, name, msg) => results.push({ ok, name, msg });

function freePort() {
  return new Promise((res) => {
    const s = http.createServer();
    s.once('error', () => res(0));
    s.once('listening', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.listen(0, '127.0.0.1');
  });
}

function portOpen(port) {
  return new Promise((res) => {
    const s = http.createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function waitPort(port, tries) {
  for (let i = 0; i < (tries || 50); i++) {
    if (await portOpen(port)) return true;
    await sleep(150);
  }
  return false;
}

(async () => {
  // ---- 起后端 server.js（动态端口，避免撞上占用） ----
  appPort = await freePort();
  proxyPort = await freePort();
  cdpPort = await freePort();
  if (!appPort || !proxyPort || !cdpPort) {
    console.error('✗ 找不到空闲端口');
    process.exit(1);
  }
  const appSrv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(appPort) }),
    stdio: 'ignore',
  });
  if (!(await waitPort(appPort))) {
    console.error('✗ server.js 起不来');
    appSrv.kill();
    process.exit(1);
  }
  // 探活：确认后端真的是本项目（历史上 4173 被别的服务占过，502 坑过一次）
  // server.js listen 之后还要初始化一会，重试几次再下结论
  let healthy = false;
  for (let i = 0; i < 10 && !healthy; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + appPort + '/index.html');
      const body = await r.text();
      if (r.status === 200 && body.indexOf('assets/js/app.js') >= 0) healthy = true;
    } catch (e) { /* 还没起来，再等 */ }
    if (!healthy) await sleep(400);
  }
  if (!healthy) {
    console.error('✗ 后端探活失败：server.js 没有正常伺服本项目页面');
    appSrv.kill();
    process.exit(1);
  }

  // ---- 起 308 代理：/app → /app/，/app/* → /* ----
  const proxy = http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url, 'http://127.0.0.1'); } catch (e) { res.writeHead(400); res.end(); return; }
    if (u.pathname === '/app') {
      res.writeHead(308, { location: '/app/' }); // 和 Cloudflare Pages 一模一样
      res.end();
      return;
    }
    const stripped = u.pathname.startsWith('/app/') ? u.pathname.slice(4) : u.pathname;
    const pr = http.request({
      host: '127.0.0.1', port: appPort, path: stripped + u.search,
      method: req.method, headers: req.headers,
    }, (pres) => { res.writeHead(pres.statusCode, pres.headers); pres.pipe(res); });
    pr.on('error', () => { try { res.writeHead(502); res.end(); } catch (e) {} });
    req.pipe(pr);
  });
  await new Promise((r) => proxy.listen(proxyPort, '127.0.0.1', r));

  // ---- 起浏览器 ----
  const proc = env.launch('verify-sw-redirect', cdpPort, 'about:blank');

  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + cdpPort + '/json/list');
      if (r.ok) {
        const list = await r.json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      }
    } catch (e) {}
    await sleep(250);
  }
  if (!target) {
    console.error('✗ CDP 未就绪');
    env.stop(proc); if (appSrv) appSrv.kill(); proxy.close();
    process.exit(1);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      const text = (m.params.args || []).map((a) => a.value || a.description || '').join(' ');
      consoleErrors.push(m.params.type + ': ' + text);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      consoleErrors.push('exception: ' + (d.exception && d.exception.description || d.text || ''));
    }
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

  try {
    // 先正常打开一次，让 SW 注册并激活
    await send('Page.navigate', { url: APP() });
    await sleep(3000);

    await t('Service Worker 已注册并激活', async () => {
      const state = await ev(`(async () => { const reg = await navigator.serviceWorker.ready; return reg.active ? reg.active.state : 'none'; })()`);
      ok(state === 'activated', 'SW 状态：' + state);
    });

    // 关键一步：导航到会 308 的 /app（无结尾斜杠）
    await send('Page.navigate', { url: REDIR() });
    await sleep(3500);

    await t('访问 /app（被 308 到 /app/）页面正常渲染', async () => {
      ok(await ev(`!!document.querySelector('.tabbar')`), '底部导航没渲染');
      ok(await ev(`location.pathname === '/app'`), '地址栏不对：' + await ev('location.pathname'));
    });

    await t('缓存里的 index.html 是干净 200（无重定向痕迹）', async () => {
      const info = await ev(`(async () => {
        const r = await caches.match('/index.html');
        if (!r) return 'miss';
        return JSON.stringify({ status: r.status, redirected: r.redirected, type: r.type });
      })()`);
      ok(info !== 'miss', 'index.html 没进缓存');
      const o = JSON.parse(info);
      ok(o.status === 200, 'status = ' + o.status);
      ok(o.redirected === false, 'redirected = ' + o.redirected + '（缓存被重定向响应毒化）');
    });

    await t('控制台没有 redirections 报错', async () => {
      const bad = consoleErrors.filter((s) => /redirections/i.test(s));
      ok(bad.length === 0, bad.join(' | ') || '');
    });

    // 再刷一次：走「从缓存取」的路径，验证毒化已清
    await send('Page.navigate', { url: REDIR() });
    await sleep(3000);

    await t('再次访问 /app（命中缓存）仍然正常', async () => {
      ok(await ev(`!!document.querySelector('.tabbar')`), '底部导航没渲染');
    });

    await t('缓存里的 index.html 依然是干净 200', async () => {
      const info = await ev(`(async () => {
        const r = await caches.match('/index.html');
        if (!r) return 'miss';
        return JSON.stringify({ status: r.status, redirected: r.redirected });
      })()`);
      const o = JSON.parse(info);
      ok(o.status === 200 && o.redirected === false, info);
    });
  } finally {
    env.stop(proc);
    if (appSrv) appSrv.kill();
    proxy.close();
  }

  const fails = results.filter((r) => !r.ok);
  results.forEach((r) => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : ' —— ' + r.msg)));
  if (fails.length) {
    console.error('\n✗ ' + fails.length + ' 项未过');
    process.exit(1);
  }
  console.log('\n✓ 全部通过（' + results.length + ' 项）');
})().catch((e) => { console.error(e); process.exit(1); });
