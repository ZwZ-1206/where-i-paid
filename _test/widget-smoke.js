#!/usr/bin/env node
/**
 * 桌面小组件快照的冒烟测试（纯 Node，不需要浏览器）。
 *
 * 把 icons/utils/store/widget 四个脚本塞进一个 vm 沙箱，
 * 造两笔账，看 Widget.snapshot() 吐出来的东西对不对。
 *
 * 用法：node _test/widget-smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const FILES = ['assets/js/icons.js', 'assets/js/utils.js', 'assets/js/store.js', 'assets/js/widget.js'];

// ---- 沙箱：只给这几份脚本真正用到的东西，缺了会立刻暴露 ----
const disk = new Map();
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, RegExp, Number, String, Object, Array, Boolean, Error, TypeError,
  isFinite, isNaN, parseInt, parseFloat, Set, Map, Promise, Symbol,
  localStorage: {
    getItem: (k) => (disk.has(k) ? disk.get(k) : null),
    setItem: (k, v) => disk.set(k, String(v)),
    removeItem: (k) => disk.delete(k),
  },
  document: {
    visibilityState: 'visible',
    addEventListener() {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
  },
  location: { protocol: 'https:', hostname: 'example.com', hash: '' },
  navigator: { language: 'zh-CN', userAgent: 'node' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
for (const f of FILES) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  vm.runInContext(code, ctx, { filename: f });
}

const S = sandbox.Store;
const U = sandbox.U;
const Widget = sandbox.Widget;
let failed = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${extra ? ' → ' + JSON.stringify(extra) : ''}`);
    failed++;
  }
}

// ---- 造数据：今天一笔、昨天一笔 ----
// 注意时间戳别写死 26 小时前当「昨天」：凌晨跑的时候它会退到前天。
// 这里统一以「刚才」和「此刻减去一天多一点」为准。
S.init();
const now = Date.now();
S.addTx({ type: 'expense', amount: 1850, catId: 'other_out', sub: '拉面', ts: now - 60e3 });
S.addTx({ type: 'expense', amount: 3200, catId: 'other_out', sub: '地铁', ts: now - 26 * 3600e3 });
S.addTx({ type: 'income', amount: 999000, catId: 'other_in', sub: '工资', ts: now - 120e3 });
S.setBudget(400000);

const pushed = [];
sandbox.JZWidget = {
  postSnapshot: (json) => { pushed.push(json); return true; },
  hasSnapshot: () => false,
};

console.log('\n▶ Widget.supported()');
check('装了桥就认这是 APK', Widget.supported() === true);

console.log('\n▶ Widget.push()');
check('推送成功', Widget.push('test') === true);
check('确实调到了原生桥', pushed.length === 1);
check('同样的内容不重复推', Widget.push('test') === true && pushed.length === 1);

const snap = JSON.parse(pushed[0]);
const todayKey = U.ymd(new Date());
const yKey = U.ymd(now - 26 * 3600e3);

console.log('\n▶ 快照内容');
check('版本字段存在', snap.v === 1, snap.v);
check('有时间戳', typeof snap.at === 'number' && snap.at > 0);
check('货币符号兜底为 ¥', snap.sym === '¥', snap.sym);
check('今天这一格存在', !!snap.days.find((d) => d.d === todayKey), snap.days);
check('今天的金额是 1850（收入不计）', (snap.days.find((d) => d.d === todayKey) || {}).e === 1850, snap.days);
check('今天的笔数是 1（收入不计笔）', (snap.days.find((d) => d.d === todayKey) || {}).c === 1, snap.days);
check('昨天也有独立一格', !!snap.days.find((d) => d.d === yKey), snap.days);
check('周期有标签', typeof snap.period.label === 'string' && snap.period.label.length > 0, snap.period.label);
check('周期收支不含收入', snap.period.expense === 1850 + 3200, snap.period);
check('预算带过来了', snap.budget.amount === 400000, snap.budget);
check('最近一笔有图标/标题/日期/金额', snap.recent.length >= 1 &&
  snap.recent[0].i && snap.recent[0].t === '拉面' && /^\d\d-\d\d$/.test(snap.recent[0].d) && snap.recent[0].a === 1850,
  snap.recent[0]);
check('快照体积可控（<20KB）', pushed[0].length < 20000, pushed[0].length);

console.log('\n▶ 没桥时的行为（网页版 / iOS）');
delete sandbox.JZWidget;
check('supported() 变 false', Widget.supported() === false);
check('push() 安静失败且不抛', Widget.push('no-bridge') === false);

console.log(failed ? `\n✖ ${failed} 项不通过\n` : '\n✅ 全部通过\n');
process.exit(failed ? 1 : 0);
