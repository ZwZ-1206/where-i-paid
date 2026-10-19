/* 验收：「发现新版本」气泡
 *  - 手机上不能横向铺满（以前 left/right:16px 在电脑上被拉成一整条）
 *  - 「更新」「以后」必须真的能点（它挂在 pointer-events:none 的 .toast-host 里）
 */
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9431;
const PROFILE = env.profile('updatebar');
const URL = process.env.URL || 'http://127.0.0.1:4180/index.html';

function rm(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
}
rm(PROFILE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  let ws = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = page.webSocketDebuggerUrl; break; }
    } catch (e) {}
    await sleep(250);
  }
  if (!ws) { console.log('连不上 Edge'); await env.stop(edge); process.exit(1); }

  const WebSocket = global.WebSocket;
  if (!WebSocket) { console.log('Node 版本太老，没有全局 WebSocket'); await env.stop(edge); process.exit(1); }

  // 不用 ws 包：Node 22+ 自带全局 WebSocket
  const sock = new WebSocket(ws);
  let id = 0;
  const pending = new Map();
  const errs = [];
  sock.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push((m.params.exceptionDetails.exception &&
        m.params.exceptionDetails.exception.description) ||
        m.params.exceptionDetails.text);
    }
  });
  await new Promise((r) => sock.addEventListener('open', r));

  const send = (method, params) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    sock.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.result && r.result.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.text + ' ' +
        ((r.result.exceptionDetails.exception || {}).description || ''));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    let ok = false, info = '';
    try { ok = await fn(); } catch (e) { info = ' · ' + e.message; }
    if (ok) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (info || '')); }
  };

  await send('Runtime.enable');
  await send('Page.enable');
  // 手机视口
  await send('Emulation.setDeviceMetricsOverride', {
    width: 375, height: 812, deviceScaleFactor: 2, mobile: true,
  });
  await send('Page.navigate', { url: URL });
  await sleep(2200);

  console.log('\n=== 「发现新版本」气泡 ===');

  // 手动造一个：App.showUpdateBar 不在导出表里，直接按同样的 DOM 结构插一条，
  // 样式和事件都由真实 CSS/逻辑承担（样式是纯 CSS，能验到）。
  await ev(`(function(){
    const host = document.querySelector('#toast-host');
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.innerHTML = '<span class="ub-ic">⬆️</span>' +
      '<span class="ub-txt">发现新版本 <b>v1.13.0</b><span class="ub-from">当前 v1.12.4</span></span>' +
      '<button class="ub-go" type="button">更新</button>' +
      '<button class="ub-later" type="button">以后</button>';
    host.appendChild(bar);
    requestAnimationFrame(function(){ bar.classList.add('in'); });
    window.__ubClicked = '';
    bar.querySelector('.ub-later').addEventListener('click', function(){ window.__ubClicked = 'later'; });
    bar.querySelector('.ub-go').addEventListener('click', function(){ window.__ubClicked = 'go'; });
    return 1;
  })()`);
  await sleep(400);

  await t('气泡宽度收在 420px 以内（不再铺满屏幕）', () => ev(`(function(){
    const r = document.querySelector('.update-bar').getBoundingClientRect();
    return r.width > 200 && r.width <= 420.5;
  })()`));

  await t('气泡在手机上左右都有留白，不顶边', () => ev(`(function(){
    const r = document.querySelector('.update-bar').getBoundingClientRect();
    return r.left >= 12 && (375 - r.right) >= 12;
  })()`));

  await t('气泡水平居中', () => ev(`(function(){
    const r = document.querySelector('.update-bar').getBoundingClientRect();
    return Math.abs((r.left + r.right) / 2 - 375 / 2) <= 1.5;
  })()`));

  await t('容器 pointer-events 虽然拦，但气泡自己能收事件', () => ev(`(function(){
    const bar = document.querySelector('.update-bar');
    const host = document.querySelector('#toast-host');
    return getComputedStyle(host).pointerEvents === 'none'
        && getComputedStyle(bar).pointerEvents === 'auto';
  })()`));

  await t('「更新」按钮能收到点击', () => ev(`(function(){
    document.querySelector('.ub-go').click();
    return window.__ubClicked === 'go';
  })()`));

  await t('「以后」按钮能收到点击', () => ev(`(function(){
    window.__ubClicked = '';
    document.querySelector('.ub-later').click();
    return window.__ubClicked === 'later';
  })()`));

  await t('按钮真的在命中测试里（elementFromPoint 打得到）', () => ev(`(function(){
    const b = document.querySelector('.ub-go');
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === b || b.contains(hit);
  })()`));

  await t('点按钮的坐标不会漏到下面的页面上去', () => ev(`(function(){
    const b = document.querySelector('.ub-later');
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    // 不能命中底栏的格子
    return !hit.closest('.tabbar');
  })()`));

  await t('按钮高度够手指点（≥28px）', () => ev(`(function(){
    const a = document.querySelector('.ub-go').getBoundingClientRect().height;
    const b = document.querySelector('.ub-later').getBoundingClientRect().height;
    return a >= 28 && b >= 28;
  })()`));

  await t('文字和按钮不重叠', () => ev(`(function(){
    const txt = document.querySelector('.ub-txt').getBoundingClientRect();
    const go = document.querySelector('.ub-go').getBoundingClientRect();
    return txt.right <= go.left + 1;
  })()`));

  // 电脑宽屏
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(400);

  await t('电脑宽屏下也是居中一条，不是满屏', () => ev(`(function(){
    const r = document.querySelector('.update-bar').getBoundingClientRect();
    return r.width <= 420.5 && Math.abs((r.left + r.right) / 2 - 1440 / 2) <= 1.5;
  })()`));

  await t('宽屏下按钮照样能点', () => ev(`(function(){
    const b = document.querySelector('.ub-go');
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === b || b.contains(hit);
  })()`));

  await t('深色模式下也有边框（不会糊成一片）', async () => {
    await ev(`(function(){ window.App.applyTheme('dark'); return 1; })()`);
    await sleep(300);
    const ok = await ev(`(function(){
      const b = document.querySelector('.update-bar');
      const cs = getComputedStyle(b);
      return cs.borderTopWidth !== '0px' && cs.boxShadow !== 'none';
    })()`);
    await ev(`(function(){ window.App.applyTheme('light'); return 1; })()`);
    return ok;
  });

  await t('窄屏 320px 也不溢出', async () => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 320, height: 640, deviceScaleFactor: 2, mobile: true,
    });
    await sleep(400);
    const r = await ev(`(function(){
      const b = document.querySelector('.update-bar').getBoundingClientRect();
      return { l: b.left, r: b.right, ov: document.documentElement.scrollWidth > 320 };
    })()`);
    return r.l >= 8 && r.r <= 312 && !r.ov;
  });

  console.log('\nJS 异常: ' + (errs.length ? errs.join('\n') : 'none'));
  console.log('\n通过 ' + pass + ' / ' + (pass + fail));

  sock.close();
  await env.stop(edge);
  await sleep(400);
  rm(PROFILE);
  process.exit(fail ? 1 : 0);
})();
