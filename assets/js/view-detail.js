/* ============================================================
 * 花哪儿了 · 明细（周期视图）
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;
  const $ = U.$;

  const state = {
    offset: 0,          // 相对当前周期
    filterType: 'all',  // all / expense / income
    filterCat: null,
    keyword: '',
    view: 'list',       // list / cat
    advOpen: false,     // 待收回折叠卡是否展开
  };

  // ------------------------------------------------------------
  // 同月内的滚动位置保持（O3）
  //
  // 设计总监定稿：翻月（周期导航）跳顶是**正确行为** —— 月份标题在容器顶部，
  // 翻月后回到顶部是让用户看到新月份的名字。真正要修的只有一类场景：
  // 在长列表里点某一笔账 → 弹层里改完/删完 → 重渲染，滚动位置丢了。
  // 所以只在「点某一笔」这条路上记位置并恢复；翻周期 / 切筛选一律跳顶。
  // ------------------------------------------------------------

  /** 记下「下一次 render 要把滚动位置放回去」的 scrollTop；null = 不恢复 */
  let keepScrollTop = null;

  /** 滚动容器就是 #view-detail 自己（.view { overflow-y: auto }，见 app.css） */
  function scrollHost(root) {
    return (root && root.closest && root.closest('.view')) || root;
  }

  function markKeepScroll(root) {
    const host = scrollHost(root);
    keepScrollTop = host && typeof host.scrollTop === 'number' ? host.scrollTop : null;
  }

  /** render 开头取一次就用掉：这个值只服务紧跟着的那一次重渲染 */
  function takeKeepScroll() {
    const v = keepScrollTop;
    keepScrollTop = null;
    return v;
  }

  /** 恢复：先同步放一次（不让下一帧闪一下顶部），再在 rAF 之后校准一次，
   *  等新内容真正布局完；两次都 clamp 到 scrollHeight - clientHeight ——
   *  新内容比原来矮时，不加钳制会滚到虚无区域。 */
  function restoreScroll(root, top) {
    const host = scrollHost(root);
    if (!host || !(top > 0)) return;
    const apply = () => {
      const max = Math.max(0, host.scrollHeight - host.clientHeight);
      const want = Math.min(top, max);
      try { if (host.scrollTop !== want) host.scrollTop = want; } catch (e) { /* 忽略 */ }
    };
    apply();
    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(() => global.requestAnimationFrame(apply));
    }
  }

  function period() {
    return state.offset === 0 ? S.currentPeriod() : S.shiftPeriod(S.currentPeriod(), state.offset);
  }

  /** 有搜索词时跨所有周期搜（「三个月前那笔」不用一页页翻） */
  function isSearching() {
    return !!state.keyword.trim();
  }

  function filtered(list) {
    const kw = state.keyword.trim().toLowerCase();
    return list.filter((t) => {
      if (state.filterType !== 'all' && t.type !== state.filterType) return false;
      if (state.filterCat && t.catId !== state.filterCat) return false;
      if (kw) {
        const cat = Icons.cat(t.catId);
        const hay = [cat.name, t.sub, t.note].join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  /** 搜索模式下的全量账目（跨周期） */
  function searchPool() {
    return S.state.tx.filter((t) => (S.isAllBooks() || !t.bookId || t.bookId === S.writeBookId()))
      .sort((a, b) => b.ts - a.ts);
  }

  function render(root) {
    // 这一次重渲染要不要把滚动位置放回去：有值才放（见 markKeepScroll）
    const keepTop = takeKeepScroll();
    const p = period();
    const searching = isSearching();
    const all = searching ? searchPool() : S.txIn(p);
    const list = filtered(all);
    const sum = S.summary(searching ? S.monthPeriod(new Date()) : p, all);
    const b = S.budgetStatus(p);
    const isCurrent = state.offset === 0;
    const hasFilter = state.filterType !== 'all' || state.filterCat || state.keyword.trim();

    // 账目 + 想买清单一起排进时间线（清单条目还没成账，但用户想在这里看到）
    const rows = [];
    list.forEach((t) => rows.push({ kind: 'tx', ts: t.ts, t }));
    if (!searching) {
      try { S.wishesIn(p).forEach((w) => rows.push({ kind: 'wish', ts: w.createdAt, w })); } catch (e) { /* 忽略 */ }
    }
    rows.sort((a, b2) => b2.ts - a.ts);
    const groups = {};
    rows.forEach((r) => {
      const k = U.ymd(r.ts);
      (groups[k] = groups[k] || []).push(r);
    });
    const dayKeys = Object.keys(groups).sort((a, b2) => b2.localeCompare(a));

    root.innerHTML = `
      <div class="period-nav">
        <button class="period-btn" data-nav="-1" type="button" aria-label="上一周期" ${searching ? 'disabled' : ''}>${Icons.svg('chevronLeft', 16)}</button>
        <div class="period-label">
          <span>${searching ? '全部时间' : U.escapeHtml(p.label)}</span>
          <small>${searching
            ? `跨周期搜索 · 共 ${list.length} 笔匹配`
            : `${isCurrent ? '当前记账周期' : '历史周期'} · 共 ${p.days} 天`}</small>
        </div>
        <button class="period-btn" data-nav="1" type="button" aria-label="下一周期" ${isCurrent || searching ? 'disabled' : ''}>${Icons.svg('chevronRight', 16)}</button>
      </div>

      ${searching ? '' : renderHero(sum, b, isCurrent, p)}

      ${searching ? '' : renderAlert(b, isCurrent)}

      ${searching ? '' : (global.Tips ? global.Tips.renderSlim() : '')}

      ${searching ? '' : renderAdvanceCard()}

      <div class="filter-bar">
        <label class="search-box">
          ${Icons.svg('search', 16)}
          <input id="kw" type="search" placeholder="搜索备注 / 分类（跨全部时间）" value="${U.escapeHtml(state.keyword)}" />
        </label>
        <button class="filter-btn ${state.view === 'cat' ? 'on' : ''}" data-act="toggle-view" type="button">
          ${Icons.svg(state.view === 'cat' ? 'list' : 'grid', 15)}${state.view === 'cat' ? '列表' : '分类'}
        </button>
      </div>

      <div class="filter-bar" style="padding-bottom:14px">
        <button class="filter-btn ${state.filterType === 'all' ? 'on' : ''}" data-type="all" type="button">全部</button>
        <button class="filter-btn ${state.filterType === 'expense' ? 'on' : ''}" data-type="expense" type="button">支出</button>
        <button class="filter-btn ${state.filterType === 'income' ? 'on' : ''}" data-type="income" type="button">收入</button>
        ${state.filterCat ? `<button class="filter-btn on" data-act="clear-cat" type="button">
          ${Icons.cat(state.filterCat).icon} ${Icons.cat(state.filterCat).name} ${Icons.svg('close', 13)}
        </button>` : ''}
        ${hasFilter ? `<button class="filter-btn" data-act="clear-all" type="button">清空筛选</button>` : ''}
      </div>

      ${state.view === 'cat' && !searching ? renderCatView(sum, all, p) : renderListView(dayKeys, groups, list.length, all.length, hasFilter, searching)}
    `;

    bind(root, p);
    restoreScroll(root, keepTop);
  }

  /** 待收回的垫付（明细页顶部折叠卡） */
  function renderAdvanceCard() {
    let adv;
    try { adv = S.advanceSummary(); } catch (e) { return ''; }
    if (!adv.openCount) return '';
    const overdue = adv.overdue.length;
    const open = state.advOpen;
    return `
      <div class="adv-card ${overdue ? 'has-overdue' : ''}">
        <button class="adv-card-head" data-act="toggle-adv" type="button">
          <span class="adv-card-ic">💸</span>
          <span class="adv-card-main">
            <span class="adv-card-title">待收回 ${U.money(adv.openAmount)} · ${adv.openCount} 笔</span>
            <span class="adv-card-sub">${overdue ? `其中 ${overdue} 笔已到还款日` : '钱回来了就整笔抹掉'}</span>
          </span>
          ${overdue ? '<span class="adv-card-badge">超期</span>' : ''}
          <span class="adv-card-arrow ${open ? 'open' : ''}">${Icons.svg('chevronDown', 14)}</span>
        </button>
        ${open ? `<div class="adv-card-list">
          ${adv.overdue.concat(S.advances(true).filter((t) => adv.overdue.indexOf(t) < 0)).map((t) => {
            const who = t.advance.who || '别人';
            const left = t.advance.dueTs ? Math.round((U.startOfDay(new Date(t.advance.dueTs)).getTime() - U.startOfDay(new Date()).getTime()) / 86400000) : null;
            const dueTxt = left == null ? '没设催款日' : left < 0 ? `超期 ${-left} 天` : left === 0 ? '今天到期' : `${left} 天后到期`;
            return `<div class="adv-row ${left != null && left < 0 ? 'overdue' : ''}">
              <span class="adv-row-main">
                <span class="adv-row-name">${U.escapeHtml(who)} <span class="adv-row-amt">${U.money(t.amount)}</span></span>
                <span class="adv-row-meta">${U.humanDate(t.ts)} · ${U.escapeHtml(dueTxt)}${t.note ? ' · ' + U.escapeHtml(t.note) : ''}</span>
              </span>
              <button class="btn btn--sm btn--primary" data-act="settle-adv" data-id="${t.id}" type="button">已归还</button>
            </div>`;
          }).join('')}
        </div>` : ''}
      </div>`;
  }

  function renderHero(sum, b, isCurrent, p) {
    const levelCls = b.level === 'over' ? 'over' : b.level === 'warn' ? 'warn' : '';
    const pctTxt = b.total ? Math.round(b.pct * 100) : 0;
    return `
      <div class="hero anim-in">
        <div class="hero-label">本期支出</div>
        <div class="hero-amount">${U.money(sum.expense, { decimals: 2 })}</div>
        <div class="hero-grid">
          <div class="hero-cell">
            <div class="hero-cell-label">收入</div>
            <div class="hero-cell-val">${U.money(sum.income)}</div>
          </div>
          <div class="hero-cell">
            <div class="hero-cell-label">结余</div>
            <div class="hero-cell-val ${sum.net < 0 ? 'neg' : ''}">${U.money(sum.net)}</div>
          </div>
          <div class="hero-cell">
            <div class="hero-cell-label">${isCurrent ? '日均支出' : '笔均支出'}</div>
            <div class="hero-cell-val">${U.money(isCurrent ? sum.avgDaily : (sum.expCount ? sum.expense / sum.expCount : 0))}</div>
          </div>
        </div>
        ${b.total ? `
          <div class="budget-bar ${levelCls}"><i style="width:${U.clamp(b.pct * 100, 0, 100).toFixed(1)}%"></i></div>
          <div class="hero-foot">
            <span>预算 ${U.money(b.total)} · 已用 ${pctTxt}%</span>
            <span>${b.remaining >= 0 ? `剩余 ${U.money(b.remaining)}` : `超支 ${U.money(-b.remaining)}`}</span>
          </div>` : `
          <div class="hero-foot"><span>尚未设置预算</span><span style="text-decoration:underline" data-act="go-budget">去设置 →</span></div>`}
      </div>
    `;
  }

  function renderAlert(b, isCurrent) {
    if (!isCurrent || !b.total) return '';
    if (b.level === 'safe') return '';
    const over = b.level === 'over';
    return `
      <div class="alert-banner ${over ? 'over' : ''}">
        ${Icons.svg(over ? 'alert' : 'bell', 18)}
        <div class="alert-txt">
          <b>${over ? '本期预算已超支' : '预算快用完了'}</b>
          <span class="sub">${over
            ? `已超 ${U.money(-b.remaining)}，占预算 ${Math.round(b.pct * 100)}%。剩下 ${b.daysLeft} 天建议控制支出。`
            : `已用 ${Math.round(b.pct * 100)}%，剩余 ${U.money(b.remaining)}，日均可用 ${U.money(b.dailyAllowance)}。`}</span>
        </div>
      </div>
    `;
  }

  function renderListView(dayKeys, groups, shown, total, hasFilter, searching) {
    if (!shown) {
      return `
        <div class="empty">
          <div class="empty-emoji">${hasFilter ? '🔍' : '📝'}</div>
          <div class="empty-title">${hasFilter ? '没有匹配的账目' : '本期还没有记账'}</div>
          <div class="empty-desc">${hasFilter
            ? (searching ? '换个关键词试试，搜索会翻遍所有月份的账目' : '试试换个关键词或清空筛选条件')
            : '点击底部「记一笔」，记录你的第一笔收支吧'}</div>
          ${hasFilter ? '<button class="empty-btn" data-act="clear-all" type="button">清空筛选</button>'
            : '<button class="empty-btn" data-act="go-add" type="button">去记一笔</button>'}
        </div>`;
    }
    return dayKeys.map((k) => {
      const items = groups[k];
      const txs = items.filter((r) => r.kind === 'tx').map((r) => r.t);
      const dayOut = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const dayIn = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      return `
        <div class="day-group">
          <div class="day-head">
            <span class="d">${U.humanDate(items[0].ts)} · 周${U.WEEK_CN[new Date(items[0].ts).getDay()]}</span>
            <span class="s">${dayOut ? '支 ' + U.money(dayOut) : ''}${dayOut && dayIn ? '  ' : ''}${dayIn ? '收 ' + U.money(dayIn) : ''}</span>
          </div>
          ${items.map((r) => (r.kind === 'wish' ? wishRow(r.w) : txRow(r.t))).join('')}
        </div>`;
    }).join('');
  }

  /** 倒计时文案 */
  function wishLeftText(leftMs) {
    if (leftMs <= 0) return '冷静期已过';
    const h = Math.floor(leftMs / 3600000);
    if (h >= 24) {
      const d = Math.floor(h / 24), rest = h % 24;
      return rest ? `还有 ${d} 天 ${rest} 小时` : `还有 ${d} 天`;
    }
    if (h >= 1) return `还有 ${h} 小时 ${Math.floor((leftMs % 3600000) / 60000)} 分`;
    return `还有 ${Math.max(1, Math.ceil(leftMs / 60000))} 分钟`;
  }

  /**
   * 想买清单的条目混在明细里
   * cooling → 标灰 + 倒计时；ready → 高亮问「买了吗」；dropped → 划掉留档
   */
  function wishRow(w) {
    const c = Icons.cat(w.catId || 'shopping');
    const cooling = w.state === 'cooling';
    const ready = w.state === 'ready';
    const dropped = w.state === 'dropped';
    const cls = ['tx-item', 'tx-item--wish'];
    if (cooling) cls.push('is-cooling');
    if (ready) cls.push('is-ready');
    if (dropped) cls.push('is-dropped');
    const meta = dropped
      ? '已放弃 · 金额记进忍住基金'
      : cooling
        ? `${wishLeftText(w.leftMs)} · 冷静期结束再决定`
        : '冷静期到了';
    return `
      <div class="${cls.join(' ')}">
        <span class="tx-avatar" style="background:${c.color}1A">${cooling ? '🕰️' : (dropped ? '🌱' : '🛍️')}</span>
        <span class="tx-main">
          <span class="tx-name ${dropped ? 'is-struck' : ''}">${U.escapeHtml(w.name)}
            <span class="sub-tag">${dropped ? '没买' : '想买'}</span></span>
          <span class="tx-meta">${dropped ? meta : (cooling ? meta : U.timeStr(w.createdAt) + ' · ' + meta)}</span>
          ${cooling ? `<span class="wish-bar"><i style="width:${wishPct(w)}%"></i></span>` : ''}
          ${ready ? `<span class="wish-ask">买了吗？
            <button class="wish-yes" data-wish-buy="${w.id}" type="button">已购买</button>
            <button class="wish-no" data-wish-drop="${w.id}" type="button">没买</button>
          </span>` : ''}
        </span>
        <span class="tx-amt ${dropped ? 'is-struck' : 'wish'}">${dropped ? '—' : U.money(w.amount, { symbol: false })}</span>
      </div>`;
  }

  /** 冷静期进度条百分比 */
  function wishPct(w) {
    const total = (w.hours || 48) * 3600000;
    if (!total) return 0;
    const done = total - Math.max(0, w.leftMs);
    return Math.max(2, Math.min(100, Math.round((done / total) * 100)));
  }

  function txRow(t) {
    const c = Icons.cat(t.catId);
    const acct = S.state.accounts.find((a) => a.id === t.accountId);
    const pending = t.advance && t.advance.status === 'open';
    const settled = t.advance && t.advance.status === 'settled';
    // 垫付也是真花出去的钱，金额照常显示；到还款日了再加一句「该问问了」
    const today = U.startOfDay(new Date()).getTime();
    const overdue = pending && t.advance.dueTs && U.startOfDay(new Date(t.advance.dueTs)).getTime() <= today;
    const advTag = pending
      ? `<span class="tx-tag tx-tag--adv">垫付${t.advance.who ? ' · ' + U.escapeHtml(t.advance.who) : ''}</span>`
      : settled ? '<span class="tx-tag tx-tag--done">已归还 · 不计支出</span>' : '';
    const fxTag = (t.amountFx && t.fxRate)
      ? `<span class="tx-tag tx-tag--fx">${U.escapeHtml(t.fxCode || '')} ${(t.amountFx / 100).toFixed(2)}</span>` : '';
    const bookTag = S.isAllBooks() && t.bookId
      ? `<span class="tx-tag tx-tag--book">${U.escapeHtml((S.bookById(t.bookId) || {}).name || '')}</span>` : '';
    const voided = S.isVoid ? S.isVoid(t) : (settled === true);
    const advHint = overdue ? '<span class="tx-adv-hint">到还款日了，问问收到了吗</span>' : '';
    if (voided) {
      // 钱已经回来了：只留文字，划掉，不算支出
      return `
        <button class="tx-item is-voided" data-tx="${t.id}" type="button">
          <span class="tx-avatar" style="background:${c.color}1A">${Icons.catIcon ? Icons.catIcon(c) : c.icon}</span>
          <span class="tx-main">
            <span class="tx-name is-struck">${c.name}${t.sub ? `<span class="sub-tag">${U.escapeHtml(t.sub)}</span>` : ''}${advTag}${bookTag}</span>
            <span class="tx-meta">${U.timeStr(t.ts)}${acct ? ' · ' + acct.name : ''}${t.note ? ' · ' + U.escapeHtml(t.note) : ''} · 钱已还回来，不计入支出</span>
          </span>
          <span class="tx-amt is-struck">${U.money(t.amount, { symbol: false })}</span>
        </button>`;
    }
    return `
      <button class="tx-item ${pending ? 'is-pending' : ''}" data-tx="${t.id}" type="button">
        <span class="tx-avatar" style="background:${c.color}1A">${Icons.catIcon ? Icons.catIcon(c) : c.icon}</span>
        <span class="tx-main">
          <span class="tx-name">${c.name}${t.sub ? `<span class="sub-tag">${U.escapeHtml(t.sub)}</span>` : ''}${advTag}${fxTag}${bookTag}</span>
          <span class="tx-meta">${U.timeStr(t.ts)}${acct ? ' · ' + acct.name : ''}${t.note ? ' · ' + U.escapeHtml(t.note) : ''}${advHint}</span>
        </span>
        <span class="tx-amt ${t.type === 'income' ? 'in' : 'out'}">${t.type === 'income' ? '+' : '-'}${U.money(t.amount, { symbol: false })}</span>
      </button>`;
  }

  function renderCatView(sum, all, p) {
    if (!sum.byCat.length) {
      return `<div class="empty"><div class="empty-emoji">📊</div>
        <div class="empty-title">本期没有支出</div>
        <div class="empty-desc">记录支出后这里会显示分类占比</div></div>`;
    }
    const max = sum.byCat[0].amount || 1;
    return `
      <div class="card">
        <div class="card-head">
          <div class="card-title">${Icons.svg('pie', 16)} 分类占比</div>
          <div class="card-sub">共 ${sum.expCount} 笔</div>
        </div>
        <div class="donut-wrap">
          ${Charts.donut(sum.byCat.slice(0, 6).map((c) => ({ label: c.meta.name, value: c.amount, color: c.meta.color })), {
            size: 140, thickness: 15,
            centerTop: U.money(sum.expense, { decimals: 0 }),
            centerSub: '总支出',
          })}
          <div class="donut-legend">
            ${sum.byCat.slice(0, 5).map((c) => `
              <div class="legend-item">
                <span class="legend-dot" style="background:${c.meta.color}"></span>
                <span class="legend-name">${c.meta.name}</span>
                <span class="legend-val">${Math.round(c.pct * 100)}%</span>
              </div>`).join('')}
            ${sum.byCat.length > 5 ? `<div class="legend-item"><span class="legend-dot" style="background:var(--text-3)"></span>
              <span class="legend-name">其他 ${sum.byCat.length - 5} 类</span>
              <span class="legend-val">${Math.round(sum.byCat.slice(5).reduce((s, c) => s + c.pct, 0) * 100)}%</span></div>` : ''}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">支出排行</div></div>
        ${sum.byCat.map((c) => `
          <button class="cat-row" data-cat="${c.id}" type="button" style="width:100%;text-align:left;background:none;border:0;border-radius:0">
            <span class="cat-avatar" style="background:${c.meta.color}1A">${c.meta.icon}</span>
            <span class="cat-main">
              <span class="cat-line1">
                <span class="name">${c.meta.name} <span class="muted small">${c.count}笔</span></span>
                <span class="amt">${U.money(c.amount)}</span>
              </span>
              <span class="cat-line2">
                <span class="cat-track"><i style="width:${(c.amount / max * 100).toFixed(1)}%;background:${c.meta.color}"></i></span>
                <span class="cat-pct">${Math.round(c.pct * 100)}%</span>
              </span>
            </span>
          </button>
        `).join('')}
      </div>
      ${sum.income > 0 ? `
        <div class="card">
          <div class="card-head"><div class="card-title">收入构成</div>
            <div class="card-sub">合计 ${U.money(sum.income)}</div></div>
          ${sum.byCat && all.filter((t) => t.type === 'income').length ? renderIncomeList(all) : '<div class="small muted">暂无收入</div>'}
        </div>` : ''}
    `;
  }

  function renderIncomeList(all) {
    const map = {};
    all.filter((t) => t.type === 'income').forEach((t) => {
      map[t.catId] = (map[t.catId] || 0) + t.amount;
    });
    const total = Object.values(map).reduce((s, v) => s + v, 0) || 1;
    return Object.keys(map).sort((a, b) => map[b] - map[a]).map((id) => {
      const c = Icons.cat(id);
      return `<div class="cat-row">
        <span class="cat-avatar" style="background:${c.color}1A">${Icons.catIcon ? Icons.catIcon(c) : c.icon}</span>
        <span class="cat-main">
          <span class="cat-line1"><span class="name">${c.name}</span>
            <span class="amt text-income">${U.money(map[id])}</span></span>
          <span class="cat-line2">
            <span class="cat-track"><i style="width:${(map[id] / total * 100).toFixed(1)}%;background:${c.color}"></i></span>
            <span class="cat-pct">${Math.round(map[id] / total * 100)}%</span>
          </span>
        </span>
      </div>`;
    }).join('');
  }

  // ------------------------------------------------------------
  function bind(root, p) {
    root.querySelectorAll('[data-nav]').forEach((b) => {
      b.addEventListener('click', () => {
        const n = state.offset + Number(b.dataset.nav);
        if (n > 0) return;
        state.offset = n;
        render(root);
        if (global.App && global.App.refreshTopbar) global.App.refreshTopbar();
      });
    });

    const kw = root.querySelector('#kw');
    if (kw) {
      kw.addEventListener('input', U.debounce(() => {
        state.keyword = kw.value;
        render(root);
        const nk = root.querySelector('#kw');
        if (nk) { nk.focus(); nk.setSelectionRange(nk.value.length, nk.value.length); }
      }, 260));
    }

    root.querySelectorAll('[data-type]').forEach((b) => {
      b.addEventListener('click', () => {
        state.filterType = b.dataset.type;
        render(root);
      });
    });

    root.querySelectorAll('[data-cat]').forEach((b) => {
      b.addEventListener('click', () => {
        state.filterCat = state.filterCat === b.dataset.cat ? null : b.dataset.cat;
        if (state.view === 'cat' && state.filterCat) state.view = 'list';
        render(root);
      });
    });

    root.querySelectorAll('[data-tx]').forEach((b) => {
      b.addEventListener('click', () => openTxActions(b.dataset.tx));
    });

    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'clear-all') {
          state.filterType = 'all'; state.filterCat = null; state.keyword = '';
          render(root);
        } else if (act === 'clear-cat') {
          state.filterCat = null; render(root);
        } else if (act === 'toggle-view') {
          state.view = state.view === 'cat' ? 'list' : 'cat';
          render(root);
        } else if (act === 'go-add') {
          App.go('add');
        } else if (act === 'go-budget') {
          App.go('settings');
          setTimeout(() => ViewSettings.openBudgetSheet(), 260);
        } else if (act === 'toggle-adv') {
          state.advOpen = !state.advOpen;
          render(root);
        } else if (act === 'settle-adv') {
          const t = S.settleAdvance(b.dataset.id);
          if (t) U.toast('已归还：记录留着，但这笔不再计入支出', 'success');
          render(root);
          if (global.App) { App.refreshTopbar(); }
        }
      });
    });

    root.querySelectorAll('[data-wish-buy]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          S.buyWish(b.dataset.wishBuy);
          U.toast('已记账，这笔进入账本', 'success');
          render(root);
          if (global.App) App.refreshTopbar();
        } catch (err) { U.toast(err.message || '操作失败', 'error'); }
      });
    });
    root.querySelectorAll('[data-wish-drop]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          S.dropWish(b.dataset.wishDrop);
          U.toast('记下了，钱省住了', 'success');
          render(root);
          if (global.App) App.refreshTopbar();
        } catch (err) { U.toast(err.message || '操作失败', 'error'); }
      });
    });

    if (global.Tips) global.Tips.bind(root);
  }

  // ------------------------------------------------------------
  // 账目操作
  // ------------------------------------------------------------
  /** 详情弹层里的垫付区块 */
  function renderAdvanceDetail(t) {
    if (!t.advance) return '';
    const a = t.advance;
    const who = a.who || '别人';
    if (a.status === 'settled') {
      return `<div class="adv-detail done">
        <span class="adv-detail-ic">✅</span>
        <div class="adv-detail-main">
          <div class="adv-detail-title">已收回 · ${U.escapeHtml(who)}</div>
          <div class="adv-detail-sub">${U.money(a.settledAmount || t.amount)} 于 ${U.humanDate(a.settledTs)} 收回</div>
        </div>
      </div>`;
    }
    const left = a.dueTs ? Math.round((U.startOfDay(new Date(a.dueTs)).getTime() - U.startOfDay(new Date()).getTime()) / 86400000) : null;
    const dueTxt = left == null ? '没设催款日' : left < 0 ? `已超期 ${-left} 天` : left === 0 ? '今天到期' : `${left} 天后到期`;
    return `<div class="adv-detail ${left != null && left < 0 ? 'overdue' : ''}">
      <span class="adv-detail-ic">💸</span>
      <div class="adv-detail-main">
        <div class="adv-detail-title">帮 ${U.escapeHtml(who)} 垫的 · 还没收回</div>
        <div class="adv-detail-sub">${U.escapeHtml(dueTxt)} · 未收回的垫付不计入支出和预算</div>
      </div>
      <button class="btn btn--sm btn--primary" data-act="settle-adv" type="button">已收回</button>
    </div>`;
  }

  function openTxActions(id) {
    const t = S.txById(id);
    if (!t) return;
    const c = Icons.cat(t.catId);
    const acct = S.state.accounts.find((a) => a.id === t.accountId);
    UI.openSheet({
      title: '账目详情',
      content: `
        <div style="display:flex;align-items:center;gap:13px;padding:4px 0 18px">
          <span style="width:52px;height:52px;border-radius:17px;display:grid;place-items:center;font-size:24px;background:${c.color}1A">${Icons.catIcon ? Icons.catIcon(c) : c.icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:16px;font-weight:650">${c.name}${t.sub ? ' · ' + U.escapeHtml(t.sub) : ''}</div>
            <div class="small muted">${U.fullDate(t.ts)} ${U.timeStr(t.ts)}${acct ? ' · ' + acct.name : ''}</div>
          </div>
          <div style="font-size:20px;font-weight:700;font-variant-numeric:tabular-nums" class="${t.type === 'income' ? 'text-income' : ''}">
            ${t.type === 'income' ? '+' : '-'}${U.money(t.amount, { symbol: false })}
          </div>
        </div>
        ${t.note ? `<div class="small" style="padding:12px 14px;background:var(--bg-2);border-radius:12px;margin-bottom:16px;line-height:1.6">${U.escapeHtml(t.note)}</div>` : ''}
        ${renderAdvanceDetail(t)}
        <div class="btn-row" style="margin-bottom:9px">
          <button class="btn btn--ghost btn--sm" data-act="edit" type="button">${Icons.svg('edit', 16)} 编辑</button>
          <button class="btn btn--ghost btn--sm" data-act="copy" type="button">${Icons.svg('copy', 16)} 复制一笔</button>
        </div>
        <button class="btn btn--danger btn--sm" data-act="del" type="button">${Icons.svg('trash', 16)} 删除这笔</button>
      `,
      onMount(body, close) {
        body.querySelector('[data-act="edit"]').addEventListener('click', () => {
          close();
          setTimeout(() => ViewAdd.edit(t), 180);
        });
        body.querySelector('[data-act="copy"]').addEventListener('click', () => {
          close();
          const copy = { ...t, ts: Date.now(), id: undefined, srcKey: '' };
          S.addTx(copy);
          U.toast('已复制一笔到今天', 'success');
          refreshKeep();
        });
        const settleBtn = body.querySelector('[data-act="settle-adv"]');
        if (settleBtn) {
          settleBtn.addEventListener('click', () => {
            close();
            S.settleAdvance(t.id);
            refreshKeep();
            U.toast('已归还：记录留着，但这笔不再计入支出', 'success');
          });
        }
        body.querySelector('[data-act="del"]').addEventListener('click', async () => {
          close();
          const ok = await UI.confirm({
            title: '删除这笔账目？',
            desc: `${c.name} ${U.money(t.amount)}<br/>删除后可以在提示条里撤销`,
            danger: true, okText: '删除',
          });
          if (!ok) return;
          S.removeTx(t.id);
          refreshKeep();
          showUndo(t);
        });
      },
    });
  }

  function showUndo(t, label) {
    const host = $('#toast-host');
    if (!host) return;
    host.innerHTML = '';
    const bar = U.el('div', { class: 'toast in' });
    bar.innerHTML = `<span>${U.escapeHtml(label || '已删除')}</span>
      <button style="margin-left:12px;color:#8FB3FF;font-weight:650" type="button">撤销</button>`;
    bar.style.pointerEvents = 'auto';
    host.appendChild(bar);
    bar.querySelector('button').addEventListener('click', () => {
      S.restoreTx(t);
      refreshKeep();
      bar.remove();
      U.toast('已恢复', 'success');
    });
    setTimeout(() => { if (bar.parentNode) bar.remove(); }, 4000);
  }

  function refresh() {
    const root = $('#view-detail');
    if (root) render(root);
  }

  /** 同月内的原地重画（点某一笔账 → 弹层里改完/删完）：记住位置 → 重画 → 放回去。
   *  翻周期 / 切筛选一律走 render()，保持「跳到顶部」。
   *  记和画必须连着做：中间隔着弹层开关的话，用户取消了就会留一个过期的位置。 */
  function refreshKeep() {
    const root = $('#view-detail');
    markKeepScroll(root);
    refresh();
    try { if (global.App && global.App.refreshTopbar) global.App.refreshTopbar(); } catch (e) { /* 忽略 */ }
    // refresh() 一定会重画并把这个位置用掉；万一没用掉（比如视图已经切走），
    // 也别留着 —— 否则下一次翻周期会错误地把旧位置放回去。
    keepScrollTop = null;
  }

  global.ViewDetail = {
    render, refresh,
    reset() { state.offset = 0; state.filterType = 'all'; state.filterCat = null; state.keyword = ''; },
    /* 跳到某笔账目所在的周期（用于导入账单后自动定位） */
    focus(ts) {
      const cur = S.currentPeriod();
      const target = S.periodFor(new Date(ts));
      if (target.key === cur.key) { state.offset = 0; return; }
      for (let n = -1; n >= -240; n--) {
        if (S.shiftPeriod(cur, n).key === target.key) { state.offset = n; return; }
      }
      for (let n = 1; n <= 24; n++) {
        if (S.shiftPeriod(cur, n).key === target.key) { state.offset = n; return; }
      }
      state.offset = 0;
    },
    get state() { return state; },
  };
})(window);
