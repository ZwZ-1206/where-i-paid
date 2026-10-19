// 临时：截取情侣账本「生日」表单与选择器（用完即删）
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9370;
const OUT = 'C:\\Users\\ZwZ\\AppData\\Local\\Temp\\bd';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    '--window-size=1200,900', '--user-data-dir=' + process.env.TEMP + '\\edge-bd-' + Date.now(),
    'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find((t) => t.type === 'page');
    } catch (_) { /* 等待 */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const myId = ++id; pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}\\${name}.png`, Buffer.from(s.data, 'base64'));
    console.log('shot', name);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/index.html' });
  await sleep(3500);

  await evalJs(`[...document.querySelectorAll('button')].find(e => (e.textContent||'').includes('情侣'))?.click()`);
  await sleep(1200);
  await evalJs(`document.querySelector('[data-cp="to-consent"]')?.click()`);
  await sleep(1000);
  await evalJs(`(() => { const s = document.querySelector('#cp-consent-scroll'); s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event('scroll', {bubbles:true})); })()`);
  await sleep(700);
  await evalJs(`document.querySelector('#cp-agree')?.click()`);
  await sleep(400);
  console.log('consent ok enabled →', await evalJs(`!(document.querySelector('#cp-consent-ok')||{}).disabled`));
  await evalJs(`document.querySelector('#cp-consent-ok')?.click()`);
  await sleep(1200);

  console.log('当前步骤 →', await evalJs(`(document.querySelector('.cp-onboard-title')||{}).textContent || '(无标题)'`));
  await shot('01-profile');

  await evalJs(`document.querySelector('#cp-mybd')?.click()`);
  await sleep(900);
  await shot('02-picker');

  // 看看选择器内部结构
  console.log('picker 结构 →', await evalJs(`(() => {
    const d = [...document.querySelectorAll('.sheet, .picker, [class*="picker"], [class*="sheet"]')]
      .filter(e => e.offsetParent !== null).map(e => e.className + ' | ' + (e.innerText||'').replace(/\\s+/g,' ').slice(0,120));
    return JSON.stringify(d).slice(0, 600);
  })()`));

  ws.close(); proc.kill(); process.exit(0);
})();
