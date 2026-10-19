/* 验收：「来自 TA 的偏爱」——补记、只记一条账、退款按净额。
 *
 * 用户原话：「最好让『来自 TA 的偏爱』也能填写，然后在发红包那一方的支出
 * 自动多一笔相同金额的红包支出」。所以这里断言：
 *   1. 补记入口在、能打开、落库方向正确（TA→我，只有这一个方向）；
 *   2. 落的是同一条账（支出只加一次），不是两条；
 *   3. 红包退了一半之后，首页卡 / 偏爱页 / Store 的合计是同一个净额。
 *
 * m03721 修过两个坑，别改回去：
 *   - 本文件旧版还在点 `[data-dir="me"]`（弹层里的方向选择），那个 UI 早就
 *     按「偏爱页只装对方给我的」删掉了，点空指针抛异常；而旧版把
 *     「打印计数 + process.exit」写在 finally 里，异常被吞掉，
 *     9 条断言只跑了 5 条还报「通过 5/5」退出码 0 —— 假绿。
 *     现在所有断言跑完才汇总，异常一律退出码 1。
 *   - favorList() 以前不过滤 refundOf，红包退款会多出一条「TA 又给了你」的
 *     假行，52 变 72。现在和账单页一样，退款只体现在原红包的净额里。
 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9433;
const PROFILE = env.profile('favor-add');
const EDGE = env.EDGE;
const URL = 'http://127.0.0.1:4180/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    const ok = await fn();
    if (ok) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); }
  } catch (e) { fail++; console.log('  ❌ ' + name + ' — ' + (e && e.message)); }
};

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', URL,
  ], { stdio: 'ignore' });
  let fatal = null;
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

    // 准备：清空 → 开通情侣账本 → 进「偏爱」页
    await ev(`(function(){
      const S = window.Store;
      S.clearAll(false);
      S.enableCouple({ meName:'阿泽', peerName:'小满', mode:'local', togetherSince:'2026-03-14',
        consent:{ agreed:true, at:Date.now(), version:(window.ViewCouple.CONSENT_VERSION||1) } });
      return 1;
    })()`);
    await ev(`App.go('couple')`);
    await sleep(400);
    await ev(`(function(){ window.ViewCouple.setPage('favor'); window.ViewCouple.render(document.querySelector('#view-couple')); return 1; })()`);
    await sleep(300);

    const entry = await ev(`(function(){
      const b = document.querySelector('#view-couple [data-cp="favor-add"]');
      return b ? { text: b.textContent.trim(), visible: b.getBoundingClientRect().width > 0 } : null;
    })()`);
    await t('「偏爱」页有「补记」入口且在第一屏可见', () => entry && /\u8865\u8bb0/.test(entry.text) && entry.visible);
    await t('没有红包时清单不是空壳，仍有空态文案', () =>
      ev(`(function(){ const e = document.querySelector('.cp-favor-empty'); return !!(e && e.textContent.trim()); })()`));

    // 打开补记弹层
    await ev(`document.querySelector('#view-couple [data-cp="favor-add"]').click()`);
    await sleep(600);
    const sheet = await ev(`(function(){
      const s = document.querySelector('#cfa-add'); if (!s) return null;
      const foot = document.querySelector('#sheet-root .sheet-foot');
      return { title: (document.querySelector('.sheet-title')||{}).textContent || '',
        dirs: s.querySelectorAll('[data-dir]').length,
        amount: !!s.querySelector('#cfa-amount'), date: !!s.querySelector('#cfa-date'),
        note: !!s.querySelector('#cfa-note'), ok: !!(foot && foot.querySelector('.btn--primary')) };
    })()`);
    await t('补记弹层打开：标题 / 金额 / 日期 / 备注 / 确定键都在', () =>
      sheet && sheet.amount && sheet.date && sheet.note && sheet.ok
      && /TA 给我的/.test(sheet.title));
    await t('弹层里没有「谁给谁」的方向选择（这页只装 TA 给我的）', () =>
      sheet && sheet.dirs === 0);

    // 补记一笔 TA → 我
    await ev(`(function(){
      const inp = document.querySelector('#cfa-amount');
      inp.value = '52'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#cfa-note').value = '生日红包';
      document.querySelector('.sheet-foot .btn--primary').click();
      return 1;
    })()`);
    await sleep(450);
    const peer = await ev(`(function(){
      const S = window.Store;
      const inn = S.cpFavorsIn();
      const tx = inn[0];
      return { n: inn.length, total: S.cpFavorsTotal(), amount: tx && tx.amount,
        cat: tx && tx.catId, rpFrom: tx && tx.rpFrom, attrib: tx && tx.attrib,
        rows: document.querySelectorAll('#cp-favor-list .cp-favor-hrow').length,
        hasAdd: !!document.querySelector('#view-couple [data-cp="favor-add"]') };
    })()`);
    await t('TA→我的补记落库：红包分类 / 方向 peer / 金额 52', () =>
      peer.n === 1 && peer.total === 5200 && peer.amount === 5200 &&
      peer.cat === 'redpacket' && peer.rpFrom === 'peer' && peer.attrib === 'peer');
    await t('补记后清单当场出现一行，入口仍在', () => peer.rows === 1 && peer.hasAdd);

    // 首页那张卡要和清单说同一个数
    const home = await ev(`(function(){
      window.ViewCouple.setPage('home');
      window.ViewCouple.render(document.querySelector('#view-couple'));
      const card = document.querySelector('#view-couple .cp-favor');
      const foot = card && card.querySelector('.cp-favor-foot');
      const amt = card && card.querySelector('.cp-favor-amt');
      return { has: !!card, foot: foot ? foot.textContent.replace(/\\s+/g,' ').trim() : '',
        amt: amt ? amt.textContent.trim() : '' };
    })()`);
    await t('首页「来自 TA 的偏爱」卡出现，写的是 ¥52.00', () =>
      home.has && /52\.00/.test(home.foot) && /52\.00/.test(home.amt));

    // 退一半：净额口径必须和账单 / 月报一致
    const refunded = await ev(`(function(){
      const S = window.Store;
      const src = S.cpFavorsIn()[0];
      S.cpRefundTx(src.id, 2000, '退了一半');
      window.ViewCouple.setPage('favor');
      window.ViewCouple.render(document.querySelector('#view-couple'));
      // 先在偏爱页把清单量完，再切首页 —— 切过去 #cp-favor-list 就没了
      const sum = document.querySelector('.cp-favor-list-sum');
      const rowsEls = document.querySelectorAll('#cp-favor-list .cp-favor-hrow');
      const row = rowsEls[0];
      const snap = { sum: sum ? sum.textContent.replace(/\\s+/g,' ').trim() : '',
        rows: rowsEls.length, rowTxt: row ? row.textContent.replace(/\\s+/g,' ').trim() : '' };
      window.ViewCouple.setPage('home');
      window.ViewCouple.render(document.querySelector('#view-couple'));
      const f = document.querySelector('#view-couple .cp-favor-foot');
      return { total: S.cpFavorsTotal(), listN: S.cpFavorsIn().length,
        sum: snap.sum, rows: snap.rows, rowTxt: snap.rowTxt,
        home: f ? f.textContent.replace(/\\s+/g,' ').trim() : '' };
    })()`);
    await t('退款后 Store 合计是净额 32（5200 - 2000）', () =>
      refunded.total === 3200 && refunded.listN === 1);
    await t('退款记录不单独成行：清单还是 1 行，不是 2 行', () => refunded.rows === 1);
    await t('偏爱页合计 / 首页合计 / 行内金额都是 ¥32.00，且标注已退 ¥20.00', () =>
      /32\.00/.test(refunded.sum) && /32\.00/.test(refunded.home)
      && /32\.00/.test(refunded.rowTxt) && /已退/.test(refunded.rowTxt) && /20\.00/.test(refunded.rowTxt));

    // 只记一条账：两条记录（红包 52 + 退款 20），没有凭空翻倍。
    // 口径提醒：rpFrom='peer' 的红包在「我」这边算**收到的偏爱**（income），
    // 不是我的支出 —— 见 S.cpSummary 的注释，别按支出断言。
    const ledger = await ev(`(function(){
      const S = window.Store;
      const sum = S.cpSummary(S.monthPeriod(new Date()), S.cpTxs());
      return { n: S.cpTxs().length, expense: sum.expense, income: sum.income, count: sum.expCount };
    })()`);
    await t('账只有两条（红包 52 + 退款 20），支出 0、收到的偏爱净额 32', () =>
      ledger.n === 2 && ledger.expense === 0 && ledger.income === 3200 && ledger.count === 0);

    await t('全程没有 JS 异常', () => jsErrors.length === 0);
  } catch (e) {
    fatal = e;
    console.error('\n测试中断：' + (e && e.message));
  } finally {
    try { await env.stop(proc); } catch (e) { /* 忽略 */ }
    await sleep(200);
  }
  console.log(`\n通过 ${pass} / ${pass + fail}`);
  // 中断也要算失败：旧版在这里直接 exit(0)，异常被 finally 吞成假绿
  process.exit(fail || fatal ? 1 : 0);
})();
