/* 官网截图 T-02 —— 一次产出 site/assets/shots/ 下的 6 张图
 *
 * 与 _test/shoot*.js 同一套基建：无头 Edge + CDP（Node 22 自带 WebSocket），
 * 不引 Playwright。视口 390×844 @2x，直接让浏览器出 webp（省掉 sharp）。
 *
 * 用法：node _test/shoot-site.js
 *       node _test/shoot-site.js --keep    保留临时 profile，方便排查
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const env = require('./_env');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9421;
const APP_PORT = Number(process.env.PORT) || 4173;
const BASE = `http://127.0.0.1:${APP_PORT}/index.html`;
const OUT = path.join(__dirname, '..', 'site', 'assets', 'shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 造数据
// 规则（§8.1）：金额带零头、备注写具体的店、跨两个月、含一笔退款。
// 日期一律相对"今天"生成，脚本明年跑也不会出现"上个月的账"。
const DAY = 86400000;
const now = Date.now();
const at = (daysAgo, hh, mm) => {
  const d = new Date(now - daysAgo * DAY);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
};

const tx = (id, daysAgo, hh, mm, amount, catId, sub, accountId, note, extra) => ({
  id, type: 'expense', amount, catId, sub, accountId, note,
  ts: at(daysAgo, hh, mm), bookId: 'default', srcKey: '',
  amountFx: 0, fxRate: 0, fxCode: '', createdAt: now,
  ...(extra || {}),
});

const income = (id, daysAgo, hh, mm, amount, catId, sub, accountId, note) => ({
  id, type: 'income', amount, catId, sub, accountId, note,
  ts: at(daysAgo, hh, mm), bookId: 'default', srcKey: '',
  amountFx: 0, fxRate: 0, fxCode: '', createdAt: now,
});

const TX = [
  tx('d01', 0, 7, 42, 850, 'food', '早餐', 'alipay', '楼下便利店'),
  tx('d02', 0, 12, 15, 2340, 'food', '午餐', 'wechat', '公司楼下麻辣烫'),
  tx('d03', 1, 19, 30, 4860, 'market', '生鲜', 'bank', '盒马'),
  tx('d04', 1, 21, 5, 9800, 'fun', '电影', 'wechat', '和 TA 看的第二场'),
  tx('d05', 2, 9, 12, 600, 'transport', '地铁', 'alipay', ''),
  tx('d07', 4, 20, 11, 3270, 'food', '外卖', 'wechat', '加班点的'),
  tx('d08', 5, 8, 55, 2280, 'food', '饮料', 'alipay', '瑞幸'),
  tx('d09', 6, 15, 40, 15600, 'health', '药品', 'wechat', '给妈妈买的'),
  tx('d10', 7, 13, 20, 320000, 'housing', '房租', 'bank', '10 月的'),
  tx('d11', 8, 22, 10, 2500, 'fun', '会员', 'wechat', '自动续费'),
  tx('d12', 9, 18, 0, 60000, 'social', '礼金', 'alipay', '同事婚礼'),
  tx('d13', 12, 11, 20, 20000, 'advance', '代付', 'wechat', '帮同事垫的团建费'),
  tx('d14', 16, 10, 5, 6800, 'shopping', '日用', 'alipay', '洗衣液和纸巾'),
  tx('d15', 22, 19, 0, 7320, 'market', '生鲜', 'alipay', '菜市场'),
  tx('d16', 25, 12, 30, 1980, 'food', '午餐', 'wechat', ''),
  tx('d17', 26, 21, 0, 12800, 'housing', '水电', 'bank', ''),
  tx('d18', 31, 20, 30, 24600, 'food', '聚餐', 'wechat', '朋友聚'),
  tx('d19', 34, 9, 0, 10000, 'transport', '交通卡', 'alipay', '充了 100'),
  tx('d20', 38, 14, 0, 5600, 'study', '书', 'alipay', ''),
  tx('d21', 41, 23, 0, 4600, 'food', '夜宵', 'wechat', ''),
  income('d06', 4, 10, 30, 1280000, 'salary', '', 'bank', ''),
  income('d23', 29, 10, 0, 150000, 'parttime', '外快', 'bank', '帮朋友做的页面'),
  tx('d24', 27, 19, 10, 16800, 'shopping', '衣服', 'alipay', '换季'),
  tx('d27', 30, 15, 0, 268000, 'shopping', '家电', 'bank', '换个洗衣机'),
  tx('d25', 33, 12, 0, 4200, 'food', '午餐', 'wechat', ''),
  tx('d26', 36, 20, 40, 8800, 'fun', '演出', 'wechat', 'livehouse'),
];

const CP_TX = [
  { id: 'c01', type: 'expense', amount: 12800, catId: 'food', sub: '晚餐', accountId: 'wechat', note: '那家小馆', ts: at(0, 18, 40), attrib: 'me' },
  { id: 'c02', type: 'expense', amount: 4600, catId: 'food', sub: '饮料', accountId: 'alipay', note: '两杯', ts: at(1, 15, 10), attrib: 'peer' },
  { id: 'c03', type: 'expense', amount: 32000, catId: 'market', sub: '生鲜', accountId: 'wechat', note: '周末做饭', ts: at(2, 10, 20), attrib: 'mutual' },
  { id: 'c04', type: 'expense', amount: 8800, catId: 'fun', sub: '展览', accountId: 'alipay', note: '', ts: at(3, 14, 0), attrib: 'mutual' },
  { id: 'c05', type: 'expense', amount: 5200, catId: 'redpacket', sub: '', accountId: 'wechat', note: '', ts: at(5, 21, 0), attrib: 'peer' },
  { id: 'c06', type: 'expense', amount: 15600, catId: 'food', sub: '聚餐', accountId: 'wechat', note: '见了老同学', ts: at(6, 19, 30), attrib: 'me' },
  { id: 'c07', type: 'expense', amount: 6600, catId: 'redpacket', sub: '', accountId: 'wechat', note: '', ts: at(3, 20, 0), attrib: 'redpacket', rpFrom: 'me' },
].map((t) => ({ ...t, cpBookId: 'cp1', amountFx: 0, fxRate: 0, fxCode: '', createdAt: now }));

const STATE = {
  version: 1,
  tx: TX,
  goals: [
    { id: 'g1', name: '换个新手机', icon: '📱', target: 600000, saved: 218000, deadline: null,
      color: '#4F7CFF', note: '', kind: 'normal', slot: '', cpBookId: '', createdAt: now, archived: false, logs: [] },
    { id: 'g2', name: '过年回家的机票', icon: '✈️', target: 240000, saved: 96000, deadline: null,
      color: '#14B87A', note: '', kind: 'normal', slot: '', cpBookId: '', createdAt: now, archived: false, logs: [] },
    // 小金库必须盖 cpBookId + slot:'vault'，否则 S4 那一屏只剩一个「建一个小金库」的空按钮
    { id: 'g3', name: '我们的小金库', icon: '💞', target: 300000, saved: 186000, deadline: null,
      color: '#FF6A9B', note: '一起存，一起花', kind: 'couple', slot: 'vault', cpBookId: 'cp1',
      createdAt: now, archived: false, logs: [] },
  ],
  books: [{ id: 'default', name: '日常', icon: '📒', color: '#4F7CFF', createdAt: now, kind: 'normal' }],
  cpTxs: CP_TX,
  cpBooks: [{
    id: 'cp1', meName: '小懒', peerName: '小满', mode: 'local',
    togetherSince: '2024-05-20', meBirthday: '1999-08-12', peerBirthday: '1998-11-03',
    order: 1, status: 'active', createdAt: now, closedAt: 0,
  }],
  repeats: [], wishlist: [], subs: [], recon: [], alertLog: {},
  settings: {
    theme: 'light',
    cycle: { type: 'month', startDay: 1, weekStart: 1, days: 30, anchor: null },
    budget: { amount: 800000, split: {} },
    books: { activeId: 'default' },
    tip: { enabled: false, offset: 0, place: 'add' },
    couple: {
      enabled: true, mode: 'local', consent:{ agreed: true, at: now,version:(window.ViewCouple.CONSENT_VERSION||3) },
      room: '', salt: '', code: '', peerName: '小满', meName: '小懒',
      togetherSince: '2024-05-20', meBirthday: '1999-08-12', peerBirthday: '1998-11-03',
      since: 0, epoch: 0, lastSyncAt: 0, notice: '', shareRatio: false,
      nextMeet: '', tzOffset: 8, activeId: 'cp1', hidden: false,
      closedAt: 0, closeReason: '', deletedAt: 0,
    },
    ai: { enabled: false },
  },
};

// ---------------------------------------------------------------- 服务器
let serverProc = null;
function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  if (!(await ping(BASE))) {
    console.log('启动本地服务器…');
    serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      stdio: 'ignore', env: { ...process.env, PORT: String(APP_PORT) },
    });
    for (let i = 0; i < 20; i++) { await sleep(300); if (await ping(BASE)) break; }
  }
  if (!(await ping(BASE))) throw new Error(`服务器没起来：${BASE}`);

  const profileDir = env.profile('site-shots');
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  // 连页面级 ws（和 _test/shoot.js 一致）：/json/version 是浏览器端点，发 Page.* 会报
  // "'Page.enable' wasn't found"
  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  if (!target) throw new Error('没有可用的页面目标');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const S = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    await sleep(420);
    const r = await S('Page.captureScreenshot', { format: 'webp', quality: 84, captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    const kb = (Buffer.from(r.data, 'base64').length / 1024).toFixed(0);
    console.log(`  ${name}  ${kb} KB`);
  };
  const nav = async (name) => { await ev(`App.go(${JSON.stringify(name)}); 1`); await sleep(650); };

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await S('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  console.log('载入应用并注入 demo 数据…');
  await S('Page.navigate', { url: BASE });
  await sleep(2200);
  await ev(`localStorage.setItem('jizhang.v1', ${JSON.stringify(JSON.stringify(STATE))}); 1`);
  await S('Page.reload');
  await sleep(2600);

  // 权威计数：页面上写的分类数必须以这里为准（红线 6）
  const counts = await ev(`JSON.stringify({
    exp: Icons.catsOf('expense').length,
    inc: Icons.catsOf('income').length,
    subs: Icons.CATEGORIES.reduce((n,c)=>n+(c.subs?c.subs.length:0),0),
    tx: Store.state.tx.length,
    cp: Store.state.cpTxs.length
  })`);
  console.log('  实测分类：', counts);

  const txOk = await ev(`Store.state.tx.length`);
  if (!txOk) throw new Error('demo 数据没写进去，检查 localStorage 键名/结构');

  // 退款走真实接口（手写进 JSON 会被当成一条普通支出显示）
  await ev(`(()=>{try{Store.addTx({type:'expense',amount:1960,catId:'fun',sub:'电影',accountId:'wechat',note:'退了一张票',refundOf:'d04',ts:${at(1, 22, 30)}});}catch(e){console.warn('refund seed',e.message);}return 1;})()`);
  await sleep(300);

  // 1 首页（明细）
  await nav('detail');
  await shot('shot-home.webp');

  // 2 记一笔（按 50 + 20，展示小计算器）
  await nav('add');
  await sleep(500);
  await ev(`(()=>{const keys=['5','0','+','2','0'];for(const k of keys){const b=document.querySelector('[data-key="'+k+'"]');if(b)b.click();}return 1;})()`);
  await sleep(2400);   // 等「再输入要加上的金额」提示自己收掉，别把它截进去
  await shot('shot-add.webp');
  await ev('UI.closeAllSheets && UI.closeAllSheets(); 1');

  // 3 月度总结
  await nav('report');
  await shot('shot-report.webp');

  // 4 情侣主页
  await nav('couple');
  await shot('shot-couple.webp');

  // 5 情侣日历（同屏往下滚，或在同屏内找到日历卡）
  await ev(`(()=>{const b=document.querySelector('#view-couple [data-cp="to-memories"]');if(b)b.click();return 1;})()`);
  await sleep(1000);
  await shot('shot-calendar.webp');
  await ev(`(()=>{const b=document.querySelector('#view-couple [data-cp="sub-back"]');if(b)b.click();return 1;})()`);
  await sleep(500);

  // 6 攒钱目标 / 小金库
  await nav('goals');
  await shot('shot-fund.webp');

  // 报告：尺寸与文件清单
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.webp')).sort();
  console.log('\n产出：');
  for (const f of files) {
    const p = path.join(OUT, f);
    const b = fs.readFileSync(p);
    // webp 的宽高在 VP8X/VP8 头里，简单起见交给调用方用浏览器看
    console.log(`  ${f}  ${(b.length / 1024).toFixed(0)} KB`);
  }
  console.log(`\n共 ${files.length} 张 → ${OUT}`);

  ws.close();
  await env.stop(proc);
  if (serverProc) serverProc.kill();
  process.exit(0);
})().catch((e) => {
  console.error('失败：', e.message);
  process.exit(1);
});
