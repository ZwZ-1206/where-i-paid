'use strict';
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9452;
const PROFILE = env.profile('probe-mode');
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
  const q = (s) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(s)});return e?{found:true,disabled:e.disabled,text:(e.textContent||'').trim().slice(0,40),cls:e.className}:{found:false};})()`);

  console.log('step0:', await ev(`(()=>{localStorage.clear();window.Store.clearAll();window.App.go('couple');return 1;})()`));
  await sleep(600);
  // 开始
  await ev(`document.querySelector('#view-couple [data-cp="to-consent"]').click()`);
  await sleep(500);
  console.log('consent: cb disabled?', (await q('#cp-agree')).disabled, '| ok disabled?', (await q('#cp-consent-ok')).disabled);
  // 滚动到底
  await ev(`(()=>{const sc=document.querySelector('#cp-consent-scroll');sc.scrollTop=sc.scrollHeight;sc.dispatchEvent(new Event('scroll',{bubbles:true}));})()`);
  await sleep(300);
  console.log('after scroll: cb disabled?', (await q('#cp-agree')).disabled);
  // 勾选（真实点击）
  await ev(`document.querySelector('#cp-agree').click()`);
  await sleep(200);
  console.log('after check: cb checked?', await ev(`document.querySelector('#cp-agree').checked`), '| ok disabled?', (await q('#cp-consent-ok')).disabled);
  await ev(`document.querySelector('#cp-consent-ok').click()`);
  await sleep(600);
  console.log('at profile? me found:', (await q('#cp-me')).found);
  // 填名字
  await ev(`(()=>{const me=document.querySelector('#cp-me'),peer=document.querySelector('#cp-peer');me.value='我';me.dispatchEvent(new Event('input',{bubbles:true}));peer.value='你';peer.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(300);
  // 选日期（真实点击）
  await ev(`document.querySelector('#cp-since').click()`);
  await sleep(400);
  await ev(`(()=>{const days=[...document.querySelectorAll('#sheet-root .dp-day[data-ts]')].filter(d=>!d.classList.contains('future'));days[0].click();})()`);
  await sleep(200);
  await ev(`document.querySelector('#sheet-root [data-act="ok"]').click()`);
  await sleep(400);
  console.log('profile ok disabled?', (await q('#cp-profile-ok')).disabled);
  await ev(`document.querySelector('#cp-profile-ok').click()`);
  await sleep(700);
  console.log('at mode? mode btns:', await ev(`document.querySelectorAll('#view-couple [data-mode]').length`));
  // 真实点击同城卡
  await ev(`document.querySelector('#view-couple [data-mode="local"]').click()`);
  await sleep(900);
  console.log('FINAL on():', await ev(`window.ViewCouple.on()`));
  console.log('FINAL page:', await ev(`window.ViewCouple.page`));
  console.log('main rendered (.cp-bill-entry):', await ev(`!!document.querySelector('#view-couple .cp-bill-entry')`));

  ws.close();
  await env.stop(proc);})();
