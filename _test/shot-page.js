/* 通用页面截图（设计自审用）
 * node _test/shot-page.js <url> <width> <height> <out> [--full] [--dark] [--mobile]
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const env = require('./_env');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9431;
const [url, w, h, out] = process.argv.slice(2);
const flags = process.argv.slice(6);
const full = flags.includes('--full');
const dark = flags.includes('--dark');
const mobile = flags.includes('--mobile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = env.profile('page-shot');
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  if (!target) throw new Error('无法连接浏览器');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const S = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  await S('Page.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile });
  if (mobile) await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (dark) await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

  await S('Page.navigate', { url });
  await sleep(1800);

  let params = { format: 'png', captureBeyondViewport: false };
  if (full) params = { format: 'png', captureBeyondViewport: true };
  const r = await S('Page.captureScreenshot', params);
  fs.writeFileSync(path.resolve(out), Buffer.from(r.data, 'base64'));

  // 顺手把页面高度与横向溢出打出来，省得肉眼找
  const m = await S('Runtime.evaluate', {
    expression: `JSON.stringify({h: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})`,
    returnByValue: true,
  });
  console.log(out, m.result.value);

  ws.close();
  await env.stop(proc);
  process.exit(0);
})().catch((e) => { console.error('失败', e.message); process.exit(1); });
