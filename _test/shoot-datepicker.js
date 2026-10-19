// 拍日期选择器与时区面板的新样式
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');
const PORT = 9493;
const PROFILE = env.profile('dp-shot');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = env.shots('shoot-datepicker'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {} await sleep(250); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text); });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params, sessionId) => new Promise((res, rej) => { const my = ++id; pend.set(my, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: my, method, params: params || {}, sessionId })); });
  const tg = await send('Target.getTargets');
  const pg = tg.targetInfos.find((x) => x.type === 'page' && !/devtools|extension/.test(x.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: pg.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: 'http://127.0.0.1:4173/index.html' }); await sleep(2600);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description }; return r.result.value; };
  async function shot(name) {
    const r = await S('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  shot:', name);
  }

  await ev("(function(){const S=window.Store;S.clearAll();S.enableCouple({meName:'小懒',peerName:'小满',mode:'remote',togetherSince:'2024-05-20',consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}});S.setCoupleConfig({tzOffset:-5});window.App.go('couple');return 1})()");
  await sleep(900);
  await shot('dp1-remote-card');

  await ev("document.querySelector('#view-couple [data-cp=\"tz\"]').click()"); await sleep(700);
  await shot('dp2-tz-picker');
  await ev("document.querySelector('#sheet-root .sheet-close').click()"); await sleep(600);

  // 日期选择器：从「挑个日子」进去
  await ev("(function(){const b=document.querySelector('#view-couple [data-cp=\"next-meet\"]'); if(b) b.click(); return !!b})()"); await sleep(700);
  await shot('dp3-day');
  await ev("document.querySelector('#sheet-root .dp-m').click()"); await sleep(400);
  await shot('dp4-month');
  await ev("document.querySelector('#sheet-root .dp-y').click()"); await sleep(400);
  await shot('dp5-year');
  await ev("(function(){document.querySelector('#sheet-root .sheet-close').click();return 1})()"); await sleep(500);

  // 深色模式
  await ev("Store.setSettings({theme:'dark'}); App.applyTheme();"); await sleep(500);
  await ev("(function(){const b=document.querySelector('#view-couple [data-cp=\"tz\"]'); if(b) b.click(); return !!b})()"); await sleep(700);
  await shot('dp6-tz-dark');
  await ev("(function(){document.querySelector('#sheet-root .sheet-close').click();return 1})()"); await sleep(400);
  await ev("(function(){const b=document.querySelector('#view-couple [data-cp=\"next-meet\"]'); if(b) b.click(); return !!b})()"); await sleep(600);
  await ev("(function(){const m=document.querySelector('#sheet-root .dp-m'); if(m) m.click(); return 1})()"); await sleep(400);
  await shot('dp7-month-dark');

  console.log('JS 异常:', errs.length ? errs.join(' | ') : 'none');
  ws.close(); await env.stop(proc);console.log('done');
})();
