const env = require('./_env');
/* ============================================================
 * 验证：浏览器是否真的触发「可安装」事件 (beforeinstallprompt)
 * 这是「能不能真安装」的权威判据，不是看有没有 SW。
 * ============================================================ */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = process.argv[2];
if (!URL_) { console.error('用法: node verify-installable.js <https-url>'); process.exit(1); }

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'edge-bip-' + Date.now());
const PORT = 9335;
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

    // 在页面加载前注入监听器，抓 beforeinstallprompt
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__bip = null;
        window.addEventListener('beforeinstallprompt', function (e) {
          window.__bip = { platforms: e.platforms || [], userChoice: !!e.userChoice };
          e.preventDefault();
          window.__bipEvent = e;
        });
        window.addEventListener('appinstalled', function () { window.__installed = true; });
      `,
    });

    console.log(`\n地址: ${URL_}\n`);
    await send('Page.navigate', { url: URL_ });
    await sleep(9000);

    // 触发一次用户交互（安装判定需要）
    await send('Runtime.evaluate', {
      expression: `document.body.dispatchEvent(new MouseEvent('click', {bubbles:true})); document.body.click();`,
    });
    await sleep(3000);

    const bip = await send('Runtime.evaluate', {
      expression: `JSON.stringify({bip: window.__bip, installed: !!window.__installed, standalone: window.matchMedia('(display-mode: standalone)').matches, secure: window.isSecureContext})`,
      returnByValue: true,
    });
    const b = JSON.parse(bip.result.value);

    ok('安全上下文', b.secure === true, String(b.secure));
    ok('浏览器触发「可安装」事件 (beforeinstallprompt)', !!b.bip,
      b.bip ? `platforms=${JSON.stringify(b.bip.platforms)}` : '未触发');

    // 用 CDP 直接问浏览器的安装状态
    let manifestInfo = null;
    try {
      manifestInfo = await send('Page.getAppManifest');
    } catch (_) {}
    if (manifestInfo) {
      ok('浏览器解析到 manifest', !!manifestInfo.url, manifestInfo.url || '无');
      const errs = manifestInfo.errors || [];
      ok('manifest 无错误', errs.length === 0,
        errs.length ? errs.map(e => e.message || e.critical).join('; ') : '无错误');
    }

    // 尝试真正触发安装（headless 下会失败，但能验证流程可走通）
    if (b.bip) {
      const prompt = await send('Runtime.evaluate', {
        expression: `(function(){ try { window.__bipEvent.prompt(); return 'prompt() 已调用，安装对话框可弹出'; } catch(e) { return 'prompt 失败: '+e.message; } })()`,
        returnByValue: true,
      });
      ok('安装对话框可调用', /已调用/.test(prompt.result.value), prompt.result.value);
    }

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
