/* 探针：同意页「同意并继续」在未勾选 / 勾选 两种状态下的实际颜色 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9441;
const PROFILE = env.profile('probe-btn');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
    '--window-size=390,844', URL], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) { /* wait */ }
    await sleep(250);
  }
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
  const page = targets.targetInfos.find((x) => x.type === 'page' && !/devtools|extension/.test(x.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: URL });
  await sleep(2600);

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };

  await ev(`(function(){ localStorage.clear(); window.Store.clearAll(); return 1; })()`);
  await sleep(300);
  await ev(`window.App.go('couple')`);
  await sleep(600);
  await ev(`document.querySelector('#view-couple [data-cp="to-consent"]').click()`);
  await sleep(600);

  const read = `(function(){
    const b = document.querySelector('#cp-consent-ok');
    if (!b) return 'NO BUTTON';
    const cs = getComputedStyle(b);
    return JSON.stringify({
      disabled: b.disabled,
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage.slice(0, 60),
      color: cs.color,
      shadow: cs.boxShadow,
      opacity: cs.opacity,
      pointer: cs.pointerEvents,
    });
  })()`;

  console.log('未勾选：', await ev(read));

  await ev(`(function(){ const sc = document.querySelector('#cp-consent-scroll'); sc.scrollTop = sc.scrollHeight; return 1; })()`);
  await sleep(200);
  await ev(`document.querySelector('.cp-check').click()`);
  await sleep(400);
  console.log('已勾选：', await ev(read));
  console.log('复选框：', await ev(`(function(){
    const bx = document.querySelector('.cp-box');
    const cs = getComputedStyle(bx);
    return JSON.stringify({ bg: cs.backgroundColor, border: cs.borderTopColor, icon: getComputedStyle(bx.querySelector('.ic')).opacity });
  })()`));

  ws.close();
  await env.stop(proc);})();
