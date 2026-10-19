'use strict';
const fs = require('fs'), path = require('path');
const env = require('./_env');
const { spawn } = require('child_process');
const PORT = 9422; const PROFILE = env.profile('lk'), URL = 'http://127.0.0.1:4173/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu', '--window-size=390,844', URL], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {} await sleep(250); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl); let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (m, p, s) => new Promise(res => { const myid = ++id; pend.set(myid, x => x.error ? console.error(m, x.error.message) : res(x.result)); ws.send(JSON.stringify({ id: myid, method: m, params: p || {}, sessionId: s })); });
  const t = await send('Target.getTargets'); const pg = t.targetInfos.find(x => x.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', { targetId: pg.targetId, flatten: true }); const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: URL }); await sleep(2600);
  const ev = async e => { const r = await S('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text); return r.result.value; };
  await ev("localStorage.clear();Store.clearAll();App.go('couple')"); await sleep(500);
  await ev("document.querySelector('#view-couple [data-cp=\"to-consent\"]').click()"); await sleep(500);
  const before = await ev("({hint:document.querySelector('#cp-consent-hint').textContent,locked:document.querySelector('#cp-check-wrap').classList.contains('is-locked'),cbDisabled:document.querySelector('#cp-agree').disabled,okDisabled:document.querySelector('#cp-consent-ok').disabled})");
  await ev("(()=>{const sc=document.querySelector('#cp-consent-scroll');sc.scrollTop=sc.scrollHeight;sc.dispatchEvent(new Event('scroll',{bubbles:true}));})()"); await sleep(300);
  const after = await ev("({hint:document.querySelector('#cp-consent-hint').textContent,locked:document.querySelector('#cp-check-wrap').classList.contains('is-locked'),cbDisabled:document.querySelector('#cp-agree').disabled,okDisabled:document.querySelector('#cp-consent-ok').disabled})");
  console.log('LOCKED  :', JSON.stringify(before));
  console.log('UNLOCKED:', JSON.stringify(after));
  ws.close(); await env.stop(proc);})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
