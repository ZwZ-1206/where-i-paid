/* 探针：看同意页底部到底渲染出了什么 */
const { spawn } = require('child_process');
const env = require('./_env');
let CDP;
try { CDP = require('./cdp.js'); } catch (e) { CDP = null; }

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9411;
const PROFILE = env.profile('probe-consent');

async function main() {
  const { spawn: sp } = require('child_process');
  const fs = require('fs');
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  const child = sp(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
    '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      target = list.find((t) => t.type === 'page');
    } catch (e) {}
  }
  if (!target) { console.log('no target'); child.kill(); return; }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return 'ERR: ' + JSON.stringify(r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/?probe=' + Date.now() });
  await new Promise((r) => setTimeout(r, 2600));

  await ev(`localStorage.clear(); location.reload(); 1`);
  await new Promise((r) => setTimeout(r, 2600));

  console.log('typeof ViewCouple =', await ev(`typeof window.ViewCouple`));
  await ev(`App.go('couple'); 1`);
  await new Promise((r) => setTimeout(r, 400));
  await ev(`document.querySelector('#view-couple [data-cp="to-consent"]').click(); 1`);
  await new Promise((r) => setTimeout(r, 500));

  console.log('---- 同意页底部 HTML ----');
  console.log(await ev(`(document.querySelector('#view-couple .cp-foot--consent')||{}).outerHTML || 'NONE'`));
  console.log('---- 勾选框尺寸 ----');
  console.log(await ev(`(() => {
    const cb = document.querySelector('#view-couple #cp-agree');
    if (!cb) return 'NO checkbox';
    const r = cb.getBoundingClientRect();
    const cs = getComputedStyle(cb);
    return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height),
      x: Math.round(r.x), y: Math.round(r.y),
      appearance: cs.appearance, display: cs.display, opacity: cs.opacity, accent: cs.accentColor });
  })()`));
  console.log('---- 按钮初始 ----');
  console.log(await ev(`(() => { const b = document.querySelector('#cp-consent-ok'); return b ? JSON.stringify({ disabled: b.disabled, text: b.textContent.trim() }) : 'NONE'; })()`));

  ws.close(); child.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
}
main().catch((e) => { console.error(e); process.exit(1); });
