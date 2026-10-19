// 诊断：headless Edge 打开 4173，看 window.Store 到底加载没有
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9425;
const BASE = 'http://localhost:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (p) => new Promise((res, rej) => {
  http.get(`http://127.0.0.1:${PORT}${p}`, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

(async () => {
  const PROFILE = env.profile('diag3');
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--headless=new', '--disable-gpu', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  await sleep(2600);
  let target;
  for (let i = 0; i < 15; i++) {
    try { const l = await getJSON('/json/list'); target = l.find((t) => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(400);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await send('Runtime.enable'); await send('Page.enable');
  const errors = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); else if (m.method === 'Network.loadingFailed') console.log('REQFAIL', m.params.errorText, m.params.blockedReason || ''); };
  await send('Network.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(2500);
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  console.log('readyState:', await ev('document.readyState'));
  console.log('scripts:', await ev('document.scripts.length'));
  console.log('Store:', typeof (await ev('window.Store')));
  console.log('U:', typeof (await ev('window.U')));
  console.log('App:', typeof (await ev('window.App')));
  console.log('localStorage len:', await ev('localStorage.length'));
  console.log('body child count:', await ev('document.body.children.length'));
  console.log('body innerHTML head:', JSON.stringify((await ev('document.body.innerHTML.slice(0,120)'))));
  if (errors.length) console.log('PAGE EXC:\n' + errors.join('\n'));
  ws.close(); await env.stop(proc);
  process.exit(0);
})().catch((e) => { console.error('diag failed:', e); process.exit(1); });
