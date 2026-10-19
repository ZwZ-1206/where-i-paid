/* 诊断：加载页面并打印所有异常与失败请求 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9407;
const PROFILE = env.profile('diag');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', URL,
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) { /* 等 */ }
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
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

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      console.log('EXC:', (d.exception && d.exception.description) || d.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      console.log('CONSOLE-ERR:', m.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (m.method === 'Network.loadingFailed') {
      console.log('REQ-FAIL:', m.params.errorText, m.params.requestId);
    }
  });

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Network.enable');
  await S('Page.navigate', { url: URL });
  await sleep(3500);

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return 'THROW: ' + r.exceptionDetails.text;
    return r.result.value;
  };

  console.log('--- 探测 ---');
  console.log('App:', await ev('typeof window.App'));
  console.log('ViewCouple:', await ev('typeof window.ViewCouple'));
  console.log('Store:', await ev('typeof window.Store'));
  console.log('Icons:', await ev('typeof window.Icons'));
  console.log('U:', await ev('typeof window.U'));
  console.log('API:', await ev('typeof window.AI'));
  console.log('Scan:', await ev('typeof window.Scan'));
  console.log('Bills:', await ev('typeof window.Bills'));
  console.log('Remind:', await ev('typeof window.Remind'));
  console.log('Tips:', await ev('typeof window.Tips'));
  console.log('Extras:', await ev('typeof window.Extras'));
  console.log('OCR:', await ev('typeof window.OCR'));
  console.log('Charts:', await ev('typeof window.Charts'));
  console.log('UI:', await ev('typeof window.UI'));
  console.log('ViewAdd:', await ev('typeof window.ViewAdd'));
  console.log('ViewDetail:', await ev('typeof window.ViewDetail'));
  console.log('ViewReport:', await ev('typeof window.ViewReport'));
  console.log('ViewGoals:', await ev('typeof window.ViewGoals'));
  console.log('ViewSettings:', await ev('typeof window.ViewSettings'));

  ws.close();
  await env.stop(proc);})();
