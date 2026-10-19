/* 临时：量模式页在三个视口下的插画框几何 + 截图，判断「有没有黑边 / 有没有被裁」。 */
'use strict';
const fs = require('fs');
const path = require('path');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9472;
const PROFILE = env.profile('probe-mode');
const URL = 'http://127.0.0.1:4180/index.html';
const OUT = env.shots('probe-mode'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(env.EDGE, env.edgeArgs(PORT, PROFILE).concat(['--window-size=390,844', URL]), { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params: params || {}, sessionId }));
  });
  const targets = await send('Target.getTargets');
  const page = targets.targetInfos.find((x) => x.type === 'page' && !/devtools|extension/.test(x.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const Sx = (m, p) => send(m, p, sessionId);
  await Sx('Page.enable'); await Sx('Runtime.enable');
  await Sx('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await Sx('Page.navigate', { url: URL });
  await sleep(2600);
  const ev = async (expr) => {
    const r = await Sx('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  for (let i = 0; i < 40; i++) {
    if (await ev('!!(window.Store && window.App && window.ViewCouple)').catch(() => false)) break;
    await sleep(250);
  }
  await ev(`(function(){
    const S = window.Store; const c = S.settings.couple || {};
    c.enabled = true; c.consent = Object.assign({}, c.consent || {}, { agreed: true, version: (window.ViewCouple.CONSENT_VERSION || 1) });
    c.meName='阿泽'; c.peerName='小满'; c.mode='k'; c.togetherSince='2026-03-14';
    S.settings.couple = c; S.save && S.save(); App.go('couple');
    const v = document.querySelector('#view-couple');
    window.ViewCouple.setPage('mode'); window.ViewCouple.render(v); return 1; })()`);
  await sleep(900);

  const geo = `(function(){
    const v = document.querySelector('#view-couple');
    const R = (el) => { if(!el) return null; const r = el.getBoundingClientRect(); return {w:+r.width.toFixed(1),h:+r.height.toFixed(1),top:+r.top.toFixed(1),bottom:+r.bottom.toFixed(1)}; };
    const arts = [].slice.call(document.querySelectorAll('#view-couple .cp-mode-art'));
    const imgs = [].slice.call(document.querySelectorAll('#view-couple .cp-art-img'));
    return {
      vh: innerHeight, view:{sh:v.scrollHeight, ch:v.clientHeight, padB:getComputedStyle(v).paddingBottom},
      cards: [].slice.call(document.querySelectorAll('#view-couple .cp-mode')).map(R),
      arts: arts.map(R),
      artRatio: arts.map(a => { const r=a.getBoundingClientRect(); return +(r.width/r.height).toFixed(3); }),
      imgs: imgs.map(im => { const b=im.getBoundingClientRect(); const s=Math.min(b.width/im.naturalWidth, b.height/im.naturalHeight);
        return {nat:im.naturalWidth+'x'+im.naturalHeight, fit:getComputedStyle(im).objectFit,
          drawnW:+(im.naturalWidth*s).toFixed(1), drawnH:+(im.naturalHeight*s).toFixed(1),
          padX:+((b.width-im.naturalWidth*s)/2).toFixed(1), padY:+((b.height-im.naturalHeight*s)/2).toFixed(1)}; }),
      hint: R(document.querySelector('#view-couple .cp-mode-hint')),
      top: R(document.querySelector('#view-couple .cp-onboard-top')),
      onboard: R(document.querySelector('#view-couple .cp-onboard')),
    };
  })()`;

  for (const [w, h] of [[375, 667], [390, 844], [430, 932]]) {
    await Sx('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await sleep(500);
    const g = await ev(geo);
    console.log(`\n=== ${w}x${h} ===`);
    console.log('scroll', g.view.sh, 'vs', g.view.ch, '| onboard', JSON.stringify(g.onboard));
    console.log('cards', JSON.stringify(g.cards));
    console.log('arts ', JSON.stringify(g.arts), 'ratios', JSON.stringify(g.artRatio));
    console.log('imgs ', JSON.stringify(g.imgs));
    console.log('top', JSON.stringify(g.top), 'hint', JSON.stringify(g.hint));
    await Sx('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    const r = await Sx('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `mode-${w}x${h}.png`), Buffer.from(r.data, 'base64'));
  }
  ws.close(); await env.stop(proc);
})().catch((e) => { console.error(e); process.exit(1); });
