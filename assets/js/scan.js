/* ============================================================
 * 花哪儿了 · 识图记账
 * 上传微信 / 支付宝 / 拼多多等账单截图 → 自动识别金额与分类
 * 双引擎：AI 视觉（需自配 Key） / 本地 OCR（离线，首次需下载）
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  const MAX_SIDE = 1400;   // 预览 / 送 AI 时的最长边
  const MAX_BYTES = 900 * 1024; // 压缩目标
  // 注意：本地 OCR **不吃**压缩后的图。长截屏按最长边等比缩会被压成一条，
  // 字全糊了，所以 OCR 走原图（尺寸由 ocr.js 的 planTiles 负责）。

  // ------------------------------------------------------------
  // 图片处理：读取 → 压缩 → dataURL
  // ------------------------------------------------------------
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('读取图片失败'));
      fr.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('这张图片打不开，换一张试试'));
      img.src = dataUrl;
    });
  }

  async function compress(dataUrl) {
    const img = await loadImage(dataUrl);
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) return dataUrl;
    // 预览 / 送 AI 用：宽度优先保证看清，高度也给个上限，免得长图变成一条细线
    const scale = Math.min(1, MAX_SIDE / w0, (MAX_SIDE * 1.7) / h0);
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let q = 0.9;
    let out = cv.toDataURL('image/jpeg', q);
    while (out.length > MAX_BYTES * 1.37 && q > 0.4) {
      q -= 0.12;
      out = cv.toDataURL('image/jpeg', q);
    }
    return out;
  }

  // ------------------------------------------------------------
  // 引擎选择
  // ------------------------------------------------------------
  function engineSetting() {
    return (S.settings.scan && S.settings.scan.engine) || 'auto';
  }

  /** 实际会用哪个引擎 */
  function resolveEngine() {
    const pref = engineSetting();
    const aiOk = !!(global.AI && global.AI.canVision());
    if (pref === 'ai') return aiOk ? 'ai' : 'none';
    if (pref === 'ocr') return 'ocr';
    // auto：有 AI 用 AI，否则 OCR
    return aiOk ? 'ai' : 'ocr';
  }

  function engineLabel(e) {
    return e === 'ai' ? 'AI 识图' : e === 'ocr' ? '本地 OCR' : '未配置';
  }

  // ------------------------------------------------------------
  // 识别主流程
  // ------------------------------------------------------------
  async function scan(dataUrl, onProgress) {
    const engine = resolveEngine();
    const report = (p) => { if (typeof onProgress === 'function') onProgress(p); };

    if (engine === 'none') {
      throw new Error('识图功能还没配置。到「设置 → AI 接口」填入地址和 Key，或把识别引擎切成「本地 OCR」。');
    }

    if (engine === 'ai') {
      report({ stage: 'ai', pct: 0.15, label: 'AI 正在看这张图' });
      const r = await global.AI.visionScan(dataUrl);
      report({ stage: 'done', pct: 1, label: '识别完成' });
      return Object.assign(r, { engine: 'ai' });
    }

    report({ stage: 'ocr', pct: 0.05, label: '准备本地识别引擎' });
    const r = await global.OCR.scan(dataUrl, { onProgress: report });
    report({ stage: 'done', pct: 1, label: '识别完成' });
    return r;
  }

  // ------------------------------------------------------------
  // 结果 → 账目草稿
  // ------------------------------------------------------------
  function toDraft(entry, fallbackAccount) {
    return {
      type: entry.type || 'expense',
      amount: entry.amount,
      amountText: (entry.amount / 100).toFixed(2).replace(/\.?0+$/, ''),
      catId: entry.catId,
      sub: entry.sub || '',
      accountId: entry.accountId || fallbackAccount || guessAccount(entry.platform),
      note: entry.note || entry.merchant || '',
      ts: entry.ts || Date.now(),
    };
  }

  function guessAccount(platform) {
    if (platform === 'wechat') return 'wechat';
    if (platform === 'alipay') return 'alipay';
    if (platform === 'bank') return 'bank';
    return S.state.accounts[0] ? S.state.accounts[0].id : 'alipay';
  }

  function platformName(p) {
    const m = {
      wechat: '微信', alipay: '支付宝', pdd: '拼多多',
      meituan: '美团', taobao: '淘宝', bank: '银行', other: '其他',
    };
    return m[p] || '其他';
  }

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------
  let uiState = { file: null, dataUrl: '', rawUrl: '', result: null, busy: false, progress: null, error: '', preferType: 'expense' };

  function reset() {
    uiState = { file: null, dataUrl: '', rawUrl: '', result: null, busy: false, progress: null, error: '', preferType: 'expense' };
  }

  function open(seed) {
    reset();
    if (seed) Object.assign(uiState, seed);
    if (uiState.preferType !== 'income') uiState.preferType = 'expense';
    applyPrefer();
    UI.openSheet({
      title: '识图导入',
      content: renderBody(),
      onMount(el, close) {
        mount(el, close);
      },
    });
  }

  /** 用户在气泡里选了「支出/收入」，而识别结果整体是另一种类型时，按用户的选择纠正 */
  function applyPrefer() {
    const list = (uiState.result && uiState.result.entries) || [];
    if (!list.length) return;
    if (list.every((e) => e.type !== uiState.preferType)) {
      list.forEach((e) => retype(e, uiState.preferType));
    }
  }

  /** 把一条识别结果的类型强制改成目标类型（分类回落到该类型的第一个/其他） */
  function retype(entry, type) {
    if (!entry || entry.type === type) return;
    entry.type = type;
    const pool = Icons.CATEGORIES.filter((c) => c.kind === type);
    const keep = pool.find((c) => c.id === entry.catId);
    if (!keep) {
      entry.catId = type === 'income' ? (pool[0] ? pool[0].id : 'other_in') : 'other_out';
      entry.sub = '';
    }
  }

  function renderBody() {
    const engine = resolveEngine();
    const st = uiState;
    const aiOk = !!(global.AI && global.AI.canVision());
    const ocrNote = global.OCR && global.OCR.loaded ? '已就绪，可离线用' : '首次使用需联网下载约 20MB';
    const income = st.preferType === 'income';

    return `
      <div class="scan-wrap">
        <div class="scan-kind">
          <div class="segmented">
            <button data-prefer="expense" class="${income ? '' : 'on'}" type="button">记为支出</button>
            <button data-prefer="income" class="${income ? 'on' : ''}" type="button">记为收入</button>
          </div>
          <div class="scan-kind-hint">${income ? '截图里的金额会记成收入' : '截图里的金额会记成支出'}，识别后还能逐笔改</div>
        </div>

        ${!st.dataUrl ? `
          <button class="scan-drop" id="scan-pick" type="button">
            <span class="scan-drop-ic">🖼</span>
            <span class="scan-drop-title">选择${income ? '收入' : '账单'}截图</span>
            <span class="scan-drop-desc">支持微信 / 支付宝 / 拼多多 / 美团 / 淘宝 / 银行 App 的账单与订单详情</span>
            <span class="scan-drop-btn">从相册选择</span>
          </button>
        ` : `
          <div class="scan-preview">
            <img id="scan-img" src="${st.dataUrl}" alt="待识别截图" />
            <button class="scan-repick" id="scan-pick" type="button">${Icons.svg('refresh', 13)} 换一张</button>
          </div>
        `}

        <div class="scan-engine">
          <span class="scan-engine-ic">${engine === 'ai' ? '✨' : engine === 'ocr' ? '🔍' : '⚠️'}</span>
          <span class="scan-engine-main">
            <b>${engineLabel(engine)}</b>
            <small>${engine === 'ai' ? '由你配置的 AI 接口识别，图片会发送给该服务'
              : engine === 'ocr' ? '完全在本机识别，图片不离开设备 · ' + ocrNote
                : '需要先在设置里配置 AI 接口，或切换为本地 OCR'}</small>
          </span>
          <button class="scan-engine-set" id="scan-goset" type="button">切换</button>
        </div>

        ${st.busy ? `
          <div class="scan-progress">
            <div class="scan-bar"><i style="width:${Math.round((st.progress ? st.progress.pct : 0.05) * 100)}%"></i></div>
            <div class="scan-progress-txt">${U.escapeHtml(st.progress ? st.progress.label : '识别中…')}</div>
          </div>` : ''}

        ${st.error ? `<div class="scan-error">⚠️ ${U.escapeHtml(st.error)}</div>` : ''}

        ${st.result ? renderResult(st.result) : ''}

        ${!st.result ? `
          <button class="btn btn--primary" id="scan-run" type="button" ${!st.dataUrl || st.busy || engine === 'none' ? 'disabled' : ''}>
            ${st.busy ? '识别中…' : '开始识别'}
          </button>
          <div class="scan-tips">
            <div class="scan-tips-title">识别小技巧</div>
            <div>· 截图尽量完整，包含金额和商户名</div>
            <div>· 一张图里有多个订单时，会识别成多笔</div>
            <div>· <b>长截屏</b>会自动切成几段分别识别，段数越多越慢</div>
            <div>· 图太长（超过约 1.8 万像素）只会识别前几段，建议拆开导入</div>
            <div>· 识别结果会先给你确认，确认后才写入账本</div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderResult(r) {
    const entries = r.entries || [];
    if (!entries.length) {
      return `<div class="scan-error">没有识别出金额。可以换一张更清晰的截图，或手动记账。</div>`;
    }
    const income = uiState.preferType === 'income';
    return `
      <div class="scan-result">
        <div class="scan-result-head">
          <span class="pill pill--brand">${platformName(r.platform)}</span>
          <span class="small muted">识别到 ${entries.length} 笔 · ${engineLabel(r.engine)}${r.tiles > 1 ? ` · 长图分 ${r.tiles} 段` : ''}</span>
        </div>
        ${r.warning ? `<div class="scan-warn">⚠️ ${U.escapeHtml(r.warning)}</div>` : ''}
        ${entries.map((e, i) => {
          const meta = Icons.cat(e.catId);
          return `
            <div class="scan-item" data-idx="${i}">
              <div class="scan-item-top">
                <span class="scan-item-ic" style="background:${meta.color}1A">${meta.icon}</span>
                <span class="scan-item-main">
                  <span class="scan-item-name">${U.escapeHtml(meta.name)}${e.sub ? ' · ' + U.escapeHtml(e.sub) : ''}</span>
                  <span class="scan-item-sub">${U.escapeHtml(e.merchant || e.note || '未识别商户')} · ${U.humanDate(e.ts)}</span>
                </span>
                <span class="scan-item-amt ${e.type === 'income' ? 'in' : ''}">${e.type === 'income' ? '+' : '-'}${U.money(e.amount)}</span>
              </div>
              <div class="scan-item-edit">
                <select class="scan-sel" data-sel="type" data-idx="${i}">
                  <option value="expense" ${e.type === 'expense' ? 'selected' : ''}>支出</option>
                  <option value="income" ${e.type === 'income' ? 'selected' : ''}>收入</option>
                </select>
                <select class="scan-sel" data-sel="cat" data-idx="${i}">
                  ${Icons.CATEGORIES.filter((c) => c.kind === e.type).map((c) =>
                    `<option value="${c.id}" ${c.id === e.catId ? 'selected' : ''}>${(Icons.catEmbedded ? Icons.catEmbedded(c) : c.icon)} ${c.name}</option>`).join('')}
                </select>
                <select class="scan-sel" data-sel="sub" data-idx="${i}">
                  <option value="">无二级标签</option>
                  ${(meta.subs || []).map((s) => `<option value="${U.escapeHtml(s)}" ${s === e.sub ? 'selected' : ''}>${U.escapeHtml(s)}</option>`).join('')}
                </select>
                <input class="scan-input" data-sel="note" data-idx="${i}" type="text" maxlength="40"
                  placeholder="备注" value="${U.escapeHtml(e.note || '')}" />
              </div>
            </div>`;
        }).join('')}
        <div class="scan-actions">
          <button class="btn btn--ghost" id="scan-cancel" type="button">重来</button>
          <button class="btn btn--primary" id="scan-save" type="button">记入账本（${entries.length} 笔）</button>
        </div>
      </div>
    `;
  }

  function mount(el, close) {
    const rerender = () => {
      const sc = el.querySelector('.scan-wrap');
      if (!sc) return;
      const scrollTop = el.scrollTop;
      el.innerHTML = renderBody();
      el.scrollTop = scrollTop;
      mount(el, close);
    };

    const pick = el.querySelector('#scan-pick');
    if (pick) {
      pick.addEventListener('click', () => {
        // 走 U.pickFile：它会先把 input 挂进 DOM 再点，
        // 否则安卓 WebView 不弹选择器（「从相册选择」点了没反应）
        U.pickFile({
          accept: 'image/*',
          onPick: async (f) => {
            try {
              const raw = await readFile(f);
              uiState.rawUrl = raw;                 // OCR 用原图，别先压
              uiState.dataUrl = await compress(raw); // 预览 / AI 用压缩图
              uiState.file = f;
              uiState.result = null;
              uiState.error = '';
              rerender();
            } catch (e) {
              uiState.error = e.message || '图片读取失败';
              rerender();
            }
          },
        });
      });
    }

    el.querySelectorAll('[data-prefer]').forEach((b) => {
      b.addEventListener('click', () => {
        const next = b.dataset.prefer === 'income' ? 'income' : 'expense';
        if (uiState.preferType === next) return;
        uiState.preferType = next;
        ((uiState.result && uiState.result.entries) || []).forEach((e) => retype(e, next));
        U.vibrate(6);
        rerender();
      });
    });

    const goset = el.querySelector('#scan-goset');
    if (goset) {
      goset.addEventListener('click', () => {
        close();
        setTimeout(() => {
          if (global.ViewSettings && global.ViewSettings.openAiSheet) global.ViewSettings.openAiSheet();
        }, 220);
      });
    }

    const run = el.querySelector('#scan-run');
    if (run) {
      run.addEventListener('click', async () => {
        if (!uiState.dataUrl) { U.toast('先选一张截图', 'error'); return; }
        uiState.busy = true;
        uiState.error = '';
        uiState.progress = { pct: 0.03, label: '开始' };
        rerender();
        try {
          // 本地 OCR 用原图（长截屏压缩后字会糊），AI 用压缩图（省流量）
          const src = resolveEngine() === 'ocr' ? (uiState.rawUrl || uiState.dataUrl) : uiState.dataUrl;
          const res = await scan(src, (p) => {
            uiState.progress = p;
            const bar = el.querySelector('.scan-bar i');
            const txt = el.querySelector('.scan-progress-txt');
            if (bar) bar.style.width = Math.round((p.pct || 0) * 100) + '%';
            if (txt) txt.textContent = p.label || '识别中…';
          });
          uiState.result = res;
          applyPrefer();
          if (!res.entries.length) uiState.error = res.warning || '没有识别出金额';
          S.setSettings({ scan: { lastEngine: res.engine } });
        } catch (e) {
          uiState.error = e.message || '识别失败';
        } finally {
          uiState.busy = false;
          rerender();
        }
      });
    }

    el.querySelectorAll('[data-sel]').forEach((node) => {
      const idx = Number(node.dataset.idx);
      const key = node.dataset.sel;
      const ev = node.tagName === 'SELECT' ? 'change' : 'input';
      node.addEventListener(ev, () => {
        const entry = uiState.result && uiState.result.entries[idx];
        if (!entry) return;
        if (key === 'type') {
          retype(entry, node.value === 'income' ? 'income' : 'expense');
          rerender();
        } else if (key === 'cat') {
          entry.catId = node.value;
          entry.sub = '';
          rerender();
        } else if (key === 'sub') {
          entry.sub = node.value;
        } else {
          entry.note = node.value;
        }
      });
    });

    const cancel = el.querySelector('#scan-cancel');
    if (cancel) cancel.addEventListener('click', () => { reset(); rerender(); });

    const save = el.querySelector('#scan-save');
    if (save) {
      save.addEventListener('click', () => {
        const entries = (uiState.result && uiState.result.entries) || [];
        if (!entries.length) return;
        const platform = uiState.result.platform;
        let n = 0;
        entries.forEach((e) => {
          if (!(e.amount > 0)) return;
          S.addTx({
            type: e.type,
            amount: e.amount,
            catId: e.catId,
            sub: e.sub || '',
            accountId: guessAccount(platform),
            note: (e.note || e.merchant || '').slice(0, 60),
            ts: e.ts || Date.now(),
          });
          n++;
        });
        close();
        U.toast(`已记入 ${n} 笔`, 'success');
        App.go('detail');
      });
    }
  }

  global.Scan = {
    open, reset, scan, compress, resolveEngine, engineLabel,
    readFile, loadImage, toDraft, guessAccount, platformName,
    get state() { return uiState; },
  };
})(window);
