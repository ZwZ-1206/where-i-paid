/* ============================================================
 * 花哪儿了 · AI 接入层
 * 完全可选：不填 API Key 时本文件不发起任何网络请求。
 * 兼容任何 OpenAI 风格的 /chat/completions 接口
 * （通义千问 / Kimi / 智谱 / 硅基流动 / DeepSeek / 本地 Ollama / 自建网关…）
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  // ------------------------------------------------------------
  // 常见服务商预设（用户可任选，也可完全自定义）
  // ------------------------------------------------------------
  const PRESETS = [
    {
      id: 'dashscope', name: '阿里通义千问', badge: '推荐',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus', visionModel: 'qwen-vl-max',
      keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
      note: '识图效果好，新用户有免费额度',
    },
    {
      id: 'moonshot', name: '月之暗面 Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-8k', visionModel: 'moonshot-v1-8k-vision-preview',
      keyUrl: 'https://platform.moonshot.cn/console/api-keys',
      note: '中文写作自然',
    },
    {
      id: 'bigmodel', name: '智谱 GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash', visionModel: 'glm-4v-flash',
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
      note: 'glm-4-flash / glm-4v-flash 免费',
    },
    {
      id: 'siliconflow', name: '硅基流动',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-7B-Instruct', visionModel: 'Qwen/Qwen2-VL-7B-Instruct',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      note: '聚合多家模型，部分免费',
    },
    {
      id: 'deepseek', name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat', visionModel: '',
      keyUrl: 'https://platform.deepseek.com/api_keys',
      note: '便宜，但没有视觉模型（不能识图）',
    },
    {
      id: 'ollama', name: '本地 Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:7b', visionModel: 'qwen2-vl:7b',
      keyUrl: '', keyOptional: true,
      note: '完全本地，不联网；需先安装 Ollama',
    },
    {
      id: 'custom', name: '自定义 / 其他',
      baseUrl: '', model: '', visionModel: '',
      keyUrl: '', note: '任何 OpenAI 兼容接口都可以填',
    },
  ];

  function preset(id) {
    return PRESETS.find((p) => p.id === id) || PRESETS[0];
  }

  function cfg() {
    return (S.settings && S.settings.ai) || {};
  }

  /** 是否已配置可用（开关打开 + 有 baseUrl + 有 model + 有 key 或该预设允许空 key） */
  function ready() {
    const a = cfg();
    if (!a.enabled) return false;
    if (!a.baseUrl || !a.model) return false;
    if (a.apiKey) return true;
    const p = preset(a.preset);
    return !!p.keyOptional;
  }

  /** 是否支持识图（有视觉模型名） */
  function canVision() {
    const a = cfg();
    return ready() && !!a.visionModel;
  }

  // ------------------------------------------------------------
  // 底层请求
  // ------------------------------------------------------------
  function endpoint() {
    const base = String(cfg().baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('还没有填写 API 地址');
    // 允许用户直接填完整的 /chat/completions
    if (/\/chat\/completions$/.test(base)) return base;
    return base + '/chat/completions';
  }

  async function chat(opts) {
    const a = cfg();
    if (!a.enabled) throw new Error('AI 功能未开启');
    const body = {
      model: opts.model || a.model,
      messages: opts.messages,
      temperature: opts.temperature == null ? Number(a.temperature) || 0.85 : opts.temperature,
      stream: false,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;

    const headers = { 'Content-Type': 'application/json' };
    if (a.apiKey) headers.Authorization = 'Bearer ' + a.apiKey;

    let res;
    try {
      res = await fetch(endpoint(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('连不上接口：' + (e.message || '网络错误') + '（检查地址、网络，或该服务是否允许浏览器直连）');
    }

    const raw = await res.text();
    if (!res.ok) {
      let msg = raw;
      try {
        const j = JSON.parse(raw);
        msg = (j.error && (j.error.message || j.error.code)) || j.message || raw;
      } catch (e) { /* 保留原文 */ }
      throw new Error('接口返回 ' + res.status + '：' + String(msg).slice(0, 240));
    }

    let json;
    try { json = JSON.parse(raw); } catch (e) {
      throw new Error('接口返回的不是 JSON：' + raw.slice(0, 160));
    }
    const choice = json.choices && json.choices[0];
    const content = choice && choice.message && choice.message.content;
    if (!content) throw new Error('接口没有返回内容');
    return { text: String(content), usage: json.usage || null, model: json.model || body.model };
  }

  /** 从模型输出里抠出 JSON（容忍 ```json 包裹、前后废话） */
  function extractJSON(text) {
    let t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const start = t.search(/[[{]/);
    if (start < 0) throw new Error('模型没有返回 JSON');
    const openCh = t[start];
    const closeCh = openCh === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === openCh) depth++;
      else if (ch === closeCh) {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) throw new Error('模型返回的 JSON 不完整');
    const slice = t.slice(start, end + 1);
    try { return JSON.parse(slice); } catch (e) {
      throw new Error('模型返回的 JSON 无法解析');
    }
  }

  async function chatJSON(opts) {
    const sys = opts.system ? [{ role: 'system', content: opts.system }] : [];
    const r = await chat(Object.assign({}, opts, { messages: sys.concat(opts.messages) }));
    return { data: extractJSON(r.text), raw: r.text, usage: r.usage };
  }

  // ------------------------------------------------------------
  // 数据摘要（喂给模型的上下文，控制 token）
  // ------------------------------------------------------------
  function money(cents) {
    return (Number(cents || 0) / 100).toFixed(2);
  }

  function catDigest(byCat) {
    return byCat.slice(0, 10).map((c) => ({
      name: c.meta.name,
      amount: money(c.amount),
      pct: Math.round(c.pct * 100),
      count: c.count,
    }));
  }

  /** 把昨天（或指定日）的数据整理成模型友好的对象 */
  function dayPayload(dayTs) {
    const day = U.startOfDay(dayTs);
    const s = day.getTime();
    const e = U.endOfDay(day).getTime();
    const list = S.state.tx.filter((t) => t.ts >= s && t.ts <= e);
    const p = { key: 'D:' + U.ymd(day), label: U.humanDate(s), start: day, end: new Date(e), days: 1, type: 'day' };
    const sum = S.summary(p, list);
    const prev = U.addDays(day, -1);
    const prevSum = S.summary(
      { key: 'D:' + U.ymd(prev), start: prev, end: U.endOfDay(prev), days: 1, type: 'day' },
      S.state.tx.filter((t) => t.ts >= prev.getTime() && t.ts <= U.endOfDay(prev).getTime())
    );
    const b = S.budgetStatus(S.currentPeriod());
    return {
      date: U.ymd(day),
      weekday: '周' + U.WEEK_CN[day.getDay()],
      expense: money(sum.expense),
      income: money(sum.income),
      net: money(sum.net),
      count: sum.count,
      cats: catDigest(sum.byCat),
      top: sum.byCat[0] ? sum.byCat[0].meta.name : '',
      prevExpense: money(prevSum.expense),
      items: list.slice(0, 12).map((t) => ({
        cat: Icons.cat(t.catId).name,
        sub: t.sub || '',
        amount: money(t.amount),
        note: t.note || '',
      })),
      budget: b.total ? {
        limit: money(b.total), spent: money(b.spent),
        pct: Math.round(b.pct * 100), level: b.level, daysLeft: b.daysLeft,
      } : null,
    };
  }

  function monthPayload(p) {
    const list = S.txIn(p);
    const sum = S.summary(p, list);
    const b = S.budgetStatus(p);
    const series = S.dailySeries(p);
    const byAccount = sum.byAccountList || [];
    return {
      period: p.label,
      days: p.days,
      expense: money(sum.expense),
      income: money(sum.income),
      net: money(sum.net),
      count: sum.count,
      avgDaily: money(sum.avgDaily),
      cats: catDigest(sum.byCat),
      accounts: byAccount.slice(0, 5).map((a) => ({ name: a.meta.name, amount: money(a.amount) })),
      daily: series.map((d) => ({ day: d.day, amount: money(d.amount) })),
      topDay: series.reduce((a, d) => (d.amount > a.amount ? d : a), { day: 0, amount: 0 }),
      budget: b.total ? {
        limit: money(b.total), spent: money(b.spent),
        pct: Math.round(b.pct * 100), level: b.level,
      } : null,
    };
  }

  // ------------------------------------------------------------
  // ① 每日总结
  // ------------------------------------------------------------
  const STYLE_DESC = {
    warm: '温暖体贴，像一个懂你的朋友，不说教、不指责',
    plain: '平实克制，像一个严谨的记账助手，只讲事实和数字',
    funny: '轻松幽默，可以玩梗，但不油腻、不冒犯',
  };

  function dailySig(dayTs) {
    const day = U.startOfDay(dayTs);
    const s = day.getTime();
    const e = U.endOfDay(day).getTime();
    const list = S.state.tx.filter((t) => t.ts >= s && t.ts <= e);
    return list.length + ':' + list.reduce((a, t) => a + t.amount, 0);
  }

  async function dailyTip(dayTs, opts) {
    const o = opts || {};
    const day = U.startOfDay(dayTs || U.addDays(new Date(), -1));
    const key = U.ymd(day);
    const cache = cfg().dailyCache || {};
    const hit = cache[key];
    const sig = dailySig(day);
    if (!o.force && hit && hit.sig === sig && hit.text) return hit;

    const payload = dayPayload(day);
    const style = STYLE_DESC[cfg().style] || STYLE_DESC.warm;

    const sys = [
      '你是一个记账 App 里的「每日小结」撰写者。',
      '用户刚过完一天，你要根据他这一天的真实消费数据，写一段走心但不说教的短评。',
      '风格：' + style + '。',
      '硬性要求：',
      '1. 只输出 JSON，不要任何解释、不要 markdown 代码块。',
      '2. 必须引用真实数字（金额或占比），不能编造数据里没有的信息。',
      '3. 不要说「作为AI」「根据数据」这类废话。',
      '4. 中文，全角标点。',
      'JSON 结构：{"headline":"不超过14字的短标题","text":"60-110字的正文，一到两句话","tip":"一句可执行的小建议，不超过20字","mood":"good|ok|warn 三选一"}',
    ].join('\n');

    const user = [
      '这是我这一天的消费数据（单位：元）：',
      JSON.stringify(payload, null, 1),
      '',
      '请写今天的每日小结。',
    ].join('\n');

    const r = await chatJSON({
      system: sys,
      messages: [{ role: 'user', content: user }],
      temperature: Number(cfg().temperature) || 0.85,
      maxTokens: 600,
    });

    const d = r.data || {};
    const out = {
      text: String(d.text || '').trim(),
      headline: String(d.headline || '').trim(),
      tip: String(d.tip || '').trim(),
      mood: ['good', 'ok', 'warn'].indexOf(d.mood) >= 0 ? d.mood : 'ok',
      dateKey: key,
      sig,
      ts: Date.now(),
      model: r.model || cfg().model,
    };
    if (!out.text) throw new Error('模型没有给出正文');

    const next = Object.assign({}, cache);
    next[key] = out;
    // 只保留最近 60 天，防止 localStorage 膨胀
    const keys = Object.keys(next).sort();
    while (keys.length > 60) delete next[keys.shift()];
    S.setSettings({ ai: { dailyCache: next } });
    return out;
  }

  function cachedDaily(dayTs) {
    const key = U.ymd(U.startOfDay(dayTs || U.addDays(new Date(), -1)));
    const hit = (cfg().dailyCache || {})[key];
    return hit && hit.text ? hit : null;
  }

  // ------------------------------------------------------------
  // ② 月度总结 + 图表决策
  // ------------------------------------------------------------
  function monthSig(p) {
    const list = S.txIn(p);
    return p.key + ':' + list.length + ':' + list.reduce((a, t) => a + t.amount, 0);
  }

  async function monthReport(p, opts) {
    const o = opts || {};
    const sig = monthSig(p);
    const cache = cfg().monthCache || {};
    const hit = cache[p.key];
    if (!o.force && hit && hit.sig === sig && hit.story) return hit;

    const payload = monthPayload(p);
    const style = STYLE_DESC[cfg().style] || STYLE_DESC.warm;

    const sys = [
      '你是一个记账 App 里的「月度总结」撰写者兼数据分析师。',
      '风格：' + style + '。',
      '你要做两件事：① 写一段有洞察的月度总结；② 决定这个月最值得画的那张图。',
      '硬性要求：',
      '1. 只输出 JSON，不要 markdown 代码块，不要解释。',
      '2. 所有结论必须有数据支撑，引用真实金额/占比，不许编造。',
      '3. 中文，全角标点。',
      'JSON 结构：',
      '{',
      '  "headline": "不超过16字的本月一句话总结",',
      '  "story": "120-200字的月度叙述，要有洞察，指出变化和原因推测",',
      '  "highlights": [{"label":"标签，不超过6字","value":"数值或短句"}],  // 恰好 3 条',
      '  "advice": ["建议1，不超过24字","建议2，不超过24字"],  // 恰好 2 条',
      '  "chart": {',
      '    "type": "donut|bars|compare",',
      '    "title": "这张图的标题，不超过12字",',
      '    "dimension": "cat|day|account",',
      '    "reason": "为什么选这张图，不超过20字"',
      '  }',
      '}',
      'chart.type 说明：donut=分类占比环形图；bars=逐日柱状趋势图；compare=分类与上月对比条形图。',
      'chart.dimension：cat=按分类，day=按日期，account=按支付账户。请根据本月数据特征挑最有信息量的组合。',
    ].join('\n');

    const user = [
      '这是本月的账目汇总（单位：元）：',
      JSON.stringify(payload, null, 1),
      '',
      '请输出月度总结 JSON。',
    ].join('\n');

    const r = await chatJSON({
      system: sys,
      messages: [{ role: 'user', content: user }],
      temperature: Number(cfg().temperature) || 0.85,
      maxTokens: 1200,
    });

    const d = r.data || {};
    const chart = d.chart && typeof d.chart === 'object' ? d.chart : {};
    const out = {
      headline: String(d.headline || '').trim(),
      story: String(d.story || '').trim(),
      highlights: Array.isArray(d.highlights) ? d.highlights.slice(0, 3).map((h) => ({
        label: String((h && h.label) || '').slice(0, 12),
        value: String((h && h.value) || '').slice(0, 24),
      })) : [],
      advice: Array.isArray(d.advice) ? d.advice.slice(0, 3).map((a) => String(a).slice(0, 60)) : [],
      chart: {
        type: ['donut', 'bars', 'compare'].indexOf(chart.type) >= 0 ? chart.type : 'donut',
        title: String(chart.title || '支出结构').slice(0, 20),
        dimension: ['cat', 'day', 'account'].indexOf(chart.dimension) >= 0 ? chart.dimension : 'cat',
        reason: String(chart.reason || '').slice(0, 40),
      },
      periodKey: p.key,
      periodLabel: p.label,
      sig,
      ts: Date.now(),
      model: r.model || cfg().model,
    };
    if (!out.story) throw new Error('模型没有给出正文');

    const next = Object.assign({}, cache);
    next[p.key] = out;
    const keys = Object.keys(next).sort();
    while (keys.length > 24) delete next[keys.shift()];
    S.setSettings({ ai: { monthCache: next } });
    return out;
  }

  function cachedMonth(p) {
    const hit = (cfg().monthCache || {})[p.key];
    return hit && hit.story ? hit : null;
  }

  // ------------------------------------------------------------
  // ③ 识图记账（AI 视觉）
  // ------------------------------------------------------------
  const SCAN_SYS = [
    '你是一个记账 App 的「截图识别引擎」。',
    '用户会上传一张截图，可能是微信支付、支付宝、拼多多、美团、淘宝、银行 App 的账单或订单详情。',
    '你要从中提取出一笔或多笔消费/收入，并归类。',
    '',
    '【金额规则】',
    '- 优先取「实付金额 / 实付款 / 合计 / 总计」，不要取原价、划线价、优惠前金额、优惠券面额、余额。',
    '- 若有多件商品，amount 取整单实付总额，items 里列出各商品明细。',
    '- 金额一律输出数字字符串（如 "25.80"），不带货币符号、不带千分位。',
    '- 分辨不出金额就填 "0"。',
    '',
    '【类型】type: "expense" 支出 / "income" 收入。退款、红包收入算 income。',
    '',
    '【分类】catId 只能取以下值之一：',
    'food 餐饮 / market 买菜 / transport 交通 / shopping 购物 / housing 居住 / fun 娱乐 /',
    'health 医疗 / study 学习 / social 人情 / comm 通讯 / pet 宠物 / baby 育儿 /',
    'travel 旅行 / beauty 美容 / car 汽车 / other_out 其他支出 /',
    'salary 工资 / bonus 奖金 / invest 理财 / parttime 兼职 / gift_in 红包收入 / other_in 其他收入',
    '',
    '【二级标签】sub 从分类的常见标签里选，选不到就留空字符串。例如餐饮：早餐/午餐/晚餐/夜宵/外卖/饮料/零食/聚餐。',
    '',
    '【时间】ts 输出 "YYYY-MM-DD HH:mm" 格式；截图里没有日期就用今天。',
    '',
    '【商户】merchant 输出商户或订单标题，如「麦当劳」「拼多多订单」。',
    '',
    '【严格输出 JSON】不要 markdown 代码块，不要任何解释：',
    '{',
    '  "platform": "wechat|alipay|pdd|meituan|taobao|bank|other",',
    '  "entries": [',
    '    {',
    '      "type": "expense",',
    '      "amount": "25.80",',
    '      "catId": "food",',
    '      "sub": "午餐",',
    '      "merchant": "麦当劳",',
    '      "note": "工作日午餐",',
    '      "ts": "2025-01-15 12:30",',
    '      "confidence": 0.92',
    '    }',
    '  ],',
    '  "warning": "如果有看不清或不确定的地方，在这里用一句话说明；没有就填空字符串"',
    '}',
    'entries 可以有多条（一张截图里有多个订单时）。只输出截图上真实存在的记录，不要臆造。',
  ].join('\n');

  async function visionScan(dataUrl, opts) {
    const o = opts || {};
    if (!ready()) throw new Error('还没有配置 AI 接口');
    if (!cfg().visionModel) throw new Error('当前服务没有填写视觉模型，无法识图');

    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: o.hint ? ('识别这张截图里的账目。补充说明：' + o.hint) : '识别这张截图里的账目。' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }];

    const r = await chatJSON({
      system: SCAN_SYS,
      messages,
      model: cfg().visionModel,
      temperature: 0.1,
      maxTokens: 1600,
    });

    return normalizeScan(r.data, 'ai');
  }

  /** 把模型/OCR 的结果统一成内部结构 */
  function normalizeScan(data, engine) {
    const d = data || {};
    const entries = Array.isArray(d.entries) ? d.entries : (d.amount ? [d] : []);
    const out = [];
    entries.forEach((e) => {
      if (!e) return;
      const amt = U.toCents(String(e.amount == null ? '' : e.amount).replace(/[^\d.]/g, ''));
      if (!(amt > 0)) return;
      let catId = String(e.catId || '').trim();
      if (!Icons.CAT_MAP || !Icons.CAT_MAP[catId]) catId = e.type === 'income' ? 'other_in' : 'other_out';
      const meta = Icons.cat(catId);
      let sub = String(e.sub || '').trim();
      if (sub && meta.subs && meta.subs.indexOf(sub) < 0) sub = '';
      let ts = Date.now();
      if (e.ts) {
        const m = String(e.ts).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
        if (m) {
          const dt = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0);
          if (!isNaN(dt.getTime())) ts = dt.getTime();
        }
      }
      out.push({
        type: e.type === 'income' ? 'income' : 'expense',
        amount: amt,
        catId,
        sub,
        merchant: String(e.merchant || '').trim().slice(0, 40),
        note: String(e.note || '').trim().slice(0, 60),
        ts,
        confidence: typeof e.confidence === 'number' ? e.confidence : null,
        engine: engine || 'ai',
      });
    });
    return {
      platform: String(d.platform || 'other'),
      entries: out,
      warning: String(d.warning || ''),
      engine: engine || 'ai',
    };
  }

  // ------------------------------------------------------------
  // ④ 连接测试
  // ------------------------------------------------------------
  async function test() {
    const a = cfg();
    const r = await chat({
      messages: [{ role: 'user', content: '回复两个字：可以' }],
      temperature: 0,
      maxTokens: 16,
    });
    return { ok: true, text: r.text.trim().slice(0, 40), model: r.model, usage: r.usage, visionModel: a.visionModel || '' };
  }

  async function testVision() {
    // 1×1 白色 PNG，只为验证视觉通道是否可用
    const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const r = await chat({
      model: cfg().visionModel,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '这是一张纯白图片。请只回复两个字：可用' },
          { type: 'image_url', image_url: { url: px } },
        ],
      }],
      temperature: 0,
      maxTokens: 16,
    });
    return { ok: true, text: r.text.trim().slice(0, 40) };
  }

  function clearCache() {
    S.setSettings({ ai: { dailyCache: {}, monthCache: {} } });
  }

  global.AI = {
    PRESETS, preset, cfg, ready, canVision,
    chat, chatJSON, extractJSON,
    dailyTip, cachedDaily, dailySig,
    monthReport, cachedMonth, monthSig,
    visionScan, normalizeScan,
    test, testVision, clearCache,
    dayPayload, monthPayload, money,
  };
})(window);
