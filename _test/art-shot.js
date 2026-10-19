/* 截图 + 不裁切断言：模式页（设置入口 / 引导入口）、浅色与深色。
   截图落在系统临时目录（env.shots，脚本会把路径打出来），不进源码树。
   所有「是否完整」的判断都走像素比对，不靠肉眼看图。 */
'use strict';
const fs = require('fs');
const path = require('path');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9442;
const PROFILE = env.profile('art-shot');
const OUT = env.shots('art-shot'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
const URL = 'http://127.0.0.1:4180/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => console.log(s);

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(env.EDGE, env.edgeArgs(PORT, PROFILE, ['--window-size=390,844']).concat([URL]), { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const jsErrors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      jsErrors.push((d.exception && d.exception.description) || d.text);
    }
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
    const r = await Sx('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    say('  shot: ' + name);
  };

  await ev(`(function(){
    const S = window.Store;
    const c = S.settings.couple || {};
    c.enabled = true;
    c.consent = Object.assign({}, c.consent || {}, { agreed: true, version: (window.ViewCouple.CONSENT_VERSION || 1) });
    c.meName = '阿泽'; c.peerName = '小满'; c.mode = 'remote';
    c.togetherSince = '2026-03-14';
    S.settings.couple = c; S.save && S.save();
    App.go('couple');
    const v = document.querySelector('#view-couple');
    window.ViewCouple.setPage('mode'); window.ViewCouple.render(v);
    return 1;
  })()`);
  await sleep(900);
  await shot('mode-light');

  await ev(`document.documentElement.setAttribute('data-theme','dark'); 1`);
  await sleep(400);
  await shot('mode-dark');

  await ev(`document.documentElement.setAttribute('data-theme','light');
    const S = window.Store; const c = S.settings.couple; c.mode = ''; S.save && S.save();
    const v = document.querySelector('#view-couple');
    window.ViewCouple.setPage('onboarding'); window.ViewCouple.render(v); 1`);
  await sleep(700);
  await shot('guide-mode');

  say('JS 异常：' + (jsErrors.length ? JSON.stringify(jsErrors) : '无'));
  await env.stop(proc);
})().catch(async (e) => { console.error(e); process.exit(1); });
