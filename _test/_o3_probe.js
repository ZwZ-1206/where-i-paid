/* O3 探针：看看情侣页在「回忆小票墙 / 情侣账单」状态下到底能不能滚 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9412;
const PROFILE = env.profile('o3-probe');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', URL,
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {}
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params: params || {}, sessionId }));
  });

  const targets = await send('Target.getTargets');
  const page = targets.targetInfos.find((t) => t.type === 'page' && !/devtools|extension/.test(t.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: URL });
  await sleep(2800);
  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };

  // 开通情侣账本（照抄 verify-couple 的做法：塞配置 + 几笔账）
  await ev(`(function(){
    window.Store.clearAll();
    if (window.ViewCouple.setStep) window.ViewCouple.setStep('intro');
    return 1;
  })()`);
  await sleep(300);
  await ev(`App.go('couple')`); await sleep(500);
  await ev(`document.querySelector('[data-cp="to-consent"]').click()`); await sleep(600);
  await ev(`(function(){
    const sc = document.querySelector('#cp-consent-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
    const cb = document.querySelector('#cp-agree'); if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    const ok = document.querySelector('#cp-consent-ok'); if (ok) ok.click();
    return 1;
  })()`); await sleep(700);
  await ev(`(function(){
    const me = document.querySelector('#cp-me'), peer = document.querySelector('#cp-peer');
    if (me) { me.value = '小懒'; me.dispatchEvent(new Event('input', { bubbles: true })); }
    if (peer) { peer.value = '小满'; peer.dispatchEvent(new Event('input', { bubbles: true })); }
    return 1;
  })()`); await sleep(300);
  // 日期走真实弹层：点开 → 确定
  await ev(`document.querySelector('#cp-since').click()`); await sleep(700);
  await ev(`(function(){ const b = document.querySelector('#sheet-root [data-act="ok"]'); if (b) b.click(); return 1; })()`);
  await sleep(600);
  await ev(`document.querySelector('#cp-profile-ok').click()`); await sleep(600);
  await ev(`document.querySelector('.cp-mode-grid [data-cp="mode"][data-mode="local"]').click()`);
  await sleep(900);
  console.log('opened: on() =', await ev(`window.ViewCouple.on()`), ' enabled =', await ev(`window.Store.settings.couple.enabled`));

  // 塞 40 笔情侣账，**全放在同一天**，让某一天的简报足够长
  await ev(`(function(){
    const now = new Date();
    for (let i = 0; i < 40; i++) {
      window.Store.cpAddTx({
        type: 'expense', amount: 1000 + i * 10, catId: 'food', sub: '', accountId: 'alipay',
        note: '第' + i + '笔', attrib: 'mutual', ts: new Date(now.getFullYear(), now.getMonth(), 15, 12 + i).getTime(),
      });
    }
    return window.Store.cpTxs ? 'ok' : 'no-cpTxs';
  })()`);
  await sleep(400);

  // 把视口压矮，模拟「一屏装不下」—— 真机小屏就是这个样子
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 520, deviceScaleFactor: 2, mobile: true });
  await sleep(500);

  for (const pg of ['memories', 'bill']) {
    await ev(`(function(){ window.ViewCouple.setPage('${pg}'); window.ViewCouple.render(document.querySelector('#view-couple')); return 1; })()`);
    await sleep(600);
    const r = await ev(`(function(){
      const v = document.querySelector('#view-couple');
      v.scrollTop = 99999;
      const max = v.scrollHeight - v.clientHeight;
      return { page: window.ViewCouple.page, scrollHeight: v.scrollHeight, clientHeight: v.clientHeight, max: max, top: v.scrollTop };
    })()`);
    console.log(pg, JSON.stringify(r));
  }

  // memories：点一个有账的日子，让简报变长 → 能滚吗
  await ev(`(function(){ window.ViewCouple.setPage('memories'); window.ViewCouple.render(document.querySelector('#view-couple')); return 1; })()`);
  await sleep(500);
  const memScroll = await ev(`(function(){
    const root = document.querySelector('#view-couple');
    const cells = [].slice.call(root.querySelectorAll('.cp-cal-cell.has:not(.is-future)'));
    if (!cells.length) return { err: 'no-cell' };
    cells[0].click();
    return { clicked: cells[0].getAttribute('data-calday') };
  })()`);
  await sleep(700);
  const memAfter = await ev(`(function(){
    const v = document.querySelector('#view-couple');
    return { max: v.scrollHeight - v.clientHeight, briefRows: v.querySelectorAll('.cp-brief-row').length };
  })()`);
  console.log('memories 点日子', JSON.stringify(memScroll), JSON.stringify(memAfter));

  ws.close();
  await env.stop(proc);
})().catch((e) => { console.error('PROBE FAIL:', e.message); process.exit(1); });
