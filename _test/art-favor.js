/* 视觉验收 2：红包 → 来自 TA 的偏爱 的双向闭环 + 深色。只用 DOM 断言。 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9432;
const PROFILE = env.profile('art-favor');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4180/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const say = (s) => console.log(s);
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
  try {
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
    ws.addEventListener('message', (evt) => {
      const m = JSON.parse(evt.data);
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
    await sleep(2800);
    const ev = async (expr) => {
      const r = await Sx('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
      return r.result.value;
    };

    // ---------- 准备 ----------
    await ev(`(function(){
      const S = window.Store;
      const c = S.settings.couple || {};
      c.enabled = true;
      c.consent = Object.assign({}, c.consent || {}, { agreed: true, version: (window.ViewCouple.CONSENT_VERSION || 1) });
      c.meName = '阿泽'; c.peerName = '小满'; c.mode = 'k'; c.togetherSince = '2026-03-14';
      S.settings.couple = c; S.save && S.save(); return 1;
    })()`);
    await sleep(200);

    // 通过真正的记账弹层记一笔「TA 发给我」的红包（走 UI 路径，验证 rpFrom 真的落了库）
    await ev(`App.go('couple')`);
    await sleep(400);
    const flow = await ev(`(function(){
      const out = {};
      const click = (sel) => { const b = document.querySelector(sel); if (b) { b.click(); return true; } return false; };
      out.add = click('#view-couple [data-cp="bill-add"]');
      return out;
    })()`);
    await sleep(500);
    const typed = await ev(`(function(){
      const inp = document.querySelector('#cbe-amount') || document.querySelector('.cbe input');
      if (!inp) return 'no-input';
      inp.value = '18.8';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#cbe-cat').click();
      return 'ok';
    })()`);
    await sleep(400);
    // m03610：catPicker 的格子是 .cp-item[data-id]，但它是**第二层弹层**
    // （套在记账弹层上）。'.cp-item' 不带 #sheet-root 范围限定会同时命中
    // 别的弹层里的同名单格，取到第一个可能不是我们要的那一个。
    // 这里取最后一张 sheet 里的那个格子。
    const pickRes = await ev(`(function(){
      const sheets = [].slice.call(document.querySelectorAll('#sheet-root .sheet'));
      if (!sheets.length) return 'no-sheet';
      const top = sheets[sheets.length - 1];
      const b = top.querySelector('.cp-item[data-id="redpacket"]');
      if (!b) return 'no-item';
      b.click();
      return 'clicked';
    })()`);
    await sleep(400);
    const hintAfter = await ev(`(function(){ const h = document.querySelector('#cbe-hint'); return h ? { t: h.textContent.trim(), cls: h.className, color: getComputedStyle(h).color, weight: getComputedStyle(h).fontWeight, fs: getComputedStyle(h).fontSize } : null; })()`);
    // m03610：归属改成「发给 TA」印记不带 redpacket 类名，选红包要选分类。
    // 保管按钮：拿 sheet 里最后一个 .btn--primary（记账弹层的「记下来」）。
    await ev(`(function(){
      const sheets = [].slice.call(document.querySelectorAll('#sheet-root .sheet'));
      if (!sheets.length) return 1;
      const top = sheets[sheets.length - 1];
      const all = [].slice.call(top.querySelectorAll('.btn--primary'));
      const b = all[all.length - 1];
      if (b) b.click();
      return 1;
    })()`);
    await sleep(600);
    const saved = await ev(`(function(){
      const S = window.Store; const list = S.cpActiveId ? S.cpTxsOf(S.cpActiveId()) : [];
      const red = list.filter(function(t){ return t.catId === 'redpacket'; });
      return { n: red.length, sample: red.slice(-1).map(function(t){ return { amt: t.amount, attrib: t.attrib, rpFrom: t.rpFrom, catId: t.catId }; }) };
    })()`);
    say('记账弹层：' + JSON.stringify(flow) + ' / 输入：' + typed);
    say('选红包后提示：' + JSON.stringify(hintAfter));
    say('落库：' + JSON.stringify(saved));
    await t('选红包后提示语写「来自 TA 的偏爱」', async () => hintAfter && /来自 TA 的偏爱/.test(hintAfter.t));
    await t('提示语变粉色（is-red 生效，颜色 != 默认灰）', async () => hintAfter && /is-red/.test(hintAfter.cls) && hintAfter.color !== 'rgb(138, 146, 160)');
    await t('记账真的写入了 rpFrom = me（我发给 TA，恒为 me）', async () => saved.n >= 1 && saved.sample[0].rpFrom === 'me');

    // 再造几笔：我发出去的红包、TA 发的、一笔普通账
    await ev(`(function(){
      const S = window.Store; const now = Date.now();
      S.cpAddTx({ type:'expense', amount: 520, catId:'redpacket', note:'生日快乐', attrib:'me', rpFrom:'me', ts: now - 86400000 });
      S.cpAddTx({ type:'expense', amount: 888, catId:'redpacket', note:'加班补偿', attrib:'peer', rpFrom:'peer', ts: now - 3 * 86400000 });
      S.cpAddTx({ type:'expense', amount: 60, catId:'food', note:'面', attrib:'both', ts: now - 60000 });
      S.cpAddTx({ type:'expense', amount: 99, catId:'redpacket', note:'旧红包', attrib:'peer', ts: now - 200 * 86400000 });
      return 1;
    })()`);
    await ev(`window.ViewCouple.setPage('home'); window.ViewCouple.render(document.querySelector('#view-couple'))`);
    await sleep(400);

    const card = await ev(`(function(){
      const c = document.querySelector('.cp-favor');
      if (!c) return { err: 'no-card' };
      const R = (el) => { const r = el.getBoundingClientRect(); return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1), bottom:+r.bottom.toFixed(1) }; };
      const cs = (el,p) => getComputedStyle(el).getPropertyValue(p);
      const rows = [].slice.call(c.querySelectorAll('.cp-favor-row')).map(function(r){
        return { top: (r.querySelector('.cp-favor-row-top')||{}).textContent, sub: (r.querySelector('.cp-favor-row-sub')||{}).textContent,
          amt: (r.querySelector('.cp-favor-amt')||{}).textContent, mine: !!r.querySelector('.cp-favor-amt.is-mine'),
          color: r.querySelector('.cp-favor-amt') ? cs(r.querySelector('.cp-favor-amt'),'color') : '' };
      });
      const v = document.querySelector('#view-couple');
      const inView = c.getBoundingClientRect().bottom <= 844 && c.getBoundingClientRect().top >= 0;
      return { r: R(c), radius: cs(c,'border-top-left-radius'), border: cs(c,'border-top-width')+' '+cs(c,'border-top-style'),
        bg: cs(c,'background-color'), title: (c.querySelector('.cp-favor-title')||{}).textContent,
        sum: (c.querySelector('.cp-favor-sum')||{}).textContent, rows: rows,
        foot: (c.querySelector('.cp-favor-foot')||{}).textContent,
        icW: (function(){ const i=c.querySelector('.cp-favor-ic svg'); return i ? +i.getBoundingClientRect().width.toFixed(1) : 0; })(),
        rowSvg: c.querySelectorAll('.cp-favor-row-ic svg').length,
        inView: inView, scrollH: v.scrollHeight, clientH: v.clientHeight };
    })()`);
    say('偏爱卡：' + JSON.stringify(card, null, 1));
    await t('首页出现「来自 TA 的偏爱」卡', async () => card && !card.err);
    await t('卡片标题 / 收到合计正确', async () => card.title === '来自 TA 的偏爱' && /[0-9]/.test(card.sum) && card.sum.length <= 8);
    // m03610：首页这张卡改成了「只列 TA 给我的」（口径定稿：红包是赠予不是请客，
    // 我自己发出去的那些不混进来）。两个方向的对照要到独立偏爱页看。
    await t('卡里只有 TA 给我的，不混自己发的', async () => card.rows.every((r) => r.top === 'TA 给你的红包'));
    await t('超过 40 天的旧红包不进卡（只算最近 40 天）', async () => card.rows.every((r) => !/旧红包/.test(r.sub || '')));
    await t('收到的金额是 +（正向）', async () => card.rows.length > 0 && card.rows.every((r) => /^\+/.test(r.amt)));
    await t('卡片用爱心图标（svg 内联）', async () => card.icW >= 14);
    await t('每行有红包小图标', async () => card.rowSvg >= 1);
    await t('卡片能直接看到（首屏内完整显示，不用滚动去找）', async () => card.inView && card.r.bottom <= 844);
    say('  首页总高 ' + card.scrollH + ' / 可视 ' + card.clientH + '（卡片之后的模块本来就在首屏外，不算回归）');
    await t('卡片高度 ≤ 170px（不挤掉下面的模块）', async () => card.r.h <= 170);

    const above = await ev(`(function(){
      const c = document.querySelector('.cp-favor');
      const R = (el) => { const r = el.getBoundingClientRect(); return { cls: (el.className||'').toString().slice(0,40), y: +r.y.toFixed(1), h: +r.height.toFixed(1), b: +r.bottom.toFixed(1) }; };
      const v = document.querySelector('#view-couple');
      const body = v.querySelector('.cp-scroll') || v.firstElementChild;
      const kids = [].slice.call((c.parentNode || v).children).map(R);
      const sc = [].slice.call(v.querySelectorAll('*')).filter(function(e){ return e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 100; }).slice(0,4).map(function(e){ return { cls:(e.className||'').toString().slice(0,32), sh:e.scrollHeight, ch:e.clientHeight }; });
      return { card: R(c), head: R(c.querySelector('.cp-favor-head')), rows: [].slice.call(c.querySelectorAll('.cp-favor-row')).map(R),
        foot: R(c.querySelector('.cp-favor-foot')), parentKids: kids.slice(0,8), scrollBoxes: sc };
    })()`);
    say('卡片结构：' + JSON.stringify(above, null, 1));
    // 深色
    const dark = await ev(`(function(){
      document.documentElement.setAttribute('data-theme','dark');
      return new Promise(function(res){ setTimeout(function(){
        const c = document.querySelector('.cp-favor');
        const cs = (el,p) => getComputedStyle(el).getPropertyValue(p);
        res({ bg: c ? cs(c,'background-color') : '', border: c ? cs(c,'border-top-color') : '',
          title: c ? cs(c.querySelector('.cp-favor-title'),'color') : '' });
      }, 200); });
    })()`);
    say('深色偏爱卡：' + JSON.stringify(dark));
    await t('深色下偏爱卡底色不是浅色白', async () => dark.bg && dark.bg !== 'rgb(255, 255, 255)');
    await ev(`document.documentElement.removeAttribute('data-theme')`);

    say('\n=== JS 异常 ===');
    say(jsErrors.length ? jsErrors.join('\n') : '（无）');
    say('通过 ' + pass + ' / 失败 ' + fail);
  } finally {
    try { proc.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
  process.exit(fail ? 1 : 0);
})();
