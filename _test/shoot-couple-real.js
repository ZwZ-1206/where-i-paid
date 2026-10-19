const env = require('./_env');
/* 情侣账本 · 真实点击完整链路截图（验证「点同城没反应」修复） */
const PORT = 9417;
const PROFILE = env.profile('couple-real');
const OUT = env.shots('shoot-couple-real'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
const fs = require('fs');
const { spawn } = require('child_process');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', URL], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

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
  const page = targets.targetInfos.find((t) => t.type === 'page' && !/devtools|extension/.test(t.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: URL });
  await sleep(2800);

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(require('path').join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  shot:', name);
  };
  const errs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push((d.exception && d.exception.description) || d.text);
    }
  });

  // 全新状态
  await ev("(()=>{localStorage.clear();window.Store.clearAll();return 1;})()");
  await sleep(500);
  await ev("App.go('couple')"); await sleep(800);
  await ev("document.querySelector('#view-couple [data-cp=\"to-consent\"]').click()"); await sleep(700);

  // 同意页：未滚到底（勾选框应锁定 + 提示）
  await shot('cpR1-consent-locked');

  // 滚到底
  await ev(`(()=>{const sc=document.querySelector('#cp-consent-scroll');sc.scrollTop=sc.scrollHeight;sc.dispatchEvent(new Event('scroll',{bubbles:true}));})()`);
  await sleep(400);
  await shot('cpR2-consent-unlocked');

  // 真实点击勾选 + 同意
  await ev("document.querySelector('#cp-agree').click()"); await sleep(200);
  await ev("document.querySelector('#cp-consent-ok').click()"); await sleep(600);
  await shot('cpR3-profile');

  // 填名字 + 真实点日期
  await ev(`(()=>{const me=document.querySelector('#cp-me'),peer=document.querySelector('#cp-peer');me.value='小懒';me.dispatchEvent(new Event('input',{bubbles:true}));peer.value='小满';peer.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(300);
  await ev("document.querySelector('#cp-since').click()"); await sleep(500);
  await ev(`(()=>{const days=[...document.querySelectorAll('#sheet-root .dp-day[data-ts]')].filter(d=>!d.classList.contains('future'));if(days[0])days[0].click();})()`);
  await sleep(200);
  await ev("document.querySelector('#sheet-root [data-act=\"ok\"]').click()"); await sleep(400);
  await shot('cpR4-profile-filled');

  // 继续 -> 模式页
  await ev("document.querySelector('#cp-profile-ok').click()"); await sleep(700);
  await shot('cpR5-mode');

  // 真实点同城
  await ev("document.querySelector('#view-couple [data-mode=\"local\"]').click()"); await sleep(1000);
  await shot('cpR6-main-local');

  if (errs.length) console.log('JS 异常:', errs.slice(0, 3));
  else console.log('JS 异常: none');

  ws.close(); await env.stop(proc);console.log('done');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
