/* 专门截取「分类」相关界面：记账页分类条、二级标签、月度分类占比、分类预算 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9337;
const PROFILE = env.profile('cat');
const OUT = env.shots('shoot-cat'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
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
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + PROFILE,
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (n) => {
    await sleep(520);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(data, 'base64'));
    console.log('  shot:', n);
  };
  const nav = async (h) => { await ev(`location.hash='${h}'; App.go('${h.replace('#','')}'); 1`); await sleep(420); };

  await cdp.send('Page.navigate', { url: BASE });
  await sleep(2400);

  // 1. 记账页：分类条（餐饮/买菜/交通/购物/居住/娱乐…）
  await nav('#add');
  await shot('c1-add-categories');

  // 2. 选中「餐饮」→ 二级标签（早餐/午餐/晚餐/夜宵/外卖…）
  await ev(`document.querySelector('[data-cat="food"]').click(); 1`);
  await sleep(320);
  await shot('c2-add-food-subs');

  // 3. 切到收入 → 收入分类
  await ev(`document.querySelector('[data-type="income"]').click(); 1`);
  await sleep(320);
  await shot('c3-add-income-categories');

  // 4. 月度总结：分类占比环形图 + 排行
  await nav('#report');
  await shot('c4-report-cat-donut');

  // 5. 明细页：分类排行
  await nav('#detail');
  await shot('c5-detail-cat-rank');

  // 6. 分类预算
  await nav('#settings');
  await ev(`ViewSettings.openBudgetSheet(); 1`);
  await shot('c6-budget-per-category');

  // 统计实际分类数量
  const stat = await ev(`(function(){
    const cats = Icons.CATEGORIES;
    return {
      expense: cats.filter(c=>c.kind==='expense').length,
      income: cats.filter(c=>c.kind==='income').length,
      totalSubs: cats.reduce((s,c)=>s+c.subs.length,0),
      names: cats.filter(c=>c.kind==='expense').map(c=>c.name).join(' '),
      incomeNames: cats.filter(c=>c.kind==='income').map(c=>c.name).join(' '),
    };
  })()`);
  console.log('\n分类统计:', JSON.stringify(stat, null, 2));

  cdp.ws.close(); await env.stop(proc);
  await sleep(400);
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
