// 目的：验证新的日期选择器（年份网格 / 月份网格 / 日网格 + 右下角气泡确定）
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');
const PORT = 9491;
const PROFILE = env.profile('dp');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function t(ok, name, extra) { if (ok) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); } }

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) {} await sleep(250); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text); });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params, sessionId) => new Promise((res, rej) => { const my = ++id; pend.set(my, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: my, method, params: params || {}, sessionId })); });
  const tg = await send('Target.getTargets');
  const pg = tg.targetInfos.find((x) => x.type === 'page' && !/devtools|extension/.test(x.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: pg.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: 'http://127.0.0.1:4173/index.html' }); await sleep(2600);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description }; return r.result.value; };

  await ev("(function(){window.Store.clearAll();window.App.go('couple');return 1})()");
  await sleep(700);
  await ev("document.querySelector('#view-couple [data-cp=\"to-consent\"]').click()"); await sleep(350);
  await ev("(function(){const sc=document.querySelector('#view-couple #cp-consent-scroll'); sc.scrollTop=sc.scrollHeight; sc.dispatchEvent(new Event('scroll')); return 1})()"); await sleep(250);
  await ev("(function(){const c=document.querySelector('#view-couple #cp-agree'); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true})); return 1})()"); await sleep(150);
  await ev("document.querySelector('#view-couple #cp-consent-ok').click()"); await sleep(400);
  await ev("document.querySelector('#view-couple #cp-since').click()"); await sleep(600);

  // 1. 打开就是日视图，标题是「YYYY年 M月」
  const head = await ev("(function(){const y=document.querySelector('#sheet-root .dp-y'),m=document.querySelector('#sheet-root .dp-m');return {y:y?y.textContent:null,m:m?m.textContent:null,mOn:m?m.classList.contains('is-on'):null,days:document.querySelectorAll('#sheet-root .dp-day[data-ts]').length};})()");
  t(/年$/.test(head.y || ''), '标题显示年份', JSON.stringify(head));
  t(/月$/.test(head.m || ''), '标题显示月份', JSON.stringify(head));
  t(head.mOn === true, '月份是选中态（可点回月份网格）');
  t(head.days >= 28, '日网格有整月天数', String(head.days));

  // 2. 「今天」按钮已移除
  t(await ev("!document.querySelector('#sheet-root [data-act=\"today\"]')") === true, '「今天」按钮已移除');

  // 3. 确定按钮是右下角气泡
  await ev("(function(){const s=document.querySelector('#sheet-root .sheet'); s && (s.style.position='relative'); return 1})()");
  const fab = await ev(`(function(){
    const b=document.querySelector('#sheet-root .dp-fab');
    if(!b) return {none:true};
    const cs=getComputedStyle(b), r=b.getBoundingClientRect();
    const host=document.querySelector('#sheet-root .sheet');
    const hr=host.getBoundingClientRect();
    return {txt:b.textContent.trim(), pos:cs.position, radius:cs.borderRadius,
      right:Math.round(hr.right-16-r.right), bottom:Math.round(hr.bottom-14-r.bottom),
      w:Math.round(r.width), h:Math.round(r.height), bg:cs.backgroundImage.slice(0,30)};
  })()`);
  t(fab.txt === '确定', '确定按钮文案', JSON.stringify(fab));
  t(fab.pos === 'absolute', '确定按钮是绝对定位', JSON.stringify(fab));
  t(Math.abs(fab.right) <= 2, '确定按钮贴右（right:16）', JSON.stringify(fab));
  t(Math.abs(fab.bottom) <= 2, '确定按钮贴底（bottom:14）', JSON.stringify(fab));
  t(fab.radius && parseInt(fab.radius, 10) >= 18, '确定按钮是圆角气泡', JSON.stringify(fab));
  t(fab.w >= 100, '确定按钮已加宽', JSON.stringify(fab));

  // 4. 点年份 → 年份网格
  await ev("document.querySelector('#sheet-root .dp-y').click()"); await sleep(300);
  const ys = await ev("(function(){const cells=Array.from(document.querySelectorAll('#sheet-root .dp-cell[data-year]'));return {n:cells.length,vals:cells.map(c=>c.textContent),title:document.querySelector('#sheet-root .dp-y').textContent,mVis:getComputedStyle(document.querySelector('#sheet-root .dp-m')).display};})()");
  t(ys.n === 12, '年份网格有 12 个格子', JSON.stringify(ys));
  t(/\d{4} – \d{4}/.test(ys.title || ''), '年份视图标题是区间', JSON.stringify(ys));
  t(ys.mVis === 'none', '年份视图隐藏月份', JSON.stringify(ys));

  // 5. 点某一年 → 月份网格，不跨年地一次性跳过去
  const targetYear = ys.vals[ys.vals.indexOf(String(new Date().getFullYear())) - 1] || ys.vals[0];
  await ev(`(function(){const b=document.querySelector('#sheet-root .dp-cell[data-year="${targetYear}"]'); b.click(); return 1})()`); await sleep(300);
  const ms = await ev("(function(){const cells=Array.from(document.querySelectorAll('#sheet-root .dp-cell[data-month]'));return {n:cells.length,title:document.querySelector('#sheet-root .dp-y').textContent};})()");
  t(ms.n === 12, '选完年份进入 12 个月份格子', JSON.stringify(ms));
  t((ms.title || '').indexOf(targetYear) >= 0, '标题已切到目标年份', JSON.stringify(ms));

  // 6. 点月份 → 回到日视图，再选 15 号 → 确定
  await ev("document.querySelector('#sheet-root .dp-cell[data-month=\"2\"]').click()"); await sleep(300);
  const dayView = await ev("(function(){return {days:document.querySelectorAll('#sheet-root .dp-day[data-ts]').length, y:document.querySelector('#sheet-root .dp-y').textContent, m:document.querySelector('#sheet-root .dp-m').textContent};})()");
  t(dayView.days >= 28, '选完月份回到日网格', JSON.stringify(dayView));
  t(dayView.m.indexOf('3') === 0 || /^3\s*月$/.test(dayView.m), '月份标题是 3 月', JSON.stringify(dayView));

  await ev("(function(){const d=Array.from(document.querySelectorAll('#sheet-root .dp-day[data-ts]')).find(n=>n.textContent==='15'); d.click(); return 1})()"); await sleep(200);
  await ev("document.querySelector('#sheet-root .dp-fab').click()"); await sleep(600);
  const picked = await ev("(function(){const b=document.querySelector('#view-couple #cp-since'); return {txt:b.textContent.replace(/\\s+/g,' ').trim(), sheetGone:!document.querySelector('#sheet-root .dp-fab')};})()");
  t(picked.sheetGone === true, '点确定后弹层关闭', JSON.stringify(picked));
  t(picked.txt.indexOf(targetYear + '年3月15') >= 0 || picked.txt.indexOf(targetYear + '-03-15') >= 0, '选中的日期回填到按钮', JSON.stringify(picked));

  // 7. 翻页按钮在三种视图下都能用
  await ev("document.querySelector('#view-couple #cp-since').click()"); await sleep(500);
  await ev("document.querySelector('#sheet-root .dp-y').click()"); await sleep(200);
  const before = await ev("document.querySelector('#sheet-root .dp-y').textContent");
  await ev("document.querySelector('#sheet-root [data-nav=\"1\"]').click()"); await sleep(250);
  const after = await ev("document.querySelector('#sheet-root .dp-y').textContent");
  t(before !== after, '年份视图翻页真的换了区间', before + ' → ' + after);
  await ev("document.querySelector('#sheet-root .dp-title').click()"); await sleep(200);
  const midTitle = await ev("document.querySelector('#sheet-root .dp-y').textContent");
  t(/年$/.test(midTitle || ''), '标题在年/月之间可来回切', midTitle);

  console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  console.log('JS 异常:', errs.length ? errs.join(' | ') : 'none');
  ws.close(); await env.stop(proc);process.exit(fail ? 1 : 0);
})();
