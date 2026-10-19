/* 逻辑自测：在浏览器环境里跑 Store / Utils 的核心算法 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const BASE = 'http://localhost:4173/index.html';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const PROFILE = env.profile('profile2');
  fs.rmSync(PROFILE, { recursive: true, force: true }); // 每次干净启动，避免旧 SW 缓存挡住新代码
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--headless=new', '--disable-gpu', '--no-first-run',
    'about:blank',
  ], { stdio: 'ignore' });

  await sleep(2600);
  let target;
  for (let i = 0; i < 20; i++) {
    try {
      const list = await getJSON('/json/list');
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(400);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(2400);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  const script = fs.readFileSync(path.join(__dirname, 'logic-tests.js'), 'utf8');
  const results = await ev(`(function(){ ${script} })()`);

  console.log('\n===== 逻辑自测结果 =====');
  let pass = 0, fail = 0;
  results.forEach((r) => {
    if (r.ok) { pass++; console.log(`  ✅ ${r.name}`); }
    else { fail++; console.log(`  ❌ ${r.name}\n       ${r.msg}`); }
  });
  console.log(`\n通过 ${pass} / ${pass + fail}`);
  if (errors.length) console.log('\n运行期异常:\n' + errors.join('\n'));

  ws.close(); await env.stop(proc);
  await sleep(300);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试运行失败:', e); process.exit(1); });
