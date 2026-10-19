/* 模式页铺满前后 + 红包图标的几何量测。只用 DOM 断言。 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9441;
const PROFILE = env.profile('art-mode');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4180/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const say = (s) => { console.log(s); out.push(s); };
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    const ok = await fn();
    if (ok) { pass++; say('  ✅ ' + name); } else { fail++; say('  ❌ ' + name); }
  } catch (e) { fail++; say('  ❌ ' + name + ' — ' + (e && e.message)); }
};

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', URL,
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const jsErrors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      jsErrors.push((d.exception && d.exception.description) || d.text);
    }
  });
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
  await Sx('Page.enable');
  await Sx('Runtime.enable');
  await Sx('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await Sx('Page.navigate', { url: URL });
  await sleep(2600);
  const ev = async (expr) => {
    const r = await Sx('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };

  await ev(`(function(){
    const S = window.Store;
    const c = S.settings.couple || {};
    c.enabled = true;
    c.consent = Object.assign({}, c.consent || {}, { agreed: true, version: (window.ViewCouple.CONSENT_VERSION || 1) });
    c.meName = '阿泽'; c.peerName = '小满'; c.mode = 'k';
    c.togetherSince = '2026-03-14';
    S.settings.couple = c; S.save && S.save();
    App.go('couple');
    const v = document.querySelector('#view-couple');
    window.ViewCouple.setPage('mode'); window.ViewCouple.render(v);
    return 1;
  })()`);
  await sleep(600);

  const geo = await ev(`(function(){
    const q = (s) => document.querySelector(s);
    const R = (el) => { const r = el.getBoundingClientRect(); return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1), bottom:+r.bottom.toFixed(1) }; };
    const view = q('#view-couple');
    const pad = q('#view-couple > .cp-onboard');
    const csPad = getComputedStyle(pad);
    return {
      vh: innerHeight,
      view: { sh: view.scrollHeight, ch: view.clientHeight, h: +view.getBoundingClientRect().height.toFixed(1), padB: getComputedStyle(view).paddingBottom },
      pad: { h: +pad.getBoundingClientRect().height.toFixed(1), padTop: csPad.paddingTop, padBot: csPad.paddingBottom, csH: csPad.height },
      vars: { tabh: getComputedStyle(document.documentElement).getPropertyValue('--tab-h'), safeb: getComputedStyle(document.documentElement).getPropertyValue('--safe-b') },
      onboard: R(pad),
      cards: [].slice.call(document.querySelectorAll('#view-couple .cp-mode')).map((c) => ({ name: (c.querySelector('.cp-mode-name')||{}).textContent, ...R(c) })),
      arts: [].slice.call(document.querySelectorAll('#view-couple .cp-mode-art')).map((a) => R(a)),
      img: (function(){
        const im = document.querySelector('#view-couple .cp-art-img');
        if (!im) return null;
        const cs = getComputedStyle(im);
        return { src: im.getAttribute('src'), objectFit: cs.objectFit, w: +im.getBoundingClientRect().width.toFixed(1), h: +im.getBoundingClientRect().height.toFixed(1), natural: im.naturalWidth + 'x' + im.naturalHeight,
          // object-fit 真正生效的那块「画布」：按框比例与图比例算出 contain 后的实际显示尺寸
          contain: (function(){
            const b = im.getBoundingClientRect(); const nw = im.naturalWidth, nh = im.naturalHeight;
            if (!nw || !nh) return null;
            const s = Math.min(b.width / nw, b.height / nh);
            return { w: +(nw * s).toFixed(1), h: +(nh * s).toFixed(1), scale: +s.toFixed(4) };
          })() };
      })(),
      hint: (function(){ const el = document.querySelector('#view-couple .cp-mode-hint'); return el ? R(el) : null; })(),
      pick: [].slice.call(document.querySelectorAll('#view-couple .cp-mode-pick')).map((p) => ({ txt: p.textContent.trim(), ...R(p) })),
      top: (function(){ const el = document.querySelector('#view-couple .cp-onboard-top'); return el ? R(el) : null; })(),
      gap: (document.querySelectorAll('#view-couple .cp-mode').length > 1) ? +(document.querySelectorAll('#view-couple .cp-mode')[1].getBoundingClientRect().top - document.querySelectorAll('#view-couple .cp-mode')[0].getBoundingClientRect().bottom).toFixed(1) : 0,
      csPad: getComputedStyle(pad).paddingBottom,
    };
  })()`);
  say('模式页几何：' + JSON.stringify(geo, null, 0));

  const vh = geo.vh;
  say('\n=== 模式页 ===');
  await t('没有滚动条（scrollHeight ≤ clientHeight）', () => geo.view.sh <= geo.view.ch + 1);
  await t('两张卡等高', () => geo.cards.length === 2 && Math.abs(geo.cards[0].h - geo.cards[1].h) < 0.6);
  await t('卡片铺满：卡片区把标题行到提示行之间的空间全部吃掉（上下各留 ≤ 14px）', () => {
    const topGap = geo.cards[0].y - geo.top.bottom;
    const botGap = geo.hint.y - geo.cards[1].bottom;
    return topGap >= 0 && topGap <= 14 && botGap >= 0 && botGap <= 14;
  });
  await t('卡片占视口高度 ≥ 60%（原版 30%）', () => (geo.cards[0].h + geo.cards[1].h + geo.gap) / vh >= 0.6);
  await t('底部不再有大片空白（提示行离卡片底 ≤ 20px；离视口底 ≤ 175px —— 其中 160px 是底部标签栏 + 安全区，38px 是 .view 自己的下边距）', () => geo.hint
    && (geo.hint.y - geo.cards[1].bottom) <= 20
    && (vh - geo.hint.bottom) <= 175);
  say('    提示行距卡片底 ' + (geo.hint.y - geo.cards[1].bottom).toFixed(1) + 'px；视口底还剩 ' + (vh - geo.hint.bottom).toFixed(1) + 'px（tabbar 156 + safe 4 + .view padding 6+26+4）');
  await t('两张卡等高且单卡 ≥ 250px', () => geo.cards.every((c) => c.h >= 250));
  await t('有插画且铺满整宽（宽度 = 卡宽 − 内边距）', () => geo.img && Math.abs(geo.arts[0].w - (geo.cards[0].w - 26)) <= 1.5 && geo.arts[0].w >= 260);
  /* 不裁切（用户 m01455 硬要求）：给 .cp-mode-art 一个 720:542 的框，再用 object-fit:contain，
     于是图的实际绘制尺寸 = min(框宽/原宽, 框高/原高) 等比缩放（scale），
     左右或上下多出来的只是留白。断言「图完整」= 绘制框比例 == 原图比例，且 contain 生效。 */
  await t('插画完整显示（不裁切）：绘制框比例 = 原图 720×542，误差 < 1%', () => {
    const c = geo.img && geo.img.contain;
    return !!c && Math.abs(c.w / c.h - 720 / 542) / (720 / 542) < 0.01;
  });
  await t('插画完整显示（不裁切）：object-fit = contain', () => geo.img && geo.img.objectFit === 'contain');
  await t('插画与图片原始比例一致（natural 720×542）', () => geo.img && geo.img.natural === '720x542');
  await t('插画读得出画意：实际绘制高度 ≥ 140px', () => geo.img && geo.img.contain && geo.img.contain.h >= 140);

  // 滚动兜底：更矮的安卓屏
  await Sx('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const small = await ev(`(function(){
    const v = document.querySelector('#view-couple');
    return { sh: v.scrollHeight, ch: v.clientHeight, art: +(document.querySelector('.cp-mode-art') ? document.querySelector('.cp-mode-art').getBoundingClientRect().width : 0).toFixed(1) };
  })()`);
  say('矮屏 390×700：' + JSON.stringify(small));
  await t('390×700 也不出滚动条', () => small.sh <= small.ch + 1);

  // 更矮（iPhone SE / 小号安卓 375×667）
  await Sx('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const se = await ev(`(function(){
    const v = document.querySelector('#view-couple');
    const cards = [].slice.call(document.querySelectorAll('#view-couple .cp-mode'));
    const art = document.querySelector('#view-couple .cp-mode-art');
    const hint = document.querySelector('#view-couple .cp-mode-hint');
    const R = (el) => el ? +el.getBoundingClientRect().height.toFixed(1) : 0;
    return { sh: v.scrollHeight, ch: v.clientHeight,
      cardH: cards.map((c) => +c.getBoundingClientRect().height.toFixed(1)),
      artW: art ? +art.getBoundingClientRect().width.toFixed(1) : 0,
      artH: art ? +art.getBoundingClientRect().height.toFixed(1) : 0,
      artW: art ? +art.getBoundingClientRect().width.toFixed(1) : 0,
      drawn: (function(){
        const im = document.querySelector('#view-couple .cp-art-img');
        if (!im || !im.naturalWidth) return null;
        const b = im.getBoundingClientRect(); const s = Math.min(b.width / im.naturalWidth, b.height / im.naturalHeight);
        return { w: +(im.naturalWidth * s).toFixed(1), h: +(im.naturalHeight * s).toFixed(1) };
      })(),
      hintBottom: hint ? +hint.getBoundingClientRect().bottom.toFixed(1) : 0 };
  })()`);
  say('矮屏 375×667：' + JSON.stringify(se));
  await t('375×667 也不出滚动条', () => se.sh <= se.ch + 1);
  await t('375×667 插画完整显示（不裁切）：绘制框比例 = 原图，误差 < 1.5%', () => se.drawn && Math.abs(se.drawn.w / se.drawn.h - 720 / 542) / (720 / 542) < 0.015);
  await t('375×667 插画仍铺满卡宽（≤ 卡宽 − 内边距，且 ≥ 280）', () => se.artW >= 280);
  if (se.artH < 60) {
    say('    诊断：card=' + JSON.stringify(se.cardH) + ' artW=' + se.artW + ' artH=' + se.artH);
    const diag = await ev(`(function(){
      const card = document.querySelector('#view-couple .cp-mode');
      const art = document.querySelector('#view-couple .cp-mode-art');
      const body = document.querySelector('#view-couple .cp-mode-body');
      const cs = getComputedStyle(card);
      const ca = getComputedStyle(art);
      const cb = getComputedStyle(body);
      let chain = [];
      let el = art.parentElement;
      while (el && el !== document.body) { const s = getComputedStyle(el); chain.push((el.className||el.tagName)+' h='+el.getBoundingClientRect().height.toFixed(1)+' disp='+s.display); el = el.parentElement; }
      return { cardPad: cs.padding, cardDisp: cs.display, cardDir: cs.flexDirection,
        artH: ca.height, artMax: ca.maxHeight, artFlex: ca.flex, artDisplay: ca.display,
        bodyH: body.getBoundingClientRect().height.toFixed(1), bodyFlex: cb.flex, bodyMin: cb.minHeight,
        bodyScroll: body.scrollHeight, chain: chain };
    })()`);
    say('    ' + JSON.stringify(diag));
    // A/B：同一条规则换成 px 上限，看重排后能不能拿到 80
    const ab = await ev(`(function(){
      const art = document.querySelector('#view-couple .cp-mode-art');
      const before = art.getBoundingClientRect().height;
      art.style.setProperty('max-height', '80px', 'important');
      art.getBoundingClientRect();
      const after = art.getBoundingClientRect().height;
      const cs = getComputedStyle(art);
      return { before: +before.toFixed(1), after: +after.toFixed(1), maxH: cs.maxHeight, flex: cs.flex };
    })()`);
    say('    A/B（max-height:80px !important）：' + JSON.stringify(ab));
    const grid = await ev(`(function(){
      const g = document.querySelector('#view-couple .cp-mode-grid');
      const ob = document.querySelector('#view-couple .cp-onboard');
      const v = document.querySelector('#view-couple');
      const S = (el) => el ? { h: +el.getBoundingClientRect().height.toFixed(1), top: +el.getBoundingClientRect().top.toFixed(1), bottom: +el.getBoundingClientRect().bottom.toFixed(1), cs: getComputedStyle(el).flex, minH: getComputedStyle(el).minHeight, disp: getComputedStyle(el).display } : null;
      return { grid: S(g), onboard: S(ob), view: S(v),
        onboardPad: ob ? getComputedStyle(ob).padding : '', onboardCsH: ob ? getComputedStyle(ob).height : '',
        gridScroll: g ? g.scrollHeight : 0 };
    })()`);
    say('    容器链：' + JSON.stringify(grid));
    const cardDiag = await ev(`(function(){
      const c = document.querySelector('#view-couple .cp-mode');
      return { cs: getComputedStyle(c).flex, h: +c.getBoundingClientRect().height.toFixed(1), minH: getComputedStyle(c).minHeight };
    })()`);
    say('    卡片：' + JSON.stringify(cardDiag));
    const g2 = await ev(`(function(){
      const g = document.querySelector('#view-couple .cp-mode-grid');
      const c = getComputedStyle(g);
      const kids = [].slice.call(g.children).map((x) => ({ h: +x.getBoundingClientRect().height.toFixed(1), cs: getComputedStyle(x).flexShrink, basis: getComputedStyle(x).flexBasis, csH: getComputedStyle(x).height }));
      return { gridH: +g.getBoundingClientRect().height.toFixed(1), csH: c.height, flex: c.flex, minH: c.minHeight, pad: c.padding, box: c.boxSizing,
        kids: kids, kidsSum: kids.reduce((a, b) => a + b.h, 0) };
    })()`);
    say('    卡片区：' + JSON.stringify(g2));
  }

  // 更高的屏（iPhone 15 Pro Max 430×932）
  await Sx('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const max = await ev(`(function(){
    const v = document.querySelector('#view-couple');
    const cards = [].slice.call(document.querySelectorAll('#view-couple .cp-mode'));
    const art = document.querySelector('#view-couple .cp-mode-art');
    return { sh: v.scrollHeight, ch: v.clientHeight,
      cardH: cards.map((c) => +c.getBoundingClientRect().height.toFixed(1)),
      artH: art ? +art.getBoundingClientRect().height.toFixed(1) : 0,
      artW: art ? +art.getBoundingClientRect().width.toFixed(1) : 0,
      drawn: (function(){
        const im = document.querySelector('#view-couple .cp-art-img');
        if (!im || !im.naturalWidth) return null;
        const b = im.getBoundingClientRect(); const s = Math.min(b.width / im.naturalWidth, b.height / im.naturalHeight);
        return { w: +(im.naturalWidth * s).toFixed(1), h: +(im.naturalHeight * s).toFixed(1) };
      })() };
  })()`);
  say('大屏 430×932：' + JSON.stringify(max));
  await t('430×932 也不出滚动条', () => max.sh <= max.ch + 1);
  await t('430×932 插画完整显示（不裁切）', () => max.drawn && Math.abs(max.drawn.w / max.drawn.h - 720 / 542) / (720 / 542) < 0.015);

  await Sx('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);

  // 深色
  await ev(`document.documentElement.setAttribute('data-theme','dark'); 1`);
  await sleep(300);
  const dark = await ev(`(function(){
    const card = document.querySelector('#view-couple .cp-mode');
    const cs = getComputedStyle(card);
    const art = document.querySelector('#view-couple .cp-mode-art');
    return { cardBg: cs.backgroundColor, cardBorder: cs.borderTopColor,
      nameColor: getComputedStyle(document.querySelector('#view-couple .cp-mode-name')).color,
      liColor: getComputedStyle(document.querySelector('#view-couple .cp-mode-list li')).color,
      pickColor: getComputedStyle(document.querySelector('#view-couple .cp-mode-pick')).color,
      artBg: getComputedStyle(art).backgroundColor };
  })()`);
  say('深色：' + JSON.stringify(dark));
  await t('深色下卡片不是白底（亮度 < 90）', () => {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(dark.cardBg); if (!m) return false;
    return (+m[1] + +m[2] + +m[3]) / 3 < 90;
  });
  await t('深色下插画底色仍是深蓝（不是白的）', () => {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(dark.artBg); if (!m) return false;
    return (+m[1] + +m[2] + +m[3]) / 3 < 80 && +m[3] > +m[1];
  });
  await t('深色下状态文字是品牌蓝（没被冲淡成灰）', () => /rgb\(1[01]\d, 1[45]\d, 2\d\d\)/.test(dark.pickColor));
  await ev(`document.documentElement.removeAttribute('data-theme'); 1`);
  await sleep(200);

  // 引导流程里的模式页（stepMode，另一个渲染函数、没有返回键）
  const ob = await ev(`(function(){
    const S = window.Store;
    const keep = JSON.parse(JSON.stringify(S.settings.couple));
    // 造一个「已同意、资料齐、但还没选模式」的状态
    const c = S.settings.couple;
    c.mode = '';
    S.settings.couple = c;
    const v = document.querySelector('#view-couple');
    window.ViewCouple.setPage('onboarding');
    window.ViewCouple.render(v);
    const R = (el) => { const r = el.getBoundingClientRect(); return { y: +r.y.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1) }; };
    const cards = [].slice.call(document.querySelectorAll('#view-couple .cp-mode'));
    const res = {
      shown: cards.length,
      hasBack: !!document.querySelector('#view-couple [data-cp="mode-back"]'),
      scrolls: v.scrollHeight > v.clientHeight + 1,
      sh: v.scrollHeight, ch: v.clientHeight,
      cards: cards.map((x) => Object.assign({ name: x.querySelector('.cp-mode-name').textContent, dp: x.getAttribute('data-cp') }, R(x))),
      artH: document.querySelector('#view-couple .cp-mode-art') ? +document.querySelector('#view-couple .cp-mode-art').getBoundingClientRect().height.toFixed(1) : 0,
      hintBottom: document.querySelector('#view-couple .cp-mode-hint') ? +document.querySelector('#view-couple .cp-mode-hint').getBoundingClientRect().bottom.toFixed(1) : 0,
    };
    S.settings.couple = keep; S.save && S.save();
    return res;
  })()`);
  say('\n=== 引导流程里的模式页（stepMode）===');
  say(JSON.stringify(ob));
  await t('引导里也出现两张铺满的卡（data-cp="mode"）', () => ob.shown === 2 && ob.cards.every((c) => c.dp === 'mode'));
  await t('引导里两张卡等高且在 200~340 之间', () => Math.abs(ob.cards[0].h - ob.cards[1].h) < 0.6 && ob.cards[0].h >= 200 && ob.cards[0].h <= 340);
  await t('引导里插画是有效的（≥ 60 高），没被压成 0', () => ob.artH >= 60 && ob.artH <= 160);
  await t('引导里也不出滚动条', () => ob.scrolls === false);
  await ev(`(function(){ const S=window.Store; const c=S.settings.couple; c.mode='local'; S.settings.couple=c; S.save&&S.save(); const v=document.querySelector('#view-couple'); window.ViewCouple.setPage('mode'); window.ViewCouple.render(v); return 1; })()`);
  await sleep(400);

  say('\n=== 红包图标 ===');
  const ic = await ev(`(function(){
    const V = window.ViewCouple;
    const c = window.Icons.cat('redpacket');
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-999px;top:0;font-size:50px;color:#FF6A9B';
    host.innerHTML = window.Icons.catIcon(c);
    document.body.appendChild(host);
    const svg = host.querySelector('svg');
    const paths = [].slice.call(svg.querySelectorAll('path'));
    const r = svg.getBoundingClientRect();
    const H = r.height;
    const box = svg.getBBox();
    const seg = paths.map(function(p){
      const b = p.getBBox();
      const a = p.getTotalLength();
      // 采样 40 点，量真实笔迹的极值（比 getBBox 更接近眼睛看到的）
      let minX=1e9, maxX=-1e9, minY=1e9, maxY=-1e9;
      for (let i=0;i<=40;i++){
        const pt = p.getPointAtLength(a*i/40);
        minX=Math.min(minX,pt.x); maxX=Math.max(maxX,pt.x);
        minY=Math.min(minY,pt.y); maxY=Math.max(maxY,pt.y);
      }
      return { len:+a.toFixed(1), x:+b.x.toFixed(1), y:+b.y.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1),
        ink:{ x0:+minX.toFixed(2), x1:+maxX.toFixed(2), y0:+minY.toFixed(2), y1:+maxY.toFixed(2) },
        flat: (maxY-minY) < 0.4, tall: (maxX-minX) < 0.4 };
    });
    const res = {
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      bbox: { x:+box.x.toFixed(2), y:+box.y.toFixed(2), w:+box.width.toFixed(2), h:+box.height.toFixed(2) },
      inside: box.x >= 0 && box.y >= 0 && box.x + box.width <= 24.001 && box.y + box.height <= 24.001,
      overflowPx: Math.round(Math.max(0, -box.x, -box.y, box.x + box.width - 24, box.y + box.height - 24) * 100) / 100,
      paths: seg,
      strokeW: svg.getAttribute('stroke-width'),
      dash: getComputedStyle(paths[0]).strokeDasharray,
      fill: getComputedStyle(paths[0]).fill,
      color: getComputedStyle(svg).color,
      pc: paths.length,
    };
    host.remove();
    return res;
  })()`);
  say(JSON.stringify(ic));
  const P = ic.paths;
  const bodyPath = P[0], flap = P[1], heart = P[2];
  await t('只有 3 段路径（信封 / 封口条 / 心）', () => ic.pc === 3);
  await t('信封是竖长方形（h > w，h ≥ 18）', () => bodyPath && bodyPath.h > bodyPath.w && bodyPath.h >= 18);
  await t('封口条是一条水平直线（高 < 0.4）', () => flap && flap.flat === true && flap.w >= 15);
  await t('封口条横跨信封两侧（w ≥ 信封 w × 0.9）', () => flap.w >= bodyPath.w * 0.9);
  await t('爱心骑在封口条上：心的顶点压在条上（心顶 − 条 y 在 0~1），左右两瓣对称居中 12', () => {
    const fx = (flap.ink.x0 + flap.ink.x1) / 2;
    const cx = (heart.ink.x0 + heart.ink.x1) / 2;
    const dy = heart.ink.y0 - flap.y;
    return dy >= -0.4 && dy <= 1.0 && Math.abs(cx - 12) < 0.6 && Math.abs(fx - 12) < 0.6;
  });
  await t('爱心是心形而不是三角/菱形（宽 ≥ 5.5、高 ≥ 4.5、宽/高 在 1.1~1.45）', () => {
    const w = heart.ink.x1 - heart.ink.x0, h = heart.ink.y1 - heart.ink.y0;
    return w >= 5.5 && h >= 4.5 && w / h >= 1.1 && w / h <= 1.45;
  });
  await t('爱心在封口条下方（不跑到信封上半截）', () => heart.ink.y0 >= flap.y - 0.4 && heart.ink.y1 > flap.y + 3);
  await t('整体不越出 24×24（含 1.7 描边的一半）', () => {
    // getBBox() 只算路径中心线；信封画在 3.8 / 20.2 / 2.8 / 21.2，
    // 描边外沿 = 中心线 ± 0.85，即 2.95…21.05 / 1.95…22.05，仍在 24 画布内。
    const hw = 1.7 / 2;
    const okX = (ic.bbox.x - hw) >= 0 && (ic.bbox.x + ic.bbox.w + hw) <= 24;
    const okY = (ic.bbox.y - hw) >= 0 && (ic.bbox.y + ic.bbox.h + hw) <= 24;
    say('    描边外沿：x ' + (ic.bbox.x - hw).toFixed(2) + '…' + (ic.bbox.x + ic.bbox.w + hw).toFixed(2)
      + ' / y ' + (ic.bbox.y - hw).toFixed(2) + '…' + (ic.bbox.y + ic.bbox.h + hw).toFixed(2)
      + '（okX=' + okX + ' okY=' + okY + ' overflowPx=' + ic.overflowPx + '）');
    return ic.inside === true && ic.overflowPx === 0 && okX && okY;
  });
  await t('50px 下实际显示 ≥ 40px', () => ic.w >= 40 && Math.abs(ic.w - ic.h) < 0.6);
  await t('没有虚线 / 没有填充（线条风）', () => ic.dash === 'none' && /none|rgba\(0, 0, 0, 0\)/.test(ic.fill));
  await t('颜色跟随分类色（currentColor）', () => /rgb\(255, 106, 155\)/.test(ic.color));

  say('\n=== 红包在几个真实容器里的尺寸 ===');
  const places = await ev(`(function(){
    const c = window.Icons.cat('redpacket');
    const mk = (cls, font) => { const d = document.createElement('div'); d.className = cls; d.style.cssText = 'position:absolute;left:-999px;top:0;' + (font||'');
      d.innerHTML = window.Icons.catIcon(c); document.body.appendChild(d); const s = d.querySelector('svg').getBoundingClientRect(); d.remove(); return +s.width.toFixed(1); };
    return {
      bubble: mk('cp-bubble', 'font-size:50px'),
      calendar: mk('cp-cal-ic', 'font-size:11px'),
      billAvatar: mk('cp-bill-avatar', 'font-size:20px'),
      cfa: mk('cfa-ic', 'font-size:22px'),
      popInline: mk('cfa-ic', 'font-size:22px'),
    };
  })()`);
  say(JSON.stringify(places));
  await t('日历格子里的图标 10~12px（看得见但不糊）', () => places.calendar >= 10 && places.calendar <= 12.5);
  await t('记账气泡里 50px 字号下 ≥ 60px', () => places.bubble >= 60);

  say('\n=== JS 异常 ===');
  say(jsErrors.length ? jsErrors.slice(0, 5).join('\n') : '（无）');
  await t('没有 JS 异常', () => jsErrors.length === 0);

  say('\n通过 ' + pass + ' / 失败 ' + fail);
  fs.writeFileSync('C:\\Code\\Jizhang\\_test\\_art-mode.log', out.join('\n'), 'utf8');
  await env.stop(proc);
  process.exit(fail ? 1 : 0);
})();
