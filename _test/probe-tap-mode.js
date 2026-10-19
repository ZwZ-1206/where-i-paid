'use strict';
/* 验证：手指点在模式卡里的 SVG / 文字 / 留白上，都能触发开通 */
const fs = require('fs'), path = require('path');
const env = require('./_env');
const { spawn } = require('child_process');
const PORT = 9441; const PROFILE = env.profile('tap'), URL = 'http://127.0.0.1:4173/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function session() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--disable-gpu', '--window-size=390,844', URL], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {} await sleep(250); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl); let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (m, p, s) => new Promise(res => { const myid = ++id; pend.set(myid, x => x.error ? (console.error(m, x.error.message), res(null)) : res(x.result)); ws.send(JSON.stringify({ id: myid, method: m, params: p || {}, sessionId: s })); });
  const t = await send('Target.getTargets'); const pg = t.targetInfos.find(x => x.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', { targetId: pg.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: URL }); await sleep(2600);
  const ev = async e => { const r = await S('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text); return r.result.value; };
  return { ev, proc, ws, S };
}

const setup = `(()=>{
  localStorage.clear(); Store.clearAll();
  Store.setSettings({ couple: { enabled:false, consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}},
    meName:'小懒', peerName:'小满', togetherSince:'2024-05-20' } });
  ViewCouple.setStep('mode'); App.go('couple'); return 1;
})()`;

// 对同一个元素派发真实触摸序列（touchstart/touchend + click）
const tapExpr = (sel) => `(()=>{
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'NOT_FOUND';
  const r = el.getBoundingClientRect();
  const x = r.left + r.width/2, y = r.top + r.height/2;
  const mk = (type) => {
    const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type==='touchend'?[]:[t], targetTouches: type==='touchend'?[]:[t], changedTouches: [t] });
  };
  el.dispatchEvent(mk('touchstart'));
  el.dispatchEvent(mk('touchend'));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch' }));
  // SVG 元素没有 .click()，用通用的合成 click 代替
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return 'ok';
})()`;

(async () => {
  const targets = [
    ['SVG 插画', '#view-couple [data-mode="local"] .cp-mode-art svg'],
    ['卡片文字', '#view-couple [data-mode="local"] .cp-mode-name'],
    ['卡片留白', '#view-couple [data-mode="local"]'],
  ];
  for (const [label, sel] of targets) {
    const { ev, proc, ws } = await session();
    await ev(setup); await sleep(600);
    const r = await ev(tapExpr(sel));
    await sleep(900);
    const st = await ev(`({enabled:Store.settings.couple.enabled, on:ViewCouple.on(), step:ViewCouple.step, entry:!!document.querySelector('#view-couple .cp-bill-entry')})`);
    console.log(label.padEnd(8), '→ tap:', r, '| ', JSON.stringify(st));
    ws.close(); await env.stop(proc);await sleep(400);
  }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
