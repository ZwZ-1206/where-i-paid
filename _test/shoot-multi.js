/* 截取多账本 / 周期记账 / 自定义分类 / 年月日总结 / 双气泡 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9355;
const OUT = env.shots('shoot-multi'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
const BASE = 'http://127.0.0.1:4173/index.html';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static connect(u) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(u);
      ws.onopen = () => { const c = new CDP(ws); c.attach(); res(c); };
      ws.onerror = () => rej(new Error('ws error'));
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  attach() {
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    };
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PROFILE = env.profile('multi');
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=2', 'about:blank',
  ], { stdio: 'ignore' });

  await sleep(2600);
  let target;
  for (let i = 0; i < 25; i++) {
    try {
      const list = await getJSON('/json/list');
      target = list.find((t) => t.type === 'page' && !/chrome-extension|devtools/.test(t.url));
      if (target) break;
    } catch (e) {}
    await sleep(400);
  }
  if (!target) { console.error('无法连接'); await env.stop(proc); process.exit(1); }

  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' | ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (n) => {
    await sleep(650);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(data, 'base64'));
    console.log('  shot:', n);
  };
  const closeSheets = async () => {
    await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
    await sleep(420);
  };

  await cdp.send('Page.navigate', { url: BASE });
  await sleep(2900);

  // 预置：造几本账本 + 一条周期规则 + 一个自定义分类
  await ev(`(function(){
    var b1 = Store.addBook({ name:'旅行', icon:'✈️', color:'#14B87A' });
    Store.addBook({ name:'装修', icon:'🏠', color:'#FF7A45' });
    Store.addCategory({ name:'宠物粮', icon:'🐶', color:'#FF7A45', kind:'expense', subs:['狗粮','猫粮','零食'] });
    Store.updateCategory('fun', { name:'玩乐' });
    Store.addRepeat({ name:'房租', type:'expense', amount: 220000, catId:'housing', freq:'monthly', startDay:5, startYm:'2026-01' });
    Store.addRepeat({ name:'Netflix 会员', type:'expense', amount: 4800, catId:'fun', freq:'monthly', startDay:12, startYm:'2026-02' });
    Store.switchBook(Store.books()[0].id);
    return 1;
  })()`);

  // ---------- 记账页 ----------
  await ev(`App.go('add')`);
  await shot('m1-add-bookbar-bubbles');

  // m2 账本选择器
  await ev(`(function(){ document.querySelector('.view[data-view="add"] .book-pill[data-act="book"]').click(); return 1; })()`);
  await shot('m2-book-picker');
  await closeSheets();

  // m3 记账页（收入模式：绿气泡 + 橙色账单气泡）
  await ev(`(function(){ var b=document.querySelector('.view[data-view="add"] .type-switch button[data-type="income"]'); if(b) b.click(); return 1; })()`);
  await sleep(320);
  await shot('m3-add-bubbles-income');
  await ev(`(function(){ var b=document.querySelector('.view[data-view="add"] .type-switch button[data-type="expense"]'); if(b) b.click(); return 1; })()`);
  await sleep(320);

  // ---------- 设置页 ----------
  await ev(`App.go('settings')`);
  await shot('m4-settings-books-group');
  await ev(`(function(){ var v=document.querySelector('.view[data-view="settings"]'); if(v) v.scrollTop = 260; return 1; })()`);
  await shot('m4b-settings-books-group-lower');
  await ev(`(function(){ var v=document.querySelector('.view[data-view="settings"]'); if(v) v.scrollTop = 0; return 1; })()`);

  // m5 多账本弹层
  await ev(`ViewSettings.openBooksSheet()`);
  await shot('m5-books-sheet');
  await closeSheets();

  // m6 新建账本弹层
  await ev(`ViewSettings.openBookEdit(null, function(){})`);
  await shot('m6-book-edit');
  await closeSheets();

  // m7 周期记账列表
  await ev(`ViewSettings.openRepeatsSheet()`);
  await shot('m7-repeats-sheet');
  await closeSheets();

  // m8 新建规则弹层
  await ev(`ViewSettings.openRepeatsSheet()`);
  await sleep(400);
  await ev(`(function(){ document.querySelector('#sheet-root [data-repact="add"]').click(); return 1; })()`);
  await shot('m8-repeat-edit');
  await ev(`(function(){ var b=document.querySelector('#sheet-root .sheet-body'); if(b) b.scrollTop = 380; return 1; })()`);
  await shot('m8b-repeat-edit-lower');
  await closeSheets();
  await closeSheets();

  // m9 分类管理（支出）
  await ev(`ViewSettings.openCatsSheet()`);
  await shot('m9-cats-sheet');
  // m9b 收入分类
  await ev(`(function(){ document.querySelector('#sheet-root [data-ckind="income"]').click(); return 1; })()`);
  await shot('m9b-cats-sheet-income');
  // m9c 回到支出并滚到底部（工具按钮）
  await ev(`(function(){ document.querySelector('#sheet-root [data-ckind="expense"]').click(); return 1; })()`);
  await sleep(400);
  await ev(`(function(){ var b=document.querySelector('#sheet-root .sheet-body'); if(b) b.scrollTop = 400; return 1; })()`);
  await shot('m9c-cats-sheet-lower');
  await closeSheets();

  // m10 编辑自定义分类
  await ev(`(function(){
    var cc = Store.catConfig();
    var id = cc.custom.length ? cc.custom[0].id : null;
    if (id) ViewSettings.openCatsSheet();
    return id || '';
  })()`);
  await sleep(500);
  await ev(`(function(){
    var it = document.querySelector('#sheet-root .catm-item');
    if (it) it.click();
    return 1;
  })()`);
  await shot('m10-cat-edit');
  await closeSheets();
  await closeSheets();

  // ---------- 总结页：年月日 ----------
  await ev(`(function(){ ViewReport.setScope('month'); App.go('report'); return 1; })()`);
  await shot('m11-report-month');

  await ev(`(function(){ var b=document.querySelector('.view[data-view="report"] .seg-tab[data-scope="day"]'); if(b) b.click(); return 1; })()`);
  await shot('m12-report-day');

  await ev(`(function(){ var b=document.querySelector('.view[data-view="report"] .seg-tab[data-scope="year"]'); if(b) b.click(); return 1; })()`);
  await shot('m13-report-year');

  // m14 对比选择弹层
  await ev(`(function(){ var b=document.querySelector('.view[data-view="report"] .cmp-bar'); if(b) b.click(); return 1; })()`);
  await shot('m14-cmp-picker');
  await closeSheets();

  // ---------- 账单跨月 ----------
  await ev(`(function(){
    var csv = [
      '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
      '2026-01-15 12:00:00,商户消费,沙县小吃,拌面,支出,¥18.00,零钱,支付成功,90001,M9001,',
      '2026-01-20 19:30:00,商户消费,永辉超市,蔬菜,支出,¥86.40,零钱,支付成功,90004,M9004,',
      '2026-02-20 12:00:00,商户消费,滴滴出行,快车,支出,¥25.80,零钱,支付成功,90002,M9002,',
      '2026-02-25 09:00:00,转账,李四,转账,收入,¥200.00,零钱,已收钱,90005,M9005,还款',
      '2026-03-08 12:00:00,商户消费,优衣库,衣服,支出,¥199.00,零钱,支付成功,90003,M9003,',
      '2026-03-09 20:00:00,商户消费,万达影城,电影票,支出,¥76.00,零钱,支付成功,90006,M9006,'
    ].join('\\n');
    var r = window.Bills.parseText(csv);
    window.Bills.open({ parsed: r, fileName: '微信支付账单(20260101-20260331).csv', include: r.entries.map(function(){ return true; }), dupCount: 0 });
    return 1;
  })()`);
  await shot('m15-bill-crossmonth');
  await ev(`(function(){ var b=document.querySelector('#sheet-root .sheet-body'); if(b) b.scrollTop = 340; return 1; })()`);
  await shot('m15b-bill-crossmonth-lower');
  await closeSheets();

  // ---------- 深色 ----------
  await ev(`(function(){ Store.setSettings({theme:'dark'}); App.applyTheme(); App.go('add'); return 1; })()`);
  await shot('m16-dark-add');
  await ev(`ViewSettings.openCatsSheet()`);
  await shot('m17-dark-cats');
  await closeSheets();
  await ev(`(function(){ ViewReport.setScope('month'); App.go('report'); return 1; })()`);
  await shot('m18-dark-report-tabs');

  await ev(`(function(){ Store.setSettings({theme:'auto'}); App.applyTheme(); return 1; })()`);
  console.log('done');
  cdp.ws.close(); await env.stop(proc);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
