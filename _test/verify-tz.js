// 目的：验证异地页「TA 那边现在几点」的时区功能
// —— 之前这个值没有任何入口可设，卡片恒为 --:--；现在要能选、能算对、能改。
const fs = require('fs');
const env = require('./_env');
const path = require('path');
const { spawn } = require('child_process');
const PORT = 9492;
const PROFILE = env.profile('tz');
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
  // 在东八区环境下跑，方便断言
  await S('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
  await S('Page.navigate', { url: 'http://127.0.0.1:4173/index.html' }); await sleep(2600);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description }; return r.result.value; };

  // 造一个异地情侣
  await ev("(function(){const S=window.Store;S.clearAll();S.enableCouple({meName:'小懒',peerName:'小满',mode:'remote',togetherSince:'2024-05-20',consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}});S.setCoupleConfig({tzOffset:''});window.App.go('couple');return 1})()");
  await sleep(900);

  // 1. 没设时区 → 卡片显示「还没设时区」并有入口按钮
  const card = await ev(`(function(){
    const mods=Array.from(document.querySelectorAll('#view-couple .cp-mod'));
    const m=mods.find(x=>x.textContent.indexOf('TA 那边现在')>=0);
    if(!m) return {none:true};
    return {val:m.querySelector('.cp-mod-val').textContent.trim(),
      descs:Array.from(m.querySelectorAll('.cp-mod-desc')).map(d=>d.textContent.trim()),
      btn:(m.querySelector('[data-cp="tz"]')||{}).textContent};
  })()`);
  t(card.val === '--:--', '没设时区时显示 --:--', JSON.stringify(card));
  t(card.descs.indexOf('还没设时区') >= 0, '提示「还没设时区」', JSON.stringify(card));
  t(card.btn === '选 TA 的时区', '有「选 TA 的时区」入口', JSON.stringify(card));

  // 2. 打开面板
  await ev("document.querySelector('#view-couple [data-cp=\"tz\"]').click()"); await sleep(600);
  const sheet = await ev(`(function(){
    const rows=Array.from(document.querySelectorAll('#sheet-root .cp-tz-row'));
    const local=document.querySelector('#sheet-root [data-tz="local"]');
    const lead=document.querySelector('#sheet-root .cp-tz-lead');
    return {n:rows.length, hasLocal:!!local, lead:lead?lead.textContent.replace(/\\s+/g,' ').trim().slice(0,40):null,
      hasNY:rows.some(r=>r.textContent.indexOf('纽约')>=0), hasTK:rows.some(r=>r.textContent.indexOf('日本')>=0)};
  })()`);
  t(sheet.n >= 20, '时区面板有足够多的选项', JSON.stringify(sheet));
  t(sheet.hasLocal === true, '有「同一个时区」快捷项');
  t(sheet.hasNY && sheet.hasTK, '常见时区都在列表里（纽约 / 日本）', JSON.stringify(sheet));
  t((sheet.lead || '').indexOf('没法知道') >= 0, '面板明确说明「我们没法知道 TA 在哪个时区」', JSON.stringify(sheet));

  // 3. 选纽约（UTC-5），东八区比它快 13 小时
  await ev("(function(){const r=Array.from(document.querySelectorAll('#sheet-root .cp-tz-row')).find(x=>x.textContent.indexOf('纽约')>=0); r.click(); return 1})()");
  await sleep(800);
  const after = await ev(`(function(){
    const mods=Array.from(document.querySelectorAll('#view-couple .cp-mod'));
    const m=mods.find(x=>x.textContent.indexOf('TA 那边现在')>=0);
    return {val:m.querySelector('.cp-mod-val').textContent.trim(),
      descs:Array.from(m.querySelectorAll('.cp-mod-desc')).map(d=>d.textContent.trim()),
      btn:(m.querySelector('[data-cp="tz"]')||{}).textContent,
      tz:window.Store.settings.couple.tzOffset,
      sheetClosed:!document.querySelector('#sheet-root .cp-tz-row')};
  })()`);
  t(after.tz === -5, '时区写进了配置（-5）', JSON.stringify(after));
  t(after.sheetClosed === true, '选完面板关闭', JSON.stringify(after));
  t(/^\d{2}:\d{2}$/.test(after.val), '卡片显示时间', JSON.stringify(after));
  t(after.descs.some((d) => d.indexOf('UTC−5') >= 0), '说明里标出 UTC 偏移', JSON.stringify(after));
  t(after.descs.some((d) => /比你(快|慢) 13 小时/.test(d)), '说明里标出和你差 13 小时', JSON.stringify(after));
  t(after.btn === '换时区', '入口变成「换时区」', JSON.stringify(after));

  // 4. 算得对不对：东八区 + 北京时间现在几点，纽约应为 -13 小时
  const calc = await ev(`(function(){
    const tz=-5;
    const localOff=-new Date().getTimezoneOffset()/60;
    const expect=new Date(Date.now()+(tz-localOff)*3600000);
    const hh=String(expect.getHours()).padStart(2,'0'), mm=String(expect.getMinutes()).padStart(2,'0');
    const mods=Array.from(document.querySelectorAll('#view-couple .cp-mod'));
    const m=mods.find(x=>x.textContent.indexOf('TA 那边现在')>=0);
    return {expect:hh+':'+mm, shown:m.querySelector('.cp-mod-val').textContent.trim(), localOff};
  })()`);
  t(calc.shown === calc.expect || calc.shown === (() => { const [h, m] = calc.expect.split(':').map(Number); const d = new Date(); d.setHours((h + 0) % 24, m + 1, 0, 0); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); })(), '显示的时间算得对（允许跨分钟）', JSON.stringify(calc));

  // 5. 刷新页面后仍在
  await S('Page.reload'); await sleep(2600);
  await ev("window.App.go('couple')"); await sleep(700);
  const persist = await ev("window.Store.settings.couple.tzOffset");
  t(persist === -5, '刷新后时区设置还在', String(persist));

  // 6. 切回「同一个时区」
  await ev("document.querySelector('#view-couple [data-cp=\"tz\"]').click()"); await sleep(500);
  await ev("document.querySelector('#sheet-root [data-tz=\"local\"]').click()"); await sleep(700);
  const same = await ev(`(function(){
    const mods=Array.from(document.querySelectorAll('#view-couple .cp-mod'));
    const m=mods.find(x=>x.textContent.indexOf('TA 那边现在')>=0);
    return {tz:window.Store.settings.couple.tzOffset,
      descs:Array.from(m.querySelectorAll('.cp-mod-desc')).map(d=>d.textContent.trim())};
  })()`);
  t(same.tz === 8, '「同一个时区」设为 +8', JSON.stringify(same));
  t(same.descs.some((d) => d.indexOf('和你同一个时区') >= 0), '说明写「和你同一个时区」', JSON.stringify(same));

  // 7. 同城模式不显示这个模块（走真实的「切换同城 / 异地」按钮 + 确认框）
  await ev("document.querySelector('#view-couple [data-cp=\"switch-mode\"]').click()"); await sleep(600);
  await ev("(function(){const b=document.querySelector('#view-couple [data-mode=\"local\"]'); if(b) b.click(); return !!b})()"); await sleep(500);
  await ev("(function(){const d=document.querySelector('#modal-root [data-act=\"ok\"]'); if(d) d.click(); return !!d})()"); await sleep(900);
  const local = await ev("(function(){const mods=Array.from(document.querySelectorAll('#view-couple .cp-mod'));return {mode:window.Store.settings.couple.mode, n:mods.length, hasTz:mods.some(x=>x.textContent.indexOf('TA 那边现在')>=0)};})()");
  t(local.mode === 'local' && local.hasTz === false, '切回同城后不再显示时区卡', JSON.stringify(local));

  console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  console.log('JS 异常:', errs.length ? errs.join(' | ') : 'none');
  ws.close(); await env.stop(proc);process.exit(fail ? 1 : 0);
})();
