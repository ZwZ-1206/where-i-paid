/* 截取 AI 接入 + 识图相关界面 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9342;
const OUT = env.shots('shoot-ai'); // 截图是产出物，落在系统临时目录，不进源码树（见 O1）
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
  const PROFILE = env.profile('ai');
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

  await cdp.send('Page.navigate', { url: BASE });
  await sleep(2800);

  // 预置：AI 已配置（假 Key，仅用于展示 UI）
  await ev(`(function(){
    Store.setSettings({
      ai: { enabled: true, preset: 'dashscope', apiKey: 'sk-demo-xxxxxxxxxxxxxxxx',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            model: 'qwen-plus', visionModel: 'qwen-vl-max', style: 'warm' },
      scan: { engine: 'auto' },
      tip: { enabled: true, place: 'add' }
    });
    Tips.clearCache();
    return 1;
  })()`);

  // a1 设置页 AI 分组
  await ev(`App.go('settings')`);
  await shot('a1-settings-ai-group');

  // a2 AI 配置弹层
  await ev(`ViewSettings.openAiSheet()`);
  await shot('a2-ai-sheet');
  // a2b 滚动到下方（模型/风格/测试）
  await ev(`(function(){ var b=document.querySelector('#sheet-root .sheet-body')||document.querySelector('#sheet-root .sheet'); if(b) b.scrollTop = 420; return 1; })()`);
  await shot('a2b-ai-sheet-lower');
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
  await sleep(500);

  // a3 识图设置弹层
  await ev(`ViewSettings.openScanSheet()`);
  await shot('a3-scan-sheet');
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
  await sleep(500);

  // a4 记账页：识图气泡（支出模式）
  await ev(`App.go('add')`);
  await ev(`(function(){ var b=document.querySelector('.view[data-view="add"] .type-switch button[data-type="expense"]'); if(b) b.click(); return 1; })()`);
  await sleep(300);
  await shot('a4-add-scan-bubble');

  // a4b 记账页：识图气泡（收入模式，绿色）
  await ev(`(function(){ var b=document.querySelector('.view[data-view="add"] .type-switch button[data-type="income"]'); if(b) b.click(); return 1; })()`);
  await sleep(300);
  await shot('a4b-add-scan-bubble-income');
  await ev(`(function(){ var b=document.querySelector('.view[data-view="add"] .type-switch button[data-type="expense"]'); if(b) b.click(); return 1; })()`);
  await sleep(300);

  // a5 识图弹层（空态，支出）
  await ev(`Scan.open()`);
  await shot('a5-scan-sheet-empty');
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
  await sleep(500);

  // a5b 识图弹层（空态，收入模式）
  await ev(`Scan.open({ preferType: 'income' })`);
  await shot('a5b-scan-sheet-income');
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
  await sleep(500);

  // a6 识图结果态（用 open(seed) 注入假结果）
  await ev(`(function(){
    Scan.open({
      result: {
        platform: 'wechat',
        engine: 'ai',
        warning: '',
        entries: [
          { type:'expense', amount: 2580, catId:'food', sub:'午餐', merchant:'沙县小吃', note:'沙县小吃', ts: Date.now(), confidence: 0.96, engine:'ai' },
          { type:'expense', amount: 1250, catId:'transport', sub:'打车', merchant:'滴滴出行', note:'滴滴出行', ts: Date.now(), confidence: 0.91, engine:'ai' }
        ]
      }
    });
    return 1;
  })()`);
  await sleep(600);
  await shot('a6-scan-result');
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
  await sleep(500);

  // a6b 识图结果态（收入模式：识别成支出的结果被纠正为收入）
  await ev(`(function(){
    Scan.open({
      preferType: 'income',
      result: {
        platform: 'alipay',
        engine: 'ai',
        warning: '',
        entries: [
          { type:'expense', amount: 500000, catId:'other_out', sub:'', merchant:'某某科技有限公司', note:'工资', ts: Date.now(), confidence: 0.94, engine:'ai' }
        ]
      }
    });
    return 1;
  })()`);
  await sleep(600);
  await shot('a6b-scan-result-income');
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
  await sleep(500);

  // a7 报告页 AI 月度卡（无缓存 → 生成按钮）
  await ev(`(function(){ Store.setSettings({ai:{monthCache:{}, dailyCache:{}}}); App.go('report'); return 1; })()`);
  await shot('a7-report-ai-empty');

  // a8 报告页 AI 月度卡（有内容）
  await ev(`(function(){
    var p = Store.scopePeriod('month', new Date());
    var cache = {};
    cache[p.key] = {
      headline: '这个月，钱大多花在了住得安心上',
      story: '这个月你一共记了 17 笔，花了 ¥4,331.04。居住占了大头，65%——房租这类开销绕不开，但它换来的是每天能踏实睡觉的地方。\\n购物占了 14%，比上月多一点点，不算失控。餐饮只有 4%，倒是可以问问自己：是不是又忙到随便对付了？',
      highlights: [
        { label: '最大开销', value: '居住 65%' },
        { label: '单日最高', value: '10 月 3 日 ¥1,680' },
        { label: '记账笔数', value: '17 笔' }
      ],
      advice: ['餐饮只占 4%，别把吃饭排在最后一位', '娱乐这个月是 0，留一点钱给让自己开心的事'],
      chart: { type:'donut', dimension:'cat', title:'支出结构', reason:'居住占比明显最高，环形图能一眼看出重心' },
      periodKey: p.key, periodLabel: p.label, sig: 'demo', ts: Date.now() - 3600000, model: 'qwen-plus'
    };
    Store.setSettings({ai:{monthCache: cache}});
    App.go('report');
    return 1;
  })()`);
  await shot('a8-report-ai-card');
  // a8b 往下滚，看图表与建议
  await ev(`(function(){ var v=document.querySelector('.view[data-view="report"]'); if(v) v.scrollTop = 320; return 1; })()`);
  await shot('a8b-report-ai-card-lower');
  await ev(`(function(){ var v=document.querySelector('.view[data-view="report"]'); if(v) v.scrollTop = 0; return 1; })()`);

  // a9 记账页 AI 暖心卡
  await ev(`(function(){
    var y = new Date(); y.setDate(y.getDate() - 1);
    var key = U.ymd(y);
    var cache = {};
    cache[key] = {
      text: '昨天你在吃饭上花得最多，也给自己买了杯咖啡。这种不亏待自己的花法，挺好的。',
      headline: '好好吃饭，就是好好生活',
      tip: '今天可以多走两步，别总打车',
      mood: 'good', dateKey: key, sig: AI.dailySig(y), ts: Date.now(), model: 'qwen-plus'
    };
    Store.setSettings({ai:{dailyCache: cache}});
    Tips.clearCache();
    App.go('add');
    return 1;
  })()`);
  await shot('a9-add-ai-tip-card');

  // a10 提示弹层里的 AI 区块
  await ev(`(function(){ document.querySelector('.view[data-view="add"] .tip-card [data-tip="open"]').click(); return 1; })()`);
  await shot('a10-tip-sheet-ai');
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
  await sleep(500);

  // a11 深色：AI 月度卡
  await ev(`(function(){ Store.setSettings({theme:'dark'}); App.applyTheme(); App.go('report'); return 1; })()`);
  await shot('a11-dark-report-ai');

  // a12 深色：AI 配置弹层
  await ev(`(function(){ App.go('settings'); return 1; })()`);
  await sleep(500);
  await ev(`ViewSettings.openAiSheet()`);
  await shot('a12-dark-ai-sheet');
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); return 1; })()`);
  await sleep(500);

  // a13 深色：记账页 AI 暖心卡
  await ev(`(function(){ App.go('add'); return 1; })()`);
  await shot('a13-dark-add-ai-tip');

  // a14 深色：识图结果
  await ev(`(function(){
    Scan.open({
      result: {
        platform: 'alipay', engine: 'ocr', warning: '',
        entries: [
          { type:'expense', amount: 4580, catId:'shopping', sub:'衣服', merchant:'优衣库', note:'优衣库', ts: Date.now(), confidence: null, engine:'ocr' }
        ]
      }
    });
    return 1;
  })()`);
  await shot('a14-dark-scan-result');

  await ev(`(function(){ Store.setSettings({theme:'auto'}); App.applyTheme(); return 1; })()`);
  console.log('done');
  ws_cleanup: { }
  cdp.ws.close(); await env.stop(proc);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
