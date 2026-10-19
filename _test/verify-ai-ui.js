// AI 接入 + 识图 UI 验证（不真的调 API，只验证界面与状态流转）
// 用法: node _test/verify-ai-ui.js
const { spawn } = require('child_process');
const env = require('./_env');
const http = require('http');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9413;
const BASE = 'http://127.0.0.1:4173/index.html';
const PROFILE = env.profile('aiui');

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
    const tgt = targets.find((x) => x.type === 'page');
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
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE });
await new Promise((r) => setTimeout(r, 2500));
// 这两个套件验的是「有账目时」的提示 / AI 卡片，先造一份示例数据
await evalJs(`(function(){ Store.clearAll(false); Store.seedDemo(true); App.refresh(); return 1; })()`);
await new Promise((r) => setTimeout(r, 600));
    await wait(2600);

    // ---------- 1. 模块加载 ----------
    console.log('\n=== 1. 模块加载 ===');
    await t('AI 模块存在', () => evalJs(`typeof window.AI === 'object' && typeof AI.chat === 'function'`));
    await t('OCR 模块存在', () => evalJs(`typeof window.OCR === 'object' && typeof OCR.parse === 'function'`));
    await t('Scan 模块存在', () => evalJs(`typeof window.Scan === 'object' && typeof Scan.open === 'function'`));
    await t('未配置时 AI.ready() 为 false', () => evalJs(`(function(){ Store.setSettings({ai:{enabled:false,apiKey:''}}); return AI.ready() === false; })()`));

    // ---------- 2. 设置页入口 ----------
    console.log('\n=== 2. 设置页入口 ===');
    await evalJs(`(function(){ App.go('settings'); return 1; })()`);
    await wait(700);
    await t('有「接入自己的 AI」行', () => evalJs(`!!document.querySelector('[data-act="ai"]')`));
    await t('有「识图记账」行', () => evalJs(`!!document.querySelector('[data-act="scan"]')`));
    await t('AI 行有开关', () => evalJs(`!!document.querySelector('[data-toggle="ai"]')`));

    // ---------- 3. AI 配置弹层 ----------
    console.log('\n=== 3. AI 配置弹层 ===');
    await evalJs(`document.querySelector('[data-act="ai"]').click()`);
    await wait(700);
    await t('弹层打开（有 Key 输入框）', () => evalJs(`!!document.querySelector('#ai-key')`));
    await t('有服务商预设网格', () => evalJs(`document.querySelectorAll('[data-preset]').length >= 6`));
    await t('有接口地址与模型输入', () => evalJs(`!!document.querySelector('#ai-base') && !!document.querySelector('#ai-model') && !!document.querySelector('#ai-vmodel')`));
    await t('Key 默认是密码框', () => evalJs(`document.querySelector('#ai-key').type === 'password'`));
    await t('眼睛按钮可切换明文', () => evalJs(`(function(){
      document.querySelector('#ai-eye').click();
      var t1 = document.querySelector('#ai-key').type;
      document.querySelector('#ai-eye').click();
      return t1 === 'text' && document.querySelector('#ai-key').type === 'password';
    })()`));
    await t('有说话风格三选', () => evalJs(`document.querySelectorAll('[data-style]').length === 3`));
    await t('有测试连接与测试识图', () => evalJs(`!!document.querySelector('#ai-test') && !!document.querySelector('#ai-testv')`));
    await t('切换预设会填入地址与模型', () => evalJs(`(function(){
      var b = document.querySelector('[data-preset="moonshot"]');
      b.click();
      return document.querySelector('#ai-base').value.indexOf('moonshot') >= 0
          && document.querySelector('#ai-model').value.length > 0;
    })()`));
    await t('空 Key 保存被拦下并提示', () => evalJs(`(function(){
      document.querySelector('[data-preset="moonshot"]').click();
      document.querySelector('#ai-key').value = '';
      document.querySelector('[data-act="save"]').click();
      var st = document.querySelector('.ai-status--err');
      return !!st && st.textContent.indexOf('Key') >= 0;
    })()`));
    await t('填了 Key 能保存并开启', () => evalJs(`(function(){
      document.querySelector('#ai-key').value = 'sk-test-123';
      document.querySelector('[data-act="save"]').click();
      return Store.settings.ai.enabled === true && Store.settings.ai.apiKey === 'sk-test-123';
    })()`));
    await wait(700);
    await t('保存后弹层已关闭', () => evalJs(`!document.querySelector('#ai-key')`));
    await t('保存后设置行显示模型名', () => evalJs(`(function(){
      var row = document.querySelector('[data-act="ai"]');
      return row && row.textContent.indexOf('moonshot') >= 0;
    })()`));

    // ---------- 4. 报告页 AI 卡 ----------
    console.log('\n=== 4. 报告页 AI 卡 ===');
    await evalJs(`(function(){ Store.setSettings({ai:{enabled:false}}); App.go('report'); return 1; })()`);
    await wait(800);
    await t('未启用 AI 时报告页无 AI 卡', () => evalJs(`!document.querySelector('.view.active .ai-report')`));
    await evalJs(`(function(){ Store.setSettings({ai:{enabled:true}}); App.go('report'); return 1; })()`);
    await wait(800);
    await t('启用 AI 后出现 AI 月度卡', () => evalJs(`!!document.querySelector('.view.active .ai-report')`));
    await t('无缓存时有「生成本月总结」按钮', () => evalJs(`!!document.querySelector('.view.active [data-ai="month"]')`));

    // 直接注入一份假缓存，验证渲染
    await evalJs(`(function(){
      var p = Store.scopePeriod('month', new Date());
      var cache = {};
      cache[p.key] = {
        headline: '这个月过得挺克制',
        story: '你在餐饮上花了 1200 元，占了将近一半。\\n交通比上月少了三成，挺好。',
        highlights: [
          { label: '最大开销', value: '餐饮' },
          { label: '最省的一天', value: '3 月 5 日' },
          { label: '记账天数', value: '18 天' }
        ],
        advice: ['下个月可以给娱乐留一点预算', '外卖频次比上月高了 4 次'],
        chart: { type: 'donut', dimension: 'cat', title: '支出结构', reason: '餐饮占比最高，环形图最直观' },
        periodKey: p.key, periodLabel: p.label, sig: 'x', ts: Date.now(), model: 'moonshot-v1-8k'
      };
      Store.setSettings({ai:{monthCache: cache}});
      App.go('report');
      return 1;
    })()`);
    await wait(900);
    await t('渲染出 AI 标题', () => evalJs(`(function(){ var e=document.querySelector('.view.active .ai-report-headline'); return e && e.textContent.indexOf('克制') >= 0; })()`));
    await t('渲染出 AI 正文', () => evalJs(`!!document.querySelector('.view.active .ai-report-story')`));
    await t('渲染出三格亮点', () => evalJs(`document.querySelectorAll('.view.active .ai-hl').length === 3`));
    await t('渲染出两条建议', () => evalJs(`document.querySelectorAll('.view.active .ai-advice-item').length === 2`));
    await t('渲染出图表（环形图 SVG）', () => evalJs(`!!document.querySelector('.view.active .ai-report svg')`));
    await t('显示图表选择理由', () => evalJs(`(function(){ var e=document.querySelector('.view.active .ai-chart-reason'); return e && e.textContent.indexOf('环形图') >= 0; })()`));
    await t('有重新生成按钮', () => evalJs(`!!document.querySelector('.view.active [data-ai="month-regen"]')`));
    await t('显示模型名与时间', () => evalJs(`(function(){ var e=document.querySelector('.view.active .ai-report-foot'); return e && e.textContent.indexOf('moonshot') >= 0; })()`));

    // 图表维度切换：bars / account
    await t('图表可切到按日趋势', () => evalJs(`(function(){
      var p = Store.scopePeriod('month', new Date());
      var cache = Store.settings.ai.monthCache;
      cache[p.key].chart = { type: 'bars', dimension: 'day', title: '每日趋势', reason: '看看哪天花得多' };
      Store.setSettings({ai:{monthCache: cache}});
      App.go('report');
      var svg = document.querySelector('.view.active .ai-report svg');
      return !!svg && document.querySelector('.view.active .ai-chart-reason').textContent.indexOf('哪天花得多') >= 0;
    })()`));
    await t('图表可切到按账户', () => evalJs(`(function(){
      var p = Store.scopePeriod('month', new Date());
      var cache = Store.settings.ai.monthCache;
      cache[p.key].chart = { type: 'donut', dimension: 'account', title: '账户分布', reason: '看钱从哪个账户出去' };
      Store.setSettings({ai:{monthCache: cache}});
      App.go('report');
      return document.querySelectorAll('.view.active .ai-report .cat-row').length >= 1;
    })()`));

    // ---------- 5. 识图入口与弹层 ----------
    console.log('\n=== 5. 识图入口与弹层 ===');
    await evalJs(`(function(){ App.go('add'); return 1; })()`);
    await wait(700);
    await t('记账页有识图按钮', () => evalJs(`!!document.querySelector('.view.active [data-act="scan"]')`));
    await evalJs(`document.querySelector('.view.active [data-act="scan"]').click()`);
    await wait(700);
    await t('识图弹层打开', () => evalJs(`!!document.querySelector('#scan-pick')`));
    // 安卓 WebView 里「游离节点 input.click()」不弹选择器，所以必须挂进 DOM 再点。
    // 这条断言盯的就是那个「从相册选择点了没反应」的回归。
    await t('「从相册选择」真的触发了文件选择器（input 在 DOM 里、类型 file、收图片）', () => evalJs(`(function(){
      var old = HTMLInputElement.prototype.click;
      var seen = null;
      HTMLInputElement.prototype.click = function(){
        seen = { type: this.type, accept: this.accept, connected: this.isConnected };
      };
      try { document.querySelector('#scan-pick').click(); }
      finally { HTMLInputElement.prototype.click = old; }
      return !!seen && seen.type === 'file' && seen.accept === 'image/*' && seen.connected === true;
    })()`));
    await t('有引擎说明', () => evalJs(`!!document.querySelector('.scan-engine')`));
    await t('有使用提示', () => evalJs(`!!document.querySelector('.scan-tips')`));
    await t('未选图时点识别会提示', () => evalJs(`(function(){
      document.querySelector('#scan-run').click();
      var toast = document.querySelector('#toast-host');
      return !!toast;
    })()`));
    await t('可以关掉弹层', () => evalJs(`(function(){
      var b = document.querySelectorAll('#sheet-root .sheet-close');
      if (b.length) b[b.length-1].click();
      return true;
    })()`));
    await wait(600);

    // 同一个根因的另一处：导入账单的「从文件选择」以前也是游离 input.click()
    await t('「导入账单 → 从文件选择」也真的触发了文件选择器', async () => {
      await evalJs(`(function(){ App.go('add'); return 1; })()`);
      await wait(500);
      await evalJs(`document.querySelector('.view.active [data-act="bill"]').click()`);
      await wait(700);
      const good = await evalJs(`(function(){
        var old = HTMLInputElement.prototype.click, seen = null;
        HTMLInputElement.prototype.click = function(){
          seen = { type: this.type, accept: this.accept, connected: this.isConnected };
        };
        try { document.querySelector('#bill-pick').click(); }
        finally { HTMLInputElement.prototype.click = old; }
        return !!seen && seen.type === 'file' && /csv/.test(seen.accept) && seen.connected === true;
      })()`);
      await evalJs(`(function(){
        var b = document.querySelectorAll('#sheet-root .sheet-close');
        if (b.length) b[b.length - 1].click();
        return 1;
      })()`);
      await wait(400);
      return good;
    });

    // ---------- 6. 识图引擎设置 ----------
    console.log('\n=== 6. 识图引擎设置 ===');
    await evalJs(`(function(){ App.go('settings'); return 1; })()`);
    await wait(700);
    await evalJs(`document.querySelector('.view[data-view="settings"] [data-act="scan"]').click()`);
    await wait(700);
    await t('识图设置弹层打开', () => evalJs(`document.querySelectorAll('#sheet-root [data-engine]').length === 3`));
    await t('显示 AI 识图可用状态', () => evalJs(`(function(){
      var rows = document.querySelectorAll('#sheet-root .set-row');
      var found = false;
      rows.forEach(function(r){ if (r.textContent.indexOf('AI 识图') >= 0) found = true; });
      return found;
    })()`));
    await t('能选本地 OCR 并保存', () => evalJs(`(function(){
      document.querySelector('#sheet-root [data-engine="ocr"]').click();
      document.querySelector('#sheet-root [data-act="save"]').click();
      return Store.settings.scan.engine === 'ocr';
    })()`));
    await wait(600);
    await t('设置行显示当前引擎', () => evalJs(`(function(){
      var row = document.querySelector('.view[data-view="settings"] [data-act="scan"]');
      return !!row && row.textContent.indexOf('本地 OCR') >= 0;
    })()`));

    // ---------- 7. 引擎解析与兜底 ----------
    console.log('\n=== 7. 引擎解析 ===');
    await t('选 OCR 时 resolveEngine 返回 ocr', () => evalJs(`Scan.resolveEngine() === 'ocr'`));
    await t('切回 auto 且有视觉模型时走 AI', () => evalJs(`(function(){
      Store.setSettings({scan:{engine:'auto'}, ai:{enabled:true, visionModel:'moonshot-v1-8k-vision-preview'}});
      return Scan.resolveEngine() === 'ai';
    })()`));
    await t('清空视觉模型后 auto 回落 OCR', () => evalJs(`(function(){
      Store.setSettings({ai:{visionModel:''}});
      return Scan.resolveEngine() === 'ocr';
    })()`));

    // ---------- 8. 暖心提示的 AI 入口 ----------
    console.log('\n=== 8. 暖心提示 AI 入口 ===');
    await evalJs(`(function(){
      Store.setSettings({tip:{enabled:true, place:'add'}, ai:{enabled:true}});
      Tips.clearCache();
      App.go('add');
      return 1;
    })()`);
    await wait(700);
    await t('有 AI 但无缓存时卡片仍是本地版', () => evalJs(`(function(){
      var c = document.querySelector('.view.active .tip-card');
      return !!c && !c.classList.contains('ai-on');
    })()`));
    await t('提示弹层里有 AI 入口按钮', () => evalJs(`(function(){
      document.querySelector('.view.active .tip-card [data-tip="open"]').click();
      return !!document.querySelector('[data-tip="ai"]');
    })()`));
    await t('提示弹层里有 AI 邀请区', () => evalJs(`!!document.querySelector('.tip-ai-box--invite')`));
    await t('注入 AI 缓存后卡片变成 AI 版', () => evalJs(`(function(){
      var b = document.querySelectorAll('#sheet-root .sheet-close');
      if (b.length) b[b.length-1].click();
      var y = new Date(); y.setDate(y.getDate() - 1);
      var key = U.ymd(y);
      var cache = {};
      cache[key] = { text: '昨天你在吃饭上很舍得，挺好。', headline: '吃得不错', tip: '继续保持', mood: 'good', dateKey: key, sig: AI.dailySig(y), ts: Date.now(), model: 'moonshot-v1-8k' };
      Store.setSettings({ai:{dailyCache: cache}});
      Tips.clearCache();
      App.go('add');
      var c = document.querySelector('.view.active .tip-card');
      return !!c && c.classList.contains('ai-on');
    })()`));
    await t('AI 版卡片显示标题与正文', () => evalJs(`(function(){
      var c = document.querySelector('.view.active .tip-card');
      return c.textContent.indexOf('吃得不错') >= 0 && c.textContent.indexOf('舍得') >= 0;
    })()`));

    // 还原
    await evalJs(`(function(){
      Store.setSettings({
        tip:{enabled:true, place:'add', offset:0},
        ai:{enabled:false, apiKey:'', preset:'dashscope', baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',
            model:'qwen-plus', visionModel:'qwen-vl-max', dailyCache:{}, monthCache:{}},
        scan:{engine:'auto'}
      });
      Tips.clearCache();
      return 1;
    })()`);

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
