/* 品牌改名验收截图：闪屏 + 设置页关于区 + 桌面图标位 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9341;
const PROFILE = env.profile('brand');
const WEB = 4190;
const ROOT = path.join(__dirname, '..');
const OUT = env.shots('shoot-brand'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(url.parse(req.url).pathname);
  let file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static connect(u) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(u);
      ws.onopen = () => { const c = new CDP(ws); c.attach(); resolve(c); };
      ws.onerror = () => reject(new Error('ws error'));
    });
  }
  attach() {
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method && this.onEvent) this.onEvent(m);
    };
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(WEB, r));

  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + PROFILE,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=2', 'about:blank',
  ], { stdio: 'ignore' });

  await sleep(2600);
  let target;
  for (let i = 0; i < 20; i++) {
    try { target = (await getJSON('/json/list')).find((t) => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(400);
  }
  if (!target) { console.error('无法连接浏览器'); await env.stop(proc); process.exit(1); }

  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  const errors = [];
  cdp.onEvent = (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
    }
  };
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    await sleep(480);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('  shot:', name);
  };

  console.log('打开应用…');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${WEB}/index.html` });
  await sleep(2400);

  // 1) 复现启动闪屏（App 启动后会把 #splash 从 DOM 移除，这里按 index.html 的原始结构重建）
  await evaluate(`(() => {
    const s = document.createElement('div');
    s.id = 'splash'; s.className = 'splash';
    s.innerHTML = '<img class="splash-logo" src="assets/icons/icon.svg" alt="花哪儿了" />'
      + '<div class="splash-name">花哪儿了</div>'
      + '<div class="splash-tip">正在准备你的账本…</div>';
    document.body.appendChild(s);
    s.querySelector('.splash-logo').style.animation = 'none';
    return 1;
  })()`);
  await shot('b1-splash');

  // 2) 设置页（关于/版本区）
  await evaluate(`(() => {
    const s = document.getElementById('splash'); if (s) s.remove();
    App.go('settings'); return 1;
  })()`);
  await sleep(500);
  await shot('b2-settings-top');
  await evaluate(`window.scrollTo(0, document.body.scrollHeight); 1`);
  await evaluate(`(() => { const m=document.getElementById('views'); if(m) m.scrollTop = m.scrollHeight; document.querySelectorAll('.view').forEach(v=>v.scrollTop=v.scrollHeight); return 1; })()`);
  await shot('b3-settings-bottom');

  // 3) 文档标题与图标
  const info = await evaluate(`(() => {
    const g = (sel, attr) => { const el = document.querySelector(sel); return el ? (attr ? el.getAttribute(attr) : el.textContent) : null; };
    return JSON.stringify({
      title: document.title,
      apple: g('meta[name="apple-mobile-web-app-title"]', 'content'),
      desc: g('meta[name="description"]', 'content'),
      splashLogo: g('.splash-logo') ? g('.splash-logo', 'src') : '(已移除)'
    });
  })()`);
  console.log('\n--- 元信息 ---');
  console.log(info);

  const man = await evaluate(`fetch('manifest.webmanifest').then(r=>r.json()).then(m=>JSON.stringify({name:m.name,short_name:m.short_name,desc:m.description}))`);
  console.log('manifest:', man);

  console.log('\n--- 控制台错误 ---');
  console.log(errors.length ? errors.join('\n') : '（无）');

  cdp.ws.close(); await env.stop(proc);
  server.close();
  await sleep(400);
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
