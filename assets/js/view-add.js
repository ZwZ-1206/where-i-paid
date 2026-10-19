/* ============================================================
 * 花哪儿了 · 记一笔
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;
  const $ = U.$;

  const draft = {
    type: 'expense',
    amountText: '',
    catId: 'food',
    sub: '',
    accountId: 'alipay',
    note: '',
    ts: Date.now(),
    editingId: null,
    advanceWho: '',      // 垫付给谁（可空，提交时空则落「待填写」）
    advanceDue: 0,       // 催款日期
    _advOn: false,       // 「帮别人垫的」开关状态（m02510：不再用 advanceWho 当开关）
  };

  // 计算器状态：{ base: 分, op: '+' | '-', waiting: bool }
  let calc = null;
  let lastUsed = {}; // { type: { catId, accountId } }
  // 数字键盘默认收起：把屏幕让给分类和最近记录，点金额才弹出来
  let dockOpen = false;

  function resetDraft(keep) {
    const last = lastUsed[draft.type] || {};
    draft.amountText = '';
    draft.note = '';
    draft.editingId = null;
    draft.ts = Date.now();
    draft.advanceWho = '';
    draft.advanceDue = 0;
    draft._advOn = false;
    calc = null;
    if (!keep) {
      draft.sub = '';
      if (last.catId && Icons.cat(last.catId).kind === draft.type) draft.catId = last.catId;
      else draft.catId = draft.type === 'income' ? 'salary' : 'food';
      if (last.accountId) draft.accountId = last.accountId;
    }
  }

  /** 垫付的强制分类：开着「帮别人垫的」就必须是「垫付」，关掉再切回原分类。
   *  之前只在草稿上挂 advanceWho、分类还停留在上次用的（餐饮/医疗…），
   *  流水里这笔账看不出是垫付 —— 现在开关一拨分类跟着走。 */
  const ADVANCE_CAT = 'advance';
  function applyAdvanceCat(on) {
    if (on) {
      draft._catBeforeAdv = draft.catId;
      draft.catId = ADVANCE_CAT;
      draft.sub = '';
    } else {
      const back = draft._catBeforeAdv;
      if (back && Icons.cat(back).kind === 'expense') draft.catId = back;
      else draft.catId = draft.type === 'income' ? draft.catId : 'other_out';
      draft._catBeforeAdv = '';
    }
  }

  function amountValue() {
    return U.amountToCents(draft.amountText);
  }

  // ------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------
  /** 垫付开关 + 谁 + 催款日 */
  function renderAdvance() {
    const on = !!draft._advOn;
    if (!on) return '';
    const dueTxt = draft.advanceDue ? U.humanDate(draft.advanceDue) : '不设催款日';
    return `
      <div class="adv-box">
        <div class="adv-box-head">
          <span class="adv-ic">💸</span>
          <span class="adv-box-title">垫付，等收回</span>
          <button class="adv-clear" data-act="advance-clear" type="button" aria-label="取消垫付">${Icons.svg('close', 14)}</button>
        </div>
        <div class="adv-box-row">
          <input class="adv-who" id="adv-who" type="text" maxlength="20" placeholder="谁欠你的（如 老王）"
            enterkeyhint="done" autocomplete="off"
            value="${U.escapeHtml(draft.advanceWho)}" />
          <button class="adv-due" data-act="advance-due" type="button">
            ${Icons.svg('bell', 13)}<span>${U.escapeHtml(dueTxt)}</span>
          </button>
        </div>
        <div class="adv-box-hint">未收回的垫付不计入支出和预算，收回后才算真花掉</div>
      </div>`;
  }

  /** 两个紧凑小入口：帮别人垫 / 想买先放清单 */
  function renderMiniActions() {
    const advOn = !!draft._advOn;
    const wishOn = (S.settings.wish || {}).enabled !== false;
    if (!wishOn) {
      // 关掉「想买清单」后只留垫付入口，避免一个孤零零的半宽按钮
      return `<div class="mini-actions mini-actions--solo">
        <button class="mini-btn ${advOn ? 'on' : ''}" data-act="advance-toggle" type="button">
          <span class="mini-ic">💸</span><span class="mini-txt">帮别人垫的</span>
        </button>
      </div>`;
    }
    let pendingWish = 0;
    try { pendingWish = S.wishReady().length + S.wishCooling().length; } catch (e) { pendingWish = 0; }
    return `
      <div class="mini-actions">
        <button class="mini-btn ${advOn ? 'on' : ''}" data-act="advance-toggle" type="button">
          <span class="mini-ic">💸</span><span class="mini-txt">帮别人垫的</span>
        </button>
        <button class="mini-btn mini-btn--wish" data-act="wish" type="button"
          title="想买的东西先放清单，冷静 48 小时后再决定${pendingWish ? '（清单里有 ' + pendingWish + ' 件）' : ''}">
          <span class="mini-ic">🛍️</span><span class="mini-txt">想买？先放着</span>
          ${pendingWish ? `<i class="mini-count">${pendingWish}</i>` : ''}
        </button>
      </div>`;
  }

  /** 记账页顶部：有没收回来的垫付就提醒一下，免得忘 */
  function renderAdvanceBanner() {
    let adv;
    try { adv = S.advanceSummary(); } catch (e) { return ''; }
    if (!adv.openCount) return '';
    const ov = adv.overdue.length;
    const asking = (adv.asking || []).length;
    const who = [];
    try {
      S.advances().forEach((t) => {
        const n = t.advance.who || '有人';
        if (who.indexOf(n) < 0) who.push(n);
      });
    } catch (e) { /* 忽略 */ }
    const names = who.slice(0, 3).join('、') + (who.length > 3 ? ' 等' : '');
    let title;
    if (ov) title = `${ov} 笔垫付到期了，该问问 ${names}`;
    else if (asking) title = `${names} 的钱还回来了吗？`;
    else title = `待收回 ${U.money(adv.openAmount)} · ${adv.openCount} 笔`;
    const sub = ov
      ? `共 ${adv.openCount} 笔 ${U.money(adv.openAmount)}，钱回来了就整笔抹掉`
      : `${names} 还没给你 · 到还款日会提醒你`;
    return `
      <button class="adv-banner ${ov ? 'overdue' : ''}" data-act="adv-banner" type="button">
        <span class="ab-ic">💸</span>
        <span class="ab-main">
          <span class="ab-title">${U.escapeHtml(title)}</span>
          <span class="ab-sub">${U.escapeHtml(sub)}</span>
        </span>
        <span class="ab-go">去收 ${Icons.svg('chevronRight', 12)}</span>
      </button>`;
  }

  function renderBookBar() {
    if (!S.books) return '';
    const b = S.activeBook();
    if (!b) return '';
    const multi = S.books().length > 1;
    const all = S.isAllBooks && S.isAllBooks();
    return `
      <div class="book-bar">
        <button class="book-pill ${all ? 'book-pill--all' : ''}" data-act="book" type="button" aria-label="切换账本">
          <span class="book-pill-ic" style="background:${b.color}22">${b.icon}</span>
          <span class="book-pill-name">${U.escapeHtml(b.name)}</span>
          ${Icons.svg('chevronDown', 12)}
        </button>
        <span class="book-spacer"></span>
        <button class="book-pill ${multi ? '' : 'book-pill--new'}" data-act="book-add" type="button" aria-label="新建账本">
          ${Icons.svg('plus', 13)}<span class="book-pill-name">新账本</span>
        </button>
      </div>`;
  }

  /**
   * 今日额度条：今天还能花多少 / 记下这笔后剩多少
   * 只在支出模式且有预算时出现
   */
  function renderQuota(kind, amt) {
    if (kind !== 'expense') return '';
    let q;
    try { q = S.todayQuota(); } catch (e) { return ''; }
    if (!q.total) return '';
    const cur = S.bookCurrency ? S.bookCurrency() : null;
    const show = (cents) => cur ? S.moneyIn(S.toLocalCents(cents), cur.code) : U.money(cents);
    const left = q.left;
    const after = left - amt;
    const level = amt > 0 ? (after < 0 ? 'over' : (after < q.quota * 0.25 ? 'warn' : 'safe')) : q.level;
    let line1, line2 = '';
    if (amt > 0) {
      line1 = after >= 0 ? `记下后今天还剩 ${show(after)}` : `记下就超了 ${show(-after)}`;
      line2 = `额度 ${show(q.quota)}`;
    } else {
      line1 = left >= 0 ? `今天还能花 ${show(left)}` : `今天已超 ${show(-left)}`;
      line2 = `额度 ${show(q.quota)}`;
    }
    const tipCls = level === 'over' ? 'over' : level === 'warn' ? 'warn' : '';
    return `
      <div class="quota-bar ${tipCls}" data-quota="${level}">
        <span class="quota-ic">${level === 'over' ? '🚨' : level === 'warn' ? '⚠️' : '👛'}</span>
        <span class="quota-main">
          <span class="quota-line1">${U.escapeHtml(line1)}</span>
          <span class="quota-line2">${U.escapeHtml(line2)}</span>
        </span>
      </div>`;
  }

  /** 上次多少钱：同分类（+二级标签）的最近价格 */
  function renderLastPrice() {
    if (draft.type !== 'expense') return '';
    let last;
    try { last = S.lastPrice(draft.catId, draft.sub); } catch (e) { return ''; }
    if (!last) return '';
    const days = Math.round((U.startOfDay(new Date()).getTime() - U.startOfDay(new Date(last.ts)).getTime()) / 86400000);
    const when = days <= 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`;
    const cur = S.bookCurrency ? S.bookCurrency() : null;
    const amtTxt = cur ? S.moneyIn(S.toLocalCents(last.amount), cur.code) : U.money(last.amount);
    return `<button class="last-price" data-act="use-last" data-amount="${last.amount}" type="button"
      title="上次 ${when}${last.note ? ' · ' + U.escapeHtml(last.note) : ''}">
      <span class="lp-ic">↺</span>
      <span class="lp-txt">上次 <b>${amtTxt}</b></span>
      <span class="lp-fill">填入</span>
    </button>`;
  }

  function render(root) {
    const kind = draft.type;
    const cats = Icons.CATEGORIES.filter((c) => c.kind === kind);
    if (!cats.some((c) => c.id === draft.catId)) draft.catId = cats[0].id;
    const catMeta = Icons.cat(draft.catId);
    const subs = catMeta.subs || [];
    const acct = S.state.accounts.find((a) => a.id === draft.accountId) || S.state.accounts[0];

    const amt = amountValue();
    const amtText = draft.amountText === '' ? '0.00' : draft.amountText;

    // 外币账本：显示本地货币，入库转人民币
    const curInfo = S.bookCurrency ? S.bookCurrency() : null;
    const curSym = curInfo ? curInfo.symbol : '¥';
    const cnyAmt = curInfo ? S.toCnyCents(amt) : amt;
    const wishCfg = (S.settings && S.settings.wish) || {};
    draft.wishHours = Math.max(1, Number(wishCfg.hours) || 48);

    const todayStr = U.humanDate(draft.ts);
    const recent = S.state.tx.slice().sort((a, b) => b.ts - a.ts).slice(0, 4);
    const calcHint = calc ? `${U.money(calc.base)} ${calc.op} …` : '';

    root.innerHTML = `
      <div class="add-scroll">
        ${renderAdvanceBanner()}
        ${renderBookBar()}
        ${global.Tips ? (global.Tips.renderCard() || global.Tips.renderSlim()) : ''}

        <div class="type-row">
          <div class="type-switch">
            <button data-type="expense" class="${kind === 'expense' ? 'on' : ''}" type="button">支出</button>
            <button data-type="income" class="${kind === 'income' ? 'on' : ''}" type="button">收入</button>
          </div>
        </div>

        <div class="import-row">
          <button class="scan-bubble ${kind === 'income' ? 'scan-bubble--in' : ''}" data-act="scan" type="button"
            aria-label="识图导入${kind === 'income' ? '收入' : '支出'}">
            <span class="scan-bubble-ic">${Icons.svg('camera', 14)}</span>
            <span class="scan-bubble-txt">识图导入</span>
          </button>
          <button class="scan-bubble scan-bubble--bill" data-act="bill" type="button" aria-label="导入账单">
            <span class="scan-bubble-ic">${Icons.svg('upload', 14)}</span>
            <span class="scan-bubble-txt">导入账单</span>
          </button>
        </div>

        <button class="amount-display" data-act="toggle-dock" type="button" aria-label="输入金额">
          <span class="amount-cur">${U.escapeHtml(curSym)}</span>
          <span class="amount-val ${kind === 'income' ? 'income' : ''} ${draft.amountText === '' ? 'placeholder' : ''}">
            ${U.escapeHtml(amtText)}<span class="cursor"></span>
          </span>
        </button>
        <div class="calc-hint ${calcHint ? 'on' : ''}">${calcHint ? U.escapeHtml(calcHint) : '　'}</div>
        ${curInfo ? `<div class="fx-hint">≈ ${U.money(cnyAmt)} <span class="fx-rate">${U.escapeHtml(curInfo.code)} × ${curInfo.rate}</span></div>` : ''}

        <div class="cat-strip">
          ${cats.map((c) => `
            <button class="cat-item ${c.id === draft.catId ? 'on' : ''}" data-cat="${c.id}" type="button">
              <span class="cat-bubble" style="${c.id === draft.catId ? '' : `background:${c.color}14;`}">${Icons.catIcon ? Icons.catIcon(c) : c.icon}</span>
              <span class="cat-name">${c.name}</span>
            </button>
          `).join('')}
        </div>

        ${subs.length ? `<div class="sub-row">
          ${subs.map((s) => `<button class="chip ${draft.sub === s ? 'on' : ''}" data-sub="${U.escapeHtml(s)}" type="button">${U.escapeHtml(s)}</button>`).join('')}
        </div>` : '<div style="height:8px"></div>'}

        <div class="meta-row">
          <button class="meta-btn" data-act="date" type="button">
            ${Icons.svg('calendar', 15)}<span>${todayStr}</span>
          </button>
          <button class="meta-btn" data-act="account" type="button">
            <span style="font-size:14px">${acct.icon}</span><span>${U.escapeHtml(acct.name)}</span>
          </button>
          <input class="note-input" id="note-input" type="text" maxlength="60" enterkeyhint="done"
            autocomplete="off" placeholder="备注…" value="${U.escapeHtml(draft.note)}" />
        </div>

        ${kind === 'expense' ? renderMiniActions() : ''}
        ${kind === 'expense' ? renderAdvance() : ''}

        <div class="recent-block">
          ${recent.length ? `
            <div class="recent-head"><span>最近记录 · 点一下快速再记</span><button class="card-more" data-act="go-detail" type="button">全部 ${Icons.svg('chevronRight', 12)}</button></div>
            <div class="recent-list">
              ${recent.map((t) => {
                const c = Icons.cat(t.catId);
                return `<button class="recent-item" data-reuse="${t.id}" type="button">
                  <span class="recent-ic" style="background:${c.color}1A">${Icons.catIcon ? Icons.catIcon(c) : c.icon}</span>
                  <span class="recent-name">${c.name}${t.sub ? ' · ' + U.escapeHtml(t.sub) : ''}</span>
                  <span class="recent-amt">${t.type === 'income' ? '+' : '-'}${U.money(t.amount, { symbol: false, decimals: 0 })}</span>
                </button>`;
              }).join('')}
            </div>` : ''}
        </div>
      </div>

      <div class="input-dock ${dockOpen ? '' : 'is-closed'}" id="input-dock">
        <button class="dock-grip" data-act="close-dock" type="button" aria-label="收起键盘"><span></span></button>
        <div class="status-strip">
          ${renderQuota(kind, amt)}
          ${renderLastPrice()}
        </div>

        <div class="keypad">
        ${['1', '2', '3'].map((k) => `<button class="key" data-key="${k}" type="button">${k}</button>`).join('')}
        <button class="key key--fn key--del" data-key="del" type="button" aria-label="退格">${Icons.svg('backspace', 22)}</button>
        ${['4', '5', '6'].map((k) => `<button class="key" data-key="${k}" type="button">${k}</button>`).join('')}
        <button class="key key--fn" data-key="+" type="button">+</button>
        ${['7', '8', '9'].map((k) => `<button class="key" data-key="${k}" type="button">${k}</button>`).join('')}
        <button class="key key--fn" data-key="-" type="button">−</button>
        <button class="key key--fn" data-key="." type="button">.</button>
        <button class="key" data-key="0" type="button">0</button>
        <button class="key key--fn" data-key="00" type="button">00</button>
          <button class="key key--ok ${amt > 0 ? '' : 'disabled'}" data-key="ok" type="button">
            ${draft.editingId ? '保存' : '完成'}
          </button>
        </div>
      </div>

      <button class="dock-open ${dockOpen ? 'is-hidden' : ''}" data-act="toggle-dock" type="button">
        <span class="dock-open-amt ${draft.amountText === '' ? 'is-empty' : ''}">${draft.amountText === '' ? '输入金额' : U.money(amt)}</span>
        <span class="dock-open-txt">${draft.amountText === '' ? '点这里开始记' : '继续输入'}</span>
      </button>
    `;

    bind(root);

    // 键盘立着的时候，保证金额那一行在可视区里（弹出后内容区变矮，容易把它顶出去）
    if (dockOpen) {
      setTimeout(() => {
        const sc = root.querySelector('.add-scroll');
        const ad = root.querySelector('.amount-display');
        if (!sc || !ad) return;
        const top = ad.offsetTop;
        const bottom = top + ad.offsetHeight;
        const viewTop = sc.scrollTop;
        const viewBottom = viewTop + sc.clientHeight;
        if (top < viewTop || bottom > viewBottom) {
          sc.scrollTop = Math.max(0, bottom - sc.clientHeight + 16);
        }
      }, 40);
    }
  }

  // ------------------------------------------------------------
  // 事件
  // ------------------------------------------------------------
  function bind(root) {
    root.querySelectorAll('[data-type]').forEach((b) => {
      b.addEventListener('click', () => {
        if (draft.type === b.dataset.type) return;
        draft.type = b.dataset.type;
        draft.sub = '';
        const cats = Icons.CATEGORIES.filter((c) => c.kind === draft.type);
        draft.catId = cats[0].id;
        calc = null;
        U.vibrate(6);
        render(root);
      });
    });

    root.querySelectorAll('[data-cat]').forEach((b) => {
      b.addEventListener('click', () => {
        // 开着垫付时点别的分类 = 用户想记普通支出，先把垫付关掉（谁/催款日一并清）
        if (draft._advOn && b.dataset.cat !== ADVANCE_CAT) {
          draft._advOn = false;
          draft.advanceWho = '';
          draft.advanceDue = 0;
          draft._catBeforeAdv = '';
        }
        draft.catId = b.dataset.cat;
        draft.sub = '';
        U.vibrate(6);
        render(root);
      });
    });

    root.querySelectorAll('[data-sub]').forEach((b) => {
      b.addEventListener('click', () => {
        draft.sub = draft.sub === b.dataset.sub ? '' : b.dataset.sub;
        U.vibrate(6);
        render(root);
      });
    });

    root.querySelectorAll('[data-reuse]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = S.txById(b.dataset.reuse);
        if (!t) return;
        draft.type = t.type;
        draft.catId = t.catId;
        draft.sub = t.sub || '';
        draft.accountId = t.accountId;
        draft.amountText = (t.amount / 100).toFixed(2).replace(/\.00$/, '');
        calc = null;
        U.vibrate(8);
        render(root);
        U.toast('已填入该笔金额，可直接完成', 'success');
      });
    });

    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'date') {
          UI.datePicker({
            value: draft.ts,
            onPick(ts) {
              const old = new Date(draft.ts);
              const now = new Date(ts);
              now.setHours(old.getHours(), old.getMinutes(), 0, 0);
              draft.ts = now.getTime();
              render(root);
            },
          });
        } else if (act === 'account') {
          UI.picker({
            title: '选择账户',
            value: draft.accountId,
            items: S.state.accounts.map((a) => ({ value: a.id, label: a.name, icon: a.icon })),
            onPick(v) {
              draft.accountId = v;
              render(root);
            },
          });
        } else if (act === 'go-detail') {
          App.go('detail');
        } else if (act === 'scan') {
          if (global.Scan) global.Scan.open();
          else U.toast('识图模块未加载', 'error');
        } else if (act === 'bill') {
          if (global.Bills) global.Bills.open();
          else U.toast('账单模块未加载', 'error');
        } else if (act === 'book') {
          UI.bookPicker({ onPick() { render(root); App.refreshTopbar(); } });
        } else if (act === 'book-add') {
          if (global.ViewSettings && global.ViewSettings.openBookEdit) {
            global.ViewSettings.openBookEdit(null, () => { render(root); App.refreshTopbar(); });
          }
        } else if (act === 'use-last') {
          const cents = Number(b.dataset.amount) || 0;
          if (!cents) return;
          const local = S.bookCurrency ? S.toLocalCents(cents) : cents;
          draft.amountText = (local / 100).toFixed(2).replace(/\.00$/, '');
          calc = null;
          U.vibrate(8);
          updateDisplay(root);
          U.toast('已填入上次的金额', 'success');
        } else if (act === 'advance-toggle') {
          // m02510：不再往输入框里塞「待填写」占位 —— 开关状态用 _advOn 记，
          // 输入框保持空白，只有灰色背景提示词「谁欠你的（如 老王）」。
          const turningOn = !draft._advOn;
          draft._advOn = turningOn;
          draft.advanceWho = '';
          if (draft.type === 'expense') applyAdvanceCat(turningOn);
          U.vibrate(6);
          // m02799：这一下必须落在同一个用户手势里 —— 手机键盘只在
          // 「用户手势的同一趟任务」里才会被唤出来。render 会重建 DOM，
          // 所以先拿新节点、再同步 focus，中间不做任何 setTimer；
          // 也不 select()：iOS 上 select 会弹出文本选择条，反而挡住键盘。
          // focusKeyboard 内部还会在 250/650ms 补两次焦，防止 render 后的
          // 重排把刚拿到的焦点弄丢。
          render(root);
          const inp = root.querySelector('#adv-who');
          if (inp && turningOn) UI.focusKeyboard(inp);
        } else if (act === 'advance-clear') {
          draft._advOn = false;
          draft.advanceWho = '';
          draft.advanceDue = 0;
          if (draft.catId === ADVANCE_CAT) applyAdvanceCat(false);
          render(root);
        } else if (act === 'advance-due') {
          UI.datePicker({
            title: '哪天该催一下',
            value: draft.advanceDue || (Date.now() + 7 * 86400000),
            onPick(ts) { draft.advanceDue = ts; render(root); },
          });
        } else if (act === 'toggle-dock') {
        dockOpen = !dockOpen;
        render(root);
        if (dockOpen) {
          // 弹出键盘后把金额滚进可视区
          const sc = root.querySelector('.add-scroll');
          const ad = root.querySelector('.amount-display');
          if (sc && ad) setTimeout(() => { try { ad.scrollIntoView({ block: 'center' }); } catch (e) { /* 忽略 */ } }, 60);
        }
      } else if (act === 'close-dock') {
        if (!dockOpen) return;
        dockOpen = false;
        render(root);
      } else if (act === 'adv-banner') {
        if (global.ViewSettings && global.ViewSettings.openAdvancesSheet) global.ViewSettings.openAdvancesSheet();
        else App.go('detail');
      } else if (act === 'wish') {
          addToWishlist(root);
        }
      });
    });

    const note = root.querySelector('#note-input');
    if (note) {
      note.addEventListener('input', () => { draft.note = note.value; });
    }

    const who = root.querySelector('#adv-who');
    if (who) {
      who.addEventListener('input', () => { draft.advanceWho = who.value; });
      who.addEventListener('blur', () => {
        // 空着不再关掉垫付（m02510）：名字可以回头再补，开关用 _advOn 记。
        draft.advanceWho = who.value;
      });
    }

    // m02799：系统键盘弹起来时，把正在输入的框滚进可视区。
    // 手机键盘会盖住半个屏，备注框在页面中部，不滚一下就被键盘挡住。
    // 键盘收起时也滚回顶部，免得页面停在半空中。
    const sc = root.querySelector('.add-scroll');
    if (sc) {
      const keepVisible = (el) => {
        if (!el) return;
        setTimeout(() => {
          try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 忽略 */ }
        }, 80);
      };
      note && note.addEventListener('focus', () => keepVisible(note));
      who && who.addEventListener('focus', () => keepVisible(who));
      note && note.addEventListener('blur', () => {
        setTimeout(() => { try { sc.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { /* 忽略 */ } }, 120);
      });
      who && who.addEventListener('blur', () => {
        setTimeout(() => { try { sc.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { /* 忽略 */ } }, 120);
      });
    }

    root.querySelectorAll('[data-key]').forEach((b) => {
      b.addEventListener('click', () => onKey(b.dataset.key, root));
    });

    if (global.Tips) global.Tips.bind(root);
  }

  // ------------------------------------------------------------
  // 先别买：把当前这笔放进愿望清单
  // ------------------------------------------------------------
  function addToWishlist(root) {
    const amt = amountValue();
    if (!amt) { U.toast('先输入金额，再放进清单', 'error'); return; }
    const catMeta = Icons.cat(draft.catId);
    const curInfo = S.bookCurrency ? S.bookCurrency() : null;
    const cny = curInfo ? S.toCnyCents(amt) : amt;
    let name = draft.note.trim();
    if (!name) name = catMeta.name + (draft.sub ? ' · ' + draft.sub : '');
    try {
      S.addWish({ name, amount: cny, catId: draft.catId, note: draft.note.trim() });
      const hours = Math.max(1, Number((S.settings.wish || {}).hours) || 48);
      U.toast(`已放进想买清单，${hours} 小时后再决定 · 可在 设置 → 想买清单 查看`, 'success');
      resetDraft(false);
      dockOpen = false;
      render(root);
      if (global.App) App.refreshTopbar();
    } catch (e) {
      U.toast(e.message || '加入清单失败', 'error');
    }
  }

  function hasTwoDecimals(t) {
    const i = t.indexOf('.');
    return i >= 0 && t.length - i - 1 >= 2;
  }

  function onKey(k, root) {
    U.vibrate(5);

    if (k === 'ok') { commit(root); return; }

    if (k === 'del') {
      if (calc && calc.waiting) {
        calc = null;
        draft.amountText = (calc0 / 100).toFixed(2).replace(/\.00$/, '');
      } else {
        draft.amountText = draft.amountText.slice(0, -1);
      }
      updateDisplay(root);
      return;
    }

    if (k === '+' || k === '-') { applyOperator(k, root); return; }

    // 数字输入
    if (calc && calc.waiting) { draft.amountText = ''; calc.waiting = false; }

    if (k === '.') {
      if (draft.amountText.indexOf('.') >= 0) return;
      draft.amountText = (draft.amountText === '' ? '0' : draft.amountText) + '.';
    } else if (k === '00') {
      if (!draft.amountText || draft.amountText === '0') return;
      if (hasTwoDecimals(draft.amountText)) return;
      draft.amountText += '00';
    } else {
      if (hasTwoDecimals(draft.amountText)) return;
      if (draft.amountText === '0') draft.amountText = k;
      else if (draft.amountText.replace('.', '').length >= 9) return;
      else draft.amountText += k;
    }
    updateDisplay(root);
  }

  let calc0 = 0;

  function applyOperator(op, root) {
    const cur = amountValue();

    if (!calc) {
      if (!cur) { U.toast('请先输入金额', 'error'); return; }
      calc0 = cur;
      calc = { base: cur, op, waiting: true };
      updateDisplay(root);
      U.toast(op === '+' ? '再输入要加上的金额' : '再输入要减去的金额');
      return;
    }

    if (calc.waiting) {
      // 连续按运算符：只切换运算符
      calc.op = op;
      updateDisplay(root);
      return;
    }

    const val = calc.op === '+' ? calc.base + cur : calc.base - cur;
    calc0 = Math.max(0, val);
    draft.amountText = (calc0 / 100).toFixed(2).replace(/\.00$/, '');
    calc = { base: calc0, op, waiting: true };
    updateDisplay(root);
  }

  function updateDisplay(root) {
    if (!root) root = $('#view-add');
    if (!root) return;
    const node = root.querySelector('.amount-val');
    if (node) {
      const amtText = draft.amountText === '' ? '0.00' : draft.amountText;
      node.className = 'amount-val ' + (draft.type === 'income' ? 'income' : '') + (draft.amountText === '' ? ' placeholder' : '');
      node.innerHTML = `${U.escapeHtml(amtText)}<span class="cursor"></span>`;
    }
    const okBtn = root.querySelector('.key--ok');
    if (okBtn) okBtn.classList.toggle('disabled', amountValue() <= 0);
    const hint = root.querySelector('.calc-hint');
    if (hint) {
      const txt = calc ? `${U.money(calc.base)} ${calc.op} …` : '　';
      hint.textContent = txt;
      hint.classList.toggle('on', !!calc);
    }
    // 外币折算提示
    const fx = root.querySelector('.fx-hint');
    if (fx) {
      const amt = amountValue();
      const curInfo = S.bookCurrency ? S.bookCurrency() : null;
      if (curInfo) fx.innerHTML = `≈ ${U.money(S.toCnyCents(amt))} <span class="fx-rate">${U.escapeHtml(curInfo.code)} × ${curInfo.rate}</span>`;
    }
    // 今日额度实时刷新
    const qb = root.querySelector('.quota-bar');
    if (qb) {
      const wrapper = qb.parentNode;
      const tmp = document.createElement('div');
      tmp.innerHTML = renderQuota(draft.type, amountValue());
      const next = tmp.firstElementChild;
      if (next) {
        qb.replaceWith(next);
      } else {
        qb.remove();
      }
    }
  }

  // ------------------------------------------------------------
  // 提交
  // ------------------------------------------------------------
  function commit(root) {
    // 有没算完的加减法（输完第二个数还没按运算符），先把结果算出来
    if (calc && !calc.waiting) {
      const cur = amountValue();
      const val = calc.op === '+' ? calc.base + cur : calc.base - cur;
      calc0 = Math.max(0, val);
      draft.amountText = (calc0 / 100).toFixed(2).replace(/\.00$/, '');
      calc = null;
    }
    const localAmt = amountValue();
    if (!localAmt || localAmt <= 0) {
      U.toast('请输入金额', 'error');
      return;
    }
    // 外币账本：入库一律存人民币分
    const curInfo = S.bookCurrency ? S.bookCurrency() : null;
    const amount = curInfo ? S.toCnyCents(localAmt) : localAmt;

    const payload = {
      type: draft.type,
      amount,
      catId: draft.catId,
      sub: draft.sub,
      accountId: draft.accountId,
      note: draft.note.trim(),
      ts: draft.ts,
    };
    if (curInfo) {
      payload.amountFx = localAmt;
      payload.fxRate = curInfo.rate;
      payload.fxCode = curInfo.code;
    }
    // 垫付：开关开着（_advOn）就是垫付；名字没填默认「待填写」落账，免得丢状态
    const advWho = (draft.advanceWho || '').trim() || '待填写';
    if (draft.type === 'expense' && draft._advOn) {
      // 编辑已收回的垫付时保留收回状态
      const prev = draft.editingId ? S.txById(draft.editingId) : null;
      const prevAdv = prev && prev.advance ? prev.advance : null;
      payload.advance = {
        who: advWho,
        status: prevAdv && prevAdv.status === 'settled' ? 'settled' : 'open',
        dueTs: draft.advanceDue || 0,
        settledTs: prevAdv && prevAdv.status === 'settled' ? (prevAdv.settledTs || 0) : 0,
        settledAmount: prevAdv && prevAdv.status === 'settled' ? (prevAdv.settledAmount || amount) : 0,
      };
      // 垫付账必须落在「垫付」分类上 —— 即便草稿分类被手动改过也拉回来
      payload.catId = ADVANCE_CAT;
    }

    if (draft.editingId) {
      const old = S.txById(draft.editingId);
      if (old && old.advance && !payload.advance) {
        S.clearAdvance(draft.editingId);
      }
      S.updateTx(draft.editingId, payload);
      U.toast('已保存修改', 'success');
      resetDraft(false);
      App.go('detail');
      return;
    }

    S.addTx(payload);
    const catName = Icons.cat(draft.catId).name;
    const advTag = payload.advance ? `（${payload.advance.who} 待还）` : '';
    U.toast(`${draft.type === 'income' ? '收入' : '支出'} ${U.money(amount)} · ${catName}${advTag}`, 'success');

    lastUsed[draft.type] = { catId: draft.catId, accountId: draft.accountId };

    resetDraft(false);
    dockOpen = false;   // 记完一笔就把键盘收起来，露出完整列表
    render(root);

    // 低预算提醒
    setTimeout(() => checkBudgetAlerts(), 220);
  }

  function checkBudgetAlerts() {
    const fired = S.checkAlerts();
    if (!fired.length) return;
    const f = fired[fired.length - 1];
    const pct = Math.round(f.pct * 100);
    const over = pct >= 100;
    setTimeout(() => {
      UI.openSheet({
        title: over ? '预算已超支' : '预算提醒',
        content: `
          <div style="text-align:center;padding:6px 0 18px">
            <div style="font-size:46px;line-height:1;margin-bottom:12px">${over ? '🚨' : '⚠️'}</div>
            <div style="font-size:15px;font-weight:650;margin-bottom:6px">
              ${over ? `本期预算已用 ${pct}%` : `本期预算已用掉 ${pct}%`}
            </div>
            <div class="small muted" style="line-height:1.7">
              预算 ${U.money(f.status.total)}，已支出 <b style="color:var(--text)">${U.money(f.status.spent)}</b><br/>
              ${over
                ? `已超支 <b style="color:var(--expense)">${U.money(f.status.spent - f.status.total)}</b>，接下来的 ${f.status.daysLeft} 天建议暂停非必要支出。`
                : `还剩 <b style="color:var(--text)">${U.money(f.status.remaining)}</b>，日均可用 ${U.money(f.status.dailyAllowance)}。`}
            </div>
          </div>
          <div class="btn-row">
            <button class="btn btn--ghost btn--sm" data-act="go-report" type="button">看看总结</button>
            <button class="btn btn--primary btn--sm" data-act="close" type="button">我知道了</button>
          </div>
        `,
        onMount(body, close) {
          body.querySelector('[data-act="close"]').addEventListener('click', close);
          body.querySelector('[data-act="go-report"]').addEventListener('click', () => {
            close();
            App.go('report');
          });
        },
      });
    }, 420);
  }

  // ------------------------------------------------------------
  // 编辑模式
  // ------------------------------------------------------------
  function edit(tx) {
    draft.editingId = tx.id;
    dockOpen = true;   // 编辑金额，直接把键盘弹出来
    draft.type = tx.type;
    draft.catId = tx.catId;
    draft.sub = tx.sub || '';
    draft.accountId = tx.accountId || 'alipay';
    draft.note = tx.note || '';
    draft.ts = tx.ts;
    // 外币账目：金额回填成原币
    if (tx.amountFx && tx.fxRate) {
      draft.amountText = (tx.amountFx / 100).toFixed(2).replace(/\.00$/, '');
    } else {
      draft.amountText = (tx.amount / 100).toFixed(2).replace(/\.00$/, '');
    }
    // 垫付回填
    if (tx.advance) {
      draft._advOn = true;
      draft.advanceWho = tx.advance.who && tx.advance.who !== '待填写' ? tx.advance.who : '';
      draft.advanceDue = tx.advance.dueTs || 0;
      draft._catBeforeAdv = '';
    } else {
      draft._advOn = false;
      draft.advanceWho = '';
      draft.advanceDue = 0;
      draft._catBeforeAdv = '';
    }
    calc = null;
    App.go('add');
  }

  function refresh() {
    const root = $('#view-add');
    if (root) render(root);
  }

  global.ViewAdd = {
    render,
    edit,
    refresh,
    reset() { resetDraft(false); },
    get draft() { return draft; },
  };
})(window);
