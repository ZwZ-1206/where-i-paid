/* ============================================================
 * 花哪儿了 · 账单 CSV 批量导入
 * 支持微信支付 / 支付宝 / 各家银行导出的账单流水文件
 * 自动识别编码、表头列、收支方向、分类，自动去重，先预览后入库
 * 全程本地解析，文件不上传
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  const MAX_SHOW = 500;        // 一次最多渲染多少行（防止卡顿）
  const HEAD_SCAN = 40;        // 在前多少行里找表头

  // ------------------------------------------------------------
  // 表头列名识别
  // 顺序有意义：越靠前的组越先认领列，避免「交易金额」被「金额」抢走
  //
  // 各家格式差异（2026-10 核对过主流银行导出的列名）：
  //   农行  交易日期 + 交易时间（**拆成两列**）、摘要、交易金额、账户余额、对方账户、对方姓名、交易渠道
  //   工行  交易日期、摘要、币种、借方金额、贷方金额、余额、对方户名
  //   建行  新：借方(支取) / 贷方(收入)；旧：存入 / 支出 —— 都是两列
  //   招行  支出 / 收入 两列，没有方向列
  //   中行  交易金额 + 借贷标志（"借"/"贷"）
  //   交行  发生额 + 借贷标志
  //   邮储  交易日期 + 交易时间 + 摘要 + 交易金额
  // 所以这里必须同时支持：① 两列金额 ② 一列金额 + 方向 ③ 一列带符号金额
  // ④ 日期与时间分列（拼起来才是完整时间）
  // ------------------------------------------------------------
  const COL_HINTS = [
    { key: 'orderNo', hints: ['交易单号', '交易订单号', '交易号', '流水号', '交易流水号', '凭证号', '订单号', '商户单号'] },
    // date：只有日期。银行常把它和「时间」拆开，所以单独认
    { key: 'date', hints: ['交易日期', '记账日期', '入账日期', '发生日期', '交易发生日期', '日期'] },
    // time：完整时间，或只有时分秒
    { key: 'time', hints: ['交易时间', '交易创建时间', '付款时间', '发生时间', '入账时间', '时间'] },
    { key: 'amtOut', hints: ['支出金额', '支出', '借方发生额', '借方金额', '借方支取', '借方', '支取金额', '支取', '转出金额', '转出', '付款金额', '扣款金额'] },
    { key: 'amtIn', hints: ['收入金额', '收入', '贷方发生额', '贷方金额', '贷方收入', '贷方', '存入金额', '存入', '转入金额', '转入', '收款金额'] },
    { key: 'amount', hints: ['交易金额', '发生额', '订单金额', '人民币金额', '金额'] },
    { key: 'io', hints: ['收/支', '收／支', '收支', '收付', '借贷标志', '借贷方向', '借贷类型', '借贷标识', '借贷', '资金方向', '资金流向', '交易方向', '收付标志', '进出标志'] },
    { key: 'kind', hints: ['交易类型', '交易分类', '业务类型', '类型'] },
    // 「对方账号」是卡号，不算商户名，所以只认姓名/户名这一类
    { key: 'merchant', hints: ['交易对方', '对方户名', '对方姓名', '对方账户名称', '对方名称', '交易对手', '商户名称', '收款方', '付款方', '商家'] },
    { key: 'product', hints: ['商品名称', '商品说明', '商品', '交易摘要', '摘要', '用途', '交易说明', '交易备注'] },
    { key: 'method', hints: ['支付方式', '收/付款方式', '收／付款方式', '付款方式', '交易渠道', '交易机构', '交易网点', '开户机构', '开户行', '渠道', '账户'] },
    { key: 'note', hints: ['备注', '附言', '说明'] },
  ];

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '').replace(/[()（）]/g, '');

  /** 把「日期列 + 时间列」拼成能解析的一串（银行经常拆成两列） */
  function combineDateTime(dateRaw, timeRaw) {
    const d = String(dateRaw || '').trim();
    const t = String(timeRaw || '').trim();
    if (!d && !t) return '';
    if (!t) return d;
    if (!d) return t;
    // 第一列本身就是完整时间（含时分），别再拼
    if (/\d{1,2}:\d{2}/.test(d)) return d;
    let ds = d.replace(/[年月]/g, '-').replace(/日/g, '').replace(/[./]/g, '-');
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(ds)) {
      const c = ds.match(/^(\d{4})(\d{2})(\d{2})$/);   // 20260809
      if (c) ds = c[1] + '-' + c[2] + '-' + c[3];
    }
    // xlsx 里日期列转出来是「2026-06-11 00:00:00」，时分其实是另一列给的，
    // 这时候要把 00:00:00 换成真实时间，别把用户选的时间丢掉。
    const midnight = ds.match(/^(\d{4}-\d{1,2}-\d{1,2})[ T]00:00:00$/);
    if (midnight) ds = midnight[1];
    // 时间列可能是 09:12:33 / 091233 / 09:12
    let tp = t;
    const hm = t.match(/^(\d{2}):?(\d{2})(?::?(\d{2}))?$/);
    if (hm) tp = hm[1] + ':' + hm[2] + (hm[3] ? ':' + hm[3] : ':00');
    return ds + ' ' + tp;
  }

  function detectHeader(rows) {
    let best = null;
    const limit = Math.min(rows.length, HEAD_SCAN);
    for (let i = 0; i < limit; i++) {
      const cells = rows[i].map(norm);
      if (cells.length < 3) continue;
      const map = {};
      let score = 0;
      COL_HINTS.forEach((g) => {
        if (map[g.key] != null) return;
        for (const h of g.hints) {
          const hn = norm(h);
          const idx = cells.findIndex((c, ci) => c && c.indexOf(hn) >= 0 && !Object.values(map).includes(ci));
          if (idx >= 0) { map[g.key] = idx; score++; break; }
        }
      });
      // 必须认出金额，而且至少有一个时间列（date 或 time 都算）
      const hasAmt = map.amount != null || map.amtOut != null || map.amtIn != null;
      const hasTime = map.time != null || map.date != null;
      if (!hasAmt || !hasTime) continue;
      if (!best || score > best.score) best = { idx: i, map, score };
    }
    return best;
  }

  // ------------------------------------------------------------
  // 解码：UTF-8 / UTF-16 BOM / GBK
  // ------------------------------------------------------------
  function decode(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes.length > 2 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (bytes.length > 1 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length > 1 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      try { return new TextDecoder('gbk').decode(bytes); } catch (e2) { return new TextDecoder('utf-8').decode(bytes); }
    }
  }

  // ------------------------------------------------------------
  // CSV 解析（正确处理引号、逗号、换行、双引号转义）
  // ------------------------------------------------------------
  function parseCSV(text) {
    const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // 分隔符嗅探：看前 5 行里逗号多还是制表符多
    const head = s.split('\n').slice(0, 5).join('\n');
    const delim = (head.match(/\t/g) || []).length > (head.match(/,/g) || []).length ? '\t' : ',';

    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; } else { q = false; }
        } else { cell += ch; }
      } else if (ch === '"') {
        q = true;
      } else if (ch === delim) {
        row.push(cell); cell = '';
      } else if (ch === '\n') {
        row.push(cell); rows.push(row); row = []; cell = '';
      } else {
        cell += ch;
      }
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  // ------------------------------------------------------------
  // 字段解析
  // ------------------------------------------------------------
  function parseAmount(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return 0;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[¥￥,，\s]/g, '');
    if (/^-/.test(s)) { neg = true; s = s.replace(/^[-－]+/, ''); }
    if (/^[+＋]/.test(s)) s = s.replace(/^[+＋]+/, '');
    const m = s.match(/(\d+(?:\.\d{1,2})?)/);
    if (!m) return 0;
    const cents = Math.round(Number(m[1]) * 100);
    return neg ? -cents : cents;
  }

  function parseTs(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    let m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      if (!isNaN(d.getTime())) return d.getTime();
    }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    const d = new Date(s.replace(/[-/.]/g, '/'));
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  function detectPlatform(text) {
    const t = String(text || '').slice(0, 4000);
    if (/微信支付|微信昵称|财付通/.test(t)) return 'wechat';
    if (/支付宝|alipay/i.test(t)) return 'alipay';
    if (/拼多多|pinduoduo/i.test(t)) return 'pdd';
    if (/美团|meituan/i.test(t)) return 'meituan';
    if (/淘宝|天猫|taobao/i.test(t)) return 'taobao';
    return 'bank';
  }

  // 收入方向的关键词 → 收入分类
  const INCOME_MAP = [
    { catId: 'salary', words: ['工资', '薪资', '代发工资', '月薪', '薪酬'] },
    { catId: 'bonus', words: ['奖金', '年终奖', '绩效', '补贴', '津贴'] },
    { catId: 'invest', words: ['利息', '分红', '理财', '收益', '基金', '股息'] },
    { catId: 'parttime', words: ['兼职', '稿费', '外快', '副业', '劳务'] },
    { catId: 'gift_in', words: ['红包', '礼金', '压岁钱'] },
  ];

  function classifyFor(text, type) {
    if (type === 'income') {
      for (const g of INCOME_MAP) {
        for (const w of g.words) {
          if (text.indexOf(w) >= 0) return { catId: g.catId, sub: '' };
        }
      }
      return { catId: 'other_in', sub: '' };
    }
    if (global.OCR && global.OCR.classify) {
      const c = global.OCR.classify(text);
      return { catId: c.catId, sub: c.sub || '' };
    }
    return { catId: 'other_out', sub: '' };
  }

  function hashKey(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'b' + (h >>> 0).toString(36);
  }

  // ------------------------------------------------------------
  // xlsx（Excel 2007+）解析：zip + XML，不引第三方库
  //
  // 为什么必须有：工行 / 农行等网银的「下载全部」默认给的就是 Excel，
  // 而导入入口以前只收 CSV。用户把 Excel 选进来，看到的就是一堆乱码，
  // 报错还说「认不出表头」——其实是文件类型就不对。
  // 浏览器自己有 DecompressionStream，能解 zip 里的 deflate，所以不用装库。
  // ------------------------------------------------------------
  const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];   // "PK\x03\x04"
  const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];   // 旧版 .xls（OLE2 复合文档）
  const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];   // "%PDF"

  /** 前 1KB 按 Latin-1 转一下，用于在文件头里找 %PDF（PDF 允许前面有垃圾字节） */
  function latinishHead(u8) {
    let s = '';
    const n = Math.min(u8.length, 1024);
    for (let i = 0; i < n; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  function startsWith(bytes, sig) {
    for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
    return true;
  }

  /** 读 zip 中央目录，返回 Map<文件名, {method, data:Uint8Array}> */
  function readZip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eo = -1;
    const from = Math.max(0, u8.length - 65557);
    for (let i = u8.length - 22; i >= from; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eo = i; break; }
    }
    if (eo < 0) return new Map();
    const count = dv.getUint16(eo + 10, true);
    let p = dv.getUint32(eo + 16, true);
    const out = new Map();
    for (let i = 0; i < count && p + 46 <= u8.length; i++) {
      if (!(u8[p] === 0x50 && u8[p + 1] === 0x4b && u8[p + 2] === 0x01 && u8[p + 3] === 0x02)) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nameLen));
      if (localOff + 30 <= u8.length) {
        const lNameLen = dv.getUint16(localOff + 26, true);
        const lExtraLen = dv.getUint16(localOff + 28, true);
        const start = localOff + 30 + lNameLen + lExtraLen;
        out.set(name, { method, data: u8.subarray(start, start + csize) });
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /** 解 deflate-raw；method 0 是「没压缩」，直接返回 */
  async function inflateRaw(entry) {
    if (entry.method === 0) return entry.data;
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前系统版本解不开 xlsx，请先在电脑上「另存为 CSV」再导入');
    }
    const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Excel 日期序号 → 'YYYY-MM-DD HH:mm:ss'（1970-01-01 的序号是 25569） */
  function serialToYmd(v) {
    const ms = Math.round((v - 25569) * 86400000);
    if (!isFinite(ms) || ms < -2208988800000 || ms > 4102444800000) return '';
    const d = new Date(ms);
    const p = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function decodeEntities(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
      .replace(/&amp;/g, '&');
  }

  const xmlTexts = (xml) => {
    const out = [];
    const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = re.exec(xml))) out.push(decodeEntities(m[1]));
    return out;
  };

  /** 'AB' → 27（列序号） */
  const colIndex = (letters) => {
    let n = 0;
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  };

  /** 解析 worksheet xml → 行数组 */
  function parseSheetXml(xml, shared) {
    const rows = [];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(xml))) {
      const body = rm[1] || '';
      const cells = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cellRe.exec(body))) {
        const attrs = cm[1] || '';
        const inner = cm[2] || '';
        const ref = /r="([A-Z]+)\d+"/.exec(attrs);
        const col = ref ? colIndex(ref[1]) : cells.length;
        const t = /t="([^"]+)"/.exec(attrs);
        const type = t ? t[1] : '';
        let val = '';
        if (type === 's') {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          val = v ? String(shared[Number(v[1])] == null ? '' : shared[Number(v[1])]) : '';
        } else if (type === 'inlineStr') {
          val = xmlTexts(inner).join('');
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          val = v ? decodeEntities(v[1]) : xmlTexts(inner).join('');
        }
        while (cells.length < col) cells.push('');
        cells[col] = String(val).trim();
      }
      if (cells.some((c) => c !== '')) rows.push(cells);
    }
    return rows;
  }

  async function parseXlsx(buf) {
    const u8 = new Uint8Array(buf);
    if (startsWith(u8, OLE_MAGIC)) {
      throw new Error('这是旧版 Excel（.xls）。用 Excel / WPS 打开，「另存为」CSV 或 .xlsx 后再导入。');
    }
    const zip = readZip(buf);
    if (!zip.size) throw new Error('读不到 xlsx 的内容，请先「另存为 CSV」再导入');

    let shared = [];
    const ss = zip.get('xl/sharedStrings.xml');
    if (ss) {
      const xml = new TextDecoder('utf-8').decode(await inflateRaw(ss));
      const siRe = /<si[^>]*>([\s\S]*?)<\/si>/g;
      let m;
      while ((m = siRe.exec(xml))) shared.push(xmlTexts(m[1]).join(''));
    }

    let sheetName = 'xl/worksheets/sheet1.xml';
    if (!zip.has(sheetName)) {
      for (const k of zip.keys()) {
        if (/^xl\/worksheets\/sheet\d+\.xml$/.test(k)) { sheetName = k; break; }
      }
    }
    const sh = zip.get(sheetName);
    if (!sh) throw new Error('xlsx 里没有工作表，请先「另存为 CSV」再导入');
    const xml = new TextDecoder('utf-8').decode(await inflateRaw(sh));
    return parseSheetXml(xml, shared);
  }

  // ------------------------------------------------------------
  // 主解析：文本 → { platform, entries, skipped, warning }
  // ------------------------------------------------------------
  function parseText(text) {
    return parseRows(parseCSV(text), { engine: 'csv', text });
  }

  function parseRows(rows, opts) {
    const o = opts || {};
    if (!rows.length) throw new Error('这个文件里没有内容，确认是账单文件吗？');

    const head = detectHeader(rows);
    if (!head) {
      // 报错时把「最像表头的那一行」打出来，用户一眼能看出差在哪，
      // 也方便以后遇到新银行直接照着加别名（比一句「认不出表头」有用得多）。
      const cand = rows.slice(0, 10)
        .map((r) => r.map((c) => String(c).trim()).filter(Boolean))
        .filter((r) => r.length >= 2)
        .sort((a, b) => b.length - a.length)[0] || [];
      throw new Error('认不出表头：文件里需要一行列名，至少包含「日期/时间」和「金额」。' +
        (cand.length ? '我在前几行里看到这些列：' + cand.slice(0, 10).join('、') + '。' : '') +
        ' 如果是 Excel 文件，请另存为 CSV，或直接选 .xlsx 版本。');
    }

    const platform = detectPlatform(o.text || rows.map((r) => r.join(',')).join('\n'));
    const map = head.map;

    // xlsx 里日期是 Excel 序号（46204 这种），先转成 2026-06-11 再交给 parseTs
    if (o.fromXlsx) {
      [map.date, map.time].forEach((ci) => {
        if (ci == null) return;
        for (let r = head.idx + 1; r < rows.length; r++) {
          const v = String(rows[r][ci] == null ? '' : rows[r][ci]).trim();
          if (/^\d{5}(\.\d+)?$/.test(v)) {
            const ymd = serialToYmd(Number(v));
            if (ymd) rows[r][ci] = ymd;
          }
        }
      });
    }
    const get = (row, k) => {
      const i = map[k];
      if (i == null) return '';
      return String(row[i] == null ? '' : row[i]).trim();
    };

    const entries = [];
    let neutral = 0;
    let bad = 0;

    // 没有借方/贷方列、也没有方向列时，靠摘要里的字眼判断收入还是支出
    const IN_WORDS = /收入|存入|转入|入账|工资|代发|薪酬|利息|结息|分红|退款|退货|报销|奖金|补贴|收款|汇入/;
    const OUT_WORDS = /支出|消费|转出|取现|取款|扣款|手续费|费用|缴费|还款|付款|汇出|支付|购买/;

    for (let i = head.idx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;
      const joined = row.join(' ');
      if (/^-{3,}|^={3,}/.test(joined.trim())) continue;

      // 日期与时间可能分列（农行 / 邮储 / 建行都这样），拼起来再解析
      const ts = parseTs(combineDateTime(
        map.date != null ? get(row, 'date') : '',
        get(row, 'time')
      ));
      let amtOut = 0;
      let amtIn = 0;
      if (map.amtOut != null) amtOut = Math.abs(parseAmount(get(row, 'amtOut')));
      if (map.amtIn != null) amtIn = Math.abs(parseAmount(get(row, 'amtIn')));
      let raw = 0;
      if (!amtOut && !amtIn) raw = parseAmount(get(row, 'amount'));
      const amount = amtOut || amtIn || Math.abs(raw);
      if (!amount) { bad++; continue; }
      if (!ts) { bad++; continue; }

      // 收支方向
      let type;
      if (map.io != null) {
        const f = get(row, 'io');
        // 「借」= 支出、「贷」= 收入，是活期账户的记账口径（建行/工行/交行都这么写）
        if (/收入|收款|贷方|贷|存入|转入|进/.test(f)) type = 'income';
        else if (/支出|付款|借方|借|支取|转出|出/.test(f)) type = 'expense';
        else { neutral++; continue; }   // 不计收支 / 中性交易（提现、还款、转账）
      } else if (amtOut || amtIn) {
        type = (amtIn && !amtOut) ? 'income' : 'expense';
      } else if (raw < 0) {
        type = 'expense';
      } else {
        // 一列正数金额 + 没有方向列：只能看摘要/交易类型/对方
        const probe = [get(row, 'kind'), get(row, 'product'), get(row, 'merchant'), get(row, 'note')].join(' ');
        type = (IN_WORDS.test(probe) && !OUT_WORDS.test(probe)) ? 'income' : 'expense';
      }

      const merchant = get(row, 'merchant');
      const product = get(row, 'product');
      const noteRaw = get(row, 'note');
      const kindTxt = get(row, 'kind');
      const orderNo = get(row, 'orderNo');

      const cls = classifyFor([merchant, product, kindTxt, noteRaw].join(' '), type);

      let note = merchant || product || kindTxt || '';
      if (product && merchant && product !== merchant) note = merchant + ' · ' + product;
      if (!note) note = noteRaw;
      note = note.replace(/\s+/g, ' ').slice(0, 60);

      const sigBase = platform + '|' + ts + '|' + amount + '|' + (orderNo || merchant || product || '');
      entries.push({
        type,
        amount,
        catId: cls.catId,
        sub: cls.sub,
        merchant: merchant || product || '',
        product,
        note,
        ts,
        srcKey: hashKey(sigBase),
        engine: 'csv',
      });
    }

    if (!entries.length) {
      throw new Error('没能从这份账单里读出任何一笔。' + (neutral ? `有 ${neutral} 笔是转账/提现这类不计收支的记录，已跳过。` : '确认文件里有「时间」和「金额」两列。'));
    }

    entries.sort((a, b) => a.ts - b.ts);

    const warning = [];
    if (neutral) warning.push(`已跳过 ${neutral} 笔不计收支的记录（提现 / 还款 / 转账）`);
    if (bad) warning.push(`有 ${bad} 行缺少时间或金额，已跳过`);

    return { platform, entries, skipped: { neutral, bad }, warning: warning.join('；'), engine: o.engine || 'csv' };
  }

  async function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.readAsArrayBuffer(file);
    });
  }

  /**
   * 按文件内容自动分流：PDF 抽文字、zip 走 Excel、其余按文本 CSV 解析。
   * @param {ArrayBuffer} buf
   */
  async function parseBuffer(buf) {
    const u8 = new Uint8Array(buf);
    // 旧版 Excel（OLE2 复合文档）不是 zip，得在 zip 判断之前单独认，
    // 否则只会得到一句「不是文本账单」，用户不知道该怎么办。
    if (startsWith(u8, OLE_MAGIC)) {
      throw new Error('这是旧版 Excel（.xls）。用 Excel / WPS 打开，「另存为」CSV 或 .xlsx 后再导入。');
    }
    // PDF：农行的交易流水证明、不少银行的「电子回单」都是这个格式
    if (startsWith(u8, PDF_MAGIC) || latinishHead(u8).indexOf('%PDF') >= 0) {
      if (!global.PDFText || typeof global.PDFText.toRows !== 'function') {
        throw new Error('当前版本读不了 PDF，请更新到最新版后再试。');
      }
      const rows = await global.PDFText.toRows(buf);
      if (!rows.length) {
        throw new Error('这个 PDF 里没有可复制的文字（多半是扫描件/图片转的 PDF）。' +
          '可以把它截图，用「识图导入」识别，或让银行导出 CSV / Excel 版本。');
      }
      return parseRows(rows, { engine: 'pdf', text: rows.map((r) => r.join(',')).join('\n') });
    }
    if (startsWith(u8, ZIP_MAGIC)) {
      const rows = await parseXlsx(buf);
      return parseRows(rows, {
        engine: 'xlsx',
        fromXlsx: true,
        text: rows.map((r) => r.join(',')).join('\n'),
      });
    }
    const text = decode(buf);
    // 选错文件类型时的典型表现：一堆控制字符 / 乱码。提前拦下来，
    // 别让用户对着一屏乱码猜「我到底选错了什么」。
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 4000))) {
      throw new Error('这个文件不是文本账单（可能是 Excel 二进制文件）。请改用 .xlsx 或 .csv 版本。');
    }
    return parseText(text);
  }

  async function parseFile(file) {
    if (!file) throw new Error('没有选择文件');
    if (file.size > 20 * 1024 * 1024) throw new Error('文件太大了（超过 20MB），建议按月分批导入');
    const buf = await readFile(file);
    return parseBuffer(buf);
  }

  // ------------------------------------------------------------
  // 平台名 / 账户映射
  // ------------------------------------------------------------
  function platformName(p) {
    const m = { wechat: '微信', alipay: '支付宝', pdd: '拼多多', meituan: '美团', taobao: '淘宝', bank: '银行卡', other: '其他' };
    return m[p] || '银行卡';
  }

  function accountFor(platform) {
    if (platform === 'wechat') return 'wechat';
    if (platform === 'alipay') return 'alipay';
    if (platform === 'bank') return 'bank';
    return S.state.accounts[0] ? S.state.accounts[0].id : 'alipay';
  }

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------
  let uiState = { fileName: '', parsed: null, dupCount: 0, error: '', busy: false, include: [] };

  function reset() {
    uiState = { fileName: '', parsed: null, dupCount: 0, error: '', busy: false, include: [] };
  }

  function open(seed) {
    reset();
    if (seed) Object.assign(uiState, seed);
    if (uiState.parsed && !uiState.include.length) {
      uiState.include = uiState.parsed.entries.map(() => true);
    }
    UI.openSheet({
      title: '导入账单',
      content: renderBody(),
      onMount(el, close) { mount(el, close); },
    });
  }

  function stat() {
    const p = uiState.parsed;
    if (!p) return null;
    let expense = 0;
    let income = 0;
    let n = 0;
    p.entries.forEach((e, i) => {
      if (!uiState.include[i]) return;
      n++;
      if (e.type === 'income') income += e.amount; else expense += e.amount;
    });
    const first = p.entries[0];
    const last = p.entries[p.entries.length - 1];
    return { n, expense, income, from: first ? first.ts : 0, to: last ? last.ts : 0 };
  }

  // ------------------------------------------------------------
  // 跨月识别：这份文件覆盖了哪些月、哪些月账本里已经有记录、账本里还有哪些月是空的
  // ------------------------------------------------------------
  function monthInfo() {
    const p = uiState.parsed;
    if (!p) return [];
    const map = new Map();
    p.entries.forEach((e, i) => {
      const k = U.monthKey(new Date(e.ts));
      if (!map.has(k)) map.set(k, { ym: k, count: 0, amount: 0, dup: 0, existing: 0 });
      const m = map.get(k);
      m.count++;
      m.amount += e.amount;
      if (!uiState.include[i]) m.dup++;
    });

    const bid = S.activeBookId ? S.activeBookId() : '';
    const byMonth = new Map();
    S.state.tx.forEach((t) => {
      if (bid && t.bookId && t.bookId !== bid) return;
      const k = U.monthKey(new Date(t.ts));
      byMonth.set(k, (byMonth.get(k) || 0) + 1);
    });
    map.forEach((m) => { m.existing = byMonth.get(m.ym) || 0; });
    return Array.from(map.values()).sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
  }

  /** 账本首尾之间、这份文件没覆盖、且账本里一条记录都没有的月份 */
  function gapMonths() {
    const p = uiState.parsed;
    if (!p || !p.entries.length) return [];
    const bid = S.activeBookId ? S.activeBookId() : '';
    const existing = new Set();
    let min = Infinity;
    let max = -Infinity;
    S.state.tx.forEach((t) => {
      if (bid && t.bookId && t.bookId !== bid) return;
      const k = U.monthKey(new Date(t.ts));
      existing.add(k);
      if (t.ts < min) min = t.ts;
      if (t.ts > max) max = t.ts;
    });
    if (!isFinite(min)) return [];

    const covered = new Set(p.entries.map((e) => U.monthKey(new Date(e.ts))));
    const out = [];
    const d = new Date(min);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    const last = new Date(max);
    last.setDate(1);
    let guard = 0;
    while (d.getTime() <= last.getTime() && guard++ < 400) {
      const k = U.monthKey(d);
      if (!existing.has(k) && !covered.has(k)) out.push(k);
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }

  function renderMonths() {
    const list = monthInfo();
    if (!list.length) return '';
    const multi = list.length > 1;
    return `
      <div class="bill-months">
        ${list.map((m) => `
          <span class="bill-month ${m.existing ? 'has' : ''}">
            ${U.monthLabel(m.ym)} <b>${m.count}</b> 笔${m.dup ? ` · 重复 ${m.dup}` : ''}${m.existing ? ' · 已有记录' : ''}
          </span>`).join('')}
      </div>
      ${multi ? `<div class="bill-month-warn">📅 这份账单跨了 ${list.length} 个月，会按每笔的真实日期分别记到对应的月份，不会都堆到今天。</div>` : ''}
      ${gapMonths().length ? `<div class="bill-month-warn">🧩 账本里 ${gapMonths().map((k) => U.monthLabel(k)).join('、')} 还没有任何记录，这次导入也不包含。如果那几个月也该有账，记得补一份账单。</div>` : ''}
    `;
  }

  function renderBody() {
    const st = uiState;
    const p = st.parsed;
    const s = stat();

    return `
      <div class="bill-wrap">
        ${!p ? `
          <button class="scan-drop" id="bill-pick" type="button">
            <span class="scan-drop-ic">📄</span>
            <span class="scan-drop-title">选择账单 CSV 文件</span>
            <span class="scan-drop-desc">微信 / 支付宝 / 银行的流水，CSV、TXT、xlsx、PDF</span>
            <span class="scan-drop-btn">从文件选择</span>
          </button>
        ` : `
          <div class="bill-head">
            <span class="pill pill--brand">${platformName(p.platform)}</span>
            <span class="small muted">${U.fullDate(s.from)} — ${U.fullDate(s.to)}</span>
          </div>
          <div class="bill-stats">
            <div class="bill-stat"><b>${s.n}</b><span>待导入</span></div>
            <div class="bill-stat"><b class="exp">${U.moneyCompact(s.expense)}</b><span>支出</span></div>
            <div class="bill-stat"><b class="inc">${U.moneyCompact(s.income)}</b><span>收入</span></div>
          </div>
          ${p.warning ? `<div class="scan-warn">⚠️ ${U.escapeHtml(p.warning)}</div>` : ''}
          ${st.dupCount ? `<div class="bill-dup">🔁 有 ${st.dupCount} 笔之前已经导入过，已自动取消勾选</div>` : ''}
          ${renderMonths()}
          <div class="bill-list">
            ${p.entries.slice(0, MAX_SHOW).map((e, i) => renderRow(e, i)).join('')}
            ${p.entries.length > MAX_SHOW ? `<div class="bill-more">还有 ${p.entries.length - MAX_SHOW} 笔没显示，导入时会一并处理</div>` : ''}
          </div>
          <div class="bill-actions">
            <button class="btn btn--ghost" id="bill-cancel" type="button">重来</button>
            <button class="btn btn--primary" id="bill-save" type="button" ${s.n ? '' : 'disabled'}>
              导入 ${s.n} 笔
            </button>
          </div>
        `}

        ${st.error ? `<div class="scan-error">⚠️ ${U.escapeHtml(st.error)}</div>` : ''}

        ${!p ? `
          <div class="scan-tips">
            <div class="scan-tips-title">怎么导出账单</div>
            <div>· <b>微信</b>：我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单 → 用于个人对账，账单会发到邮箱</div>
            <div>· <b>支付宝</b>：我的 → 账单 → 右上角 ⋯ → 开具交易流水证明 → 用于个人对账，发到邮箱</div>
            <div>· <b>银行卡</b>：网银或银行 App 里导出「交易明细」，选 CSV 或 Excel 都行（.xlsx 直接导，.xls 要先另存为 CSV）</div>
            <div>· 表头不用改：各家银行的列名（交易日期、借方金额、发生额、摘要…）都能自动认，日期和时间分两列也行
            · 邮箱收到的账单通常是压缩包，解压出 CSV 再选进来</div>
            <div>· 全程在本地解析，文件不会上传到任何服务器</div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderRow(e, i) {
    const meta = Icons.cat(e.catId);
    const on = uiState.include[i];
    return `
      <div class="bill-row ${on ? '' : 'off'}" data-row="${i}">
        <button class="bill-check ${on ? 'on' : ''}" data-check="${i}" type="button" aria-label="是否导入">
          ${on ? Icons.svg('check', 12) : ''}
        </button>
        <span class="bill-ic" style="background:${meta.color}1A">${meta.icon}</span>
        <span class="bill-main">
          <span class="bill-name">${U.escapeHtml(e.merchant || e.note || meta.name)}</span>
          <span class="bill-sub">${U.escapeHtml(e.product && e.product !== e.merchant ? e.product : meta.name)} · ${U.humanDate(e.ts)}</span>
        </span>
        <span class="bill-right">
          <span class="bill-amt ${e.type === 'income' ? 'in' : ''}">${e.type === 'income' ? '+' : '-'}${U.money(e.amount)}</span>
          <select class="bill-sel" data-cat="${i}">
            ${Icons.CATEGORIES.filter((c) => c.kind === e.type).map((c) =>
              `<option value="${c.id}" ${c.id === e.catId ? 'selected' : ''}>${(Icons.catEmbedded ? Icons.catEmbedded(c) : c.icon)} ${c.name}</option>`).join('')}
          </select>
        </span>
      </div>
    `;
  }

  function mount(el, close) {
    const rerender = () => {
      const scrollTop = el.scrollTop;
      el.innerHTML = renderBody();
      el.scrollTop = scrollTop;
      mount(el, close);
    };

    const pick = el.querySelector('#bill-pick');
    if (pick) {
      pick.addEventListener('click', () => {
        // 统一走 U.pickFile：input 必须先挂进 DOM，否则安卓 WebView 不弹选择器
        U.pickFile({
          accept: '.csv,.txt,.xlsx,.pdf,text/csv,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          onPick: async (f) => {
            uiState.busy = true;
            uiState.error = '';
            try {
              const parsed = await parseFile(f);
              const seen = S.srcKeys();
              uiState.parsed = parsed;
              uiState.fileName = f.name;
              uiState.include = parsed.entries.map((e) => !seen.has(e.srcKey));
              uiState.dupCount = uiState.include.filter((x) => !x).length;
            } catch (err) {
              uiState.parsed = null;
              uiState.error = err.message || '解析失败';
            } finally {
              uiState.busy = false;
              rerender();
            }
          },
        });
      });
    }

    el.querySelectorAll('[data-check]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.check);
        uiState.include[i] = !uiState.include[i];
        U.vibrate(5);
        rerender();
      });
    });

    el.querySelectorAll('[data-cat]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const i = Number(sel.dataset.cat);
        const e = uiState.parsed && uiState.parsed.entries[i];
        if (!e) return;
        e.catId = sel.value;
        const meta = Icons.cat(sel.value);
        e.sub = '';
        const row = sel.closest('.bill-row');
        if (row) {
          const ic = row.querySelector('.bill-ic');
          if (ic) { ic.textContent = meta.icon; ic.style.background = meta.color + '1A'; }
        }
      });
    });

    const cancel = el.querySelector('#bill-cancel');
    if (cancel) cancel.addEventListener('click', () => { reset(); rerender(); });

    const save = el.querySelector('#bill-save');
    if (save) {
      save.addEventListener('click', () => {
        const p = uiState.parsed;
        if (!p) return;
        const account = accountFor(p.platform);
        const list = [];
        p.entries.forEach((e, i) => {
          if (!uiState.include[i]) return;
          list.push({
            type: e.type,
            amount: e.amount,
            catId: e.catId,
            sub: e.sub || '',
            accountId: account,
            note: e.note || '',
            ts: e.ts,
            srcKey: e.srcKey,
          });
        });
        if (!list.length) { U.toast('没有勾选任何一笔', 'error'); return; }
        const added = S.addTxMany(list);
        close();
        // 跳到最早导入那笔所在的周期，否则用户停在当前月会以为没导进来
        const earliest = list.reduce((m, x) => (x.ts < m ? x.ts : m), list[0].ts);
        if (global.ViewDetail && global.ViewDetail.focus) global.ViewDetail.focus(earliest);
        App.go('detail');
        const moved = global.ViewDetail && global.ViewDetail.state.offset !== 0;
        U.toast(moved
          ? `已导入 ${added.length} 笔，已跳到 ${U.monthLabel(new Date(earliest))}`
          : `已导入 ${added.length} 笔`, 'success');
      });
    }
  }

  global.Bills = {
    open, reset, parseFile, parseBuffer, parseText, parseRows, parseCSV, decode, parseXlsx,
    detectHeader, parseAmount, parseTs, detectPlatform, classifyFor, platformName, accountFor,
    serialToYmd,
    get state() { return uiState; },
  };
})(window);
