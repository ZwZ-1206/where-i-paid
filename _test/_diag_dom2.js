// 第二轮：navigate 后 dump 实际 DOM，确认浏览器到底拿到了什么。
const { spawn } = require('child_process');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9412;
const URL_ = 'http://127.0.0.1:4173/index.html';

const p = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Temp/diag-cdp2', '--no-first-run', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });

setTimeout(async () => {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const pg = list.find((x) => x.type === 'page');
    const ws = new WebSocket(pg.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    const events = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
      if (m.method) events.push(m.method + (m.params && m.params.response ? ' ' + m.params.response.url.slice(-50) : ''));
    });
    await new Promise((r) => ws.addEventListener('open', r));
    const send = (me, pa) => new Promise((res, rej) => {
      const i = ++id;
      pend.set(i, (m) => (m.error ? rej(new Error(me + ': ' + m.error.message)) : res(m.result)));
      ws.send(JSON.stringify({ id: i, method: me, params: pa || {} }));
    });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: URL_ });
    // 等 Page.loadEventFired，最多 15s
    const t0 = Date.now();
    while (!events.some((e) => e.startsWith('Page.loadEventFired')) && Date.now() - t0 < 15000) {
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log('loadEventFired:', events.some((e) => e.startsWith('Page.loadEventFired')));
    await new Promise((r) => setTimeout(r, 1500));
    const ev = async (ex) => {
      const r = await send('Runtime.evaluate', { expression: ex, returnByValue: true });
      if (r.exceptionDetails) return 'THROW ' + r.exceptionDetails.text;
      return r.result.value;
    };
    console.log('url   :', await ev('location.href'));
    console.log('html@0:', String(await ev('document.documentElement.outerHTML.slice(0,400)')).replace(/\n/g, ' | '));
    console.log('scripts:', await ev('document.querySelectorAll("script").length'));
    console.log('App   :', await ev('typeof window.App'));
    p.kill();
  } catch (e) { console.log('ERR', e.message); p.kill(); }
  process.exit(0);
}, 2000);
