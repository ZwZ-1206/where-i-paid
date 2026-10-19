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
  // 顺序有意义：越靠前的组越先认领列，避免「交易时间」被「交易类型」抢走
  // ------------------------------------------------------------
  const COL_HINTS = [
    { key: 'orderNo', hints: ['交易单号', '交易订单号', '交易号', '流水号', '订单号', '商户单号', '交易流水号'] },
    { key: 'time', hints: ['交易时间', '交易创建时间', '付款时间', '记账时间', '交易日期', '入账日期', '发生日期', '日期', '时间'] },
    { key: 'amtOut', hints: ['支出金额', '借方发生额', '借方金额', '付款金额', '支出'] },
    { key: 'amtIn', hints: ['收入金额', '贷方发生额', '贷方金额', '收款金额', '收入'] },
    { key: 'amount', hints: ['金额(元)', '金额（元）', '交易金额', '发生额', '订单金额', '金额'] },
    { key: 'io', hints: ['收/支', '收／支', '收支', '收付', '借贷标志', '借贷', '资金方向'] },
    { key: 'kind', hints: ['交易类型', '交易分类', '业务类型', '类型'] },
    { key: 'merchant', hints: ['交易对方', '对方户名', '对方名称', '商户名称', '收款方', '付款方', '商家'] },
    { key: 'product', hints: ['商品名称', '商品说明', '商品', '摘要', '用途', '交易说明'] },
    { key: 'method', hints: ['支付方式', '收/付款方式', '收／付款方式', '付款方式', '账户'] },
    { key: 'note', hints: ['备注', '附言'] },
  ];

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '').replace(/[()（）]/g, '');

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
      // 必须认出时间与金额，否则这一行不是表头
      const ok = map.amount != null || map.amtOut != null || map.amtIn != null;
      if (!ok || map.time == null) continue;
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
  // 主解析：文本 → { platform, entries, skipped, warning }
  // ------------------------------------------------------------
  function parseText(text) {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('这个文件里没有内容，确认是 CSV 账单文件吗？');

    const head = detectHeader(rows);
    if (!head) {
      throw new Error('认不出表头。需要文件里有一行列名，比如「交易时间、交易对方、金额」。微信/支付宝导出的原始账单 CSV 可以直接用。');
    }

    const platform = detectPlatform(text);
    const map = head.map;
    const get = (row, k) => {
      const i = map[k];
      if (i == null) return '';
      return String(row[i] == null ? '' : row[i]).trim();
    };

    const entries = [];
    let neutral = 0;
    let bad = 0;

    for (let i = head.idx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;
      const joined = row.join(' ');
      if (/^-{3,}|^={3,}/.test(joined.trim())) continue;

      const ts = parseTs(get(row, 'time'));
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
        if (/收入|收款|贷方|贷/.test(f)) type = 'income';
        else if (/支出|付款|借方|借/.test(f)) type = 'expense';
        else { neutral++; continue; }   // 不计收支 / 中性交易（提现、还款、转账）
      } else if (amtOut || amtIn) {
        type = (amtIn && !amtOut) ? 'income' : 'expense';
      } else if (raw < 0) {
        type = 'expense';
      } else if (map.kind != null && /收入|收款|转入|退款/.test(get(row, 'kind'))) {
        type = 'income';
      } else {
        type = 'expense';
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

    return { platform, entries, skipped: { neutral, bad }, warning: warning.join('；'), engine: 'csv' };
  }

  async function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.readAsArrayBuffer(file);
    });
  }

  async function parseFile(file) {
    if (!file) throw new Error('没有选择文件');
    if (file.size > 20 * 1024 * 1024) throw new Error('文件太大了（超过 20MB），建议按月分批导入');
    const buf = await readFile(file);
    const text = decode(buf);
    return parseText(text);
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
            <span class="scan-drop-desc">微信支付 / 支付宝 / 网上银行导出的账单流水，CSV 或 TXT</span>
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
            <div>· <b>银行卡</b>：网银或银行 App 里导出流水，或去柜台打印后转成 CSV</div>
            <div>· 邮箱收到的账单通常是压缩包，解压出 CSV 再选进来</div>
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
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,.txt,text/csv,text/plain';
        input.addEventListener('change', async () => {
          const f = input.files && input.files[0];
          if (!f) return;
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
        });
        input.click();
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
    open, reset, parseFile, parseText, parseCSV, decode,
    detectHeader, parseAmount, parseTs, detectPlatform, classifyFor, platformName, accountFor,
    get state() { return uiState; },
  };
})(window);
