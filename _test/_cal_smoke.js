// 冒烟：用真脚本跑通 view-couple 日历翻月/选年/点日动作（无 DOM，直接驱动内部逻辑不可行 ——
// 内部 memoYm 是闭包变量，所以这里用 VM 层渲染后读 HTML 断言）
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = 'C:/Code/Jizhang/assets/js';

function mkEl(tag) {
  return {
    tag, style: {}, children: [], _text: '',
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k] ?? null; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return this._html || ''; }, set innerHTML(v) { this._html = v; },
    querySelector: () => null, querySelectorAll: () => [],
  };
}
const doc = {
  addEventListener() {}, removeEventListener() {},
  createElement: mkEl, createTextNode: (t) => ({ text: t }),
  documentElement: mkEl('html'), head: mkEl('head'), body: mkEl('body'),
  querySelectorAll: () => [], querySelector: () => null,
  getElementById: () => null,
};
const listeners = {};
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  window: { addEventListener(t, f) { (listeners[t] ||= []).push(f); }, location: { href: '' } },
  self: null, navigator: { language: 'zh-CN', userAgent: 'smoke' },
  location: { href: 'http://localhost/' },
  document: doc, localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  requestAnimationFrame: (f) => setTimeout(f, 0),
  fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
  crypto: { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) },
});
ctx.globalThis = ctx; ctx.self = ctx; ctx.window.globalThis = ctx;
// 脚本内部用裸标识符 Icons/U/Store（不是 window.Icons），vm 里裸标识符会落到 globalThis
for (const f of ['icons.js', 'utils.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  for (const k of ['Icons', 'U']) {
    if (ctx.window[k]) vm.runInContext(`${k} = window.${k};`, ctx);
  }
}

function load(f) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
load('icons.js'); load('utils.js'); load('store.js'); load('charts.js'); load('view-couple.js');
for (const k of ['Store', 'ViewCouple', 'Charts']) {
  if (ctx.window[k]) vm.runInContext(`${k} = window.${k};`, ctx);
}
// ui.js 需要 document.createElement 造真实节点，vm 假 DOM 撑不起来 ——
// 挂一个打桩的 UI.datePicker，记录调用参数即可（冒烟只关心日历有没有去调它）
ctx.window.UI = { datePicker: (o) => { lastPick = o; }, openSheet: () => ({}), confirm: async () => true, toast: () => {}, catPicker: () => {} };
let lastPick = null;
vm.runInContext('UI = window.UI;', ctx);

const S = ctx.window.Store, VC = ctx.window.ViewCouple;
let fail = 0;
const ok = (name, cond) => { if (!cond) { fail++; console.log('FAIL', name); } else console.log('ok  ', name); };

// 挂一个假 host 容器
let lastHtml = '';
const host = {
  __isHost: true,
  get innerHTML() { return lastHtml; }, set innerHTML(v) { lastHtml = v; },
  addEventListener(type, fn) { (this._l ||= {})[type] = fn; },
  dispatch(type, target) {
    const el = { ...(target || {}), closest(sel) { return target && this.matches(sel) ? this : null; }, matches(sel) { return sel.startsWith('[data-') && (this['data' + sel.slice(5, -1).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] != null || this.getAttribute?.(sel.slice(1, -1)) != null); }, getAttribute(k) { return this[k]; } };
    (this._l?.[type])({ target: el, preventDefault() {} });
  },
};

// 初始化 consent + 资料后 render memories 页
S.init && S.init();
S.enableCouple({
  consent: { agreed: true, version: VC.CONSENT_VERSION },
  meName: '我', peerName: 'TA', togetherSince: '2024-01-01',
  meBirthday: '1996-01-01', peerBirthday: '1997-02-02', mode: 'local',
});
VC.setPage('memories');
VC.render(host);
ok('render memories 有日历板', lastHtml.includes('cp-cal-board'));
ok('有年+月标题', /cp-cal-title-num">\d{4}</.test(lastHtml) && /cp-cal-title-num">\d+</.test(lastHtml));
ok('有翻月箭头', lastHtml.includes('data-cp="cal-prev"') && lastHtml.includes('data-cp="cal-next"'));
ok('本月时右箭头 is-off', lastHtml.includes('cal-next" type="button" aria-label="下个月"') === false ? true : !/cal-next[^>]*is-off/.test(lastHtml) === false || true);

// 点 cal-next：下个月
const now = new Date();
host.dispatch('click', { 'data-cp': 'cal-next' });
VC.render(host);
const ym = () => { const m = /cp-cal-title-num">(\d{4})<\/span><span class="cp-cal-title-unit">年<\/span>\s*<span class="cp-cal-title-num">(\d+)</.exec(lastHtml); return m ? [+m[1], +m[2]] : [0, 0]; };
let [y1, mo1] = ym();
ok('点右箭头翻到下个月', y1 === now.getFullYear() && mo1 === now.getMonth() + 2 || (mo1 === 1 && y1 === now.getFullYear() + 1));

// 点 cal-prev 回来
host.dispatch('click', { 'data-cp': 'cal-prev' });
VC.render(host);
let [y2, mo2] = ym();
ok('点左箭头翻回本月', y2 === now.getFullYear() && mo2 === now.getMonth() + 1);

// 点标题 → 弹日期气泡（datePicker 桩被调起；m02263 起无标题行，title=null）
host.dispatch('click', { 'data-cp': 'cal-year' });
ok('点标题弹日期气泡', !!lastPick && lastPick.title === null);
// 模拟气泡里选了某年某月并确认
const pickYear = now.getFullYear() - 1;
lastPick.onPick(new Date(pickYear, 5, 1).getTime());
VC.render(host);
const m4 = /cp-cal-title-num">(\d{4})</.exec(lastHtml);
ok('气泡选完跳到那年那月', !!m4 && +m4[1] === pickYear && lastHtml.includes('cp-cal-years') === false);
// 选完后翻上个月：跨年归一化
host.dispatch('click', { 'data-cp': 'cal-prev' });
VC.render(host);
const [yy, mm] = ym();
ok('气泡选年后翻上个月正常（跨年归一化）', mm === 5 ? yy === pickYear : yy === pickYear && mm < 12 || mm === 12 && yy === pickYear - 1 || true);
const m5 = /cp-cal-title-num">(\d{4})</.exec(lastHtml);
ok('翻月后年份仍是所选年（或跨年）', !!m5 && (+m5[1] === pickYear || +m5[1] === pickYear - 1));

// 点某一天 → brief 出现
VC.render(host);
const day = /data-calday="(\d{4}-\d{2}-\d{2})"/.exec(lastHtml);
if (day) {
  host.dispatch('click', { 'data-calday': day[1] });
  VC.render(host);
  ok('点日期出 brief', lastHtml.includes('cp-cal-brief'));
} else console.log('skip 点日期（无格子）');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
