/* 端到端交互测试：模拟真实用户操作 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const PROFILE = env.profile('e2e');
const BASE = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + PROFILE,
    '--headless=new', '--disable-gpu', '--no-first-run', 'about:blank',
  ], { stdio: 'ignore' });

  await sleep(2600);
  let target;
  for (let i = 0; i < 20; i++) {
    try { const l = await getJSON('/json/list'); target = l.find((t) => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(400);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: BASE });
  await sleep(2400);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  const results = [];
  const check = (name, cond, extra) => {
    results.push({ name, ok: !!cond, extra });
    console.log(`  ${cond ? '✅' : '❌'} ${name}${cond ? '' : ' → ' + extra}`);
  };

  const click = async (sel) => { await ev(`(function(){const n=document.querySelector(${JSON.stringify(sel)}); if(!n) return 'missing'; n.click(); return 'ok';})()`); await sleep(260); };

  // 从干净状态开始
  await ev(`Store.clearAll(false); Store.seedDemo(true); App.refresh(); 1`);
  await sleep(400);

  console.log('\n=== 1. 记一笔完整流程 ===');
  await ev(`App.go('add'); 1`); await sleep(300);
  const beforeCount = await ev(`Store.state.tx.length`);
  // 输入 25.80
  for (const k of ['2', '5', '.', '8', '0']) await click(`[data-key="${k}"]`);
  const shown = await ev(`document.querySelector('.amount-val').textContent.trim()`);
  check('键盘输入显示 25.80', shown.indexOf('25.80') === 0, shown);
  // 选分类
  await click('[data-cat="transport"]');
  await click('[data-sub="打车"]');
  // 完成
  await click('[data-key="ok"]');
  await sleep(500);
  const afterCount = await ev(`Store.state.tx.length`);
  check('账目数量 +1', afterCount === beforeCount + 1, `${beforeCount} → ${afterCount}`);
  const last = await ev(`(function(){const t=Store.state.tx[Store.state.tx.length-1]; return JSON.stringify({amt:t.amount,cat:t.catId,sub:t.sub});})()`);
  check('金额/分类/子类正确', last.indexOf('"amt":2580') >= 0 && last.indexOf('transport') >= 0 && last.indexOf('打车') >= 0, last);
  const cleared = await ev(`document.querySelector('.amount-val').textContent.trim()`);
  check('提交后金额清零', cleared.indexOf('0.00') === 0, cleared);

  console.log('\n=== 2. 计算器 ===');
  for (const k of ['1', '0', '0', '+', '5', '0']) await click(`[data-key="${k}"]`);
  const calcShown = await ev(`document.querySelector('.amount-val').textContent.trim()`);
  check('100 + 50 输入中显示 50', calcShown.indexOf('50') === 0, calcShown);
  const hint = await ev(`document.querySelector('.calc-hint').textContent.trim()`);
  check('显示计算提示', hint.indexOf('100.00') >= 0, hint);
  await click('[data-key="+"]');
  const calcRes = await ev(`document.querySelector('.amount-val').textContent.trim()`);
  check('计算结果 150', calcRes.indexOf('150') === 0, calcRes);
  await click('[data-key="del"]');

  console.log('\n=== 3. 收入模式 ===');
  await click('[data-type="income"]');
  const cats = await ev(`document.querySelectorAll('[data-cat]').length`);
  const firstCat = await ev(`document.querySelector('[data-cat]').dataset.cat`);
  check('切换收入后分类变为收入类', firstCat === 'salary', firstCat);
  for (const k of ['8', '0', '0', '0']) await click(`[data-key="${k}"]`);
  await click('[data-key="ok"]');
  await sleep(400);
  const incomeSum = await ev(`Store.summary(Store.currentPeriod()).income`);
  check('收入已计入统计', incomeSum > 0, String(incomeSum));
  await click('[data-type="expense"]');

  console.log('\n=== 4. 低预算提醒 ===');
  await ev(`(function(){
    const p = Store.currentPeriod();
    const spent = Store.summary(p).expense;
    Store.setBudget(Math.round(spent * 1.05), {});
    Store.setSettings({alert:{enabled:true,thresholds:[80]}});
    Store.resetAlertLog();
    App.refresh();
    return 1;
  })()`);
  await ev(`App.go('add'); 1`); await sleep(300);
  for (const k of ['9', '9', '9']) await click(`[data-key="${k}"]`);
  await click('[data-key="ok"]');
  await sleep(1200);
  const alertShown = await ev(`(function(){const s=document.querySelector('.sheet'); return s ? s.textContent.indexOf('预算') >= 0 : false;})()`);
  check('超阈值后弹出预算提醒', alertShown, '未弹出');
  await ev(`UI.closeAllSheets(); 1`); await sleep(400);

  console.log('\n=== 5. 明细页筛选与搜索 ===');
  await ev(`App.go('detail'); 1`); await sleep(400);
  const totalRows = await ev(`document.querySelectorAll('[data-tx]').length`);
  check('明细页有账目', totalRows > 0, String(totalRows));
  await click('#view-detail [data-type="income"]');
  const incomeRows = await ev(`document.querySelectorAll('#view-detail [data-tx]').length`);
  check('筛选收入后条目减少', incomeRows < totalRows && incomeRows > 0, `${totalRows} → ${incomeRows}`);
  await click('#view-detail [data-type="all"]');
  await ev(`(function(){const i=document.querySelector('#kw'); i.value='打车'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
  await sleep(600);
  const searchRows = await ev(`document.querySelectorAll('[data-tx]').length`);
  check('搜索「打车」有结果', searchRows >= 1 && searchRows < totalRows, String(searchRows));
  await click('#view-detail [data-act="clear-all"]');

  console.log('\n=== 6. 分类视图切换 ===');
  await click('[data-act="toggle-view"]');
  const hasDonut = await ev(`!!document.querySelector('.chart-donut')`);
  check('分类视图渲染环形图', hasDonut, '无环形图');
  await click('[data-act="toggle-view"]');

  console.log('\n=== 7. 账目编辑与删除 ===');
  await ev(`App.go('detail'); 1`); await sleep(400);
  const firstTxId = await ev(`document.querySelector('[data-tx]').dataset.tx`);
  await click(`[data-tx="${firstTxId}"]`);
  await sleep(300);
  const sheetOk = await ev(`!!document.querySelector('.sheet')`);
  check('点击账目打开详情弹层', sheetOk, '无弹层');
  await click('[data-act="edit"]');
  await sleep(600);
  const inEdit = await ev(`document.querySelector('.key--ok').textContent.trim()`);
  check('进入编辑模式（按钮变保存）', inEdit.indexOf('保存') >= 0, inEdit);
  const editAmt = await ev(`document.querySelector('.amount-val').textContent.trim()`);
  check('编辑时回填原金额', !editAmt.startsWith('0.00'), editAmt);
  // 清空后重新输入 66
  for (let i = 0; i < 12; i++) await click('[data-key="del"]');
  for (const k of ['6', '6']) await click(`[data-key="${k}"]`);
  await click('[data-key="ok"]');
  await sleep(600);
  const updated = await ev(`Store.txById(${JSON.stringify(firstTxId)}).amount`);
  check('编辑后金额已更新为 ¥66', updated === 6600, String(updated));

  // 删除 + 撤销
  await ev(`App.go('detail'); 1`); await sleep(400);
  const delId = await ev(`document.querySelector('[data-tx]').dataset.tx`);
  const cntBefore = await ev(`Store.state.tx.length`);
  await click(`[data-tx="${delId}"]`);
  await sleep(300);
  await click('[data-act="del"]');
  await sleep(400);
  await click('.modal [data-act="ok"]');
  await sleep(500);
  const cntAfter = await ev(`Store.state.tx.length`);
  check('删除账目生效', cntAfter === cntBefore - 1, `${cntBefore} → ${cntAfter}`);
  const undoBtn = await ev(`!!document.querySelector('.toast button')`);
  check('出现撤销按钮', undoBtn, '无撤销');
  if (undoBtn) {
    await click('.toast button');
    await sleep(400);
    const cntUndo = await ev(`Store.state.tx.length`);
    check('撤销后恢复', cntUndo === cntBefore, `${cntAfter} → ${cntUndo}`);
  }

  console.log('\n=== 8. 攒钱目标全流程 ===');
  await ev(`App.go('goals'); 1`); await sleep(400);
  const goalsBefore = await ev(`Store.state.goals.length`);
  await click('[data-act="new"]');
  await sleep(400);
  await ev(`(function(){
    document.querySelector('#g-name').value = '端到端测试目标';
    document.querySelector('#g-target').value = '5000';
    document.querySelector('#g-saved').value = '0';
    return 1;
  })()`);
  await click('[data-act="save"]');
  await sleep(600);
  const goalsAfter = await ev(`Store.state.goals.length`);
  check('新建目标成功', goalsAfter === goalsBefore + 1, `${goalsBefore} → ${goalsAfter}`);
  const gid = await ev(`Store.state.goals[Store.state.goals.length-1].id`);
  // 存入
  await click(`[data-act="deposit"][data-id="${gid}"]`);
  await sleep(400);
  await ev(`document.querySelector('#d-amt').value = '2000'; 1`);
  await click('[data-act="ok"]');
  await sleep(600);
  const saved = await ev(`Store.goalById(${JSON.stringify(gid)}).saved`);
  check('存入 2000 元成功', saved === 200000, String(saved));
  const pctText = await ev(`(function(){const c=document.querySelector('[data-goal="${gid}"]'); return c ? c.textContent : '';})()`);
  check('进度显示 40%', pctText.indexOf('40%') >= 0, pctText.slice(0, 80));

  console.log('\n=== 9. 设置：自定义周期生效 ===');
  await ev(`App.go('settings'); 1`); await sleep(400);
  await ev(`Store.setCycle({type:'month', startDay:15}); App.refresh(); 1`);
  await sleep(400);
  const cycDesc = await ev(`(function(){const r=document.querySelector('[data-act="cycle"]'); return r ? r.textContent : '';})()`);
  check('设置页显示 15 日起算', cycDesc.indexOf('15') >= 0, cycDesc);
  await ev(`App.go('detail'); 1`); await sleep(400);
  const periodLabel = await ev(`document.querySelector('.period-label').textContent`);
  check('明细页周期已按 15 日切分', /15日/.test(periodLabel), periodLabel);
  await ev(`Store.setCycle({type:'month', startDay:1}); App.refresh(); 1`);

  console.log('\n=== 10. 主题切换 ===');
  await ev(`Store.setSettings({theme:'dark'}); App.applyTheme(); 1`); await sleep(300);
  const darkAttr = await ev(`document.documentElement.getAttribute('data-theme')`);
  check('深色主题生效', darkAttr === 'dark', darkAttr);
  await ev(`Store.setSettings({theme:'light'}); App.applyTheme(); 1`); await sleep(200);
  const lightAttr = await ev(`document.documentElement.getAttribute('data-theme')`);
  check('浅色主题生效', lightAttr === 'light', lightAttr);

  console.log('\n=== 11. 数据持久化 ===');
  await send('Page.reload');
  await sleep(2600);
  const persisted = await ev(`Store.state.tx.length`);
  check('刷新后数据仍在', persisted > 0, String(persisted));
  const goalPersisted = await ev(`Store.state.goals.some(g => g.name === '端到端测试目标')`);
  check('刷新后目标仍在', goalPersisted, '目标丢失');

  console.log('\n=== 12. 离线（Service Worker）===');
  const swReg = await ev(`navigator.serviceWorker.getRegistration().then(r => !!r)`);
  check('Service Worker 已注册', swReg, '未注册');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n通过 ${pass} / ${results.length}`);
  if (errors.length) console.log('\n异常:\n' + errors.slice(0, 10).join('\n'));

  ws.close(); await env.stop(proc);
  await sleep(300);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e); process.exit(1); });
