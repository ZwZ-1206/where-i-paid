/* ============================================================
 * 花哪儿了 · UI 组件层（弹层 / 确认框 / 选择器）
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const $ = U.$;
  const el = U.el;
  const Store = global.Store;
  const Icons = global.Icons;

  // ------------------------------------------------------------
  // 底部弹层
  // ------------------------------------------------------------
  let sheetStack = [];

  /** 弹层关闭动画期间吞掉全页点击（捕获阶段），防止「关一个弹层又立刻弹出同一个」。
   *  只吞 click/touchend，不吞滚动；350ms 后一切恢复。 */
  let swallowUntil = 0;
  function swallowClicks(ms) {
    swallowUntil = Date.now() + ms;
    if (swallowClicks._bound) return;
    swallowClicks._bound = true;
    const stop = (e) => {
      if (Date.now() >= swallowUntil) return;
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('click', stop, true);
    // touchend 先于 click；也拦掉，免得有的设备 click 派发晚了穿透
    document.addEventListener('touchend', (e) => {
      if (Date.now() < swallowUntil) { e.stopPropagation(); }
    }, true);
  }

  /** 唤出手机键盘：必须在「用户手势的同一趟任务」里同步 focus 才稳。
   *  做法：先同步 focus（手势内）→ 250ms / 650ms 后若焦点被动画/布局挤掉则补 focus。
   *  注意：绝不能用 setTimeout(focus) 作为首次 focus —— 那样落在手势外，iOS/部分安卓不弹键盘。
   *  @param {HTMLElement} inp 输入框
   *  @param {{select?:boolean, delay?:number[]}} [opt] select=聚焦后全选（仅限已被 focus 时安全）
   *  @returns {HTMLElement|null} */
  function focusKeyboard(inp, opt) {
    if (!inp || typeof inp.focus !== 'function') return null;
    const o = opt || {};
    const focus = () => {
      try { inp.focus({ preventScroll: true }); } catch (e) { try { inp.focus(); } catch (e2) {} }
      if (o.select) { try { inp.setSelectionRange(0, (inp.value || '').length); } catch (e) {} }
    };
    focus();                                   // ① 同步：仍在用户点击那趟任务里
    const delays = o.delays || [250, 650];
    for (const d of delays) {
      setTimeout(() => {                       // ②③ 补偿：入场动画/滚动可能把焦点吞掉
        if (document.activeElement === inp) return;
        focus();
      }, d);
    }
    return inp;
  }

  function openSheet(opts) {
    const root = $('#sheet-root');
    const mask = el('div', { class: 'sheet-mask' });
    const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    sheet.innerHTML = `
      <div class="sheet-grab"></div>
      ${opts.title === null ? `
      <div class="sheet-head sheet-head--notitle">
        <button class="sheet-close" type="button" aria-label="关闭">${Icons.svg('close', 16)}</button>
      </div>` : `
      <div class="sheet-head">
        <div class="sheet-title">${U.escapeHtml(opts.title || '')}</div>
        <button class="sheet-close" type="button" aria-label="关闭">${Icons.svg('close', 16)}</button>
      </div>`}
      <div class="sheet-body"></div>
    `;
    const body = sheet.querySelector('.sheet-body');
    if (opts.content) body.innerHTML = opts.content;
    root.appendChild(mask);
    root.appendChild(sheet);
    requestAnimationFrame(() => { mask.classList.add('in'); sheet.classList.add('in'); });

    const entry = { mask, sheet, opts, body };
    sheetStack.push(entry);

    function close() {
      if (entry.closed) return;
      entry.closed = true;
      // 立刻断掉 mask 的点击：关闭动画还有 320ms，mask 还在 DOM 上，
      // 这期间再点一下（或双击的最后一下）会穿透到底层按钮，
      // 把刚关掉的弹层原样再弹一次 —— 用户就得关两次。
      mask.style.pointerEvents = 'none';
      mask.classList.remove('in');
      sheet.classList.remove('in');
      // 收尾 350ms 内吞掉全局点击（捕获阶段拦截）：mask 淡出时底下页面已经
      // 可以点到了，点在「账单行」上会立刻把同一个详情弹层再开一次 ——
      // 用户看到的就是「点空白关不掉，要点两次」（m02510）。
      swallowClicks(350);
      setTimeout(() => {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      }, 320);
      sheetStack = sheetStack.filter((s) => s !== entry);
      if (opts.onClose) opts.onClose();
    }

    mask.addEventListener('click', close);
    sheet.querySelector('.sheet-close').addEventListener('click', close);

    // 下拉手势关闭
    let startY = 0, dragging = false, dy = 0;
    sheet.addEventListener('touchstart', (e) => {
      if (body.scrollTop > 0) return;
      startY = e.touches[0].clientY; dragging = true; dy = 0;
      sheet.style.transition = 'none';
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      dy = e.touches[0].clientY - startY;
      if (dy > 0) {
        sheet.style.transform = `translateY(${dy}px)`;
        mask.style.opacity = String(Math.max(0, 1 - dy / 400));
      }
    }, { passive: true });
    sheet.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      mask.style.opacity = '';
      if (dy > 110) close();
      else sheet.style.transform = '';
      dy = 0;
    });

    entry.close = close;
    if (opts.onMount) opts.onMount(body, close, entry);
    return entry;
  }

  function closeAllSheets() {
    sheetStack.slice().forEach((s) => s.close && s.close());
  }

  // ------------------------------------------------------------
  // 确认框
  // ------------------------------------------------------------
  function confirm(opts) {
    return new Promise((resolve) => {
      const root = $('#modal-root');
      const mask = el('div', { class: 'modal-mask' });
      const box = el('div', { class: 'modal' });
      // 只为「告知」存在的确认框（没有取消语义）不要摆两个一样的按钮，
      // 否则会出现左右都是「知道了」，用户不知道点哪个才算对。
      const onlyOne = opts.single === true || (opts.cancelText != null && opts.cancelText === opts.okText);
      box.innerHTML = `
        <div class="modal-title">${U.escapeHtml(opts.title || '确认操作')}</div>
        <div class="modal-desc">${opts.desc || ''}</div>
        ${onlyOne ? `
        <div class="modal-btns modal-btns--one">
          <button class="btn ${opts.danger ? 'btn--danger' : 'btn--primary'}" data-act="ok" type="button">${U.escapeHtml(opts.okText || '知道了')}</button>
        </div>` : `
        <div class="modal-btns">
          <button class="btn btn--ghost btn--sm" data-act="cancel" type="button">${U.escapeHtml(opts.cancelText || '取消')}</button>
          <button class="btn ${opts.danger ? 'btn--danger' : 'btn--primary'} btn--sm" data-act="ok" type="button">${U.escapeHtml(opts.okText || '确定')}</button>
        </div>`}
      `;
      mask.appendChild(box);
      root.appendChild(mask);
      requestAnimationFrame(() => mask.classList.add('in'));

      function done(v) {
        mask.classList.remove('in');
        setTimeout(() => { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 260);
        resolve(v);
      }
      mask.addEventListener('click', (e) => { if (e.target === mask) done(false); });
      const cancelBtn = box.querySelector('[data-act="cancel"]');
      if (cancelBtn) cancelBtn.addEventListener('click', () => done(false));
      box.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
    });
  }

  // ------------------------------------------------------------
  // 选择器：通用列表选择
  // ------------------------------------------------------------
  function picker(opts) {
    const items = opts.items || [];
    const sheet = openSheet({
      title: opts.title || '请选择',
      content: `<div class="pick-list"></div>`,
      onMount(body, close) {
        const list = body.querySelector('.pick-list');
        list.innerHTML = items.map((it) => `
          <button class="set-row" data-val="${U.escapeHtml(String(it.value))}" type="button">
            ${it.icon ? `<span class="set-ic">${it.icon}</span>` : ''}
            <span class="set-main"><span class="set-name">${U.escapeHtml(it.label)}</span>
              ${it.desc ? `<span class="set-desc">${U.escapeHtml(it.desc)}</span>` : ''}</span>
            ${String(it.value) === String(opts.value) ? `<span class="set-val">${Icons.svg('check', 18)}</span>` : ''}
          </button>
        `).join('');
        list.querySelectorAll('[data-val]').forEach((b) => {
          b.addEventListener('click', () => {
            close();
            if (opts.onPick) opts.onPick(b.dataset.val);
          });
        });
      },
    });
    return sheet;
  }

  // ------------------------------------------------------------
  // 日期选择器（自绘日历）
  // ------------------------------------------------------------
  function datePicker(opts) {
    // 三种视图：'year' 年份网格 → 'month' 月份网格 → 'day' 日网格
    // 标题上的「年」「月」都可以点，点一下就换一种视图，比翻 12 次月快得多。
    let view = new Date(opts.value || Date.now());
    let selected = U.startOfDay(new Date(opts.value || Date.now()));
    // 起始视图：'year' 从年份网格开始，'month' 从月份网格开始（日历「看哪个月」用），
    // 其余（含缺省）从日网格开始 —— 老的调用方行为不变。
    let mode = opts.mode === 'year' ? 'year' : opts.mode === 'month' ? 'month' : 'day';
    // 两段确认的「待定」值：年份/月份视图里点击只做高亮，
    // 按「确定」才真正切换视图 —— 点年份 → 确定 → 选月份 → 确定 → 选日。
    // 以前点一下年份直接跳走、点月份直接落到某月 1 日的日视图，
    // 「确定」按钮形同虚设，手一抖就选错。
    let pendYear = null, pendMonth = null;
    // 日视图里用户是否已经点中一个日子：没点中之前「确定」是灰的（m02137）。
    // 注意 initial value 可能来自 opts.value，那算「已选」——编辑场景打开就有值。
    let dayPicked = opts.value != null && opts.value !== '';
    // 只选日子还是连几点一起选。「下次见面」这种值得记到分钟的场景传 true
    const withTime = opts.time === true;
    // 时分用两个滚动条选，值直接读到 selected 上（不带日期的那部分）
    const initHm = (() => {
      const t = new Date(opts.value || Date.now());
      return { h: t.getHours(), m: Math.floor(t.getMinutes() / 5) * 5 };
    })();
    const hm = { h: initHm.h, m: initHm.m };
    // 传进来可能是数字时间戳、Date，也可能是 '2026-10-18' 这种 ymd 字符串，
    // 统一先过一遍 U.parseYmd——new Date('2026-10-18') 在部分环境里会解析成 NaN。
    const asTs = (v) => {
      if (v == null || v === '') return null;
      if (typeof v === 'number') return v;
      if (v instanceof Date) return v.getTime();
      const d = U.parseYmd(String(v));
      return d ? d.getTime() : NaN;
    };
    const maxRaw = asTs(opts.max);
    const maxTs = Number.isFinite(maxRaw) ? U.startOfDay(new Date(maxRaw)).getTime() : Date.now() + 86400000;
    // min 一定要有：以前只能给 max，选「下次见面」这种未来日期时
    // 过去的和今天都被画成灰色「选了没用」，但照样能点，自相矛盾。
    const minRaw = asTs(opts.min);
    const minTs = Number.isFinite(minRaw) ? U.startOfDay(new Date(minRaw)).getTime() : -Infinity;
    if (selected.getTime() > maxTs) selected = new Date(maxTs);
    if (selected.getTime() < minTs) selected = new Date(minTs);
    const clampTs = (ts) => Math.min(maxTs, Math.max(minTs, ts));
    // 视野落在「今天」所在的月：选「下次见面」这类未来日期时，
    // 打开就能看见今天和它之后的日子，不用往回翻。
    // 例外：如果传进来的日期在更远的未来（比如攒钱目标的截止日），
    // 就落在那个月 —— 否则用户挑完日子，翻回来看不见自己刚选的。
    const selOk = Number.isFinite(selected.getTime());
    view = new Date(U.startOfDay(new Date(selOk && selected.getTime() > Date.now() ? selected.getTime() : Date.now())).getTime());
    // mode 从 'month'/'year' 进来时视野跟 selected 走 —— 日历「看哪个月」
    // 打开就该停在正在看的那个月，而不是被拉回今天所在的月。
    if (mode !== 'day' && selOk) view = new Date(U.startOfDay(selected).getTime());

    const sheet = openSheet({
      // title:null = 不要弹层头（标题行和右上角叉都不要）——
      // 日历「选年月日」气泡是三视图一体的，没有「确认/取消」两段式。
      title: opts.title !== undefined ? opts.title : '选择日期',
      content: `
        <div class="dp-head">
          <button class="dp-nav" data-nav="-1" type="button" aria-label="上一页">${Icons.svg('chevronLeft', 16)}</button>
          <button class="dp-title" data-part="title" type="button">
            <span class="dp-y" data-part="year"></span>
            <span class="dp-m" data-part="month"></span>
          </button>
          <button class="dp-nav" data-nav="1" type="button" aria-label="下一页">${Icons.svg('chevronRight', 16)}</button>
        </div>
        ${opts.hideTip ? '' : '<div class="dp-tip" data-part="tip"></div>'}
        <div class="dp-body"></div>
        ${withTime ? `
        <div class="dp-time">
          <div class="dp-time-lab">时间</div>
          <div class="dp-time-row">
            <button class="dp-blob" data-part="hm" type="button">
              <span class="dp-blob-txt" data-part="hm-txt">14:00</span>
              <span class="dp-blob-caret">${Icons.svg('chevronDown', 14)}</span>
            </button>
            ${['08:00', '12:00', '18:00', '20:00'].map((s) => `
              <button class="dp-chip" data-quick="${s}" type="button">${s}</button>`).join('')}
          </div>
        </div>` : ''}
        <button class="dp-fab" data-act="ok" type="button">确定</button>
        <style>
          .dp-head { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
          .dp-nav, .dp-title { border:0; background:transparent; font-family:inherit; color:var(--text); }
          .dp-nav { width:32px; height:32px; flex:none; border-radius:11px; display:grid; place-items:center;
            background:var(--bg-2); cursor:pointer; -webkit-tap-highlight-color:transparent; }
          .dp-nav:active { transform:scale(.94); }
          .dp-title { flex:1; min-width:0; display:flex; align-items:center; justify-content:center; gap:6px;
            padding:6px 0; cursor:pointer; -webkit-tap-highlight-color:transparent; }
          .dp-y, .dp-m { padding:5px 12px; border-radius:11px; font-size:14.5px; font-weight:650;
            font-variant-numeric:tabular-nums; transition:background .16s, color .16s; }
          .dp-y.is-on, .dp-m.is-on { background:var(--brand); color:#fff; }
          .dp-tip:empty { display:none; }
          .dp-tip { margin:-4px 0 10px; font-size:11.5px; line-height:1.5; color:var(--text-3); text-align:center; }

          .dp-body { position:relative; }

          .dp-week { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; margin-bottom:4px; }
          .dp-week span { text-align:center; font-size:11px; color:var(--text-3); padding:4px 0; }
          .dp-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
          .dp-day { aspect-ratio:1; border-radius:11px; display:grid; place-items:center;
            font-size:14px; font-variant-numeric:tabular-nums; color:var(--text); cursor:pointer; }
          .dp-day.mute { color:var(--text-3); opacity:.4; }
          .dp-day.today { color:var(--brand); font-weight:700; }
          .dp-day.sel { background:var(--brand-grad); color:#fff; font-weight:650;
            box-shadow:0 4px 12px rgba(79,124,255,.32); }
          /* 不可选的日期：灰掉、划一道斜线、点不动（pointer-events 关掉） */
          .dp-day.off { color:var(--text-3); opacity:.34; cursor:not-allowed;
            pointer-events:none; text-decoration:line-through; }
          .dp-day.future { opacity:.32; }

          .dp-cells { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
          .dp-cell { height:46px; border:1px solid var(--line); border-radius:13px; background:var(--card);
            font-family:inherit; font-size:14px; font-weight:600; color:var(--text);
            display:grid; place-items:center; cursor:pointer; -webkit-tap-highlight-color:transparent;
            font-variant-numeric:tabular-nums; }
          .dp-cell.sel { border-color:transparent; background:var(--brand-grad); color:#fff;
            box-shadow:0 4px 12px rgba(79,124,255,.3); }
          .dp-cell.today { color:var(--brand); }
          .dp-cell.sel.today { color:#fff; }
          .dp-cell.off { color:var(--text-3); opacity:.34; cursor:not-allowed; pointer-events:none; }
          .dp-cell:active { transform:scale(.97); }

          .dp-fab { position:absolute; right:16px; bottom:14px; z-index:3;
            min-width:104px; height:42px; padding:0 24px; border:0; border-radius:21px;
            font-family:inherit; font-size:14.5px; font-weight:650; color:#fff; cursor:pointer;
            background:var(--brand-grad); box-shadow:0 6px 18px rgba(79,124,255,.36);
            -webkit-tap-highlight-color:transparent; }
          .dp-fab:active { transform:scale(.96); }
          .dp-pad { height:58px; }
          /* 时间：一颗气泡显示当前时刻，点开在气泡下方铺开
             小时 / 分钟两组胶囊（不用原生下拉，那玩意在手机上还是老系统的方框） */
          .dp-time { margin:2px 0 14px; }
          .dp-time-lab { font-size:11.5px; font-weight:600; color:var(--text-3); margin:0 2px 7px; }
          .dp-time-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
          .dp-blob { display:inline-flex; align-items:center; gap:2px; flex:none;
            height:36px; padding:0 6px 0 15px; border:0; border-radius:18px;
            background:var(--brand-grad); color:#fff; font-family:inherit; cursor:pointer;
            box-shadow:0 4px 14px rgba(79,124,255,.30);
            -webkit-tap-highlight-color:transparent; transition:transform .14s; }
          .dp-blob:active { transform:scale(.96); }
          .dp-blob-txt { font-size:15px; font-weight:700; font-variant-numeric:tabular-nums;
            letter-spacing:.4px; }
          .dp-blob-caret { display:grid; place-items:center; width:22px; height:22px;
            transition:transform .2s; opacity:.9; }
          .dp-blob.is-open .dp-blob-caret { transform:rotate(180deg); }
          .dp-chip { flex:none; height:32px; padding:0 13px; border:0; border-radius:16px;
            background:var(--bg-2); color:var(--text-2); font-family:inherit;
            font-size:12.5px; font-weight:650; font-variant-numeric:tabular-nums;
            cursor:pointer; -webkit-tap-highlight-color:transparent;
            transition:background .14s, color .14s, transform .14s; }
          .dp-chip:active { transform:scale(.94); }
          .dp-chip.is-on { background:var(--brand-soft, rgba(79,124,255,.14)); color:var(--brand); }
          .dp-picker { margin-top:10px; padding:12px; border-radius:16px; background:var(--bg-2);
            animation:dpPop .18s ease-out; }
          @keyframes dpPop { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:none; } }
          .dp-picker[hidden] { display:none; }
          .dp-picker-lab { font-size:11px; font-weight:600; color:var(--text-3); margin:0 0 8px 1px; }
          .dp-picker-lab + .dp-picker-lab { margin-top:12px; }
          .dp-picker-grid { display:grid; gap:6px; }
          .dp-hgrid { grid-template-columns:repeat(8, 1fr); }
          .dp-mgrid { grid-template-columns:repeat(6, 1fr); }
          .dp-num { height:32px; border:0; border-radius:10px; background:var(--card);
            color:var(--text-2); font-family:inherit; font-size:13.5px; font-weight:650;
            font-variant-numeric:tabular-nums; cursor:pointer;
            -webkit-tap-highlight-color:transparent; transition:background .12s, color .12s; }
          .dp-num:active { transform:scale(.92); }
          .dp-num.is-on { background:var(--brand); color:#fff; box-shadow:0 3px 10px rgba(79,124,255,.30); }
        </style>
      `,
      onMount(body, close) {
        const elY = body.querySelector('[data-part="year"]');
        const elM = body.querySelector('[data-part="month"]');
        const elTip = body.querySelector('[data-part="tip"]');
        const holder = body.querySelector('.dp-body');
        const now = Date.now();
        const todayTs = U.startOfDay(new Date()).getTime();
        const selTs = () => U.startOfDay(selected).getTime();
        const off = (ts) => ts < minTs || ts > maxTs;
        // 探针用：把算出来的边界暴露到面板根节点上，出问题时一眼看出是 Date 解析炸了。
        // 挂 body 上会被外面那层 sheet 一起拿掉，挂 body 里的容器上才活得久。
        const mark = () => {
          body.setAttribute('data-dp-min', minTs === -Infinity ? '' : String(minTs));
          body.setAttribute('data-dp-max', maxTs === Infinity ? '' : String(maxTs));
          body.setAttribute('data-dp-today', String(todayTs));
          body.setAttribute('data-dp-sel', String(selTs()));
          body.setAttribute('data-dp-view', view.getFullYear() + '-' + (view.getMonth() + 1));
        };
        mark();
        // 提示行：告诉用户哪一段可以选，而不是画一堆灰格子让人猜
        // （灰格子本身已经说明了，调用方说不需要就传 hideTip:true）
        if (elTip) {
          const fmt = (t) => {
            const d = new Date(t);
            return (d.getMonth() + 1) + '月' + d.getDate() + '日';
          };
          let tipTxt = '';
          if (Number.isFinite(minTs) && minTs >= todayTs) {
            tipTxt = `只能选今天（${fmt(todayTs)}）以后的日期，最远到 ${fmt(maxTs)}`;
          } else if (Number.isFinite(maxTs) && maxTs <= todayTs) {
            tipTxt = `只能选 ${fmt(maxTs)} 以前的日期`;
          } else {
            tipTxt = '翻到哪个月就选哪一天';
          }
          elTip.textContent = tipTxt;
          elTip.style.display = minTs === -Infinity && maxTs === Infinity ? 'none' : '';
        }

        // 几点几分：一颗气泡显示当前值，点开在下面铺 24 个小时 + 12 个分钟。
        // 以前用的是两个原生 <select>，手机上弹出来还是系统那套老方框，
        // 跟整个 App 的胶囊气泡完全不搭。
        if (withTime) {
          const blob = body.querySelector('[data-part="hm"]');
          const blobTxt = body.querySelector('[data-part="hm-txt"]');
          const row = body.querySelector('.dp-time-row');
          const panel = U.el('div', { class: 'dp-picker', hidden: true });
          const hmTxt = (h, m) => (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
          panel.innerHTML = `
            <div class="dp-picker-lab">几点</div>
            <div class="dp-picker-grid dp-hgrid">
              ${Array.from({ length: 24 }, (_, i) =>
                `<button class="dp-num" data-h="${i}" type="button">${i < 10 ? '0' : ''}${i}</button>`).join('')}
            </div>
            <div class="dp-picker-lab">几分</div>
            <div class="dp-picker-grid dp-mgrid">
              ${Array.from({ length: 12 }, (_, i) => i * 5).map((m) =>
                `<button class="dp-num" data-m="${m}" type="button">${m < 10 ? '0' : ''}${m}</button>`).join('')}
            </div>`;
          row.parentNode.insertBefore(panel, row.nextSibling);

          const sync = () => {
            blobTxt.textContent = hmTxt(hm.h, hm.m);
            body.setAttribute('data-dp-hm', hm.h + ':' + hm.m);
            panel.querySelectorAll('[data-h]').forEach((b) => {
              b.classList.toggle('is-on', Number(b.dataset.h) === hm.h);
            });
            panel.querySelectorAll('[data-m]').forEach((b) => {
              b.classList.toggle('is-on', Number(b.dataset.m) === hm.m);
            });
            row.querySelectorAll('[data-quick]').forEach((b) => {
              b.classList.toggle('is-on', b.dataset.quick === hmTxt(hm.h, hm.m));
            });
          };
          const openPanel = (v) => {
            panel.hidden = !v;
            blob.classList.toggle('is-open', v);
            if (v) {
              // 展开后把选中的格子滚进视野，省得每次都得自己找
              const on = panel.querySelector('.dp-num.is-on');
              if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
            }
          };
          blob.addEventListener('click', () => openPanel(panel.hidden));
          panel.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('button[data-h], button[data-m]');
            if (!b) return;
            if (b.dataset.h != null) hm.h = Number(b.dataset.h);
            if (b.dataset.m != null) hm.m = Number(b.dataset.m);
            sync();
          });
          row.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('[data-quick]');
            if (!b) return;
            const p = String(b.dataset.quick).split(':');
            hm.h = Number(p[0]); hm.m = Number(p[1]);
            sync();
            openPanel(false);
          });
          sync();
        }

        // 某一页（年/月）能不能去：整页都在可选范围外就不给点
        function monthUsable(y, m) {
          const first = new Date(y, m, 1).getTime();
          const last = new Date(y, m + 1, 0).getTime();
          return last >= minTs && first <= maxTs;
        }
        function yearUsable(y) {
          return new Date(y, 11, 31).getTime() >= minTs && new Date(y, 0, 1).getTime() <= maxTs;
        }

        function years() {
          const y = view.getFullYear();
          const base = Math.floor(y / 12) * 12;
          const out = [];
          for (let i = 0; i < 12; i++) out.push(base + i);
          return out;
        }

        function paintHead() {
          const y = view.getFullYear();
          const m = view.getMonth();
          if (mode === 'year') {
            const ys = years();
            elY.textContent = ys[0] + ' – ' + ys[11];
            elM.textContent = '';
            elM.style.display = 'none';
            elY.classList.add('is-on');
          } else if (mode === 'month') {
            elY.textContent = y + '年';
            elM.textContent = '';
            elM.style.display = 'none';
            elY.classList.add('is-on');
          } else {
            elY.style.display = '';
            elM.style.display = '';
            elY.textContent = y + '年';
            elM.textContent = (m + 1) + '月';
            elY.classList.remove('is-on');
            elM.classList.add('is-on');
          }
        }

        function paintYears() {
          const ys = years();
          const cur = view.getFullYear();
          holder.innerHTML = '<div class="dp-cells">' + ys.map((y) => {
            const cls = ['dp-cell'];
            if (y === (pendYear != null ? pendYear : cur)) cls.push('sel');
            if (!yearUsable(y)) cls.push('off');
            return '<button class="' + cls.join(' ') + '" data-year="' + y + '" type="button">' + y + '</button>';
          }).join('') + '</div><div class="dp-pad"></div>';
          holder.querySelectorAll('[data-year]:not(.off)').forEach((n) => {
            n.addEventListener('click', () => {
              // 点年直接进那一年的月份视图（m02137：不要中间那下确认）。
              const y = Number(n.dataset.year);
              view = new Date(y, view.getMonth(), 1);
              pendYear = null; pendMonth = null;
              mode = 'month';
              render();
            });
          });
        }

        function paintMonths() {
          const y = view.getFullYear();
          const curM = view.getMonth();
          const selY = selected.getFullYear(), selM = selected.getMonth();
          const hiM = pendMonth != null ? pendMonth : (pendYear != null || y === selY ? selM : curM);
          let html = '<div class="dp-cells">';
          for (let i = 0; i < 12; i++) {
            const cls = ['dp-cell'];
            if (i === hiM) cls.push('sel');
            if (!monthUsable(y, i)) cls.push('off');
            html += '<button class="' + cls.join(' ') + '" data-month="' + i + '" type="button">' + (i + 1) + ' 月</button>';
          }
          html += '</div><div class="dp-pad"></div>';
          holder.innerHTML = html;
          holder.querySelectorAll('[data-month]:not(.off)').forEach((n) => {
            n.addEventListener('click', () => {
              // 点月直接落到那月的日视图（m02137：不要中间确认）。
              const mm = Number(n.dataset.month);
              view = new Date(view.getFullYear(), mm, 1);
              const dim = new Date(view.getFullYear(), mm + 1, 0).getDate();
              selected = new Date(view.getFullYear(), mm, Math.min(selected.getDate(), dim));
              pendMonth = null;
              mode = 'day';
              render();
            });
          });
        }

        function paintDays() {
          const y = view.getFullYear(), m = view.getMonth();
          const first = new Date(y, m, 1);
          const lead = first.getDay();
          const dim = new Date(y, m + 1, 0).getDate();
          const prevDim = new Date(y, m, 0).getDate();
          const s = selTs();
          let html = '<div class="dp-week">' + U.WEEK_CN.map((w) => '<span>' + w + '</span>').join('') + '</div><div class="dp-grid">';
          for (let i = lead - 1; i >= 0; i--) html += '<div class="dp-day mute">' + (prevDim - i) + '</div>';
          for (let d = 1; d <= dim; d++) {
            const ts = new Date(y, m, d).getTime();
            const cls = ['dp-day'];
            if (ts === s) cls.push('sel');
            else if (ts === todayTs) cls.push('today');
            if (off(ts)) cls.push('off');
            html += '<div class="' + cls.join(' ') + '" data-ts="' + ts + '">' + d + '</div>';
          }
          const tail = (7 - ((lead + dim) % 7)) % 7;
          for (let i = 1; i <= tail; i++) html += '<div class="dp-day mute">' + i + '</div>';
          html += '</div><div class="dp-pad"></div>';
          holder.innerHTML = html;
          holder.querySelectorAll('[data-ts]:not(.off)').forEach((n) => {
            n.addEventListener('click', () => {
              selected = new Date(Number(n.dataset.ts));
              dayPicked = true;
              render();
            });
          });
        }

        function render() {
          paintHead();
          if (mode === 'year') paintYears();
          else if (mode === 'month') paintMonths();
          else paintDays();
          // 用户定稿：只有日视图才有关「确定」可按，而且点中一个日子之前
          // 是灰的；年/月视图压根不显示这个键（点格子直接进下一层）。
          if (okBtn) {
            const hasDay = mode === 'day';
            okBtn.hidden = !hasDay;
            okBtn.disabled = hasDay && !dayPicked;
          }
          // 用户反馈（m02263）：
          //  - 年份视图：12 个年份一页放不下 → 左右箭头当「翻页」用（±12 年）
          //  - 月份视图：12 个月一页全放得下 → 箭头没有意义，藏掉
          //  - 日视图：弹层底下日历板自己有大号 ‹ ›，小箭头重复，藏掉
          //  退出只靠右上角的叉（title:null 时靠点遮罩/再点一次标题收起）。
          body.querySelectorAll('.dp-nav').forEach((b) => {
            b.style.visibility = mode === 'year' ? '' : 'hidden';
          });
        }

        body.querySelectorAll('[data-nav]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const d = Number(btn.dataset.nav);
            const next = new Date(view.getFullYear() + d * 12, view.getMonth(), 1);
            // 翻到完全没有可选日期的年份页，直接不响应，免得翻进死胡同
            const ys = years();
            if (!ys.some((y) => yearUsable(y))) return;
            // 翻页意味着用户在重新挑，清掉待定年/月
            pendYear = null; pendMonth = null;
            view = next;
            render();
          });
        });

        // 标题：点「年」进年份网格，点整块标题在 年/月 视图之间来回切
        // 注意：年份视图下点整块标题要回到月份视图——否则停在年份网格里
        // 再点一下没有任何反应，看着像按钮坏了。
        elY.addEventListener('click', (e) => {
          e.stopPropagation();
          pendYear = null; pendMonth = null;
          mode = mode === 'year' ? 'month' : 'year';
          render();
        });
        elM.addEventListener('click', (e) => {
          e.stopPropagation();
          pendMonth = null;
          mode = 'month';
          render();
        });
        body.querySelector('[data-part="title"]').addEventListener('click', () => {
          pendYear = null; pendMonth = null;
          if (mode === 'year') mode = 'month';
          else if (mode === 'month') mode = 'year';
          else mode = 'month';
          render();
        });

        // 左箭头就是翻页（上面的 data-nav 处理器统一管），
        // 不再兼任「返回上一层」——用户 m02353：选年份界面的左箭头还是返回，是 bug。
        // 退出只靠右上角的 ×。

        const okBtn = body.querySelector('[data-act="ok"]');
        okBtn.addEventListener('click', () => {
          // 用户定稿（m02137）：点完年直接选月、点完月直接选日，
          // 不再需要中间那下「确定」；只有日视图才有关「确定」可按，
          // 而且得先点中一个日子，确定键才解灰。
          if (mode === 'year') {
            if (pendYear == null) pendYear = view.getFullYear();
            view = new Date(pendYear, view.getMonth(), 1);
            pendYear = null; pendMonth = null;
            mode = 'month';
            render();
            return;
          }
          if (mode === 'month') {
            if (pendMonth == null) pendMonth = selected.getMonth();
            view = new Date(view.getFullYear(), pendMonth, 1);
            pendMonth = null;
            const dim = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
            selected = new Date(view.getFullYear(), view.getMonth(), Math.min(selected.getDate(), dim));
            mode = 'day';
            render();
            return;
          }
          close();
          const dayTs = clampTs(selected.getTime());
          // 带时分的，把 h:m 叠到那天的 0 点上；不带的仍返回当天 0 点，行为不变
          const outTs = withTime ? dayTs + hm.h * 3600000 + hm.m * 60000 : dayTs;
          if (opts.onPick) opts.onPick(outTs);
        });

        render();
      },
    });
    return sheet;
  }

  // ------------------------------------------------------------
  // 分类选择（九宫格）
  // ------------------------------------------------------------
  function catPicker(opts) {
    const kind = opts.kind === 'income' ? 'income' : 'expense';
    const list = Icons.CATEGORIES.filter((c) => c.kind === kind);
    const sheet = openSheet({
      title: opts.title || (kind === 'income' ? '选择收入分类' : '选择支出分类'),
      content: `<div class="cp-grid"></div>`,
      onMount(body, close) {
        const grid = body.querySelector('.cp-grid');
        grid.innerHTML = list.map((c) => `
          <button class="cp-item ${c.id === opts.value ? 'on' : ''}" data-id="${c.id}" type="button">
            <span class="cp-bubble" style="background:${c.color}1F;color:${c.color}">${Icons.catIcon ? Icons.catIcon(c) : c.icon}</span>
            <span class="cp-name">${c.name}</span>
          </button>
        `).join('') + `
          <style>
            .cp-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px 6px; }
            .cp-item { display:flex; flex-direction:column; align-items:center; gap:6px; padding:6px 0; border-radius:13px; }
            .cp-item.on { background:var(--brand-soft); }
            .cp-bubble { width:48px; height:48px; border-radius:16px; display:grid; place-items:center; font-size:22px; }
            .cp-name { font-size:11.5px; color:var(--text-2); }
            .cp-item.on .cp-name { color:var(--brand); font-weight:600; }
          </style>`;
        grid.querySelectorAll('[data-id]').forEach((b) => {
          b.addEventListener('click', () => {
            close();
            if (opts.onPick) opts.onPick(b.dataset.id);
          });
        });
      },
    });
    return sheet;
  }

  // ------------------------------------------------------------
  // 账本选择
  // ------------------------------------------------------------
  function bookPicker(opts) {
    const o = opts || {};
    const list = Store.books();
    const active = Store.activeBookId();
    const sheet = openSheet({
      title: o.title || '切换账本',
      content: `
        <div class="bk-list">
          ${list.map((b) => `
            <button class="bk-item ${b.id === active ? 'on' : ''}" data-id="${b.id}" type="button">
              <span class="bk-ic" style="background:${b.color}1F">${b.icon}</span>
              <span class="bk-main">
                <span class="bk-name">${U.escapeHtml(b.name)}</span>
                <span class="bk-sub">${Store.state.tx.filter((t) => t.bookId === b.id).length} 笔账目</span>
              </span>
              <span class="bk-check">${b.id === active ? Icons.svg('check', 15) : ''}</span>
            </button>`).join('')}
        </div>
        <button class="btn btn--ghost" style="margin-top:14px" data-act="manage" type="button">管理账本</button>
        <style>
          .bk-list { display:flex; flex-direction:column; gap:9px; }
          .bk-item { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:16px;
            background:var(--card-2); border:1px solid var(--line); text-align:left; }
          .bk-item.on { border-color:var(--brand); background:var(--brand-soft); }
          .bk-ic { width:40px; height:40px; border-radius:13px; display:grid; place-items:center; font-size:20px; flex:none; }
          .bk-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
          .bk-name { font-size:14px; font-weight:600; }
          .bk-sub { font-size:11px; color:var(--text-3); }
          .bk-check { color:var(--brand); flex:none; display:grid; place-items:center; width:20px; }
        </style>
      `,
      onMount(body, close) {
        body.querySelectorAll('[data-id]').forEach((b) => {
          b.addEventListener('click', () => {
            Store.switchBook(b.dataset.id);
            close();
            if (o.onPick) o.onPick(b.dataset.id);
          });
        });
        body.querySelector('[data-act="manage"]').addEventListener('click', () => {
          close();
          if (global.ViewSettings && global.ViewSettings.openBooksSheet) global.ViewSettings.openBooksSheet();
        });
      },
    });
    return sheet;
  }

  // ------------------------------------------------------------
  // 键盘 ESC / 安卓返回
  // ------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sheetStack.length) {
        sheetStack[sheetStack.length - 1].close();
      }
    }
  });

  global.UI = { openSheet, closeAllSheets, confirm, picker, datePicker, catPicker, bookPicker, focusKeyboard };
})(window);
