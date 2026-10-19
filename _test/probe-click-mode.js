'use strict';
/* 复现真机场景：模拟「已经填完资料、停在模式页」，点模式卡后能否进主界面 */
const fs = require('fs'), path = require('path');
const env = require('./_env');
const { spawn } = require('child_process');
const PORT = 9433; const PROFILE = env.profile('m'), URL = 'http://127.0.0.1:4173/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu', '--window-size=390,844', URL], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {} await sleep(250); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl); let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (m, p, s) => new Promise(res => { const myid = ++id; pend.set(myid, x => x.error ? (console.error(m, x.error.message), res(null)) : res(x.result)); ws.send(JSON.stringify({ id: myid, method: m, params: p || {}, sessionId: s })); });
  const t = await send('Target.getTargets'); const pg = t.targetInfos.find(x => x.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', { targetId: pg.targetId, flatten: true }); const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: URL }); await sleep(2600);
  const ev = async e => { const r = await S('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text); return r.result.value; };
  const errs = [];
  ws.addEventListener('message', ev2 => { const m = JSON.parse(ev2.data); if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errs.push(((d.exception || {}).description) || d.text); } });

  // 直接构造「同意 + 资料都齐了，但还没选模式」的状态，等价于真机停在模式页
  await ev(`(()=>{
    localStorage.clear();
    Store.clearAll();
    Store.setSettings({ couple: {
      enabled: false,
      consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)} },
      meName: '小懒', peerName: '小满', togetherSince: '2024-05-20'
    }});
    ViewCouple.setStep('mode');
    App.go('couple');
    return 1;
  })()`);
  await sleep(700);
  console.log('停在模式页：', await ev(`({mode:document.querySelectorAll('#view-couple [data-mode]').length, enabled:Store.settings.couple.enabled, step:ViewCouple.step})`));

  // 真实点击「我们在同城」
  await ev(`document.querySelector('#view-couple [data-mode="local"]').click()`);
  await sleep(900);
  console.log('点击后：', await ev(`({enabled:Store.settings.couple.enabled, mode:Store.settings.couple.mode, on:ViewCouple.on(), step:ViewCouple.step, entry:!!document.querySelector('#view-couple .cp-bill-entry'), errCard:!!document.querySelector('#view-couple .cp-error')})`));
  if (errs.length) console.log('JS 异常:', errs.slice(0, 3)); else console.log('JS 异常: none');
  ws.close(); await env.stop(proc);})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
