/* ============================================================
 * 花哪儿了 · 本地 OCR 识图（可选，按需加载）
 * 只有用户在设置里选了「本地 OCR」并真的点识图时，才会去
 * CDN 拉 tesseract.js（约 20MB 语言包，之后浏览器会缓存）。
 * 图片不离开设备，完全离线识别。
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const LANG = 'chi_sim+eng';

  // ------------------------------------------------------------
  // 长截屏处理参数
  // 关键点：**按宽度限制，而不是按最长边**。长图的宽是 1080 左右，
  // 如果按「最长边 1400」等比缩，6000 高的长图会被压成 252 宽，字全糊了。
  // 所以：宽度不超过 OCR_MAX_W，高度不缩，太长就横向切片分段识别。
  // ------------------------------------------------------------
  const OCR_MAX_W = 1600;      // 送进引擎的图最宽多少（越大越清晰，但更慢）
  const OCR_MIN_W = 900;       // 宽度不足就放大，小字容易糊
  const TILE_H = 1400;         // 每片多高
  const TILE_OVERLAP = 90;     // 上下重叠，避免把一行字切成两半
  const MAX_TILES = 14;        // 最多切几片（安全阀）
  const LONG_RATIO = 2.2;      // 高宽比超过这个才切片

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('这张图片打不开，换一张试试'));
      img.src = dataUrl;
    });
  }

  /**
   * 规划怎么切：返回缩放比、输出尺寸、每片的 y 与高度
   * 纯函数（不碰 canvas），方便单独测试
   */
  function planTiles(w0, h0) {
    if (!w0 || !h0) return { scale: 1, w: 0, h: 0, tiles: [], long: false };
    let scale = 1;
    if (w0 > OCR_MAX_W) scale = OCR_MAX_W / w0;
    else if (w0 < OCR_MIN_W) scale = Math.min(2, OCR_MIN_W / w0);
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);
    const long = h / w > LONG_RATIO;

    if (!long) return { scale, w, h, tiles: [{ y: 0, h, i: 0 }], long: false, truncated: false };

    const tiles = [];
    let y = 0;
    let guard = 0;
    while (y < h && tiles.length < MAX_TILES && guard++ < 200) {
      const th = Math.min(TILE_H, h - y);
      tiles.push({ y, h: th, i: tiles.length });
      if (y + th >= h) break;
      const step = Math.max(200, th - TILE_OVERLAP);
      y += step;
    }
    const truncated = tiles.length >= MAX_TILES && tiles[tiles.length - 1].y + tiles[tiles.length - 1].h < h;
    return { scale, w, h, tiles, long: true, truncated };
  }

  /** 把原图按 plan 切出一片，返回 dataURL */
  function sliceToDataUrl(img, plan, tile) {
    const cv = document.createElement('canvas');
    cv.width = plan.w;
    cv.height = tile.h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, plan.w, tile.h);
    const sy = tile.y / plan.scale;
    const sh = tile.h / plan.scale;
    ctx.drawImage(img, 0, sy, img.naturalWidth, sh, 0, 0, plan.w, tile.h);
    return cv.toDataURL('image/png');
  }

  let loading = null;
  let worker = null;

  // ------------------------------------------------------------
  // 懒加载 tesseract.js
  // ------------------------------------------------------------
  function loadLib() {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CDN;
      s.async = true;
      s.onload = () => {
        if (global.Tesseract) resolve(global.Tesseract);
        else reject(new Error('OCR 库加载完成但不可用'));
      };
      s.onerror = () => {
        loading = null;
        reject(new Error('OCR 库下载失败（需要联网一次，约 20MB）。可以改用 AI 识图，或检查网络后重试。'));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  function engineName() {
    return (S.settings.scan && S.settings.scan.engine) || 'auto';
  }

  /** 是否已把 OCR 库加载过（用于 UI 提示「已就绪，可离线用」） */
  function libReady() {
    return !!global.Tesseract;
  }

  let workerPsm = '';

  async function getWorker(onProgress) {
    const T = await loadLib();
    if (worker) return worker;
    worker = await T.createWorker(LANG, 1, {
      logger: (m) => {
        if (typeof onProgress !== 'function') return;
        if (m.status === 'recognizing text') onProgress({ stage: 'ocr', pct: m.progress || 0, label: '正在识别文字' });
        else if (m.status) onProgress({ stage: 'load', pct: m.progress || 0, label: '准备识别引擎' });
      },
    });
    return worker;
  }

  /**
   * 设置识别参数
   * PSM 4 =「假定是一列、字号有变化的文本」——账单列表用这个最准
   * PSM 3 = 全自动——单张详情页用这个
   * preserve_interword_spaces 保住列间距，方便后面按行切
   */
  async function ensureParams(psm) {
    const w = await getWorker();
    if (workerPsm === psm) return w;
    try {
      await w.setParameters({
        tessedit_pageseg_mode: psm,
        preserve_interword_spaces: '1',
      });
      workerPsm = psm;
    } catch (e) { /* 老版本不支持就算了 */ }
    return w;
  }

  async function terminate() {
    if (worker) {
      try { await worker.terminate(); } catch (e) { /* 忽略 */ }
      worker = null;
    }
  }

  /** 识别一张图（单片） */
  async function recognize(dataUrl, opts) {
    const o = opts || {};
    const w = await ensureParams(o.psm || '3');
    const r = await w.recognize(dataUrl);
    return (r && r.data && r.data.text) || '';
  }

  /**
   * 识别整张图：短的直接识别，长的切成若干片分别识别再拼起来
   * @returns {Promise<{ text: string, tiles: number }>}
   */
  async function recognizeSmart(dataUrl, opts) {
    const o = opts || {};
    const report = (p) => { if (typeof o.onProgress === 'function') o.onProgress(p); };

    let img;
    try { img = await loadImage(dataUrl); } catch (e) { img = null; }
    if (!img) {
      // 拿不到尺寸就退回单张识别
      const text = await recognize(dataUrl, { psm: '3' });
      return { text, tiles: 1 };
    }

    const plan = planTiles(img.naturalWidth, img.naturalHeight);
    const truncated = !!plan.truncated;
    if (!plan.long || plan.tiles.length <= 1) {
      report({ stage: 'ocr', pct: 0.2, label: '正在识别文字' });
      const text = await recognize(dataUrl, { psm: '3', onProgress: o.onProgress });
      return { text, tiles: 1 };
    }

    // 长图：逐片识别
    const n = plan.tiles.length;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const tile = plan.tiles[i];
      report({
        stage: 'ocr',
        pct: 0.05 + (i / n) * 0.9,
        label: `长图分 ${n} 段识别 · 第 ${i + 1} 段`,
      });
      const url = sliceToDataUrl(img, plan, tile);
      // eslint-disable-next-line no-await-in-loop
      const txt = await recognize(url, { psm: '4' });
      if (txt && txt.trim()) parts.push(txt.trim());
    }
    report({ stage: 'ocr', pct: 0.96, label: '合并识别结果' });
    return { text: parts.join('\n'), tiles: n, truncated };
  }

  // ------------------------------------------------------------
  // 文本解析
  // ------------------------------------------------------------
  const PLATFORM_HINT = [
    { id: 'wechat', re: /微信支付|微信|零钱|WeChat/i, name: '微信' },
    { id: 'alipay', re: /支付宝|余额宝|花呗|Alipay/i, name: '支付宝' },
    { id: 'pdd', re: /拼多多|多多|PDD/i, name: '拼多多' },
    { id: 'meituan', re: /美团|饿了么|外卖/i, name: '美团' },
    { id: 'taobao', re: /淘宝|天猫|阿里巴巴/i, name: '淘宝' },
    { id: 'bank', re: /银行|信用卡|储蓄卡|借记卡/i, name: '银行' },
  ];

  function detectPlatform(text) {
    for (const p of PLATFORM_HINT) if (p.re.test(text)) return p.id;
    return 'other';
  }

  // 分类关键词（长词优先匹配）
  const CAT_KEYWORDS = [
    { cat: 'food', sub: '外卖', words: ['外卖', '美团外卖', '饿了么', '配送费'] },
    { cat: 'food', sub: '早餐', words: ['早餐', '包子', '豆浆', '油条', '粥'] },
    { cat: 'food', sub: '午餐', words: ['午餐', '午饭', '快餐', '盖饭', '便当', '小吃', '拌面', '面馆', '沙县', '拉面', '米线'] },
    { cat: 'food', sub: '晚餐', words: ['晚餐', '晚饭', '火锅', '烧烤', '炒菜'] },
    { cat: 'food', sub: '夜宵', words: ['夜宵', '宵夜', '炸串'] },
    { cat: 'food', sub: '饮料', words: ['咖啡', '奶茶', '星巴克', '瑞幸', '喜茶', '蜜雪', '可乐', '果汁', '饮料', '茶饮'] },
    { cat: 'food', sub: '零食', words: ['零食', '薯片', '饼干', '巧克力', '坚果'] },
    { cat: 'food', sub: '聚餐', words: ['聚餐', '餐厅', '饭店', '酒楼', '烤肉', '自助'] },
    { cat: 'market', sub: '超市', words: ['超市', '便利店', '沃尔玛', '永辉', '盒马', '大润发', '711', '全家'] },
    { cat: 'market', sub: '蔬菜', words: ['蔬菜', '青菜', '白菜', '番茄', '土豆', '黄瓜'] },
    { cat: 'market', sub: '水果', words: ['水果', '苹果', '香蕉', '西瓜', '草莓', '橙子', '葡萄'] },
    { cat: 'market', sub: '肉蛋', words: ['猪肉', '牛肉', '鸡肉', '鸡蛋', '排骨', '鱼', '虾'] },
    { cat: 'market', sub: '粮油', words: ['大米', '面粉', '食用油', '酱油', '调味'] },
    { cat: 'transport', sub: '打车', words: ['滴滴', '打车', '出租车', '曹操', 'T3', '花小猪', '网约车', '高德打车'] },
    { cat: 'transport', sub: '地铁', words: ['地铁', '轨道交通', 'metro'] },
    { cat: 'transport', sub: '公交', words: ['公交', '巴士', '公交车'] },
    { cat: 'transport', sub: '加油', words: ['加油', '汽油', '中石化', '中石油', '壳牌'] },
    { cat: 'transport', sub: '停车', words: ['停车', '车位', '停车场'] },
    { cat: 'transport', sub: '火车', words: ['火车', '高铁', '动车', '12306', '铁路'] },
    { cat: 'transport', sub: '机票', words: ['机票', '航班', '航空', '机场'] },
    { cat: 'transport', sub: '共享单车', words: ['哈啰', '美团单车', '青桔', '共享单车', '骑行'] },
    { cat: 'shopping', sub: '衣服', words: ['衣服', '裤子', '鞋', '外套', '连衣裙', '优衣库', '衬衫', 'T恤'] },
    { cat: 'shopping', sub: '数码', words: ['手机', '耳机', '电脑', '键盘', '鼠标', '充电器', '数据线', '相机', '小米', '华为', '苹果'] },
    { cat: 'shopping', sub: '家居', words: ['家具', '收纳', '床单', '毛巾', '枕头', '宜家', '窗帘'] },
    { cat: 'shopping', sub: '美妆', words: ['化妆品', '口红', '面膜', '护肤', '粉底', '香水'] },
    { cat: 'shopping', sub: '日用品', words: ['纸巾', '洗衣液', '牙膏', '洗发水', '沐浴露', '日用'] },
    { cat: 'housing', sub: '房租', words: ['房租', '租金', '押金', '中介费'] },
    { cat: 'housing', sub: '房贷', words: ['房贷', '按揭', '还款'] },
    { cat: 'housing', sub: '物业', words: ['物业', '物业费'] },
    { cat: 'housing', sub: '水电', words: ['水费', '电费', '水电', '国家电网', '供水'] },
    { cat: 'housing', sub: '燃气', words: ['燃气', '天然气', '煤气'] },
    { cat: 'housing', sub: '网费', words: ['宽带', '网费', '联通', '电信', '移动宽带'] },
    { cat: 'fun', sub: '电影', words: ['电影', '影城', '影院', '猫眼', '淘票票', 'IMAX'] },
    { cat: 'fun', sub: '游戏', words: ['游戏', 'Steam', '点券', '充值', '王者', '原神'] },
    { cat: 'fun', sub: '演出', words: ['演唱会', '话剧', '音乐剧', '门票', 'Livehouse'] },
    { cat: 'fun', sub: '会员', words: ['会员', 'VIP', '订阅', 'Netflix', '爱奇艺', '腾讯视频', '网易云', 'B站', '大会员'] },
    { cat: 'fun', sub: '旅游', words: ['旅游', '景区', '门票', '旅行'] },
    { cat: 'health', sub: '看病', words: ['挂号', '门诊', '医院', '诊所', '看病', '急诊'] },
    { cat: 'health', sub: '药品', words: ['药', '药店', '大药房', '医药', '处方'] },
    { cat: 'health', sub: '体检', words: ['体检', '化验', '检查'] },
    { cat: 'health', sub: '健身', words: ['健身', '健身房', '私教', '瑜伽', 'Keep'] },
    { cat: 'study', sub: '书籍', words: ['书', '书店', '当当', '图书', '当当网', 'Kindle'] },
    { cat: 'study', sub: '课程', words: ['课程', '网课', '培训', '学费', '教育', '知识付费'] },
    { cat: 'study', sub: '考试', words: ['考试', '报名费', '四六级', '考研', '雅思', '托福'] },
    { cat: 'study', sub: '文具', words: ['文具', '笔', '本子', '打印', '复印'] },
    { cat: 'social', sub: '礼物', words: ['礼物', '礼盒', '鲜花', '蛋糕', '生日'] },
    { cat: 'social', sub: '红包', words: ['红包', '转账给', '发给'] },
    { cat: 'social', sub: '请客', words: ['请客', '聚餐AA', 'AA'] },
    { cat: 'social', sub: '份子钱', words: ['份子', '随礼', '礼金', '婚礼'] },
    { cat: 'comm', sub: '话费', words: ['话费', '充值话费', '移动', '联通', '电信'] },
    { cat: 'comm', sub: '流量', words: ['流量', '套餐', '数据流量'] },
    { cat: 'comm', sub: '宽带', words: ['宽带', '光纤'] },
    { cat: 'pet', sub: '猫粮', words: ['猫粮', '猫砂', '猫'] },
    { cat: 'pet', sub: '狗粮', words: ['狗粮', '狗'] },
    { cat: 'pet', sub: '宠物医疗', words: ['宠物医院', '驱虫', '疫苗', '绝育'] },
    { cat: 'pet', sub: '用品', words: ['宠物用品', '宠物'] },
    { cat: 'baby', sub: '奶粉', words: ['奶粉', '辅食', '奶瓶'] },
    { cat: 'baby', sub: '尿布', words: ['尿不湿', '纸尿裤', '尿布'] },
    { cat: 'baby', sub: '玩具', words: ['玩具', '积木', '娃娃'] },
    { cat: 'baby', sub: '早教', words: ['早教', '幼儿园', '托班', '亲子'] },
    { cat: 'travel', sub: '住宿', words: ['酒店', '民宿', '宾馆', '住宿', '携程', '去哪儿', 'Airbnb'] },
    { cat: 'travel', sub: '门票', words: ['景点', '门票', '迪士尼', '环球影城'] },
    { cat: 'travel', sub: '特产', words: ['特产', '伴手礼'] },
    { cat: 'beauty', sub: '理发', words: ['理发', '剪发', '美发', 'Tony'] },
    { cat: 'beauty', sub: '护肤', words: ['护肤', '美容', 'spa', 'SPA', '洁面'] },
    { cat: 'beauty', sub: '美甲', words: ['美甲', '美睫', '纹眉'] },
    { cat: 'car', sub: '保养', words: ['保养', '换机油', '4S', '洗车'] },
    { cat: 'car', sub: '维修', words: ['维修', '修车', '补胎', '配件'] },
    { cat: 'car', sub: '保险', words: ['车险', '交强险', '保险'] },
    { cat: 'car', sub: '洗车', words: ['洗车'] },
  ];

  const INCOME_KEYWORDS = ['工资', '薪资', '奖金', '年终奖', '报销', '退款', '收入', '兼职', '稿费', '利息', '分红', '红包收到', '转入'];

  function classify(text) {
    const t = String(text || '');
    for (const k of INCOME_KEYWORDS) {
      if (t.indexOf(k) >= 0) return { type: 'income', catId: 'other_in', sub: '' };
    }
    for (const g of CAT_KEYWORDS) {
      for (const w of g.words) {
        if (t.indexOf(w) >= 0) return { type: 'expense', catId: g.cat, sub: g.sub };
      }
    }
    return { type: 'expense', catId: 'other_out', sub: '' };
  }

  /** 从 OCR 文本里抠金额：优先「实付/合计」附近的数字，否则取最大的合理金额 */
  function extractAmount(text) {
    const t = String(text || '').replace(/[，,]/g, '');
    const num = '([0-9]+(?:\\.[0-9]{1,2})?)';

    const patterns = [
      new RegExp('实付(?:金额)?[^0-9]{0,8}' + num),
      new RegExp('实付款[^0-9]{0,8}' + num),
      new RegExp('支付金额[^0-9]{0,8}' + num),
      new RegExp('付款金额[^0-9]{0,8}' + num),
      new RegExp('合计[^0-9]{0,8}' + num),
      new RegExp('总计[^0-9]{0,8}' + num),
      new RegExp('订单金额[^0-9]{0,8}' + num),
      new RegExp('小计[^0-9]{0,8}' + num),
      new RegExp('金额[^0-9]{0,8}' + num),
      new RegExp('[¥￥]\\s*' + num),
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m) {
        const v = Number(m[1]);
        if (v > 0 && v < 10000000) return v;
      }
    }
    // 兜底：所有带小数的数字里取最大的（排除明显的日期/时间）
    const all = [];
    const reAll = /([0-9]{1,7}\.[0-9]{2})/g;
    let mm;
    while ((mm = reAll.exec(t))) {
      const v = Number(mm[1]);
      if (v > 0 && v < 1000000) all.push(v);
    }
    if (all.length) return Math.max.apply(null, all);
    return 0;
  }

  function extractDate(text) {
    const t = String(text || '');
    let m = t.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    m = t.match(/(\d{1,2})[-/月](\d{1,2})日?/);
    if (m) {
      const now = new Date();
      const d = new Date(now.getFullYear(), +m[1] - 1, +m[2], 12, 0);
      if (!isNaN(d.getTime()) && d.getTime() <= Date.now() + 86400000) return d.getTime();
    }
    return Date.now();
  }

  function extractMerchant(text) {
    const t = String(text || '');
    const lines = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const skip = /^(微信支付|支付宝|支付成功|交易成功|订单详情|账单详情|拼多多|淘宝|天猫|美团|饿了么|详情|完成|返回|合计|总计|实付|优惠|商品|数量|￥|¥)/;
    for (const ln of lines) {
      if (ln.length < 2 || ln.length > 24) continue;
      if (skip.test(ln)) continue;
      if (/^[\d\s.:%-]+$/.test(ln)) continue;
      if (/元$/.test(ln) && ln.length < 8) continue;
      return ln;
    }
    return '';
  }

  // ---- 多笔解析：账单列表（长截屏最常见） ----

  // 「实付金额」「支付金额」这类是详情页才有的强标记
  const STRONG_MARK = /实付款?|支付金额|付款金额|订单金额|小计|应付金额|交易金额/;
  // 合计 / 本月支出 是列表底部的汇总行，不能当成一笔
  const SUMMARY_LINE = /^(合计|总计|小计|本月|上个月|本月支出|本月收入|全部|共计|总额|收入|支出|账单|明细|筛选|搜索|更多|加载|没有更多|全部账单|全部交易|统计)/;
  const DATE_FULL = /(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/;
  const DATE_MD = /(\d{1,2})[-/月](\d{1,2})日?/;
  const TIME_ONLY = /^\d{1,2}:\d{2}(:\d{2})?$/;
  // 三种写法都要认：
  //   1. 「美团外卖 -25.80」  描述 + 符号 + 金额
  //   2. 「星巴克 ¥31.00」    描述 + 货币符号 + 金额
  //   3. 「25.80」            金额单独一行（微信账单常见）
  const RE_SIGNED = /^(.*?)([-+])\s*[¥￥]?\s*(\d{1,7}(?:\.\d{1,2})?)\s*$/;
  const RE_SYM = /^(.*?)[¥￥]\s*(\d{1,7}(?:\.\d{1,2})?)\s*$/;
  const RE_BARE = /^([-+]?)(\d{1,7}\.\d{1,2})$/;

  /** 从一行里拆出「描述 + 金额」，拆不出返回 null */
  function splitAmountLine(line) {
    const raw = String(line || '').trim();
    if (!raw) return null;
    let name = '';
    let sign = '';
    let v = 0;
    let m = RE_BARE.exec(raw);
    if (m) {
      // 纯小数：可能是金额，也可能是时间的小数（少见），排除 h:mm 形态
      if (/^\d{1,2}:\d{2}/.test(raw)) return null;
      sign = m[1];
      v = Number(m[2]);
    } else if ((m = RE_SIGNED.exec(raw))) {
      name = (m[1] || '').trim(); sign = m[2]; v = Number(m[3]);
    } else if ((m = RE_SYM.exec(raw))) {
      name = (m[1] || '').trim(); v = Number(m[2]);
    } else {
      return null;
    }

    if (!(v > 0) || v >= 1000000) return null;
    if (SUMMARY_LINE.test(name) || SUMMARY_LINE.test(raw)) return null;
    // 名字可以是空（金额单独一行，商户在上一行），交给调用方回退
    if (name) {
      if (/^[\d\s.:\-+%]+$/.test(name)) return null;  // 纯数字 / 纯时间
      if (name.length < 2) return null;                   // 单个字符，不像商户名
    }
    return { name, amount: v, sign };
  }

  /**
   * 长截屏 = 一列账单。逐行扫，遇到「带金额的行」就产出一条，
   * 商户名取同一行前面的文字，没有就取上一行的文字。
   * 切片重叠会带来边界重复，这里顺手去重。
   */
  function parseList(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((x) => x.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const rows = [];
    let desc = '';
    let ts = 0;

    for (const ln of lines) {
      // 日期行（有的账单把日期单独一行，有的跟在描述里）
      const df = ln.match(DATE_FULL);
      if (df) {
        const d = new Date(+df[1], +df[2] - 1, +df[3], 12);
        if (!isNaN(d.getTime())) ts = d.getTime();
      } else {
        const dm = ln.match(DATE_MD);
        if (dm) {
          const now = new Date();
          const d = new Date(now.getFullYear(), +dm[1] - 1, +dm[2], 12);
          if (!isNaN(d.getTime()) && d.getTime() <= Date.now() + 86400000) ts = d.getTime();
        }
      }

      const hit = splitAmountLine(ln);
      if (hit) {
        const name = hit.name || desc;
        if (!name || name.length < 2) continue;
        // 相邻重复（切片重叠导致）丢掉
        const dup = rows.slice(-2).some((r) => r.name === name && r.amount === hit.amount);
        if (dup) continue;
        rows.push({ name, amount: hit.amount, sign: hit.sign, ts: ts || Date.now() });
        desc = '';
      } else if (ln.length >= 2 && ln.length <= 30 && !TIME_ONLY.test(ln) && !SUMMARY_LINE.test(ln)) {
        desc = ln;
      }
    }
    return rows;
  }

  /** 把一行拆出来的「描述 + 金额」变成一条账目 */
  function rowToEntry(row) {
    const cls = classify(row.name);
    let type = cls.type;
    if (row.sign === '+') type = 'income';
    else if (row.sign === '-') type = 'expense';
    const pool = Icons.CATEGORIES.filter((c) => c.kind === type);
    let catId = cls.catId;
    if (!pool.some((c) => c.id === catId)) catId = type === 'income' ? 'other_in' : 'other_out';
    return {
      type,
      amount: U.toCents(row.amount.toFixed(2)),
      catId,
      sub: cls.sub || '',
      merchant: row.name,
      note: row.name,
      ts: row.ts,
      confidence: null,
      engine: 'ocr',
    };
  }

  /** 单条解析：订单详情 / 支付成功这类截图 */
  function parseSingle(text) {
    const amount = extractAmount(text);
    const cls = classify(text);
    const merchant = extractMerchant(text);
    const ts = extractDate(text);
    const entries = [];
    if (amount > 0) {
      entries.push({
        type: cls.type,
        amount: U.toCents(amount.toFixed(2)),
        catId: cls.catId,
        sub: cls.sub,
        merchant,
        note: merchant || '',
        ts,
        confidence: null,
        engine: 'ocr',
      });
    }
    return entries;
  }

  /** OCR 文本 → 统一的 scan 结果结构 */
  function parse(text) {
    const t = String(text || '');
    const rows = parseList(t);
    const strong = STRONG_MARK.test(t);

    // 判断走哪条路：
    // · 详情页有「实付金额」这种强标记，且没识别出多笔 → 单条
    // · 列表里能拆出 >=3 笔 → 多笔（哪怕底部有合计）
    // · 能拆出 2 笔且没有强标记 → 多笔
    let entries;
    let mode;
    if (rows.length >= 3 || (rows.length === 2 && !strong)) {
      entries = rows.map(rowToEntry);
      mode = 'list';
    } else {
      entries = parseSingle(t);
      mode = 'single';
    }

    return {
      platform: detectPlatform(t),
      entries,
      mode,
      warning: entries.length ? '' : '没能在图片里认出金额，可以手动填写，或换用 AI 识图。',
      engine: 'ocr',
      rawText: t,
    };
  }

  async function scan(dataUrl, opts) {
    const o = opts || {};
    const r = await recognizeSmart(dataUrl, { onProgress: o.onProgress });
    if (o.onProgress) o.onProgress({ stage: 'parse', pct: 1, label: '整理识别结果' });
    const out = parse(r.text);
    out.tiles = r.tiles;
    if (r.truncated) {
      out.warning = (out.warning ? out.warning + ' ' : '')
        + '这张图太长了，只识别了前面 ' + r.tiles + ' 段。建议把它拆成几张截图再导入。';
    }
    return out;
  }

  global.OCR = {
    CDN, LANG,
    loadLib, libReady, engineName, terminate,
    recognize, recognizeSmart, scan, parse, parseList, parseSingle, rowToEntry,
    planTiles, splitAmountLine,
    OCR_MAX_W, OCR_MIN_W, TILE_H, TILE_OVERLAP, LONG_RATIO,
    extractAmount, extractDate, extractMerchant, classify, detectPlatform,
    get loaded() { return !!global.Tesseract; },
  };
})(window);
