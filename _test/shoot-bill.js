/* 截取账单 CSV 导入相关界面 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9352;
const OUT = env.shots('shoot-bill'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
const BASE = 'http://localhost:4173/index.html';

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

// 一份足够像真的微信账单
const WECHAT_CSV = [
  '微信支付账单明细',
  '微信昵称：[张三]',
  '起始时间：[2026-02-01 00:00:00] 终止时间：[2026-02-28 23:59:59]',
  '导出类型：[全部]',
  '',
  '----------------------微信支付账单明细列表--------------------',
  '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
  '2026-02-03 12:31:05,商户消费,沙县小吃,拌面,支出,¥18.00,零钱,支付成功,10001,M001,',
  '2026-02-04 08:12:00,商户消费,滴滴出行,快车,支出,¥25.80,零钱,支付成功,10002,M002,',
  '2026-02-05 10:00:00,转账,李四,转账,收入,¥200.00,零钱,已收钱,10003,M003,还款',
  '2026-02-06 19:00:00,商户消费,美团,外卖,支出,¥38.50,零钱,支付成功,10004,M004,',
  '2026-02-08 14:20:00,商户消费,永辉超市,日用品,支出,¥126.40,零钱,支付成功,10006,M006,',
  '2026-02-09 20:10:00,商户消费,万达影城,电影票,支出,¥88.00,零钱,支付成功,10007,M007,',
  '2026-02-07 09:00:00,零钱提现,工商银行,提现,/,¥500.00,零钱,提现已到账,10005,M005,',
].join('\n');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PROFILE = env.profile('bill');
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
    await sleep(600);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(data, 'base64'));
    console.log('  shot:', n);
  };
  const closeAll = async () => {
    await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
    await sleep(450);
  };

  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3000);

  // b1 设置页：数据组出现「导入账单」
  await ev(`App.go('settings')`);
  await sleep(400);
  await ev(`(function(){ var v=document.querySelector('.view[data-view="settings"]'); if(v) v.scrollTop = 300; return 1; })()`);
  await shot('b1-settings-bill-entry');

  // b2 空态：选择文件 + 导出指南
  await ev(`Bills.open()`);
  await shot('b2-bill-empty');

  // b2b 空态下半：导出指南
  await ev(`(function(){ var b=document.querySelector('#sheet-root .sheet-body')||document.querySelector('#sheet-root .sheet'); if(b) b.scrollTop = 500; return 1; })()`);
  await shot('b2b-bill-empty-tips');
  await closeAll();

  // b3 解析结果（全选）
  await ev(`(function(){
    var r = Bills.parseText(${JSON.stringify(WECHAT_CSV)});
    var seen = Store.srcKeys();
    var inc = r.entries.map(function(e){ return !seen.has(e.srcKey); });
    Bills.open({ parsed: r, fileName: '微信支付账单(20260201-20260228).csv',
      dupCount: inc.filter(function(x){ return !x; }).length, include: inc });
    return 1;
  })()`);
  await shot('b3-bill-parsed');

  // b3b 结果下半：列表尾部与按钮
  await ev(`(function(){ var b=document.querySelector('#sheet-root .sheet-body')||document.querySelector('#sheet-root .sheet'); if(b) b.scrollTop = 700; return 1; })()`);
  await shot('b3b-bill-parsed-lower');
  await closeAll();

  // b4 取消两笔后的状态
  await ev(`(function(){
    var r = Bills.parseText(${JSON.stringify(WECHAT_CSV)});
    var inc = r.entries.map(function(e){ return true; });
    inc[0] = false; inc[1] = false;
    Bills.open({ parsed: r, fileName: '微信支付账单.csv', dupCount: 0, include: inc });
    return 1;
  })()`);
  await shot('b4-bill-unchecked');
  await closeAll();

  // b5 重复导入提示
  await ev(`(function(){
    var r = Bills.parseText(${JSON.stringify(WECHAT_CSV)});
    var inc = r.entries.map(function(e, i){ return i > 3; });
    Bills.open({ parsed: r, fileName: '微信支付账单.csv', dupCount: 4, include: inc });
    return 1;
  })()`);
  await shot('b5-bill-dup');
  await closeAll();

  // b6 深色：空态
  await ev(`Store.setSettings({ theme: 'dark' })`);
  await sleep(500);
  await ev(`Bills.open()`);
  await shot('b6-bill-empty-dark');

  // b7 深色：结果
  await ev(`(function(){
    var b = document.querySelectorAll('#sheet-root .sheet-close');
    if (b.length) b[b.length-1].click();
    return 1;
  })()`);
  await sleep(450);
  await ev(`(function(){
    var r = Bills.parseText(${JSON.stringify(WECHAT_CSV)});
    var inc = r.entries.map(function(e){ return true; });
    Bills.open({ parsed: r, fileName: '微信支付账单.csv', dupCount: 0, include: inc });
    return 1;
  })()`);
  await shot('b7-bill-parsed-dark');
  await closeAll();

  // b8 导入后明细页（走真实点击路径：解析 → 全选 → 点「导入」）
  await ev(`Store.setSettings({ theme: 'light' })`);
  await sleep(400);
  await ev(`(function(){
    var r = Bills.parseText(${JSON.stringify(WECHAT_CSV)});
    var inc = r.entries.map(function(e){ return true; });
    Bills.open({ parsed: r, fileName: '微信支付账单.csv', dupCount: 0, include: inc });
    return 1;
  })()`);
  await sleep(500);
  await ev(`(function(){ var b=document.querySelector('#sheet-root #bill-save'); if(b) b.click(); return 1; })()`);
  await sleep(1000);
  await shot('b8-detail-after-import');

  // b8b 明细页的提示（toast 显示跳到了哪个月）
  const jumped = await ev(`(function(){
    var p = Store.shiftPeriod(Store.scopePeriod('month', new Date()), ViewDetail.state.offset);
    return { offset: ViewDetail.state.offset, key: p.key };
  })()`);
  console.log('  jumped:', JSON.stringify(jumped));

  // 统计
  const stat = await ev(`(function(){
    return { tx: Store.state.tx.length, bills: Object.keys(window.Bills).length };
  })()`);
  console.log('  stat:', JSON.stringify(stat));

  cdp.ws.close(); await env.stop(proc);
  console.log('done');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
