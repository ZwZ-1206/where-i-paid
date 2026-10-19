/* 探针：跟踪 intro → consent → profile → mode 的实际 step 变化 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9409;
const PROFILE = env.profile('probe2');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', URL,
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) { /* 等 */ }
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
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

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      console.log('EXC:', (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text);
    }
  });

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Page.navigate', { url: URL });
  await sleep(2800);

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return 'THROW: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };

  const snap = async (tag) => {
    const info = await ev(`(function(){
      const v = document.querySelector('#view-couple');
      const btns = v ? Array.from(v.querySelectorAll('button')) : [];
      const ids = btns.map(function (b) { return b.id || ''; }).filter(Boolean);
      const modes = v ? Array.from(v.querySelectorAll('[data-mode]')).map(function (b) { return b.getAttribute('data-mode'); }) : [];
      const ok = v ? v.querySelector('#cp-profile-ok') : null;
      return JSON.stringify({
        ids: ids, modes: modes,
        okDisabled: ok ? ok.disabled : null,
        meVal: (v && v.querySelector('#cp-me') || {}).value,
        peerVal: (v && v.querySelector('#cp-peer') || {}).value,
        set: window.Store && Store.settings.couple,
      });
    })()`);
    console.log(tag, info);
  };

  await ev("App.go('couple')");
  await sleep(800);
  await snap('[初始]');

  await ev("document.querySelector('[data-cp=\\\"to-consent\\\"]').click()");
  await sleep(600);
  await snap('[同意页]');

  await ev(`(function(){
    const sc = document.querySelector('#cp-consent-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
    const cb = document.querySelector('#cp-agree');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    return 1;
  })()`);
  await sleep(400);
  console.log('consent-ok disabled=', await ev("(function(){ const b=document.querySelector('#cp-consent-ok'); return b ? b.disabled : 'none'; })()"));

  await ev("document.querySelector('#cp-consent-ok').click()");
  await sleep(600);
  await snap('[资料页]');

  await ev(`(function(){
    const me = document.querySelector('#cp-me'); const peer = document.querySelector('#cp-peer');
    if (me) { me.value = '小懒'; me.dispatchEvent(new Event('input', { bubbles: true })); }
    if (peer) { peer.value = '小满'; peer.dispatchEvent(new Event('input', { bubbles: true })); }
    return 1;
  })()`);
  await sleep(300);
  await snap('[填完名字]');

  await ev(`(function(){
    Store.setSettings({ couple: { togetherSince: '2024-05-20' } });
    ViewCouple.setStep('profile');
    ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(600);
  await snap('[补日期后]');

  console.log('点继续:', await ev(`(function(){
    const b = document.querySelector('#cp-profile-ok');
    if (!b) return 'no button';
    if (b.disabled) return 'disabled';
    b.click();
    return 'clicked';
  })()`));
  await sleep(800);
  await snap('[点继续后]');

  ws.close();
  await env.stop(proc);})();
