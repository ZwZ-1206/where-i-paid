/* 全新浏览器（无任何缓存）验证：新功能是否真的在页面上 */
'use strict';
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9361;
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

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    const v = await fn();
    if (v) { pass++; console.log('  ✅', name); }
    else { fail++; console.log('  ❌', name); }
  } catch (e) { fail++; console.log('  ❌', name, '—', e.message); }
};

(async () => {
  const PROFILE = env.profile('fresh');
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  await sleep(2600);
  let target;
  for (let i = 0; i < 25; i++) {
    try {
      const list = await getJSON('/json/list');
      target = list.find((x) => x.type === 'page' && !/chrome-extension|devtools/.test(x.url));
      if (target) break;
    } catch (e) {}
    await sleep(400);
  }
  if (!target) { console.error('无法连接'); await env.stop(proc); process.exit(1); }

  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const errors = [];
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || ''));
    }
  });

  const ev = async (e) => {
    const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' | ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3200);

  console.log('=== 全新浏览器：新功能是否可见 ===');
  // ---- 全新浏览器：必须是空账本（不塞示例数据）----
  await t('首次打开是空账本：不塞任何示例数据', () => ev(`(function(){
    const S = window.Store, st = S.state;
    return st.tx.length === 0
      && st.goals.length === 0
      && (st.wishlist || []).length === 0
      && (st.repeats || []).length === 0
      && st.accounts.length >= 4
      && !(st.settings && st.settings.seeded);
  })()`));

  await t('空账本时明细页是空态引导，不是报错', async () => {
    await ev(`App.go('detail')`);
    await new Promise((r) => setTimeout(r, 700));
    return ev(`(function(){
      const e = document.querySelector('.view[data-view="detail"] .empty');
      return !!e && /记一笔|还没有记账/.test(e.textContent);
    })()`);
  });

  await t('空账本时总结页也给空态，不崩', async () => {
    await ev(`App.go('report')`);
    await new Promise((r) => setTimeout(r, 800));
    return ev(`!!document.querySelector('.view[data-view="report"]') && document.body.textContent.length > 50`);
  });

  await t('回到记账页（键盘默认收起）', async () => {
    await ev(`App.go('add')`);
    await new Promise((r) => setTimeout(r, 700));
    return ev(`!!document.querySelector('.view[data-view="add"] .input-dock.is-closed')`);
  });
  await t('页面无 JS 异常', () => errors.length === 0 || (console.log('    err:', errors[0]), false));
  await t('AI 模块已加载', () => ev(`typeof window.AI === 'object' && window.AI !== null`));
  await t('OCR 模块已加载', () => ev(`typeof window.OCR === 'object'`));
  await t('Scan 模块已加载', () => ev(`typeof window.Scan === 'object'`));
  await t('Tips 有 AI 桥接', () => ev(`typeof window.Tips.aiGenerate === 'function'`));
  await t('AI.PRESETS 有 7 家', () => ev(`window.AI.PRESETS.length === 7`));
  await t('文案库每组 >= 5 句', () => ev(`Object.keys(window.Tips.COPY).every(k => window.Tips.COPY[k].lines.length >= 5)`));
  await t('记账页有识图气泡', () => ev(`!!document.querySelector('.view[data-view="add"] .scan-bubble[data-act="scan"]')`));
  await t('识图气泡文案是「识图导入」', () => ev(`(function(){
    var b = document.querySelector('.view[data-view="add"] .scan-bubble[data-act="scan"]');
    return !!b && b.textContent.indexOf('识图导入') >= 0;
  })()`));
  await t('识图气泡带相机图标', () => ev(`(function(){
    var b = document.querySelector('.view[data-view="add"] .scan-bubble .scan-bubble-ic');
    return !!b && !!b.querySelector('svg');
  })()`));
  await t('识图气泡没盖住收入按钮（两者不重叠）', () => ev(`(function(){
    var s = document.querySelector('.view[data-view="add"] .type-switch button[data-type="income"]');
    var b = document.querySelector('.view[data-view="add"] .scan-bubble[data-act="scan"]');
    if (!s || !b) return false;
    var a = s.getBoundingClientRect(), c = b.getBoundingClientRect();
    // 矩形不相交：要么水平分离，要么垂直分离
    var hGap = a.right <= c.left + 1 || c.right <= a.left + 1;
    var vGap = a.bottom <= c.top + 1 || c.bottom <= a.top + 1;
    return hGap || vGap;
  })()`));
  await t('识图气泡不溢出屏幕', () => ev(`(function(){
    var b = document.querySelector('.view[data-view="add"] .scan-bubble[data-act="scan"]');
    if (!b) return false;
    var r = b.getBoundingClientRect();
    return r.right <= window.innerWidth + 1 && r.left >= -1 && r.height >= 30;
  })()`));
  await t('收入模式下气泡变绿', async () => {
    await ev(`(function(){ var b=document.querySelector('.view[data-view="add"] .type-switch button[data-type="income"]'); if(b) b.click(); return 1; })()`);
    await sleep(350);
    return ev(`!!document.querySelector('.view[data-view="add"] .scan-bubble--in')`);
  });
  await ev(`(function(){ var b=document.querySelector('.view[data-view="add"] .type-switch button[data-type="expense"]'); if(b) b.click(); return 1; })()`);
  await sleep(350);
  await t('设置页有 AI 入口', async () => {
    await ev(`App.go('settings')`);
    await sleep(600);
    return ev(`!!document.querySelector('.view[data-view="settings"] [data-act="ai"]')`);
  });
  await t('设置页有识图设置入口', () => ev(`!!document.querySelector('.view[data-view="settings"] [data-act="scan"]')`));
  await t('AI 配置弹层能打开', async () => {
    await ev(`ViewSettings.openAiSheet()`);
    await sleep(500);
    return ev(`document.querySelectorAll('#sheet-root [data-preset]').length >= 6`);
  });
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); })()`);
  await sleep(400);
  await t('识图弹层能打开', async () => {
    await ev(`Scan.open()`);
    await sleep(500);
    return ev(`!!document.querySelector('#sheet-root #scan-pick')`);
  });
  await t('识图弹层有支出/收入切换', () => ev(`document.querySelectorAll('#sheet-root [data-prefer]').length === 2`));
  await t('识图弹层标题是「识图导入」', () => ev(`(function(){
    var t = document.querySelector('#sheet-root .sheet-title, #sheet-root .sheet-head');
    return !!t && t.textContent.indexOf('识图导入') >= 0;
  })()`));
  await t('切到收入后提示文案跟着变', async () => {
    await ev(`(function(){ var b=document.querySelector('#sheet-root [data-prefer="income"]'); if(b) b.click(); return 1; })()`);
    await sleep(350);
    return ev(`(function(){
      var h = document.querySelector('#sheet-root .scan-kind-hint');
      var d = document.querySelector('#sheet-root .scan-drop-title');
      return !!h && h.textContent.indexOf('收入') >= 0 && !!d && d.textContent.indexOf('收入') >= 0;
    })()`);
  });
  await t('收入模式下弹层用绿色强调', () => ev(`(function(){
    var b = document.querySelector('#sheet-root [data-prefer="income"]');
    return !!b && b.classList.contains('on');
  })()`));
  await t('识别结果可逐笔改类型', async () => {
    await ev(`(function(){
      var b = document.querySelectorAll('#sheet-root .sheet-close');
      if (b.length) b[b.length-1].click();
      return 1;
    })()`);
    await sleep(400);
    await ev(`(function(){
      Scan.open({
        preferType: 'income',
        result: { platform:'alipay', engine:'ai', warning:'', entries:[
          { type:'expense', amount: 500000, catId:'other_out', sub:'', merchant:'某公司', note:'工资', ts: Date.now(), confidence: 0.9, engine:'ai' }
        ] }
      });
      return 1;
    })()`);
    await sleep(600);
    return ev(`(function(){
      var s = document.querySelector('#sheet-root .scan-sel[data-sel="type"]');
      if (!s) return false;
      var amt = document.querySelector('#sheet-root .scan-item-amt');
      return s.value === 'income' && !!amt && amt.classList.contains('in');
    })()`);
  });
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); })()`);
  await sleep(400);

  // ---------- 账单 CSV 导入 ----------
  await t('Bills 模块已加载', () => ev(`typeof window.Bills === 'object'`));
  await t('记账页有「导入账单」气泡', () => ev(`(function(){
    var b = document.querySelector('.view[data-view="add"] .scan-bubble--bill');
    return !!b && b.textContent.indexOf('导入账单') >= 0;
  })()`));
  await t('账单弹层能打开（空态）', async () => {
    await ev(`Bills.open()`);
    await sleep(500);
    return ev(`!!document.querySelector('#sheet-root #bill-pick')`);
  });
  await t('空态有导出账单指南', () => ev(`(function(){
    var t = document.querySelector('#sheet-root .scan-tips');
    return !!t && t.textContent.indexOf('微信') >= 0 && t.textContent.indexOf('支付宝') >= 0;
  })()`));
  await t('解析微信账单后展示统计与列表', async () => {
    const csv = [
      '微信支付账单明细',
      '微信昵称：[张三]',
      '----------------------微信支付账单明细列表--------------------',
      '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
      '2026-02-03 12:31:05,商户消费,沙县小吃,拌面,支出,¥18.00,零钱,支付成功,10001,M001,',
      '2026-02-04 08:12:00,商户消费,滴滴出行,快车,支出,¥25.80,零钱,支付成功,10002,M002,',
      '2026-02-05 10:00:00,转账,李四,转账,收入,¥200.00,零钱,已收钱,10003,M003,还款',
      '2026-02-07 09:00:00,零钱提现,工商银行,提现,/,¥500.00,零钱,提现已到账,10005,M005,',
    ].join('\n');
    await ev(`(function(){
      var b = document.querySelectorAll('#sheet-root .sheet-close');
      if (b.length) b[b.length-1].click();
      return 1;
    })()`);
    await sleep(400);
    await ev(`Bills.open()`);
    await sleep(400);
    await ev(`(function(){
      var r = window.Bills.parseText(${JSON.stringify(csv)});
      var seen = Store.srcKeys();
      window.Bills.open({ parsed: r, fileName: '微信支付账单.csv', dupCount: 0,
        include: r.entries.map(function(e){ return !seen.has(e.srcKey); }) });
      return 1;
    })()`);
    await sleep(600);
    return ev(`(function(){
      var rows = document.querySelectorAll('#sheet-root .bill-row');
      var stats = document.querySelectorAll('#sheet-root .bill-stat');
      return rows.length === 3 && stats.length === 3;
    })()`);
  });
  await t('提现「/」被跳过不显示', () => ev(`(function(){
    var names = Array.prototype.map.call(document.querySelectorAll('#sheet-root .bill-name'), function(n){ return n.textContent; });
    return names.join(',').indexOf('工商银行') < 0;
  })()`));
  await t('列表区分支出与收入颜色', () => ev(`(function(){
    var inAmt = document.querySelectorAll('#sheet-root .bill-amt.in');
    var outAmt = document.querySelectorAll('#sheet-root .bill-amt:not(.in)');
    return inAmt.length === 1 && outAmt.length === 2;
  })()`));
  await t('每行可改分类', () => ev(`document.querySelectorAll('#sheet-root .bill-sel[data-cat]').length === 3`));
  await t('自动分类命中餐饮与交通', () => ev(`(function(){
    var sels = document.querySelectorAll('#sheet-root .bill-sel[data-cat]');
    var vals = Array.prototype.map.call(sels, function(s){ return s.value; });
    return vals.indexOf('food') >= 0 && vals.indexOf('transport') >= 0;
  })()`));
  await t('取消勾选后统计与按钮跟着变', async () => {
    const before = await ev(`document.querySelector('#sheet-root #bill-save').textContent.trim()`);
    await ev(`(function(){ var c=document.querySelector('#sheet-root .bill-check'); if(c) c.click(); return 1; })()`);
    await sleep(400);
    const after = await ev(`document.querySelector('#sheet-root #bill-save').textContent.trim()`);
    const offCount = await ev(`document.querySelectorAll('#sheet-root .bill-row.off').length`);
    return before !== after && offCount === 1;
  });
  await t('点「导入」真的写进账本', async () => {
    const before = await ev(`Store.state.tx.length`);
    await ev(`(function(){ var b=document.querySelector('#sheet-root #bill-save'); if(b) b.click(); return 1; })()`);
    await sleep(900);
    const after = await ev(`Store.state.tx.length`);
    return after === before + 2;   // 3 笔里取消了 1 笔
  });
  await t('导入后跳到明细页', () => ev(`document.querySelector('.view.active').getAttribute('data-view') === 'detail'`));
  await t('导入后自动定位到账单所在月份', async () => {
    const r = await ev(`(function(){
      var p = Store.shiftPeriod(Store.currentPeriod(), ViewDetail.state.offset);
      return { key: p.key, label: document.querySelector('.view.active .period-title, .view.active .pd-title') ?
        document.querySelector('.view.active .period-title, .view.active .pd-title').textContent.trim() : '' };
    })()`);
    console.log('    period:', JSON.stringify(r));
    return /2026/.test(String(r.key)) && String(r.key).indexOf('02') >= 0;
  });
  await t('重复导入同一文件会被自动取消勾选', async () => {
    // 上一轮导入时取消了第 1 笔（沙县小吃），所以再次解析同一份账单：
    // 滴滴出行 + 李四 应判为重复（2 笔），沙县小吃 仍可导入（1 笔）
    const csv = [
      '微信支付账单明细',
      '微信昵称：[张三]',
      '----------------------微信支付账单明细列表--------------------',
      '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
      '2026-02-03 12:31:05,商户消费,沙县小吃,拌面,支出,¥18.00,零钱,支付成功,10001,M001,',
      '2026-02-04 08:12:00,商户消费,滴滴出行,快车,支出,¥25.80,零钱,支付成功,10002,M002,',
      '2026-02-05 10:00:00,转账,李四,转账,收入,¥200.00,零钱,已收钱,10003,M003,还款',
      '2026-02-07 09:00:00,零钱提现,工商银行,提现,/,¥500.00,零钱,提现已到账,10005,M005,',
    ].join('\n');
    await ev(`(function(){
      var b = document.querySelectorAll('#sheet-root .sheet-close');
      if (b.length) b[b.length-1].click();
      return 1;
    })()`);
    await sleep(400);
    await ev(`(function(){
      var r = window.Bills.parseText(${JSON.stringify(csv)});
      var seen = Store.srcKeys();
      var inc = r.entries.map(function(e){ return !seen.has(e.srcKey); });
      window.Bills.open({ parsed: r, fileName: '微信支付账单.csv',
        dupCount: inc.filter(function(x){ return !x; }).length, include: inc });
      return 1;
    })()`);
    await sleep(600);
    return ev(`(function(){
      var dup = document.querySelector('#sheet-root .bill-dup');
      var off = document.querySelectorAll('#sheet-root .bill-row.off').length;
      return !!dup && dup.textContent.indexOf('2') >= 0 && off === 2;
    })()`);
  });
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); })()`);
  await sleep(400);

  // ---------- 总结页：年 / 月 / 日 三选项卡 ----------
  await ev(`App.go('report')`);
  await sleep(500);
  await t('总结页有日/月/年三个选项卡', () => ev(`(function(){
    var tabs = document.querySelectorAll('.view[data-view="report"] .seg-tab');
    var txt = Array.prototype.map.call(tabs, function(x){ return x.textContent.trim(); }).join('|');
    return tabs.length === 3 && txt.indexOf('日') >= 0 && txt.indexOf('月') >= 0 && txt.indexOf('年') >= 0;
  })()`));
  await t('默认是「月」选项卡', () => ev(`(function(){
    var on = document.querySelector('.view[data-view="report"] .seg-tab.on');
    return !!on && on.dataset.scope === 'month';
  })()`));
  await t('切到「日」后 hero 显示某一天', async () => {
    await ev(`(function(){
      var b = document.querySelector('.view[data-view="report"] .seg-tab[data-scope="day"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(450);
    return ev(`(function(){
      var on = document.querySelector('.view[data-view="report"] .seg-tab.on');
      var lab = document.querySelector('.view[data-view="report"] .period-label span');
      var sub = document.querySelector('.view[data-view="report"] .rh-label');
      return !!on && on.dataset.scope === 'day' && !!lab && /\\d+年\\d+月\\d+日/.test(lab.textContent)
        && !!sub && sub.textContent.indexOf('当日') >= 0;
    })()`);
  });
  await t('切到「年」后 hero 显示某一年', async () => {
    await ev(`(function(){
      var b = document.querySelector('.view[data-view="report"] .seg-tab[data-scope="year"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(450);
    return ev(`(function(){
      var on = document.querySelector('.view[data-view="report"] .seg-tab.on');
      var lab = document.querySelector('.view[data-view="report"] .period-label span');
      var sub = document.querySelector('.view[data-view="report"] .rh-label');
      return !!on && on.dataset.scope === 'year' && !!lab && /^\\d{4}年$/.test(lab.textContent.trim())
        && !!sub && sub.textContent.indexOf('本年') >= 0;
    })()`);
  });
  await t('日选项卡有「对比」入口', () => ev(`(function(){
    var bar = document.querySelector('.view[data-view="report"] .cmp-bar');
    return !!bar && bar.textContent.indexOf('对比') >= 0;
  })()`));
  await t('点对比条能打开选择弹层（含快捷项）', async () => {
    await ev(`(function(){
      var b = document.querySelector('.view[data-view="report"] .cmp-bar');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(500);
    return ev(`(function(){
      var sheet = document.querySelector('#sheet-root .sheet');
      if (!sheet) return false;
      var chips = sheet.querySelectorAll('[data-ts]');
      return chips.length >= 2 && sheet.textContent.indexOf('对比') >= 0;
    })()`);
  });
  await t('选一个快捷对比后对比条文案更新', async () => {
    await ev(`(function(){
      var chip = document.querySelector('#sheet-root [data-ts]');
      if (chip) chip.click();
      return 1;
    })()`);
    await sleep(600);
    return ev(`(function(){
      var bar = document.querySelector('.view[data-view="report"] .cmp-bar');
      return !!bar && !!bar.querySelector('b');
    })()`);
  });
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); })()`);
  await sleep(400);
  await ev(`(function(){ if (window.ViewReport) ViewReport.setScope('month'); return 1; })()`);
  await sleep(400);

  // ---------- 记账页：账本条 + 导入账单气泡 ----------
  await ev(`App.go('add')`);
  await sleep(500);
  await t('记账页有账本切换条', () => ev(`!!document.querySelector('.view[data-view="add"] .book-pill[data-act="book"]')`));
  await t('记账页有「新建账本」入口', () => ev(`!!document.querySelector('.view[data-view="add"] .book-pill[data-act="book-add"]')`));
  await t('记账页「导入账单」在「识图导入」旁边', () => ev(`(function(){
    var row = document.querySelector('.view[data-view="add"] .import-row');
    if (!row) return false;
    var scan = row.querySelector('[data-act="scan"]');
    var bill = row.querySelector('[data-act="bill"]');
    return !!scan && !!bill && scan.textContent.indexOf('识图导入') >= 0 && bill.textContent.indexOf('导入账单') >= 0;
  })()`));
  await t('点账本条能打开账本选择器', async () => {
    await ev(`(function(){
      var b = document.querySelector('.view[data-view="add"] .book-pill[data-act="book"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(500);
    return ev(`!!document.querySelector('#sheet-root .bk-item')`);
  });
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); })()`);
  await sleep(400);

  // ---------- 设置页：账本与自动化三入口 ----------
  await ev(`App.go('settings')`);
  await sleep(500);
  await t('设置页有「多账本」入口', () => ev(`!!document.querySelector('.view[data-view="settings"] [data-act="books"]')`));
  // 「周期性自动记账」已整体删除（与固定月支出重复），这里改为断言它不再出现
  await t('设置页已无「周期性自动记账」入口', () => ev(`!document.querySelector('.view[data-view="settings"] [data-act="repeats"]')`));
  await t('设置页有「分类管理」入口', () => ev(`!!document.querySelector('.view[data-view="settings"] [data-act="cats"]')`));
  await t('设置页不再有旧的「导入账单」入口', () => ev(`!document.querySelector('.view[data-view="settings"] [data-act="bill"]')`));
  await t('点「分类管理」能打开且列出分类', async () => {
    await ev(`(function(){
      var b = document.querySelector('.view[data-view="settings"] [data-act="cats"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(550);
    return ev(`(function(){
      var items = document.querySelectorAll('#sheet-root .catm-item');
      return items.length >= 10 && !!document.querySelector('#sheet-root .catm-tools');
    })()`);
  });
  await t('分类弹层能切到收入分类', async () => {
    await ev(`(function(){
      var b = document.querySelector('#sheet-root [data-ckind="income"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(450);
    return ev(`(function(){
      var on = document.querySelector('#sheet-root .catm-head .on');
      var items = document.querySelectorAll('#sheet-root .catm-item');
      return !!on && on.dataset.ckind === 'income' && items.length >= 5 && items.length <= 12;
    })()`);
  });
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); })()`);
  await sleep(400);

  await t('点「多账本」能打开且列出当前账本', async () => {
    await ev(`(function(){
      var b = document.querySelector('.view[data-view="settings"] [data-act="books"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(550);
    return ev(`(function(){
      var rows = document.querySelectorAll('#sheet-root .bk-row');
      return rows.length >= 1 && !!document.querySelector('#sheet-root [data-bkact="add"]');
    })()`);
  });
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); })()`);
  await sleep(400);

  await t('点「固定月支出」能打开，且有名称/金额/日期三个输入框', async () => {
    await ev(`(function(){
      var b = document.querySelector('.view[data-view="settings"] [data-act="fixed"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(550);
    return ev(`(function(){
      return !!document.querySelector('#sheet-root #fx-name')
        && !!document.querySelector('#sheet-root #fx-amount')
        && !!document.querySelector('#sheet-root #fx-day');
    })()`);
  });
  await t('固定月支出弹层有常用模板可以直接点', async () => {
    return ev(`document.querySelectorAll('#sheet-root [data-fixed-preset]').length >= 3`);
  });
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); })()`);
  await sleep(300);
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); })()`);
  await sleep(400);

  // ---------- 账单跨月识别 ----------
  await t('跨月账单会按月分组并提示', async () => {
    const csv = [
      '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
      '2026-01-15 12:00:00,商户消费,沙县小吃,拌面,支出,¥18.00,零钱,支付成功,90001,M9001,',
      '2026-02-20 12:00:00,商户消费,滴滴出行,快车,支出,¥25.80,零钱,支付成功,90002,M9002,',
      '2026-03-08 12:00:00,商户消费,永辉超市,蔬菜,支出,¥66.00,零钱,支付成功,90003,M9003,',
    ].join('\n');
    await ev(`(function(){
      var r = window.Bills.parseText(${JSON.stringify(csv)});
      window.Bills.open({ parsed: r, fileName: '跨月.csv', include: r.entries.map(function(){ return true; }), dupCount: 0 });
      return 1;
    })()`);
    await sleep(600);
    return ev(`(function(){
      var chips = document.querySelectorAll('#sheet-root .bill-month');
      var warn = document.querySelector('#sheet-root .bill-month-warn');
      return chips.length === 3 && !!warn && warn.textContent.indexOf('跨了 3 个月') >= 0;
    })()`);
  });
  await ev(`(function(){ var b=document.querySelectorAll('#sheet-root .sheet-close'); if(b.length) b[b.length-1].click(); })()`);
  await sleep(400);

  // 版本号会随每次发版变化，所以不写死：直接读 sw.js 里的 CACHE 再和浏览器实际缓存比对
  await t('Service Worker 缓存版本与 sw.js 一致', async () => {
    const want = await ev(`(async function(){
      const r = await fetch('/sw.js', { cache: 'no-store' });
      const txt = await r.text();
      const m = /CACHE\\s*=\\s*'([^']+)'/.exec(txt);
      return m ? m[1] : 'none';
    })()`);
    const v = await ev(`(async function(){
      const regs = await navigator.serviceWorker.getRegistrations();
      if (!regs.length) return 'none';
      const keys = await caches.keys();
      return keys.join(',');
    })()`);
    console.log('    期望:', want, '实际:', v);
    return want !== 'none' && String(v).indexOf(want) >= 0;
  });

  console.log(`\n通过 ${pass} / ${pass + fail}`);
  cdp.ws.close(); await env.stop(proc);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
