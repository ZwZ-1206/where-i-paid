/* ============================================================
 * 花哪儿了 · 暖心提示
 * 纯本地规则引擎：读取「前一天」的支出分布，挑出最值得说的一句话。
 * 不联网、不调用任何 API、零依赖。
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  // ------------------------------------------------------------
  // 文案库
  // 每条规则一组短句，用「日期 + 序号」哈希取模挑一句：
  // 同一天看到的始终是同一句，换一天自动换一句。
  // ------------------------------------------------------------
  const COPY = {
    empty: {
      emoji: '🍃', tag: '记录', tone: 'care', lines: [
        '昨天没有记账，没关系。今天想记的时候，我一直都在。',
        '昨天账本是空白的 —— 空白也是一种记录，说明你过得挺轻松。',
        '昨天没有支出记录。如果只是忘了记，今天补上也来得及。',
        '昨天安静地过去了。今天要不要记下第一笔？',
        '一天没记账，不算断。账本是给自己的生活留个底，不是给自己打分。',
      ],
    },
    food_low: {
      emoji: '🍚', tag: '餐饮', tone: 'care', lines: [
        '昨天餐饮只占 {foodPct}%，别把自己饿着 —— 吃好喝好，才是对自己最基本的照顾。',
        '在吃上只花了 {foodAmt}，省可以省，但别亏待自己的胃。',
        '餐饮支出有点少（{foodPct}%）。忙归忙，饭还是要按时吃的。',
        '昨天吃得有点将就了。今天给自己加个菜吧，身体是本钱。',
        '一天里最值得花的钱，是让自己吃饱吃好的那部分。',
        '餐饮只占 {foodPct}%。省钱的方式有很多种，省饭钱通常是最不划算的那种。',
      ],
    },
    food_high: {
      emoji: '🍜', tag: '餐饮', tone: 'warn', lines: [
        '昨天餐饮占了 {foodPct}%，吃得挺丰盛。偶尔犒劳自己没问题，别天天如此就好。',
        '餐饮花了 {foodAmt}，占昨天支出的 {foodPct}%。外卖虽香，自己做也很有滋味。',
        '昨天在吃上花得比较多。要不这周试试自己下厨一两次？',
        '餐饮 {foodAmt}，占了 {foodPct}%。吃得开心是好事，只是别让味蕾替钱包做决定。',
        '昨天的钱大半进了肚子（{foodPct}%）。下顿试试简单点，胃和余额都会感谢你。',
      ],
    },
    transport_zero: {
      emoji: '🚶', tag: '出行', tone: 'cheer', lines: [
        '昨天几乎没怎么出门。多走走，看看世界，路费是最值当的投资。',
        '昨天没有出行支出 —— 是一直待着吗？天气好的话，出去走走吧。',
        '出行支出为 0。偶尔换个地方散步，心情会不一样。',
        '昨天没怎么动。世界很大，别只在屏幕里看它。',
        '一整天没有出门的记录。哪怕只是下楼走两圈，也算给自己换了个背景。',
        '出行 0 元。有些钱省下来是赚，有些风景错过就是错过了。',
      ],
    },
    transport_high: {
      emoji: '🚕', tag: '出行', tone: 'warn', lines: [
        '昨天出行花了 {transportAmt}，占 {transportPct}%。下次试试地铁或公交？',
        '打车有点多哦。省下的路费，够给自己买杯好咖啡了。',
        '出行 {transportAmt}，占 {transportPct}%。赶时间没办法，不赶时间的话，路上也是风景。',
        '昨天交通费 {transportAmt}。如果这周路线固定，办张月卡会省不少。',
        '出行占了 {transportPct}%。偶尔提前十分钟出门，就能省下一趟车的钱。',
      ],
    },
    fun_zero: {
      emoji: '🎈', tag: '娱乐', tone: 'cheer', lines: [
        '昨天没有娱乐支出。生活不只有账单，也给自己留一点开心的预算吧。',
        '一整天都在正经事上，辛苦啦。周末去看场电影怎么样？',
        '娱乐支出为 0。省钱是好事，但快乐也需要一点点投入。',
        '昨天没有一笔钱是花在「玩」上的。忙是忙，可别把日子过成待办清单。',
        '娱乐 0 元。提醒一句：不花钱的快乐也是快乐，散步、晒太阳、和朋友聊会儿天都算。',
      ],
    },
    fun_high: {
      emoji: '🎮', tag: '娱乐', tone: 'warn', lines: [
        '昨天娱乐花了 {funAmt}，占 {funPct}%。玩得开心就好，记得看看预算还剩多少。',
        '娱乐占比 {funPct}%，有点高。快乐其实可以很便宜 —— 散步、看云、听歌都算。',
        '昨天在玩上花了 {funAmt}（{funPct}%）。开心是刚需，但也别让快乐变成月底的压力。',
        '娱乐 {funPct}%。如果这笔钱买到了一整天的好心情，那就不算贵。',
        '昨天娱乐支出 {funAmt}。下次可以先看看有没有免费替代方案，再决定要不要花。',
      ],
    },
    study_zero: {
      emoji: '📚', tag: '学习', tone: 'cheer', lines: [
        '最近几天都没有学习支出。一本书、一门课，都是给自己的长期投资。',
        '已经连续 {streak} 天记账了，很厉害。要不要也给自己投一点在学习上？',
        '这段时间没有学习类的支出。免费的知识也很多，比如一本书、一个播客、一段公开课。',
        '学习支出为 0。存钱是为了未来，学东西也是 —— 两条路可以一起走。',
        '最近没在学习上花钱。如果只是没花钱但在学，那更厉害。',
      ],
    },
    health: {
      emoji: '💊', tag: '医疗', tone: 'care', lines: [
        '昨天有 {healthAmt} 的医疗支出。身体最重要，记得好好休息。',
        '看到你有医疗花费，别硬扛，该看医生就看医生。健康第一。',
        '昨天花了 {healthAmt} 在健康上。这是最不该省的一笔钱。',
        '昨天有 {healthAmt} 的医疗支出。药要按时吃，觉要按时睡。',
        '身体在提醒你了（{healthAmt}）。钱可以再赚，身体只有一个。',
      ],
    },
    social_high: {
      emoji: '🎁', tag: '人情', tone: 'care', lines: [
        '昨天人情往来花了 {socialAmt}。心意到了就好，不必事事都靠花钱表达。',
        '人情支出占 {socialPct}%。关系是靠相处，不只是靠请客。',
        '昨天人情花了 {socialAmt}（{socialPct}%）。该花的花，但别为了面子透支里子。',
        '人情往来 {socialAmt}。真正在意你的人，不会用你花了多少来衡量。',
        '昨天在人情上花了 {socialPct}% 的支出。值得的人，花得值；不值得的，下次可以说不。',
      ],
    },
    shopping_high: {
      emoji: '🛍', tag: '购物', tone: 'warn', lines: [
        '昨天购物花了 {shoppingAmt}，占 {shoppingPct}%。买之前先问自己：真的需要吗？',
        '购物占比 {shoppingPct}%，有点冲动了。放购物车一晚，明天还想要再买。',
        '昨天购物 {shoppingAmt}（{shoppingPct}%）。如果这笔是计划内的，那就没问题。',
        '购物花了 {shoppingAmt}。下单前那三秒的犹豫，往往就是最省钱的时刻。',
        '昨天购物占比 {shoppingPct}%。东西买回来要用得上，才算真的便宜。',
      ],
    },
    tiny: {
      emoji: '🌱', tag: '支出', tone: 'care', lines: [
        '昨天只花了 {total}，很克制。省下来的钱，记得给未来的自己留一份。',
        '昨天支出很少（{total}）。节俭是好事，但别在健康和省钱之间选错。',
        '昨天只记了 {count} 笔，共 {total}。攒钱的样子，挺酷的。',
        '昨天一共 {total}，{count} 笔。低消费的一天，也是一种自由。',
        '昨天花了 {total}。省下来的不是数字，是以后可以选择的余地。',
      ],
    },
    big: {
      emoji: '💸', tag: '支出', tone: 'warn', lines: [
        '昨天花了 {total}，比平时高出不少。偶尔一次没关系，记得看看这个月的预算。',
        '昨天支出 {total}，是近期日均的好几倍。有什么特别的开销吗？',
        '昨天 {count} 笔共 {total}，节奏有点猛。今天缓一缓？',
        '昨天支出 {total}。如果是必要的大额支出，那就坦然；如果是随手花的，今天收一收。',
        '一天 {total}，{count} 笔。钱花在哪了，账本都替你记着。',
        '昨天 {total}。别急着自责，先看看这笔钱换回了什么。',
      ],
    },
    surplus: {
      emoji: '💰', tag: '结余', tone: 'praise', lines: [
        '昨天收入 {income}，结余 {net}。稳稳的，很棒。',
        '昨天有 {income} 进账，还结余了 {net}。记得给攒钱目标转一点？',
        '昨天进账 {income}，花完还剩 {net}。留得住的钱，才是自己的钱。',
        '收入 {income}，结余 {net}。这一刻的从容，是之前攒下来的。',
        '昨天结余 {net}。趁着有余力，给未来的自己挪一点过去吧。',
      ],
    },
    streak: {
      emoji: '🔥', tag: '坚持', tone: 'praise', lines: [
        '已经连续 {streak} 天记账了。这份坚持，本身就是一种富有。',
        '连续 {streak} 天记账，很了不起。看得见的数字，才是能改变的数字。',
        '{streak} 天没有断过。你比大多数人更了解自己的钱去哪了。',
        '第 {streak} 天了。记账最难的不是开始，是每天都记得。',
        '连续 {streak} 天。这种小事上的稳定，会慢慢变成生活里的底气。',
      ],
    },
    balanced: {
      emoji: '⚖️', tag: '节奏', tone: 'praise', lines: [
        '昨天 {count} 笔支出分布得挺均衡，最大的 {topName} 也只占 {topPct}%。节奏很好。',
        '昨天花得很有章法：{count} 笔，各类都照顾到了。继续保持。',
        '昨天 {count} 笔，最大的一项 {topName} 占 {topPct}%。没有偏科，很稳。',
        '昨天的消费结构挺健康：该吃的吃了，该省的省了。',
        '{count} 笔支出，分布均匀。这种节奏，比某天特别省更值钱。',
      ],
    },
    fallback: {
      emoji: '☀️', tag: '日常', tone: 'care', lines: [
        '昨天共 {count} 笔支出，合计 {total}。数字背后，是你认真生活的样子。',
        '昨天花了 {total}，{count} 笔。今天也照顾好自己。',
        '昨天 {count} 笔，{total}。记下来，就比模糊记得强。',
        '昨天 {count} 笔支出，共 {total}。平平常常的一天，也值得被记住。',
        '昨天花了 {total}。没什么特别的，这就挺好。',
        '昨天 {count} 笔，{total}。日子就是这样一笔一笔过出来的。',
      ],
    },
  };

  // ------------------------------------------------------------
  // 规则表
  // priority 越大越优先，最终只展示前 3 条
  // ------------------------------------------------------------
  const RULES = [
    { id: 'empty', when: (c) => c.count === 0, priority: 92 },
    { id: 'health', when: (c) => c.healthAmt > 0, priority: 88 },
    { id: 'food_low', when: (c) => c.total > 0 && c.foodPct < 0.18, priority: 82 },
    { id: 'transport_zero', when: (c) => c.total > 0 && c.transportAmt === 0, priority: 76 },
    { id: 'surplus', when: (c) => c.income > 0 && c.net > 0, priority: 72 },
    { id: 'streak', when: (c) => c.streak >= 7, priority: 70 },
    { id: 'tiny', when: (c) => c.total > 0 && c.total < 2000, priority: 66 },
    { id: 'fun_zero', when: (c) => c.total > 0 && c.funAmt === 0 && c.count >= 2, priority: 62 },
    { id: 'big', when: (c) => c.total > 0 && c.otherAvg > 0 && c.total > c.otherAvg * 2.5, priority: 60 },
    { id: 'food_high', when: (c) => c.total > 0 && c.foodPct > 0.6, priority: 56 },
    { id: 'shopping_high', when: (c) => c.shoppingPct > 0.45, priority: 54 },
    { id: 'transport_high', when: (c) => c.transportPct > 0.4, priority: 50 },
    { id: 'social_high', when: (c) => c.socialPct > 0.35, priority: 48 },
    { id: 'fun_high', when: (c) => c.funPct > 0.45, priority: 46 },
    { id: 'study_zero', when: (c) => c.total > 0 && c.studyAmt === 0 && c.streak >= 3, priority: 42 },
    { id: 'balanced', when: (c) => c.count >= 3 && c.topPct > 0 && c.topPct < 0.4, priority: 34 },
  ];

  // ------------------------------------------------------------
  // 工具
  // ------------------------------------------------------------
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function fmt(str, ctx) {
    return String(str).replace(/\{(\w+)\}/g, (m, k) => (ctx[k] == null ? m : ctx[k]));
  }

  function yesterdayTs() {
    const d = U.addDays(new Date(), -1);
    return U.startOfDay(d).getTime();
  }

  function expenseBetween(s, e) {
    let n = 0;
    S.state.tx.forEach((t) => {
      if (t.type === 'expense' && t.ts >= s && t.ts <= e) n += t.amount;
    });
    return n;
  }

  /** 连续记账天数（截止到 dayTs 当天，且当天必须有记录） */
  function streakOf(dayTs) {
    let n = 0;
    let cur = U.startOfDay(dayTs);
    while (n < 400) {
      const s = cur.getTime();
      const e = U.endOfDay(cur).getTime();
      const has = S.state.tx.some((t) => t.ts >= s && t.ts <= e);
      if (!has) break;
      n++;
      cur = U.addDays(cur, -1);
    }
    return n;
  }

  /** 前 days 天（不含 dayTs 及其前一天）的日均支出 */
  function otherAvg(dayTs, days) {
    let total = 0;
    for (let i = 2; i < days + 2; i++) {
      const d = U.addDays(dayTs, -i);
      total += expenseBetween(U.startOfDay(d).getTime(), U.endOfDay(d).getTime());
    }
    return total / days;
  }

  function context(dayTs) {
    const day = U.startOfDay(dayTs);
    const s = day.getTime();
    const e = U.endOfDay(day).getTime();
    const list = S.state.tx.filter((t) => t.ts >= s && t.ts <= e);
    const p = { key: 'D:' + U.ymd(day), label: U.humanDate(s), start: day, end: new Date(e), days: 1, type: 'day' };
    const sum = S.summary(p, list);

    const find = (id) => sum.byCat.find((c) => c.id === id);
    const amt = (id) => (find(id) ? find(id).amount : 0);
    const pct = (id) => (find(id) ? find(id).pct : 0);

    const prevDay = U.addDays(day, -1);
    const prevTotal = expenseBetween(U.startOfDay(prevDay).getTime(), U.endOfDay(prevDay).getTime());
    const top = sum.byCat[0];

    return {
      day, dateKey: U.ymd(day), list, sum,
      dateLabel: U.humanDate(s),
      week: '周' + U.WEEK_CN[day.getDay()],
      total: sum.expense, income: sum.income, net: sum.net,
      count: sum.count, expCount: sum.expCount,
      totalTxt: U.money(sum.expense), incomeTxt: U.money(sum.income), netTxt: U.money(sum.net),
      prevTotal,
      otherAvg: otherAvg(day, 7),
      streak: streakOf(day),
      topName: top ? top.meta.name : '',
      topPct: top ? top.pct : 0,
      foodPct: pct('food'), foodAmt: amt('food'),
      transportPct: pct('transport'), transportAmt: amt('transport'),
      funPct: pct('fun'), funAmt: amt('fun'),
      shoppingPct: pct('shopping'), shoppingAmt: amt('shopping'),
      socialPct: pct('social'), socialAmt: amt('social'),
      healthAmt: amt('health'), studyAmt: amt('study'),
      byCat: sum.byCat,
    };
  }

  /** 把原始 context 转成文案里可用的字符串表（百分比只给数字，% 由文案自己写） */
  function display(c) {
    return {
      date: c.dateLabel,
      week: c.week,
      total: c.totalTxt,
      income: c.incomeTxt,
      net: c.netTxt,
      count: c.count,
      streak: c.streak,
      topName: c.topName,
      topPct: Math.round(c.topPct * 100),
      foodPct: Math.round(c.foodPct * 100),
      foodAmt: U.money(c.foodAmt),
      transportPct: Math.round(c.transportPct * 100),
      transportAmt: U.money(c.transportAmt),
      funPct: Math.round(c.funPct * 100),
      funAmt: U.money(c.funAmt),
      shoppingPct: Math.round(c.shoppingPct * 100),
      shoppingAmt: U.money(c.shoppingAmt),
      socialPct: Math.round(c.socialPct * 100),
      socialAmt: U.money(c.socialAmt),
      healthAmt: U.money(c.healthAmt),
      studyAmt: U.money(c.studyAmt),
    };
  }

  // ------------------------------------------------------------
  // 生成
  // ------------------------------------------------------------
  function offset() {
    const t = S.settings.tip;
    return (t && Number(t.offset)) || 0;
  }

  function enabled() {
    const t = S.settings.tip;
    return !t || t.enabled !== false;
  }

  /** 显示位置：add（记账页完整卡片）/ slim（只显示单行）/ off（不显示） */
  function place() {
    const t = S.settings.tip;
    return (t && t.place) || 'add';
  }

  let cacheKey = '';
  let cacheVal = null;

  /** 生成某一天的提示对象 */
  function forDate(dayTs) {
    const c = context(dayTs);
    const off = offset();
    const key = c.dateKey + '|' + S.state.tx.length + '|' + off;
    if (key === cacheKey) return cacheVal;

    const d = display(c);
    const hit = RULES.filter((r) => {
      try { return r.when(c); } catch (e) { return false; }
    }).sort((a, b) => b.priority - a.priority);

    const picked = hit.slice(0, 3);
    if (!picked.length) picked.push({ id: 'fallback', priority: 0 });

    const items = picked.map((r) => {
      const copy = COPY[r.id] || COPY.fallback;
      const seed = c.dateKey + ':' + r.id + ':' + off;
      const line = copy.lines[hash(seed) % copy.lines.length];
      return {
        id: r.id,
        emoji: copy.emoji,
        tag: copy.tag,
        tone: copy.tone,
        text: fmt(line, d),
      };
    });

    cacheVal = {
      dateKey: c.dateKey,
      dateLabel: c.dateLabel,
      week: c.week,
      stats: {
        total: c.total, income: c.income, net: c.net,
        count: c.count, streak: c.streak,
      },
      ctx: c,
      items,
    };
    cacheKey = key;
    return cacheVal;
  }

  function forYesterday() {
    return forDate(yesterdayTs());
  }

  function shuffle() {
    const cur = offset();
    S.setSettings({ tip: { offset: cur + 1 } });
    cacheKey = '';
    return cur + 1;
  }

  // ------------------------------------------------------------
  // AI 增强（可选）
  // 不填 Key 时下面所有函数都直接返回 null，页面走纯本地规则。
  // ------------------------------------------------------------
  function aiReady() {
    return !!(global.AI && global.AI.ready());
  }

  /** 已缓存的昨日 AI 文案；没有则 null */
  function aiTip() {
    if (!aiReady()) return null;
    try { return global.AI.cachedDaily(yesterdayTs()); } catch (e) { return null; }
  }

  const MOOD_EMOJI = { good: '🌞', ok: '🌤', warn: '🌥' };

  /** 生成（或重新生成）昨日 AI 文案 */
  async function aiGenerate() {
    if (!global.AI) throw new Error('AI 模块未加载');
    if (!global.AI.ready()) throw new Error('还没有配置 AI 接口');
    return global.AI.dailyTip(yesterdayTs(), { force: true });
  }

  // ------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------
  function renderCard() {
    if (!enabled() || place() === 'off' || place() === 'slim' || !S.state.tx.length) return '';
    const t = forYesterday();
    const ai = aiTip();
    const first = t.items[0];

    if (ai) {
      return `
        <div class="tip-card tone-ai ai-on">
          <div class="tip-top">
            <span class="tip-ic">${MOOD_EMOJI[ai.mood] || '🌤'}</span>
            <div class="tip-head-txt">
              <b>${U.escapeHtml(ai.headline || '昨日小结')}</b>
              <span>${U.escapeHtml(t.dateLabel)} ${t.week} · ${t.stats.count} 笔 · ${U.money(t.stats.total)}</span>
            </div>
            <button class="tip-arrow" data-tip="open" type="button" aria-label="查看全部">${Icons.svg('chevronRight', 15)}</button>
          </div>
          <div class="tip-lines">
            <div class="tip-line">
              <span class="tip-e">💬</span>
              <span class="tip-t">${U.escapeHtml(ai.text)}</span>
            </div>
            ${ai.tip ? `<div class="tip-line tip-line--advice">
              <span class="tip-e">💡</span>
              <span class="tip-t">${U.escapeHtml(ai.tip)}</span>
            </div>` : ''}
          </div>
          <div class="tip-foot">
            <span class="tip-tag tip-tag--ai">AI · ${U.escapeHtml(String(ai.model || '').replace(/^.*\//, '').slice(0, 18))}</span>
            <button class="tip-refresh" data-tip="shuffle" type="button">${Icons.svg('refresh', 12)} 换一句</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="tip-card tone-${first.tone}">
        <div class="tip-top">
          <span class="tip-ic">🌤</span>
          <div class="tip-head-txt">
            <b>昨日小结</b>
            <span>${U.escapeHtml(t.dateLabel)} ${t.week} · ${t.stats.count} 笔 · ${U.money(t.stats.total)}</span>
          </div>
          <button class="tip-arrow" data-tip="open" type="button" aria-label="查看全部">${Icons.svg('chevronRight', 15)}</button>
        </div>
        <div class="tip-lines">
          ${t.items.map((it) => `
            <div class="tip-line">
              <span class="tip-e">${it.emoji}</span>
              <span class="tip-t">${U.escapeHtml(it.text)}</span>
            </div>`).join('')}
        </div>
        <div class="tip-foot">
          <span class="tip-tag">${U.escapeHtml(first.tag)}</span>
          <button class="tip-refresh" data-tip="shuffle" type="button">${Icons.svg('refresh', 12)} 换一句</button>
        </div>
      </div>
    `;
  }

  function renderSlim() {
    if (!enabled() || place() === 'off' || !S.state.tx.length) return '';
    const t = forYesterday();
    const ai = aiTip();
    const first = t.items[0];
    const text = ai ? (ai.headline ? ai.headline + '：' + ai.text : ai.text) : first.text;
    const emoji = ai ? (MOOD_EMOJI[ai.mood] || '🌤') : first.emoji;
    const tone = ai ? 'ai' : first.tone;
    return `
      <button class="tip-slim tone-${tone}" data-tip="open" type="button">
        <span class="tip-slim-e">${emoji}</span>
        <span class="tip-slim-t">${U.escapeHtml(text)}</span>
        ${Icons.svg('chevronRight', 14)}
      </button>
    `;
  }

  function openSheet() {
    const t = forYesterday();
    const c = t.ctx;
    const ai = aiTip();
    const cats = c.byCat.slice(0, 8);
    const max = cats.length ? cats[0].amount : 0;

    const body = `
      <div class="tip-sheet">
        <div class="tip-sheet-head">
          <div class="tsh-date">${U.escapeHtml(U.fullDate(c.day.getTime()))}</div>
          <div class="tsh-nums">
            <div><span>支出</span><b>${U.money(c.total)}</b></div>
            <div><span>收入</span><b class="in">${U.money(c.income)}</b></div>
            <div><span>笔数</span><b>${c.count}</b></div>
            <div><span>结余</span><b class="${c.net < 0 ? 'neg' : ''}">${U.money(c.net)}</b></div>
          </div>
        </div>

        <div id="tip-ai-slot">${renderAiBlock(ai)}</div>

        <div class="tip-sheet-lines">
          ${t.items.map((it) => `
            <div class="tip-line tone-${it.tone}">
              <span class="tip-e">${it.emoji}</span>
              <span class="tip-t">${U.escapeHtml(it.text)}</span>
            </div>`).join('')}
        </div>

        ${cats.length ? `
          <div class="tip-sheet-cats">
            <div class="tsc-title">支出分布</div>
            ${cats.map((x) => `
              <div class="tsc-row">
                <span class="tsc-ic" style="background:${x.meta.color}1A">${x.meta.icon}</span>
                <span class="tsc-name">${U.escapeHtml(x.meta.name)}</span>
                <span class="tsc-track"><i style="width:${max ? (x.amount / max) * 100 : 0}%;background:${x.meta.color}"></i></span>
                <span class="tsc-amt">${U.money(x.amount, { decimals: 0 })}</span>
                <span class="tsc-pct">${Math.round(x.pct * 100)}%</span>
              </div>`).join('')}
          </div>` : ''}

        <div class="tip-sheet-foot">
          ${aiReady() ? `<button class="btn btn--ghost btn--sm" data-tip="ai" type="button">${Icons.svg('sparkle', 13)} ${ai ? '重新生成' : 'AI 写一段'}</button>` : ''}
          <button class="btn btn--ghost btn--sm" data-tip="shuffle" type="button">${Icons.svg('refresh', 13)} 换一句</button>
          <button class="btn btn--primary btn--sm" data-tip="off" type="button">关掉提示</button>
        </div>

        <div class="tip-sheet-note">${ai
          ? '上面带 ✨ 的部分由你自己配置的 AI 接口生成；其余内容与统计全部在本地计算。'
          : '提示由本地规则根据你昨天的记账数据生成，不联网、不上传任何信息。'}</div>
      </div>
    `;

    UI.openSheet({
      title: '暖心提示',
      content: body,
      onMount(el, close) {
        el.querySelectorAll('[data-tip]').forEach((b) => {
          b.addEventListener('click', async () => {
            const act = b.dataset.tip;
            if (act === 'shuffle') {
              shuffle();
              close();
              setTimeout(() => openSheet(), 180);
            } else if (act === 'ai') {
              const slot = el.querySelector('#tip-ai-slot');
              if (slot) slot.innerHTML = renderAiBlock(null, true);
              try {
                const out = await aiGenerate();
                if (slot) slot.innerHTML = renderAiBlock(out);
                App.refresh();
                U.toast('AI 已写好', 'success');
              } catch (e) {
                if (slot) slot.innerHTML = renderAiBlock(null, false, e.message || '生成失败');
              }
            } else if (act === 'off') {
              S.setSettings({ tip: { enabled: false } });
              close();
              U.toast('已关闭暖心提示', 'info');
              App.refresh();
            }
          });
        });
      },
    });
  }

  /** 弹层里的 AI 区块 */
  function renderAiBlock(ai, busy, err) {
    if (busy) {
      return `<div class="tip-ai-box">
        <div class="tip-ai-head"><span class="tip-ai-spin"></span> AI 正在读你昨天的账…</div>
        <div class="tip-ai-skeleton"><i></i><i></i><i></i></div>
      </div>`;
    }
    if (err) {
      return `<div class="tip-ai-box tip-ai-box--err">
        <div class="tip-ai-head">⚠️ AI 没能生成</div>
        <div class="tip-ai-body">${U.escapeHtml(err)}</div>
        <div class="tip-ai-hint">可以再点一次「AI 写一段」重试，或去设置里检查接口配置。</div>
      </div>`;
    }
    if (!ai) {
      return `<div class="tip-ai-box tip-ai-box--invite">
        <div class="tip-ai-head">${Icons.svg('sparkle', 14)} 想让这段话更生动？</div>
        <div class="tip-ai-hint">接入你自己的 AI 接口，就能让 AI 每天写一段专属于你的小结。</div>
      </div>`;
    }
    return `<div class="tip-ai-box tip-ai-box--done">
      <div class="tip-ai-head">${Icons.svg('sparkle', 14)} ${U.escapeHtml(ai.headline || 'AI 小结')}</div>
      <div class="tip-ai-body">${U.escapeHtml(ai.text)}</div>
      ${ai.tip ? `<div class="tip-ai-advice">💡 ${U.escapeHtml(ai.tip)}</div>` : ''}
      <div class="tip-ai-meta">由 ${U.escapeHtml(String(ai.model || '').replace(/^.*\//, ''))} 生成</div>
    </div>`;
  }

  function bind(root) {
    root.querySelectorAll('[data-tip]').forEach((b) => {
      if (b.__tipBound) return;
      b.__tipBound = true;
      b.addEventListener('click', async () => {
        const act = b.dataset.tip;
        if (act === 'open') openSheet();
        else if (act === 'shuffle') {
          // 有 AI 时，「换一句」= 让 AI 重写；没 AI 时切本地文案
          if (aiReady()) {
            U.vibrate(6);
            b.disabled = true;
            const old = b.innerHTML;
            b.innerHTML = 'AI 写作中…';
            try {
              await aiGenerate();
              App.refresh();
              U.toast('AI 已换一段', 'success');
            } catch (e) {
              U.toast(e.message || '生成失败', 'error');
            } finally {
              b.disabled = false;
              b.innerHTML = old;
            }
          } else {
            shuffle();
            U.vibrate(6);
            App.refresh();
          }
        }
      });
    });
  }

  global.Tips = {
    enabled, place, forDate, forYesterday, shuffle,
    renderCard, renderSlim, openSheet, bind,
    aiReady, aiTip, aiGenerate,
    clearCache() { cacheKey = ''; cacheVal = null; },
    COPY, RULES,
  };
})(window);
