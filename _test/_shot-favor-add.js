// 临时截图：偏爱补记入口 + 弹层（不属于回归套件）
'use strict';
const fs = require('fs');
const path = require('path');
const env = require('./_env');
const { spawn } = require('child_process');
const PORT = 9441;
const PROFILE = env.profile('shot-favor');
const EDGE = env.EDGE;
const URL = 'http://127.0.0.1:4180/index.html';
const OUT = env.shots('shot-favor-add'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu', '--window-size=390,844', URL], { stdio: 'ignore' });
  try {
    let ver;
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
      await sleep(250);
    }
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    await new Promise((r) => ws.addEventListener('open', r));
    const send = (method, params, sessionId) => new Promise((res, rej) => {
      const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
      ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId }));
    });
    const t = await send('Target.getTargets');
    const page = t.targetInfos.find((x) => x.type === 'page' && !/devtools/.test(x.url));
    const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S('Page.enable'); await S('Runtime.enable');
    await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await S('Page.navigate', { url: URL }); await sleep(2600);
    const ev = async (x) => { const r = await S('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
    await ev(`(function(){ const S=window.Store; S.clearAll(false); S.enableCouple({meName:'阿泽',peerName:'小满',mode:'local',togetherSince:'2026-03-14',consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}}); return 1; })()`);
    await ev(`App.go('couple')`); await sleep(300);
    await ev(`(function(){ window.ViewCouple.setPage('favor'); window.ViewCouple.render(document.querySelector('#view-couple')); return 1; })()`);
    await sleep(300);
    let shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, 'favor-days.png'), Buffer.from(shot.data, 'base64'));
    await ev(`document.querySelector('#view-couple [data-cp="favor-add"]').click()`); await sleep(500);
    shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, 'favor-sheet.png'), Buffer.from(shot.data, 'base64'));
    console.log('saved');
  } finally {
    try { proc.kill(); } catch (e) {}
    await env.stop(proc);
  }
})().catch((e) => { console.error(e); process.exit(1); });
