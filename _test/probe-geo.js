/* 几何探针：插图里的每个形状是否都在画布内、上下两半是否真的分开、两个头是否不重叠 */
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9414;
const PROFILE = env.profile('probe-geo');

async function main() {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  const child = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
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
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
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
  const sleep = (n) => new Promise((r) => setTimeout(r, n));

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/?p=' + Date.now() });
  await sleep(2600);
  await ev(`localStorage.clear(); location.reload(); 1`); await sleep(2600);
  await ev(`App.go('couple'); 1`); await sleep(400);
  await ev(`document.querySelector('#view-couple [data-cp="to-consent"]').click(); 1`); await sleep(400);
  await ev(`(() => { const sc=document.querySelector('#cp-consent-scroll'); sc.scrollTop=sc.scrollHeight; const cb=document.querySelector('#cp-agree'); cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#cp-consent-ok').click(); return 1; })()`);
  await sleep(500);
  await ev(`(() => { const me=document.querySelector('#cp-me'),peer=document.querySelector('#cp-peer'); me.value='小懒'; me.dispatchEvent(new Event('input',{bubbles:true})); peer.value='小满'; peer.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#cp-since').click(); return 1; })()`);
  await sleep(500);
  await ev(`(() => { const b=document.querySelector('#sheet-root [data-act="ok"]'); if(b) b.click(); return 1; })()`);
  await sleep(400);
  await ev(`document.querySelector('#cp-profile-ok').click(); 1`); await sleep(600);

  console.log(await ev(`(() => {
    const out = {};
    [].slice.call(document.querySelectorAll('#view-couple .cp-mode')).forEach((card) => {
      const k = card.getAttribute('data-mode');
      const svg = card.querySelector('svg');
      const vb = svg.viewBox.baseVal;
      const items = [].slice.call(svg.querySelectorAll('path, circle, rect, ellipse'));
      const bad = [];
      items.forEach((el, i) => {
        let b;
        try { b = el.getBBox(); } catch (e) { return; }
        if (b.x < vb.x - 0.5 || b.y < vb.y - 0.5 ||
            b.x + b.width > vb.x + vb.width + 0.5 ||
            b.y + b.height > vb.y + vb.height + 0.5) {
          bad.push({ i, tag: el.tagName, x: +b.x.toFixed(1), y: +b.y.toFixed(1),
                     w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
        }
      });
      out[k] = {
        viewBox: vb.width + 'x' + vb.height,
        shapes: items.length,
        outOfCanvas: bad,
      };
    });
    return JSON.stringify(out, null, 2);
  })()`));

  // 上下两半是否分开：异地那张图，y<55 与 y>55 的形状数
  console.log('remote 上下分布:', await ev(`(() => {
    const svg = document.querySelector('#view-couple .cp-mode[data-mode="remote"] svg');
    const top = [], bottom = [];
    [].slice.call(svg.querySelectorAll('path, circle, rect')).forEach((el, i) => {
      const b = el.getBBox();
      const cy = b.y + b.height / 2;
      (cy < 55 ? top : bottom).push(i);
    });
    return JSON.stringify({ topCount: top.length, bottomCount: bottom.length });
  })()`));

  // 同城那张：两个头（最大的两个 circle）圆心距 vs 半径和
  console.log('local 两个头:', await ev(`(() => {
    const svg = document.querySelector('#view-couple .cp-mode[data-mode="local"] svg');
    const c = [].slice.call(svg.querySelectorAll('circle'))
      .map((el) => ({ r: +el.getAttribute('r'), cx: +el.getAttribute('cx'), cy: +el.getAttribute('cy') }))
      .filter((x) => x.r >= 8 && x.r <= 12);
    if (c.length < 2) return 'only ' + c.length;
    const [a, b] = c;
    const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    return JSON.stringify({ a, b, dist: +d.toFixed(1), sumR: +(a.r + b.r).toFixed(1), overlap: d < a.r + b.r - 0.5 });
  })()`));

  ws.close(); child.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
}
main().catch((e) => { console.error(e); process.exit(1); });
