/* 临时截图脚本：把「同城/异地」选择页和异地首页各拍一张，供人眼核对。
   跑完就删，不留在交付里。 */
'use strict';
const fs = require('fs');
const path = require('path');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9471;
const PROFILE = env.profile('shot-mode');
const EDGE = env.EDGE;
const URL = 'http://127.0.0.1:4180/index.html';
const OUT = env.shots('shot-mode'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(EDGE, env.edgeArgs(PORT, PROFILE).concat(['--window-size=390,844', URL]), { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
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
  const Sx = (m, p) => send(m, p, sessionId);
  await Sx('Page.enable');
  await Sx('Runtime.enable');
  await Sx('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await Sx('Page.navigate', { url: URL });
  await sleep(2600);
  const ev = async (expr) => {
    const r = await Sx('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await Sx('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  };

  await ev(`(function(){
    const S = window.Store;
    const c = S.settings.couple || {};
    c.enabled = true;
    c.consent = Object.assign({}, c.consent || {}, { agreed: true, version: (window.ViewCouple.CONSENT_VERSION || 1) });
    c.meName = '阿泽'; c.peerName = '小满'; c.mode = 'k';
    c.togetherSince = '2026-03-14';
    S.settings.couple = c; S.save && S.save();
    App.go('couple');
    const v = document.querySelector('#view-couple');
    window.ViewCouple.setPage('mode'); window.ViewCouple.render(v);
    return 1;
  })()`);
  await sleep(900);
  await shot('mode-local');

  await ev(`(function(){
    const S = window.Store;
    S.settings.couple.mode = 'r'; S.save && S.save();
    const v = document.querySelector('#view-couple');
    window.ViewCouple.render(v);
    return 1;
  })()`);
  await sleep(900);
  await shot('mode-remote');

  await ev(`(function(){
    const v = document.querySelector('#view-couple');
    window.ViewCouple.setPage('home'); window.ViewCouple.render(v);
    return 1;
  })()`);
  await sleep(900);
  await shot('home-remote');

  await ev(`(function(){ document.querySelector('#view-couple').scrollTop = 99999; return 1; })()`);
  await sleep(400);
  await shot('home-remote-bottom');

  console.log('shots -> ' + OUT);
  ws.close();
  await env.stop(proc);
})().catch((e) => { console.error(e); process.exit(1); });
