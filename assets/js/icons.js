/* ============================================================
 * 记账本 · 图标与分类元数据
 * 全部图标为内联 SVG（离线可用，不依赖图标字体 / 网络）
 * ============================================================ */
(function (global) {
  'use strict';

  // ---- 线性图标（stroke，24x24）----
  const S = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    heart: '<path d="M12 20s-7-4.5-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.5 12 20 12 20z"/>',
    heartFill: '<path d="M12 20s-7-4.5-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.5 12 20 12 20z" fill="currentColor" stroke="none"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
    chevronRight: '<path d="M9 18l6-6-6-6"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    chevronUp: '<path d="M18 15l-6-6-6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    wallet: '<path d="M20 7H6a2.5 2.5 0 010-5h12v5"/><path d="M3 6.5v11A2.5 2.5 0 005.5 20H20a1 1 0 001-1V8a1 1 0 00-1-1"/><circle cx="16.5" cy="13.5" r="1.2" fill="currentColor" stroke="none"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    pie: '<path d="M12 3a9 9 0 109 9h-9V3z"/><path d="M14 2.5A9 9 0 0121.5 10H14V2.5z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007.5 19.3a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 003.14 15a1.7 1.7 0 00-1.55-1H1.5a2 2 0 110-4h.1A1.7 1.7 0 003.14 8.5a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 007.5 4.14 1.7 1.7 0 008.5 2.6V2.5a2 2 0 114 0v.1a1.7 1.7 0 001 1.55 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87V9a1.7 1.7 0 001.55 1h.1a2 2 0 110 4h-.1a1.7 1.7 0 00-1.55 1z"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13"/><path d="M10 11v6M14 11v6"/>',
    edit: '<path d="M4 20h4l10.5-10.5a2.5 2.5 0 00-3.5-3.5L4.5 16.5V20z"/>',
    bell: '<path d="M18 8a6 6 0 10-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10.3 20a2 2 0 003.4 0"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 19h16"/>',
    upload: '<path d="M12 16V4M7 8l5-5 5 5"/><path d="M4 19h16"/>',
    moon: '<path d="M20.5 14.2A8.5 8.5 0 019.8 3.5 8.5 8.5 0 1020.5 14.2z"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
    fire: '<path d="M12 22c4 0 7-2.7 7-6.5 0-4.5-4.5-6-4.5-9.5C14.5 4 12 2 12 2S9.5 4.5 9.5 8c0 1.6.6 2.6 1.2 3.4C9.3 11.7 8 13 8 15c0-1 0-2-1-3-1 1.6-2 2.8-2 5 0 3.3 3 5 7 5z"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none"/>',
    alert: '<path d="M10.3 3.9L2.6 17.4A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3.1L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4"/><circle cx="12" cy="16.4" r="1.1" fill="currentColor" stroke="none"/>',
    camera: '<path d="M4 8h2.5l1.3-2h8.4L17.5 8H20a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2v-8a2 2 0 012-2z"/><circle cx="12" cy="14" r="3.2"/>',
    lock: '<rect x="4.5" y="10" width="15" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 018 0v3"/>',
    logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    cloud: '<path d="M17.5 19a4.5 4.5 0 00.4-9A6 6 0 006.2 11 3.5 3.5 0 007 19h10.5z"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.8" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="3.8" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="3.8" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
    backspace: '<path d="M9 5h10a2 2 0 012 2v10a2 2 0 01-2 2H9l-6-7 6-7z"/><path d="M15 9.5l-4 5M11 9.5l4 5"/>',
    equal: '<path d="M5 9h14M5 15h14"/>',
    share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.4 10.8l7.2-4.2M8.4 13.2l7.2 4.2"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M15 5.5A2.5 2.5 0 0012.5 3h-7A2.5 2.5 0 003 5.5v7A2.5 2.5 0 005.5 15"/>',
    home: '<path d="M4 10.5L12 3l8 7.5"/><path d="M6 9.5V20a1 1 0 001 1h10a1 1 0 001-1V9.5"/>',
    // 红包：一张竖着的信纸（横幅信封）＋压着封口的横条＋贴在横条上的爱心。
    // 从「两个梯形拼的吊钱袋」换成这个，是因为信封轮廓（四条边＋圆角）在
    // 10~12px（日历格子、偏爱行）时仍读得出「一封信」，梯形拼合在那个尺寸
    // 会糊成一个实心块；封口条是一条干净的水平线，爱心垫在它上面。
    // 爱心用两段对称的三次贝塞尔画（左右各一瓣），左边那瓣的顶点正好落在
    // 封口条的中点（y = 8.9 略低于条线 8.6，被条线压住 0.3），
    // 其余三处峰值都在条线下方 —— 所以「签封」是骑在封口上的，不是浮在旁边的。
    redPacket: '<path d="M6 2.8h12A2.2 2.2 0 0120.2 5v14a2.2 2.2 0 01-2.2 2.2H6A2.2 2.2 0 013.8 19V5A2.2 2.2 0 016 2.8z"/><path d="M3.8 8.6h16.4"/><path d="M12 14.6c-1.9-1.3-3.1-2.4-3.1-3.6a1.75 1.75 0 013.1-1.1 1.75 1.75 0 013.1 1.1c0 1.2-1.2 2.3-3.1 3.6"/>',
    // 来自 TA 的偏爱：两颗心，右边那颗小一点、偏上（TA 递过来的）
    hearts: '<path d="M7.6 5.6a2.4 2.4 0 014 2.5c0 2.4-2.2 4-3.5 5.1-1.3-1.1-3-2.5-3.4-4.2"/><path d="M14 11.4a2.4 2.4 0 014 2.5c0 2.4-2.2 4-3.5 5.1-1.3-1.1-3.1-2.6-3.5-4.3"/>',
  };

  /**
   * 分类图标：内置分类是手绘 SVG（如红包），自定义 / 旧数据仍是 emoji。
   * 两种都直接返回字符串 —— 调用方照旧用模板插值 / innerHTML 塞进去，
   * 所以全站显示分类图标的地方一行都不用改就能吃到新图标。
   *
   * 这里只兜一个底：图标被存成 SVG 但少了 class（比如早期导出的数据），
   * 补上 .cat-ic，否则它会按 SVG 默认的 300×150 撑破气泡。
   */
  function catIcon(c) {
    const raw = (c && c.icon) || '🏷️';
    if (raw.indexOf('<svg') !== 0) return raw;
    return raw.indexOf('cat-ic') >= 0 ? raw : raw.replace('<svg', '<svg class="cat-ic"');
  }

  /**
   * 同上，但给 <option> 这种只能放纯文本的地方用：SVG 换成分类名第一个字。
   * 为什么不是直接塞 SVG：<option> 里插标签会被浏览器当字面量显示成一串尖括号。
   */
  function catEmbedded(c) {
    const raw = (c && c.icon) || '🏷️';
    if (raw.indexOf('<svg') !== 0) return raw;
    const n = (c && c.name) || '';
    return n ? n.charAt(0) : '·';
  }

  function svg(name, size, cls) {
    const body = S[name] || S.info;
    const s = size || 20;
    return `<svg class="ic ${cls || ''}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  // ---- 分类（emoji + 品牌色）----
  // kind: expense 支出 / income 收入
  // 内置分类不可变；用户自定义 / 改名 / 隐藏通过 setCustom() 叠加
  const BUILTIN = [
    // 支出
    { id: 'food',      name: '餐饮',   icon: '🍜', color: '#FF7A45', kind: 'expense', subs: ['早餐', '午餐', '晚餐', '夜宵', '外卖', '饮料', '零食', '聚餐'] },
    { id: 'market',    name: '买菜',   icon: '🥬', color: '#52C41A', kind: 'expense', subs: ['蔬菜', '水果', '肉蛋', '粮油', '超市'] },
    { id: 'transport', name: '交通',   icon: '🚇', color: '#40A9FF', kind: 'expense', subs: ['地铁', '公交', '打车', '加油', '停车', '火车', '机票'] },
    { id: 'shopping',  name: '购物',   icon: '🛍️', color: '#F759AB', kind: 'expense', subs: ['衣服', '数码', '家居', '美妆', '日用品'] },
    { id: 'housing',   name: '居住',   icon: '🏠', color: '#9254DE', kind: 'expense', subs: ['房租', '房贷', '物业', '水电', '燃气', '网费'] },
    { id: 'fun',       name: '娱乐',   icon: '🎮', color: '#36CFC9', kind: 'expense', subs: ['电影', '游戏', '旅游', '演出', '会员'] },
    { id: 'health',    name: '医疗',   icon: '💊', color: '#FF4D4F', kind: 'expense', subs: ['看病', '药品', '体检', '健身'] },
    { id: 'study',     name: '学习',   icon: '📚', color: '#597EF7', kind: 'expense', subs: ['书籍', '课程', '考试', '文具'] },
    { id: 'social',    name: '人情',   icon: '🎁', color: '#FFC53D', kind: 'expense', subs: ['礼物', '红包', '请客', '份子钱'] },
    // 红包：情侣账本的主力分类（互相发红包走这里，见「来自 TA 的偏爱」）。
    // 排在人情后面，因为它是同一个语义的更具体版本；挪开会让老用户找不到人情。
    { id: 'redpacket', name: '红包',   icon: '<svg class="cat-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.8h12A2.2 2.2 0 0120.2 5v14a2.2 2.2 0 01-2.2 2.2H6A2.2 2.2 0 013.8 19V5A2.2 2.2 0 016 2.8z"/><path d="M3.8 8.6h16.4"/><path d="M12 14.6c-1.9-1.3-3.1-2.4-3.1-3.6a1.75 1.75 0 013.1-1.1 1.75 1.75 0 013.1 1.1c0 1.2-1.2 2.3-3.1 3.6"/></svg>', color: '#FF6A9B', kind: 'expense', subs: ['发给 TA', '收 TA 的', '家里给的', '压岁钱'] },
    { id: 'comm',      name: '通讯',   icon: '📱', color: '#69C0FF', kind: 'expense', subs: ['话费', '流量', '宽带'] },
    { id: 'pet',       name: '宠物',   icon: '🐶', color: '#FFA940', kind: 'expense', subs: ['猫粮', '狗粮', '宠物医疗', '用品'] },
    { id: 'baby',      name: '育儿',   icon: '🍼', color: '#FF85C0', kind: 'expense', subs: ['奶粉', '尿布', '玩具', '早教'] },
    { id: 'travel',    name: '旅行',   icon: '✈️', color: '#13C2C2', kind: 'expense', subs: ['住宿', '门票', '特产'] },
    { id: 'beauty',    name: '美容',   icon: '💅', color: '#EB2F96', kind: 'expense', subs: ['理发', '护肤', '美甲'] },
    { id: 'car',       name: '汽车',   icon: '🚗', color: '#2F54EB', kind: 'expense', subs: ['保养', '维修', '保险', '洗车'] },
    { id: 'other_out', name: '其他',   icon: '📦', color: '#8C8C8C', kind: 'expense', subs: ['快递', '手续费', '意外支出'] },
    // 垫付：开启「帮别人垫的」后强制归入这一类（view-add 的 advance-toggle 会自动切换，
    // 关掉垫付再切回之前用的分类），保证垫付在流水/垫付页里一眼可辨
    { id: 'advance',   name: '垫付',   icon: '💸', color: '#B37FEB', kind: 'expense', subs: [] },
    // 收入
    { id: 'salary',    name: '工资',   icon: '💰', color: '#FAAD14', kind: 'income', subs: ['月薪', '奖金', '加班费'] },
    { id: 'bonus',     name: '奖金',   icon: '🏆', color: '#FFC53D', kind: 'income', subs: ['年终奖', '提成', '分红'] },
    { id: 'invest',    name: '理财',   icon: '📈', color: '#52C41A', kind: 'income', subs: ['利息', '基金', '股票', '租金'] },
    { id: 'parttime',  name: '兼职',   icon: '💼', color: '#40A9FF', kind: 'income', subs: ['副业', '外包', '稿费'] },
    { id: 'gift_in',   name: '红包',   icon: '🧧', color: '#FF4D4F', kind: 'income', subs: ['红包', '礼金', '退款'] },
    { id: 'other_in',  name: '其他',   icon: '✨', color: '#8C8C8C', kind: 'income', subs: ['报销', '意外之财'] },
  ];

  // 生效中的分类（内置 - 隐藏 + 自定义），数组引用保持不变，就地替换内容
  const CATEGORIES = [];
  // 全量索引（含被隐藏的内置分类），保证历史账目仍能解析出名称
  let ALL_MAP = {};

  const FALLBACK = { id: 'other_out', name: '其他', icon: '📦', color: '#8C8C8C', kind: 'expense', subs: [] };

  function rebuild(cfg) {
    const c = cfg || {};
    const hidden = c.hidden || [];
    const overrides = c.overrides || {};
    const custom = c.custom || [];

    ALL_MAP = {};
    CATEGORIES.length = 0;

    BUILTIN.forEach((b) => {
      const ov = overrides[b.id] || {};
      const merged = {
        id: b.id,
        name: ov.name || b.name,
        icon: ov.icon || b.icon,
        color: ov.color || b.color,
        kind: b.kind,
        subs: Array.isArray(ov.subs) ? ov.subs : b.subs,
        builtin: true,
      };
      ALL_MAP[merged.id] = merged;
      if (hidden.indexOf(b.id) < 0) CATEGORIES.push(merged);
    });

    custom.forEach((x) => {
      if (!x || !x.id) return;
      const merged = {
        id: x.id,
        name: x.name || '新分类',
        icon: x.icon || '🏷️',
        color: x.color || '#8C8C8C',
        kind: x.kind === 'income' ? 'income' : 'expense',
        subs: Array.isArray(x.subs) ? x.subs : [],
        custom: true,
      };
      ALL_MAP[merged.id] = merged;
      CATEGORIES.push(merged);
    });
  }

  rebuild();

  function cat(id) {
    return ALL_MAP[id] || (id ? Object.assign({}, FALLBACK, { id }) : FALLBACK);
  }

  /** 支出 / 收入分类列表 */
  function catsOf(kind) {
    return CATEGORIES.filter((c) => c.kind === kind);
  }

  /** 某分类是否内置 */
  function isBuiltin(id) {
    return BUILTIN.some((b) => b.id === id);
  }

  /** 应用用户的自定义分类配置（store 初始化时调用） */
  function setCustom(cfg) {
    rebuild(cfg);
  }

  // ---- 默认账户 ----
  const ACCOUNTS = [
    { id: 'alipay', name: '支付宝', icon: '🅰️' },
    { id: 'wechat', name: '微信', icon: '💬' },
    { id: 'bank',   name: '银行卡', icon: '🏦' },
    { id: 'cash',   name: '现金', icon: '💵' },
    { id: 'credit', name: '信用卡', icon: '💳' },
  ];

  global.Icons = {
    svg, S, CATEGORIES, cat, catsOf, isBuiltin, setCustom, BUILTIN, catEmbedded,
    catIcon,
    // 红包分类的 id：情侣账本「来自 TA 的偏爱」用这个常量认账，别在业务里写死字符串
    RED_PACKET_ID: 'redpacket',
    get CAT_MAP() { return ALL_MAP; },
    ACCOUNTS,
  };
})(window);
