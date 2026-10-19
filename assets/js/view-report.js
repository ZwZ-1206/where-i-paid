/* ============================================================
 * 花哪儿了 · 总结（日 / 月 / 年 三个选项卡 + 自选对比）
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;
  const $ = U.$;

  /**
   * state.anchor  当前查看的日期（日/月/年都从它推导区间）
   * state.scope   day / month / year
   * state.cmpTs   对比基准日期；null 表示默认「上一个同粒度区间」
   */
  const state = { scope: 'month', anchor: Date.now(), cmpTs: null };

  const SCOPE_LABEL = { day: '日', month: '月', year: '年' };
  const SCOPE_UNIT = { day: '天', month: '月', year: '年' };

  function period() {
    return S.scopePeriod(state.scope, new Date(state.anchor));
  }

  /** 对比区间：默认上一个同粒度区间，否则按用户选的日期推导 */
  function cmpPeriod() {
    if (state.cmpTs) return S.scopePeriod(state.scope, new Date(state.cmpTs));
    return S.scopePeriod(state.scope, S.shiftScope(state.scope, new Date(state.anchor), -1));
  }

  function isCurrent() {
    const p = period();
    const now = Date.now();
    return now >= p.start.getTime() && now <= p.end.getTime();
  }

  /** 上一个 / 下一个区间 */
  function shift(n) {
    state.anchor = S.shiftScope(state.scope, new Date(state.anchor), n).getTime();
    // 用户手动翻页后，对比回到「默认上一个区间」更符合直觉
    state.cmpTs = null;
  }

  // ------------------------------------------------------------
  function render(root) {
    const p = period();
    const cp = cmpPeriod();
    const list = S.txIn(p);
    const cmpList = S.txIn(cp);
    const sum = S.summary(p, list);
    const cmpSum = S.summary(cp, cmpList);
    const b = S.budgetStatus(p);
    const series = S.dailySeries(p);
    const cmpSeries = S.dailySeries(cp);
    const cur = isCurrent();

    const delta = cmpSum.expense > 0 ? (sum.expense - cmpSum.expense) / cmpSum.expense : null;
    const activeDays = Object.keys(sum.byDay).length;
    const maxDay = series.reduce((a, d) => (d.amount > a.amount ? d : a), { amount: 0, day: 0 });
    const insights = buildInsights(sum, cmpSum, series, cmpSeries, b, p, activeDays, cp);

    root.innerHTML = `
      <div class="seg-tabs" role="tablist">
        ${['day', 'month', 'year'].map((s) => `
          <button class="seg-tab ${state.scope === s ? 'on' : ''}" data-scope="${s}" type="button" role="tab">
            ${SCOPE_LABEL[s]}
          </button>`).join('')}
      </div>

      <div class="period-nav">
        <button class="period-btn" data-nav="-1" type="button">${Icons.svg('chevronLeft', 16)}</button>
        <div class="period-label">
          <span>${U.escapeHtml(p.label)}</span>
          <small>${scopeSubLabel(p)}</small>
        </div>
        <button class="period-btn" data-nav="1" type="button" ${cur ? 'disabled' : ''}>${Icons.svg('chevronRight', 16)}</button>
      </div>

      <div class="report-hero anim-in">
        <div class="rh-top">
          <div>
            <div class="rh-label">${scopeName()}支出</div>
            <div class="rh-amount">${U.money(sum.expense)}</div>
          </div>
          ${delta == null
            ? '<span class="rh-delta flat">无对比数据</span>'
            : `<span class="rh-delta ${delta > 0.02 ? 'up' : delta < -0.02 ? 'down' : 'flat'}">
                 ${delta > 0 ? '↑' : delta < 0 ? '↓' : '—'} ${Math.abs(Math.round(delta * 100))}%
               </span>`}
        </div>
        <div class="rh-cells">
          <div class="rh-cell"><div class="l">收入</div><div class="v income">${U.money(sum.income)}</div></div>
          <div class="rh-cell"><div class="l">结余</div><div class="v">${U.money(sum.net)}</div></div>
          <div class="rh-cell"><div class="l">笔数</div><div class="v">${sum.count}</div></div>
          <div class="rh-cell"><div class="l">${state.scope === 'day' ? '笔均' : '日均'}</div>
            <div class="v">${U.money(state.scope === 'day' ? (sum.expCount ? sum.expense / sum.expCount : 0) : sum.avgDaily)}</div></div>
        </div>
        <button class="cmp-bar" data-act="pick-cmp" type="button">
          <span class="cmp-ic">${Icons.svg('refresh', 13)}</span>
          <span class="cmp-txt">
            对比 <b>${U.escapeHtml(cp.label)}</b>
            ${cmpSum.expense > 0
              ? `<span class="cmp-diff ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">
                   ${delta >= 0 ? '多花' : '少花'} ${U.money(Math.abs(sum.expense - cmpSum.expense))}
                 </span>`
              : '<span class="cmp-diff">没有记录</span>'}
          </span>
          <span class="cmp-edit">换一个 ${Icons.svg('chevronRight', 12)}</span>
        </button>
        ${state.cmpTs ? `<div class="cmp-reset"><button data-act="reset-cmp" type="button">恢复默认对比（上一个${SCOPE_UNIT[state.scope]}）</button></div>` : ''}
      </div>

      ${cur && global.Tips ? global.Tips.renderSlim() : ''}

      ${renderAiCard(p)}

      ${b.total && state.scope === 'month' ? renderBudgetCard(b, p) : ''}

      ${sum.expense > 0 ? `
        <div class="card anim-in" data-d="1">
          <div class="card-head">
            <div class="card-title">${Icons.svg('pie', 16)} 支出结构</div>
            <div class="card-sub">${sum.byCat.length} 个分类</div>
          </div>
          <div class="donut-wrap">
            ${Charts.donut(sum.byCat.slice(0, 7).map((c) => ({ label: c.meta.name, value: c.amount, color: c.meta.color })), {
              size: 148, thickness: 16,
              centerTop: U.moneyCompact(sum.expense),
              centerSub: '总支出',
            })}
            <div class="donut-legend">
              ${sum.byCat.slice(0, 6).map((c) => `
                <div class="legend-item">
                  <span class="legend-dot" style="background:${c.meta.color}"></span>
                  <span class="legend-name">${c.meta.name}</span>
                  <span class="legend-val">${U.moneyCompact(c.amount)}</span>
                </div>`).join('')}
            </div>
          </div>
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
            ${sum.byCat.slice(0, 3).map((c, i) => `
              <div class="cat-row" style="padding:7px 0">
                <span class="cat-avatar" style="width:32px;height:32px;border-radius:10px;font-size:15px;background:${c.meta.color}1A">${c.meta.icon}</span>
                <span class="cat-main">
                  <span class="cat-line1">
                    <span class="name" style="font-size:13px">${i + 1}. ${c.meta.name}</span>
                    <span class="amt" style="font-size:13px">${U.money(c.amount)}</span>
                  </span>
                  <span class="cat-line2">
                    <span class="cat-track"><i style="width:${(c.pct * 100).toFixed(1)}%;background:${c.meta.color}"></i></span>
                    <span class="cat-pct">${Math.round(c.pct * 100)}%</span>
                  </span>
                </span>
              </div>`).join('')}
          </div>
        </div>

        <div class="card anim-in" data-d="2">
          <div class="card-head">
            <div class="card-title">${Icons.svg('chart', 16)} ${trendTitle()}</div>
            <div class="card-sub">${maxDay.amount ? '最高 ' + maxDay.day + '日 ' + U.money(maxDay.amount) : '—'}</div>
          </div>
          ${renderTrend(series, maxDay)}
          <div class="row" style="justify-content:space-between;margin-top:10px">
            <span class="small muted">活跃 ${activeDays} ${SCOPE_UNIT[state.scope] === '天' ? '天' : '天'} · 日均 ${U.money(sum.avgDaily)}</span>
            <span class="small muted">虚线上方为超均值</span>
          </div>
        </div>

        <div class="card anim-in" data-d="3">
          <div class="card-head">
            <div class="card-title">${Icons.svg('refresh', 16)} 与所选${SCOPE_UNIT[state.scope]}对比</div>
            <button class="card-more" data-act="pick-cmp" type="button">${U.escapeHtml(cp.label)} ${Icons.svg('chevronDown', 11)}</button>
          </div>
          ${cmpSum.expense > 0 ? renderCompare(sum, cmpSum) : `<div class="small muted" style="padding:8px 0">
            ${U.escapeHtml(cp.label)} 没有支出记录，暂时无法对比。
            <button class="link-btn" data-act="pick-cmp" type="button">换一个${SCOPE_UNIT[state.scope]} →</button>
          </div>`}
        </div>
      ` : `
        <div class="empty">
          <div class="empty-emoji">📊</div>
          <div class="empty-title">这个${SCOPE_UNIT[state.scope]}还没有支出</div>
          <div class="empty-desc">记账后就能看到支出结构、趋势与洞察了</div>
          <button class="empty-btn" data-act="go-add" type="button">去记一笔</button>
        </div>
      `}

      ${insights.length ? `
        <div class="card">
          <div class="card-head">
            <div class="card-title">${Icons.svg('sparkle', 16)} 账本洞察</div>
            <div class="card-sub">自动生成</div>
          </div>
          ${insights.map((i) => `
            <div class="insight">
              <span class="insight-ic">${i.icon}</span>
              <span class="insight-txt">${i.text}</span>
            </div>`).join('')}
        </div>` : ''}

      ${renderEquivCard(sum)}

      ${renderMergedCard(p)}

      <div class="card" style="background:var(--card-2)">
        <div class="row gap8">
          ${Icons.svg('share', 16)}
          <span class="small" style="flex:1;color:var(--text-2)">把这份总结保存成图片或导出明细</span>
          <button class="btn btn--primary btn--sm" style="width:auto;padding:0 14px" data-act="export" type="button">导出</button>
        </div>
      </div>
    `;

    bind(root, p, sum);
  }

  // ------------------------------------------------------------
  // 换算成实物（只在用户点开时算，不主动弹）
  // ------------------------------------------------------------
  function renderEquivCard(sum) {
    if (!sum.expense || !global.Extras) return '';
    const top = sum.byCat[0];
    const catId = top ? top.id : 'other_out';
    const main = global.Extras.forMoney(sum.expense, catId);
    if (!main) return '';
    const goals = (S.state.goals || []).filter((g) => !g.archived);
    const goalLine = global.Extras.forGoal(sum.expense, goals);
    return `
      <div class="card equiv-card">
        <div class="card-head">
          <div class="card-title">${Icons.svg('sparkle', 16)} 这笔钱相当于</div>
          <div class="card-sub">纯属换算</div>
        </div>
        <div class="equiv-main">
          <span class="equiv-emoji">${main.item.emoji}</span>
          <span class="equiv-txt">${U.escapeHtml(main.text)}</span>
        </div>
        ${goalLine ? `<div class="equiv-goal">
          <span class="equiv-goal-ic">🎯</span>
          <span class="equiv-goal-txt">${U.escapeHtml(goalLine.text)}</span>
        </div>` : ''}
        <div class="equiv-note">只是换算，不是说你花错了</div>
      </div>`;
  }

  // ------------------------------------------------------------
  // 合并看板（多账本总览）
  // ------------------------------------------------------------
  function renderMergedCard(p) {
    let board;
    try { board = S.mergedBoard(p); } catch (e) { return ''; }
    if (!board || board.rows.length < 2) return '';
    if (S.isAllBooks && S.isAllBooks()) return '';   // 已经在合并视图里，不重复
    const total = board.total.expense || 1;
    const maxAmt = Math.max.apply(null, board.rows.map((r) => r.expense).concat([1]));
    return `
      <div class="card merged-card">
        <div class="card-head">
          <div class="card-title">${Icons.svg('grid', 16)} 所有账本</div>
          <div class="card-sub">${board.rows.length} 本合计</div>
        </div>
        <div class="merged-total">
          <span class="merged-total-label">全部支出</span>
          <span class="merged-total-amt">${U.money(board.total.expense)}</span>
        </div>
        <div class="merged-stack">
          ${board.rows.filter((r) => r.expense > 0).map((r) => `
            <i style="width:${(r.expense / total * 100).toFixed(2)}%;background:${r.color}"></i>
          `).join('')}
        </div>
        <div class="merged-list">
          ${board.rows.map((r) => `
            <button class="merged-row" data-act="go-book" data-book="${r.id}" type="button">
              <span class="merged-row-ic" style="background:${r.color}1F">${r.icon}</span>
              <span class="merged-row-main">
                <span class="merged-row-name">${U.escapeHtml(r.name)}</span>
                <span class="merged-row-bar"><i style="width:${(r.expense / maxAmt * 100).toFixed(1)}%;background:${r.color}"></i></span>
              </span>
              <span class="merged-row-amt">${U.money(r.expense)}</span>
            </button>`).join('')}
        </div>
        <button class="merged-switch" data-act="switch-all" type="button">
          ${Icons.svg('grid', 13)} 只在这个视图里看全部合计 ${Icons.svg('chevronRight', 12)}
        </button>
      </div>`;
  }

  function scopeName() {
    return { day: '当日', month: '本期', year: '本年' }[state.scope];
  }

  function scopeSubLabel(p) {
    if (state.scope === 'day') {
      const w = U.WEEK_CN[new Date(p.start).getDay()];
      return `星期${w} · 当天统计`;
    }
    if (state.scope === 'year') return '自然年统计';
    return '自然月统计';
  }

  function trendTitle() {
    if (state.scope === 'day') return '当日明细';
    if (state.scope === 'year') return '每月支出趋势';
    return '每日支出趋势';
  }

  /** 日视图用不了「按日柱状」，改成按小时/分类的简单条；年视图按月聚合 */
  function renderTrend(series, maxDay) {
    if (state.scope === 'year') {
      // 年：按月聚合
      const p = period();
      const months = [];
      for (let m = 0; m < 12; m++) {
        const mp = S.monthPeriod(new Date(p.start.getFullYear(), m, 1));
        const ms = S.summary(mp, S.txIn(mp));
        months.push({ day: m + 1, amount: ms.expense, label: mp.key });
      }
      const maxM = months.reduce((a, d) => (d.amount > a.amount ? d : a), { amount: 0, day: 0 });
      return Charts.bars(months, { w: 320, h: 130, highlight: months.indexOf(maxM), labels: 12 });
    }
    if (state.scope === 'day') {
      const sum = S.summary(period(), S.txIn(period()));
      if (!sum.byCat.length) return '<div class="small muted" style="padding:10px 0">这一天没有支出</div>';
      const max = sum.byCat[0].amount || 1;
      return sum.byCat.slice(0, 8).map((c) => `
        <div class="cat-row" style="padding:6px 0">
          <span class="cat-avatar" style="width:30px;height:30px;border-radius:10px;font-size:14px;background:${c.meta.color}1A">${c.meta.icon}</span>
          <span class="cat-main">
            <span class="cat-line1">
              <span class="name" style="font-size:12.5px">${U.escapeHtml(c.meta.name)}${c.sub ? ' · ' + U.escapeHtml(c.sub) : ''}</span>
              <span class="amt" style="font-size:12.5px">${U.money(c.amount)}</span>
            </span>
            <span class="cat-line2">
              <span class="cat-track"><i style="width:${(c.amount / max * 100).toFixed(1)}%;background:${c.meta.color}"></i></span>
              <span class="cat-pct">${Math.round(c.pct * 100)}%</span>
            </span>
          </span>
        </div>`).join('');
    }
    return Charts.bars(series.map((d) => ({ day: d.day, amount: d.amount, label: d.key })), {
      w: 320, h: 130, highlight: series.indexOf(maxDay), labels: 6,
    });
  }

  // ------------------------------------------------------------
  // 选择对比区间
  // ------------------------------------------------------------
  function openCmpPicker() {
    const cp = cmpPeriod();
    const unit = SCOPE_UNIT[state.scope];
    const p = period();

    const presets = [];
    if (state.scope === 'day') {
      presets.push({ label: '昨天', ts: U.addDays(new Date(p.start), -1).getTime() });
      presets.push({ label: '上周同一天', ts: U.addDays(new Date(p.start), -7).getTime() });
      presets.push({ label: '上月同一天', ts: new Date(p.start.getFullYear(), p.start.getMonth() - 1, p.start.getDate()).getTime() });
      presets.push({ label: '去年同一天', ts: new Date(p.start.getFullYear() - 1, p.start.getMonth(), p.start.getDate()).getTime() });
    } else if (state.scope === 'month') {
      presets.push({ label: '上个月', ts: new Date(p.start.getFullYear(), p.start.getMonth() - 1, 1).getTime() });
      presets.push({ label: '去年同月', ts: new Date(p.start.getFullYear() - 1, p.start.getMonth(), 1).getTime() });
      presets.push({ label: '前年同月', ts: new Date(p.start.getFullYear() - 2, p.start.getMonth(), 1).getTime() });
    } else {
      presets.push({ label: '去年', ts: new Date(p.start.getFullYear() - 1, 0, 1).getTime() });
      presets.push({ label: '前年', ts: new Date(p.start.getFullYear() - 2, 0, 1).getTime() });
      presets.push({ label: '三年前', ts: new Date(p.start.getFullYear() - 3, 0, 1).getTime() });
    }

    UI.openSheet({
      title: `和哪个${unit}对比`,
      content: `
        <div class="small muted" style="line-height:1.7;margin-bottom:14px">
          当前查看 <b>${U.escapeHtml(p.label)}</b>，选一个${unit}作对比，下面所有数字和图表都会跟着换。
        </div>
        <div class="cmp-presets">
          ${presets.map((x) => `
            <button class="cmp-chip ${state.cmpTs === x.ts ? 'on' : ''}" data-ts="${x.ts}" type="button">${x.label}</button>`).join('')}
        </div>
        <div class="set-card" style="margin-top:14px">
          <button class="set-row" data-act="custom" type="button">
            <span class="set-ic">${Icons.svg('calendar', 16)}</span>
            <span class="set-main">
              <span class="set-name">自己选一个${unit}</span>
              <span class="set-desc">当前：${U.escapeHtml(cp.label)}</span>
            </span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
        </div>
        ${state.cmpTs ? `
          <button class="btn btn--ghost" style="margin-top:12px" data-act="reset" type="button">恢复默认（上一个${unit}）</button>` : ''}
        <style>
          .cmp-presets { display:flex; flex-wrap:wrap; gap:9px; }
          .cmp-chip { padding:9px 15px; border-radius:999px; font-size:13px; font-weight:600;
            background:var(--card-2); border:1px solid var(--line); color:var(--text-2); }
          .cmp-chip.on { background:var(--brand-soft); border-color:var(--brand); color:var(--brand); }
        </style>
      `,
      onMount(body, close) {
        body.querySelectorAll('[data-ts]').forEach((b) => {
          b.addEventListener('click', () => {
            state.cmpTs = Number(b.dataset.ts);
            close();
            refresh();
          });
        });
        body.querySelector('[data-act="custom"]').addEventListener('click', () => {
          close();
          UI.datePicker({
            title: `选择对比的${unit}`,
            value: new Date(cp.start).getTime(),
            onPick(ts) {
              state.cmpTs = ts;
              refresh();
            },
          });
        });
        const reset = body.querySelector('[data-act="reset"]');
        if (reset) reset.addEventListener('click', () => {
          state.cmpTs = null;
          close();
          refresh();
        });
      },
    });
  }

  // ------------------------------------------------------------
  // AI 总结卡
  // ------------------------------------------------------------
  function renderAiCard(p) {
    if (!global.AI || !global.AI.ready()) return '';
    const cached = global.AI.cachedMonth(p);
    const list = S.txIn(p);
    if (!list.length && !cached) return '';

    if (!cached) {
      return `
        <div class="card ai-report anim-in" data-d="1">
          <div class="card-head">
            <div class="card-title">${Icons.svg('sparkle', 16)} AI ${scopeUnitName()}总结</div>
            <span class="pill pill--brand">未生成</span>
          </div>
          <div class="small muted" style="line-height:1.75;margin-bottom:14px">
            让 AI 读一遍这段账，写一段总结，并挑一张最值得看的图。
          </div>
          <button class="btn btn--primary" data-ai="month" type="button">
            ${Icons.svg('sparkle', 14)} 生成${scopeUnitName()}总结
          </button>
        </div>
      `;
    }

    const chartHtml = renderAiChart(cached, p);
    return `
      <div class="card ai-report anim-in" data-d="1">
        <div class="card-head">
          <div class="card-title">${Icons.svg('sparkle', 16)} AI ${scopeUnitName()}总结</div>
          <button class="card-more" data-ai="month-regen" type="button">重新生成 ${Icons.svg('refresh', 11)}</button>
        </div>
        ${cached.headline ? `<div class="ai-report-headline">${U.escapeHtml(cached.headline)}</div>` : ''}
        <div class="ai-report-story">${U.escapeHtml(cached.story)}</div>
        ${cached.highlights && cached.highlights.length ? `
          <div class="ai-hl-row">
            ${cached.highlights.map((h) => `
              <div class="ai-hl">
                <span class="ai-hl-label">${U.escapeHtml(h.label)}</span>
                <span class="ai-hl-value">${U.escapeHtml(h.value)}</span>
              </div>`).join('')}
          </div>` : ''}
        ${cached.advice && cached.advice.length ? `
          <div class="ai-advice-list">
            ${cached.advice.map((a, i) => `
              <div class="ai-advice-item">
                <span class="ai-num">${i + 1}</span>
                <span>${U.escapeHtml(a)}</span>
              </div>`).join('')}
          </div>` : ''}
        ${chartHtml}
        <div class="ai-report-foot">
          <span>由 ${U.escapeHtml(String(cached.model || '').replace(/^.*\//, ''))} 生成</span>
          <span>${U.relTime(cached.ts)}</span>
        </div>
      </div>
    `;
  }

  function scopeUnitName() {
    return { day: '日', month: '月度', year: '年度' }[state.scope];
  }

  /** 按 AI 选择的维度画图 */
  function renderAiChart(rep, p) {
    const c = rep.chart || { type: 'donut', dimension: 'cat', title: '支出结构' };
    const list = S.txIn(p);
    const sum = S.summary(p, list);
    let body = '';

    if (c.type === 'compare') {
      const cp = cmpPeriod();
      const cmpSum = S.summary(cp, S.txIn(cp));
      if (!cmpSum.expense) return '';
      body = renderCompare(sum, cmpSum);
    } else if (c.dimension === 'day' || c.type === 'bars') {
      const series = S.dailySeries(p);
      const maxDay = series.reduce((a, d) => (d.amount > a.amount ? d : a), { amount: 0, day: 0 });
      body = Charts.bars(series.map((d) => ({ day: d.day, amount: d.amount, label: d.key })), {
        w: 320, h: 130, highlight: series.indexOf(maxDay), labels: 6,
      });
    } else if (c.dimension === 'account') {
      const accs = (sum.byAccountList || []).slice(0, 6);
      if (!accs.length) return '';
      const maxA = accs[0].amount || 1;
      body = accs.map((a) => `
        <div class="cat-row" style="padding:6px 0">
          <span class="cat-avatar" style="width:30px;height:30px;border-radius:10px;font-size:14px;background:var(--brand-soft)">${a.meta.icon}</span>
          <span class="cat-main">
            <span class="cat-line1">
              <span class="name" style="font-size:12.5px">${U.escapeHtml(a.meta.name)}</span>
              <span class="amt" style="font-size:12.5px">${U.money(a.amount)}</span>
            </span>
            <span class="cat-line2">
              <span class="cat-track"><i style="width:${(a.amount / maxA * 100).toFixed(1)}%;background:var(--brand)"></i></span>
              <span class="cat-pct">${Math.round(a.pct * 100)}%</span>
            </span>
          </span>
        </div>`).join('');
    } else {
      const cats = sum.byCat.slice(0, 7);
      if (!cats.length) return '';
      const data = cats.map((x) => ({ label: x.meta.name, value: x.amount, color: x.meta.color }));
      body = `<div style="display:flex;justify-content:center;padding:6px 0 12px">
        ${Charts.donut(data, { size: 172, thickness: 19, centerTop: U.moneyCompact(sum.expense), centerSub: '总支出' })}
      </div>
      <div class="legend-grid">
        ${cats.map((x) => `
          <div class="legend-item">
            <span class="legend-dot" style="background:${x.meta.color}"></span>
            <span class="legend-name">${U.escapeHtml(x.meta.name)}</span>
            <span class="legend-val">${Math.round(x.pct * 100)}%</span>
          </div>`).join('')}
      </div>`;
    }

    return `
      <div style="margin-top:15px;padding-top:13px;border-top:1px dashed rgba(124,92,255,.2)">
        <div class="card-title" style="font-size:12.5px;margin-bottom:10px">${Icons.svg('chart', 14)} ${U.escapeHtml(c.title || '支出结构')}</div>
        ${body}
        ${c.reason ? `<div class="ai-chart-reason">AI 选择这张图的理由：${U.escapeHtml(c.reason)}</div>` : ''}
      </div>
    `;
  }

  function renderBudgetCard(b, p) {
    const cls = b.level === 'over' ? 'over' : b.level === 'warn' ? 'warn' : '';
    return `
      <div class="card budget-card anim-in" data-d="1">
        <div class="card-head">
          <div class="card-title">${Icons.svg('wallet', 16)} 预算执行</div>
          <span class="pill ${b.level === 'over' ? 'pill--danger' : b.level === 'warn' ? 'pill--warn' : 'pill--brand'}">
            ${b.level === 'over' ? '已超支' : b.level === 'warn' ? '需注意' : '健康'}
          </span>
        </div>
        <div class="row" style="justify-content:space-between;align-items:baseline">
          <span style="font-size:24px;font-weight:700;font-variant-numeric:tabular-nums">${U.money(b.spent)}</span>
          <span class="small muted">/ 预算 ${U.money(b.total)}</span>
        </div>
        <div class="bar-wrap ${cls}"><i style="width:${U.clamp(b.pct * 100, 0, 100).toFixed(1)}%"></i></div>
        <div class="budget-nums">
          <span>已用 <b>${Math.round(b.pct * 100)}%</b></span>
          <span>${b.remaining >= 0 ? '剩余' : '超支'} <b class="${b.remaining < 0 ? 'text-expense' : ''}">${U.money(Math.abs(b.remaining))}</b></span>
        </div>
        ${b.cats.length ? `
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
            <div class="small muted" style="margin-bottom:8px">分类预算</div>
            ${b.cats.slice(0, 5).map((c) => `
              <div style="margin-bottom:9px">
                <div class="row" style="justify-content:space-between;font-size:12px;margin-bottom:4px">
                  <span>${c.meta.icon} ${c.meta.name}</span>
                  <span class="tnum ${c.pct >= 1 ? 'text-expense' : ''}">${U.money(c.used)} / ${U.money(c.limit)}</span>
                </div>
                <div class="cat-track"><i style="width:${U.clamp(c.pct * 100, 0, 100).toFixed(1)}%;background:${c.pct >= 1 ? 'var(--danger)' : c.meta.color}"></i></div>
              </div>`).join('')}
          </div>` : ''}
      </div>
    `;
  }

  function renderCompare(sum, cmpSum) {
    const map = {};
    sum.byCat.forEach((c) => { map[c.id] = { id: c.id, a: c.amount, b: 0, meta: c.meta }; });
    cmpSum.byCat.forEach((c) => {
      if (!map[c.id]) map[c.id] = { id: c.id, a: 0, b: 0, meta: c.meta };
      map[c.id].b = c.amount;
    });
    const rows = Object.values(map).sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b)).slice(0, 6);
    const max = Math.max.apply(null, rows.map((r) => Math.max(r.a, r.b)).concat([1]));
    const unit = SCOPE_UNIT[state.scope];
    return `
      <div class="row gap8" style="margin-bottom:12px;font-size:11.5px">
        <span class="row gap8"><span class="legend-dot" style="background:var(--brand)"></span>当前</span>
        <span class="row gap8"><span class="legend-dot" style="background:var(--line-2)"></span>对比的${unit}</span>
      </div>
      ${rows.map((r) => {
        const diff = r.a - r.b;
        return `<div class="mc-row">
          <span class="mc-label">${r.meta.icon} ${r.meta.name}</span>
          <span class="mc-track" style="height:22px;background:none;position:relative">
            <i class="cur" style="width:${(r.a / max * 100).toFixed(1)}%;height:9px;top:1px;background:${r.meta.color}"></i>
            <i class="old" style="width:${(r.b / max * 100).toFixed(1)}%;height:9px;top:12px;background:var(--line-2)"></i>
          </span>
          <span class="mc-val" style="width:76px">
            ${U.moneyCompact(r.a)}
            <span class="small ${diff > 0 ? 'text-expense' : diff < 0 ? 'text-income' : 'muted'}" style="display:block;font-size:10px">
              ${r.b ? (diff > 0 ? '+' : '') + U.moneyCompact(diff) : '新增'}
            </span>
          </span>
        </div>`;
      }).join('')}
    `;
  }

  // ------------------------------------------------------------
  // 洞察生成
  // ------------------------------------------------------------
  function buildInsights(sum, cmpSum, series, cmpSeries, b, p, activeDays, cp) {
    const out = [];
    if (!sum.expense) return out;
    const unit = SCOPE_UNIT[state.scope];

    if (sum.byCat.length) {
      const top = sum.byCat[0];
      out.push({
        icon: top.meta.icon,
        text: `最大支出是 <b>${top.meta.name}</b>，共 <b>${U.money(top.amount)}</b>，占 ${Math.round(top.pct * 100)}%。`,
      });
    }

    if (cmpSum.expense > 0) {
      const diff = sum.expense - cmpSum.expense;
      const pct = Math.abs(diff / cmpSum.expense);
      if (pct >= 0.05) {
        out.push({
          icon: diff > 0 ? '📈' : '📉',
          text: `比 ${U.escapeHtml(cp.label)} ${diff > 0 ? '多花' : '少花'}了 <b>${U.money(Math.abs(diff))}</b>（${Math.round(pct * 100)}%）${diff > 0 ? '，注意控制节奏。' : '，继续保持。'}`,
        });
      } else {
        out.push({ icon: '⚖️', text: `与 ${U.escapeHtml(cp.label)} 支出基本持平，消费习惯比较稳定。` });
      }
    }

    const maxDay = series.reduce((a, d) => (d.amount > a.amount ? d : a), { amount: 0 });
    if (maxDay.amount > 0 && sum.expense > 0 && state.scope !== 'day') {
      const share = maxDay.amount / sum.expense;
      if (share > 0.2) {
        out.push({
          icon: '💥',
          text: `<b>${maxDay.day} 日</b>单日支出 <b>${U.money(maxDay.amount)}</b>，占全${unit} ${Math.round(share * 100)}%，是花得最狠的一天。`,
        });
      }
    }

    if (b.total && state.scope === 'month') {
      if (b.level === 'over') {
        out.push({ icon: '🚨', text: `预算已超支 <b>${U.money(-b.remaining)}</b>，超支比例 ${Math.round(b.pct * 100)}%，下期建议把预算调到 <b>${U.money(Math.round(sum.expense * 1.05 / 10000) * 10000)}</b> 左右更贴合实际。` });
      } else if (b.level === 'warn') {
        out.push({ icon: '⚠️', text: `预算已用 <b>${Math.round(b.pct * 100)}%</b>，还剩 ${U.money(b.remaining)} 可用，日均建议控制在 <b>${U.money(b.dailyAllowance)}</b> 以内。` });
      } else if (b.pct < 0.6 && b.isCurrent) {
        out.push({ icon: '🎉', text: `预算执行得很健康，目前只用掉 <b>${Math.round(b.pct * 100)}%</b>，按当前节奏预计能结余 <b>${U.money(b.remaining)}</b>。` });
      }
    }

    if (sum.income > 0) {
      const rate = sum.net / sum.income;
      if (rate >= 0.3) out.push({ icon: '💎', text: `结余率 <b>${Math.round(rate * 100)}%</b>，收入里有 ${U.money(sum.net)} 变成了存款，很棒。` });
      else if (rate < 0) out.push({ icon: '😬', text: `支出超过了收入，差额 <b>${U.money(-sum.net)}</b>，建议检查大额支出。` });
    }

    if (sum.expCount > 0) {
      const avg = sum.expense / sum.expCount;
      out.push({ icon: '🧾', text: `共记 <b>${sum.expCount}</b> 笔支出，笔均 <b>${U.money(avg)}</b>，活跃 ${activeDays} 天。` });
    }

    return out.slice(0, 5);
  }

  // ------------------------------------------------------------
  function bind(root, p, sum) {
    root.querySelectorAll('[data-nav]').forEach((b) => {
      b.addEventListener('click', () => {
        shift(Number(b.dataset.nav));
        render(root);
        if (global.App && global.App.refreshTopbar) global.App.refreshTopbar();
      });
    });
    root.querySelectorAll('[data-scope]').forEach((b) => {
      b.addEventListener('click', () => {
        if (state.scope === b.dataset.scope) return;
        state.scope = b.dataset.scope;
        state.cmpTs = null;
        render(root);
        U.vibrate(6);
        if (global.App && global.App.refreshTopbar) global.App.refreshTopbar();
      });
    });
    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const a = b.dataset.act;
        if (a === 'go-add') App.go('add');
        else if (a === 'export') openExport(sum, p);
        else if (a === 'pick-cmp') openCmpPicker();
        else if (a === 'reset-cmp') { state.cmpTs = null; render(root); }
        else if (a === 'go-book') {
          const id = b.dataset.book;
          if (id) { S.switchBook(id); if (global.App) { App.refreshTopbar(); App.refresh(); } }
        } else if (a === 'switch-all') {
          S.switchBook('*');
          if (global.App) { App.refreshTopbar(); App.refresh(); }
          U.toast('已切到「所有账本」，新记的账会进第一本');
        }
      });
    });

    root.querySelectorAll('[data-ai]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.__busy) return;
        const regen = b.dataset.ai === 'month-regen';
        const label = b.innerHTML;
        b.__busy = true;
        b.disabled = true;
        b.innerHTML = `<span class="tip-ai-spin" style="display:inline-block;vertical-align:-2px"></span> ${regen ? '重新生成中…' : 'AI 正在读账本…'}`;
        global.AI.monthReport(p, { force: regen })
          .then(() => {
            b.__busy = false;
            render(root);
            U.toast('AI 总结已生成', 'success');
          })
          .catch((err) => {
            b.__busy = false;
            b.disabled = false;
            b.innerHTML = label;
            U.toast(err.message || '生成失败', 'error');
          });
      });
    });

    if (global.Tips) global.Tips.bind(root);
  }

  function openExport(sum, p) {
    UI.openSheet({
      title: '导出本期数据',
      content: `
        <div class="small muted" style="line-height:1.7;margin-bottom:16px">
          导出 ${U.escapeHtml(p.label)} 的全部账目，可保存到电脑用 Excel 打开，或作为备份。
        </div>
        <div class="set-card" style="margin-bottom:16px">
          <button class="set-row" data-act="csv" type="button">
            <span class="set-ic">${Icons.svg('download', 16)}</span>
            <span class="set-main"><span class="set-name">导出 CSV 表格</span>
              <span class="set-desc">可用 Excel / WPS 打开</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="json" type="button">
            <span class="set-ic income">${Icons.svg('download', 16)}</span>
            <span class="set-main"><span class="set-name">导出完整备份 JSON</span>
              <span class="set-desc">包含设置、目标与全部账目</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="summary" type="button">
            <span class="set-ic warn">${Icons.svg('copy', 16)}</span>
            <span class="set-main"><span class="set-name">复制文字总结</span>
              <span class="set-desc">粘贴到微信 / 备忘录分享</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
        </div>
      `,
      onMount(body, close) {
        body.querySelector('[data-act="csv"]').addEventListener('click', () => {
          App.download('花哪儿了-' + p.label + '.csv', S.exportCSV(p), 'text/csv;charset=utf-8');
          close(); U.toast('已导出 CSV', 'success');
        });
        body.querySelector('[data-act="json"]').addEventListener('click', () => {
          App.download('花哪儿了备份-' + U.ymd(new Date()) + '.json', S.exportJSON(), 'application/json');
          close(); U.toast('已导出备份', 'success');
        });
        body.querySelector('[data-act="summary"]').addEventListener('click', () => {
          const text = buildSummaryText(sum, p);
          copyText(text);
          close();
        });
      },
    });
  }

  function buildSummaryText(sum, p) {
    const cp = cmpPeriod();
    const cmpSum = S.summary(cp, S.txIn(cp));
    const lines = [
      `【花哪儿了】${p.label} 总结`,
      `支出：${U.money(sum.expense)}　收入：${U.money(sum.income)}　结余：${U.money(sum.net)}`,
      `共 ${sum.count} 笔，日均支出 ${U.money(sum.avgDaily)}`,
    ];
    if (cmpSum.expense > 0) {
      lines.push(`对比 ${cp.label}（${U.money(cmpSum.expense)}）：${sum.expense >= cmpSum.expense ? '多花' : '少花'} ${U.money(Math.abs(sum.expense - cmpSum.expense))}`);
    }
    if (sum.byCat.length) {
      lines.push('分类 TOP3：');
      sum.byCat.slice(0, 3).forEach((c, i) => {
        lines.push(`  ${i + 1}. ${c.meta.name} ${U.money(c.amount)}（${Math.round(c.pct * 100)}%）`);
      });
    }
    return lines.join('\n');
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => U.toast('已复制到剪贴板', 'success'),
        () => fallbackCopy(text)
      );
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); U.toast('已复制到剪贴板', 'success'); }
    catch (e) { U.toast('复制失败，请手动选择', 'error'); }
    ta.remove();
  }

  function refresh() {
    const root = $('#view-report');
    if (root) render(root);
  }

  global.ViewReport = {
    render, refresh,
    reset() { state.anchor = Date.now(); state.cmpTs = null; },
    setScope(s) { if (SCOPE_LABEL[s]) { state.scope = s; state.cmpTs = null; } },
    openCmpPicker,
    get state() { return state; },
  };
})(window);
