/* 探针：账单页顶栏标题到底是什么 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9433;
const PROFILE = env.profile('probe-top');
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

  await ev(`(function(){
    const S = window.Store;
    S.clearAll();
    S.enableCouple({ meName:'A', peerName:'B', mode:'local', togetherSince:'2024-05-20',
      consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)} });
    window.App.go('couple');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(700);
  console.log('has to-bill:', await ev(`!!document.querySelector('#view-couple [data-cp="to-bill"]')`));

  console.log('page before :', await ev(`window.ViewCouple.page`));
  console.log('title before:', await ev(`(document.querySelector('#topbar .tb-title')||{}).textContent`));

  await ev(`document.querySelector('#view-couple [data-cp="to-bill"]').click()`);
  await sleep(700);
  console.log('page after  :', await ev(`window.ViewCouple.page`));
  console.log('topbar html :', await ev(`document.querySelector('#topbar').innerHTML.slice(0,300)`));
  console.log('title after :', await ev(`(document.querySelector('#topbar .tb-title')||{}).textContent`));
  console.log('has refreshTopbar:', await ev(`typeof (window.App && window.App.refreshTopbar)`));

  ws.close();
  await env.stop(proc);})();
