'use strict';
// 诊断：关闭情侣后再次进入，引导页是否出现「重新打开」快捷入口
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9477;
const PROFILE = env.profile('probe-resume');
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
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };

  await ev(`(function(){
    const S = window.Store;
    S.clearAll();
    S.enableCouple({ meName:'小明', peerName:'小红', mode:'local',
      togetherSince:'2024-05-20', consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)} });
    S.cpAddTx({ type:'expense', amount: 5200, catId:'food', note:'第一顿', ts: Date.now() });
    window.App.go('couple');
    return 1;
  })()`);
  await sleep(600);
  console.log('开通后 page =', await ev(`window.ViewCouple.page`));

  await ev(`(function(){
    window.Store.disableCouple();
    window.ViewCouple.setStep('intro');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(500);

  console.log('--- 关闭后诊断 ---');
  console.log('step        =', await ev(`window.ViewCouple.step`));
  console.log('intro 按钮  =', await ev(`!!document.querySelector('#view-couple [data-cp="to-consent"]')`));
  console.log('mode 卡数   =', await ev(`document.querySelectorAll('#view-couple [data-cp="mode"]').length`));
  console.log('enabled     =', await ev(`window.Store.settings.couple.enabled`));
  console.log('meName      =', JSON.stringify(await ev(`window.Store.settings.couple.meName`)));
  console.log('peerName    =', JSON.stringify(await ev(`window.Store.settings.couple.peerName`)));
  console.log('since       =', JSON.stringify(await ev(`window.Store.settings.couple.togetherSince`)));
  console.log('mode        =', JSON.stringify(await ev(`window.Store.settings.couple.mode`)));
  console.log('resume btn  =', await ev(`!!document.querySelector('#view-couple [data-cp="resume"]')`));
  console.log('on()        =', await ev(`window.ViewCouple.on()`));
  console.log('card r      =', await ev(`!!document.querySelector('#view-couple .cp-card--resume')`));
  console.log('html head   =', await ev(`(document.querySelector('#view-couple .cp-onboard')||{}).innerHTML.slice(0,300)`));

  await ev(`(function(){
    // 真机路径：调用 App.go 切过去，而不是手动 render
    window.Store.disableCouple();
    window.App.go('couple');
    return 1;
  })()`);
  await sleep(600);
  console.log('--- 走 App.go 之后 ---');
  console.log('step       =', await ev(`window.ViewCouple.step`));
  console.log('resume btn =', await ev(`!!document.querySelector('#view-couple [data-cp="resume"]')`));
  console.log('html head  =', await ev(`(document.querySelector('#view-couple .cp-onboard')||{}).innerHTML.slice(0,260)`));

  ws.close();
  await env.stop(proc);})();

