/* 反证：把 CSS 里的 pointer-events:auto 摘掉，确认「点不动」是可复现的真 bug */
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9432;
const PROFILE = env.profile('updatebar2');
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu', 'about:blank'],
    { stdio: 'ignore' });
  let ws = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = list.find((t) => t.type === 'page');
      if (p) { ws = p.webSocketDebuggerUrl; break; }
    } catch (e) {}
    await sleep(250);
  }
  const sock = new WebSocket(ws);
  let id = 0; const pending = new Map();
  sock.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    sock.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:4180/index.html' });
  await sleep(2200);

  const out = await ev(`(function(){
    const host = document.querySelector('#toast-host');
    const bar = document.createElement('div');
    bar.className = 'update-bar in';
    bar.innerHTML = '<span class="ub-ic">x</span><span class="ub-txt">发现新版本</span>' +
      '<button class="ub-go">更新</button><button class="ub-later">以后</button>';
    host.appendChild(bar);
    const b = bar.querySelector('.ub-go');
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    const hitOk = hit === b || b.contains(hit);

    // 模拟旧 CSS
    const st = document.createElement('style');
    st.textContent = '.update-bar{position:fixed;left:16px;right:16px;pointer-events:auto}.ub-go,.ub-later{pointer-events:auto}';
    document.head.appendChild(st);
    const r2 = bar.getBoundingClientRect();
    const hit2 = document.elementFromPoint(r2.left + 30, r2.top + r2.height/2);
    return { nowW: Math.round(r.width), nowHit: hitOk,
             oldW: Math.round(r2.width), oldHitAt30px: hit2 ? hit2.className : 'none',
             vw: innerWidth };
  })()`);

  console.log('新样子：宽 ' + out.nowW + 'px · 按钮可点 ' + out.nowHit);
  console.log('旧样子：宽 ' + out.oldW + 'px · 左侧 30px 命中 ' + out.oldHitAt30px);
  console.log('视口 ' + out.vw + 'px');
  sock.close(); await env.stop(edge); await sleep(300);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})();
