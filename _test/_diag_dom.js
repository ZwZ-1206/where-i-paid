// 诊断：页面里脚本到底加载了没？用 CDP 连 headless Edge 看 DOM/网络/异常。
const { spawn } = require('child_process');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9411;
const URL_ = 'http://127.0.0.1:4173/index.html';

const p = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Temp/diag-cdp', '--no-first-run', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });

setTimeout(async () => {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const pg = list.find((x) => x.type === 'page');
    const ws = new WebSocket(pg.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    await new Promise((r) => ws.addEventListener('open', r));
    const send = (me, pa) => new Promise((res, rej) => {
      const i = ++id;
      pend.set(i, (m) => (m.error ? rej(new Error(me + ': ' + m.error.message)) : res(m.result)));
      ws.send(JSON.stringify({ id: i, method: me, params: pa || {} }));
    });
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        console.log('EXC:', (d.exception && d.exception.description) || d.text);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        console.log('CERR:', m.params.args.map((a) => a.value || a.description).join(' '));
      if (m.method === 'Network.responseReceived')
        console.log('RESP', m.params.response.status, m.params.response.url.slice(0, 90));
      if (m.method === 'Network.loadingFailed')
        console.log('REQFAIL:', m.params.errorText, m.params.blockedReason || '');
    });
    await send('Page.navigate', { url: URL_ });
    await new Promise((r) => setTimeout(r, 4500));
    const ev = async (ex) => {
      const r = await send('Runtime.evaluate', { expression: ex, returnByValue: true });
      if (r.exceptionDetails) return 'THROW ' + r.exceptionDetails.text;
      return r.result.value;
    };
    console.log('readyState :', await ev('document.readyState'));
    console.log('scripts    :', await ev('document.querySelectorAll("script").length'));
    console.log('firstSrc   :', await ev('(document.querySelector("script")||{}).src'));
    console.log('swCtrl     :', await ev('!!navigator.serviceWorker.controller'));
    console.log('resources  :', await ev('performance.getEntriesByType("resource").map(r=>r.name.slice(-45)+" ts="+r.transferSize).join("\\n")'));
    console.log('App        :', await ev('typeof window.App'));
    console.log('Store      :', await ev('typeof window.Store'));
    p.kill();
  } catch (e) { console.log('ERR', e.message); p.kill(); }
  process.exit(0);
}, 2000);
