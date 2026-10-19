/* 探针：验证同意页勾选框真的可见、模式页插图真的渲染出来了 */
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9412;
const PROFILE = env.profile('probe-consent2');

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
  if (!target) { console.log('no target'); child.kill(); return; }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/?p=' + Date.now() });
  await sleep(2600);
  await ev(`localStorage.clear(); location.reload(); 1`);
  await sleep(2600);

  await ev(`App.go('couple'); 1`); await sleep(400);
  await ev(`document.querySelector('#view-couple [data-cp="to-consent"]').click(); 1`); await sleep(500);

  console.log('=== 勾选框 ===');
  console.log(await ev(`(() => {
    const cb = document.querySelector('#view-couple #cp-agree');
    const box = document.querySelector('#view-couple .cp-box');
    const txt = document.querySelector('#view-couple .cp-check-text');
    if (!cb || !box || !txt) return 'MISSING cb=' + !!cb + ' box=' + !!box + ' txt=' + !!txt;
    const rb = box.getBoundingClientRect();
    const cs = getComputedStyle(box);
    const ib = cb.getBoundingClientRect();
    const ok = document.querySelector('#cp-consent-ok');
    return JSON.stringify({
      boxVisible: rb.width > 10 && rb.height > 10 && cs.opacity === '1',
      boxSize: Math.round(rb.width) + 'x' + Math.round(rb.height),
      boxBorder: cs.borderTopWidth + ' ' + cs.borderTopColor,
      boxBg: cs.backgroundColor,
      inputOpacity: getComputedStyle(cb).opacity,
      inputSize: Math.round(ib.width) + 'x' + Math.round(ib.height),
      btnDisabledBefore: ok.disabled,
      text: txt.textContent.trim(),
    });
  })()`));

  console.log('=== 勾上之后 ===');
  console.log(await ev(`(() => {
    const cb = document.querySelector('#cp-agree');
    const sc = document.querySelector('#cp-consent-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
    cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
    const box = document.querySelector('.cp-box');
    const cs = getComputedStyle(box);
    const ok = document.querySelector('#cp-consent-ok');
    return JSON.stringify({
      btnDisabledAfter: ok.disabled,
      boxBgChecked: cs.backgroundColor,
      iconOpacity: getComputedStyle(box.querySelector('.ic')).opacity,
    });
  })()`));

  console.log('=== 不勾选直接点按钮 ===');
  console.log(await ev(`(() => {
    const cb = document.querySelector('#cp-agree');
    const ok = document.querySelector('#cp-consent-ok');
    cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
    ok.click();
    return JSON.stringify({ stillOnConsent: !!document.querySelector('#cp-agree'), btnDisabled: ok.disabled });
  })()`));

  // 走到模式页
  await ev(`(() => { const cb=document.querySelector('#cp-agree'); const sc=document.querySelector('#cp-consent-scroll'); if(sc) sc.scrollTop=sc.scrollHeight; cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#cp-consent-ok').click(); return 1; })()`);
  await sleep(500);
  await ev(`(() => {
    const me=document.querySelector('#cp-me'), peer=document.querySelector('#cp-peer');
    me.value='小懒'; me.dispatchEvent(new Event('input',{bubbles:true}));
    peer.value='小满'; peer.dispatchEvent(new Event('input',{bubbles:true}));
    return 1;
  })()`);
  await sleep(200);
  await ev(`(() => {
    const btn = document.querySelector('#cp-since');
    if (btn) btn.click();
    return 1;
  })()`);
  await sleep(500);
  await ev(`(() => {
    const okBtn = document.querySelector('#sheet-root [data-act="ok"]');
    if (okBtn) okBtn.click();
    return 1;
  })()`);
  await sleep(500);
  console.log('profile ok disabled =', await ev(`(document.querySelector('#cp-profile-ok')||{}).disabled`));
  await ev(`document.querySelector('#cp-profile-ok').click(); 1`); await sleep(600);

  console.log('=== 模式页插图 ===');
  console.log(await ev(`(() => {
    const cards = [].slice.call(document.querySelectorAll('#view-couple .cp-mode'));
    return JSON.stringify(cards.map((c) => {
      const art = c.querySelector('.cp-mode-art');
      const svg = art && art.querySelector('svg');
      const r = art ? art.getBoundingClientRect() : null;
      return {
        mode: c.getAttribute('data-mode'),
        hasSvg: !!svg,
        aria: svg ? svg.getAttribute('aria-label') : null,
        artSize: r ? Math.round(r.width) + 'x' + Math.round(r.height) : null,
        childCount: svg ? svg.children.length : 0,
        paths: svg ? svg.querySelectorAll('path').length : 0,
        circles: svg ? svg.querySelectorAll('circle').length : 0,
        rects: svg ? svg.querySelectorAll('rect').length : 0,
        cardH: Math.round(c.getBoundingClientRect().height),
      };
    }));
  })()`));

  // 截图两张
  for (const [name, act] of [['consent', null], ['mode', null]]) {}
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const modeShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (modeShot.result && modeShot.result.data) {
    fs.writeFileSync(path.join(env.shots('probe-consent'), 'cp8-mode.png'), Buffer.from(modeShot.result.data, 'base64'));
    console.log('已覆盖 cp8-mode.png');
  }

  // 回到同意页截图
  await ev(`ViewCouple.setStep('consent'); ViewCouple.render(document.querySelector('#view-couple')); 1`);
  await sleep(500);
  await ev(`(() => { const cb=document.querySelector('#cp-agree'); if(cb){cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));} return 1; })()`);
  await sleep(300);
  const cShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (cShot.result && cShot.result.data) {
    fs.writeFileSync(path.join(env.shots('probe-consent'), 'cp4-consent-checked.png'), Buffer.from(cShot.result.data, 'base64'));
    console.log('已覆盖 cp4-consent-checked.png');
  }
  await ev(`(() => { const cb=document.querySelector('#cp-agree'); if(cb){cb.checked=false; cb.dispatchEvent(new Event('change',{bubbles:true}));} return 1; })()`);
  await sleep(300);
  const cShot2 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (cShot2.result && cShot2.result.data) {
    fs.writeFileSync(path.join(env.shots('probe-consent'), 'cp3-consent.png'), Buffer.from(cShot2.result.data, 'base64'));
    console.log('已覆盖 cp3-consent.png');
  }

  ws.close(); child.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
}
main().catch((e) => { console.error(e); process.exit(1); });
