/* ============================================================
 * 记账本 · 数据层
 * 全部数据保存在浏览器 localStorage，离线可用，可导出备份
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const KEY = 'jizhang.v1';

  const DEFAULT_SETTINGS = {
    cycle: { type: 'month', startDay: 1, weekStart: 1, days: 30, anchor: null },
    budget: { amount: 0, split: {} },             // 单位：分，默认 0：由用户自己在设置里填
    alert: { enabled: true, thresholds: [80, 100], daily: true },
    tip: { enabled: true, offset: 0, place: 'add' },  // 暖心提示
    cats: { hidden: [], overrides: {}, custom: [] },  // 自定义分类
    books: { activeId: 'default' },                   // 多账本（账本实体在 state.books）
    repeat: { enabled: true },                        // 周期性自动记账总开关
    autoSave: { enabled: false, goalId: '', ratio: 1, cap: 0 },   // 余钱归仓
    subAlert: { enabled: true, daysBefore: 3 },                    // 订阅续费提醒
    advance: { enabled: true, remindDays: 0 },                     // 垫付催款提醒
    wish: { enabled: true, hours: 48 },                           // 先别买
    recon: { enabled: false },                                     // 余额反推
    // 情侣账本：默认关闭，不碰任何现有逻辑；只有用户主动同意并填完资料才启用
    couple: {
      enabled: false,
      mode: '',                 // 'local' 同城 / 'remote' 异地
      consent: null,            // { agreed, at, version }
      room: '',                 // 房间 id（上云后才有值）
      salt: '',                 // 房间盐（base64）
      code: '',                 // 配对码明文，只存本机
      peerName: '',             // TA 的昵称
      meName: '',               // 我的昵称
      togetherSince: '',        // 在一起的日期 'YYYY-MM-DD'
      // 生日：只存 'YYYY-MM-DD'，日历上按「月-日」匹配（生日每年都过，不看年）
      meBirthday: '',           // 我的生日
      peerBirthday: '',         // TA 的生日
      since: 0,                 // 已拉取到的服务端 seq
      epoch: 0,
      lastSyncAt: 0,
      notice: '',               // ntfy topic 后缀
      shareRatio: false,        // 反查账：只分享比例不分享金额
      nextMeet: '',             // 异地：下次见面的日子 'YYYY-MM-DD'
      tzOffset: 8,              // 异地：TA 所在时区（UTC+8 记 8）
      activeId: '',             // 当前正在看的那一本（cpBooks 里的 id）
      hidden: false,            // 首页入口收起（和「关闭」不是一回事）
      closedAt: 0,              // 最近一次关闭的时间（7 天内可一键恢复）
      closeReason: '',          // 关闭时选的原因（只有本机看得到）
      deletedAt: 0,             // 最近一次彻底删除的时间
    },
    // 情侣账本：可以有好几本。每本一条，cpTxs / 情侣基金靠 cpBookId 归属。
    // 现在只有一本的时候它就是唯一那条，「换一本新的」才有第二条。
    cpBooks: [],
    ai: {
      enabled: false,          // 默认关闭：不联网、不填 Key 就完全用本地规则
      preset: 'dashscope',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: '',
      model: 'qwen-plus',
      visionModel: 'qwen-vl-max',
      temperature: 0.85,
      style: 'warm',           // warm 温暖 / plain 平实 / funny 幽默
      dailyCache: {},          // { '2025-01-01': {text, ...} } 每日 AI 文案缓存
      monthCache: {},          // { periodKey: {headline, ...} }
    },
    scan: {
      engine: 'auto',          // auto / ai / ocr
      autoFill: true,          // 识别后直接预填表单
      lastEngine: '',
    },
    theme: 'auto',
    nickname: '',
    seeded: false,
    createdAt: null,
  };

  let state = null;
  let saveTimer = null;
  const listeners = [];

  // ------------------------------------------------------------
  // 初始化 / 持久化
  // ------------------------------------------------------------
  function blankState() {
    return {
      version: 1,
      tx: [],
      goals: [],
      books: [{ id: 'default', name: '日常', icon: '📒', color: '#4F7CFF', createdAt: Date.now() }],
      cpTxs: [],          // 情侣账单：独立数据，不属于任何账本（靠 cpBookId 归属某一本情侣账本）
      cpBooks: [],        // 情侣账本列表（可以有好几本，比如换了一段关系）
      repeats: [],
      wishlist: [],       // 先别买：愿望清单
      subs: [],           // 订阅体检：用户确认/忽略的订阅
      recon: [],          // 余额反推：对账记录
      accounts: Icons.ACCOUNTS.map((a) => ({ ...a })),
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      alertLog: {},
    };
  }

  function migrate(raw) {
    const base = blankState();
    if (!raw || typeof raw !== 'object') return base;
    const s = Object.assign(base, raw);
    s.settings = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), raw.settings || {});
    if (!Array.isArray(s.tx)) s.tx = [];
    if (!Array.isArray(s.goals)) s.goals = [];
    if (!Array.isArray(s.accounts) || !s.accounts.length) s.accounts = Icons.ACCOUNTS.map((a) => ({ ...a }));
    if (!s.alertLog || typeof s.alertLog !== 'object') s.alertLog = {};
    s.tx = s.tx.filter((t) => t && typeof t.amount === 'number' && isFinite(t.ts));
    // 多账本：老数据全部归到「日常」
    if (!Array.isArray(s.books) || !s.books.length) {
      s.books = [{ id: 'default', name: '日常', icon: '📒', color: '#4F7CFF', createdAt: Date.now() }];
    }
    if (!s.books.some((b) => b.id === s.settings.books.activeId) && s.settings.books.activeId !== '*') {
      s.settings.books.activeId = s.books[0].id;
    }
    s.tx.forEach((t) => { if (!t.bookId || !s.books.some((b) => b.id === t.bookId)) t.bookId = s.books[0].id; });
    // 周期性记账
    if (!Array.isArray(s.repeats)) s.repeats = [];
    s.repeats.forEach((r) => {
      if (!r.bookId || !s.books.some((b) => b.id === r.bookId)) r.bookId = s.settings.books.activeId;
    });
    // 自定义分类
    const cc = s.settings.cats || {};
    if (!Array.isArray(cc.hidden)) cc.hidden = [];
    if (!Array.isArray(cc.custom)) cc.custom = [];
    if (!cc.overrides || typeof cc.overrides !== 'object') cc.overrides = {};
    s.settings.cats = cc;
    // 账本类型：老账本一律视为普通账本
    s.books.forEach((b) => { if (b.kind !== 'couple') b.kind = 'normal'; });
    // 情侣账单：独立数组，不属于任何账本
    if (!Array.isArray(s.cpTxs)) s.cpTxs = [];
    s.cpTxs = s.cpTxs.filter((t) => t && typeof t.amount === 'number' && isFinite(t.ts));
    // 兼容旧版：以前情侣账目混在 state.tx 里（属于 kind=couple 的账本）。
    // 现在把那些账目整体搬到 cpTxs，并从 tx 里摘掉；情侣账本实体本身也删掉。
    const coupleBooks = s.books.filter((b) => b.kind === 'couple');
    if (coupleBooks.length) {
      const ids = coupleBooks.map((b) => b.id);
      const moved = s.tx.filter((t) => ids.indexOf(t.bookId) >= 0);
      moved.forEach((t) => { t.attrib = ATTRIB_MAP[t.attrib] ? t.attrib : ATTRIB_DEFAULT; });
      s.cpTxs = s.cpTxs.concat(moved.map((t) => {
        const c = Object.assign({}, t);
        delete c.bookId;    // 情侣账单不属于任何账本
        return c;
      }));
      s.tx = s.tx.filter((t) => ids.indexOf(t.bookId) < 0);
      s.books = s.books.filter((b) => b.kind !== 'couple');
      s.repeats = s.repeats.filter((r) => ids.indexOf(r.bookId) < 0);
      if (ids.indexOf(s.settings.books.activeId) >= 0) s.settings.books.activeId = s.books[0].id;
    }
    // 老版本可能只有一本「日常」，删完情侣账本后不能为空
    if (!s.books.length) {
      s.books = [{ id: 'default', name: '日常', icon: '📒', color: '#4F7CFF', createdAt: Date.now() }];
    }
    if (!s.books.some((b) => b.id === s.settings.books.activeId) && s.settings.books.activeId !== '*') {
      s.settings.books.activeId = s.books[0].id;
    }
    s.tx.forEach((t) => { if (!t.bookId || !s.books.some((b) => b.id === t.bookId)) t.bookId = s.books[0].id; });
    // 新功能：愿望清单 / 订阅 / 对账
    if (!Array.isArray(s.wishlist)) s.wishlist = [];
    if (!Array.isArray(s.subs)) s.subs = [];
    if (!Array.isArray(s.recon)) s.recon = [];
    // 老账目补默认字段
    s.tx.forEach((t) => {
      if (t.advance && typeof t.advance === 'object') {
        if (!t.advance.status) t.advance.status = 'open';
        if (!t.advance.who) t.advance.who = '';
        if (t.advance.dueTs == null) t.advance.dueTs = 0;
        if (t.advance.settledAmount == null) t.advance.settledAmount = 0;
      }
      if (t.amountFx == null) t.amountFx = 0;
      if (t.fxRate == null) t.fxRate = 0;
      if (t.fxCode == null) t.fxCode = '';
    });
    // 情侣账单里的老数据补默认印记
    s.cpTxs.forEach((t) => {
      if (!ATTRIB_MAP[t.attrib]) t.attrib = ATTRIB_DEFAULT;
      if (t.amountFx == null) t.amountFx = 0;
      if (t.fxRate == null) t.fxRate = 0;
      if (t.fxCode == null) t.fxCode = '';
    });
    // 旧版存在这里：bookId 已经不需要了
    s.cpTxs.forEach((t) => { if (t.bookId != null) delete t.bookId; });
    // 多本情侣账本：先把散着的数据收到「第一本」名下，再把列表补出来。
    // 顺序很要紧 —— 先补 cpBookId 再建列表，不然新列表里会出现「0 笔记录」的空本。
    if (!Array.isArray(s.cpBooks)) s.cpBooks = [];
    s.cpBooks = s.cpBooks.filter((b) => b && b.id);
    let cpFirst = s.cpBooks[0] || null;
    // 老数据里只要还有账目或基金，就说明这本是被用过的：
    // 开着的记成 active，已经关掉的（enabled:false）记成 closed。
    // 只有「什么都没有、也没开过」才行不建列表 —— 那种情况用户根本没用过。
    const cpWanted = !!s.settings.couple.enabled
      || s.cpTxs.length > 0
      || s.goals.some((g) => g.kind === 'couple')
      || !!(s.settings.couple.meName || s.settings.couple.peerName)
      || !!s.settings.couple.mode;
    if (!cpFirst && cpWanted) {
      cpFirst = {
        id: 'cp1',
        meName: s.settings.couple.meName || '',
        peerName: s.settings.couple.peerName || '',
        mode: s.settings.couple.mode || 'local',
        togetherSince: s.settings.couple.togetherSince || '',
        meBirthday: s.settings.couple.meBirthday || '',
        peerBirthday: s.settings.couple.peerBirthday || '',
        order: 1,
        status: s.settings.couple.enabled ? 'active' : 'closed',
        createdAt: s.settings.couple.createdAt || Date.now(),
        closedAt: 0,
      };
      s.cpBooks.push(cpFirst);
    }
    const cpIds = s.cpBooks.map((b) => b.id);
    // 没有 cpBookId 的老数据一律归第一本（老用户升级后不会少东西）
    s.cpTxs.forEach((t) => {
      if (!t.cpBookId || cpIds.indexOf(t.cpBookId) < 0) t.cpBookId = cpFirst ? cpFirst.id : 'cp1';
    });
    s.goals.forEach((g) => {
      if (g.kind !== 'couple') return;
      if (!g.cpBookId || cpIds.indexOf(g.cpBookId) < 0) g.cpBookId = cpFirst ? cpFirst.id : 'cp1';
    });
    if (!s.settings.couple.activeId || cpIds.indexOf(s.settings.couple.activeId) < 0) {
      s.settings.couple.activeId = cpFirst ? cpFirst.id : '';
    }
    // 情侣目标补 slot（一次性按名字回填，之后认字段不认名字）
    s.goals.forEach((g) => {
      if (g.kind !== 'couple') { if (g.slot == null) g.slot = ''; return; }
      if (g.slot) return;
      const n = g.name || '';
      if (/见面/.test(n)) g.slot = 'meet';
      else if (/约会/.test(n)) g.slot = 'date';
      else g.slot = 'vault';
    });
    Icons.setCustom(cc);
    return s;
  }

  function deepMerge(target, src) {
    Object.keys(src || {}).forEach((k) => {
      const v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        target[k] = deepMerge(target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
      } else if (v !== undefined) {
        target[k] = v;
      }
    });
    return target;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? migrate(JSON.parse(raw)) : blankState();
    } catch (e) {
      console.warn('[store] 读取失败，使用空数据', e);
      state = blankState();
    }
    if (!state.settings.createdAt) state.settings.createdAt = Date.now();
    Icons.setCustom(state.settings.cats);
    return state;
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      U.toast('保存失败：浏览器存储空间不足', 'error');
      console.error(e);
      return false;
    }
  }

  function save(silent) {
    if (silent) return persist();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 60);
    return true;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }
  function emit(evt) {
    listeners.forEach((fn) => { try { fn(evt); } catch (e) { console.error(e); } });
  }

  // ------------------------------------------------------------
  // 记账周期计算
  // ------------------------------------------------------------
  const cyc = () => state.settings.cycle;

  function periodFor(date, cfg) {
    const c = cfg || cyc();
    const d = U.startOfDay(date);
    const y = d.getFullYear();
    const m = d.getMonth();

    if (c.type === 'month') {
      const startDay = U.clamp(Number(c.startDay) || 1, 1, 28);
      let start = U.dateClamped(y, m, startDay);
      if (d.getTime() < start.getTime()) start = U.dateClamped(y, m - 1, startDay);
      const next = U.dateClamped(start.getFullYear(), start.getMonth() + 1, startDay);
      const end = U.endOfDay(U.addDays(next, -1));
      const key = 'M:' + U.ymd(start) + ':' + startDay;
      const label = startDay === 1
        ? `${start.getFullYear()}年${start.getMonth() + 1}月`
        : `${start.getMonth() + 1}月${start.getDate()}日 - ${new Date(end).getMonth() + 1}月${new Date(end).getDate()}日`;
      return { key, label, start, end, days: Math.round((U.startOfDay(end) - start) / 86400000) + 1, type: 'month' };
    }

    if (c.type === 'week') {
      const ws = Number(c.weekStart) === 0 ? 0 : 1;
      const dow = d.getDay();
      const back = (dow - ws + 7) % 7;
      const start = U.startOfDay(U.addDays(d, -back));
      const end = U.endOfDay(U.addDays(start, 6));
      return {
        key: 'W:' + U.ymd(start),
        label: `${start.getMonth() + 1}月${start.getDate()}日 - ${new Date(end).getMonth() + 1}月${new Date(end).getDate()}日`,
        start, end, days: 7, type: 'week',
      };
    }

    // biweek / custom：以锚点为基准按天数切分
    const span = c.type === 'biweek' ? 14 : U.clamp(Number(c.days) || 30, 1, 366);
    let anchor = U.parseYmd(c.anchor);
    if (!anchor) anchor = U.startOfDay(new Date(y, m, 1));
    const diffDays = Math.floor((U.startOfDay(d) - anchor) / 86400000);
    const idx = Math.floor(diffDays / span);
    const start = U.startOfDay(U.addDays(anchor, idx * span));
    const end = U.endOfDay(U.addDays(start, span - 1));
    const label = `${start.getMonth() + 1}月${start.getDate()}日 - ${new Date(end).getMonth() + 1}月${new Date(end).getDate()}日`;
    return {
      key: (c.type === 'biweek' ? 'B:' : 'C:') + U.ymd(anchor) + ':' + idx,
      label, start, end, days: span, type: c.type,
    };
  }

  function currentPeriod() { return periodFor(new Date()); }

  /** 往前 / 往后 n 个周期 */
  function shiftPeriod(p, n) {
    const c = cyc();
    let probe;
    if (c.type === 'month' || c.type === 'week') {
      probe = U.addDays(p.start, n * (c.type === 'week' ? 7 : 0));
      if (c.type === 'month') {
        const startDay = U.clamp(Number(c.startDay) || 1, 1, 28);
        probe = U.dateClamped(p.start.getFullYear(), p.start.getMonth() + n, startDay);
      }
    } else {
      const span = c.type === 'biweek' ? 14 : U.clamp(Number(c.days) || 30, 1, 366);
      probe = U.addDays(p.start, n * span + 1);
    }
    return periodFor(probe);
  }

  /** 最近 n 个周期（含当前，时间正序） */
  function recentPeriods(n) {
    const out = [];
    let p = currentPeriod();
    for (let i = 0; i < n; i++) { out.unshift(p); p = shiftPeriod(p, -1); }
    return out;
  }

  function inPeriod(ts, p) { return ts >= p.start.getTime() && ts <= p.end.getTime(); }

  // ------------------------------------------------------------
  // 多账本
  // ------------------------------------------------------------
  function books() { return state.books; }

  function activeBookId() { return state.settings.books.activeId; }

  /** 是否处于「所有账本」合并视图 */
  function isAllBooks() { return state.settings.books.activeId === '*'; }

  function activeBook() {
    if (isAllBooks()) return { id: '*', name: '所有账本', icon: '🗂️', color: '#8C8C8C', merged: true };
    return state.books.find((b) => b.id === activeBookId()) || state.books[0];
  }

  /** 真正用来写入账目的账本 id（合并视图下落到第一本） */
  function writeBookId() {
    return isAllBooks() ? state.books[0].id : activeBookId();
  }

  function bookById(id) { return state.books.find((b) => b.id === id) || null; }

  /**
   * 账本类型：**永远返回 'normal'**。
   *
   * 保留这个函数只是为了让老调用方不炸。任务书 P2 规定：
   * `state.books` 里不允许存在 `kind === 'couple'` 的账本实体，
   * 情侣账目住在 `state.cpTxs` 里、没有 bookId。
   * 所以这里**再也不能**把 kind 读出来用——谁想判断「这是不是情侣账本」，
   * 答案永远是「不是」。历史脏数据由 migrate() 统一拆掉。
   */
  function bookKind() {
    return 'normal';
  }

  // ------------------------------------------------------------
  // 归属印记（只在情侣账本里用）
  // 四个印记只影响徽章与次数统计，**不改任何金额计算**——
  // 四种都原样计入「我们的支出」，见任务书 §5.5「全部是我们」原则
  // ------------------------------------------------------------
  const ATTRIBS = [
    { id: 'me', name: '我请', color: '#4F7CFF', who: 'me', desc: '我掏的钱' },
    { id: 'peer', name: 'TA 请', color: '#7C5CFF', who: 'peer', desc: 'TA 掏的钱' },
    { id: 'mutual', name: '互相请', color: '#0FB5A6', who: 'half', desc: '两人各一半' },
    // 「红包」取代「一起花」成为第四个记账选项（用户 m01015：把红包做成我们的账单里的
    // 一个记账选项，替换掉一起花，排在互相请后面）。选它 = 分类自动切成红包 +
    // 出现在 TA 的「来自 TA 的偏爱」里；保存时靠 rpFrom 记方向。
    // 顺序就是弹层里从左到右的顺序：我请 / TA 请 / 互相请 / 红包。
    { id: 'redpacket', name: '红包', color: '#FF6A9B', who: 'gift', desc: '发给 TA 的红包' },
  ];
  const ATTRIB_MAP = {};
  ATTRIBS.forEach((a) => { ATTRIB_MAP[a.id] = a; });
  // 老数据里的「一起花」还在 map 里兜底（不进 ATTRIBS 就不会再被选，但历史账要能解析）
  ATTRIB_MAP.both = { id: 'both', name: '一起花', color: '#FF7A45', who: 'fund', desc: '花小金库里的钱' };
  const ATTRIB_DEFAULT = 'mutual';

  /** 归属印记元信息；不认识的值一律按「互相请」兜底 */
  function attrib(id) {
    return ATTRIB_MAP[id] || ATTRIB_MAP[ATTRIB_DEFAULT];
  }

  /** 这笔账是否该显示徽章：只有情侣账单（state.cpTxs）里的账目才有印记 */
  function attribOf(t) {
    if (!t) return null;
    // 情侣账单的账目没有 bookId（它不属于任何账本）
    if (t.bookId != null) return null;
    if (cpTxs().indexOf(t) < 0) return null;
    return attrib(t.attrib);
  }

  /**
   * 按印记统计次数（月卡用）。
   * 只数次数、不算金额——算钱就又变成查账了，见任务书 §5.5.1
   */
  function attribStats(list) {
    // 四个键必须和 ATTRIBS 的 id 一一对应，少一个键就是 undefined++ → NaN；
    // `both` 再也不可能被选中（不进 ATTRIBS），但老数据解析后仍会落到这里，所以键要留着。
    const out = { me: 0, peer: 0, both: 0, redpacket: 0, mutual: 0, total: 0 };
    (list || []).forEach((t) => {
      if (t.type !== 'expense') return;
      if (isVoid(t)) return;
      const id = t.attrib && ATTRIB_MAP[t.attrib] ? t.attrib : ATTRIB_DEFAULT;
      out[id]++;
      out.total++;
    });
    return out;
  }

  /**
   * 月卡上那句总结。差值 ≤2 次算「挺匀的」。
   * 永远不出现「你请得比 TA 少 3 次」这种句式，也不出现百分比。
   */
  function attribLine(stats) {
    const s = stats || { me: 0, peer: 0, both: 0, mutual: 0 };
    const diff = s.me - s.peer;
    if (diff > 2) return '这个月你更宠 TA 一点';
    if (diff < -2) return 'TA 这个月很宠你';
    return '请得挺匀的 ❤️';
  }

  /**
   * 月报的「隐形对比」。只回看、不预告。
   *
   * 为什么删掉了「下个月换 XX 来爱你」——那句话会变成一条 KPI：
   * 用户下个月会拿它来验收自己，异地尤其被这句话扎（想请也没机会请）。
   * 这里只做两件事：说出这个月的比例感受，然后告诉你「这样的月份有过几次」。
   *
   * @param {object} stats attribStats 的结果
   * @param {number} monthTs 那个月里任意一天的时间戳（用来数历史上同样的月份）
   * @returns {string} 一行字，样本不足时返回空串
   */
  function cpCompareLine(stats, monthTs) {
    const s = stats || { me: 0, peer: 0, mutual: 0 };
    // 三分类口径（me / peer / mutual），红包不计入：
    // 红包是赠予不是请客，算进「请客次数」会让这句比较失去意义。
    // 注意：这里的总数刻意 != attribStats().total —— 那个 total 含红包（卡片要显示红包次数），
    // 这里只用来判断「这个月请客的样本够不够」，所以单独叫 cmpTotal，别改成 stats.total。
    const cmpTotal = s.me + s.peer + s.mutual;
    if (cmpTotal < 3) return ''; // 样本太少，不说
    const dev = Math.abs(s.me - s.peer);

    // 把每一笔按「谁的账」分桶（只分 me / peer；红包不计入，理由同上）
    const mine = [];
    const peer = [];
    cpTxs().forEach((t) => {
      if (t.type !== 'expense' || isVoid(t)) return;
      const id = t.attrib && ATTRIB_MAP[t.attrib] ? t.attrib : ATTRIB_DEFAULT;
      if (id === 'me') mine.push(t.ts);
      else if (id === 'peer') peer.push(t.ts);
    });
    const monthKey = (ts) => {
      const d = new Date(ts);
      return d.getFullYear() + '-' + d.getMonth();
    };
    const anchor = monthTs || Date.now();
    const anchorKey = monthKey(anchor);

    // 历史上「差得 >2 次」的月份有几回（不含这个月自己）
    const diffByMonth = {};
    mine.forEach((ts) => {
      const k = monthKey(ts);
      diffByMonth[k] = diffByMonth[k] || { me: 0, peer: 0 };
      diffByMonth[k].me++;
    });
    peer.forEach((ts) => {
      const k = monthKey(ts);
      diffByMonth[k] = diffByMonth[k] || { me: 0, peer: 0 };
      diffByMonth[k].peer++;
    });
    let sameTimes = 0;
    Object.keys(diffByMonth).forEach((k) => {
      if (k === anchorKey) return;
      const v = diffByMonth[k];
      if (Math.abs(v.me - v.peer) > 2) sameTimes++;
    });

    let head;
    if (dev <= 2) head = '这个月请得挺匀的 ❤️';
    else if (s.me > s.peer) head = '这个月你请得多一点 ❤️';
    else head = '这个月 TA 请得多一点 ❤️';

    if (!sameTimes) return head;
    return head + ` 这样的月份，你们已经有过 ${sameTimes} 次了。`;
  }

  // ------------------------------------------------------------
  // 情侣账单（独立数据，完全不归属任何账本）
  //
  // 用户的明确要求：情侣账单不是「账本」的一个分支，是「情侣」栏里
  // 独立的一个页面。所以它的数据放在 state.cpTxs 里，和 state.tx
  // 并列、互不干扰——「记一笔」永远是个人账本，一个字节都不碰这里。
  // ------------------------------------------------------------
  function cpOn() {
    const c = state.settings.couple || {};
    return !!c.enabled;
  }

  // ---- 多本情侣账本 ----
  // 每一本都有自己的资料、自己的账目、自己的三个基金抽屉。
  // cpTxs 和 kind==='couple' 的目标都靠 cpBookId 认领，读写一律按当前这本过滤——
  // 否则和新人记了三个月，随手一点就会翻出上一段的账。
  function cpBooks() {
    if (!Array.isArray(state.cpBooks)) state.cpBooks = [];
    return state.cpBooks;
  }

  function cpActiveId() {
    const id = (state.settings.couple || {}).activeId;
    if (id && cpBooks().some((b) => b.id === id)) return id;
    const first = cpBooks()[0];
    return first ? first.id : '';
  }

  function cpBookById(id) { return cpBooks().find((b) => b.id === id) || null; }

  /** 当前这一本（没有就返回 null） */
  function cpActiveBook() {
    const id = cpActiveId();
    return id ? cpBookById(id) : null;
  }

  /** 写数据时该挂到哪一本上：永远挂当前这本，不猜 */
  function cpWriteId() { return cpActiveId(); }

  /** 全部情侣账单**当前这本**（未按周期过滤） */
  function cpTxs() {
    if (!Array.isArray(state.cpTxs)) state.cpTxs = [];
    const id = cpActiveId();
    return state.cpTxs.filter((t) => !id || t.cpBookId === id);
  }

  /** 某一本的全部账目（含不是当前这本的），给历史账本页用 */
  function cpTxsOf(bookId) {
    if (!Array.isArray(state.cpTxs)) state.cpTxs = [];
    return state.cpTxs.filter((t) => t.cpBookId === bookId);
  }

  /** 底层数组本身。删除要在这里按 id 摘，不能用 cpTxs()（那是过滤后的副本） */
  function cpRaw() {
    if (!Array.isArray(state.cpTxs)) state.cpTxs = [];
    return state.cpTxs;
  }

  function cpTxById(id) { return cpTxs().find((t) => t.id === id) || null; }

  /**
   * 某个周期内的情侣账单，按时间倒序。
   * excludeRefunds: 剔除退款记录（退款是挂在原支出下面的，不单独成行）
   */
  function cpTxIn(p, opts) {
    const noRefund = !!(opts && opts.excludeRefunds);
    const pick = (arr) => (p ? arr.filter((t) => inPeriod(t.ts, p)) : arr.slice())
      .filter((t) => !(noRefund && t.refundOf))
      .sort((a, b) => b.ts - a.ts);
    if (opts && opts.all) {
      // 退款可能发生在原支出之后的月份：算净额时必须看全量
      if (!Array.isArray(state.cpTxs)) state.cpTxs = [];
      return pick(state.cpTxs.filter((t) => t.cpBookId === cpActiveId()));
    }
    return pick(cpTxs());
  }

  /**
   * 同步钩子（任务书步骤 6）。
   * 第二阶段才接网络；现在 CoupleSync.hook 只可能是 false，
   * 文件没加载时也静默跳过——保证离线行为一字节不变。
   */
  function syncHook(kind, tx) {
    try {
      const CS = global.CoupleSync;
      if (!CS || typeof CS.hook !== 'function') return;
      CS.hook({ kind, id: tx && tx.id, ts: Date.now(), payload: tx || null });
    } catch (e) { /* 同步坏了不能影响记账 */ }
  }

  /**
   * 红包分类的 id。情侣之间互相发红包走这个分类，
   * 而「来自 TA 的偏爱」就是在它上面长出来的一层。
   */
  const RP_CAT = 'redpacket';
  /** 两颗心的两个方向 */
  const ATTRIB_PAIR = { me: 'peer', peer: 'me' };

  function cpAddTx(input) {
    const t = {
      id: U.uid('cptx'),
      type: input.type === 'income' ? 'income' : 'expense',
      amount: Math.abs(Math.round(Number(input.amount) || 0)),
      catId: input.catId || 'other_out',
      sub: input.sub || '',
      accountId: input.accountId || 'alipay',
      note: (input.note || '').slice(0, 200),
      ts: input.ts || Date.now(),
      attrib: ATTRIB_MAP[input.attrib] ? input.attrib : ATTRIB_DEFAULT,
      amountFx: input.amountFx != null ? Math.abs(Math.round(Number(input.amountFx) || 0)) : 0,
      fxRate: input.fxRate != null ? Number(input.fxRate) || 0 : 0,
      fxCode: input.fxCode || '',
      cpBookId: input.cpBookId || cpWriteId(),
      createdAt: Date.now(),
    };
    if (input.advance) t.advance = normalizeAdvance(input.advance);
    // 退款：挂在某笔原支出下面，不单独成行、不参与笔数
    if (input.refundOf) t.refundOf = String(input.refundOf);
    // 红包配对：谁发给谁。一条记录同时服务两个方向 ——
    // 发的人在账单里看到「发出去了」，收的人在「来自 TA 的偏爱」里看到「收到的」。
    // 用一条而不是两条，是因为两条会和退款、净额、笔数统计打架：
    // 同一笔钱在「一起花了多少」里只该出现一次。
    if (input.rpFrom) t.rpFrom = ATTRIB_PAIR[input.rpFrom] ? input.rpFrom : '';
    cpRaw().push(t);
    save();
    emit({ type: 'cptx', action: 'add', tx: t });
    syncHook('tx.add', t);
    return t;
  }

  /**
   * 记一笔退款：把原支出「退回来了」多少。
   * val = 'full' 全额 / 数字＝部分退款的金额（分）。
   * 为什么不记成收入：退款不是进账，是「这笔没花成」。
   * 记成收入会让「一起花了多少」变成一道减法题。
   */
  function cpRefundTx(id, val, note) {
    const src = cpTxById(id);
    if (!src || src.refundOf) return null;
    const remain = Math.max(0, src.amount - cpRefundedOf(id));
    if (remain <= 0) return null;
    const amt = val === 'full' ? remain : Math.min(remain, Math.abs(Math.round(Number(val) || 0)));
    if (!amt) return null;
    const r = cpAddTx({
      type: 'expense',
      amount: amt,
      catId: src.catId,
      sub: src.sub,
      accountId: src.accountId,
      note: (note || '退回来了').slice(0, 60),
      attrib: src.attrib,
      ts: Date.now(),
      refundOf: src.id,
    });
    save();
    emit({ type: 'cptx', action: 'refund', tx: r, srcId: src.id });
    return r;
  }

  function cpUpdateTx(id, patch) {
    const t = cpTxById(id);
    if (!t) return null;
    Object.assign(t, patch || {}, { updatedAt: Date.now() });
    if (patch && patch.amount != null) t.amount = Math.abs(Math.round(Number(patch.amount) || 0));
    if (patch && patch.attrib != null) t.attrib = ATTRIB_MAP[patch.attrib] ? patch.attrib : ATTRIB_DEFAULT;
    if (patch && patch.rpFrom !== undefined) {
      t.rpFrom = ATTRIB_PAIR[patch.rpFrom] ? patch.rpFrom : '';
      if (!t.rpFrom) delete t.rpFrom;
    }
    save();
    emit({ type: 'cptx', action: 'update', tx: t });
    syncHook('tx.update', t);
    return t;
  }

  function cpRemoveTx(id) {
    // 从底层数组里摘，不能用 cpTxs()：那是过滤后的副本，splice 只删到副本
    const raw = cpRaw();
    const i = raw.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const [t] = raw.splice(i, 1);
    // 本地删除也要落墓碑：
    // 同步是「先拉后推」，下一次 syncOnce 会把我们自己的旧 add 拉回来。
    // 不记墓碑的话，那笔刚删掉的账会被自己的历史 op 复活。
    if (t && t._seq != null) {
      const tomb = cpTomb();
      if (!(tomb[id] >= t._seq)) tomb[id] = t._seq;
    }
    save();
    emit({ type: 'cptx', action: 'remove', tx: t });
    syncHook('tx.remove', t);
    return t;
  }

  // ------------------------------------------------------------
  // 双人同步：应用远端变更
  //
  // 这一节只做三件事，且**绝不反向触发 syncHook**（否则会自己推给自己）：
  //   1. 把远端 op 按 seq 合进本地集合（合并内核在 couple-sync.js，纯函数可单测）
  //   2. 对方删掉的账，本机还没发出去的改动一并放弃（删除优先，见方案 §6.4）
  //   3. 自己推成功的 op，把服务端 seq 回填到实体的 _seq 上
  // ------------------------------------------------------------

  /** 墓碑表是同步层的状态，借过来用（没有同步层就给个临时对象，合并仍然安全） */
  function cpTomb() {
    const CS = global.CoupleSync;
    if (CS && typeof CS.state === 'function') {
      const s = CS.state();
      if (!s.tombstones || typeof s.tombstones !== 'object') s.tombstones = {};
      return s.tombstones;
    }
    return {};
  }

  /** 从同步 outbox 里剔掉待发项，返回条数（这些是「被放弃的本地改动」） */
  function syncPurgeOutbox(pred) {
    const CS = global.CoupleSync;
    if (!CS || typeof CS.state !== 'function') return 0;
    try {
      const s = CS.state();
      if (!Array.isArray(s.outbox) || !s.outbox.length) return 0;
      const before = s.outbox.length;
      s.outbox = s.outbox.filter((e) => !pred(e));
      const n = before - s.outbox.length;
      if (n) CS._persist();
      return n;
    } catch (e) {
      return 0;
    }
  }

  /** 整本删除：账、基金、书本身、以及这本还没发出去的改动，一起清 */
  function purgeBookLocal(bid, seq) {
    if (!bid) return 0;
    const tomb = cpTomb();
    tomb[bid] = Math.max(tomb[bid] || 0, Number(seq) || 0);

    const before = cpRaw().length;
    state.cpTxs = cpRaw().filter((t) => t.cpBookId !== bid);
    state.goals = (state.goals || []).filter((g) => g.cpBookId !== bid);
    state.cpBooks = cpBooks().filter((b) => b.id !== bid);

    syncPurgeOutbox((e) => {
      if (String(e.kind || '').indexOf('cptx.') !== 0) return false;
      return !!(e.data && e.data.cpBookId === bid);
    });

    // 当前这本被删了，就落到剩下的第一本上
    if (cpActiveId() === bid) {
      const left = cpBooks()[0];
      const cs = state.settings && state.settings.couple;
      if (cs) cs.activeBookId = left ? left.id : '';
    }
    return before - state.cpTxs.length;
  }

  /**
   * 应用一批远端 op。ops 由 couple-sync 解好密并按 seq 排好序。
   * @returns {{changed:number, dropped:number, txNew:number}}
   *   txNew 只数「这台手机这下真的多出来的账目」（对方新记的），
   *   给自己推上去、又被自己拉回来的那些 op 不算 —— 见 mergeList 的 _seq 回填。
   *   界面用它决定要不要提示「TA 刚记了 N 笔」。
   */
  function applyRemoteOps(ops) {
    const CS = global.CoupleSync;
    const result = { changed: 0, dropped: 0, txNew: 0 };
    if (!CS || typeof CS.mergeList !== 'function') return result;
    if (!Array.isArray(ops) || !ops.length) return result;

    const tomb = cpTomb();
    let changed = 0;
    let dropped = 0;
    let txNew = 0;

    // 1) 整本删除先做（它要摘掉这本书下面所有账，不能走单实体路径）
    ops.forEach((op) => {
      if (op.kind === 'book.wipe' && op.data && op.data.id) {
        changed += purgeBookLocal(op.data.id, op.seq);
      }
    });

    // 2) 其余按集合分组
    const groups = { cptx: [], goal: [], book: [], profile: [] };
    ops.forEach((op) => {
      const head = String(op.kind || '').split('.')[0];
      if (groups[head]) groups[head].push(op);
    });

    if (groups.cptx.length) {
      // 合并前先记下「本来有哪些 id」，合并后才知道哪几笔是新长出来的。
      // 不能用 mergeList 的 changed：它连 update / remove 一起数，
      // 而我们只想说「TA 记了 N 笔」，不是「有 N 处变动」。
      const hadIds = Object.create(null);
      cpRaw().forEach((t) => { if (t && t.id) hadIds[t.id] = 1; });

      const r = CS.mergeList(cpRaw(), tomb, groups.cptx);
      changed += r.changed;
      dropped += r.dropped;

      const nowIds = Object.create(null);
      cpRaw().forEach((t) => { if (t && t.id) nowIds[t.id] = 1; });
      groups.cptx.forEach((op) => {
        // 只数「新增」：update 是改已有的，remove 是删，都不该说成「刚记了」
        if (String(op.kind) !== 'cptx.add') return;
        const id = op.data && op.data.id;
        if (id && !hadIds[id] && nowIds[id]) txNew++;
      });

      // 删除优先：对方删掉的这笔，本机还没发出去的改动一并放弃
      groups.cptx.forEach((op) => {
        if (op.kind === 'cptx.remove' && op.data && op.data.id) {
          dropped += syncPurgeOutbox((e) => e.eid === op.data.id);
        }
      });
    }

    if (groups.goal.length) {
      if (!Array.isArray(state.goals)) state.goals = [];
      const r = CS.mergeList(state.goals, tomb, groups.goal);
      changed += r.changed;
      dropped += r.dropped;
    }

    if (groups.book.length) {
      const r = CS.mergeList(cpBooks(), tomb, groups.book);
      changed += r.changed;
      dropped += r.dropped;
    }

    // 3) 资料：只在「当前这本」上生效，避免换本重置被对方推回来
    groups.profile.forEach((op) => {
      const d = op.data || {};
      if (d.bookId && d.bookId !== cpActiveId()) return;
      if (d.profile && typeof d.profile === 'object') {
        state.settings.couple = Object.assign({}, state.settings.couple, d.profile);
        changed++;
      }
    });

    if (dropped) {
      const cs = CS.state();
      cs.dropped = (cs.dropped || 0) + dropped;
      CS._persist();
    }

    if (changed) {
      save(true);
      emit({ type: 'cptx', action: 'remote' });
      emit({ type: 'goal', action: 'remote' });
      emit({ type: 'couple', action: 'remote' });
    }

    result.changed = changed;
    result.dropped = dropped;
    result.txNew = txNew;
    return result;
  }

  /**
   * 首次配对后，把本机已有的情侣数据排队推上去。
   *
   * op_id 固定成 `boot_` + 实体 id：同一笔账重推多少次都是同一个键，
   * 服务端靠 (room, op_id) 主键幂等，不会重复。
   * 注意 outbox 有 500 条上限，超出的会被挤掉 —— 这一步的记录条数要能看见。
   */
  function syncBootstrap() {
    const CS = global.CoupleSync;
    if (!CS || typeof CS.hook !== 'function') return 0;
    let n = 0;
    try {
      cpRaw().forEach((t) => {
        if (!t || !t.id) return;
        if (CS.hook({ kind: 'cptx.add', opId: 'boot_' + t.id, data: t, ts: t.ts })) n++;
      });
      (state.goals || []).forEach((g) => {
        if (!g || !g.id || !g.cpBookId) return;
        if (CS.hook({ kind: 'goal.add', opId: 'boot_' + g.id, data: g })) n++;
      });
      cpBooks().forEach((b) => {
        if (!b || !b.id) return;
        if (CS.hook({ kind: 'book.add', opId: 'boot_' + b.id, data: b })) n++;
      });
    } catch (e) { /* 同步层不能影响主流程 */ }
    return n;
  }

  /**
   * 自己推成功的 op：把服务端 seq 回填到实体上，并让本地对齐「服务端已接受的那个版本」。
   *
   * 这一步不能省。不回填的话实体 `_seq` 一直是 0，
   * 对方后来的改动（哪怕 seq=11）会被判成「更新」而覆盖掉本机自己的修改。
   */
  function syncAccepted(list) {
    try {
      const tomb = cpTomb();
      (list || []).forEach((x) => {
        if (!x || x.seq == null) return;
        const k = String(x.kind || '');
        let arr = null;
        if (k.indexOf('cptx.') === 0) arr = cpRaw();
        else if (k.indexOf('goal.') === 0) arr = Array.isArray(state.goals) ? state.goals : null;
        else if (k.indexOf('book.') === 0) arr = cpBooks();
        if (!arr) return;

        const seq = Number(x.seq) || 0;
        const i = arr.findIndex((o) => o && o.id === x.eid);
        const isRemove = /\.(remove|wipe)$/.test(k);

        if (isRemove) {
          // 自己删的也要落墓碑：不落的话，下次 pull 会把自己的旧 add 拉回来，
          // 把那笔刚删掉的账「复活」——这是最容易忽略的一处
          if (!(tomb[x.eid] >= seq)) tomb[x.eid] = seq;
          if (i >= 0) arr.splice(i, 1);
          return;
        }

        if (i < 0) {
          if (x.data) arr.push(Object.assign({}, x.data, { _seq: seq }));
        } else if (x.data) {
          // 本地对齐到「服务端已接受的版本」。不这么做，并发修改时
          // 本地会停在旧值、对方拿到新值，两台永久不一致。
          arr[i] = Object.assign({}, x.data, { _seq: seq });
        } else {
          arr[i]._seq = Math.max(arr[i]._seq || 0, seq);
        }
      });
      save(true);
    } catch (e) { /* 同步层不能影响主流程 */ }
  }

  // ------------------------------------------------------------
  // 来自 TA 的偏爱
  //
  // 一条红包记录同时有两个视角：
  //   发的人 —— 我的「红包」分类支出，账单里写「发出去」
  //   收的人 —— TA 的「来自 TA 的偏爱」里多一笔，不重复计支出
  //
  // 为什么不做成两条记录：同一笔钱在一本账里只能花一次。
  // 做两条的话，「这个月一起花了多少」会凭空翻倍，
  // 而退款、按分类统计、合并看板都得各自处理这份重复。
  // 用一条 + 一个「谁发的」字段（rpFrom），两个视角各算各的，账只有一份。
  //
  // 判断方向只看 rpFrom（谁发的），不要拿它跟 attrib 比：
  // 这两个字段在红包场景下天然相等 ——
  //   TA 发给我：rpFrom='peer'、attrib='peer'（这笔算 TA 请的）
  //   我发给 TA：rpFrom='me'  、attrib='me'  （这笔算我请的）
  // 早先写 `rpFrom !== attrib` 判「收到的」，方向整个反了。
  // ------------------------------------------------------------

  /** 我收到的红包（TA 发的那些，按时间倒序） */
  function cpFavorsIn(bookId) {
    const bid = bookId || cpWriteId();
    return cpRaw()
      .filter((t) => t && t.cpBookId === bid && t.rpFrom === 'peer' && !t.refundOf)
      .sort((a, b) => b.ts - a.ts);
  }

  /** 我发出去的红包（我发的那些，TA 那边会当成「来自 TA 的偏爱」） */
  function cpFavorsOut(bookId) {
    const bid = bookId || cpWriteId();
    return cpRaw()
      .filter((t) => t && t.cpBookId === bid && t.rpFrom === 'me' && !t.refundOf)
      .sort((a, b) => b.ts - a.ts);
  }

  /** 收到的红包合计（净额，退回来的不算） */
  function cpFavorsTotal(bookId, list) {
    const arr = list || cpFavorsIn(bookId);
    return arr.reduce((s, t) => s + cpNetOf(t), 0);
  }

  /**
   * 手动记一笔「TA 给我的偏爱」。
   * 场景：TA 直接把钱转给你、还没来得及说，你先把这笔记下来。
   * 记进来之后它和自动识别的那种是同一种东西。
   */
  function cpAddFavor(input) {
    const ipt = input || {};
    return cpAddTx({
      type: 'expense',
      amount: ipt.amount,
      catId: RP_CAT,
      sub: ipt.sub || 'TA 给的',
      accountId: ipt.accountId || 'wechat',
      note: (ipt.note || 'TA 给我的').slice(0, 60),
      // 送的人是 TA → 归属写 'peer'（TA 请的）；rpFrom 也记 'peer' 表示「从 TA 那儿来的」。
      attrib: 'peer',
      rpFrom: 'peer',
      ts: ipt.ts || Date.now(),
    });
  }

  function cpRestoreTx(t) {
    if (!t || cpTxById(t.id)) return;
    if (!t.cpBookId) t.cpBookId = cpWriteId();
    cpRaw().push(t);
    save();
    emit({ type: 'cptx', action: 'restore', tx: t });
  }

  /** 情侣账单的汇总：结构与 summary() 一致，方便复用渲染 */
  /**
   * 退款把原支出抵消掉多少。返回 { refunded, refundIds }。
   * refundOf 指向的那一笔原支出「退回来了」多少 —— 方向 key 是 `退:<原id>`，
   * 同一笔支出可能被退好几次（部分退款），每次一条记录，累加。
   */
  function refundIndex(list) {
    const refunded = {};
    const refundIds = {};
    list.forEach((t) => {
      if (!t || !t.refundOf) return;
      refunded[t.refundOf] = (refunded[t.refundOf] || 0) + (t.amount || 0);
      refundIds[t.id] = true;
    });
    return { refunded, refundIds };
  }

  /**
   * 情侣账本的月度统计。
   *
   * 【口径】只算支出，且按「净额」算：一笔 800 的火锅退回来 200，记 600。
   * 为什么不把它记成收入：「一起花了多少」会变成「花了多少、又收回来多少」，
   * 用户还得自己做减法。退款在语义上不是收入，是「这笔没花成」。
   * 收入（income）字段留着只为兼容个人账本与老数据，情侣界面一处都不读它。
   */
  function cpSummary(p, list) {
    const items = list || cpTxIn(p);
    const all = (list || cpTxIn(p, { all: true }));
    const { refunded, refundIds } = refundIndex(all);
    let expense = 0, income = 0, expCount = 0, incCount = 0, refundTotal = 0, refundCount = 0;
    const byCat = {}, byDay = {};
    items.forEach((t) => {
      const day = U.ymd(t.ts);
      if (t.type === 'income') { income += t.amount; incCount++; return; }
      // 退款记录本身不单独计入笔数：它属于那笔原支出
      if (refundIds[t.id]) { refundCount++; return; }
      // 红包（m02455 用户定稿）：月报/账单是「各自视角」，不是共用的。
      //   rpFrom='me'   = 我发给 TA → 我的支出（钱从我手里出去）
      //   rpFrom='peer' = TA 发给我 → 我的收入（收到的偏爱），进 income 不进支出
      // 这笔红包如有退款，按净额进 income。
      if (t.rpFrom === 'peer') {
        const backIn = Math.min(refunded[t.id] || 0, t.amount);
        income += Math.max(0, t.amount - backIn);
        incCount++;
        return;
      }
      const back = Math.min(refunded[t.id] || 0, t.amount);
      const net = t.amount - back;
      // 退款金额只在「原支出」这一侧统计一次。退款记录那一侧只数笔数，
      // 否则同 200 块会被加两遍（一倍来自退款记录、一倍来自这里）。
      refundTotal += back;
      expense += net;
      expCount++;
      if (net > 0) {
        byCat[t.catId] = byCat[t.catId] || { id: t.catId, amount: 0, count: 0, type: 'expense' };
        byCat[t.catId].amount += net;
        byCat[t.catId].count++;
        byDay[day] = (byDay[day] || 0) + net;
      }
    });
    const cats = Object.values(byCat)
      .sort((a, b) => b.amount - a.amount)
      .map((c) => ({ ...c, pct: expense ? c.amount / expense : 0, meta: Icons.cat(c.id) }));
    return {
      expense, income, net: income - expense,
      count: expCount, expCount, incCount,
      refundTotal, refundCount,
      byCat: cats, byDay,
      avgDaily: expense / (p ? p.days : 1),
    };
  }

  /** 这一笔支出已经退回来多少（原样退还时等于 amount） */
  function cpRefundedOf(id) {
    return cpRaw()
      .filter((t) => t && t.refundOf === id)
      .reduce((s, t) => s + (t.amount || 0), 0);
  }

  /** 这一笔是不是退款记录（它挂在某笔原支出下面，不单独展示） */
  function cpIsRefund(t) { return !!(t && t.refundOf); }

  /** 这一笔支出的净额（原额 − 已退） */
  function cpNetOf(t) {
    if (!t) return 0;
    if (t.refundOf) return 0;
    return Math.max(0, t.amount - Math.min(cpRefundedOf(t.id), t.amount));
  }

  /* ------------------------------------------------------------------
   * 日历与月度总结用的取数函数。
   * 为什么单独写：日历要一次算好整月的「每天发生了什么」，
   * 如果在 30 个格子里各自去 filter 一遍 cpTxs，一个月就是几千次遍历；
   * 而且两处的判定标准（什么算「一起存了钱」）必须完全一致，
   * 分散在视图里写必然不一致。
   * ------------------------------------------------------------------ */

  /** 某天的情侣支出（剔除退款记录，退款是原支出的附属） */
  function cpDayTxs(dayTs) {
    const k = U.ymd(dayTs);
    return cpTxs()
      .filter((t) => U.ymd(t.ts) === k && !t.refundOf)
      .sort((a, b) => a.ts - b.ts);
  }

  /** 某天基金里所有存款流水（正数=存进去） */
  function cpDayDeposits(dayTs) {
    const k = U.ymd(dayTs);
    const out = [];
    (state.goals || []).forEach((g) => {
      if (g.kind !== 'couple') return;
      if (g.cpBookId && g.cpBookId !== cpActiveId()) return;
      (g.logs || []).forEach((l) => {
        if (l.amount > 0 && U.ymd(l.ts) === k) out.push({ ...l, goal: g });
      });
    });
    return out.sort((a, b) => a.ts - b.ts);
  }

  /**
   * 整月日历数据，一次算完。
   * 返回 { p, days: { 'YYYY-MM-DD': { txs, deposits, cats, count } }, count, depositCount, expense }
   * 口径：txs 剔除退款记录、cats 只收净额 > 0 的支出分类。
   */
  function cpCalendar(p) {
    const list = cpTxIn(p);
    const { refunded, refundIds } = refundIndex(cpTxIn(p, { all: true }));
    const days = {};
    const touch = (k) => {
      if (!days[k]) days[k] = { txs: [], deposits: [], cats: [], count: 0, depositSum: 0 };
      return days[k];
    };
    list.forEach((t) => {
      if (refundIds[t.id]) return;           // 退款不单独占一格
      const k = U.ymd(t.ts);
      const d = touch(k);
      d.txs.push(t);
      d.count++;
      if (t.type === 'income') return;        // 情侣账本不读收入
      const net = t.amount - Math.min(refunded[t.id] || 0, t.amount);
      if (net > 0 && d.cats.indexOf(t.catId) < 0) d.cats.push(t.catId);
    });
    // 存款流水：只算当前这本的基金
    (state.goals || []).forEach((g) => {
      if (g.kind !== 'couple') return;
      if (g.cpBookId && g.cpBookId !== cpActiveId()) return;
      (g.logs || []).forEach((l) => {
        if (!(l.amount > 0)) return;
        if (p && !inPeriod(l.ts, p)) return;
        const d = touch(U.ymd(l.ts));
        d.deposits.push(Object.assign({}, l, { goal: g }));
        d.depositSum += l.amount;
      });
    });
    const sum = cpSummary(p, list);
    let depositCount = 0;
    Object.keys(days).forEach((k) => (depositCount += days[k].deposits.length));
    return { p, days, count: list.length, depositCount, expense: sum.expense };
  }

  /**
   * 基金本月新增：小金库 / 约会基金 / 见面基金各存进去多少。
   * 只算正数（存进去的），取出来的不算「攒」。
   */
  function cpFundMonthSummary(p) {
    const rows = [];
    (state.goals || []).forEach((g) => {
      if (g.kind !== 'couple') return;
      if (g.cpBookId && g.cpBookId !== cpActiveId()) return;
      let added = 0;
      (g.logs || []).forEach((l) => {
        if (!(l.amount > 0)) return;
        if (p && !inPeriod(l.ts, p)) return;
        added += l.amount;
      });
      if (added > 0) rows.push({ id: g.id, name: g.name, icon: g.icon, slot: g.slot, added });
    });
    rows.sort((a, b) => b.added - a.added);
    return { rows, total: rows.reduce((s, r) => s + r.added, 0) };
  }

  /**
   * 「收了一笔」：红包 / 礼金 / 转账进来的钱，记成共同基金的一笔存入。
   *
   * 为什么不进交易列表：情侣账本只记支出。这笔钱一进来就是「两个人的钱」，
   * 基金才是它该待的地方 —— 放进支出列表，它下一秒就会被拿去和
   * 「我们花了多少」做减法，而它本来就不是一笔花销。
   *
   * goalId 为空时用当前这本的小金库（没有就现建一个）。
   */
  function cpFundDeposit(goalId, amount, note) {
    const amt = Math.abs(Math.round(Number(amount) || 0));
    if (!amt) return null;
    let g = goalId ? goalById(goalId) : null;
    if (!g) g = coupleVault();
    if (!g) {
      g = addGoal({
        name: '我们的小金库', icon: '💞', target: 0,
        color: '#FF6A9B', kind: 'couple', slot: 'vault',
      });
    }
    if (!g) return null;
    depositGoal(g.id, amt, (note || '收了一笔').slice(0, 40));
    return g;
  }

  /**
   * 开通情侣账单：只置开关、存资料、建小金库目标。
   * **不建账本、不碰 state.tx**——情侣账单是独立的一本账。
   */
  function enableCouple(opts) {
    const input = opts || {};
    const c = Object.assign({}, state.settings.couple, {
      enabled: true,
      hidden: false,
      closedAt: 0,
      closeReason: '',
      consent: input.consent || state.settings.couple.consent,
      meName: input.meName != null ? String(input.meName).trim().slice(0, 8) : state.settings.couple.meName,
      peerName: input.peerName != null ? String(input.peerName).trim().slice(0, 8) : state.settings.couple.peerName,
      togetherSince: input.togetherSince || state.settings.couple.togetherSince,
      // 生日是选填的：传了才改，没传就留着原来的（重走一遍开通不会把生日抹掉）
      meBirthday: input.meBirthday != null ? String(input.meBirthday) : state.settings.couple.meBirthday,
      peerBirthday: input.peerBirthday != null ? String(input.peerBirthday) : state.settings.couple.peerBirthday,
      mode: input.mode || state.settings.couple.mode || 'local',
    });
    state.settings.couple = c;
    // 第一本情侣账本：资料写进列表，之后所有数据靠它的 id 归属
    if (!cpBooks().length) {
      state.cpBooks.push({
        id: 'cp1',
        meName: c.meName || '',
        peerName: c.peerName || '',
        mode: c.mode || 'local',
        togetherSince: c.togetherSince || '',
        meBirthday: c.meBirthday || '',
        peerBirthday: c.peerBirthday || '',
        order: 1,
        status: 'active',
        createdAt: Date.now(),
        closedAt: 0,
      });
    }
    const active = cpActiveBook();
    if (active) {
      active.meName = c.meName || active.meName;
      active.peerName = c.peerName || active.peerName;
      active.mode = c.mode || active.mode;
      active.togetherSince = c.togetherSince || active.togetherSince;
      active.meBirthday = c.meBirthday || active.meBirthday || '';
      active.peerBirthday = c.peerBirthday || active.peerBirthday || '';
      active.status = 'active';
      active.closedAt = 0;
      state.settings.couple.activeId = active.id;
    }
    // 小金库：只在还没有情侣金库时建，重复开通不会多出一堆空目标
    const vault = coupleVault();
    if (!vault) {
      const g = addGoal({
        name: c.mode === 'remote' ? '下次见面基金' : '我们的小金库',
        icon: '💞',
        target: 0,
        color: '#FF6A9B',
        kind: 'couple',
        slot: c.mode === 'remote' ? 'meet' : 'vault',
        note: c.mode === 'remote' ? '存满了就买机票去见 TA' : '一起存，一起花',
      });
      if (g) g.cpBookId = cpActiveId();
    }
    save();
    emit({ type: 'couple', action: 'enable', couple: c });
    return { couple: c };
  }

  /**
   * 关掉当前这本：数据一条不动，只是不显示了。
   * 和「彻底删除」是两件事 —— 关闭随时能反悔，删除不能。
   */
  function closeCouple(reason) {
    const b = cpActiveBook();
    const now = Date.now();
    if (b) {
      b.status = 'closed';
      b.closedAt = now;
    }
    state.settings.couple = Object.assign({}, state.settings.couple, {
      enabled: false,
      hidden: false,
      closedAt: now,
      closeReason: String(reason || '').slice(0, 20),
    });
    save();
    // 关掉要同步：否则 TA 那边还显示这本开着，两边的列表对不上
    if (b) syncHook('book.close', b);
    emit({ type: 'couple', action: 'close' });
    return state.settings.couple;
  }

  /** 7 天内可以一键反悔（首页提示条会亮）；过了就只能自己点重新打开 */
  function cpCanUndo(now) {
    const t = (state.settings.couple || {}).closedAt || 0;
    if (!t) return false;
    return (now || Date.now()) - t < 7 * 86400000;
  }

  /** 只把入口收起来，不关账本，也不动数据 */
  function hideCouple() {
    state.settings.couple = Object.assign({}, state.settings.couple, { hidden: true });
    save();
    emit({ type: 'couple', action: 'hide' });
  }

  function unhideCouple() {
    state.settings.couple = Object.assign({}, state.settings.couple, { hidden: false });
    save();
    emit({ type: 'couple', action: 'unhide' });
  }

  /** 历史账本：不是当前这本，但还在手机上 */
  function cpArchivedBooks() {
    const active = cpActiveId();
    return cpBooks()
      .filter((b) => b.id !== active)
      .map((b) => {
        const list = cpTxsOf(b.id);
        return {
          book: b,
          count: list.length,
          lastTs: list.reduce((m, t) => Math.max(m, t.ts || 0), 0),
          saved: coupleGoalsOf(b.id).reduce((s, g) => s + (g.saved || 0), 0),
        };
      });
  }

  /**
   * 换一本新的：老的那本原样收进历史，新的从零开始。
   * 换完 activeId 指向新的，所有读写自动跟着走 —— 不会串本。
   */
  function startNewCpBook(input) {
    const cur = cpActiveBook();
    if (cur) {
      cur.status = 'closed';
      cur.closedAt = cur.closedAt || Date.now();
    }
    const order = cpBooks().reduce((m, b) => Math.max(m, b.order || 0), 0) + 1;
    // 开着同步时用随机 id：'cp' + order 是各设备各自推导的确定性 id，
    // 两个人各自「换一本新的」都会算出 cp2，同步后两本不同的账会撞成一个
    const syncOn = !!(global.CoupleSync && global.CoupleSync.ready && global.CoupleSync.ready());
    const book = {
      id: syncOn ? U.uid('cp') : ('cp' + order),
      meName: (input && input.meName) || '',
      peerName: (input && input.peerName) || '',
      mode: (input && input.mode) || 'local',
      togetherSince: (input && input.togetherSince) || '',
      meBirthday: (input && input.meBirthday) || '',
      peerBirthday: (input && input.peerBirthday) || '',
      order,
      status: 'active',
      createdAt: Date.now(),
      closedAt: 0,
    };
    cpBooks().push(book);
    state.settings.couple = Object.assign({}, state.settings.couple, {
      enabled: false,
      hidden: false,
      closedAt: 0,
      closeReason: '',
      activeId: book.id,
      meName: '', peerName: '', togetherSince: '', mode: '',
      nextMeet: '', tzOffset: 8, shareRatio: false,
    });
    save();
    // 老的那本要同步「已关闭」，新的这本要同步「存在」——
    // 少任何一条，另一边都会看到对不上的账本列表
    if (cur) syncHook('book.close', cur);
    syncHook('book.add', book);
    emit({ type: 'couple', action: 'newbook', book });
    return book;
  }

  /** 切到另一本（历史账本里点进去看看，不动它的状态） */
  function switchCpBook(id) {
    const b = cpBookById(id);
    if (!b) return null;
    state.settings.couple = Object.assign({}, state.settings.couple, {
      activeId: b.id,
      enabled: b.status === 'active',
      hidden: false,
      closedAt: b.closedAt || 0,
      meName: b.meName || '',
      peerName: b.peerName || '',
      mode: b.mode || '',
      togetherSince: b.togetherSince || '',
    });
    save();
    emit({ type: 'couple', action: 'switchbook', book: b });
    return b;
  }

  /**
   * 把某一本重新打开。
   * 和 switchCpBook 分开写：切换只是「去看看那一本」，不该顺手把它激活；
   * 而「恢复」是真的要用它了，status 得跟着一起改回来 ——
   * 否则开关开了、账本还是 closed，用户看到的还是一片「关掉的」。
   */
  function openCpBook(id) {
    const b = cpBookById(id || cpActiveId());
    if (!b) return null;
    b.status = 'active';
    b.closedAt = 0;
    state.settings.couple = Object.assign({}, state.settings.couple, {
      activeId: b.id,
      enabled: true,
      hidden: false,
      closedAt: 0,
      closeReason: '',
      meName: b.meName || '',
      peerName: b.peerName || '',
      mode: b.mode || '',
      togetherSince: b.togetherSince || '',
    });
    save();
    syncHook('book.update', b);   // 重新打开也要同步，否则对方那边一直显示已关闭
    emit({ type: 'couple', action: 'open', book: b });
    return b;
  }

  /**
   * 彻底删除某一本：账目、基金、资料、列表里那条，全摘干净。
   * 这是唯一一个「删了就真没了」的动作，所以只按 id 精确删，
   * 绝不顺手清空整个 cpTxs（另一本还在里面）。
   */
  function wipeCpBook(id) {
    const target = id || cpActiveId();
    if (!target) return { removed: 0 };
    const before = cpRaw().length;
    state.cpTxs = cpRaw().filter((t) => t.cpBookId !== target);
    const removed = before - state.cpTxs.length;
    // 情侣基金：连存档也一起走
    state.goals = (state.goals || []).filter((g) => !(g.kind === 'couple' && g.cpBookId === target));
    state.cpBooks = cpBooks().filter((b) => b.id !== target);
    // 订阅体检里由这本基金推断出来的记录也清掉，别留下「幽灵订阅」
    state.subs = (state.subs || []).filter((s) => !(s.cpBookId === target));
    // 这本还没发出去的账目改动一起放弃：留着的话下次 flush 会把它推回去，等于复活
    syncPurgeOutbox((e) => String(e.kind || '').indexOf('cptx.') === 0 && !!(e.data && e.data.cpBookId === target));
    const next = cpBooks()[0];
    const cur = state.settings.couple || {};
    state.settings.couple = Object.assign({}, cur, {
      activeId: next ? next.id : '',
      enabled: next ? next.status === 'active' : false,
      hidden: false,
      closedAt: next ? next.closedAt || 0 : 0,
      closeReason: '',
      deletedAt: Date.now(),
      meName: next ? next.meName || '' : '',
      peerName: next ? next.peerName || '' : '',
      mode: next ? next.mode || '' : '',
      togetherSince: next ? next.togetherSince || '' : '',
      meBirthday: next ? next.meBirthday || '' : '',
      peerBirthday: next ? next.peerBirthday || '' : '',
      nextMeet: '',
      shareRatio: false,
    });
    save();
    // 整本删除是一条 op，对方收到后会把这本的账、基金、书一起清掉
    syncHook('book.wipe', { id: target });
    emit({ type: 'couple', action: 'wipe', bookId: target });
    return { removed, bookId: target };
  }

  /**
   * 改情侣配置里的一小块（mode / tzOffset / nextMeet …），不动开关与资料。
   * 和 enableCouple 分开：切换时区不该被当成「重新开通」。
   */
  function setCoupleConfig(patch) {
    const input = patch || {};
    state.settings.couple = Object.assign({}, state.settings.couple, input);
    save();
    // 资料同步要带 bookId：接收侧只在「当前这本」上应用，
    // 否则 A 换本时重置的资料会把 B 那边的老资料一起覆盖掉
    const bid = cpActiveId();
    if (bid) {
      syncHook('profile.set', { id: bid, bookId: bid, profile: input });
    }
    emit({ type: 'couple', action: 'config', patch: input });
    return state.settings.couple;
  }

  /** 兼容老调用：等同 closeCouple()，账目与金库全部保留 */
  function disableCouple() {
    return closeCouple('');
  }

  /** 情侣专属的目标（双心样式）：kind === 'couple'，**只算当前这一本** */
  function coupleGoals() {
    const id = cpActiveId();
    return (state.goals || []).filter((g) => g.kind === 'couple' && !g.archived
      && (!id || g.cpBookId === id));
  }

  /** 某一本的情侣基金 */
  function coupleGoalsOf(bookId) {
    return (state.goals || []).filter((g) => g.kind === 'couple' && !g.archived && g.cpBookId === bookId);
  }

  /**
   * 按槽位找情侣基金。
   * 用户看到的三个基金（小金库 / 约会基金 / 下次见面基金）不是三本账，
   * 是同一本账里三个「抽屉」。用 slot 认，不用名字认 —— 改名也不会失联。
   */
  const COUPLE_SLOTS = ['vault', 'date', 'meet'];
  function goalBySlot(slot) {
    if (COUPLE_SLOTS.indexOf(slot) < 0) return null;
    // 只认当前这一本的抽屉：历史账本里的同名基金绝不串过来
    const id = cpActiveId();
    return (state.goals || []).find((g) => g.slot === slot && !g.archived
      && (!id || g.cpBookId === id)) || null;
  }

  /**
   * 我们的小金库。
   *
   * 优先按 slot 认（任务书步骤 3：别靠名字猜），其次按名字兜底，
   * 最后才落到「第一个情侣目标」——这样老数据也能用，改名也不会失联。
   */
  function coupleVault() {
    const list = coupleGoals();
    if (!list.length) return null;
    return list.find((g) => g.slot === 'vault')
      || list.find((g) => /小金库/.test(g.name || ''))
      // 只有「一个情侣目标都还没分槽位」时才退回第一个。
      // 以前无条件 list[0]：一旦约会基金建在它前面，
      // coupleVault() 就返回约会基金，点「小金库 · 去存」进的是约会基金，
      // 定目标也定到了约会基金头上 —— 小金库本身永远停在 0。
      || (list.every((g) => !g.slot) ? list[0] : null);
  }

  /** 下次约会基金：按 slot 认，老数据按名字兜底 */
  function coupleDateFund() {
    const list = coupleGoals();
    return list.find((g) => g.slot === 'date')
      || list.find((g) => /约会/.test(g.name || ''))
      || null;
  }

  /** 下次见面基金：按 slot 认，老数据按名字兜底 */
  function coupleMeetFund() {
    const list = coupleGoals();
    return list.find((g) => g.slot === 'meet')
      || list.find((g) => /见面/.test(g.name || ''))
      || null;
  }

  function addBook(input) {
    const b = {
      id: U.uid('book'),
      name: (input && input.name || '新账本').slice(0, 12),
      icon: (input && input.icon) || '📒',
      color: (input && input.color) || '#4F7CFF',
      // 固定 'normal'：不吃 input.kind。任务书 P2——
      // 情侣账目是平行空间（state.cpTxs），绝不能借道账本实体混进来。
      kind: 'normal',
      createdAt: Date.now(),
    };
    state.books.push(b);
    save();
    emit({ type: 'book', action: 'add', book: b });
    return b;
  }

  function updateBook(id, patch) {
    const b = bookById(id);
    if (!b) return null;
    Object.assign(b, patch || {});
    save();
    emit({ type: 'book', action: 'update', book: b });
    return b;
  }

  /** 删除账本：账本里的账目一并删除（返回被删的账目数量） */
  function removeBook(id) {
    if (state.books.length <= 1) throw new Error('至少要留一个账本');
    const i = state.books.findIndex((b) => b.id === id);
    if (i < 0) return 0;
    const removed = state.tx.filter((t) => t.bookId === id).length;
    state.tx = state.tx.filter((t) => t.bookId !== id);
    state.repeats = state.repeats.filter((r) => r.bookId !== id);
    state.books.splice(i, 1);
    if (state.settings.books.activeId === id) state.settings.books.activeId = state.books[0].id;
    save();
    emit({ type: 'book', action: 'remove', id, removed });
    return removed;
  }

  /** 把账本里的账目迁移到另一个账本 */
  function mergeBook(fromId, toId) {
    if (fromId === toId) return 0;
    if (!bookById(fromId) || !bookById(toId)) return 0;
    let n = 0;
    state.tx.forEach((t) => { if (t.bookId === fromId) { t.bookId = toId; n++; } });
    state.repeats.forEach((r) => { if (r.bookId === fromId) r.bookId = toId; });
    state.books = state.books.filter((b) => b.id !== fromId);
    if (state.settings.books.activeId === fromId) state.settings.books.activeId = toId;
    save();
    emit({ type: 'book', action: 'merge', fromId, toId, moved: n });
    return n;
  }

  function switchBook(id) {
    if (id !== '*' && !bookById(id)) return null;
    state.settings.books.activeId = id;
    save();
    emit({ type: 'book', action: 'switch', id });
    return activeBook();
  }

  // ------------------------------------------------------------
  // 账目
  // ------------------------------------------------------------
  /** 周期内的账目（默认只算当前账本；allBooks=true 或处于合并视图时跨账本） */
  function txIn(p, allBooks) {
    const all = allBooks || isAllBooks();
    const bid = activeBookId();
    return state.tx
      .filter((t) => (all || !t.bookId || t.bookId === bid) && inPeriod(t.ts, p))
      .sort((a, b) => b.ts - a.ts);
  }

  function txById(id) { return state.tx.find((t) => t.id === id) || null; }

  function addTx(input) {
    const t = {
      id: U.uid('tx'),
      type: input.type === 'income' ? 'income' : 'expense',
      amount: Math.abs(Math.round(Number(input.amount) || 0)),
      catId: input.catId || 'other_out',
      sub: input.sub || '',
      accountId: input.accountId || 'alipay',
      note: (input.note || '').slice(0, 200),
      ts: input.ts || Date.now(),
      bookId: input.bookId || writeBookId(),
      srcKey: input.srcKey || '',
      amountFx: input.amountFx != null ? Math.abs(Math.round(Number(input.amountFx) || 0)) : 0,
      fxRate: input.fxRate != null ? Number(input.fxRate) || 0 : 0,
      fxCode: input.fxCode || '',
      createdAt: Date.now(),
    };
    if (input.advance) t.advance = normalizeAdvance(input.advance);
    state.tx.push(t);
    save();
    emit({ type: 'tx', action: 'add', tx: t });
    return t;
  }

  /** 垫付信息标准化 */
  function normalizeAdvance(a) {
    const src = a || {};
    return {
      who: String(src.who || '').trim().slice(0, 40),
      status: src.status === 'settled' ? 'settled' : 'open',
      dueTs: Number(src.dueTs) || 0,
      settledTs: Number(src.settledTs) || 0,
      settledAmount: Math.round(Number(src.settledAmount) || 0),
      askedTs: Number(src.askedTs) || 0,   // 上次问「还回来了吗」，按天免打扰
    };
  }

  /** 批量新增（账单导入用）：只存一次盘、只发一次事件 */
  function addTxMany(inputs) {
    const out = [];
    const bid = writeBookId();
    (inputs || []).forEach((input) => {
      if (!input || !(Number(input.amount) > 0)) return;
      out.push({
        id: U.uid('tx'),
        type: input.type === 'income' ? 'income' : 'expense',
        amount: Math.abs(Math.round(Number(input.amount) || 0)),
        catId: input.catId || 'other_out',
        sub: input.sub || '',
        accountId: input.accountId || 'alipay',
        note: (input.note || '').slice(0, 200),
        ts: input.ts || Date.now(),
        bookId: input.bookId || bid,
        srcKey: input.srcKey || '',
        createdAt: Date.now(),
      });
    });
    if (!out.length) return [];
    out.forEach((t) => state.tx.push(t));
    save();
    emit({ type: 'tx', action: 'addMany', list: out });
    return out;
  }

  /** 已存在的去重键（账单导入时用来避免重复记账） */
  function srcKeys(bookId) {
    const bid = bookId || writeBookId();
    const set = new Set();
    state.tx.forEach((t) => {
      if (t.srcKey && (!t.bookId || t.bookId === bid)) set.add(t.srcKey);
    });
    return set;
  }

  function updateTx(id, patch) {
    const t = txById(id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: Date.now() });
    if (patch.amount != null) t.amount = Math.abs(Math.round(Number(patch.amount) || 0));
    save();
    emit({ type: 'tx', action: 'update', tx: t });
    return t;
  }

  function removeTx(id) {
    const i = state.tx.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const [t] = state.tx.splice(i, 1);
    save();
    emit({ type: 'tx', action: 'remove', tx: t });
    return t;
  }

  function restoreTx(t) {
    if (!t || txById(t.id)) return;
    state.tx.push(t);
    save();
    emit({ type: 'tx', action: 'restore', tx: t });
  }

  // ------------------------------------------------------------
  // 日 / 月 / 年 统计区间（总结页的年月日选项卡用）
  // ------------------------------------------------------------
  function dayPeriod(date) {
    const d = U.startOfDay(date || new Date());
    return {
      key: 'D:' + U.ymd(d),
      label: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
      shortLabel: `${d.getMonth() + 1}月${d.getDate()}日`,
      start: d,
      end: U.endOfDay(d),
      days: 1,
      type: 'day',
    };
  }

  function monthPeriod(date) {
    const d = date || new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      key: 'CAL:' + U.monthKey(start),
      label: `${start.getFullYear()}年${start.getMonth() + 1}月`,
      shortLabel: `${start.getFullYear()}年${start.getMonth() + 1}月`,
      start, end,
      days: new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate(),
      type: 'calendar',
    };
  }

  function yearPeriod(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    return {
      key: 'Y:' + y,
      label: `${y}年`,
      shortLabel: `${y}年`,
      start: new Date(y, 0, 1),
      end: new Date(y, 11, 31, 23, 59, 59, 999),
      days: (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365,
      type: 'year',
    };
  }

  /** 按 scope（day/month/year）取某个日期的区间 */
  function scopePeriod(scope, date) {
    if (scope === 'day') return dayPeriod(date);
    if (scope === 'year') return yearPeriod(date);
    return monthPeriod(date);
  }

  /** 按 scope 平移 n 个单位 */
  function shiftScope(scope, date, n) {
    const d = date || new Date();
    if (scope === 'day') return U.addDays(d, n);
    if (scope === 'year') return new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
    const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
    return x;
  }

  // ------------------------------------------------------------
  // 自定义分类
  // ------------------------------------------------------------
  function catConfig() {
    const c = state.settings.cats || (state.settings.cats = { hidden: [], overrides: {}, custom: [] });
    if (!Array.isArray(c.hidden)) c.hidden = [];
    if (!Array.isArray(c.custom)) c.custom = [];
    if (!c.overrides || typeof c.overrides !== 'object') c.overrides = {};
    return c;
  }

  function applyCats() {
    Icons.setCustom(catConfig());
    save();
    emit({ type: 'cats' });
  }

  function addCategory(input) {
    const c = catConfig();
    const name = (input && input.name || '').trim().slice(0, 8);
    if (!name) throw new Error('分类名不能为空');
    const kind = input.kind === 'income' ? 'income' : 'expense';
    if (Icons.CATEGORIES.some((x) => x.kind === kind && x.name === name)) throw new Error('已经有一个同名分类了');
    const cat = {
      // 自定义分类默认排在「红包」之后 —— 红包要跟人情挨着，不能被后建的分类挤到下面去。
      // 只用 insertBefore 不用 splice 拼数组：catConfig().custom 被 addCategory 直接 push / splice 原地改，
      // 别处（如果有）持有的同一个数组引用要跟着变。
      id: U.uid('cat'),
      name,
      icon: input.icon || '🏷️',
      color: input.color || '#4F7CFF',
      kind,
      subs: (input.subs || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20),
    };
    const at = kind === 'expense'
      ? c.custom.filter((x) => (x.kind || 'expense') === 'expense').length
      : c.custom.length;
    c.custom.splice(at, 0, cat);
    applyCats();
    return cat;
  }

  function updateCategory(id, patch) {
    const c = catConfig();
    const p = patch || {};
    if (Icons.isBuiltin(id)) {
      // 内置分类：允许改名 / 改图标 / 改二级标签，存到 overrides
      const base = Icons.BUILTIN.find((b) => b.id === id);
      const ov = c.overrides[id] || {};
      if (p.name != null) {
        const nm = String(p.name).trim().slice(0, 8);
        if (nm && nm !== base.name) ov.name = nm;
        else delete ov.name;
      }
      if (p.icon != null) {
        if (p.icon && p.icon !== base.icon) ov.icon = p.icon;
        else delete ov.icon;
      }
      // 颜色：以前内置分类改不了色（overrides 里根本没有 color），
      // 红包要跟裙子、美妆那套粉色排在一起，光靠图标不够，得能改色。
      if (p.color != null) {
        const cl = String(p.color).trim();
        if (cl && cl !== base.color) ov.color = cl;
        else delete ov.color;
      }
      if (p.subs != null) {
        const arr = p.subs.map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
        if (arr.join('|') !== base.subs.join('|')) ov.subs = arr;
        else delete ov.subs;
      }
      if (Object.keys(ov).length) c.overrides[id] = ov;
      else delete c.overrides[id];
    } else {
      const item = c.custom.find((x) => x.id === id);
      if (!item) return null;
      if (p.name != null) {
        const nm = String(p.name).trim().slice(0, 8);
        if (!nm) throw new Error('分类名不能为空');
        item.name = nm;
      }
      if (p.icon != null) item.icon = p.icon || '🏷️';
      if (p.color != null) item.color = p.color;
      if (p.subs != null) item.subs = p.subs.map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
    }
    applyCats();
    return Icons.cat(id);
  }

  /** 删除自定义分类 / 隐藏内置分类 */
  function removeCategory(id) {
    const c = catConfig();
    if (Icons.isBuiltin(id)) {
      if (c.hidden.indexOf(id) < 0) c.hidden.push(id);
    } else {
      const i = c.custom.findIndex((x) => x.id === id);
      if (i < 0) return false;
      c.custom.splice(i, 1);
    }
    // 受影响的账目回落到「其他」
    const fallback = Icons.cat(id).kind === 'income' ? 'other_in' : 'other_out';
    state.tx.forEach((t) => {
      if (t.catId === id) { t.catId = fallback; t.sub = ''; }
    });
    applyCats();
    return true;
  }

  function restoreCategory(id) {
    const c = catConfig();
    const i = c.hidden.indexOf(id);
    if (i >= 0) c.hidden.splice(i, 1);
    applyCats();
    return true;
  }

  function restoreAllCategories() {
    state.settings.cats = { hidden: [], overrides: {}, custom: [] };
    applyCats();
    return true;
  }

  // ------------------------------------------------------------
  // 周期性自动记账
  // ------------------------------------------------------------
  const REPEAT_FREQ = {
    monthly: '每月',
    weekly: '每周',
    biweekly: '每两周',
    quarterly: '每季',
    yearly: '每年',
  };

  function repeats() { return state.repeats || []; }

  function repeatById(id) { return repeats().find((r) => r.id === id) || null; }

  function addRepeat(input) {
    const r = {
      id: U.uid('rep'),
      name: (input.name || '').trim().slice(0, 20) || '周期性账目',
      type: input.type === 'income' ? 'income' : 'expense',
      amount: Math.abs(Math.round(Number(input.amount) || 0)),
      catId: input.catId || 'other_out',
      sub: input.sub || '',
      accountId: input.accountId || 'alipay',
      note: (input.note || '').slice(0, 200),
      freq: REPEAT_FREQ[input.freq] ? input.freq : 'monthly',
      startDay: U.clamp(Number(input.startDay) || 1, 1, 28),
      startYm: input.startYm || U.monthKey(new Date()),
      bookId: input.bookId || writeBookId(),
      enabled: input.enabled !== false,
      lastRun: '',            // 最后一次自动记账的周期键
      createdAt: Date.now(),
    };
    if (!r.amount) throw new Error('金额不能为 0');
    state.repeats.push(r);
    save();
    emit({ type: 'repeat', action: 'add', repeat: r });
    return r;
  }

  function updateRepeat(id, patch) {
    const r = repeatById(id);
    if (!r) return null;
    Object.assign(r, patch || {});
    if (patch && patch.amount != null) r.amount = Math.abs(Math.round(Number(patch.amount) || 0));
    save();
    emit({ type: 'repeat', action: 'update', repeat: r });
    return r;
  }

  function removeRepeat(id) {
    const i = repeats().findIndex((r) => r.id === id);
    if (i < 0) return null;
    const [r] = state.repeats.splice(i, 1);
    save();
    emit({ type: 'repeat', action: 'remove', repeat: r });
    return r;
  }

  /** 某条规则到 endTs 为止应当发生的日期列表（最多回溯 24 期） */
  function repeatDueDates(r, endTs) {
    const out = [];
    const end = U.startOfDay(new Date(endTs || Date.now()));
    const startYm = r.startYm || U.monthKey(new Date());
    const [sy, sm] = startYm.split('-').map(Number);
    if (!sy || !sm) return out;

    const push = (d) => {
      const t = U.startOfDay(d);
      if (t.getTime() <= end.getTime()) out.push(t);
    };

    if (r.freq === 'monthly' || r.freq === 'quarterly') {
      const step = r.freq === 'quarterly' ? 3 : 1;
      for (let i = 0; i < 240; i++) {
        const m = (sm - 1) + i * step;
        const y = sy + Math.floor(m / 12);
        const mm = ((m % 12) + 12) % 12;
        const day = U.clamp(Number(r.startDay) || 1, 1, U.daysInMonth(y, mm));
        const d = new Date(y, mm, day);
        if (d.getTime() > end.getTime()) break;
        push(d);
      }
    } else if (r.freq === 'yearly') {
      for (let i = 0; i < 60; i++) {
        const y = sy + i;
        const day = U.clamp(Number(r.startDay) || 1, 1, U.daysInMonth(y, sm - 1));
        const d = new Date(y, sm - 1, day);
        if (d.getTime() > end.getTime()) break;
        push(d);
      }
    } else {
      const step = r.freq === 'biweekly' ? 14 : 7;
      let d = new Date(sy, sm - 1, U.clamp(Number(r.startDay) || 1, 1, 28));
      for (let i = 0; i < 400; i++) {
        if (d.getTime() > end.getTime()) break;
        push(d);
        d = U.addDays(d, step);
      }
    }
    return out;
  }

  /**
   * 补记所有到期未记的周期性账目。
   * 幂等：每笔生成的账目带 srcKey = 'rep:<id>:<ymd>'，且规则上记 lastRun，
   * 所以同一天跑多少次都不会重复记账，漏掉的过去周期也会补齐。
   */
  function runRepeats(now) {
    if (!state.settings.repeat || state.settings.repeat.enabled === false) return [];
    const nowTs = now || Date.now();
    const out = [];
    const seen = srcKeysAll();

    repeats().forEach((r) => {
      if (!r.enabled) return;
      if (!(r.amount > 0)) return;
      repeatDueDates(r, nowTs).forEach((d) => {
        const key = 'rep:' + r.id + ':' + U.ymd(d);
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          id: U.uid('tx'),
          type: r.type,
          amount: r.amount,
          catId: r.catId,
          sub: r.sub || '',
          accountId: r.accountId,
          note: r.note || r.name,
          ts: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).getTime(),
          bookId: r.bookId,
          srcKey: key,
          repeatId: r.id,
          createdAt: Date.now(),
        });
      });
      const due = repeatDueDates(r, nowTs);
      if (due.length) r.lastRun = U.ymd(due[due.length - 1]);
    });

    if (!out.length) { save(); return []; }
    out.forEach((t) => state.tx.push(t));
    save();
    emit({ type: 'tx', action: 'addMany', list: out, repeat: true });
    return out;
  }

  /** 全账本的去重键（周期性记账跨账本判断） */
  function srcKeysAll() {
    const set = new Set();
    state.tx.forEach((t) => { if (t.srcKey) set.add(t.srcKey); });
    return set;
  }

  /** 某条规则接下来几次会发生 */
  function repeatUpcoming(r, count) {
    const n = count || 3;
    const out = [];
    const now = U.startOfDay(new Date());
    const future = U.addDays(now, 366 * 3);
    const all = repeatDueDates(r, future.getTime());
    all.forEach((d) => {
      if (d.getTime() >= now.getTime() && out.length < n) out.push(d);
    });
    return out;
  }

  /** 某条规则已经自动记了多少笔 */
  function repeatCount(r) {
    const pre = 'rep:' + r.id + ':';
    return state.tx.filter((t) => t.srcKey && t.srcKey.indexOf(pre) === 0).length;
  }

  // ------------------------------------------------------------
  // 统计
  // ------------------------------------------------------------
  /**
   * 只留档、不参与任何金额统计的记录
   * 目前只有一种：已经归还的垫付——钱回来了，就不是你的开销，
   * 但记录留在列表里（划掉），方便回头查「谁什么时候还过我钱」。
   */
  function isVoid(t) {
    return !!(t && t.type === 'expense' && t.advance && t.advance.status === 'settled');
  }

  function summary(p, list) {
    const items = list || txIn(p);
    let expense = 0, income = 0, expCount = 0, incCount = 0, pending = 0, pendingCount = 0;
    const byCat = {}, byDay = {}, byAccount = {};
    items.forEach((t) => {
      const day = U.ymd(t.ts);
      // 垫付：还没还的时候钱确实花出去了，照常计入支出（并标 pending 方便提示「还会回来」）；
      // 还回来之后只留档（isVoid），不再算进任何金额。
      const isPending = t.type === 'expense' && t.advance && t.advance.status === 'open';
      if (t.type === 'income') {
        income += t.amount; incCount++;
        byCat[t.catId] = byCat[t.catId] || { id: t.catId, amount: 0, count: 0, type: 'income' };
        byCat[t.catId].amount += t.amount; byCat[t.catId].count++;
      } else if (isVoid(t)) {
        return;   // 已归还的垫付：留档，但不计入任何金额
      } else {
        expense += t.amount; expCount++;
        if (isPending) { pending += t.amount; pendingCount++; }
        byCat[t.catId] = byCat[t.catId] || { id: t.catId, amount: 0, count: 0, type: 'expense' };
        byCat[t.catId].amount += t.amount; byCat[t.catId].count++;
        byAccount[t.accountId] = (byAccount[t.accountId] || 0) + t.amount;
        byDay[day] = (byDay[day] || 0) + t.amount;
      }
    });
    const cats = Object.values(byCat)
      .filter((c) => c.type === 'expense')
      .sort((a, b) => b.amount - a.amount)
      .map((c) => ({ ...c, pct: expense ? c.amount / expense : 0, meta: Icons.cat(c.id) }));
    // byAccount 是 map（按 accountId 聚合），另外给一个排好序的数组方便渲染
    const byAccountList = Object.keys(byAccount)
      .map((id) => {
        const meta = (state.accounts.find((a) => a.id === id)) || { id, name: id, icon: '💳' };
        return { id, amount: byAccount[id], pct: expense ? byAccount[id] / expense : 0, meta };
      })
      .sort((a, b) => b.amount - a.amount);
    return {
      expense, income, net: income - expense,
      count: items.length, expCount, incCount,
      pending, pendingCount,
      byCat: cats, byDay, byAccount, byAccountList,
      avgDaily: expense / (p ? p.days : 1),
    };
  }

  /** 按日累计序列，用于趋势图 */
  function dailySeries(p) {
    const out = [];
    const list = txIn(p).filter((t) => !isVoid(t));
    const map = {};
    list.forEach((t) => { if (t.type === 'expense') map[U.ymd(t.ts)] = (map[U.ymd(t.ts)] || 0) + t.amount; });
    let cursor = U.startOfDay(p.start);
    while (cursor.getTime() <= U.startOfDay(p.end).getTime()) {
      const k = U.ymd(cursor);
      out.push({ day: cursor.getDate(), key: k, amount: map[k] || 0, ts: cursor.getTime() });
      cursor = U.addDays(cursor, 1);
    }
    return out;
  }

  // ------------------------------------------------------------
  // 预算
  // ------------------------------------------------------------
  function budgetFor(p) {
    const s = state.settings.budget || { amount: 0, split: {} };
    return {
      total: Number(s.amount) || 0,
      split: s.split || {},
    };
  }

  function budgetStatus(p) {
    const list = txIn(p);
    const sum = summary(p, list);
    const b = budgetFor(p);
    const now = Date.now();
    const total = b.total;
    const spent = sum.expense;
    const remaining = total - spent;
    const pct = total > 0 ? spent / total : 0;
    const totalDays = p.days;
    const elapsed = U.clamp(Math.ceil((Math.min(now, p.end.getTime()) - p.start.getTime() + 1) / 86400000), 1, totalDays);
    const daysLeft = Math.max(1, totalDays - elapsed + (now <= p.end.getTime() ? 1 : 0));
    const isCurrent = now >= p.start.getTime() && now <= p.end.getTime();
    const dailyAllowance = isCurrent ? Math.max(0, remaining) / Math.max(1, daysLeft) : 0;

    // 分类预算
    const cats = Object.keys(b.split).filter((k) => Number(b.split[k]) > 0).map((catId) => {
      const used = sum.byCat.find((c) => c.id === catId);
      const amount = Number(b.split[catId]) || 0;
      const usedAmt = used ? used.amount : 0;
      return {
        catId, meta: Icons.cat(catId), limit: amount, used: usedAmt,
        pct: amount ? usedAmt / amount : 0, remaining: amount - usedAmt,
      };
    }).sort((a, b2) => b2.pct - a.pct);

    // 状态：safe / warn / over
    let level = 'safe';
    if (total > 0) {
      if (pct >= 1) level = 'over';
      else if (pct >= 0.8) level = 'warn';
      if (pct < 0.8 && isCurrent && elapsed / totalDays > 0.6 && pct > (elapsed / totalDays) * 1.25) level = 'warn';
    }
    return {
      total, spent, remaining, pct, level, dailyAllowance, daysLeft, elapsed,
      totalDays, isCurrent, cats, income: sum.income, count: sum.count,
    };
  }

  // ------------------------------------------------------------
  // 低预算提醒
  // ------------------------------------------------------------
  function checkAlerts() {
    const a = state.settings.alert;
    if (!a || !a.enabled) return [];
    const p = currentPeriod();
    const st = budgetStatus(p);
    if (!st.total) return [];
    const fired = state.alertLog[p.key] || (state.alertLog[p.key] = []);
    const out = [];
    (a.thresholds || []).slice().sort((x, y) => x - y).forEach((th) => {
      if (st.pct * 100 >= th && fired.indexOf(th) < 0) {
        fired.push(th);
        out.push({ threshold: th, pct: st.pct, period: p, status: st });
      }
    });
    if (out.length) save();
    return out;
  }

  function resetAlertLog(pKey) {
    if (pKey) delete state.alertLog[pKey];
    else state.alertLog = {};
    save();
  }

  // ------------------------------------------------------------
  // 攒钱目标
  // ------------------------------------------------------------
  function addGoal(input) {
    const g = {
      id: U.uid('goal'),
      name: (input.name || '新目标').slice(0, 30),
      icon: input.icon || '🎯',
      target: Math.abs(Math.round(Number(input.target) || 0)),
      saved: Math.abs(Math.round(Number(input.saved) || 0)),
      deadline: input.deadline || null,
      color: input.color || '#4F7CFF',
      note: input.note || '',
      kind: input.kind === 'couple' ? 'couple' : 'normal',
      // 情侣目标的槽位：'vault' 小金库 / 'date' 约会基金 / 'meet' 见面基金 / '' 无
      // 用字段认，不靠名字猜（任务书步骤 3）
      slot: input.slot || '',
      // 情侣基金必须当场盖上当前这一本的章：coupleGoals() / goalBySlot()
      // 都按 cpBookId 过滤，漏写就是「刚建完就不见了」。
      cpBookId: input.kind === 'couple' ? (input.cpBookId || cpActiveId()) : '',
      createdAt: Date.now(),
      archived: false,
      logs: [],
    };
    state.goals.push(g);
    save();
    emit({ type: 'goal', action: 'add', goal: g });
    // 只同步情侣基金；个人目标一个字节都不传
    if (g.cpBookId) syncHook('goal.add', g);
    return g;
  }

  function updateGoal(id, patch) {
    const g = goalById(id);
    if (!g) return null;
    Object.assign(g, patch);
    if (patch.target != null) g.target = Math.abs(Math.round(Number(patch.target) || 0));
    save();
    emit({ type: 'goal', action: 'update', goal: g });
    if (g.cpBookId) syncHook('goal.update', g);
    return g;
  }

  function removeGoal(id) {
    const i = state.goals.findIndex((g) => g.id === id);
    if (i < 0) return null;
    const [g] = state.goals.splice(i, 1);
    save();
    emit({ type: 'goal', action: 'remove', goal: g });
    if (g && g.cpBookId) syncHook('goal.remove', g);
    return g;
  }

  function goalById(id) { return state.goals.find((g) => g.id === id) || null; }

  function depositGoal(id, amount, note) {
    const g = goalById(id);
    if (!g) return null;
    const amt = Math.round(Number(amount) || 0);
    if (!amt) return null;
    g.saved = Math.max(0, g.saved + amt);
    g.logs = g.logs || [];
    g.logs.push({ id: U.uid('log'), amount: amt, note: note || '', ts: Date.now() });
    save();
    emit({ type: 'goal', action: 'deposit', goal: g });
    // 存钱也要同步（带整条目标，合并层按 seq 覆盖；logs 一起过去）
    if (g.cpBookId) syncHook('goal.deposit', g);
    return g;
  }

  function goalProgress(g) {
    const pct = g.target > 0 ? U.clamp(g.saved / g.target, 0, 1) : 0;
    const left = Math.max(0, g.target - g.saved);
    let monthsLeft = null, perMonth = null, perDay = null, daysLeft = null, done = g.saved >= g.target && g.target > 0;
    if (g.deadline) {
      const dl = U.startOfDay(new Date(g.deadline));
      daysLeft = Math.max(0, Math.round((dl - U.startOfDay(new Date())) / 86400000));
      monthsLeft = Math.max(1, daysLeft / 30);
      perMonth = left / monthsLeft;
      perDay = left / Math.max(1, daysLeft);
    }
    // 预计达成：按近 30 天存入速度
    let eta = null;
    const logs = (g.logs || []).filter((l) => Date.now() - l.ts < 30 * 86400000 && l.amount > 0);
    const speed = logs.reduce((s, l) => s + l.amount, 0) / 30;
    if (!done && speed > 0) eta = Math.round(left / speed);
    return { pct, left, monthsLeft, perMonth, perDay, daysLeft, done, eta, speed };
  }

  // ------------------------------------------------------------
  // 今天还能花：把周期预算拆成「今天的额度」
  // ------------------------------------------------------------
  /**
   * 今日额度：剩余预算 / 剩余天数，再扣掉今天已经花掉的
   * 返回 { total, spent, quota, todaySpent, left, daysLeft, level, projected, after }
   *   left      = 今天还能花多少（已扣今天已花）
   *   projected = 若再记一笔 amount 后今天还剩多少（用 after(amount) 算）
   */
  /**
   * 今天还能花多少
   * 口径：今天开始时剩下的额度 ÷ 剩余天数（含今天）= 今天额度；
   *      再减去今天已经花掉的，才是「今天还能花」。
   * 不能直接用 budgetStatus().dailyAllowance —— 它用的是已扣今天的剩余，
   * 再减一次 todaySpent 会重复计算。
   * @returns {{total, spent, quota, todaySpent, left, daysLeft, level, isCurrent, budgetLevel}}
   */
  function todayQuota(p) {
    const period = p || currentPeriod();
    const b = budgetStatus(period);
    const today = U.ymd(new Date());
    const list = txIn(period);
    let todaySpent = 0;
    list.forEach((t) => {
      if (t.type !== 'expense') return;
      if (isVoid(t)) return;   // 已归还的垫付只留档，不算今天已花
      if (U.ymd(t.ts) === today) todaySpent += t.amount;
    });
    // 今天开始时的剩余额度，摊到今天为止剩下的每一天
    const spentBeforeToday = Math.max(0, b.spent - todaySpent);
    const leftAtStart = Math.max(0, b.total - spentBeforeToday);
    const quota = b.isCurrent && b.total ? leftAtStart / Math.max(1, b.daysLeft) : 0;
    const left = quota - todaySpent;
    let level = 'safe';
    if (quota > 0) {
      if (left < 0) level = 'over';
      else if (left < quota * 0.25) level = 'warn';
    }
    return {
      total: b.total, spent: b.spent, quota, todaySpent, left,
      daysLeft: b.daysLeft, level, isCurrent: b.isCurrent,
      budgetLevel: b.level,
    };
  }

  /** 再记一笔 amount 之后，今天还剩多少（负数=超了） */
  function quotaAfter(amount) {
    const q = todayQuota();
    return q.left - Math.abs(Math.round(Number(amount) || 0));
  }

  // ------------------------------------------------------------
  // 上次多少钱：按「分类 + 二级标签」回看历史价格
  // ------------------------------------------------------------
  /**
   * 查同一分类（+二级标签）最近几笔
   * 注意：state.tx 的插入顺序不等于时间顺序（用户可以补记旧账），
   * 所以必须全量匹配后按 ts 排序再截断，不能边倒序扫边提前退出。
   * @returns {Array<{amount, ts, note, sub, catId}>} 时间倒序，最多 count 条
   */
  function lastPrices(catId, sub, count) {
    const n = count || 3;
    const bid = writeBookId();
    const out = [];
    for (let i = 0; i < state.tx.length; i++) {
      const t = state.tx[i];
      if (t.type !== 'expense') continue;
      if (t.catId !== catId) continue;
      if (sub && t.sub !== sub) continue;
      if (t.bookId && t.bookId !== bid) continue;
      out.push(t);
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, n).map((t) => ({
      id: t.id, amount: t.amount, ts: t.ts, note: t.note, sub: t.sub, catId: t.catId,
    }));
  }

  /** 最近一次同分类（+子标签）的价格，没有返回 null */
  function lastPrice(catId, sub) {
    const list = lastPrices(catId, sub, 1);
    return list.length ? list[0] : null;
  }

  /**
   * 备注关键词联想：把历史备注拆词，找出与输入最匹配的分类
   * @returns {{catId, sub, hits}|null}
   */
  function guessByNote(text) {
    const q = String(text || '').trim().toLowerCase();
    if (q.length < 2) return null;
    const hit = {};
    state.tx.forEach((t) => {
      if (t.type !== 'expense') return;
      const note = String(t.note || '').toLowerCase();
      if (!note || note.indexOf(q) < 0) return;
      const k = t.catId + '|' + (t.sub || '');
      hit[k] = hit[k] || { catId: t.catId, sub: t.sub || '', hits: 0, amount: t.amount, ts: t.ts };
      hit[k].hits++;
      if (t.ts > hit[k].ts) { hit[k].ts = t.ts; hit[k].amount = t.amount; }
    });
    const arr = Object.values(hit).sort((a, b) => b.hits - a.hits || b.ts - a.ts);
    return arr.length ? arr[0] : null;
  }

  // ------------------------------------------------------------
  // 垫付待收
  // ------------------------------------------------------------
  function setAdvance(id, patch) {
    const t = txById(id);
    if (!t) return null;
    const cur = t.advance ? normalizeAdvance(t.advance) : normalizeAdvance({});
    t.advance = normalizeAdvance(Object.assign({}, cur, patch || {}));
    save();
    emit({ type: 'tx', action: 'update', tx: t });
    return t;
  }

  function clearAdvance(id) {
    const t = txById(id);
    if (!t) return null;
    delete t.advance;
    save();
    emit({ type: 'tx', action: 'update', tx: t });
    return t;
  }

  /** 未收回的垫付（全部账本，因为催款和账本无关） */
  function advances(onlyOpen) {
    const out = state.tx.filter((t) => t.advance && (onlyOpen === false ? true : t.advance.status === 'open'));
    return out.sort((a, b) => (a.advance.dueTs || a.ts) - (b.advance.dueTs || b.ts));
  }

  /**
   * 到期该问一句「还回来了吗」的垫付
   * 规则：还没归还 + 设了还款日 + 还款日已过 + 今天还没问过
   */
  function advancesToAsk(now) {
    const ts = now || Date.now();
    const today = U.startOfDay(new Date(ts)).getTime();
    return advances().filter((t) => {
      const a = t.advance;
      if (!a.dueTs) return false;                    // 没设还款日就不打扰
      if (U.startOfDay(new Date(a.dueTs)).getTime() > today) return false;  // 还没到期
      if (a.askedTs && U.startOfDay(new Date(a.askedTs)).getTime() >= today) return false; // 今天问过了
      return true;
    });
  }

  /** 垫付汇总 */
  function advanceSummary(now) {
    const ts = now || Date.now();
    const all = state.tx.filter((t) => t.advance);
    let openAmount = 0, openCount = 0, settledAmount = 0, settledCount = 0;
    const overdue = [];
    const today = U.startOfDay(new Date(ts)).getTime();
    all.forEach((t) => {
      if (t.advance.status === 'open') {
        openAmount += t.amount; openCount++;
        if (t.advance.dueTs && U.startOfDay(new Date(t.advance.dueTs)).getTime() < today) overdue.push(t);
      } else {
        settledAmount += (t.advance.settledAmount || t.amount); settledCount++;
      }
    });
    overdue.sort((a, b) => a.advance.dueTs - b.advance.dueTs);
    const asking = advancesToAsk(ts);
    return { openAmount, openCount, settledAmount, settledCount, overdue, asking };
  }

  /** 问过了，今天别再问（用户选「还没还」时调用） */
  function markAdvanceAsked(id, ts) {
    const t = txById(id);
    if (!t || !t.advance) return null;
    t.advance.askedTs = Number(ts) || Date.now();
    save();
    emit({ type: 'tx', action: 'update', tx: t });
    return t;
  }

  /**
   * 钱还回来了：这笔就不是你的开销了，但记录留着（明细里划掉）。
   * 标记成 settled 之后，summary / budgetStatus / todayQuota / 对账 全部跳过它，
   * 所以「只留文字，不算钱」。
   */
  function settleAdvance(id, ts) {
    const t = txById(id);
    if (!t || !t.advance) return null;
    t.advance.status = 'settled';
    t.advance.settledTs = Number(ts) || Date.now();
    t.advance.settledAmount = t.amount;
    save();
    emit({ type: 'tx', action: 'update', tx: t });
    return t;
  }

  // ------------------------------------------------------------
  // 固定月支出：房租 / 话费 / 宽带这类「每月固定、但不是 App 订阅」的钱
  // ------------------------------------------------------------
  const FIXED_PRESETS = [
    { key: 'rent', name: '房租', icon: '🏠', catId: 'housing', sub: '房租', day: 1 },
    { key: 'phone', name: '话费', icon: '📱', catId: 'other_out', sub: '', day: 10 },
    { key: 'broadband', name: '宽带', icon: '🌐', catId: 'housing', sub: '网费', day: 15 },
    { key: 'utility', name: '水电燃气', icon: '💡', catId: 'housing', sub: '水电', day: 20 },
    { key: 'insurance', name: '保险', icon: '🛡️', catId: 'health', sub: '', day: 1 },
  ];

  /** 固定月支出的预设项（界面上给几个常用模板） */
  function fixedPresets() { return FIXED_PRESETS.slice(); }

  /** 已有的固定月支出（每月一期的周期规则） */
  function fixedExpenses() {
    return state.repeats
      .filter((r) => r.type === 'expense' && r.freq === 'monthly' && r.bookId === writeBookId())
      .sort((a, b) => a.startDay - b.startDay);
  }

  /** 加一条固定月支出（本质是每月一期的周期记账规则） */
  function addFixed(input) {
    const it = input || {};
    return addRepeat({
      name: it.name, type: 'expense', amount: it.amount,
      catId: it.catId || 'other_out', sub: it.sub || '',
      accountId: it.accountId || 'alipay', note: it.name || '',
      freq: 'monthly', startDay: it.day || 1,
    });
  }


  // ------------------------------------------------------------
  // 余钱归仓：周期结束后把结余自动存进攒钱目标
  // ------------------------------------------------------------
  /**
   * 结算所有「已结束但没结算过」的周期
   * 幂等：srcKey = 'save:<periodKey>'，同一周期只入一次
   * @returns {Array<{periodKey, goalId, amount}>} 本次新结算的记录
   */
  function settlePeriods(now) {
    const cfg = state.settings.autoSave || {};
    if (!cfg.enabled || !cfg.goalId) return [];
    const goal = goalById(cfg.goalId);
    if (!goal) return [];
    const ts = now || Date.now();
    const cur = currentPeriod();
    const done = [];
    // 最多回看 24 个周期，避免首次打开时刷爆
    for (let n = 1; n <= 24; n++) {
      const p = shiftPeriod(cur, -n);
      if (p.end.getTime() > ts) continue;          // 还没结束
      const key = 'save:' + p.key;
      const logs = goal.logs || [];
      if (logs.some((l) => l.srcKey === key)) continue;
      const b = budgetStatus(p);
      if (!b.total) continue;                       // 没设预算就没结余概念
      const surplus = b.remaining;
      if (surplus <= 0) continue;
      let amount = Math.round(surplus * (Number(cfg.ratio) || 1));
      if (cfg.cap > 0) amount = Math.min(amount, Number(cfg.cap));
      if (amount <= 0) continue;
      // 记一条 0 金额的「归仓流水」到 goal.logs，用 srcKey 幂等
      goal.saved = Math.max(0, goal.saved + amount);
      goal.logs = goal.logs || [];
      goal.logs.push({
        id: U.uid('log'), amount, note: `上期结余自动归仓 · ${p.label}`,
        ts: p.end.getTime(), srcKey: key, auto: true,
      });
      done.push({ periodKey: p.key, goalId: goal.id, amount, label: p.label });
    }
    if (done.length) {
      save();
      emit({ type: 'goal', action: 'autoSave', list: done });
    }
    return done;
  }

  /** 预览下一个即将结算的周期能归仓多少（设置页展示用） */
  function autoSavePreview() {
    const cur = currentPeriod();
    const b = budgetStatus(cur);
    const cfg = state.settings.autoSave || {};
    if (!b.total) return { amount: 0, label: cur.label, hasBudget: false };
    const surplus = Math.max(0, b.remaining);
    let amount = Math.round(surplus * (Number(cfg.ratio) || 1));
    if (cfg.cap > 0) amount = Math.min(amount, Number(cfg.cap));
    return { amount, label: cur.label, hasBudget: true, surplus };
  }

  // ------------------------------------------------------------
  // 订阅体检：从历史账目里揪出周期性扣款
  // ------------------------------------------------------------
  /** 把备注/商户归一化成聚类键 */
  function subKeyOf(t) {
    const raw = String(t.note || '').trim();
    if (!raw) return '';
    return raw.toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[（(].*?[)）]/g, '')
      .replace(/(自动续费|续费|会员|订阅|月度|包月|包年|连续包月|连续包年|扣款|支付)/g, '')
      .slice(0, 24);
  }

  // ------------------------------------------------------------
  // 「自动扣费」只看 App / 线上服务，像房租、话费这种生活固定支出
  // 走「固定月支出」入口，不在这里刷屏
  // ------------------------------------------------------------
  /** 明显不是 App 订阅的生活固定开销（命中即排除） */
  const SUB_EXCLUDE = [
    '房租', '租金', '押金', '中介', '物业', '房贷', '房租水电',
    '水费', '电费', '燃气', '煤气', '暖气', '取暖',
    '话费', '手机费', '宽带', '流量', '电信', '移动', '联通', '移动话费',
    '停车', '车位', '加油', '油费', '通行费', '过路费',
    '保险', '社保', '公积金', '工资', '学费', '餐费', '伙食', '买菜', '超市',
  ];
  /** App / 线上服务的正向信号（命中即视为自动扣费） */
  const SUB_HINT = [
    '会员', 'vip', 'svip', '订阅', '续费', '自动续费', '包月', '包年', '连续包月', '连续包年',
    '云', 'cloud', '网盘', '视频', '影视', '音乐', '音乐', '读书', '课程', '网课',
    '健身', '游戏', '应用', 'app', 'store', 'netflix', 'spotify', 'youtube', 'icloud',
    '爱奇艺', '腾讯', '优酷', '哔哩', 'bilibili', '网易', '喜马', '得到', '知乎',
    'chatgpt', 'openai', 'notion', 'figma', 'adobe', 'office', 'microsoft', 'google',
  ];

  /** 这条账目像不像「App 自动扣费」 */
  function isAutoDebit(t) {
    const text = (String(t.note || '') + ' ' + String(t.sub || '') + ' ' +
      (Icons.cat(t.catId) || {}).name + '').toLowerCase();
    if (!text.trim()) return false;
    const excluded = SUB_EXCLUDE.some((k) => text.indexOf(k) >= 0);
    if (excluded) return false;
    return SUB_HINT.some((k) => text.indexOf(k) >= 0);
  }

  /**
   * 扫描历史账目，识别疑似「自动扣费」（只认 App / 线上服务订阅）
   * 判定：像 App 扣费 + 同一聚类键出现 >=3 次 + 相邻间隔落在周期容差内 + 金额在 ±5% 内
   */
  function scanSubscriptions(now) {
    const ts = now || Date.now();
    const groups = {};
    state.tx.forEach((t) => {
      if (t.type !== 'expense') return;
      if (!isAutoDebit(t)) return;
      const k = subKeyOf(t);
      if (!k || k.length < 2) return;
      (groups[k] = groups[k] || []).push(t);
    });
    const out = [];
    const DAY = 86400000;
    // 周期定义：[名称, 目标天数, 容差天数]
    const CYCLES = [
      ['weekly', 7, 2],
      ['monthly', 30, 5],
      ['quarterly', 91, 8],
      ['yearly', 365, 15],
    ];
    Object.keys(groups).forEach((k) => {
      const list = groups[k].slice().sort((a, b) => a.ts - b.ts);
      if (list.length < 3) return;
      // 金额必须在 ±5% 内（用中位数当基准）
      const amts = list.map((t) => t.amount).sort((a, b) => a - b);
      const median = amts[Math.floor(amts.length / 2)] || 0;
      if (!median) return;
      const inRange = list.filter((t) => Math.abs(t.amount - median) / median <= 0.05);
      if (inRange.length < 3) return;
      // 找最匹配的周期
      let best = null;
      CYCLES.forEach(([name, target, tol]) => {
        let ok = 0, total = 0;
        for (let i = 1; i < inRange.length; i++) {
          const gap = Math.round((inRange[i].ts - inRange[i - 1].ts) / DAY);
          if (gap <= 0) continue;
          total++;
          if (Math.abs(gap - target) <= tol) ok++;
        }
        if (!total) return;
        const rate = ok / total;
        if (rate >= 0.7 && (!best || rate > best.rate)) best = { name, target, rate };
      });
      if (!best) return;
      const first = inRange[0], last = inRange[inRange.length - 1];
      const nextTs = last.ts + best.target * DAY;
      const already = (state.subs || []).find((s) => s.key === k);
      if (already && already.ignored) return;
      out.push({
        key: k,
        name: String(last.note || k).slice(0, 40),
        amount: last.amount,
        avgAmount: Math.round(inRange.reduce((s, t) => s + t.amount, 0) / inRange.length),
        period: best.name,
        times: inRange.length,
        firstTs: first.ts,
        lastTs: last.ts,
        nextTs,
        daysToNext: Math.round((nextTs - ts) / DAY),
        catId: last.catId,
        sub: last.sub,
        accountId: last.accountId,
        totalPaid: inRange.reduce((s, t) => s + t.amount, 0),
        confidence: Math.round(best.rate * 100),
        reminded: already ? !!already.remindedFor === false ? false : (already.remindedTs || 0) : 0,
      });
    });
    return out.sort((a, b) => b.totalPaid - a.totalPaid);
  }

  /** 需要提醒的订阅：距下次扣款 <= daysBefore 天 */
  function subsDue(now) {
    const cfg = state.settings.subAlert || {};
    if (!cfg.enabled) return [];
    const days = Math.max(0, Number(cfg.daysBefore) || 0);
    const ts = now || Date.now();
    return scanSubscriptions(ts).filter((s) => s.daysToNext >= 0 && s.daysToNext <= days);
  }

  /** 标记订阅已提醒（按下次扣款日做幂等，跨过扣款日后会再提醒） */
  function markSubReminded(key, nextTs) {
    state.subs = state.subs || [];
    let s = state.subs.find((x) => x.key === key);
    if (!s) { s = { key }; state.subs.push(s); }
    s.remindedFor = nextTs;
    s.remindedTs = Date.now();
    save();
    return s;
  }

  /** 忽略/恢复某个订阅 */
  function ignoreSub(key, ignored) {
    state.subs = state.subs || [];
    let s = state.subs.find((x) => x.key === key);
    if (!s) { s = { key }; state.subs.push(s); }
    s.ignored = ignored !== false;
    save();
    emit({ type: 'subs' });
    return s;
  }

  /** 把订阅转成周期记账规则 */
  function subToRepeat(sub) {
    const freqMap = { weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly' };
    const d = new Date(sub.lastTs);
    return addRepeat({
      name: sub.name,
      type: 'expense',
      amount: sub.avgAmount,
      catId: sub.catId,
      sub: sub.sub,
      accountId: sub.accountId,
      note: sub.name,
      freq: freqMap[sub.period] || 'monthly',
      startDay: U.clamp(d.getDate(), 1, 28),
      startYm: U.monthKey(d),
    });
  }

  // ------------------------------------------------------------
  // 先别买：愿望清单 + 冷却期
  // ------------------------------------------------------------
  function wishlist() { return state.wishlist || (state.wishlist = []); }

  function addWish(input) {
    const hours = Math.max(1, Number((state.settings.wish || {}).hours) || 48);
    const w = {
      id: U.uid('wish'),
      name: String(input.name || '').slice(0, 60) || '想买的东西',
      amount: Math.abs(Math.round(Number(input.amount) || 0)),
      catId: input.catId || 'shopping',
      note: String(input.note || '').slice(0, 120),
      createdAt: Date.now(),
      dueTs: Date.now() + hours * 3600000,
      hours,
      status: 'cooling',   // cooling / ready / bought / dropped
      decidedTs: 0,
    };
    wishlist().push(w);
    save();
    emit({ type: 'wish', action: 'add', wish: w });
    return w;
  }

  function updateWish(id, patch) {
    const w = wishlist().find((x) => x.id === id);
    if (!w) return null;
    Object.assign(w, patch || {});
    save();
    emit({ type: 'wish', action: 'update', wish: w });
    return w;
  }

  function removeWish(id) {
    const i = wishlist().findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [w] = wishlist().splice(i, 1);
    save();
    emit({ type: 'wish', action: 'remove', wish: w });
    return w;
  }

  /** 冷却到期、还没决定的愿望 */
  function wishReady(now) {
    const ts = now || Date.now();
    return wishlist().filter((w) => w.status === 'cooling' && w.dueTs <= ts)
      .sort((a, b) => a.dueTs - b.dueTs);
  }

  /** 冷静期内的愿望（倒计时用） */
  function wishCooling(now) {
    const ts = now || Date.now();
    return wishlist().filter((w) => w.status === 'cooling' && w.dueTs > ts)
      .sort((a, b) => a.dueTs - b.dueTs);
  }

  /** 决定买下：转成正常账目 */
  function buyWish(id, ts) {
    const w = wishlist().find((x) => x.id === id);
    if (!w) return null;
    const t = addTx({
      type: 'expense', amount: w.amount, catId: w.catId,
      sub: '', note: w.name || w.note, ts: ts || Date.now(),
    });
    w.status = 'bought';
    w.decidedTs = Date.now();
    w.txId = t.id;
    save();
    emit({ type: 'wish', action: 'buy', wish: w });
    return t;
  }

  /** 决定放弃：累积「忍住基金」 */
  function dropWish(id) {
    const w = wishlist().find((x) => x.id === id);
    if (!w) return null;
    w.status = 'dropped';
    w.decidedTs = Date.now();
    save();
    emit({ type: 'wish', action: 'drop', wish: w });
    return w;
  }

  /**
   * 某周期内应该出现在明细时间线里的愿望
   * - cooling：还在倒计时 → 标灰 + 倒计时
   * - ready：倒计时结束、等用户回答「买了吗」→ 高亮询问
   * - dropped：已经回答「没买」→ 划掉留档
   * - bought：已经变成真账目了，这里不再重复显示
   */
  function wishesIn(p, now) {
    const ts = now || Date.now();
    return wishlist()
      .filter((w) => {
        if (w.status === 'bought') return false;
        const anchor = w.createdAt || w.dueTs || 0;
        return inPeriod(anchor, p);
      })
      .map((w) => {
        const leftMs = Math.max(0, (w.dueTs || 0) - ts);
        let state = 'cooling';
        if (w.status === 'dropped') state = 'dropped';
        else if (leftMs <= 0) state = 'ready';
        return { ...w, state, leftMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 忍住基金总额（放弃的愿望金额之和） */
  function savedFund() {
    return wishlist().filter((w) => w.status === 'dropped')
      .reduce((s, w) => s + (w.amount || 0), 0);
  }

  // ------------------------------------------------------------
  // 余额反推：用真实余额算出漏记多少
  // ------------------------------------------------------------
  function reconList() { return state.recon || (state.recon = []); }

  /**
   * 对账：给定账户、期初余额与当前真实余额，算出账面应有与实际差额
   * @param {{accountId, startBalance, startTs, actualBalance, ts}} input
   */
  function reconcile(input) {
    const acc = input.accountId || 'alipay';
    const startTs = Number(input.startTs) || 0;
    const startBalance = Math.round(Number(input.startBalance) || 0);
    const actual = Math.round(Number(input.actualBalance) || 0);
    let inc = 0, exp = 0;
    state.tx.forEach((t) => {
      if (t.accountId !== acc) return;
      if (t.ts < startTs) return;
      if (t.type === 'income') inc += t.amount;
      else if (!isVoid(t)) exp += t.amount;   // 没还的垫付要算，已归还的不算
    });
    const expected = startBalance + inc - exp;
    const diff = actual - expected;      // 正数=实际比账面多（漏记支出）；负数=账面比实际多（漏记收入/多记支出）
    const rec = {
      id: U.uid('rec'),
      accountId: acc,
      startTs, startBalance, actualBalance: actual,
      income: inc, expense: exp, expected, diff,
      ts: Number(input.ts) || Date.now(),
    };
    reconList().unshift(rec);
    if (reconList().length > 50) state.recon.length = 50;
    save();
    emit({ type: 'recon', action: 'add', rec });
    return rec;
  }

  /** 最近 14 天里没有账目的日子（可能漏记的候选） */
  function blankDays(days) {
    const n = days || 14;
    const today = U.startOfDay(new Date());
    const has = {};
    state.tx.forEach((t) => { if (t.bookId === writeBookId()) has[U.ymd(t.ts)] = true; });
    const out = [];
    for (let i = n; i >= 1; i--) {
      const d = U.addDays(today, -i);
      const k = U.ymd(d);
      if (!has[k]) out.push({ ts: d.getTime(), key: k, label: U.humanDate(d.getTime()) });
    }
    return out;
  }

  function removeRecon(id) {
    const i = reconList().findIndex((r) => r.id === id);
    if (i < 0) return null;
    const [r] = state.recon.splice(i, 1);
    save();
    return r;
  }

  // ------------------------------------------------------------
  // 合并看板：所有账本加在一起
  // ------------------------------------------------------------
  const ALL_BOOKS = '*';

  /** 跨账本账目（合并看板用） */
  function txInAll(p) {
    return state.tx.filter((t) => inPeriod(t.ts, p)).sort((a, b) => b.ts - a.ts);
  }

  /** 合并看板：各账本本期汇总 + 总计 */
  function mergedBoard(p) {
    const period = p || currentPeriod();
    const rows = state.books.map((b) => {
      const list = state.tx.filter((t) => t.bookId === b.id && inPeriod(t.ts, period));
      const s = summary(period, list);
      return {
        id: b.id, name: b.name, icon: b.icon, color: b.color,
        expense: s.expense, income: s.income, net: s.net, count: s.count,
      };
    }).sort((a, b) => b.expense - a.expense);
    const total = rows.reduce((acc, r) => ({
      expense: acc.expense + r.expense,
      income: acc.income + r.income,
      net: acc.net + r.net,
      count: acc.count + r.count,
    }), { expense: 0, income: 0, net: 0, count: 0 });
    return { rows, total, period };
  }

  // ------------------------------------------------------------
  // 外币账本
  // ------------------------------------------------------------
  const CURRENCIES = [
    { code: 'CNY', symbol: '¥', name: '人民币', rate: 1 },
    { code: 'USD', symbol: '$', name: '美元', rate: 7.12 },
    { code: 'JPY', symbol: '¥', name: '日元', rate: 0.048 },
    { code: 'EUR', symbol: '€', name: '欧元', rate: 7.72 },
    { code: 'GBP', symbol: '£', name: '英镑', rate: 9.05 },
    { code: 'HKD', symbol: 'HK$', name: '港币', rate: 0.91 },
    { code: 'TWD', symbol: 'NT$', name: '台币', rate: 0.22 },
    { code: 'KRW', symbol: '₩', name: '韩元', rate: 0.0052 },
    { code: 'THB', symbol: '฿', name: '泰铢', rate: 0.2 },
    { code: 'SGD', symbol: 'S$', name: '新币', rate: 5.3 },
    { code: 'AUD', symbol: 'A$', name: '澳元', rate: 4.7 },
    { code: 'CAD', symbol: 'C$', name: '加元', rate: 5.2 },
    { code: 'MYR', symbol: 'RM', name: '马币', rate: 1.6 },
    { code: 'VND', symbol: '₫', name: '越南盾', rate: 0.00028 },
  ];

  function currencyOf(code) {
    return CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
  }

  /** 当前账本是否外币（汇率为 0 或缺符号时按本币处理，避免除零） */
  function bookCurrency() {
    const b = activeBook();
    if (!b || !b.currency || b.currency.code === 'CNY') return null;
    const rate = Number(b.currency.rateToCny) || 0;
    if (!(rate > 0)) return null;
    return { code: b.currency.code, symbol: b.currency.symbol || b.currency.code, rate };
  }

  /** 人民币分 → 当前账本货币分（展示用） */
  function toLocalCents(cents) {
    const cur = bookCurrency();
    if (!cur || !cur.rate) return cents;
    return Math.round(cents / cur.rate);
  }

  /** 当前账本货币分 → 人民币分（入库用） */
  function toCnyCents(cents) {
    const cur = bookCurrency();
    if (!cur || !cur.rate) return cents;
    return Math.round(cents * cur.rate);
  }

  /** 按指定货币格式化（cents 是该货币的「分」） */
  function moneyIn(cents, code) {
    const c = currencyOf(code);
    const v = (Number(cents) || 0) / 100;
    return c.symbol + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ------------------------------------------------------------
  // 设置
  // ------------------------------------------------------------
  function setSettings(patch) {
    state.settings = deepMerge(state.settings, patch);
    save();
    emit({ type: 'settings' });
    return state.settings;
  }

  function setCycle(cycle) {
    state.settings.cycle = deepMerge(state.settings.cycle, cycle);
    if ((state.settings.cycle.type === 'custom' || state.settings.cycle.type === 'biweek') && !state.settings.cycle.anchor) {
      state.settings.cycle.anchor = U.ymd(new Date());
    }
    save();
    emit({ type: 'settings' });
    return state.settings.cycle;
  }

  function setBudget(amount, split) {
    state.settings.budget = {
      amount: Math.max(0, Math.round(Number(amount) || 0)),
      split: split || state.settings.budget.split || {},
    };
    save();
    emit({ type: 'settings' });
    return state.settings.budget;
  }

  // ------------------------------------------------------------
  // 备份 / 导入导出
  // ------------------------------------------------------------
  /**
   * 导出备份。
   *
   * 同步层会给实体打一个内部字段 `_seq`（它最后生效的那条 op 序号）。
   * 那是同步的账本，不是用户的数据 —— 导出时要剔掉，否则：
   *   a) 备份文件里出现一堆看不懂的 _seq；
   *   b) 换机导入后带着别人的 seq，合并会错。
   * 用 replacer 逐个删，不改原对象（导出不能有副作用）。
   */
  function exportJSON() {
    return JSON.stringify({
      app: 'jizhang', version: 1, exportedAt: new Date().toISOString(), data: state,
    }, (k, v) => (k === '_seq' ? undefined : v), 2);
  }

  function importJSON(text, mode) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { throw new Error('文件不是合法的 JSON'); }
    const incoming = parsed && parsed.data ? parsed.data : parsed;
    if (!incoming || (!Array.isArray(incoming.tx) && !Array.isArray(incoming.goals))) {
      throw new Error('不是本应用导出的备份文件');
    }
    if (mode === 'replace') {
      state = migrate(incoming);
    } else {
      const map = {};
      state.tx.forEach((t) => { map[t.id] = true; });
      (incoming.tx || []).forEach((t) => { if (!map[t.id]) state.tx.push(t); });
      const gmap = {};
      state.goals.forEach((g) => { gmap[g.id] = true; });
      (incoming.goals || []).forEach((g) => { if (!gmap[g.id]) state.goals.push(g); });
      if (incoming.settings) state.settings = deepMerge(state.settings, incoming.settings);
    }
    save(true);
    emit({ type: 'import' });
    return { tx: state.tx.length, goals: state.goals.length };
  }

  function exportCSV(p) {
    const list = p ? txIn(p) : state.tx.slice().sort((a, b) => b.ts - a.ts);
    const rows = [['日期', '时间', '类型', '分类', '子类', '金额(元)', '账户', '备注']];
    list.forEach((t) => {
      const d = new Date(t.ts);
      rows.push([
        U.ymd(d), U.timeStr(t.ts),
        t.type === 'income' ? '收入' : '支出',
        Icons.cat(t.catId).name, t.sub || '',
        (t.amount / 100).toFixed(2),
        (state.accounts.find((a) => a.id === t.accountId) || {}).name || '',
        t.note || '',
      ]);
    });
    const csv = '\ufeff' + rows.map((r) => r.map((c) => {
      const s = String(c == null ? '' : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    return csv;
  }

  function clearAll(keepSettings) {
    const s = keepSettings ? state.settings : JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    state = blankState();
    state.settings = s;
    state.settings.seeded = true;
    save(true);
    emit({ type: 'clear' });
  }

  // ------------------------------------------------------------
  // 示例数据（**只给自动化测试用**，App 首次运行不再自动填充，入口也已从设置里移除）
  // ------------------------------------------------------------
  const DEMO_TEMPLATES = [
    { type: 'expense', catId: 'food', sub: '午餐', note: '公司楼下快餐', accountId: 'wechat', lo: 2200, hi: 4200 },
    { type: 'expense', catId: 'food', sub: '咖啡', note: '拿铁', accountId: 'alipay', lo: 1800, hi: 3200 },
    { type: 'expense', catId: 'food', sub: '晚餐', note: '和朋友聚餐', accountId: 'wechat', lo: 6000, hi: 18000 },
    { type: 'expense', catId: 'market', sub: '蔬菜', note: '周末买菜', accountId: 'alipay', lo: 3500, hi: 9000 },
    { type: 'expense', catId: 'transport', sub: '地铁', note: '通勤', accountId: 'alipay', lo: 400, hi: 1200 },
    { type: 'expense', catId: 'transport', sub: '打车', note: '加班打车回家', accountId: 'wechat', lo: 2500, hi: 5600 },
    { type: 'expense', catId: 'shopping', sub: '衣服', note: '换季添置', accountId: 'credit', lo: 12000, hi: 45000 },
    { type: 'expense', catId: 'shopping', sub: '数码', note: '数据线', accountId: 'alipay', lo: 2900, hi: 8900 },
    { type: 'expense', catId: 'housing', sub: '水电', note: '水电费', accountId: 'bank', lo: 8000, hi: 16000 },
    { type: 'expense', catId: 'fun', sub: '电影', note: '周末看电影', accountId: 'wechat', lo: 4500, hi: 9800 },
    { type: 'expense', catId: 'fun', sub: '会员', note: '视频会员', accountId: 'alipay', lo: 1500, hi: 3000 },
    { type: 'expense', catId: 'health', sub: '药品', note: '感冒药', accountId: 'alipay', lo: 2500, hi: 6800 },
    { type: 'expense', catId: 'study', sub: '书籍', note: '技术书', accountId: 'alipay', lo: 4900, hi: 12900 },
    { type: 'expense', catId: 'comm', sub: '话费', note: '手机话费', accountId: 'alipay', lo: 3000, hi: 6000 },
    { type: 'expense', catId: 'social', sub: '礼物', note: '同事生日', accountId: 'wechat', lo: 8000, hi: 26000 },
    { type: 'expense', catId: 'pet', sub: '猫粮', note: '主子的口粮', accountId: 'alipay', lo: 9000, hi: 18000 },
    { type: 'income', catId: 'salary', sub: '月薪', note: '工资到账', accountId: 'bank', lo: 1200000, hi: 1600000 },
    { type: 'income', catId: 'invest', sub: '基金', note: '理财收益', accountId: 'alipay', lo: 3000, hi: 30000 },
    { type: 'income', catId: 'parttime', sub: '副业', note: '外包尾款', accountId: 'alipay', lo: 80000, hi: 300000 },
  ];

  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  function seedDemo(force) {
    if (!force && state.settings.seeded) return false;
    state.tx = [];
    state.goals = [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // 前 2 个完整月 + 本月至今
    for (let back = 2; back >= 0; back--) {
      const base = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const dim = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      const maxDay = back === 0 ? Math.max(1, now.getDate()) : dim;
      // 工资
      const pay = DEMO_TEMPLATES.filter((t) => t.type === 'income')[0];
      state.tx.push({
        id: U.uid('tx'), type: 'income', catId: pay.catId, sub: pay.sub, note: pay.note,
        accountId: pay.accountId, amount: randInt(pay.lo, pay.hi),
        ts: new Date(base.getFullYear(), base.getMonth(), Math.min(10, maxDay), 9, 30).getTime(),
        createdAt: Date.now(),
      });
      if (Math.random() > 0.35) {
        const inc = DEMO_TEMPLATES.filter((t) => t.type === 'income' && t.catId !== 'salary')[randInt(0, 1)];
        state.tx.push({
          id: U.uid('tx'), type: 'income', catId: inc.catId, sub: inc.sub, note: inc.note,
          accountId: inc.accountId, amount: randInt(inc.lo, inc.hi),
          ts: new Date(base.getFullYear(), base.getMonth(), randInt(12, maxDay), 15, 10).getTime(),
          createdAt: Date.now(),
        });
      }
      const daily = Math.max(2, Math.round((maxDay / 30) * 3));
      for (let d = 1; d <= maxDay; d++) {
        const n = Math.random() < 0.55 ? 1 : (Math.random() < 0.4 ? 2 : 0);
        for (let k = 0; k < Math.max(n, d <= 3 ? 1 : 0); k++) {
          const tpl = DEMO_TEMPLATES.filter((t) => t.type === 'expense')[randInt(0, 15)];
          state.tx.push({
            id: U.uid('tx'), type: 'expense', catId: tpl.catId, sub: tpl.sub, note: tpl.note,
            accountId: tpl.accountId, amount: randInt(tpl.lo, tpl.hi),
            ts: new Date(base.getFullYear(), base.getMonth(), d, randInt(7, 22), randInt(0, 59)).getTime(),
            createdAt: Date.now(),
          });
        }
      }
      // 房租
      state.tx.push({
        id: U.uid('tx'), type: 'expense', catId: 'housing', sub: '房租', note: '月度房租',
        accountId: 'bank', amount: 280000,
        ts: new Date(base.getFullYear(), base.getMonth(), Math.min(5, maxDay), 10, 0).getTime(),
        createdAt: Date.now(),
      });
    }
    state.goals = [
      {
        id: U.uid('goal'), name: '年度旅行基金', icon: '✈️', target: 1500000, saved: 620000,
        deadline: U.ymd(new Date(now.getFullYear() + 1, 1, 1)), color: '#4F7CFF',
        note: '去北海道看雪', createdAt: Date.now() - 60 * 86400000, archived: false,
        logs: [
          { id: U.uid('log'), amount: 200000, note: '首次存入', ts: Date.now() - 55 * 86400000 },
          { id: U.uid('log'), amount: 220000, note: '发工资转入', ts: Date.now() - 25 * 86400000 },
          { id: U.uid('log'), amount: 200000, note: '月度结余', ts: Date.now() - 5 * 86400000 },
        ],
      },
      {
        id: U.uid('goal'), name: '换新电脑', icon: '💻', target: 1200000, saved: 380000,
        deadline: U.ymd(new Date(now.getFullYear(), now.getMonth() + 4, 1)), color: '#7C5CFF',
        note: '', createdAt: Date.now() - 30 * 86400000, archived: false,
        logs: [{ id: U.uid('log'), amount: 380000, note: '存钱罐', ts: Date.now() - 20 * 86400000 }],
      },
    ];
    state.settings.seeded = true;
    // 示例数据都归到第一本账本，避免出现「0 笔账目」
    const firstBook = (state.books && state.books[0]) ? state.books[0].id : 'default';
    state.tx.forEach((t) => { if (!t.bookId) t.bookId = firstBook; });
    save(true);
    return true;
  }

  // ------------------------------------------------------------
  global.Store = {
    init() { load(); return state; },
    get state() { return state; },
    get settings() { return state.settings; },
    save, subscribe,
    periodFor, currentPeriod, shiftPeriod, recentPeriods, inPeriod,
    dayPeriod, monthPeriod, yearPeriod, scopePeriod, shiftScope,
    books, activeBookId, activeBook, bookById, bookKind,
    ATTRIBS, ATTRIB_MAP, attrib, attribOf, attribStats, attribLine, cpCompareLine, ATTRIB_DEFAULT,
    cpOn, cpTxs, cpTxById, cpTxIn, cpAddTx, cpUpdateTx, cpRemoveTx, cpRestoreTx, cpSummary,
    cpDayTxs, cpDayDeposits, cpCalendar, cpFundMonthSummary,
    cpRefundTx, cpRefundedOf, cpIsRefund, cpNetOf, cpFundDeposit,
    cpFavorsIn, cpFavorsOut, cpFavorsTotal, cpAddFavor, RP_CAT, ATTRIB_PAIR,
    cpBooks, cpActiveId, cpActiveBook, cpBookById, cpTxsOf, cpWriteId,
    applyRemoteOps, syncAccepted, syncBootstrap,
    closeCouple, cpCanUndo, hideCouple, unhideCouple,
    cpArchivedBooks, startNewCpBook, switchCpBook, openCpBook, wipeCpBook, coupleGoalsOf,
    migrate, blankState,
    enableCouple, disableCouple, setCoupleConfig, coupleGoals, goalBySlot, COUPLE_SLOTS, coupleVault, coupleDateFund, coupleMeetFund,
    addBook, updateBook, removeBook, mergeBook, switchBook,
    isAllBooks, writeBookId, ALL_BOOKS, txInAll, mergedBoard,
    txIn, txById, addTx, addTxMany, srcKeys, srcKeysAll, updateTx, removeTx, restoreTx,
    summary, dailySeries,
    budgetFor, budgetStatus,
    todayQuota, quotaAfter,
    lastPrices, lastPrice, guessByNote,
    isVoid,
    setAdvance, clearAdvance, advances, advancesToAsk, advanceSummary, settleAdvance, markAdvanceAsked, normalizeAdvance,
    FIXED_PRESETS, fixedPresets, fixedExpenses, addFixed, isAutoDebit, SUB_EXCLUDE, SUB_HINT,
    settlePeriods, autoSavePreview,
    scanSubscriptions, subsDue, markSubReminded, ignoreSub, subToRepeat, subKeyOf,
    wishlist, addWish, updateWish, removeWish, wishReady, wishCooling, wishesIn, buyWish, dropWish, savedFund,
    reconList, reconcile, blankDays, removeRecon,
    CURRENCIES, currencyOf, bookCurrency, toLocalCents, toCnyCents, moneyIn,
    checkAlerts, resetAlertLog,
    addGoal, updateGoal, removeGoal, goalById, depositGoal, goalProgress,
    catConfig, addCategory, updateCategory, removeCategory, restoreCategory, restoreAllCategories,
    REPEAT_FREQ, repeats, repeatById, addRepeat, updateRepeat, removeRepeat,
    repeatDueDates, runRepeats, repeatUpcoming, repeatCount,
    setSettings, setCycle, setBudget,
    exportJSON, importJSON, exportCSV, clearAll, seedDemo,
    blankState, KEY,
  };
})(window);
