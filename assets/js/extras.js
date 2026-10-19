/* ============================================================
 * 记账本 · 换算成实物
 * 把金额换算成「看得懂的东西」，纯静态数据，零依赖
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;

  /**
   * 等价物库
   * unit 单位（份），price 单价（分）
   * 选品原则：日常、有画面感、不冒犯
   */
  const ITEMS = [
    { key: 'coffee', name: '杯奶茶', unit: '杯', price: 1800, emoji: '🧋' },
    { key: 'latte', name: '杯咖啡', unit: '杯', price: 3200, emoji: '☕' },
    { key: 'breakfast', name: '顿早餐', unit: '顿', price: 800, emoji: '🥐' },
    { key: 'hotpot', name: '顿火锅', unit: '顿', price: 12000, emoji: '🍲' },
    { key: 'movie', name: '张电影票', unit: '张', price: 4500, emoji: '🎬' },
    { key: 'book', name: '本书', unit: '本', price: 5800, emoji: '📚' },
    { key: 'taxi', name: '次打车', unit: '次', price: 3500, emoji: '🚕' },
    { key: 'dayoff', name: '天年假', unit: '天', price: 30000, emoji: '🌴' },
    { key: 'flight', name: '张机票', unit: '张', price: 150000, emoji: '✈️' },
    { key: 'hotel', name: '晚酒店', unit: '晚', price: 45000, emoji: '🏨' },
    { key: 'console', name: '台游戏机', unit: '台', price: 300000, emoji: '🎮' },
    { key: 'phone', name: '部手机', unit: '部', price: 599900, emoji: '📱' },
    { key: 'laptop', name: '台笔记本', unit: '台', price: 899900, emoji: '💻' },
    { key: 'bike', name: '辆自行车', unit: '辆', price: 150000, emoji: '🚲' },
    { key: 'gym', name: '个月健身房', unit: '个月', price: 30000, emoji: '🏋️' },
    { key: 'concert', name: '场演唱会', unit: '场', price: 80000, emoji: '🎤' },
    { key: 'petfood', name: '袋猫粮', unit: '袋', price: 15000, emoji: '🐱' },
    { key: 'flower', name: '束花', unit: '束', price: 8800, emoji: '💐' },
    { key: 'month', name: '个月房租', unit: '个月', price: 280000, emoji: '🏠' },
    { key: 'umbrella', name: '把伞', unit: '把', price: 3900, emoji: '☂️' },
  ];

  const ITEM_MAP = {};
  ITEMS.forEach((it) => { ITEM_MAP[it.key] = it; });

  /** 按分类给一个「最贴切」的等价物 */
  const CAT_PICK = {
    food: 'hotpot',
    market: 'breakfast',
    transport: 'taxi',
    shopping: 'book',
    housing: 'month',
    fun: 'movie',
    health: 'gym',
    study: 'book',
    social: 'flower',
    comm: 'coffee',
    pet: 'petfood',
    baby: 'breakfast',
    travel: 'hotel',
    beauty: 'flower',
    car: 'taxi',
    other_out: 'coffee',
  };

  /**
   * 把金额换算成实物
   * 选品策略：优先分类对应的等价物，但数量要落在「读起来自然」的区间
   * @param {number} cents 金额（分）
   * @param {string} catId 分类 id
   * @returns {{text:string, item:object, count:number}|null}
   */
  function forMoney(cents, catId) {
    const amt = Math.abs(Number(cents) || 0);
    if (amt < 1000) return null;                 // 10 元以下没意义
    const prefKey = CAT_PICK[catId];
    let best = null;
    ITEMS.forEach((it) => {
      const count = amt / it.price;
      if (count < 1) return;
      // 数量越接近 1–20 区间越自然；超过 200 基本不会说了
      let score;
      if (count <= 20) score = Math.abs(Math.log(count));
      else score = Math.abs(Math.log(count / 20)) + 3;
      if (it.key === prefKey) score -= 0.8;        // 分类匹配的加分
      if (!best || score < best.score) best = { item: it, count, score };
    });
    if (!best) best = { item: ITEMS[0], count: amt / ITEMS[0].price };
    const n = best.count >= 10 ? Math.round(best.count) : Math.round(best.count * 10) / 10;
    return { text: `≈ ${fmtNum(n)} ${best.item.name}`, item: best.item, count: n };
  }

  function fmtNum(n) {
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    return String(n);
  }

  /**
   * 动态等价物：把这笔钱换算成某个攒钱目标的进度
   * @param {number} cents
   * @param {Array} goals
   * @returns {{text:string, goal:object, pct:number}|null}
   */
  function forGoal(cents, goals) {
    const amt = Math.abs(Number(cents) || 0);
    if (!amt || !goals || !goals.length) return null;
    const live = goals.filter((g) => !g.archived && g.target > 0 && g.saved < g.target);
    if (!live.length) return null;
    // 找「最接近有意义比例」的那个目标
    let best = null;
    live.forEach((g) => {
      const left = g.target - g.saved;
      const pct = amt / left;
      if (pct > 0.02 && pct < 3) {
        const score = Math.abs(Math.log(pct));  // 越接近 1 越好
        if (!best || score < best.score) best = { goal: g, pct, score };
      }
    });
    if (!best) return null;
    const pctText = best.pct >= 1
      ? `够买下「${best.goal.name}」了`
      : `是「${best.goal.name}」还差的 ${Math.round(best.pct * 100)}%`;
    return { text: `这笔钱${pctText}`, goal: best.goal, pct: best.pct };
  }

  /**
   * 一次算出全部等价描述（给洞察区用）
   * @returns {string[]} 最多 2 条，按重要性排序
   */
  function insights(cents, catId, goals) {
    const out = [];
    const g = forGoal(cents, goals);
    if (g) out.push(g.text);
    const m = forMoney(cents, catId);
    if (m) out.push(`这笔钱${m.text.replace('≈ ', '相当于 ')}`);
    return out.slice(0, 2);
  }

  /**
   * 给一段时间的总支出做等价描述（总结页用）
   */
  function forTotal(cents, catId) {
    const m = forMoney(cents, catId);
    return m ? m.text : '';
  }

  global.Extras = {
    ITEMS, ITEM_MAP, CAT_PICK,
    forMoney, forGoal, insights, forTotal, fmtNum,
  };
})(window);
