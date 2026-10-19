/* 验收：银行流水表头兼容
 *
 * 背景：以前只按微信 / 支付宝的列名设计，遇到银行导出的流水就「认不出表头」。
 * 这里用各家真实导出格式的列名做样本（比接口更稳，解析是纯函数）。
 *
 * 覆盖 7 种形态：
 *   农行  日期 / 时间分两列 + 交易金额 + 对方姓名
 *   工行  借方金额 / 贷方金额 两列
 *   建行新 借方(支取) / 贷方(收入)
 *   建行旧 存入 / 支出
 *   招行  支出 / 收入 两列（无方向列）
 *   中行  交易金额 + 借贷标志
 *   邮储  日期时间分列 + 摘要 + 交易金额（正数，靠摘要判收支）
 * 外加：真正认不出时的报错要带上看到的列名
 */
'use strict';
const fs = require('fs');
const env = require('./_env');
const { spawn } = require('child_process');

const PORT = 9452;
const PROFILE = env.profile('bank-csv');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    const ok = await fn();
    if (ok) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name); }
  } catch (e) {
    fail++;
    console.log('  ❌ ' + name + ' — ' + (e && e.message));
  }
};

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--window-size=390,844', URL,
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) { ver = await r.json(); break; } } catch (e) { /* 等 */ }
    await sleep(250);
  }
  if (!ver) throw new Error('CDP 未就绪');

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const jsErrors = [];
  ws.addEventListener('message', (evt) => {
    const m = JSON.parse(evt.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      jsErrors.push((d.exception && d.exception.description) || d.text);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params: params || {}, sessionId }));
  });

  const targets = await send('Target.getTargets');
  const page = targets.targetInfos.find((x) => x.type === 'page' && !/devtools|extension/.test(x.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable');
  await S('Runtime.enable');
  await S('Page.navigate', { url: URL });
  await sleep(2400);

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  for (let i = 0; i < 30; i++) {
    if (await ev('!!(window.Bills && window.U)')) break;
    await sleep(200);
  }

  /** 把 CSV 文本丢给 parseText，返回 {n, types, amounts, merchants, tsList, error} */
  const parse = (csv) => ev(`(function(){
    try {
      var r = window.Bills.parseText(${JSON.stringify(csv)});
      return {
        n: r.entries.length,
        types: r.entries.map(function(e){ return e.type; }),
        amounts: r.entries.map(function(e){ return e.amount; }),
        merchants: r.entries.map(function(e){ return e.merchant; }),
        months: r.entries.map(function(e){ return new Date(e.ts).getMonth() + 1; }),
        days: r.entries.map(function(e){ return new Date(e.ts).getDate(); }),
        hours: r.entries.map(function(e){ return new Date(e.ts).getHours(); }),
        platform: r.platform,
        error: ''
      };
    } catch (e) { return { error: e.message }; }
  })()`);

  console.log('\n=== 1. 农行：日期/时间分两列 + 交易金额 ===');
  const abc = await parse([
    '中国农业银行 交易明细',
    '账号,6228********1234',
    '交易日期,交易时间,摘要,交易金额,账户余额,对方账户,对方姓名,交易渠道',
    '20261001,09:12:33,消费,-35.50,1234.56,6222***,美团外卖,掌上银行',
    '20261002,10:00:00,工资,8000.00,9234.56,,某某科技,网上银行',
  ].join('\n'));
  await t('农行能认出来（2 笔）', () => abc.n === 2);
  await t('农行：日期列 + 时间列拼成了完整时间（10 月 1 日 9 点）',
    () => abc.days && abc.days[0] === 1 && abc.hours[0] === 9 && abc.months[0] === 10);
  await t('农行：负数金额记为支出 35.50', () => abc.types[0] === 'expense' && abc.amounts[0] === 3550);
  await t('农行：工资记为收入 8000', () => abc.types[1] === 'income' && abc.amounts[1] === 800000);
  await t('农行：对方姓名当商户名', () => abc.merchants[0] === '美团外卖');

  console.log('\n=== 2. 工行：借方金额 / 贷方金额 ===');
  const icbc = await parse([
    '交易日期,摘要,币种,借方金额,贷方金额,余额,对方户名,对方账号,对方开户行',
    '2026-10-03,转支,人民币,120.00,,5000.00,张三,6222,工行',
    '2026-10-04,工资,人民币,,8000.00,13000.00,某某公司,6222,工行',
  ].join('\n'));
  await t('工行能认出来（2 笔）', () => icbc.n === 2);
  await t('工行：借方=支出、贷方=收入', () => icbc.types[0] === 'expense' && icbc.types[1] === 'income');
  await t('工行：金额对（120 / 8000）', () => icbc.amounts[0] === 12000 && icbc.amounts[1] === 800000);

  console.log('\n=== 3. 建行：借方(支取) / 贷方(收入) ===');
  const ccbNew = await parse([
    '交易时间,借方(支取),贷方(收入),余额,对方户名,对方账号,对方开户机构,记账日期,摘要,备注',
    '2026-10-05 12:00:00,88.00,,1000.00,超市,6227,建行,20261005,消费,',
    '2026-10-06 08:30:00,,500.00,1500.00,李四,6227,建行,20261006,转入,',
  ].join('\n'));
  await t('建行（新格式）能认出来（2 笔）', () => ccbNew.n === 2);
  await t('建行：支取=支出、收入=进账', () => ccbNew.types[0] === 'expense' && ccbNew.types[1] === 'income');

  console.log('\n=== 4. 建行旧格式：存入 / 支出 ===');
  const ccbOld = await parse([
    '交易日期,交易时间,摘要,存入,支出,余额,对方账号,对方户名,交易机构',
    '20261007,11:20:00,消费,,66.00,900.00,6227,便利店,建行某支行',
    '20261008,09:00:00,工资,3000.00,,3900.00,6227,公司,建行某支行',
  ].join('\n'));
  await t('建行（旧格式）能认出来（2 笔）', () => ccbOld.n === 2);
  await t('建行旧：支出=支出、存入=收入', () => ccbOld.types[0] === 'expense' && ccbOld.types[1] === 'income');

  console.log('\n=== 5. 招行：支出 / 收入两列 ===');
  const cmb = await parse([
    '交易日期,交易时间,支出,收入,余额,交易类型,交易备注',
    '2026-10-09,12:01:00,23.50,,100.00,消费,午餐',
    '2026-10-10,18:00:00,,1000.00,1100.00,转账,收到转账',
  ].join('\n'));
  await t('招行能认出来（2 笔）', () => cmb.n === 2);
  await t('招行：支出列 / 收入列各自正确', () => cmb.types[0] === 'expense' && cmb.types[1] === 'income');

  console.log('\n=== 6. 中行 / 交行：交易金额 + 借贷标志 ===');
  const boc = await parse([
    '交易日期,借贷标志,交易金额,余额,对方户名,附言',
    '2026-10-11,借,45.00,955.00,餐厅,午餐',
    '2026-10-12,贷,2000.00,2955.00,公司,报销',
  ].join('\n'));
  await t('中行能认出来（2 笔）', () => boc.n === 2);
  await t('中行：借=支出、贷=收入', () => boc.types[0] === 'expense' && boc.types[1] === 'income');

  console.log('\n=== 7. 邮储：全是正数，靠摘要判收支 ===');
  const psbc = await parse([
    '交易日期,交易时间,摘要,交易金额,账户余额,对方户名',
    '20261013,10:00:00,消费,29.90,970.10,咖啡店',
    '20261014,10:00:00,利息,1.20,971.30,',
  ].join('\n'));
  await t('邮储能认出来（2 笔）', () => psbc.n === 2);
  await t('邮储：摘要「消费」判支出、「利息」判收入', () => psbc.types[0] === 'expense' && psbc.types[1] === 'income');

  console.log('\n=== 8. 认不出时要说清看到了什么 ===');
  const bad = await parse(['序号,状态,备注', '1,成功,这是一行说明']);
  await t('认不出表头会报错', () => !!bad.error && bad.error.indexOf('认不出表头') >= 0);
  await t('报错里带上了实际列名（方便反馈）',
    () => !!bad.error && bad.error.indexOf('序号') >= 0 && bad.error.indexOf('状态') >= 0);

  console.log('\n=== 9. 原有格式没被改坏 ===');
  const wechat = await parse([
    '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号',
    '2026-10-15 12:00:00,商户消费,瑞幸咖啡,拿铁,支出,¥19.90,零钱,支付成功,12345',
    '2026-10-16 09:00:00,转账,张三,转账,收入,¥100.00,零钱,已存入,12346',
  ].join('\n'));
  await t('微信账单仍然 2 笔、收支正确',
    () => wechat.n === 2 && wechat.types[0] === 'expense' && wechat.types[1] === 'income');

  console.log('\n=== 10. 无 JS 异常 ===');
  await t('整个过程没有未捕获异常', () => jsErrors.length === 0);
  if (jsErrors.length) console.log('    ' + jsErrors.slice(0, 2).join('\n    '));

  console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  env.stop(proc);
  await sleep(300);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  console.log('通过 ' + pass + ' / ' + (pass + fail + 1));
  process.exit(1);
});
