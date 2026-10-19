/* 截取「暖心提示」相关界面：记账页卡片、弹层、明细页单行、报告页单行、设置页开关、深色模式 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9338;
const OUT = env.shots('shoot-tip'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const PROFILE = env.profile('tip');
  fs.rmSync(PROFILE, { recursive: true, force: true }); // 每次都干净，避免旧 SW 缓存
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
    await sleep(560);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(data, 'base64'));
    console.log('  shot:', n);
  };
  const nav = async (h) => { await ev(`location.hash='${h}'; App.go('${h.replace('#','')}'); 1`); await sleep(440); };

  await cdp.send('Page.navigate', { url: BASE });
  await sleep(2600);

  // 确保有「昨天」的数据：清掉 seed 后手工造一天
  await ev(`(function(){
    const S = window.Store, U = window.U, Tips = window.Tips;
    S.setSettings({tip:{enabled:true,place:'add',offset:0}});
    Tips.clearCache();
    const y = U.startOfDay(U.addDays(new Date(), -1)).getTime();
    const has = S.state.tx.some(t => t.ts >= y && t.ts < y + 86400000);
    if (!has) {
      S.addTx({type:'expense', amount:1800, catId:'food', sub:'午餐', accountId:'wechat', ts: y + 12*3600000});
      S.addTx({type:'expense', amount:900,  catId:'food', sub:'早餐', accountId:'alipay', ts: y + 8*3600000});
      S.addTx({type:'expense', amount:4500, catId:'shopping', sub:'衣服', accountId:'alipay', ts: y + 19*3600000});
    }
    window.App.refresh();
    return S.state.tx.length;
  })()`);

  // 1. 记账页：暖心提示卡片（浅色）
  await nav('#add');
  await shot('t1-add-tip-card');

  // 2. 提示弹层
  await ev(`document.querySelector('.tip-card [data-tip="open"]').click(); 1`);
  await shot('t2-tip-sheet');

  // 3. 明细页单行提示
  await ev(`UI.closeAllSheets(); 1`);
  await sleep(400);
  await nav('#detail');
  await shot('t3-detail-tip-slim');

  // 4. 报告页单行提示
  await nav('#report');
  await shot('t4-report-tip-slim');

  // 5. 设置页：暖心提示开关行
  await nav('#settings');
  await shot('t5-settings-tip-row');

  // 6. 设置页：暖心提示弹层
  await ev(`ViewSettings.openTipSheet(); 1`);
  await shot('t6-settings-tip-sheet');

  // 7. 深色模式下的记账页卡片
  await ev(`UI.closeAllSheets(); Store.setSettings({theme:'dark'}); App.applyTheme(); 1`);
  await sleep(400);
  await nav('#add');
  await shot('t7-add-tip-dark');

  // 8. 深色模式下的提示弹层
  await ev(`document.querySelector('.tip-card [data-tip="open"]').click(); 1`);
  await shot('t8-tip-sheet-dark');

  // 统计
  const stat = await ev(`(function(){
    const t = Tips.forYesterday();
    return {
      rules: Tips.RULES.length,
      copyGroups: Object.keys(Tips.COPY).length,
      totalLines: Object.values(Tips.COPY).reduce((s,c)=>s+c.lines.length,0),
      dateKey: t.dateKey, dateLabel: t.dateLabel,
      items: t.items.map(x=>({id:x.id, tone:x.tone, text:x.text})),
      stats: t.stats,
      place: Tips.place(),
      enabled: Tips.enabled(),
    };
  })()`);
  console.log('\n暖心提示统计:', JSON.stringify(stat, null, 2));

  // 主题还原
  await ev(`Store.setSettings({theme:'auto'}); App.applyTheme(); 1`);

  cdp.ws.close(); await env.stop(proc);
  await sleep(400);
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
