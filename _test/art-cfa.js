/* 「这笔情侣账」弹层（.cfa）：布局断言 + 操作后是否当场刷新。
   只用 DOM 断言，不靠看图。 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9437;
const PROFILE = env.profile('art-cfa');
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
  // m03610：cache 放在 profile 里（默认是 Code Cache/GPUCache 之类），
  // run-all 量「临时 profile 残留」时这些目录也要跟着删，否则一跑 20 MB 起。
  // env.stop() 只删 PROFILE 根，Edge 会把缓存往 os.tmpdir() 下的
  // 独立目录里落一份，这里在 finally 里连根一起兜掉。
  process.on('exit', () => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} });

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

  // 造数据：一个月内有若干笔账，其中一笔是红包
  const seed = async () => ev(`(function(){
    const S = window.Store;
    try { localStorage.clear(); } catch(e) {}
    S.init && S.init();
    const c = S.settings.couple || {};
    c.enabled = true;
    c.consent = Object.assign({}, c.consent || {}, { agreed: true, version: (window.ViewCouple.CONSENT_VERSION || 1) });
    c.meName = '阿泽'; c.peerName = '小满'; c.mode = 'k';
    c.togetherSince = '2026-03-14';
    S.settings.couple = c;
    S.save && S.save();
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const mk = (day, catId, amount, note, attrib) => S.cpAddTx({
      type: 'expense', amount, catId, note, attrib, ts: base + day * 86400000 + 43200000,
    });
    mk(2, 'food', 6800, '街角面馆', 'me');
    mk(6, 'redpacket', 5200, '给 TA 的红包', 'me');
    mk(9, 'fun', 12000, '', 'both');
    App.go('couple');
    return S.cpTxs().length;
  })()`);
  say('造账：' + await seed());
  await sleep(400);

  const openFromCalendar = async () => ev(`(function(){
    document.querySelectorAll('[data-cp="sub-back"]').forEach(function(b){ b.click(); });
    const view = document.querySelector('#view-couple');
    if (window.ViewCouple.render) window.ViewCouple.setPage('memories');
    window.ViewCouple.render(view);
    const cell = document.querySelector('#view-couple [data-calday]');
    if (cell) cell.click();
    return document.querySelectorAll('#view-couple .cp-brief-row').length;
  })()`);

  // 进日历页后点一个「有账」的格子，再点里面的一条账单
  await ev(`(function(){ const v=document.querySelector('#view-couple'); window.ViewCouple.setPage('memories'); window.ViewCouple.render(v); })()`);
  await sleep(300);
  const inCal = await ev(`(function(){
    const cells = [].slice.call(document.querySelectorAll('#view-couple [data-calday]'));
    const withTx = cells.filter(function(c){ return c.classList.contains('has') || c.querySelector('.cp-cal-ic'); });
    const cell = withTx[0] || cells[0];
    if (!cell) return 'no-cell';
    cell.click();
    return 'ok:' + cell.getAttribute('data-calday') + ' n=' + cells.length;
  })()`);
  await sleep(300);
  const opened = await ev(`(function(){
    const row = document.querySelector('#view-couple [data-cptx]');
    if (!row) return 'no-row:' + document.querySelector('#view-couple .cp-brief').innerText.slice(0,60);
    row.click();
    return 'ok';
  })()`);
  say('进日历：' + inCal + ' / 点账单：' + opened);
  await sleep(500);

  say('\n=== A. 布局 ===');
  const geo = await ev(`(function(){
    const q = (s) => document.querySelector(s);
    const R = (el) => { const r = el.getBoundingClientRect(); return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1), right:+r.right.toFixed(1), bottom:+r.bottom.toFixed(1) }; };
    const cs = (el, p) => getComputedStyle(el).getPropertyValue(p);
    const box = q('.cfa') || q('.sheet');
    if (!box) { const sh = q('.sheet'); return { err: 'no-cfa', body: sh ? sh.innerText.slice(0,200) : 'no-sheet' }; }
    // m03610：操作行改成了列表（.cfa-list > .cfa-row），不再是并排两个胶囊。
    // 「再来一笔」和「改一下」在同一列里各占一行，不是同一行 ——
    // 这版的设计是「hero 金额 + 三个等宽操作行」。
    const hero = q('.cfa-hero');
    const heroIc = q('.cfa-hero-ic');
    const heroAmt = q('.cfa-hero-amt');
    const copy = q('.cfa-row[data-act="copy"]');
    const edit = q('.cfa-row[data-act="edit"]');
    const del = q('.cfa-row[data-act="del"]');
    const sheet = q('.sheet');
    return {
      head: hero ? R(hero) : null, edit: edit ? R(edit) : null,
      copy: copy ? R(copy) : null, del: del ? R(del) : null,
      amt: heroAmt ? R(heroAmt) : null,
      sheet: sheet ? R(sheet) : null,
      // m03610：三行都是 width:100%（同一列 flex），实测三行 rect 都是 354.0。
      rowsSameWidth: (edit && copy && del)
        ? (Math.abs(edit.getBoundingClientRect().width - copy.getBoundingClientRect().width) < 1.5
           && Math.abs(del.getBoundingClientRect().width - copy.getBoundingClientRect().width) < 1.5)
        : null,
      editRadius: edit ? cs(edit, 'border-top-left-radius') : null,
      copyBg: copy ? cs(copy, 'background-color') : null,
      copyColor: copy ? cs(copy, 'color') : null,
      delColor: del ? cs(del.querySelector('.cfa-row-t') || del, 'color') : null,
      delBg: del ? cs(del, 'background-color') : null,
      delTxt: del ? del.textContent.trim() : '',
      headIcon: heroIc ? R(heroIc) : null,
      headIconHasCat: !!(heroIc && heroIc.querySelector('.cat-ic, svg')),
      headIconTxt: heroIc ? heroIc.textContent.trim() : '',
      headIconHtml: heroIc ? heroIc.innerHTML.slice(0, 40) : '',
      sheetScrolls: sheet ? (sheet.scrollHeight > sheet.clientHeight + 1) : null,
      bodyScrolls: (function(){ const b=q('.sheet-body'); return b ? b.scrollHeight > b.clientHeight + 1 : null; })(),
      /* 老版病灶：删除按钮和普通按钮同尺寸且铺满 */
      oldBtnRow: !!q('.btn-row'),
    };
  })()`);
  say(JSON.stringify(geo, null, 0));

  await t('弹层里是新的 .cfa 结构，没有旧的 btn-row', () => geo && !geo.err && geo.oldBtnRow === false);
  // m03610：现在是「hero 金额 + 三行等宽操作」。
  await t('三个操作行等宽', () => geo.rowsSameWidth === true);
  await t('三个操作行高度 ≥ 44（好点）', () => geo.edit && geo.edit.h >= 43.5);
  // m03610：删除行是「白底 + 红字 + 淡红边框」的 ghost 行，不是整块红底。
  // 白底 = rgb(255,255,255)，与普通操作行同底色。
  await t('删除降级：单独一行、不是整块红底', () =>
    geo.del.h >= 40 && geo.delBg === geo.copyBg && geo.delColor !== geo.copyColor);
  await t('删除排在最后一行', () => geo.del.y >= geo.copy.bottom + 2);
  await t('头部有分类图标（SVG 也行 / emoji 原样）', () => (!!geo.headIconHasCat && geo.headIcon && geo.headIcon.w >= 40) || (geo.headIconTxt && /[^\x00-\x7F]/.test(geo.headIconTxt)));
  await t('金额独立成块，在头部区域内', () => geo.amt && geo.amt.right <= geo.head.right + 0.5 && geo.amt.x >= geo.head.x);
  await t('弹层不需要内部滚动', () => geo.sheetScrolls === false);

  say('\n=== B. 再来一笔：当场刷新 + 停留在日历页 ===');
  // 记录当前日历状态（哪年哪月 + 停在哪一屏）
  const before = await ev(`(function(){
    const v = document.querySelector('#view-couple');
    const title = document.querySelector('.cp-cal-title');
    return {
      page: window.ViewCouple.page, hasCal: !!document.querySelector('.cp-cal-board'),
      title: title ? title.textContent.replace(/\\s+/g,'') : '',
      bills: window.Store.cpTxs().length,
    };
  })()`);
  await ev(`document.querySelector('.cfa-row[data-act="copy"]').click()`);
  await sleep(600);
  const afterCopy = await ev(`(function(){
    const v = document.querySelector('#view-couple');
    const title = document.querySelector('.cp-cal-title');
    return {
      page: window.ViewCouple.page, hasCal: !!document.querySelector('.cp-cal-board'),
      title: title ? title.textContent.replace(/\\s+/g,'') : '',
      bills: window.Store.cpTxs().length,
      sheetLeft: document.querySelectorAll('.sheet').length,
      cells: document.querySelectorAll('.cp-cal-cell').length,
    };
  })()`);
  say('before=' + JSON.stringify(before));
  say('after =' + JSON.stringify(afterCopy));
  await t('再来一笔：账目数 +1', () => afterCopy.bills === before.bills + 1);
  await t('再来一笔：弹层关掉', () => afterCopy.sheetLeft === 0);
  await t('再来一笔：日历当场重画（还在日历页、格子还在）', () => afterCopy.hasCal === true && afterCopy.cells >= 28);
  await t('再来一笔：还停在同一月（没被踢回首页）', () => afterCopy.page === before.page && afterCopy.title === before.title);

  say('\n=== C. 删掉这笔：当场刷新，格子里的账真的少了 ===');
  const delState = await ev(`(function(){
    const cell = document.querySelector('#view-couple [data-calday].is-on') || document.querySelector('#view-couple [data-calday]');
    cell.click();
    return document.querySelectorAll('#view-couple .cp-brief-row').length;
  })()`);
  await sleep(300);
  const delOpen = await ev(`(function(){
    const row = document.querySelector('#view-couple [data-cptx]');
    if (!row) return 'no-row';
    row.click(); return 'ok';
  })()`);
  await sleep(400);
  await ev(`document.querySelector('.cfa-row[data-act="del"]').click()`);
  await sleep(400);
  const hasConfirm = await ev(`(function(){
    const b = document.querySelectorAll('.modal, .dialog, .confirm, .ovl');
    return { n: b.length, txt: (b[b.length-1] ? b[b.length-1].innerText : '').slice(0,60) };
  })()`);
  say('确认框：' + JSON.stringify(hasConfirm));
  // 点确认里最后那个按钮（「删掉」）
  const clickedYes = await ev(`(function(){
    const boxes = document.querySelectorAll('.modal, .dialog, .ovl, .sheet');
    const box = boxes[boxes.length-1];
    if (!box) return 'no-box';
    const btns = [].slice.call(box.querySelectorAll('button'));
    const yes = btns.filter(function(b){ return /删掉|确定|是/.test(b.textContent); }).pop();
    if (!yes) return 'no-yes:' + btns.map(function(b){return b.textContent.trim();}).join('|');
    yes.click(); return 'ok';
  })()`);
  await sleep(700);
  const afterDel = await ev(`(function(){
    return {
      bills: window.Store.cpTxs().length,
      page: window.ViewCouple.page,
      hasCal: !!document.querySelector('.cp-cal-board'),
      sheetLeft: document.querySelectorAll('.sheet').length,
      briefRows: document.querySelectorAll('#view-couple .cp-brief-row').length,
      calRowsVisible: document.querySelectorAll('#view-couple .cp-brief').length,
    };
  })()`);
  say('点确认：' + clickedYes);
  say('afterDel=' + JSON.stringify(afterDel) + ' delState=' + delState);
  await t('删掉这笔：账目数 -1', () => afterDel.bills === afterCopy.bills - 1);
  await t('删掉这笔：日历当场重画（没停在旧内容上）', () => afterDel.hasCal === true);
  await t('删掉这笔：弹层都关了', () => afterDel.sheetLeft === 0);

  say('\n=== D. 账单页点开也刷新（不跳页） ===');
  await ev(`(function(){ const v=document.querySelector('#view-couple'); window.ViewCouple.setPage('bill'); window.ViewCouple.render(v); })()`);
  await sleep(350);
  const billBefore = await ev(`(function(){
    const it = document.querySelector('#view-couple [data-cp="bill-item"]');
    if (!it) return { err: 'no-item' };
    it.click(); return { n: window.Store.cpTxs().length };
  })()`);
  await sleep(450);
  const billSheet = await ev(`(function(){
    const b = document.querySelector('.cfa-row[data-act="copy"]');
    if (!b) return 'no-sheet:' + document.querySelectorAll('.sheet').length;
    b.click(); return 'ok';
  })()`);
  await sleep(600);
  const billAfter = await ev(`(function(){
    return { n: window.Store.cpTxs().length, page: window.ViewCouple.page,
      onBill: !!document.querySelector('#view-couple [data-cp="bill-item"]'),
      sheet: document.querySelectorAll('.sheet').length };
  })()`);
  say('billBefore=' + JSON.stringify(billBefore) + ' billAfter=' + JSON.stringify(billAfter) + ' ' + billSheet);
  await t('账单页再来一笔：账 +1 且仍停在账单页并重画', () => billAfter.n === billBefore.n + 1 && billAfter.page === 'bill' && billAfter.onBill === true);

  await t('没有 JS 异常', () => jsErrors.length === 0);

  say('\n=== E. 深色模式 ===');
  await ev(`document.documentElement.setAttribute('data-theme','dark')`);
  await sleep(300);
  await ev(`(function(){
    const it = document.querySelector('#view-couple [data-cp="bill-item"]');
    if (it) it.click();
  })()`);
  await sleep(450);
  const dark = await ev(`(function(){
    const q = (s) => document.querySelector(s);
    const cs = (el, p) => el ? getComputedStyle(el).getPropertyValue(p) : '';
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      headBg: cs(q('.cfa-head'), 'background-color'),
      copyBg: cs(q('.cfa-row[data-act="copy"]'), 'background-color'),
      copyColor: cs(q('.cfa-row[data-act="copy"] .cfa-row-t'), 'color'),
      editColor: cs(q('.cfa-row[data-act="edit"] .cfa-row-t'), 'color'),
      delColor: cs(q('.cfa-row[data-act="del"] .cfa-row-t'), 'color'),
      amtColor: cs(q('.cfa-hero-amt'), 'color'),
      hasCfa: !!q('.cfa'),
    };
  })()`);
  say('dark=' + JSON.stringify(dark));
  const lum = (s) => {
    const m = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(s || '');
    if (!m) return null;
    const f = (v) => { v = Number(v) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(m[1]) + 0.7152 * f(m[2]) + 0.0722 * f(m[3]);
  };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); if (la == null || lb == null) return 0; const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
  await t('深色下弹层打开了', () => dark.hasCfa === true);
  await t('深色下「再来一笔」文字对比度 ≥ 3（大字可读）', () => ratio(dark.copyColor, dark.copyBg) >= 3);
  await t('深色下删除按钮不是浅色（不会忽白忽黑）', () => { const l = lum(dark.delColor); return l != null && l > 0.12; });

  say(jsErrors.length ? jsErrors.slice(0, 5).join('\n') : 'JS：无');
  say(jsErrors.length ? jsErrors.slice(0, 5).join('\n') : 'JS：无');
  say('\n通过 ' + pass + ' / 失败 ' + fail);
  fs.writeFileSync('C:\\Code\\Jizhang\\_test\\_art-cfa.log', out.join('\n'), 'utf8');
  await env.stop(proc);
  process.exit(fail ? 1 : 0);
})();
