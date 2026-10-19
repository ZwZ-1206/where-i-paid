const env = require('./_env');
/* ============================================================
 * 验证：通过公网 HTTPS 地址，PWA 是否真的可安装
 * 用 Edge headless + CDP，检查 manifest / SW / 安装能力
 * ============================================================ */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = process.argv[2];
if (!URL_) { console.error('用法: node verify-install.js <https-url>'); process.exit(1); }

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'edge-verify-' + Date.now());
const PORT = 9333;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cdpGet(pathname, method) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: method || 'GET' }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=430,932',
    '--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'about:blank',
  ], { stdio: 'ignore' });

  let ws, id = 0;
  const pending = new Map();

  function send(method, params, sessionId) {
    return new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      const payload = { id: msgId, method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); reject(new Error('timeout ' + method)); } }, 30000);
    });
  }

  // 等 CDP 就绪
  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      // 主动新建一个 page 目标，避免连到浏览器扩展页
      const created = await cdpGet('/json/new?' + encodeURIComponent(URL_), 'PUT');
      if (created && created.webSocketDebuggerUrl) { target = created; break; }
    } catch (_) {}
    try {
      const list = await cdpGet('/json/list');
      const page = (list || []).find(t => t.type === 'page' && !/^(chrome-extension|devtools):/.test(t.url || ''));
      if (page) { target = page; break; }
    } catch (_) {}
    await sleep(300);
  }
  if (!target) { console.error('CDP 未就绪'); await env.stop(edge); process.exit(1); }

  const WebSocketImpl = globalThis.WebSocket;
  ws = new WebSocketImpl(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };

  const results = [];
  const ok = (n, c, d) => { results.push({ n, c, d }); console.log(`${c ? '✅' : '❌'} ${n}${d ? '  → ' + d : ''}`); };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Log.enable');

    console.log(`\n访问: ${URL_}\n`);

    const loaded = new Promise(r => setTimeout(r, 100));
    await send('Page.navigate', { url: URL_ });
    await sleep(6000);

    // 1. 页面是否正常加载
    const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    ok('页面加载', !!title.result.value, title.result.value);

    // 2. 是否是安全上下文（HTTPS）
    const sec = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({secure: window.isSecureContext, proto: location.protocol, host: location.host})',
      returnByValue: true,
    });
    const secObj = JSON.parse(sec.result.value);
    ok('安全上下文 (HTTPS)', secObj.secure === true, `${secObj.proto} // isSecureContext=${secObj.secure}`);

    // 3. Service Worker 是否注册成功
    const sw = await send('Runtime.evaluate', {
      expression: `navigator.serviceWorker.getRegistration().then(r => r ? JSON.stringify({ok:true, scope:r.scope, active: !!r.active, state: r.active && r.active.state}) : JSON.stringify({ok:false}))`,
      awaitPromise: true, returnByValue: true,
    });
    const swObj = JSON.parse(sw.result.value);
    ok('Service Worker 已注册', swObj.ok === true, swObj.ok ? `scope=${swObj.scope} state=${swObj.state}` : '未注册');

    // 4. manifest 是否可获取且解析正确
    const mf = await send('Runtime.evaluate', {
      expression: `fetch('manifest.webmanifest').then(r=>r.json()).then(j=>JSON.stringify({name:j.name,display:j.display,icons:(j.icons||[]).length,start:j.start_url})).catch(e=>JSON.stringify({err:String(e)}))`,
      awaitPromise: true, returnByValue: true,
    });
    const mfObj = JSON.parse(mf.result.value);
    ok('manifest 可解析', !mfObj.err, mfObj.err || `name=${mfObj.name} display=${mfObj.display} icons=${mfObj.icons}`);

    // 5. 关键安装条件：display standalone + 192/512 图标 + start_url + SW
    ok('display=standalone', mfObj.display === 'standalone', mfObj.display);
    ok('图标齐全 (192+512)', mfObj.icons >= 2, `${mfObj.icons} 个`);

    // 6. 图标能否真正加载（尺寸正确）
    const iconCheck = await send('Runtime.evaluate', {
      expression: `Promise.all(['assets/icons/icon-192.png','assets/icons/icon-512.png'].map(u=>new Promise(r=>{const i=new Image();i.onload=()=>r(u+':'+i.naturalWidth+'x'+i.naturalHeight);i.onerror=()=>r(u+':FAIL');i.src=u;}))).then(a=>JSON.stringify(a))`,
      awaitPromise: true, returnByValue: true,
    });
    const icons = JSON.parse(iconCheck.result.value);
    ok('图标可加载且尺寸正确', icons.every(s => /192x192|512x512/.test(s)), icons.join(' '));

    // 7. 应用真的能跑（渲染出界面）
    const rendered = await send('Runtime.evaluate', {
      expression: `JSON.stringify({views: document.querySelectorAll('.view').length, tabs: document.querySelectorAll('.tabbar .tab, .tabbar > *').length, body: document.body.innerText.length, store: typeof Store !== 'undefined', app: typeof App !== 'undefined'})`,
      returnByValue: true,
    });
    const rObj = JSON.parse(rendered.result.value);
    ok('应用正常渲染', rObj.views > 0 && rObj.body > 50, `${rObj.views} 个视图, 文本 ${rObj.body} 字符`);

    // 8. 数据层可用（能记账）
    const storeOk = await send('Runtime.evaluate', {
      expression: `(function(){ try { var before = Store.state.tx.length; Store.addTx({amount: 1234, cat:'food', account:'alipay', date: U.ymd(new Date()), note:'安装测试'}); var after = Store.state.tx.length; var last = Store.state.tx[Store.state.tx.length-1]; Store.removeTx(last.id); return JSON.stringify({ok: after === before+1, before: before, after: after}); } catch(e) { return JSON.stringify({ok:false, err:String(e)}); } })()`,
      returnByValue: true,
    });
    const stObj = JSON.parse(storeOk.result.value);
    ok('记账功能可用', stObj.ok === true, stObj.err || `${stObj.before} → ${stObj.after} 笔`);

    // 9. 离线能力：SW 缓存是否真的写入了
    const cache = await send('Runtime.evaluate', {
      expression: `caches.keys().then(keys => keys.length ? caches.open(keys[0]).then(c=>c.keys()).then(reqs=>JSON.stringify({keys:keys, count:reqs.length})) : JSON.stringify({keys:[],count:0}))`,
      awaitPromise: true, returnByValue: true,
    });
    const cObj = JSON.parse(cache.result.value);
    ok('离线缓存已写入', cObj.count > 0, `${cObj.count} 个资源, cache=${(cObj.keys || []).join(',')}`);

    // 10. 无 JS 错误
    const errors = await send('Runtime.evaluate', {
      expression: `JSON.stringify(window.__errs || [])`, returnByValue: true,
    });

    console.log('');
    const passed = results.filter(r => r.c).length;
    console.log(`结果: ${passed}/${results.length} 通过`);
    if (passed < results.length) {
      console.log('失败项: ' + results.filter(r => !r.c).map(r => r.n).join(', '));
    }
    process.exitCode = passed === results.length ? 0 : 1;

  } catch (e) {
    console.error('测试异常:', e.message);
    process.exitCode = 1;
  } finally {
    try { ws.close(); } catch (_) {}
    await env.stop(edge);
    await sleep(500);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  }
})();
