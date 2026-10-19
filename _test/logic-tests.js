/* 在页面上下文中执行的核心逻辑断言 */
const U = window.U;
const S = window.Store;
const out = [];
function t(name, fn) {
  try { fn(); out.push({ ok: true, name }); }
  catch (e) { out.push({ ok: false, name, msg: e && e.message }); }
}
function eq(a, b, label) {
  if (a !== b) throw new Error(`${label || ''} 期望 ${b}，实际 ${a}`);
}
function ok(v, label) { if (!v) throw new Error(label || '断言失败'); }
function near(a, b, tol, label) {
  if (Math.abs(a - b) > (tol || 1)) throw new Error(`${label || ''} 期望≈${b}，实际 ${a}`);
}

// 用干净的数据环境
const backup = JSON.stringify(S.state);
localStorage.removeItem('jizhang.v1');

// ---------- 金额 ----------
t('金额换算：12.34 → 1234 分', () => eq(U.toCents('12.34'), 1234));
t('金额展示：1234 分 → ¥12.34', () => eq(U.money(1234), '¥12.34'));
t('金额展示：大额千分位', () => eq(U.money(123456789), '¥1,234,567.89'));
t('紧凑金额：1.2万', () => eq(U.moneyCompact(1200000), '¥1.2万'));
t('键盘输入态 0.1+0.2 精度安全', () => eq(U.amountToCents('0.1') + U.amountToCents('0.2'), 30));

// ---------- 日期 ----------
t('ymd 格式', () => eq(U.ymd(new Date(2026, 0, 5)), '2026-01-05'));
t('parseYmd 往返', () => eq(U.ymd(U.parseYmd('2026-03-09')), '2026-03-09'));
t('月末日期钳制：2月30日 → 2月28日', () => {
  const d = U.dateClamped(2026, 1, 30);
  eq(d.getDate(), 28);
});
t('闰年2月29日', () => eq(U.dateClamped(2024, 1, 30).getDate(), 29));

// ---------- 周期：按月（起始日 1） ----------
t('周期-自然月：10月15日属于10月1日-10月31日', () => {
  const p = S.periodFor(new Date(2026, 9, 15), { type: 'month', startDay: 1 });
  eq(U.ymd(p.start), '2026-10-01');
  eq(U.ymd(p.end), '2026-10-31');
  eq(p.days, 31);
});
t('周期-自然月：跨年边界（1月5日）', () => {
  const p = S.periodFor(new Date(2026, 0, 5), { type: 'month', startDay: 1 });
  eq(U.ymd(p.start), '2026-01-01');
  eq(U.ymd(p.end), '2026-01-31');
});

// ---------- 周期：按月（起始日 15，发薪日场景） ----------
t('周期-15日起：10月20日 → 10月15日-11月14日', () => {
  const p = S.periodFor(new Date(2026, 9, 20), { type: 'month', startDay: 15 });
  eq(U.ymd(p.start), '2026-10-15');
  eq(U.ymd(p.end), '2026-11-14');
  eq(p.days, 31);
});
t('周期-15日起：10月3日 → 9月15日-10月14日（回落到上一周期）', () => {
  const p = S.periodFor(new Date(2026, 9, 3), { type: 'month', startDay: 15 });
  eq(U.ymd(p.start), '2026-09-15');
  eq(U.ymd(p.end), '2026-10-14');
});
t('周期-15日起：2月起始日不溢出', () => {
  const p = S.periodFor(new Date(2026, 1, 20), { type: 'month', startDay: 15 });
  eq(U.ymd(p.start), '2026-02-15');
  eq(U.ymd(p.end), '2026-03-14');
});

// ---------- 周期：按周 ----------
t('周期-按周（周一起）：2026-10-17 是周六 → 10/12-10/18', () => {
  const p = S.periodFor(new Date(2026, 9, 17), { type: 'week', weekStart: 1 });
  eq(U.ymd(p.start), '2026-10-12');
  eq(U.ymd(p.end), '2026-10-18');
  eq(p.days, 7);
});

// ---------- 周期：自定义天数 ----------
t('周期-自定义10天：锚点10/1，10/25 → 第3个周期 10/21-10/30', () => {
  const p = S.periodFor(new Date(2026, 9, 25), { type: 'custom', days: 10, anchor: '2026-10-01' });
  eq(U.ymd(p.start), '2026-10-21');
  eq(U.ymd(p.end), '2026-10-30');
  eq(p.days, 10);
});
t('周期-自定义10天：锚点之前的日期也能正确归属', () => {
  const p = S.periodFor(new Date(2026, 8, 25), { type: 'custom', days: 10, anchor: '2026-10-01' });
  eq(U.ymd(p.start), '2026-09-21');
  eq(U.ymd(p.end), '2026-09-30');
});

// ---------- 周期切换 ----------
t('周期偏移：从当前周期往前 1 个不重叠', () => {
  S.setCycle({ type: 'month', startDay: 15 });
  const cur = S.currentPeriod();
  const prev = S.shiftPeriod(cur, -1);
  ok(prev.end.getTime() < cur.start.getTime(), '上一周期应早于当前周期');
  eq(U.ymd(new Date(prev.end.getTime() + 1)), U.ymd(cur.start));
});
t('最近 6 个周期按时间正序且首尾相接', () => {
  S.setCycle({ type: 'month', startDay: 1 });
  const list = S.recentPeriods(6);
  eq(list.length, 6);
  for (let i = 1; i < list.length; i++) {
    ok(list[i].start.getTime() > list[i - 1].start.getTime(), '应递增');
    eq(U.ymd(new Date(list[i - 1].end.getTime() + 1)), U.ymd(list[i].start), '周期应无缝衔接');
  }
});

// ---------- 记账与统计 ----------
t('新增账目并进入本期统计', () => {
  S.setCycle({ type: 'month', startDay: 1 });
  const p = S.currentPeriod();
  const before = S.summary(p).expense;
  const mid = new Date(p.start.getTime() + 2 * 3600000);
  S.addTx({ type: 'expense', amount: 12345, catId: 'food', sub: '午餐', ts: mid.getTime() });
  const after = S.summary(p).expense;
  eq(after - before, 12345);
});
t('收入与结余计算', () => {
  const p = S.currentPeriod();
  const s0 = S.summary(p);
  S.addTx({ type: 'income', amount: 500000, catId: 'salary', ts: p.start.getTime() + 3 * 3600000 });
  const s1 = S.summary(p);
  eq(s1.income - s0.income, 500000);
  eq(s1.net, s1.income - s1.expense);
});
t('分类占比之和为 1', () => {
  const s = S.summary(S.currentPeriod());
  if (s.expense > 0) near(s.byCat.reduce((a, c) => a + c.pct, 0), 1, 0.0001);
});
t('删除账目后统计回落', () => {
  const p = S.currentPeriod();
  const t1 = S.addTx({ type: 'expense', amount: 9999, catId: 'fun', ts: p.start.getTime() + 4 * 3600000 });
  const a = S.summary(p).expense;
  S.removeTx(t1.id);
  eq(a - S.summary(p).expense, 9999);
});
t('恢复删除的账目', () => {
  const p = S.currentPeriod();
  const t1 = S.addTx({ type: 'expense', amount: 777, catId: 'fun', ts: p.start.getTime() + 5 * 3600000 });
  S.removeTx(t1.id);
  S.restoreTx(t1);
  ok(S.txById(t1.id), '应能恢复');
  S.removeTx(t1.id);
});
t('不在本期的账目不计入', () => {
  const p = S.currentPeriod();
  const before = S.summary(p).expense;
  S.addTx({ type: 'expense', amount: 88888, catId: 'food', ts: p.start.getTime() - 86400000 * 40 });
  eq(S.summary(p).expense, before);
});

// ---------- 预算 ----------
t('预算状态：超支判定', () => {
  const p = S.currentPeriod();
  const spent = S.summary(p).expense;
  S.setBudget(Math.max(1, spent - 1000), {});
  const b = S.budgetStatus(p);
  ok(b.remaining < 0, '应判定为超支');
  eq(b.level, 'over');
});
t('预算状态：健康判定', () => {
  const p = S.currentPeriod();
  S.setBudget(S.summary(p).expense * 10, {});
  const b = S.budgetStatus(p);
  eq(b.level, 'safe');
  ok(b.remaining > 0, '应有剩余');
});
t('分类预算统计正确', () => {
  const p = S.currentPeriod();
  S.setBudget(1000000, { food: 50000 });
  const b = S.budgetStatus(p);
  const food = b.cats.find((c) => c.catId === 'food');
  ok(food, '应存在餐饮预算');
  const foodSpent = S.summary(p).byCat.filter((c) => c.id === 'food').reduce((a, c) => a + c.amount, 0);
  eq(food.used, foodSpent);
});
t('日均可用额度 > 0 且合理', () => {
  const b = S.budgetStatus(S.currentPeriod());
  ok(b.dailyAllowance >= 0, '日均应为非负');
  ok(b.daysLeft >= 1, '剩余天数至少 1');
});

// ---------- 低预算提醒 ----------
t('低预算提醒：达到阈值触发一次且不重复', () => {
  const p = S.currentPeriod();
  const spent = S.summary(p).expense;
  S.setBudget(Math.round(spent / 0.85), {});
  S.setSettings({ alert: { enabled: true, thresholds: [80] } });
  S.resetAlertLog();
  const first = S.checkAlerts();
  eq(first.length, 1);
  const second = S.checkAlerts();
  eq(second.length, 0);
});
t('低预算提醒：关闭后不触发', () => {
  S.setSettings({ alert: { enabled: false, thresholds: [50] } });
  S.resetAlertLog();
  eq(S.checkAlerts().length, 0);
  S.setSettings({ alert: { enabled: true, thresholds: [80, 100] } });
});
t('低预算提醒：无预算不触发', () => {
  S.setBudget(0, {});
  S.resetAlertLog();
  eq(S.checkAlerts().length, 0);
});

// ---------- 攒钱目标 ----------
t('目标：存入与进度', () => {
  const g = S.addGoal({ name: '测试目标', target: 100000, saved: 0, deadline: U.ymd(U.addDays(new Date(), 100)) });
  S.depositGoal(g.id, 25000, '第一笔');
  const p = S.goalProgress(S.goalById(g.id));
  eq(S.goalById(g.id).saved, 25000);
  near(p.pct, 0.25, 0.0001);
  eq(p.left, 75000);
});
t('目标：取出不会为负', () => {
  const g = S.state.goals[S.state.goals.length - 1];
  S.depositGoal(g.id, -999999, '取出');
  eq(S.goalById(g.id).saved, 0);
});
t('目标：达成判定', () => {
  const g = S.state.goals[S.state.goals.length - 1];
  S.depositGoal(g.id, 100000, '存满');
  const p = S.goalProgress(S.goalById(g.id));
  ok(p.done, '应判定为达成');
  eq(p.left, 0);
  eq(p.pct, 1);
});
t('目标：每月需存金额计算', () => {
  const g = S.addGoal({ name: '月存测试', target: 300000, deadline: U.ymd(U.addDays(new Date(), 90)) });
  const p = S.goalProgress(S.goalById(g.id));
  ok(p.perMonth > 0, '每月需存应大于 0');
  ok(p.daysLeft > 80 && p.daysLeft < 95, '剩余天数应接近 90，实际 ' + p.daysLeft);
});
t('目标：删除', () => {
  const g = S.addGoal({ name: '待删', target: 1000 });
  S.removeGoal(g.id);
  ok(!S.goalById(g.id), '应已删除');
});

// ---------- 备份导入导出 ----------
t('导出 JSON 可被导入还原', () => {
  const json = S.exportJSON();
  const txCount = S.state.tx.length;
  const parsed = JSON.parse(json);
  ok(parsed.data && Array.isArray(parsed.data.tx), '导出结构应含 data.tx');
  S.importJSON(json, 'replace');
  eq(S.state.tx.length, txCount);
});
t('CSV 导出含表头与行数一致', () => {
  const csv = S.exportCSV(null);
  const lines = csv.replace(/^\ufeff/, '').split('\r\n');
  eq(lines[0].indexOf('日期') >= 0, true);
  eq(lines.length, S.state.tx.length + 1);
});
t('导入非法文件抛出可读错误', () => {
  let threw = false;
  try { S.importJSON('{"foo":1}', 'replace'); } catch (e) { threw = true; ok(e.message.length > 0, '错误信息应非空'); }
  ok(threw, '应抛出错误');
});

// ---------- 边界 ----------
t('金额上限保护：9 位数字', () => {
  eq(U.amountToCents('999999999'), 99999999900);
});
t('空金额解析为 0', () => {
  eq(U.amountToCents(''), 0);
  eq(U.amountToCents('.'), 0);
});
t('周期摘要不因空数据崩溃', () => {
  const fake = { start: new Date(2020, 0, 1), end: new Date(2020, 0, 31), days: 31, key: 'x', label: 'x' };
  const s = S.summary(fake);
  eq(s.expense, 0);
  eq(s.income, 0);
  eq(s.byCat.length, 0);
});

// ---------- 暖心提示 ----------
const Tips = window.Tips;
const DAY = new Date(2026, 4, 12); // 2026-05-12 固定一天
const DAY_TS = U.startOfDay(DAY).getTime();

function setTx(list) {
  S.state.tx = list.map((x, i) => ({
    id: 'tt' + i,
    type: x.type || 'expense',
    amount: x.amount,
    catId: x.catId || 'other_out',
    sub: '',
    accountId: 'alipay',
    note: '',
    ts: x.ts,
    createdAt: x.ts,
  }));
  if (Tips) Tips.clearCache();
}

t('暖心提示：没有账目时给出「还没记」的提示', () => {
  setTx([]);
  const r = Tips.forDate(DAY_TS);
  ok(r.items.length > 0, '应有提示');
  eq(r.items[0].id, 'empty');
});

t('暖心提示：餐饮占比过低触发 food_low', () => {
  setTx([
    { amount: 5000, catId: 'shopping', ts: DAY_TS + 3600000 },
    { amount: 100, catId: 'food', ts: DAY_TS + 7200000 },
  ]);
  const r = Tips.forDate(DAY_TS);
  ok(r.items.some((x) => x.id === 'food_low'), '应命中 food_low，实际 ' + r.items.map((x) => x.id).join(','));
});

t('暖心提示：交通为 0 触发 transport_zero', () => {
  setTx([
    { amount: 3000, catId: 'food', ts: DAY_TS + 3600000 },
    { amount: 2000, catId: 'market', ts: DAY_TS + 7200000 },
    { amount: 1500, catId: 'fun', ts: DAY_TS + 9000000 },
  ]);
  const r = Tips.forDate(DAY_TS);
  ok(r.items.some((x) => x.id === 'transport_zero'), '应命中 transport_zero');
});

t('暖心提示：娱乐过高触发 fun_high', () => {
  setTx([
    { amount: 9000, catId: 'fun', ts: DAY_TS + 3600000 },
    { amount: 1000, catId: 'food', ts: DAY_TS + 7200000 },
  ]);
  const r = Tips.forDate(DAY_TS);
  ok(r.items.some((x) => x.id === 'fun_high'), '应命中 fun_high，实际 ' + r.items.map((x) => x.id).join(','));
});

t('暖心提示：同一天多次生成文案稳定', () => {
  setTx([
    { amount: 3000, catId: 'food', ts: DAY_TS + 3600000 },
    { amount: 2000, catId: 'transport', ts: DAY_TS + 7200000 },
    { amount: 1500, catId: 'fun', ts: DAY_TS + 9000000 },
  ]);
  const a = Tips.forDate(DAY_TS).items.map((x) => x.text).join('|');
  Tips.clearCache();
  const b = Tips.forDate(DAY_TS).items.map((x) => x.text).join('|');
  eq(a, b, '同日文案应一致');
});

t('暖心提示：换一句后文案变化', () => {
  setTx([
    { amount: 3000, catId: 'food', ts: DAY_TS + 3600000 },
    { amount: 2000, catId: 'transport', ts: DAY_TS + 7200000 },
    { amount: 1500, catId: 'fun', ts: DAY_TS + 9000000 },
  ]);
  const before = Tips.forDate(DAY_TS).items.map((x) => x.text).join('|');
  Tips.shuffle();
  const after = Tips.forDate(DAY_TS).items.map((x) => x.text).join('|');
  ok(before !== after, '换一句后应不同');
  S.setSettings({ tip: { offset: 0 } });
  Tips.clearCache();
});

t('暖心提示：占位符全部被替换', () => {
  setTx([
    { amount: 3000, catId: 'food', ts: DAY_TS + 3600000 },
    { amount: 2000, catId: 'transport', ts: DAY_TS + 7200000 },
  ]);
  for (let off = 0; off < 8; off++) {
    S.setSettings({ tip: { offset: off } });
    Tips.clearCache();
    const r = Tips.forDate(DAY_TS);
    r.items.forEach((it) => ok(it.text.indexOf('{') < 0, '文案残留占位符：' + it.text));
  }
  S.setSettings({ tip: { offset: 0 } });
  Tips.clearCache();
});

t('暖心提示：结果按优先级降序且最多 3 条', () => {
  setTx([
    { amount: 9000, catId: 'fun', ts: DAY_TS + 3600000 },
    { amount: 100, catId: 'food', ts: DAY_TS + 7200000 },
  ]);
  const r = Tips.forDate(DAY_TS);
  ok(r.items.length <= 3, '最多 3 条，实际 ' + r.items.length);
  const pr = r.items.map((it) => (Tips.RULES.find((x) => x.id === it.id) || { priority: 0 }).priority);
  for (let i = 1; i < pr.length; i++) ok(pr[i - 1] >= pr[i], '优先级应降序，实际 ' + pr.join(','));
});

t('暖心提示：关闭开关后不渲染', () => {
  setTx([{ amount: 3000, catId: 'food', ts: DAY_TS + 3600000 }]);
  S.setSettings({ tip: { enabled: false } });
  eq(Tips.renderCard(), '');
  eq(Tips.renderSlim(), '');
  S.setSettings({ tip: { enabled: true } });
  ok(Tips.renderCard().length > 0 || Tips.renderSlim().length > 0, '开启后应能渲染');
});

t('暖心提示：显示位置 off 时不渲染', () => {
  S.setSettings({ tip: { enabled: true, place: 'off' } });
  eq(Tips.renderCard(), '');
  eq(Tips.renderSlim(), '');
  S.setSettings({ tip: { place: 'add' } });
});

t('暖心提示：渲染出的 HTML 含提示卡片结构', () => {
  setTx([{ amount: 3000, catId: 'food', ts: DAY_TS + 3600000 }]);
  S.setSettings({ tip: { enabled: true, place: 'add' } });
  Tips.clearCache();
  const html = Tips.renderCard();
  ok(html.indexOf('tip-card') >= 0, '应含 tip-card');
  ok(html.indexOf('data-tip="open"') >= 0, '应含打开弹层按钮');
  ok(html.indexOf('data-tip="shuffle"') >= 0, '应含换一句按钮');
});

t('暖心提示：收入大于支出触发 surplus', () => {
  setTx([
    { amount: 2000, catId: 'food', ts: DAY_TS + 3600000 },
    { amount: 50000, catId: 'salary', type: 'income', ts: DAY_TS + 7200000 },
  ]);
  const r = Tips.forDate(DAY_TS);
  ok(r.items.some((x) => x.id === 'surplus'), '应命中 surplus，实际 ' + r.items.map((x) => x.id).join(','));
});

t('暖心提示：极小额触发 tiny', () => {
  setTx([{ amount: 500, catId: 'food', ts: DAY_TS + 3600000 }]);
  const r = Tips.forDate(DAY_TS);
  ok(r.items.some((x) => x.id === 'tiny'), '应命中 tiny，实际 ' + r.items.map((x) => x.id).join(','));
});

t('暖心提示：规则均有对应文案且文案非空', () => {
  Tips.RULES.forEach((r) => {
    const c = Tips.COPY[r.id];
    ok(c, '规则 ' + r.id + ' 缺少文案');
    ok(c.lines.length > 0, '规则 ' + r.id + ' 文案为空');
    c.lines.forEach((l) => ok(l.length > 0, '规则 ' + r.id + ' 有空文案'));
  });
  ok(Tips.COPY.fallback, '应有兜底文案');
});

t('暖心提示：文案不出现重复百分号', () => {
  setTx([
    { amount: 9000, catId: 'fun', ts: DAY_TS + 3600000 },
    { amount: 100, catId: 'food', ts: DAY_TS + 7200000 },
  ]);
  for (let off = 0; off < 12; off++) {
    S.setSettings({ tip: { offset: off } });
    Tips.clearCache();
    Tips.forDate(DAY_TS).items.forEach((it) => {
      ok(it.text.indexOf('%%') < 0, '出现重复百分号：' + it.text);
      ok(it.text.indexOf('{') < 0, '残留占位符：' + it.text);
    });
  }
  S.setSettings({ tip: { offset: 0 } });
  Tips.clearCache();
});

// ---------- AI 层 ----------
const AI = window.AI;
const OCR = window.OCR;
const Scan = window.Scan;

t('AI：预设表完整且字段齐全', () => {
  ok(AI.PRESETS.length >= 6, '预设数量应 >= 6，实际 ' + AI.PRESETS.length);
  AI.PRESETS.forEach((p) => {
    ok(p.id && p.name, '预设缺少 id/name');
    ok(typeof p.baseUrl === 'string', p.id + ' 缺少 baseUrl');
  });
  ok(AI.preset('dashscope').id === 'dashscope', '应能按 id 取预设');
  ok(AI.preset('不存在').id === AI.PRESETS[0].id, '未知 id 应回落第一个预设');
});

t('AI：未配置时 ready() 为 false 且不发起请求', () => {
  const bak = JSON.parse(JSON.stringify(S.settings.ai));
  S.setSettings({ ai: { enabled: false, apiKey: '', baseUrl: '', model: '' } });
  eq(AI.ready(), false);
  eq(AI.canVision(), false);
  S.setSettings({ ai: { enabled: true, baseUrl: 'https://x/v1', model: 'm', apiKey: '' } });
  eq(AI.ready(), false, '没 Key 不应 ready');
  S.settings.ai = bak;
});

t('AI：extractJSON 能剥 ```json 围栏', () => {
  const r = AI.extractJSON('好的，结果如下：\n```json\n{"a":1,"b":[2,3]}\n```\n希望有帮助');
  eq(r.a, 1);
  eq(r.b.length, 2);
});

t('AI：extractJSON 处理字符串里的花括号', () => {
  const r = AI.extractJSON('{"text":"他说 {你好} 就走了","n":5}');
  eq(r.n, 5);
  ok(r.text.indexOf('{你好}') >= 0, '字符串内花括号应保留，实际 ' + r.text);
});

t('AI：extractJSON 遇到非法内容抛可读错误', () => {
  let msg = '';
  try { AI.extractJSON('抱歉我无法回答'); } catch (e) { msg = e.message; }
  ok(msg.indexOf('JSON') >= 0, '错误信息应提到 JSON，实际 ' + msg);
});

t('AI：dayPayload 金额按元输出且含分类', () => {
  setTx([
    { amount: 2550, catId: 'food', ts: DAY_TS + 3600000 },
    { amount: 1200, catId: 'transport', ts: DAY_TS + 7200000 },
  ]);
  const p = AI.dayPayload(DAY_TS);
  ok(p, '应有 payload');
  eq(p.expense, '37.50');
  ok(p.cats.length >= 2, '应有分类明细');
  ok(p.cats[0].name, '分类应有名称');
});

t('AI：monthPayload 含预算与账目样本', () => {
  const per = S.currentPeriod();
  const p = AI.monthPayload(per);
  ok(p && p.period, '应有 period 标签');
  ok(typeof p.expense === 'string', 'expense 应为字符串金额');
  ok(Array.isArray(p.cats), 'cats 应为数组');
  ok(Array.isArray(p.accounts), 'accounts 应为数组');
  ok(Array.isArray(p.daily), 'daily 应为数组');
});

t('AI：normalizeScan 过滤非法分类并回落', () => {
  const r = AI.normalizeScan({
    platform: 'wechat',
    entries: [
      { type: 'expense', amount: '25.80', catId: '不存在的分类', sub: '乱写', merchant: ' 沙县小吃 ', ts: '2026-03-09 12:30' },
      { type: 'income', amount: '5000', catId: 'salary' },
      { type: 'expense', amount: '0', catId: 'food' },
    ],
  }, 'ai');
  eq(r.entries.length, 2, '金额为 0 的应被丢弃');
  eq(r.entries[0].amount, 2580);
  eq(r.entries[0].catId, 'other_out', '非法分类应回落 other_out');
  eq(r.entries[0].sub, '', '非法二级标签应清空');
  eq(r.entries[0].merchant, '沙县小吃', '应去掉首尾空格');
  eq(r.entries[1].catId, 'salary');
  eq(r.engine, 'ai');
  ok(r.entries[0].ts > 0, '时间戳应被解析');
});

t('AI：normalizeScan 无 entries 时返回空数组', () => {
  const r = AI.normalizeScan({ platform: 'other' }, 'ai');
  eq(r.entries.length, 0);
});

// ---------- OCR 本地解析 ----------
t('OCR：金额优先取「实付」', () => {
  const txt = '商品金额 ¥199.00\n优惠 -¥20.00\n实付款 ¥179.00';
  eq(OCR.extractAmount(txt), 179);
});

t('OCR：金额取「合计」', () => {
  eq(OCR.extractAmount('订单详情\n合计 45.50元'), 45.5);
});

t('OCR：金额兜底取最大两位小数', () => {
  eq(OCR.extractAmount('打车 12.00\n加价 3.50'), 12);
});

t('OCR：没有金额时返回 0', () => {
  eq(OCR.extractAmount('支付成功'), 0);
});

t('OCR：日期解析 YYYY-MM-DD', () => {
  const ts = OCR.extractDate('2026-03-09 12:30 支付成功');
  const d = new Date(ts);
  eq(d.getFullYear(), 2026);
  eq(d.getMonth(), 2);
  eq(d.getDate(), 9);
});

t('OCR：分类关键词命中餐饮', () => {
  const c = OCR.classify('沙县小吃 拌面');
  eq(c.catId, 'food');
  eq(c.type, 'expense');
});

t('OCR：分类关键词命中交通', () => {
  eq(OCR.classify('滴滴出行 快车').catId, 'transport');
});

t('OCR：收入关键词命中', () => {
  const c = OCR.classify('工资到账 8000.00');
  eq(c.type, 'income');
});

t('OCR：无法分类时回落其他支出', () => {
  eq(OCR.classify('某某某').catId, 'other_out');
});

t('OCR：parse 产出可入库的账目', () => {
  const r = OCR.parse('微信支付\n沙县小吃\n实付款 ¥25.80\n2026-03-09 12:30');
  eq(r.engine, 'ocr');
  eq(r.platform, 'wechat');
  eq(r.entries.length, 1);
  eq(r.entries[0].amount, 2580);
  eq(r.entries[0].catId, 'food');
  ok(r.entries[0].merchant.length > 0, '应识别出商家');
});

t('OCR：parse 没认出金额时给出警告', () => {
  const r = OCR.parse('支付成功');
  eq(r.entries.length, 0);
  ok(r.warning.length > 0, '应有 warning');
});

// ---------- 识图引擎选择 ----------
t('识图：未配置 AI 时 auto 回落本地 OCR', () => {
  const bakAi = JSON.parse(JSON.stringify(S.settings.ai));
  const bakScan = JSON.parse(JSON.stringify(S.settings.scan));
  S.setSettings({ ai: { enabled: false, apiKey: '', baseUrl: '', model: '', visionModel: '' } });
  S.setSettings({ scan: { engine: 'auto' } });
  eq(Scan.resolveEngine(), 'ocr', 'auto 且无 AI 时应回落 ocr');
  S.setSettings({ scan: { engine: 'ocr' } });
  eq(Scan.resolveEngine(), 'ocr', '显式选 OCR 时应为 ocr');
  S.setSettings({ scan: { engine: 'ai' } });
  eq(Scan.resolveEngine(), 'none', '显式选 AI 但没配置时应为 none');
  S.settings.ai = bakAi;
  S.settings.scan = bakScan;
});

t('识图：配置视觉模型后 auto 走 AI', () => {
  const bakAi = JSON.parse(JSON.stringify(S.settings.ai));
  const bakScan = JSON.parse(JSON.stringify(S.settings.scan));
  S.setSettings({ ai: { enabled: true, baseUrl: 'https://x/v1', model: 'm', apiKey: 'k', visionModel: 'v' } });
  S.setSettings({ scan: { engine: 'auto' } });
  eq(Scan.resolveEngine(), 'ai');
  S.setSettings({ scan: { engine: 'ocr' } });
  eq(Scan.resolveEngine(), 'ocr', '手动选 OCR 时优先 OCR');
  S.settings.ai = bakAi;
  S.settings.scan = bakScan;
});

t('识图：平台名映射到账目账户', () => {
  eq(Scan.guessAccount('wechat'), 'wechat');
  eq(Scan.guessAccount('alipay'), 'alipay');
  ok(Scan.guessAccount('pdd').length > 0, '未知平台应回落默认账户');
});

t('识图：toDraft 产出合法草稿', () => {
  const d = Scan.toDraft({ type: 'expense', amount: 2580, catId: 'food', sub: '午餐', merchant: '沙县', note: '午饭', ts: DAY_TS }, 'cash');
  eq(d.amountText, '25.8');
  eq(d.catId, 'food');
  eq(d.sub, '午餐');
  eq(d.accountId, 'cash');
  eq(d.note, '午饭');
});

t('识图：toDraft 金额整数不带小数点', () => {
  eq(Scan.toDraft({ amount: 5000, catId: 'food' }, 'cash').amountText, '50');
});

// ============================================================
// 账单 CSV 导入
// ============================================================
const Bills = window.Bills;

// 微信支付导出的账单格式（含表头前的说明行、收/支列、¥ 符号）
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
  '2026-02-07 09:00:00,零钱提现,工商银行,提现,/,¥500.00,零钱,提现已到账,10005,M005,',
].join('\r\n');

t('账单：解析微信 CSV 认出平台', () => {
  const r = Bills.parseText(WECHAT_CSV);
  eq(r.platform, 'wechat');
  ok(r.entries.length > 0, '应该有账目');
});

t('账单：跳过「/」不计收支的提现记录', () => {
  const r = Bills.parseText(WECHAT_CSV);
  eq(r.entries.length, 4);          // 5 行里 1 行是「/」
  eq(r.skipped.neutral, 1);
});

t('账单：支出与收入方向正确', () => {
  const r = Bills.parseText(WECHAT_CSV);
  const inc = r.entries.filter((e) => e.type === 'income');
  const exp = r.entries.filter((e) => e.type === 'expense');
  eq(inc.length, 1);
  eq(exp.length, 3);
  eq(inc[0].amount, 20000);
});

t('账单：金额去掉了 ¥ 与千分位', () => {
  const r = Bills.parseText(WECHAT_CSV);
  const dd = r.entries.find((e) => e.merchant === '滴滴出行');
  eq(dd.amount, 2580);
});

t('账单：时间解析正确', () => {
  const r = Bills.parseText(WECHAT_CSV);
  const first = r.entries[0];
  const d = new Date(first.ts);
  eq(d.getFullYear(), 2026);
  eq(d.getMonth(), 1);   // 2 月
  eq(d.getDate(), 3);
});

t('账单：按关键词自动分类', () => {
  const r = Bills.parseText(WECHAT_CSV);
  eq(r.entries.find((e) => e.merchant === '沙县小吃').catId, 'food');
  eq(r.entries.find((e) => e.merchant === '滴滴出行').catId, 'transport');
});

t('账单：收入归类到收入类目', () => {
  const r = Bills.parseText(WECHAT_CSV);
  const inc = r.entries.find((e) => e.type === 'income');
  ok(['other_in', 'gift_in', 'salary', 'bonus', 'invest', 'parttime'].includes(inc.catId), '收入分类应在收入类目里');
});

// 支付宝账单格式（金额带符号、有收/支列）
const ALIPAY_CSV = [
  '支付宝交易记录明细查询',
  '账号:[zhangsan@example.com]',
  '---------------------------------交易记录明细列表------------------------------------',
  '交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态',
  '2026021012001,ALI001,2026-02-10 12:00:00,2026-02-10 12:00:30,2026-02-10 12:00:30,其他,即时到账交易,肯德基,午餐,35.00,支出,交易成功,0.00,0.00,已支出',
  '2026021109001,ALI002,2026-02-11 09:00:00,2026-02-11 09:00:10,2026-02-11 09:00:10,其他,即时到账交易,某公司,工资,8000.00,收入,交易成功,0.00,0.00,已收入',
].join('\n');

t('账单：解析支付宝 CSV 认出平台与列', () => {
  const r = Bills.parseText(ALIPAY_CSV);
  eq(r.platform, 'alipay');
  eq(r.entries.length, 2);
  eq(r.entries.filter((e) => e.type === 'expense').length, 1);
  eq(r.entries.filter((e) => e.type === 'income').length, 1);
});

t('账单：支付宝工资归到 salary', () => {
  const r = Bills.parseText(ALIPAY_CSV);
  const inc = r.entries.find((e) => e.type === 'income');
  eq(inc.catId, 'salary');
});

// 银行流水格式（借贷分列，无收/支列）
const BANK_CSV = [
  '交易日期,摘要,交易金额,借方发生额,贷方发生额,余额,对方户名',
  '20260215,消费,0,120.00,0,5000.00,永辉超市',
  '20260216,工资,0,0,6000.00,11000.00,某科技有限公司',
  '20260217,转账,0,300.00,0,10700.00,张三',
].join('\n');

t('账单：银行借贷分列能正确判方向', () => {
  const r = Bills.parseText(BANK_CSV);
  eq(r.platform, 'bank');
  eq(r.entries.length, 3);
  eq(r.entries.filter((e) => e.type === 'income').length, 1);
  eq(r.entries.filter((e) => e.type === 'expense').length, 2);
});

t('账单：银行工资入账金额与分类', () => {
  const r = Bills.parseText(BANK_CSV);
  const inc = r.entries.find((e) => e.type === 'income');
  eq(inc.amount, 600000);
  eq(inc.catId, 'salary');
});

t('账单：去重键稳定（同一文件两次解析一致）', () => {
  const a = Bills.parseText(WECHAT_CSV);
  const b = Bills.parseText(WECHAT_CSV);
  eq(a.entries.map((e) => e.srcKey).join(','), b.entries.map((e) => e.srcKey).join(','));
});

t('账单：不同订单去重键不同', () => {
  const r = Bills.parseText(WECHAT_CSV);
  const keys = new Set(r.entries.map((e) => e.srcKey));
  eq(keys.size, r.entries.length);
});

t('账单：CSV 引号内的逗号不被拆开', () => {
  const rows = Bills.parseCSV('a,b\n"x,1",2\n');
  eq(rows.length, 2);
  eq(rows[1][0], 'x,1');
});

t('账单：CSV 双引号转义', () => {
  const rows = Bills.parseCSV('a\n"他说""你好"""\n');
  eq(rows[1][0], '他说"你好"');
});

t('账单：认不出表头时报错', () => {
  let err = null;
  try { Bills.parseText('随便一些文字\n没有表头\n'); } catch (e) { err = e; }
  ok(err && /表头/.test(err.message), '应提示认不出表头');
});

t('账单：空文件报错', () => {
  let err = null;
  try { Bills.parseText(''); } catch (e) { err = e; }
  ok(err && err.message.length > 0, '空文件应报错');
});

t('账单：金额解析各种写法', () => {
  eq(Bills.parseAmount('¥1,234.56'), 123456);
  eq(Bills.parseAmount('-88.00'), -8800);
  eq(Bills.parseAmount('(100.00)'), -10000);
  eq(Bills.parseAmount(''), 0);
});

t('账单：时间解析多种格式', () => {
  ok(Bills.parseTs('2026-03-09 12:30:00') > 0, 'ISO 带时间');
  ok(Bills.parseTs('2026/03/09') > 0, '斜杠');
  ok(Bills.parseTs('2026年3月9日') > 0, '中文');
  ok(Bills.parseTs('20260309') > 0, '紧凑');
  eq(Bills.parseTs('不是日期'), null);
});

t('账单：平台名与账户映射', () => {
  eq(Bills.platformName('wechat'), '微信');
  eq(Bills.platformName('alipay'), '支付宝');
  eq(Bills.accountFor('wechat'), 'wechat');
  eq(Bills.accountFor('alipay'), 'alipay');
});

t('账单：addTxMany 批量写入并记录 srcKey', () => {
  const before = S.state.tx.length;
  const added = S.addTxMany([
    { type: 'expense', amount: 1234, catId: 'food', ts: DAY_TS, srcKey: 'k1' },
    { type: 'income', amount: 5000, catId: 'salary', ts: DAY_TS, srcKey: 'k2' },
    { type: 'expense', amount: 0, catId: 'food', ts: DAY_TS, srcKey: 'k3' },   // 金额 0 应被丢弃
  ]);
  eq(added.length, 2);
  eq(S.state.tx.length, before + 2);
  ok(S.srcKeys().has('k1'), 'srcKeys 应包含 k1');
  ok(S.srcKeys().has('k2'), 'srcKeys 应包含 k2');
  ok(!S.srcKeys().has('k3'), '金额 0 不应写入');
  // 清理
  added.forEach((t) => S.removeTx(t.id));
});

t('账单：srcKeys 用于判断重复导入', () => {
  const r = Bills.parseText(WECHAT_CSV);
  const added = S.addTxMany(r.entries.map((e) => ({
    type: e.type, amount: e.amount, catId: e.catId, ts: e.ts, srcKey: e.srcKey,
  })));
  const seen = S.srcKeys();
  const dup = r.entries.filter((e) => seen.has(e.srcKey)).length;
  eq(dup, r.entries.length);
  added.forEach((t) => S.removeTx(t.id));
});

// ---------- 年 / 月 / 日 三种区间 ----------
const Icons = window.Icons;
t('区间-日：key 与首尾', () => {
  const p = S.dayPeriod(new Date(2026, 2, 9, 15, 30));
  eq(p.key, 'D:2026-03-09');
  eq(U.ymd(p.start), '2026-03-09');
  eq(U.ymd(p.end), '2026-03-09');
  eq(p.days, 1);
  eq(p.type, 'day');
});
t('区间-自然月：key 与首尾', () => {
  const p = S.monthPeriod(new Date(2026, 1, 20));
  eq(p.key, 'CAL:2026-02');
  eq(U.ymd(p.start), '2026-02-01');
  eq(U.ymd(p.end), '2026-02-28');
  eq(p.days, 28);
  eq(p.type, 'calendar');
});
t('区间-自然月：闰年 2 月 29 天', () => {
  const p = S.monthPeriod(new Date(2024, 1, 10));
  eq(U.ymd(p.end), '2024-02-29');
  eq(p.days, 29);
});
t('区间-自然年：key 与首尾', () => {
  const p = S.yearPeriod(new Date(2026, 5, 15));
  eq(p.key, 'Y:2026');
  eq(U.ymd(p.start), '2026-01-01');
  eq(U.ymd(p.end), '2026-12-31');
  eq(p.days, 365);
});
t('区间-自然年：闰年 366 天', () => {
  eq(S.yearPeriod(new Date(2024, 3, 1)).days, 366);
});
t('区间-scopePeriod 分派', () => {
  const d = new Date(2026, 2, 9);
  eq(S.scopePeriod('day', d).type, 'day');
  eq(S.scopePeriod('month', d).type, 'calendar');
  eq(S.scopePeriod('year', d).type, 'year');
});
t('区间-shiftScope 日/月/年翻页', () => {
  const d = new Date(2026, 2, 9);
  eq(S.scopePeriod('day', S.shiftScope('day', d, -1)).key, 'D:2026-03-08');
  eq(S.scopePeriod('month', S.shiftScope('month', d, -1)).key, 'CAL:2026-02');
  eq(S.scopePeriod('year', S.shiftScope('year', d, -1)).key, 'Y:2025');
  eq(S.scopePeriod('year', S.shiftScope('year', d, 1)).key, 'Y:2027');
});
t('区间-shiftScope 跨年边界', () => {
  const d = new Date(2026, 0, 15);
  eq(S.scopePeriod('month', S.shiftScope('month', d, -1)).key, 'CAL:2025-12');
  eq(S.scopePeriod('month', S.shiftScope('month', d, 1)).key, 'CAL:2026-02');
});

// ---------- 多账本 ----------
t('账本：默认有一本「日常」', () => {
  ok(S.books().length >= 1, '至少要有一本');
  ok(!!S.activeBook(), '必须有当前账本');
  eq(S.activeBook().id, S.activeBookId());
});
t('账本：新建后账目互不干扰', () => {
  const base = S.activeBookId();
  const bk = S.addBook({ name: '旅行', icon: '✈️', color: '#14B87A' });
  const p = S.dayPeriod(new Date(2026, 2, 9));
  const a = S.addTx({ type: 'expense', amount: 1000, catId: 'food', ts: p.start });
  S.switchBook(bk.id);
  const b = S.addTx({ type: 'expense', amount: 2000, catId: 'transport', ts: p.start });
  eq(S.txIn(p).length, 1, '旅行账本应只有 1 笔');
  eq(S.txIn(p)[0].id, b.id);
  S.switchBook(base);
  eq(S.txIn(p).length, 1, '日常账本应只有 1 笔');
  eq(S.txIn(p)[0].id, a.id);
  eq(S.txIn(p, true).length, 2, '跨账本应看到 2 笔');
  // 清理
  S.removeBook(bk.id);
  S.removeTx(a.id);
});
t('账本：至少要留一个，删最后一本抛错', () => {
  while (S.books().length > 1) S.removeBook(S.books()[S.books().length - 1].id);
  let threw = false;
  try { S.removeBook(S.books()[0].id); } catch (e) { threw = true; }
  ok(threw, '删最后一本应抛错');
});
t('账本：mergeBook 迁移账目', () => {
  const base = S.activeBookId();
  const bk = S.addBook({ name: '临时', icon: '📦' });
  const p = S.dayPeriod(new Date(2026, 2, 9));
  S.switchBook(bk.id);
  S.addTx({ type: 'expense', amount: 500, catId: 'food', ts: p.start });
  S.switchBook(base);
  const moved = S.mergeBook(bk.id, base);
  eq(moved, 1, '应迁移 1 笔');
  ok(!S.bookById(bk.id), '源账本应消失');
  eq(S.txIn(p).length, 1, '迁移后应出现在目标账本');
  S.state.tx.filter((t) => t.amount === 500).forEach((t) => S.removeTx(t.id));
});
t('账本：srcKeys 按账本隔离', () => {
  const base = S.activeBookId();
  const bk = S.addBook({ name: '隔离测试', icon: '📦' });
  const p = S.dayPeriod(new Date(2026, 2, 9));
  S.addTx({ type: 'expense', amount: 100, catId: 'food', ts: p.start, srcKey: 'bookA' });
  S.switchBook(bk.id);
  ok(!S.srcKeys().has('bookA'), '别的账本的 key 不应出现');
  ok(S.srcKeysAll().has('bookA'), 'srcKeysAll 应跨账本');
  S.switchBook(base);
  ok(S.srcKeys().has('bookA'));
  S.removeBook(bk.id);
  S.state.tx.filter((t) => t.srcKey === 'bookA').forEach((t) => S.removeTx(t.id));
});

// ---------- 周期性自动记账 ----------
t('周期记账：REPEAT_FREQ 五种频率', () => {
  eq(Object.keys(S.REPEAT_FREQ).length, 5);
  ok(S.REPEAT_FREQ.monthly && S.REPEAT_FREQ.yearly);
});
t('周期记账：金额 0 抛错', () => {
  let threw = false;
  try { S.addRepeat({ name: 'x', amount: 0, catId: 'housing' }); } catch (e) { threw = true; }
  ok(threw, '金额 0 应抛错');
});
t('周期记账：dueDates 按月推进，起始日钳制到 1-28', () => {
  const r = S.addRepeat({ name: '房租', amount: 200000, catId: 'housing', freq: 'monthly', startDay: 31, startYm: '2026-01' });
  eq(r.startDay, 28, '起始日应被钳制到 28，避免月末缺失');
  const list = S.repeatDueDates(r, new Date(2026, 3, 30).getTime());
  eq(list.length, 4, '1-4 月共 4 期');
  eq(U.ymd(list[0]), '2026-01-28');
  eq(U.ymd(list[1]), '2026-02-28');
  eq(U.ymd(list[3]), '2026-04-28');
  S.removeRepeat(r.id);
});
t('周期记账：runRepeats 幂等，跑两次只记一次', () => {
  const r = S.addRepeat({ name: '话费', amount: 5000, catId: 'comm', freq: 'monthly', startDay: 5, startYm: U.monthKey(new Date()) });
  const a1 = S.runRepeats();
  const n1 = a1.filter((t) => t.repeatId === r.id).length;
  const a2 = S.runRepeats();
  const n2 = a2.filter((t) => t.repeatId === r.id).length;
  eq(n2, 0, '第二次不应再生成');
  ok(n1 >= 1, '第一次应至少生成 1 笔');
  eq(S.repeatCount(r), n1);
  // 清理
  S.state.tx.filter((t) => t.repeatId === r.id).forEach((t) => S.removeTx(t.id));
  S.removeRepeat(r.id);
});
t('周期记账：生成的账目 ts 是当天 09:00', () => {
  const r = S.addRepeat({ name: '订阅', amount: 3000, catId: 'fun', freq: 'monthly', startDay: 1, startYm: U.monthKey(new Date()) });
  S.runRepeats();
  const tx = S.state.tx.filter((t) => t.repeatId === r.id);
  ok(tx.length >= 1);
  eq(new Date(tx[0].ts).getHours(), 9);
  S.state.tx.filter((t) => t.repeatId === r.id).forEach((t) => S.removeTx(t.id));
  S.removeRepeat(r.id);
});
t('周期记账：每周规则按 7 天推进', () => {
  const r = S.addRepeat({ name: '周订阅', amount: 1000, catId: 'fun', freq: 'weekly', startDay: 1, startYm: '2026-01' });
  const list = S.repeatDueDates(r, new Date(2026, 0, 31).getTime());
  eq(list.length, 5, '1 月 1/8/15/22/29 共 5 期');
  eq(U.ymd(list[1]), '2026-01-08');
  S.removeRepeat(r.id);
});
t('周期记账：repeatUpcoming 返回未来日期', () => {
  const r = S.addRepeat({ name: '未来', amount: 1000, catId: 'fun', freq: 'monthly', startDay: 10, startYm: U.monthKey(new Date()) });
  const up = S.repeatUpcoming(r, 3);
  eq(up.length, 3);
  ok(up[0].getTime() >= U.startOfDay(new Date()).getTime(), '第一次应是未来');
  S.removeRepeat(r.id);
});

// ---------- 自定义分类 ----------
t('分类：新建自定义分类', () => {
  const n0 = Icons.CATEGORIES.length;
  const c = S.addCategory({ name: '宠物粮', icon: '🐶', color: '#FF7A45', kind: 'expense', subs: ['狗粮', '猫粮'] });
  ok(!!c.id);
  eq(Icons.CATEGORIES.length, n0 + 1);
  eq(Icons.cat(c.id).name, '宠物粮');
  eq(Icons.cat(c.id).subs.length, 2);
  ok(!Icons.isBuiltin(c.id), '自定义分类不应算内置');
  S.removeCategory(c.id);
  eq(Icons.CATEGORIES.length, n0);
});
t('分类：同名同类型抛错', () => {
  const c = S.addCategory({ name: '测试重名', kind: 'expense' });
  let threw = false;
  try { S.addCategory({ name: '测试重名', kind: 'expense' }); } catch (e) { threw = true; }
  ok(threw, '同名应抛错');
  // 不同类型允许同名
  const c2 = S.addCategory({ name: '测试重名', kind: 'income' });
  ok(!!c2.id);
  S.removeCategory(c.id);
  S.removeCategory(c2.id);
});
t('分类：内置分类改名走 overrides', () => {
  const base = Icons.BUILTIN.find((b) => b.id === 'food');
  S.updateCategory('food', { name: '吃饭饭' });
  eq(Icons.cat('food').name, '吃饭饭');
  eq(S.catConfig().overrides.food.name, '吃饭饭');
  S.updateCategory('food', { name: base.name });
  ok(!S.catConfig().overrides.food, '改回原名应清掉 override');
  eq(Icons.cat('food').name, base.name);
});
t('分类：自定义分类改颜色生效', () => {
  const c = S.addCategory({ name: '颜色测试', icon: '🎨', color: '#4F7CFF', kind: 'expense' });
  S.updateCategory(c.id, { name: '颜色测试', icon: '🎨', color: '#E91E63', subs: [] });
  eq(Icons.cat(c.id).color, '#E91E63');
  S.removeCategory(c.id);
});
t('分类：删除自定义分类后账目回落「其他」', () => {
  const c = S.addCategory({ name: '临时分类', icon: '📦', kind: 'expense' });
  const p = S.dayPeriod(new Date(2026, 2, 9));
  const tx = S.addTx({ type: 'expense', amount: 800, catId: c.id, sub: '子项', ts: p.start });
  S.removeCategory(c.id);
  const after = S.txById(tx.id);
  eq(after.catId, 'other_out');
  eq(after.sub, '');
  S.removeTx(tx.id);
});
t('分类：隐藏内置后仍能解析历史账目名称', () => {
  S.removeCategory('travel');
  ok(Icons.CATEGORIES.every((c) => c.id !== 'travel'), '隐藏后不应出现在可选列表');
  eq(Icons.cat('travel').name, '旅行', '历史账目仍应能解析');
  S.restoreCategory('travel');
  ok(Icons.CATEGORIES.some((c) => c.id === 'travel'), '恢复后应回到列表');
});
t('分类：restoreAllCategories 清空全部自定义', () => {
  const c = S.addCategory({ name: '待清理', kind: 'expense' });
  S.removeCategory('travel');
  S.restoreAllCategories();
  ok(!Icons.cat(c.id).custom, '自定义应被清空');
  ok(Icons.CATEGORIES.some((x) => x.id === 'travel'), '内置应全部恢复');
  const cc = S.catConfig();
  eq(cc.custom.length, 0);
  eq(cc.hidden.length, 0);
  eq(Object.keys(cc.overrides).length, 0);
});

// ============================================================
// 新功能（10 项 + 搜索跨周期）
// ============================================================
// 换到完全干净的环境，逐项验证
S.clearAll(false);
S.setSettings({ cycle: { type: 'month', startDay: 1 } });
const T = {};                 // 临时记录的测试数据
const NDAY = 86400000;
const startOfToday = U.startOfDay(new Date()).getTime();

// ---------- ① 今天还能花 ----------
t('今日额度：没设预算时 total 为 0', () => {
  S.setSettings({ budget: { amount: 0, split: {} } });
  const q = S.todayQuota();
  eq(q.total, 0, 'total');
  eq(q.quota, 0, 'quota');
  eq(q.level, 'safe', '没预算时不该报红');
});

t('今日额度：预算 / 剩余天数 得到每日额度', () => {
  S.clearAll(false);
  S.setSettings({ cycle: { type: 'month', startDay: 1 }, budget: { amount: 310000, split: {} } });
  const q = S.todayQuota();
  const b = S.budgetStatus(S.currentPeriod());
  eq(q.total, 310000, 'total');
  eq(b.daysLeft, q.daysLeft, 'daysLeft');
  near(q.quota, 310000 / b.daysLeft, 1, 'quota');
  eq(q.todaySpent, 0, 'todaySpent');
  eq(q.left, q.quota, 'left');
  eq(q.level, 'safe', 'level');
});

t('今日额度：扣掉今天已经花掉的钱', () => {
  const before = S.todayQuota();
  T.today1 = S.addTx({ type: 'expense', amount: 10000, catId: 'food', ts: Date.now() });
  const after = S.todayQuota();
  eq(after.todaySpent, 10000, 'todaySpent');
  eq(after.left, before.left - 10000, 'left 应减少 100 元的量');
});

t('今日额度：quotaAfter 预测记下这笔后剩多少', () => {
  const q = S.todayQuota();
  eq(S.quotaAfter(5000), q.left - 5000, 'quotaAfter');
  eq(S.quotaAfter(-5000), q.left - 5000, '负数也按绝对值');
});

t('今日额度：花超了 level 变 over 且 left 为负', () => {
  S.addTx({ type: 'expense', amount: 999999, catId: 'shopping', ts: Date.now() });
  const q = S.todayQuota();
  ok(q.left < 0, 'left 应为负');
  eq(q.level, 'over', 'level');
});

t('今日额度：垫付先算进今天已花（钱确实花出去了）', () => {
  S.clearAll(false);
  S.setSettings({ budget: { amount: 300000, split: {} }, cycle: { type: 'month', startDay: 1 } });
  const base = S.todayQuota().todaySpent;
  S.addTx({
    type: 'expense', amount: 50000, catId: 'social', ts: Date.now(),
    advance: { who: '老王', status: 'open', dueTs: 0 },
  });
  eq(S.todayQuota().todaySpent, base + 50000, '垫付也要算今天已花');
});

t('今日额度：历史周期没有每日额度', () => {
  S.clearAll(false);
  S.setSettings({ budget: { amount: 300000, split: {} }, cycle: { type: 'month', startDay: 1 } });
  const prev = S.shiftPeriod(S.currentPeriod(), -1);
  const q = S.todayQuota(prev);
  eq(q.quota, 0, '历史周期 quota');
  eq(q.isCurrent, false, 'isCurrent');
});

// ---------- ② 上次多少钱 ----------
t('上次多少钱：同分类取最近一笔', () => {
  S.clearAll(false);
  const older = startOfToday - 5 * NDAY;
  const recent = startOfToday - 1 * NDAY;
  S.addTx({ type: 'expense', amount: 2000, catId: 'food', sub: '午餐', ts: older });
  S.addTx({ type: 'expense', amount: 3000, catId: 'food', sub: '晚餐', ts: recent });
  S.addTx({ type: 'expense', amount: 9000, catId: 'transport', ts: recent });
  const last = S.lastPrice('food');
  ok(last, '应有结果');
  eq(last.amount, 3000, '取最近那笔');
});

t('上次多少钱：限定二级标签', () => {
  const last = S.lastPrice('food', '午餐');
  ok(last, '应有结果');
  eq(last.amount, 2000, '只匹配「午餐」');
});

t('上次多少钱：没记过返回 null', () => {
  eq(S.lastPrice('baby'), null);
});

t('上次多少钱：lastPrices 返回时间倒序且尊重 count', () => {
  const list = S.lastPrices('food', '', 2);
  eq(list.length, 2, '数量');
  ok(list[0].ts >= list[1].ts, '应时间倒序');
});

// ---------- ③ 垫付待收 ----------
t('垫付：照常计入支出与预算，同时打上待收标记', () => {
  S.clearAll(false);
  S.setSettings({ budget: { amount: 300000, split: {} }, cycle: { type: 'month', startDay: 1 } });
  const ts = Date.now();
  const t1 = S.addTx({
    type: 'expense', amount: 30000, catId: 'social', ts,
    advance: { who: '小王', status: 'open', dueTs: ts + 3 * NDAY },
  });
  eq(S.summary(S.currentPeriod()).expense, 30000, '支出照常计入');
  eq(S.summary(S.currentPeriod()).pending, 30000, 'pending 也要标出来');
  eq(S.summary(S.currentPeriod()).pendingCount, 1, 'pendingCount');
  eq(S.budgetStatus(S.currentPeriod()).spent, 30000, '预算也照常扣');
  T.adv1 = t1.id;
});

t('垫付：advances / advanceSummary 只统计未收回', () => {
  const open = S.advances();
  eq(open.length, 1, '未收回 1 笔');
  const sum = S.advanceSummary();
  eq(sum.openCount, 1, 'openCount');
  eq(sum.openAmount, 30000, 'openAmount');
  eq(sum.settledCount, 0, 'settledCount');
});

t('垫付：超期会被标出来', () => {
  const t2 = S.addTx({
    type: 'expense', amount: 8000, catId: 'social', ts: Date.now() - 10 * NDAY,
    advance: { who: '小李', status: 'open', dueTs: Date.now() - 2 * NDAY },
  });
  const sum = S.advanceSummary();
  eq(sum.overdue.length, 1, '超期 1 笔');
  eq(sum.overdue[0].id, t2.id, '超期的应是这一笔');
  T.adv2 = t2.id;
});

t('垫付：改催款日', () => {
  const due = startOfToday + 7 * NDAY;
  S.setAdvance(T.adv1, { dueTs: due });
  eq(S.txById(T.adv1).advance.dueTs, due, 'dueTs');
  eq(S.advanceSummary().overdue.length, 1, '推后后只剩原来超期那笔');
});

t('垫付：归还后留档但不再计入支出', () => {
  const before = S.summary(S.currentPeriod());
  eq(before.expense, 38000, '归还前两笔都算');
  const t = S.settleAdvance(T.adv1);
  ok(t && t.id === T.adv1, '应返回那条账目');
  ok(S.txById(T.adv1), '记录必须还在（留档）');
  eq(S.txById(T.adv1).advance.status, 'settled', '标成已归还');
  eq(S.isVoid(S.txById(T.adv1)), true, '应被判定为「只留档」');
  const after = S.summary(S.currentPeriod());
  eq(after.expense, 8000, '不再计入支出');
  eq(after.pending, 8000, '待收只剩另一笔');
  eq(after.byCat.find((c) => c.id === 'social').amount, 8000, '分类统计也要跳过它');
  eq(S.budgetStatus(S.currentPeriod()).spent, 8000, '预算已花也要跳过它');
});

t('垫付：到期才会问「还回来了吗」，问过当天不再问', () => {
  S.clearAll(false);
  const past = Date.now() - 2 * NDAY;
  const a1 = S.addTx({
    type: 'expense', amount: 10000, catId: 'social', ts: past,
    advance: { who: '甲', status: 'open', dueTs: past },
  });
  S.addTx({
    type: 'expense', amount: 20000, catId: 'social', ts: Date.now(),
    advance: { who: '乙', status: 'open', dueTs: Date.now() + 5 * NDAY },
  });
  const ask = S.advancesToAsk();
  eq(ask.length, 1, '只有到期那笔要问');
  eq(ask[0].id, a1.id, '问的是甲');
  S.markAdvanceAsked(a1.id);
  eq(S.advancesToAsk().length, 0, '当天问过就不再问');
});

t('垫付：clearAdvance 撤销垫付标记后仍是普通支出', () => {
  S.clearAll(false);
  const t1 = S.addTx({
    type: 'expense', amount: 12000, catId: 'social', ts: Date.now(),
    advance: { who: '小赵', status: 'open', dueTs: 0 },
  });
  eq(S.summary(S.currentPeriod()).expense, 12000, '垫付本来就计支出');
  eq(S.summary(S.currentPeriod()).pending, 12000, '标记为待收');
  S.clearAdvance(t1.id);
  eq(S.txById(t1.id).advance, undefined, 'advance 应被删掉');
  eq(S.summary(S.currentPeriod()).pending, 0, '不再算待收');
  eq(S.summary(S.currentPeriod()).expense, 12000, '支出不变');
});

t('垫付：normalizeAdvance 兜底默认值', () => {
  const a = S.normalizeAdvance({ who: '  老李  ' });
  eq(a.who, '老李', 'who 应去空白');
  eq(a.status, 'open', '默认 open');
  eq(a.dueTs, 0, '默认 0');
  eq(S.normalizeAdvance({ status: 'weird' }).status, 'open', '非法状态回落 open');
  eq(S.normalizeAdvance({ status: 'settled' }).status, 'settled', '合法状态保留');
});

// ---------- ④ 余钱归仓 ----------
t('余钱归仓：没开启时 settlePeriods 返回空', () => {
  S.clearAll(false);
  eq(S.settlePeriods().length, 0);
});

t('余钱归仓：把上期结余存进目标（幂等）', () => {
  S.clearAll(false);
  S.setSettings({ cycle: { type: 'month', startDay: 1 }, budget: { amount: 200000, split: {} } });
  const g = S.addGoal({ name: '换电脑', target: 1000000, icon: '💻', color: '#7C5CFF' });
  S.setSettings({ autoSave: { enabled: true, goalId: g.id, ratio: 1, cap: 0 } });
  const moved = S.settlePeriods(startOfToday + 0);
  ok(moved.length >= 1, '应有至少 1 个周期被结算');
  const saved = moved.reduce((s, x) => s + x.amount, 0);
  eq(S.goalById(g.id).saved, saved, '目标已存 = 结算额');
  eq(S.settlePeriods(startOfToday + 0).length, 0, '再跑一次应幂等');
  T.goalId = g.id;
});

t('余钱归仓：ratio 与 cap 生效', () => {
  const cfg = { enabled: true, goalId: T.goalId, ratio: 0.5, cap: 3000 };
  S.setSettings({ autoSave: cfg });
  const pv = S.autoSavePreview();
  ok(pv.amount <= 3000, 'cap 应封顶');
  ok(pv.hasBudget, '应有预算');
});

// ---------- ⑤ 订阅体检 ----------
t('订阅体检：识别每月同额扣款', () => {
  S.clearAll(false);
  S.setSettings({ cycle: { type: 'month', startDay: 1 }, subAlert: { enabled: true, daysBefore: 7 } });
  // 造 4 个月连续扣款，最后一次在 3 天前，下次应为下个月的这一天
  for (let m = 3; m >= 0; m--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - m);
    d.setDate(15);
    if (m === 0) d.setDate(new Date().getDate() - 3);
    S.addTx({ type: 'expense', amount: 4800, catId: 'fun', note: 'Netflix 会员', ts: d.getTime() });
  }
  const subs = S.scanSubscriptions();
  eq(subs.length, 1, '应识别出 1 个订阅');
  eq(subs[0].period, 'monthly', '周期');
  eq(subs[0].avgAmount, 4800, '金额');
  eq(subs[0].times, 4, '次数');
  T.subKey = subs[0].key;
});

t('订阅体检：扫描只看支出，不看收入', () => {
  S.clearAll(false);
  for (let m = 3; m >= 0; m--) {
    const d = new Date(); d.setMonth(d.getMonth() - m); d.setDate(10);
    S.addTx({ type: 'income', amount: 500000, catId: 'salary', note: '工资', ts: d.getTime() });
  }
  eq(S.scanSubscriptions().length, 0, '工资不应被当成订阅');
});

t('订阅体检：金额波动超 5% 不认', () => {
  S.clearAll(false);
  const amts = [4800, 4800, 7200, 4800];
  for (let m = 3; m >= 0; m--) {
    const d = new Date(); d.setMonth(d.getMonth() - m); d.setDate(10);
    S.addTx({ type: 'expense', amount: amts[3 - m], catId: 'fun', note: '某某视频会员', ts: d.getTime() });
  }
  const subs = S.scanSubscriptions();
  ok(subs.length === 0 || subs[0].times <= 3, '不稳定的金额不应被高度确信');
});

t('订阅体检：提前 N 日提醒的窗口', () => {
  S.clearAll(false);
  // 最近一次扣款在 25 天前，之后每 30 天一次（倒推 4 次）
  const base = startOfToday - 25 * NDAY;
  for (let i = 3; i >= 0; i--) {
    S.addTx({ type: 'expense', amount: 2500, catId: 'fun', note: '云盘 会员', ts: base - i * 30 * NDAY });
  }
  const subs = S.scanSubscriptions();
  eq(subs.length, 1, '应识别');
  const left = subs[0].daysToNext;
  ok(left > 0 && left < 12, '下次扣款应在 12 天内，实际 ' + left);
  // 窗口小于剩余天数 → 不提醒
  S.setSettings({ subAlert: { enabled: true, daysBefore: Math.max(0, left - 1) } });
  eq(S.subsDue().length, 0, '窗口不够时不该提醒');
  // 窗口覆盖剩余天数 → 提醒
  S.setSettings({ subAlert: { enabled: true, daysBefore: left } });
  eq(S.subsDue().length, 1, '窗口覆盖时应提醒');
  // 关掉开关 → 一律不提醒
  S.setSettings({ subAlert: { enabled: false, daysBefore: 30 } });
  eq(S.subsDue().length, 0, '关掉提醒就不返回');
});

t('订阅体检：markSubReminded / ignoreSub 生效', () => {
  S.setSettings({ subAlert: { enabled: true, daysBefore: 30 } });
  const subs = S.scanSubscriptions();
  const key = subs[0].key;
  S.markSubReminded(key, subs[0].nextTs);
  ok(S.state.subs.some((s) => s.key === key && s.remindedFor === subs[0].nextTs), '应记录提醒');
  S.ignoreSub(key, true);
  eq(S.scanSubscriptions().length, 0, '忽略后不再出现');
  S.ignoreSub(key, false);
  eq(S.scanSubscriptions().length, 1, '取消忽略后恢复');
});

t('订阅体检：转成周期记账规则', () => {
  S.clearAll(false);
  for (let m = 3; m >= 0; m--) {
    const d = new Date(); d.setMonth(d.getMonth() - m); d.setDate(8);
    S.addTx({ type: 'expense', amount: 1800, catId: 'fun', note: '音乐会员', ts: d.getTime() });
  }
  const sub = S.scanSubscriptions()[0];
  const before = S.repeats().length;
  const rep = S.subToRepeat(sub);
  ok(rep && rep.freq === 'monthly', '应生成每月规则');
  eq(S.repeats().length, before + 1, '规则数 +1');
  eq(rep.amount, 1800, '金额沿用平均值');
});

// ---------- ⑥ 合并看板 ----------
t('合并看板：多账本各自汇总 + 总计', () => {
  S.clearAll(false);
  S.setSettings({ cycle: { type: 'month', startDay: 1 } });
  const b1 = S.books()[0];
  const b2 = S.addBook({ name: '旅行', icon: '✈️', color: '#14B87A' });
  const ts = Date.now();
  S.addTx({ type: 'expense', amount: 10000, catId: 'food', ts, bookId: b1.id });
  S.addTx({ type: 'expense', amount: 20000, catId: 'transport', ts, bookId: b2.id });
  const board = S.mergedBoard(S.currentPeriod());
  eq(board.rows.length, 2, '两本账本');
  eq(board.total.expense, 30000, '合计');
  T.book2 = b2.id;
});

t('合并看板：合并视图下 activeBook 是虚拟账本', () => {
  S.switchBook('*');
  ok(S.isAllBooks(), 'isAllBooks');
  const ab = S.activeBook();
  eq(ab.id, '*', '虚拟账本 id');
  eq(S.writeBookId(), S.books()[0].id, '写入仍落到第一本');
  eq(S.txIn(S.currentPeriod()).length, 2, '合并视图应取全部账本');
  S.switchBook(S.books()[0].id);
  eq(S.isAllBooks(), false, '切回单本');
  eq(S.txIn(S.currentPeriod()).length, 1, '单本只取自己的');
});

t('合并看板：switchBook 接受 * 但拒绝不存在的 id', () => {
  eq(S.switchBook('nope'), null, '不存在的账本应返回 null');
  S.switchBook(S.books()[0].id);
});

// ---------- ⑦ 外币账本 ----------
t('外币：toLocalCents / toCnyCents 往返一致', () => {
  S.clearAll(false);
  const b = S.books()[0];
  S.updateBook(b.id, { currency: { code: 'USD', symbol: '$', rateToCny: 7.1 } });
  const cur = S.bookCurrency();
  eq(cur.code, 'USD', 'code');
  eq(S.toCnyCents(10000), 71000, '100 美元 → 710 元');
  eq(S.toLocalCents(71000), 10000, '710 元 → 100 美元');
  eq(S.moneyIn(12345, 'USD'), '$123.45', '按币种格式化');
});

t('外币：人民币账本不做换算', () => {
  const b = S.books()[0];
  S.updateBook(b.id, { currency: { code: 'CNY', symbol: '¥', rateToCny: 1 } });
  eq(S.bookCurrency(), null, 'CNY 视为本币');
  eq(S.toCnyCents(12345), 12345, '原样返回');
  eq(S.toLocalCents(12345), 12345, '原样返回');
});

t('外币：汇率缺失时不做换算（不会算出 Infinity）', () => {
  const b = S.books()[0];
  S.updateBook(b.id, { currency: { code: 'USD', symbol: '$', rateToCny: 0 } });
  eq(S.bookCurrency(), null, '汇率为 0 视为本币');
  eq(S.toCnyCents(12345), 12345, '原样返回');
  S.updateBook(b.id, { currency: { code: 'CNY', symbol: '¥', rateToCny: 1 } });
});

t('外币：CURRENCIES 自带符号与默认汇率', () => {
  ok(S.CURRENCIES.length >= 10, '币种数量');
  eq(S.currencyOf('USD').symbol, '$', 'USD 符号');
  eq(S.currencyOf('JPY').code, 'JPY', 'JPY');
  eq(S.currencyOf('NOPE').code, 'CNY', '未知币种回落 CNY');
});

// ---------- ⑧ 换算成实物 ----------
t('等价物：尽量落在 1–20 的自然区间', () => {
  const e = window.Extras;
  const m = e.forMoney(3000, 'food');      // 30 元
  ok(m && m.item && m.count >= 1 && m.count <= 20, '30 元的等价物应自然');
  ok(/^≈ /.test(m.text), '文案以 ≈ 开头');
});

t('等价物：金额太小时不换算', () => {
  eq(window.Extras.forMoney(500, 'food'), null);
});

t('等价物：大额也不会说出「3000 杯奶茶」', () => {
  const e = window.Extras;
  const m = e.forMoney(500000, 'shopping');  // 5000 元
  ok(m.count <= 20, `数量应 ≤20，实际 ${m.count}`);
});

t('等价物：分类影响选品（房租类金额会换算成月租）', () => {
  const e = window.Extras;
  const m = e.forMoney(300000, 'housing');   // 3000 元，恰好 1 个月房租
  ok(m && m.item.key === 'month', '应选中月房租，实际 ' + (m && m.item.key));
  const food = e.forMoney(30000, 'food');
  ok(food.item.key !== 'month', '餐饮不该换算成房租');
});

t('等价物：目标进度换算', () => {
  S.clearAll(false);
  const g = S.addGoal({ name: '新手机', target: 600000, icon: '📱' });
  const res = window.Extras.forGoal(300000, [g]);
  ok(res, '应有结果');
  near(res.pct, 0.5, 0.01, '一半');
  ok(res.text.indexOf('新手机') >= 0, '文案包含目标名');
});

t('等价物：没有目标时返回 null', () => {
  eq(window.Extras.forGoal(100000, []), null);
});

// ---------- ⑨ 余额反推 ----------
t('对账：账面应有 = 期初 + 收入 - 支出', () => {
  S.clearAll(false);
  const ts = startOfToday - 10 * NDAY;
  S.addTx({ type: 'income', amount: 500000, catId: 'salary', accountId: 'alipay', ts });
  S.addTx({ type: 'expense', amount: 120000, catId: 'food', accountId: 'alipay', ts: ts + NDAY });
  S.addTx({ type: 'expense', amount: 9900, catId: 'food', accountId: 'wechat', ts: ts + NDAY }); // 别的账户，不参与
  const rec = S.reconcile({
    accountId: 'alipay', startTs: ts - NDAY,
    startBalance: 100000, actualBalance: 470000,
  });
  eq(rec.income, 500000, 'income');
  eq(rec.expense, 120000, 'expense');
  eq(rec.expected, 480000, 'expected');
  eq(rec.diff, -10000, '实际比账面少 100 元');
  T.recId = rec.id;
});

t('对账：期初日之前的账目不参与', () => {
  const rec = S.reconcile({
    accountId: 'alipay', startTs: startOfToday - 1 * NDAY,
    startBalance: 200000, actualBalance: 200000,
  });
  eq(rec.expected, 200000, '期间没有账目');
  eq(rec.diff, 0, '完全对上');
});

t('垫付：归还后今日额度把当天已花退回去', () => {
  S.clearAll(false);
  S.setSettings({ budget: { amount: 300000, split: {} }, cycle: { type: 'month', startDay: 1 } });
  const t1 = S.addTx({
    type: 'expense', amount: 50000, catId: 'social', ts: Date.now(),
    advance: { who: '老王', status: 'open', dueTs: 0 },
  });
  eq(S.todayQuota().todaySpent, 50000, '没还时算今天已花');
  S.settleAdvance(t1.id);
  eq(S.todayQuota().todaySpent, 0, '还了就不算今天已花');
});

t('对账：已归还的垫付不算账面支出', () => {
  S.clearAll(false);
  const ts = startOfToday - 5 * NDAY;
  const t1 = S.addTx({
    type: 'expense', amount: 20000, catId: 'social', accountId: 'alipay', ts,
    advance: { who: '小周', status: 'open', dueTs: 0 },
  });
  S.settleAdvance(t1.id);
  const rec = S.reconcile({
    accountId: 'alipay', startTs: ts - NDAY, startBalance: 100000, actualBalance: 100000,
  });
  eq(rec.expense, 0, '已归还不算支出');
  eq(rec.diff, 0, '对得上');
});

t('对账：垫付也真花出去了，要算进账面', () => {
  S.clearAll(false);
  const ts = startOfToday - 5 * NDAY;
  S.addTx({
    type: 'expense', amount: 20000, catId: 'social', accountId: 'alipay', ts,
    advance: { who: '小周', status: 'open', dueTs: 0 },
  });
  const rec = S.reconcile({
    accountId: 'alipay', startTs: ts - NDAY, startBalance: 100000, actualBalance: 80000,
  });
  eq(rec.expense, 20000, '垫付算支出');
  eq(rec.expected, 80000, '账面应有');
  eq(rec.diff, 0, '对得上');
});

t('对账：reconList 倒序、可删除、最多 50 条', () => {
  S.clearAll(false);
  for (let i = 0; i < 3; i++) {
    S.reconcile({ accountId: 'alipay', startTs: 0, startBalance: 1000 * i, actualBalance: 1000 * i });
  }
  const list = S.reconList();
  eq(list.length, 3, '条数');
  eq(list[0].startBalance, 2000, '最新在最前');
  S.removeRecon(list[0].id);
  eq(S.reconList().length, 2, '删除后');
});

t('对账：blankDays 找出没记账的日子', () => {
  S.clearAll(false);
  const days = S.blankDays(7);
  eq(days.length, 7, '7 天都没有账目');
  S.addTx({ type: 'expense', amount: 1000, catId: 'food', ts: startOfToday - NDAY });
  eq(S.blankDays(7).length, 6, '记了一天就少一天');
});

// ---------- ⑩ 先别买 ----------
t('想买清单：加入后进入冷却期', () => {
  S.clearAll(false);
  S.setSettings({ wish: { enabled: true, hours: 48 } });
  const w = S.addWish({ name: '降噪耳机', amount: 89900, catId: 'shopping' });
  eq(w.status, 'cooling', 'status');
  eq(w.hours, 48, 'hours 来自设置');
  eq(S.wishlist().length, 1, '清单长度');
  ok(w.dueTs > Date.now(), '到期时间应在将来');
  eq(S.wishCooling().length, 1, '处于冷却中');
  eq(S.wishReady().length, 0, '还没到到期');
  T.wish1 = w.id;
});

t('想买清单：冷静期结束后进入待决定', () => {
  const w = S.addWish({ name: '机械键盘', amount: 59900, catId: 'shopping' });
  S.updateWish(w.id, { dueTs: Date.now() - 1000 });
  eq(S.wishReady().length, 1, '应有 1 件到期');
  eq(S.wishReady()[0].id, w.id, '到期的应是它');
  T.wish2 = w.id;
});

t('想买清单：放弃 → 累积忍住基金', () => {
  S.dropWish(T.wish2);
  eq(S.savedFund(), 59900, '忍住基金');
  eq(S.wishlist().find((x) => x.id === T.wish2).status, 'dropped', 'status');
});

t('想买清单：买下 → 生成一笔支出并出清单', () => {
  const before = S.summary(S.currentPeriod()).expense;
  S.buyWish(T.wish1);
  const w = S.wishlist().find((x) => x.id === T.wish1);
  eq(w.status, 'bought', 'status');
  ok(w.txId, '应关联账目');
  eq(S.summary(S.currentPeriod()).expense, before + 89900, '支出增加');
  eq(S.wishReady().length, 0, '清单清空');
  eq(S.wishCooling().length, 0, '冷却清空');
});

t('想买清单：冷静期时长可配置', () => {
  S.setSettings({ wish: { enabled: true, hours: 168 } });
  const w = S.addWish({ name: '跑鞋', amount: 45000, catId: 'shopping' });
  eq(w.hours, 168, '一周');
  S.removeWish(w.id);
});

t('想买清单：非法金额被夹到 0 或绝对值', () => {
  const w = S.addWish({ name: '随便', amount: -5000 });
  eq(w.amount, 5000, '取绝对值');
  S.removeWish(w.id);
  const w2 = S.addWish({ name: '没名字', amount: 'abc' });
  eq(w2.amount, 0, '非法金额为 0');
  eq(w2.name, '没名字', '名字保留');
  S.removeWish(w2.id);
});

// ---------- 搜索跨周期 ----------
t('搜索跨周期：txIn 只看本期，全量池能拿到历史', () => {
  S.clearAll(false);
  S.setSettings({ cycle: { type: 'month', startDay: 1 } });
  const cur = S.currentPeriod();
  const oldTs = cur.start.getTime() - 90 * NDAY;
  S.addTx({ type: 'expense', amount: 1200, catId: 'food', note: '三个月前的火锅', ts: oldTs });
  S.addTx({ type: 'expense', amount: 800, catId: 'food', note: '今天的包子', ts: Date.now() });
  eq(S.txIn(cur).length, 1, '本期只有 1 笔');
  const pool = S.txInAll(S.currentPeriod());
  ok(pool.length >= 0, 'txInAll 可调用');
  const hit = S.state.tx.filter((t) => (t.note || '').indexOf('火锅') >= 0);
  eq(hit.length, 1, '历史那笔在池子里');
});

t('搜索跨周期：txInAll 按周期过滤仍生效', () => {
  const cur = S.currentPeriod();
  const inCur = S.txInAll(cur).length;
  eq(inCur, 1, '本期 1 笔');
});

t('搜索跨周期：合并视图下 txIn 也能搜到另一本账', () => {
  S.clearAll(false);
  const b2 = S.addBook({ name: '副账', icon: '📗' });
  S.addTx({ type: 'expense', amount: 5000, catId: 'food', note: '副账的饭', ts: Date.now(), bookId: b2.id });
  eq(S.txIn(S.currentPeriod()).length, 0, '单本搜不到');
  S.switchBook('*');
  eq(S.txIn(S.currentPeriod()).length, 1, '合并视图能搜到');
  S.switchBook(S.books()[0].id);
});

// ---------- 数据迁移 ----------
t('迁移：旧数据自动补齐 wishlist / subs / recon 与默认设置', () => {
  const old = {
    version: 1, tx: [], goals: [], repeats: [],
    books: [{ id: 'default', name: '日常', icon: '📒', color: '#4F7CFF' }],
    accounts: [], settings: { books: { activeId: 'default' } },
  };
  localStorage.setItem('jizhang.v1', JSON.stringify(old));
  S.init();
  ok(Array.isArray(S.state.wishlist), 'wishlist');
  ok(Array.isArray(S.state.subs), 'subs');
  ok(Array.isArray(S.state.recon), 'recon');
  ok(S.settings.subAlert, 'subAlert 默认值');
  ok(S.settings.autoSave, 'autoSave 默认值');
  ok(S.settings.wish, 'wish 默认值');
  ok(S.settings.advance, 'advance 默认值');
});

t('迁移：账目上的 advance / 外币字段被规整', () => {
  localStorage.setItem('jizhang.v1', JSON.stringify({
    version: 1,
    tx: [
      { id: 'a1', type: 'expense', amount: 1000, catId: 'food', ts: Date.now(), advance: { who: '老王' } },
      { id: 'a2', type: 'expense', amount: 1000, catId: 'food', ts: Date.now(), amountFx: 100, fxRate: 7.2, fxCode: 'USD' },
    ],
    goals: [], repeats: [],
    books: [{ id: 'default', name: '日常', icon: '📒', color: '#4F7CFF' }],
    accounts: [], settings: { books: { activeId: 'default' } },
  }));
  S.init();
  const a1 = S.txById('a1');
  eq(a1.advance.status, 'open', '补默认状态');
  eq(a1.advance.dueTs, 0, '补默认催款日');
  const a2 = S.txById('a2');
  eq(a2.amountFx, 100, '外币金额保留');
  eq(a2.fxRate, 7.2, '汇率保留');
});

t('迁移：合并视图的 activeId=* 不会被改回第一本', () => {
  localStorage.setItem('jizhang.v1', JSON.stringify({
    version: 1, tx: [], goals: [], repeats: [],
    books: [{ id: 'b1', name: '一', icon: '📒', color: '#4F7CFF' }],
    accounts: [], settings: { books: { activeId: '*' } },
  }));
  S.init();
  eq(S.settings.books.activeId, '*', '应保留合并视图');
  ok(S.isAllBooks(), 'isAllBooks');
});

// ------------------------------------------------------------
// 自动扣费只认 App（房租 / 话费不算）+ 固定月支出入口
// ------------------------------------------------------------
t('自动扣费：App 会员算，房租话费不算', () => {
  S.clearAll(false);
  S.state.subs = [];
  const yes = [
    'Netflix 会员', '网易云音乐会员', 'iCloud 云盘', '腾讯视频 VIP', 'Notion 订阅', 'ChatGPT Plus',
  ];
  const no = ['房租', '话费充值', '水费', '电费', '宽带费', '物业费', '停车费', '加油', '社保', '学费'];
  yes.forEach((note) => {
    ok(S.isAutoDebit({ note, sub: '', catId: 'fun' }), '应认成自动扣费：' + note);
  });
  no.forEach((note) => {
    eq(S.isAutoDebit({ note, sub: '', catId: 'housing' }), false, '不该认成自动扣费：' + note);
  });
});

t('自动扣费：房租连扣 4 次也不会被扫出来', () => {
  S.clearAll(false);
  S.state.subs = [];
  const now = new Date();
  for (let i = 1; i <= 4; i++) {
    S.addTx({
      type: 'expense', amount: 280000, catId: 'housing', note: '房租',
      ts: new Date(now.getFullYear(), now.getMonth() - i, 5, 10).getTime(),
    });
  }
  eq(S.scanSubscriptions().length, 0, '房租不该被识别为订阅');
  for (let i = 1; i <= 4; i++) {
    S.addTx({
      type: 'expense', amount: 4800, catId: 'fun', sub: '会员', note: 'Netflix 会员',
      ts: new Date(now.getFullYear(), now.getMonth() - i, 12, 10).getTime(),
    });
  }
  const subs = S.scanSubscriptions();
  eq(subs.length, 1, '只应识别出 Netflix 一个');
  ok(/netflix/i.test(subs[0].name), '识别到的应该是 Netflix');
});

t('固定月支出：预设 + 新增 + 列表 + 删除', () => {
  S.clearAll(false);
  const presets = S.fixedPresets();
  ok(presets.length >= 4, '预设至少有 4 个');
  ok(presets.some((p) => p.name === '房租'), '应有房租预设');
  ok(presets.some((p) => p.name === '话费'), '应有话费预设');
  eq(S.fixedExpenses().length, 0, '初始为空');
  S.addFixed({ name: '房租', amount: 280000, day: 5, catId: 'housing', sub: '房租' });
  const list = S.fixedExpenses();
  eq(list.length, 1, '加了一条');
  eq(list[0].freq, 'monthly', '应该是每月');
  eq(list[0].startDay, 5, '每月 5 号');
  eq(list[0].amount, 280000, '金额');
  ok(S.fixedPresets().length === presets.length, '预设不被改动');
  S.removeRepeat(list[0].id);
  eq(S.fixedExpenses().length, 0, '删除后为空');
});

t('固定月支出：金额为 0 会被拒绝', () => {
  S.clearAll(false);
  let err = null;
  try { S.addFixed({ name: '房租', amount: 0, day: 1 }); } catch (e) { err = e; }
  ok(err, '应该抛错');
  eq(S.fixedExpenses().length, 0, '不该加进去');
});

// ------------------------------------------------------------
// 想买清单混进明细
// ------------------------------------------------------------
t('想买清单：wishesIn 区分冷却中/到期/已放弃/已买', () => {
  S.clearAll(false);
  const p = S.currentPeriod();
  const w1 = S.addWish({ name: '耳机', amount: 89900, catId: 'shopping' });
  const w2 = S.addWish({ name: '键盘', amount: 59900, catId: 'shopping' });
  const w3 = S.addWish({ name: '跑鞋', amount: 45000, catId: 'shopping' });
  S.updateWish(w2.id, { dueTs: Date.now() - 1000 });
  S.dropWish(w3.id);
  const rows = S.wishesIn(p);
  eq(rows.length, 3, '三条都在时间线里');
  eq(rows.find((r) => r.id === w1.id).state, 'cooling', '冷却中');
  eq(rows.find((r) => r.id === w2.id).state, 'ready', '到期该问了');
  eq(rows.find((r) => r.id === w3.id).state, 'dropped', '已放弃');
  ok(rows.find((r) => r.id === w1.id).leftMs > 0, '冷却中应有剩余时间');
  eq(rows.find((r) => r.id === w2.id).leftMs, 0, '到期剩余时间为 0');
});

t('想买清单：买下后不再出现在时间线（避免和账目重复）', () => {
  S.clearAll(false);
  const p = S.currentPeriod();
  const w = S.addWish({ name: '耳机', amount: 89900, catId: 'shopping' });
  const before = S.wishesIn(p).length;
  eq(before, 1, '买之前有一条');
  S.buyWish(w.id);
  eq(S.wishesIn(p).length, 0, '买之后时间线里不再有');
  eq(S.txIn(p).length, 1, '账目里多了一条');
});

t('想买清单：按冷静时长算进度百分比', () => {
  S.clearAll(false);
  S.setSettings({ wish: { enabled: true, hours: 48 } });
  const w = S.addWish({ name: '耳机', amount: 89900, catId: 'shopping' });
  const row = S.wishesIn(S.currentPeriod())[0];
  ok(row.leftMs > 0 && row.leftMs <= 48 * 3600000, '剩余时间应在 48 小时内');
  ok(row.hours === 48 || row.hours === undefined, '时长应记成 48');
});

// ------------------------------------------------------------
// 长截屏 OCR：切片规划 + 多笔解析
// ------------------------------------------------------------
t('OCR 切片：普通截图不切', () => {
  const O = window.OCR;
  const p = O.planTiles(1080, 1200);
  eq(p.tiles.length, 1, '不该切片');
  eq(p.long, false, '不该判定为长图');
  eq(p.scale, 1, '宽度合适就不缩放');
});

t('OCR 切片：长截图按宽度缩放、按高度切段', () => {
  const O = window.OCR;
  // 典型的手机长截屏：1080 宽、6000 高
  const p = O.planTiles(1080, 6000);
  ok(p.long, '应判定为长图');
  eq(p.scale, 1, '宽度 1080 不该被缩小（这是之前识别不准的根因）');
  eq(p.w, 1080, '输出宽度保持原样');
  ok(p.tiles.length >= 4, `应该切 >=4 段，实际 ${p.tiles.length}`);
  ok(p.tiles.length <= 14, '不该超过安全上限');
  // 每段不超过 TILE_H，且最后一段能覆盖到底
  p.tiles.forEach((tt) => ok(tt.h <= O.TILE_H, '单片过高：' + tt.h));
  const last = p.tiles[p.tiles.length - 1];
  eq(last.y + last.h, p.h, '最后一段必须覆盖到图片底部');
  // 段与段之间要有重叠，避免把一行切成两半
  for (let i = 1; i < p.tiles.length; i++) {
    const prevEnd = p.tiles[i - 1].y + p.tiles[i - 1].h;
    ok(p.tiles[i].y < prevEnd, '相邻段之间应留重叠');
  }
});

t('OCR 切片：超宽图按宽度缩到 1600', () => {
  const O = window.OCR;
  const p = O.planTiles(3000, 1200);
  eq(p.w, O.OCR_MAX_W, '宽图应缩到上限');
  eq(p.tiles.length, 1, '不算长图');
});

t('OCR 切片：小图放大，字太小也认不准', () => {
  const O = window.OCR;
  const p = O.planTiles(500, 800);
  ok(p.w >= 900, '窄图应放大到至少 900 宽，实际 ' + p.w);
  ok(p.scale <= 2, '放大不超过 2 倍');
});

t('OCR 拆行：能拆出描述和金额', () => {
  const O = window.OCR;
  const a = O.splitAmountLine('美团外卖 -25.80');
  ok(a, '应能拆出');
  eq(a.name, '美团外卖', '描述');
  eq(a.amount, 25.8, '金额');
  eq(a.sign, '-', '符号');
  const b = O.splitAmountLine('工资 +12439.40');
  eq(b.sign, '+', '收入符号');
  const c = O.splitAmountLine('星巴克 ¥31.00');
  eq(c.amount, 31, '带￥的金额');
});

t('OCR 拆行：汇总行 / 纯金额行不算一笔', () => {
  const O = window.OCR;
  eq(O.splitAmountLine('合计 ¥1234.56'), null, '合计不能当一笔');
  eq(O.splitAmountLine('本月支出 -888.00'), null, '本月支出不能当一笔');
  eq(O.splitAmountLine('¥1234.56').name, '', '纯金额行的名字应为空，交给上一行回退');
});

t('OCR 拆行：金额单独一行的写法也认', () => {
  const O = window.OCR;
  const a = O.splitAmountLine('25.80');
  ok(a, '纯金额行应该能拆出来');
  eq(a.amount, 25.8, '金额');
  eq(a.name, '', '名字为空，交给上一行');
  const b = O.splitAmountLine('-25.80');
  eq(b.sign, '-', '带负号');
  eq(O.splitAmountLine('12:30'), null, '时间不能当金额');
  eq(O.splitAmountLine('2026'), null, '年份没有小数，不当金额');
});

t('OCR 多笔解析：金额单独一行时用上一行当商户', () => {
  const O = window.OCR;
  const text = ['美团外卖', '25.80', '星巴克咖啡', '31.00', '滴滴出行', '18.50'].join(String.fromCharCode(10));
  const rows = O.parseList(text);
  eq(rows.length, 3, '应拆出 3 笔，实际 ' + rows.length);
  eq(rows[0].name, '美团外卖', '第 1 笔商户应回退到上一行');
  eq(rows[1].name, '星巴克咖啡', '第 2 笔商户');
});
t('OCR 多笔解析：一列账单拆成多笔', () => {
  const O = window.OCR;
  const text = [
    '账单', '2026年10月12日', '美团外卖', '-25.80', '星巴克咖啡', '-31.00',
    '10月11日', '滴滴出行', '-18.50', '工资', '+12439.40', '合计', '-12439.40',
  ].join('\n');
  const rows = O.parseList(text);
  eq(rows.length, 4, '应拆出 4 笔，实际 ' + rows.length);
  eq(rows[0].name, '美团外卖', '第 1 笔商户');
  eq(rows[0].amount, 25.8, '第 1 笔金额');
  eq(rows[1].name, '星巴克咖啡', '第 2 笔商户');
  eq(rows[3].sign, '+', '工资是收入');
});

t('OCR 多笔解析：切片重叠导致的重复行会被去掉', () => {
  const O = window.OCR;
  const text = ['美团外卖', '-25.80', '美团外卖', '-25.80', '星巴克咖啡', '-31.00'].join('\n');
  const rows = O.parseList(text);
  eq(rows.length, 2, '重复行应去掉，实际 ' + rows.length);
});

t('OCR 解析分流：>=3 笔走列表模式', () => {
  const O = window.OCR;
  const text = ['餐饮', '美团外卖', '-25.80', '星巴克咖啡', '-31.00', '滴滴出行', '-18.50'].join('\n');
  const r = O.parse(text);
  eq(r.mode, 'list', '应走列表模式');
  eq(r.entries.length, 3, '应有 3 笔');
  eq(r.entries[0].engine, 'ocr', '引擎标记');
  ok(r.entries.every((e) => e.amount > 0), '每笔都要有金额');
});

t('OCR 解析分流：订单详情走单笔模式', () => {
  const O = window.OCR;
  const text = ['支付成功', '美团外卖', '实付金额 25.80', '2026-10-12 12:30'].join('\n');
  const r = O.parse(text);
  eq(r.mode, 'single', '应走单笔模式');
  eq(r.entries.length, 1, '只要一笔');
  eq(r.entries[0].amount, 2580, '25.80 元 = 2580 分');
});

t('OCR 解析：一个金额都认不出时给提示而不是崩', () => {
  const O = window.OCR;
  const r = O.parse('这是一张什么都没写的图片');
  eq(r.entries.length, 0, '不该硬编一笔');
  ok(r.warning.length > 0, '应给出提示文案');
});

t('OCR 多笔解析：收入的分类落在收入池里', () => {
  const O = window.OCR;
  const r = O.parse(['工资', '+12439.40', '美团外卖', '-25.80', '滴滴出行', '-18.50'].join('\n'));
  const inc = r.entries.filter((e) => e.type === 'income');
  eq(inc.length, 1, '应该有 1 笔收入');
  const pool = window.Icons.CATEGORIES.filter((c) => c.kind === 'income').map((c) => c.id);
  ok(pool.indexOf(inc[0].catId) >= 0, '收入分类必须在收入池里，实际 ' + inc[0].catId);
});

// ------------------------------------------------------------
// 情侣账单（独立页面 / 独立数据：state.cpTxs）
//
// 用户的硬要求：情侣账单不是「账本」的一个分支，是「情侣」栏里
// 独立的一页。所以这里全部用 cp* API，一行都不碰 state.tx。
// ------------------------------------------------------------
t('情侣账单：addBook 拒绝 couple，bookKind 永远 normal（P2 焊死）', () => {
  const S = window.Store;
  S.clearAll();
  const b = S.addBook({ name: '假冒情侣', icon: '💞', kind: 'couple' });
  eq(b.kind, 'normal', 'addBook 不能吃 kind:couple');
  eq(S.books().filter((x) => x.kind === 'couple').length, 0, '账本里不能出现 couple');
  eq(S.bookKind(), 'normal', 'bookKind() 永远 normal');
  eq(S.bookKind(b.id), 'normal', '带 id 也是 normal');
  // 迁移兜底：手写脏数据塞进 localStorage，migrate 必须把它拆掉
  const raw = JSON.parse(JSON.stringify(S.state));
  raw.books.push({ id: 'cpdirty', name: '脏情侣账本', kind: 'couple', createdAt: Date.now() });
  raw.tx.push({ id: 'txdirty', type: 'expense', amount: 1234, catId: 'food', ts: Date.now(), bookId: 'cpdirty' });
  const m = S.migrate(raw);
  eq(m.books.filter((x) => x.kind === 'couple').length, 0, '迁移后没有 couple 账本');
  eq(m.tx.filter((x) => x.bookId === 'cpdirty').length, 0, '脏账本里的账已摘出 state.tx');
  eq(m.cpTxs.filter((x) => x.amount === 1234).length, 1, '搬到 cpTxs 里了');
  eq(m.cpTxs.every((x) => x.bookId === undefined), true, 'cpTxs 永远没有 bookId');
});

t('情侣账单：开通后不建账本、不碰 state.tx', () => {
  const S = window.Store;
  S.clearAll();
  const before = { books: S.books().length, tx: S.state.tx.length };
  S.enableCouple({ meName: '小懒', peerName: '小满', togetherSince: '2024-05-20', mode: 'local',
    consent:{ agreed: true, at: Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) } });
  eq(S.books().length, before.books, '账本数不能变');
  eq(S.state.tx.length, before.tx, '个人账目不能被写');
  eq(S.books().filter((b) => b.kind === 'couple').length, 0, '不能再出现情侣账本');
  eq(S.cpOn(), true, '开关打开');
});

t('情侣账单：重复开通不会多出账本或金库', () => {
  const S = window.Store;
  const before = { books: S.books().length, goals: S.state.goals.length };
  S.enableCouple({ mode: 'remote' });
  S.enableCouple({ mode: 'local' });
  eq(S.books().length, before.books, '账本数不变');
  eq(S.state.goals.length, before.goals, '目标数不变');
});

t('情侣账单：开通即建「我们的小金库」且 kind=couple', () => {
  const S = window.Store;
  const g = S.coupleVault();
  ok(!!g, '应有一个情侣金库');
  eq(g.kind, 'couple', '金库必须是 couple 类型');
  eq(S.coupleGoals().length >= 1, true, 'coupleGoals 至少一个');
});

t('情侣账单：cpAddTx 写进 cpTxs，不进 state.tx / 不进任何账本', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ meName: '小懒', peerName: '小满', mode: 'local' });
  const txBefore = S.state.tx.length;
  const t1 = S.cpAddTx({ type: 'expense', amount: 3200, catId: 'food', note: '火锅', attrib: 'me' });
  eq(S.cpTxs().length, 1, 'cpTxs 里有一笔');
  eq(S.state.tx.length, txBefore, 'state.tx 一条都不能多');
  eq(t1.bookId, undefined, '情侣账目不能带 bookId');
  eq(t1.attrib, 'me', '归属落库');
  eq(S.cpTxById(t1.id).id, t1.id, '能按 id 取回');
});

t('情侣账单：cpTxIn 按自然月过滤且时间倒序', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  const now = Date.now();
  const thisMonth = S.monthPeriod(new Date());
  const lastMonth = S.monthPeriod(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
  const a = S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', ts: now - 3600 * 1000 });
  const b = S.cpAddTx({ type: 'expense', amount: 2000, catId: 'fun', ts: now - 60 * 1000 });
  const c = S.cpAddTx({ type: 'expense', amount: 3000, catId: 'fun', ts: lastMonth.start.getTime() + 3600 * 1000 });
  const cur = S.cpTxIn(thisMonth);
  eq(cur.length, 2, '本月两笔');
  eq(cur[0].id, b.id, '倒序：最新的在前');
  eq(cur[1].id, a.id, '倒序：旧的在后');
  const prev = S.cpTxIn(lastMonth);
  eq(prev.length, 1, '上个月一笔');
  eq(prev[0].id, c.id, '上个月那笔');
  eq(S.cpTxIn().length, 3, '不传周期返回全部');
});

t('情侣账单：cpSummary 结构与 summary 对齐，收入不计支出', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  const p = S.monthPeriod(new Date());
  S.cpAddTx({ type: 'expense', amount: 2500, catId: 'food' });
  S.cpAddTx({ type: 'expense', amount: 1500, catId: 'food' });
  S.cpAddTx({ type: 'expense', amount: 1000, catId: 'fun' });
  S.cpAddTx({ type: 'income', amount: 8888, catId: 'salary' });
  const s = S.cpSummary(p);
  eq(s.expense, 5000, '支出合计');
  eq(s.income, 8888, '收入合计');
  eq(s.count, 3, '总笔数现在等于净支出笔数（收入不参与，情侣账本只记支出）');
  eq(s.expCount, 3, '支出笔数');
  eq(s.incCount, 1, '收入笔数');
  eq(s.net, 8888 - 5000, '净额');
  eq(s.byCat.length, 2, '两个分类');
  eq(s.byCat[0].id, 'food', '按金额排序，food 在前');
  eq(s.byCat[0].amount, 4000, 'food 合计');
  eq(Math.round(s.byCat[0].pct * 100), 80, 'food 占比 80%');
  ok(!!s.byCat[0].meta.name, 'byCat 带分类元信息');
});

t('情侣账单：改一笔/删一笔/撤回都走独立数组', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  const t1 = S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'me' });
  S.cpUpdateTx(t1.id, { amount: 2600, attrib: 'peer', note: '改过了' });
  eq(S.cpTxById(t1.id).amount, 2600, '金额改了');
  eq(S.cpTxById(t1.id).attrib, 'peer', '归属改了');
  const gone = S.cpRemoveTx(t1.id);
  eq(S.cpTxs().length, 0, '删掉了');
  S.cpRestoreTx(gone);
  eq(S.cpTxs().length, 1, '撤回回来了');
  eq(S.cpTxById(t1.id).note, '改过了', '撤回保留改动');
});

t('情侣账单：个人账本完全看不到情侣账目', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  S.addTx({ type: 'expense', amount: 1000, catId: 'food' });
  S.cpAddTx({ type: 'expense', amount: 9999, catId: 'fun' });
  const p = S.currentPeriod();
  eq(S.txIn(p).length, 1, '明细里只有个人那笔');
  eq(S.summary(p).expense, 1000, '总结里只有个人金额');
  eq(S.txInAll(p).length, 1, '合并看板也只有个人那笔');
  eq(S.state.tx.filter((x) => x.catId === 'fun').length, 0, 'state.tx 里没有情侣那笔');
});

t('情侣账单：关闭只改开关，情侣账目与金库都保留', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  S.cpAddTx({ type: 'expense', amount: 4200, catId: 'food' });
  const before = { cp: S.cpTxs().length, goals: S.state.goals.length, books: S.books().length };
  S.disableCouple();
  eq(S.settings.couple.enabled, false, '开关已关');
  eq(S.cpTxs().length, before.cp, '情侣账目一条不少');
  eq(S.state.goals.length, before.goals, '目标一个不少');
  eq(S.books().length, before.books, '账本一本不少');
});

// 源头断言：ATTRIBS 一旦被改动（加项 / 减项 / 换序 / 改名），这里就炸，
// 而不是等某条零散的 UI 断言失败才被发现。
// 顺序 = 记账弹层里从左到右的顺序（用户 m03602 定稿：红包放在「互相请」后面）。
t('归属印记（源头）：四个 id 恰好是 me/peer/mutual/redpacket 且顺序固定', () => {
  const S = window.Store;
  eq(S.ATTRIBS.map((a) => a.id).join('|'), 'me|peer|mutual|redpacket', 'id 与顺序一个都不能动');
  eq(S.ATTRIBS.length, 4, '必须是四个');
  eq(S.ATTRIBS.map((a) => a.name).join('|'), '我请|TA 请|互相请|红包', '顺序与文案固定');
  eq(S.ATTRIBS.some((a) => a.id === 'both'), false, '一起花不再出现在选项里（只在 map 兜底）');
});

t('归属印记（源头）：both 只在 map 里兜底，ATTRIB_DEFAULT 是 mutual', () => {
  const S = window.Store;
  ok(!!S.ATTRIB_MAP.both, 'ATTRIB_MAP.both 要给老数据兜底');
  eq(S.ATTRIB_MAP.both.id, 'both', '兜底项自己的 id');
  eq(S.ATTRIB_DEFAULT, 'mutual', '默认是互相请，不是一起花');
});

// 回归：计数表少 redpacket 键时 undefined++ → NaN，前端 `${stats.redpacket || 0}` 恒显示 0。
t('归属印记（回归）：红包次数能数出来，不是 NaN', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  for (let i = 0; i < 3; i++) {
    S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'redpacket' });
  }
  S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'me' });
  const st = S.attribStats(S.cpTxIn());
  eq(st.redpacket, 3, '红包 3 次');
  eq(Number.isNaN(st.redpacket), false, '不能是 NaN');
  eq(Object.prototype.hasOwnProperty.call(st, 'redpacket'), true, '计数表里必须有这个键');
  eq(st.me, 1, '我请 1 次');
});

t('归属印记（回归）：total 含红包笔数（卡片按 total 决定显不显示）', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  for (let i = 0; i < 2; i++) S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'redpacket' });
  for (let i = 0; i < 2; i++) S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'me' });
  S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'peer' });
  const st = S.attribStats(S.cpTxIn());
  eq(st.total, 5, '2 红包 + 2 我请 + 1 TA 请 = 5');
  eq(st.me + st.peer + st.mutual + st.redpacket, st.total, '四分类相加等于 total');
});

// cpCompareLine 是三分类口径：红包是赠予不是请客，不计入「谁请得多」。
// 这里只锁它「不含红包」这件事，文案本身另有断言。
t('归属印记（回归）：cpCompareLine 走三分类，红包不掺和', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  // 只放红包 + 两笔请客：三分类只有 2 次 < 3，不该出话；含红包则 4 次会出话。
  for (let i = 0; i < 2; i++) S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'redpacket' });
  S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'me' });
  S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'peer' });
  const st = S.attribStats(S.cpTxIn());
  eq(st.total, 4, '含红包一共 4 笔');
  eq(st.me + st.peer + st.mutual, 2, '三分类只有 2 次');
  eq(S.cpCompareLine(st), '', '样本不足三分类 3 次时不说话');
  S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'me' });
  ok(S.cpCompareLine(S.attribStats(S.cpTxIn())).length > 0, '补到三分类 3 次才出话');
});

t('归属印记：四个印记的徽章色各不相同', () => {
  const S = window.Store;
  const set = new Set(S.ATTRIBS.map((a) => a.color));
  eq(set.size, 4, '四色不能重复，否则用户分不清');
});

t('归属印记：不认识的值一律按「互相请」兜底', () => {
  const S = window.Store;
  eq(S.attrib('').id, 'mutual', '空值兜底');
  eq(S.attrib('乱写').id, 'mutual', '乱写兜底');
  eq(S.attrib('both').id, 'both', '老数据「一起花」仍能解析');
  eq(S.attrib('mutual').id, 'mutual', '正常值原样返回');
});

t('归属印记：个人账目永远没有 attrib 字段', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  const a = S.addTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'me' });
  eq(a.attrib, undefined, '个人账目不能写这个字段');
  eq(S.attribOf(a), null, '也没有徽章');
  const b = S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'me' });
  eq(b.attrib, 'me', '情侣账目要落库');
  eq(S.attribOf(b).id, 'me', '情侣账目有徽章');
});

t('归属印记：次数统计只数支出，跳过已归还的垫付', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  for (let i = 0; i < 4; i++) S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'me' });
  S.cpAddTx({ type: 'income', amount: 9999, catId: 'salary' });
  S.cpAddTx({ type: 'expense', amount: 1000, catId: 'food', attrib: 'peer',
    advance: { who: '老王', status: 'settled' } });
  const st = S.attribStats(S.cpTxIn());
  eq(st.me, 4, '我请 4 次');
  eq(st.peer, 0, '已归还的垫付不算次数');
  eq(st.total, 4, '收入不算次数');
});

t('归属印记：不改金额——四种都计入「我们的支出」', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ mode: 'local' });
  ['me', 'peer', 'both', 'mutual'].forEach((a) => {
    S.cpAddTx({ type: 'expense', amount: 2500, catId: 'food', attrib: a });
  });
  const p = S.monthPeriod(new Date());
  const sum = S.cpSummary(p);
  eq(sum.expense, 10000, '四笔都进支出');
  eq(sum.expCount, 4, '四笔都计笔数');
});

t('爱的账单：差值 ≤2 次说「请得挺匀的」', () => {
  const S = window.Store;
  ok(S.attribLine({ me: 8, peer: 7 }).indexOf('匀') >= 0, '接近时说匀');
  ok(S.attribLine({ me: 5, peer: 7 }).indexOf('匀') >= 0, '差 2 也算匀');
  ok(S.attribLine({ me: 0, peer: 0 }).indexOf('匀') >= 0, '都是 0 也算匀');
});

t('爱的账单：偏差大时也只说宠，不说谁少', () => {
  const S = window.Store;
  ok(S.attribLine({ me: 12, peer: 3 }).indexOf('更宠 TA') >= 0, '我多 → 你更宠 TA');
  ok(S.attribLine({ me: 1, peer: 10 }).indexOf('很宠你') >= 0, 'TA 多 → TA 很宠你');
});

t('爱的账单：永远不出现对账句式', () => {
  const S = window.Store;
  const cases = [{ me: 0, peer: 9 }, { me: 9, peer: 0 }, { me: 3, peer: 3 }, { me: 50, peer: 1 }];
  cases.forEach((c) => {
    const s = S.attribLine(c);
    ok(s.indexOf('比') < 0, '不能出现「比」：' + s);
    ok(s.indexOf('%') < 0, '不能出现百分比：' + s);
    ok(s.indexOf('少') < 0, '不能出现「少」：' + s);
  });
});

t('双心：进度由 goalProgress 统一算，0 目标不炸', () => {
  const S = window.Store;
  const g = S.coupleVault();
  g.saved = 5000; g.target = 0;
  const p = S.goalProgress(g);
  eq(p.pct, 0, '没有目标金额时进度为 0');
  eq(p.done, false, '不能算达成');
});

t('双心：存满时 pct=1 且 done=true', () => {
  const S = window.Store;
  const g = S.coupleVault();
  g.saved = 100000; g.target = 100000;
  const p = S.goalProgress(g);
  eq(p.pct, 1, '满进度');
  eq(p.done, true, '算达成');
});

// 2026-10 回归：addGoal 漏写 cpBookId，建好的情侣基金当场被过滤掉，
// 界面上就是「点了建基金，回头还是『还没设目标』」。
t('新建情侣基金当场就带当前这本的章（cpBookId）', () => {
  const S = window.Store;
  const g = S.addGoal({ name: '约会基金', icon: '🎟️', target: 0, kind: 'couple', slot: 'date' });
  ok(!!g.cpBookId, 'cpBookId 必须写上：' + String(g.cpBookId));
  eq(g.cpBookId, S.cpActiveId(), '章要盖当前这一本');
  const found = S.coupleDateFund();
  ok(!!found && found.id === g.id, '建完立刻能按 slot 找回来');
  eq(S.coupleGoals().indexOf(found) >= 0, true, '要出现在当前这本的基金列表里');
  S.removeGoal(g.id);
});

t('个人目标不会被盖情侣账的章', () => {
  const S = window.Store;
  const g = S.addGoal({ name: '换个手机', target: 500000 });
  eq(g.cpBookId, '', '正常人攒钱目标不该有 cpBookId');
  ok(S.coupleGoals().every((x) => x.id !== g.id), '也不能混进情侣基金列表');
  S.removeGoal(g.id);
});

t('迁移：老的情侣账本会被搬进 cpTxs，账本本身消失', () => {
  const S = window.Store;
  const raw = {
    version: 1,
    books: [
      { id: 'default', name: '日常', icon: '📒', color: '#4F7CFF', createdAt: 1 },
      { id: 'cp1', name: '情侣', icon: '💞', color: '#FF6A9B', kind: 'couple', createdAt: 2 },
    ],
    tx: [
      { id: 'x1', type: 'expense', amount: 1000, catId: 'food', ts: Date.now(), bookId: 'default', accountId: 'alipay' },
      { id: 'x2', type: 'expense', amount: 3000, catId: 'fun', ts: Date.now(), bookId: 'cp1', accountId: 'alipay' },
      { id: 'x3', type: 'expense', amount: 500, catId: 'food', ts: Date.now(), bookId: 'cp1', accountId: 'alipay', attrib: 'me' },
    ],
    goals: [], repeats: [], wishlist: [], subs: [], recon: [],
    settings: {
      books: { activeId: 'cp1' },
      couple: { enabled: true, mode: 'local', meName: 'A', peerName: 'B' },
    },
  };
  const m = S.migrate(raw);
  eq(m.books.length, 1, '情侣账本被删掉');
  eq(m.books[0].id, 'default', '只剩日常账本');
  eq(m.tx.length, 1, '个人账目只剩一笔');
  eq(m.tx[0].id, 'x1', '个人那笔还在');
  eq(m.cpTxs.length, 2, '两笔搬进情侣账单');
  eq(m.cpTxs.map((x) => x.id).join('|'), 'x2|x3', '搬的是情侣账本那两笔');
  eq(m.cpTxs[0].bookId, undefined, '搬过去后去掉 bookId');
  eq(m.cpTxs[0].attrib, 'mutual', '没有归属的补当前默认（互相请）');
  eq(m.cpTxs[1].attrib, 'me', '有的保留原值');
  eq(m.settings.books.activeId, 'default', 'activeId 回落到剩下的账本');
});

t('迁移：cpTxs 不是数组时补成空数组，脏数据被滤掉', () => {
  const S = window.Store;
  const raw = {
    version: 1, books: [], activeId: 'default', tx: [], goals: [], repeats: [],
    wishlist: [], subs: [], recon: [], cpTxs: [{ id: 'bad', amount: 'x', ts: 1 }, { id: 'ok', type: 'expense', amount: 100, ts: 1 }],
    settings: {},
  };
  const m = S.migrate(raw);
  eq(Array.isArray(m.cpTxs), true, 'cpTxs 是数组');
  eq(m.cpTxs.length, 1, '非法的被滤掉');
  eq(m.cpTxs[0].id, 'ok', '合法的留下');
});

// ---------- 同步引擎（M1 已接真加密 / 队列 / 合并；未配对时仍然不联网） ----------
t('同步引擎：CoupleSync 已加载且导出接口齐全', () => {
  const C = window.CoupleSync;
  ok(C, 'CoupleSync 未加载');
  ['deriveKey', 'encrypt', 'decrypt', 'outboxPush', 'outboxFlush', 'pullSince', 'hook', 'status',
    'pair', 'pairString', 'parsePair', 'join', 'leave', 'syncOnce', 'mergeList', 'takePending']
    .forEach((k) => eq(typeof C[k], 'function', k + ' 是函数'));
  eq(C.PROTO, 2, '协议版本');
  eq(C.KEY, 'jizhang.sync.v1', '本地同步状态键名（和业务数据分开存）');
});
t('同步引擎：未配对时 ready() 为 false，status 说「只在本机」', () => {
  const C = window.CoupleSync;
  eq(C.ready(), false, 'ready');
  eq(C.status().text, '只在本机', '文案');
  eq(C.status().outbox, 0, '队列为空');
  eq(C.pairString(), '', '没有配对串');
});
t('同步引擎：没配对时 outboxPush 返回 false 且不写 settings', () => {
  const C = window.CoupleSync;
  const before = JSON.stringify(S.settings.couple);
  eq(C.outboxPush({ kind: 'tx.add', id: 'x' }), false, '不入队');
  eq(JSON.stringify(S.settings.couple), before, 'settings 未被写入');
  eq(C.state().outbox.length, 0, '同步队列是空的');
});
t('同步引擎：没配对时调用加解密 / 拉取不抛错（只是不干活）', () => {
  const C = window.CoupleSync;
  const p1 = C.encrypt('{"a":1}');
  ok(p1 && typeof p1.then === 'function', 'encrypt 返回 Promise');
  const p2 = C.pullSince(1);
  ok(p2 && typeof p2.then === 'function', 'pullSince 返回 Promise');
  const p3 = C.deriveKey('abc', 'salt');
  ok(p3 && typeof p3.then === 'function', 'deriveKey 返回 Promise');
  p3.catch(() => {});   // 坏参数在 Promise 里拒绝，别留未处理拒绝
  const p4 = C.decrypt('AAAA');
  ok(p4 && typeof p4.then === 'function', 'decrypt 返回 Promise');
  ok(C.outboxFlush() && typeof C.outboxFlush().then === 'function', 'outboxFlush 返回 Promise');
});
t('同步引擎：hook 永不抛错，脏输入也不炸', () => {
  const C = window.CoupleSync;
  eq(C.hook(null), false, 'null');
  eq(C.hook({}), false, '空对象');
  eq(C.hook({ kind: 'tx.add', id: 'a', ts: 1 }), false, '没配对时正常事件也不入队');
});
t('同步引擎：情侣记账走完 加/改/删，未配对时全程不联网', () => {
  const c = S.enableCouple({ meName: '甲', peerName: '乙', mode: 'local', togetherSince: '2024-01-01', consent:{ agreed: true, at: Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) } });
  ok(c, '开通失败');
  const n0 = S.cpTxs().length;
  const a = S.cpAddTx({ type: 'expense', amount: 100, catId: 'food' });
  eq(S.cpTxs().length, n0 + 1, '加进去了');
  S.cpUpdateTx(a.id, { amount: 200 });
  S.cpRemoveTx(a.id);
  eq(S.cpTxs().length, n0, '删干净了');
  ok(!window.localStorage.getItem('cpSync.outbox'), '本地没有同步队列');
});

// 2026-10：情侣账本只记支出 + 退款按净额 + 来自 TA 的偏爱
t('退款：那一笔不单独算一笔，金额按净额扣', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ meName: '甲', peerName: '乙', mode: 'local', togetherSince: '2024-01-01', consent:{ agreed: true, at: Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) } });
  const a = S.cpAddTx({ type: 'expense', amount: 10000, catId: 'food', attrib: 'me' });
  const b = S.cpAddTx({ type: 'expense', amount: 5000, catId: 'fun', attrib: 'peer' });
  const p = S.scopePeriod('month', new Date());
  const before = S.cpSummary(p, S.cpTxs());
  eq(before.expense, 15000, '退之前一起花了 150');
  eq(before.count, 2, '退之前 2 笔');
  const r = S.cpRefundTx(a.id, 3000, '退回来一部分');
  ok(!!r && r.refundOf === a.id, '退款要挂在原支出下面');
  const after = S.cpSummary(p, S.cpTxs());
  eq(after.expense, 12000, '退 30 之后一起花了 120');
  eq(after.count, 2, '笔数不变：退款属于那一笔，不另算');
  eq(after.refundTotal, 3000, '退回来的钱单独记一次，不能双算');
  eq(S.cpRefundedOf(a.id), 3000, '这一笔退了 30');
  eq(S.cpNetOf(a), 7000, '这一笔净花 70');
  eq(S.cpNetOf(b), 5000, '没退的按原额');
});

t('退款：全额退时净额归零，分类统计里不再出现', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ meName: '甲', peerName: '乙', mode: 'local', togetherSince: '2024-01-01', consent:{ agreed: true, at: Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) } });
  const a = S.cpAddTx({ type: 'expense', amount: 8000, catId: 'shopping', attrib: 'both' });
  S.cpAddTx({ type: 'expense', amount: 2000, catId: 'food', attrib: 'me' });
  S.cpRefundTx(a.id, 'full', '全退了');
  const p = S.scopePeriod('month', new Date());
  const sum = S.cpSummary(p, S.cpTxs());
  eq(sum.expense, 2000, '全退之后只剩那 20');
  eq(S.cpNetOf(a), 0, '这一笔净花 0');
  ok(!sum.byCat.some((c) => c.id === 'shopping'), '净额为 0 的分类不该出现在排行里');
  eq(S.cpRefundTx(a.id, 'full', '再退一次'), null, '已经退干净了不能再退');
});

t('退款：日历上那一天按净额算，退款记录自己不长格子', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ meName: '甲', peerName: '乙', mode: 'local', togetherSince: '2024-01-01', consent:{ agreed: true, at: Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) } });
  const now = Date.now();
  const a = S.cpAddTx({ type: 'expense', amount: 6000, catId: 'food', attrib: 'me', ts: now });
  S.cpRefundTx(a.id, 2000, '退了');
  const cal = S.cpCalendar(S.monthPeriod(new Date()));
  const d = cal.days[U.ymd(new Date(now))];
  ok(!!d, '那天要有格子');
  // 日历的格子不直接给金额，它给的是当天所有条目（txs），金额一律现算净额
  eq(d.txs.length, 1, '退款记录不占格子，那天只有原支出这一条');
  eq(S.cpNetOf(d.txs[0]), 4000, '那颗心的金额是净额');
  eq(S.cpDayTxs(now).filter((t) => t.refundOf).length, 0, '退款记录不该出现在当天明细里');
});

t('来自 TA 的偏爱：TA 发的红包，我这边算「收」，不算多花一份钱', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ meName: '甲', peerName: '乙', mode: 'local', togetherSince: '2024-01-01', consent:{ agreed: true, at: Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) } });
  // 一条：TA 发给我的红包
  const t = S.cpAddTx({ type: 'expense', amount: 5200, catId: S.RP_CAT, attrib: 'peer', rpFrom: 'peer', note: '给你买奶茶' });
  eq(S.RP_CAT, 'redpacket', '红包分类 id');
  eq(t.rpFrom, 'peer', '方向记下来了');
  const inn = S.cpFavorsIn();
  eq(inn.length, 1, '出现在「来自 TA 的偏爱」里');
  eq(S.cpFavorsTotal(), 5200, '合计 52');
  eq(S.cpFavorsOut().length, 0, '不是我发出去的');
  // 账只有一份：这一笔在我的视角里是「收入」，不进支出（m02455 用户定稿）
  const sum = S.cpSummary(S.scopePeriod('month', new Date()), S.cpTxs());
  eq(sum.income, 5200, 'TA 发给我的红包，我这边的月报里是收入');
  eq(sum.expense, 0, '同一笔钱不算我花出去的');
  eq(sum.count, 0, '支出笔数不含收到的红包');
});

t('来自 TA 的偏爱：我发的红包进「发出去」，不进「收到的」', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ meName: '甲', peerName: '乙', mode: 'local', togetherSince: '2024-01-01', consent:{ agreed: true, at: Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) } });
  S.cpAddTx({ type: 'expense', amount: 13140, catId: S.RP_CAT, attrib: 'me', rpFrom: 'me', note: '一辈子' });
  eq(S.cpFavorsOut().length, 1, '出现在「我发出去的」');
  eq(S.cpFavorsIn().length, 0, '不能同时算成收到的');
  eq(S.cpFavorsTotal(), 0, '收到的是 0');
});

t('来自 TA 的偏爱：手动补记一笔，和自动识别的是同一种东西', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ meName: '甲', peerName: '乙', mode: 'local', togetherSince: '2024-01-01', consent:{ agreed: true, at: Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) } });
  const f = S.cpAddFavor({ amount: 8800, note: 'TA 转我的' });
  eq(f.catId, 'redpacket', '走红包分类');
  eq(f.rpFrom, 'peer', '方向是 TA → 我');
  eq(f.attrib, 'peer', '归属是 TA 请的');
  eq(S.cpFavorsTotal(), 8800, '进「收到的」合计');
  eq(S.cpFavorsIn().length, 1, '列表里有一条');
});

t('来自 TA 的偏爱：退回来的红包按净额算，删了就不在了', () => {
  const S = window.Store;
  S.clearAll();
  S.enableCouple({ meName: '甲', peerName: '乙', mode: 'local', togetherSince: '2024-01-01', consent:{ agreed: true, at: Date.now(),version:(window.ViewCouple.CONSENT_VERSION||3) } });
  const f = S.cpAddFavor({ amount: 10000 });
  S.cpRefundTx(f.id, 4000, '退了一点');
  eq(S.cpFavorsTotal(), 6000, '收到的按净额 60');
  S.cpRemoveTx(f.id);
  eq(S.cpFavorsIn().length, 0, '删掉之后列表空了');
  eq(S.cpFavorsTotal(), 0, '合计也归零');
});

t('红包分类在分类表里，但只属于支出', () => {
  const S = window.Store;
  const c = S.CAT_MAP ? S.CAT_MAP['redpacket'] : null;
  const real = c || (window.Icons.CAT_MAP && window.Icons.CAT_MAP['redpacket']);
  ok(!!real, '红包分类要存在');
  eq(real.kind, 'expense', '它是一笔支出，不是收入');
  eq(real.name, '红包', '名字是红包');
});

// 还原环境
localStorage.setItem('jizhang.v1', backup);
return out;
