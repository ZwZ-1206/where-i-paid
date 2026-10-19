/* 用 Chrome DevTools Protocol 驱动无头 Edge 做真实截图与错误采集 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const OUT = env.shots('shoot'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
const BASE = 'http://localhost:4173/index.html';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => { const c = new CDP(ws); c.attach(); resolve(c); };
      ws.onerror = (e) => reject(new Error('ws error'));
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  attach() {
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (this.onEvent) this.onEvent(msg);
      }
    };
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = env.profile('profile');
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=2',
    'about:blank',
  ], { stdio: 'ignore' });

  await sleep(2600);
  let target;
  for (let i = 0; i < 20; i++) {
    try {
      const list = await getJSON('/json/list');
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* retry */ }
    await sleep(400);
  }
  if (!target) { console.error('无法连接浏览器'); await env.stop(proc); process.exit(1); }

  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  cdp.attach();

  const errors = [];
  const logs = [];
  cdp.onEvent = (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = (m.params.args || []).map((a) => a.value || a.description || '').join(' ');
      logs.push(`[${m.params.type}] ${txt}`);
      if (m.params.type === 'error') errors.push(txt);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
    }
  };

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const shot = async (name) => {
    await sleep(520);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('  shot:', name);
  };

  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  const nav = async (hash) => {
    await evaluate(`location.hash = ${JSON.stringify(hash)}; App.go(${JSON.stringify(hash.replace('#',''))}); 1`);
  };

  console.log('打开应用…');
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(2200);

  const views = process.argv.slice(2).length ? process.argv.slice(2) : ['add', 'detail', 'report', 'goals', 'settings'];
  for (const v of views) {
    await nav('#' + v);
    await shot('01-' + v);
  }

  // 深色模式
  await evaluate(`Store.setSettings({theme:'dark'}); App.applyTheme(); 1`);
  for (const v of views) {
    await nav('#' + v);
    await shot('02-dark-' + v);
  }
  await evaluate(`Store.setSettings({theme:'light'}); App.applyTheme(); 1`);

  // 弹层
  await nav('#detail');
  await sleep(300);
  await evaluate(`document.querySelector('[data-tx]') && document.querySelector('[data-tx]').click(); 1`);
  await shot('03-tx-sheet');
  await evaluate(`UI.closeAllSheets(); 1`);

  await nav('#settings');
  await evaluate(`ViewSettings.openCycleSheet(); 1`);
  await shot('04-cycle-sheet');
  await evaluate(`UI.closeAllSheets(); 1`);

  await evaluate(`ViewSettings.openBudgetSheet(); 1`);
  await shot('05-budget-sheet');
  await evaluate(`UI.closeAllSheets(); 1`);

  await nav('#goals');
  await evaluate(`ViewGoals.openEditor(null); 1`);
  await shot('06-goal-editor');
  await evaluate(`UI.closeAllSheets(); 1`);

  // 数字键盘交互
  await nav('#add');
  await sleep(300);
  await evaluate(`document.querySelector('[data-key="1"]').click(); document.querySelector('[data-key="2"]').click(); document.querySelector('[data-key="3"]').click(); document.querySelector('[data-key="."]').click(); document.querySelector('[data-key="5"]').click(); 1`);
  await shot('07-typing');

  console.log('\n--- 控制台错误 ---');
  console.log(errors.length ? errors.join('\n') : '（无）');
  console.log('\n--- 日志 ---');
  console.log(logs.slice(0, 40).join('\n') || '（无）');

  cdp.ws.close(); await env.stop(proc);
  await sleep(400);
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e); process.exit(1); });
