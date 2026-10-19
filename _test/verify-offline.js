const env = require('./_env');
/* ============================================================
 * 验证：断网后应用是否真的还能打开（PWA 离线能力）
 * 流程：联网加载 → 等 SW 缓存 → 切到离线 → 重新加载 → 检查是否正常
 * ============================================================ */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = process.argv[2];
if (!URL_) { console.error('用法: node verify-offline.js <https-url>'); process.exit(1); }

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'edge-offline-' + Date.now());
const PORT = 9334;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cdpGet(p, method) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method || 'GET' }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(d); } });
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=430,932',
    '--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'about:blank',
  ], { stdio: 'ignore' });

  let ws, id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
    setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); reject(new Error('timeout ' + method)); } }, 40000);
  });

  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const c = await cdpGet('/json/new?' + encodeURIComponent(URL_), 'PUT');
      if (c && c.webSocketDebuggerUrl) { target = c; break; }
    } catch (_) {}
    await sleep(300);
  }
  if (!target) { console.error('CDP 未就绪'); await env.stop(edge); process.exit(1); }

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  };

  const results = [];
  const ok = (n, c, d) => { results.push({ n, c }); console.log(`${c ? '✅' : '❌'} ${n}${d ? '  → ' + d : ''}`); };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');

    console.log(`\n地址: ${URL_}\n`);

    // --- 阶段 1：联网首次加载 ---
    await send('Page.navigate', { url: URL_ });
    await sleep(7000);

    const first = await send('Runtime.evaluate', {
      expression: `JSON.stringify({title: document.title, views: document.querySelectorAll('.view').length, tx: (typeof Store!=='undefined' ? Store.state.tx.length : -1)})`,
      returnByValue: true,
    });
    const f = JSON.parse(first.result.value);
    ok('联网首次加载成功', f.views > 0 && f.tx >= 0, `${f.views} 视图, ${f.tx} 笔账`);

    // 写一笔数据，稍后验证离线后数据还在
    await send('Runtime.evaluate', {
      expression: `(function(){ Store.addTx({amount: 8888, cat:'food', account:'alipay', date: U.ymd(new Date()), note:'离线持久化测试'}); localStorage.setItem('__probe','ok'); })()`,
    });

    // 等 SW 缓存完成
    const cacheCount = await send('Runtime.evaluate', {
      expression: `navigator.serviceWorker.ready.then(()=>caches.keys()).then(k=>k.length?caches.open(k[0]).then(c=>c.keys()).then(r=>r.length):0)`,
      awaitPromise: true, returnByValue: true,
    });
    ok('资源已缓存', cacheCount.result.value > 0, `${cacheCount.result.value} 个资源`);

    // --- 阶段 2：切到离线 ---
    await send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    console.log('\n  --- 已断网，重新加载 ---\n');
    await sleep(500);

    await send('Page.reload', { ignoreCache: false });
    await sleep(7000);

    const off = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        title: document.title,
        views: document.querySelectorAll('.view').length,
        bodyLen: document.body.innerText.length,
        tx: (typeof Store!=='undefined' ? Store.state.tx.length : -1),
        probe: localStorage.getItem('__probe'),
        hasNav: !!document.querySelector('.tabbar')
      })`,
      returnByValue: true,
    });
    const o = JSON.parse(off.result.value);

    ok('断网后页面仍能打开', o.title && o.bodyLen > 50, `标题="${o.title}" 文本 ${o.bodyLen} 字符`);
    ok('断网后界面完整渲染', o.views > 0 && o.hasNav, `${o.views} 个视图, 底部导航=${o.hasNav}`);
    ok('断网后数据仍在', o.tx > 0, `${o.tx} 笔账`);
    ok('本地存储保留', o.probe === 'ok', `probe=${o.probe}`);

    // 断网下能否继续记账
    const canAdd = await send('Runtime.evaluate', {
      expression: `(function(){ try { var b=Store.state.tx.length; Store.addTx({amount: 100, cat:'food', account:'cash', date: U.ymd(new Date()), note:'断网记账'}); var a=Store.state.tx.length; return JSON.stringify({ok:a===b+1, b:b, a:a}); } catch(e){ return JSON.stringify({ok:false, err:String(e)}); } })()`,
      returnByValue: true,
    });
    const ca = JSON.parse(canAdd.result.value);
    ok('断网后仍可记账', ca.ok === true, ca.err || `${ca.b} → ${ca.a} 笔`);

    // 恢复网络
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    console.log('');
    const passed = results.filter(r => r.c).length;
    console.log(`结果: ${passed}/${results.length} 通过`);
    process.exitCode = passed === results.length ? 0 : 1;
  } catch (e) {
    console.error('异常:', e.message);
    process.exitCode = 1;
  } finally {
    try { ws.close(); } catch (_) {}
    await env.stop(edge);
    await sleep(500);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  }
})();
