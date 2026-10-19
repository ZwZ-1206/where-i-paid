// 暖心提示交互验证：换一句 / 显示位置切换 / 关闭开关
// 用法: node _test/verify-tip-ui.js
const { spawn } = require('child_process');
const env = require('./_env');
const http = require('http');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9411;
const BASE = 'http://127.0.0.1:4173/index.html';
const PROFILE = env.profile('tipui');

function get(p) {
  return new Promise((res, rej) => {
    http.get(p, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej);
  });
}
function waitPort(ms) {
  const t0 = Date.now();
  return new Promise((res, rej) => {
    (function loop() {
      get(`http://127.0.0.1:${PORT}/json/version`).then((d) => res(JSON.parse(d))).catch(() => {
        if (Date.now() - t0 > ms) return rej(new Error('CDP timeout'));
        setTimeout(loop, 200);
      });
    })();
  });
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--headless=new', '--disable-gpu', '--no-first-run', 'about:blank',
  ], { stdio: 'ignore' });

  let out = 0, fail = 0;
  const t = async (name, fn) => {
    try {
      const r = await fn();
      if (r === true || r === undefined) { out++; console.log('  ✅ ' + name); }
      else { fail++; console.log('  ❌ ' + name + ' — ' + r); }
    } catch (e) { fail++; console.log('  ❌ ' + name + ' — ' + e.message); }
  };

  try {
    await waitPort(20000);
    const targets = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`));
    let tgt = targets.find((x) => x.type === 'page');
    const ws = new WebSocket(tgt.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    await new Promise((r) => (ws.onopen = r));
    const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE });
await new Promise((r) => setTimeout(r, 2500));
// 这两个套件验的是「有账目时」的提示 / AI 卡片，先造一份示例数据
await evalJs(`(function(){ Store.clearAll(false); Store.seedDemo(true); App.refresh(); return 1; })()`);
await new Promise((r) => setTimeout(r, 600));
    await new Promise((r) => setTimeout(r, 2500));

    // 确保暖心提示开启且在记账页
    await evalJs(`(function(){ Store.setSettings({tip:{enabled:true, place:'add'}}); Tips.clearCache(); App.go('add'); return 1; })()`);
    await new Promise((r) => setTimeout(r, 600));

    console.log('\n=== 1. 记账页卡片 ===');
    await t('卡片存在', () => evalJs(`!!document.querySelector('.view.active .tip-card')`));
    await t('卡片含至少 1 条提示', () => evalJs(`document.querySelectorAll('.tip-card .tip-line').length >= 1`));
    await t('卡片高度大于 100px（未被压扁）', () => evalJs(`document.querySelector('.view.active .tip-card').getBoundingClientRect().height > 100`));
    await t('含「换一句」按钮', () => evalJs(`!!document.querySelector('.tip-card [data-tip="shuffle"]')`));

    console.log('\n=== 2. 换一句 ===');
    const before = await evalJs(`(function(){ var el=document.querySelector('.tip-card .tip-line .tip-t'); return el?el.textContent.trim():''; })()`);
    const beforeOff = await evalJs(`Store.settings.tip.offset`);
    await evalJs(`document.querySelector('.tip-card [data-tip="shuffle"]').click()`);
    await new Promise((r) => setTimeout(r, 700));
    const afterOff = await evalJs(`Store.settings.tip.offset`);
    const after = await evalJs(`(function(){ var el=document.querySelector('.tip-card .tip-line .tip-t'); return el?el.textContent.trim():''; })()`);
    await t('offset 递增', () => (afterOff === beforeOff + 1) || `before=${beforeOff} after=${afterOff}`);
    await t('文案发生变化', () => after !== before || `文案未变：${after}`);

    console.log('\n=== 3. 点卡片打开弹层 ===');
    await evalJs(`document.querySelector('.tip-card [data-tip="open"]').click()`);
    await new Promise((r) => setTimeout(r, 700));
    await t('弹层打开', () => evalJs(`!!document.querySelector('.tip-sheet-head')`));
    await t('弹层有四格数据', () => evalJs(`document.querySelectorAll('.tsh-nums > *').length === 4`));
    await t('弹层有支出分布', () => evalJs(`(function(){
      var has = document.querySelectorAll('.tip-sheet-cats .tsc-row').length;
      var total = Tips.forYesterday().stats.total;
      return total === 0 ? document.querySelector('.tip-sheet-cats') === null : has >= 1;
    })()`));
    await t('弹层有免责说明', () => evalJs(`!!document.querySelector('.tip-sheet-note')`));
    await evalJs(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
    await new Promise((r) => setTimeout(r, 600));

    console.log('\n=== 4. 显示位置：slim ===');
    await evalJs(`(function(){ Store.setSettings({tip:{place:'slim'}}); Tips.clearCache(); App.go('add'); return 1; })()`);
    await new Promise((r) => setTimeout(r, 600));
    await t('记账页不再有完整卡片', () => evalJs(`!document.querySelector('.view.active .tip-card')`));
    await t('记账页有单行提示', () => evalJs(`!!document.querySelector('.view.active .tip-slim')`));
    await evalJs(`(function(){ App.go('detail'); return 1; })()`);
    await new Promise((r) => setTimeout(r, 700));
    await t('明细页有单行提示', () => evalJs(`!!document.querySelector('.view.active .tip-slim')`));

    console.log('\n=== 5. 显示位置：off ===');
    await evalJs(`(function(){ Store.setSettings({tip:{place:'off'}}); Tips.clearCache(); App.go('add'); return 1; })()`);
    await new Promise((r) => setTimeout(r, 600));
    await t('记账页无任何提示', () => evalJs(`!document.querySelector('.view.active .tip-card') && !document.querySelector('.view.active .tip-slim')`));

    console.log('\n=== 6. 关闭开关 ===');
    await evalJs(`(function(){ Store.setSettings({tip:{enabled:false, place:'add'}}); Tips.clearCache(); App.go('add'); return 1; })()`);
    await new Promise((r) => setTimeout(r, 600));
    await t('关闭后不渲染', () => evalJs(`!document.querySelector('.view.active .tip-card') && !document.querySelector('.view.active .tip-slim')`));

    console.log('\n=== 7. 设置页行与弹层 ===');
    await evalJs(`(function(){ Store.setSettings({tip:{enabled:true}}); App.go('settings'); return 1; })()`);
    await new Promise((r) => setTimeout(r, 700));
    await t('设置页有暖心提示行', () => evalJs(`!!document.querySelector('[data-act="tip"]')`));
    await t('设置行有开关', () => evalJs(`!!document.querySelector('[data-toggle="tip"]')`));
    await evalJs(`document.querySelector('[data-act="tip"]').click()`);
    await new Promise((r) => setTimeout(r, 700));
    await t('设置弹层打开', () => evalJs(`!!document.querySelector('#t-enabled')`));
    await t('弹层有三个位置选项', () => evalJs(`document.querySelectorAll('[data-place]').length === 3`));
    await t('弹层说明不接 AI 接口', () => evalJs(`(function(){ var n=document.querySelector('.tip-sheet-note'); return n && n.textContent.indexOf('不接') >= 0; })()`));

    // 还原
    await evalJs(`(function(){ Store.setSettings({tip:{enabled:true, place:'add', offset:0}}); Tips.clearCache(); return 1; })()`);

    ws.close();
    console.log(`\n通过 ${out} / ${out + fail}`);
  await env.stop(proc);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('FATAL', e.message);
  await env.stop(proc);
    process.exit(1);
  }
})();
