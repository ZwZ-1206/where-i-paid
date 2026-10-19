/* ============================================================
 * 记账本 · 提醒中心
 * 汇总三类提醒：订阅即将续费 / 垫付该催了 / 想买的东西冷静期到了
 * 纯本地计算，零依赖
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;
  const Icons = global.Icons;

  const DAY = 86400000;

  function dLeft(ts) {
    const today = U.startOfDay(new Date()).getTime();
    const target = U.startOfDay(new Date(ts)).getTime();
    return Math.round((target - today) / DAY);
  }

  function fmtLeft(days) {
    if (days === 0) return '今天';
    if (days === 1) return '明天';
    if (days === -1) return '昨天';
    if (days < 0) return `已过 ${-days} 天`;
    return `${days} 天后`;
  }

  /**
   * 汇总所有提醒，按紧急程度排序
   * @returns {Array<{id, kind, title, desc, meta, days, urgent, ts, data}>}
   */
  function list(now) {
    const ts = now || Date.now();
    const out = [];

    // ---- 1. 订阅即将续费 ----
    let subs = [];
    try { subs = S.subsDue(ts); } catch (e) { subs = []; }
    subs.forEach((s) => {
      const alreadyReminded = s.remindedFor === s.nextTs;
      out.push({
        id: 'sub:' + s.key + ':' + s.nextTs,
        kind: 'sub',
        title: `「${s.name}」${fmtLeft(s.daysToNext)}续费`,
        desc: `预计扣 ${U.money(s.avgAmount)}，已连续扣 ${s.times} 次、累计 ${U.money(s.totalPaid)}。不想续的话提前去关掉自动续费。`,
        meta: `下次 ${U.fullDate(s.nextTs)}`,
        days: s.daysToNext,
        urgent: s.daysToNext <= 1,
        ts: s.nextTs,
        remindedFor: s.nextTs,
        data: s,
        alreadyReminded,
      });
    });

    // ---- 2. 垫付该催了 ----
    const cfg = (S.settings && S.settings.advance) || {};
    if (cfg.enabled !== false) {
      const remindDays = Math.max(0, Number(cfg.remindDays) || 0);
      let open = [];
      try { open = S.advances(true); } catch (e) { open = []; }
      open.forEach((t) => {
        const due = t.advance.dueTs;
        const left = due ? dLeft(due) : null;
        const overdue = due && left < 0;
        const soon = due && left >= 0 && left <= remindDays;
        // 没设到期日就不提醒（免得天天烦）
        if (!due) return;
        if (!overdue && !soon) return;
        const who = t.advance.who || '别人';
        out.push({
          id: 'adv:' + t.id,
          kind: 'advance',
          // 到了还款日就直接问「还回来了吗」，而不是干巴巴报天数
          title: overdue
            ? `${who} 的钱还回来了吗？`
            : `「${who}」的钱 ${fmtLeft(left)} 到期`,
          desc: overdue
            ? `${U.fullDate(t.ts)} 垫了 ${U.money(t.amount)}${t.note ? `（${t.note}）` : ''}，应还日 ${U.fullDate(due)}。回来了就点「已归还」，这笔会从账目里抹掉。`
            : `${U.fullDate(t.ts)} 帮 ${who} 垫了 ${U.money(t.amount)}${t.note ? `（${t.note}）` : ''}，还没收回。`,
          meta: `应还日 ${U.fullDate(due)}`,
          days: left,
          urgent: overdue || left === 0,
          ts: due,
          data: t,
        });
      });
    }

    // ---- 3. 想买的东西冷静期到了 ----
    let ready = [];
    try { ready = S.wishReady(ts); } catch (e) { ready = []; }
    ready.forEach((w) => {
      out.push({
        id: 'wish:' + w.id,
        kind: 'wish',
        title: `「${w.name}」冷静期到了`,
        desc: '冷静期已过。还想买吗？还是算了？——「算了」的金额会累积到忍住基金',
        meta: `${U.money(w.amount)} · 记于 ${U.humanDate(w.createdAt)}`,
        days: 0,
        urgent: false,
        ts: w.dueTs,
        data: w,
      });
    });

    return out.sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return (a.days == null ? 999 : a.days) - (b.days == null ? 999 : b.days);
    });
  }

  /** 有多少条需要「打断」用户的（启动弹窗用） */
  function urgentCount(now) {
    return list(now).filter((r) => r.urgent).length;
  }

  // ------------------------------------------------------------
  // 启动时的小横幅（不打断，只提示）
  // ------------------------------------------------------------
  let bannerEl = null;
  let bannerTimer = 0;

  function showBanner(now) {
    hideBanner();
    const items = list(now);
    if (!items.length) return;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'remind-banner';
    el.setAttribute('data-remind', 'open');
    const first = items[0];
    const more = items.length > 1 ? `<span class="remind-more">+${items.length - 1}</span>` : '';
    const icon = first.kind === 'sub' ? '🔁' : (first.kind === 'advance' ? '💸' : '🛍️');
    el.innerHTML = `
      <span class="remind-ic">${icon}</span>
      <span class="remind-txt">${U.escapeHtml(first.title)}</span>
      ${more}
      <span class="remind-go">${Icons.svg('chevronRight', 15)}</span>
    `;
    el.addEventListener('click', () => { open(); });
    document.body.appendChild(el);
    bannerEl = el;
    setTimeout(() => { if (bannerEl === el) el.classList.add('in'); }, 30);
    // 横幅贴在顶栏下方，会暂时压住账本切换条 —— 自动收起，不长期占用
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { if (bannerEl === el) hideBanner(); }, 7000);
  }

  function hideBanner() {
    if (!bannerEl) return;
    const el = bannerEl;
    bannerEl = null;
    el.classList.remove('in');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
  }

  // ------------------------------------------------------------
  // 提醒中心弹层
  // ------------------------------------------------------------
  function open() {
    hideBanner();
    const UI = global.UI;
    UI.openSheet({
      title: '提醒中心',
      content: renderBody(),
      onMount(body, close) { mount(body, close); },
    });
  }

  function renderBody() {
    const items = list();
    if (!items.length) {
      return `
        <div class="empty" style="padding:34px 0 22px">
          <div class="empty-emoji">🌿</div>
          <div class="empty-title">暂时没有要提醒的事</div>
          <div class="empty-desc">订阅快续费、垫付到期、想买的东西冷静期结束，都会出现在这里</div>
        </div>`;
    }
    return `
      <div class="small muted" style="line-height:1.75;margin-bottom:14px">
        共 ${items.length} 条。${items.filter((i) => i.urgent).length ? `<b>${items.filter((i) => i.urgent).length} 条比较急</b>，` : ''}处理完就不会再提醒。
      </div>
      <div class="remind-list">
        ${items.map((r) => renderRow(r)).join('')}
      </div>
    `;
  }

  const KIND_LABEL = { sub: '订阅续费', advance: '垫付催款', wish: '冷静期到了' };
  const KIND_EMOJI = { sub: '🔁', advance: '💸', wish: '🛍️' };

  function renderRow(r) {
    return `
      <div class="remind-row ${r.urgent ? 'urgent' : ''}" data-kind="${r.kind}">
        <span class="remind-row-ic">${KIND_EMOJI[r.kind]}</span>
        <div class="remind-row-main">
          <div class="remind-row-top">
            <span class="remind-row-name">${U.escapeHtml(r.title)}</span>
            <span class="remind-badge">${KIND_LABEL[r.kind]}</span>
          </div>
          <div class="remind-row-desc">${U.escapeHtml(r.desc)}</div>
          <div class="remind-row-meta">${U.escapeHtml(r.meta || '')}</div>
          <div class="remind-row-ops">
            ${opsFor(r)}
          </div>
        </div>
      </div>`;
  }

  function opsFor(r) {
    if (r.kind === 'sub') {
      return `
        <button class="btn btn--sm btn--primary" data-ract="sub-off" data-key="${U.escapeHtml(r.data.key)}" type="button">已关掉续费</button>
        <button class="btn btn--sm btn--ghost" data-ract="sub-rule" data-key="${U.escapeHtml(r.data.key)}" type="button">转成周期记账</button>
        <button class="btn btn--sm btn--ghost" data-ract="sub-later" data-key="${U.escapeHtml(r.data.key)}" data-next="${r.remindedFor || 0}" type="button">下次再说</button>`;
    }
    if (r.kind === 'advance') {
      return `
        <button class="btn btn--sm btn--primary" data-ract="adv-settle" data-id="${r.data.id}" type="button">已归还</button>
        <button class="btn btn--sm btn--ghost" data-ract="adv-snooze" data-id="${r.data.id}" type="button">还没还</button>`;
    }
    return `
      <button class="btn btn--sm btn--primary" data-ract="wish-buy" data-id="${r.data.id}" type="button">还是买了</button>
      <button class="btn btn--sm btn--ghost" data-ract="wish-drop" data-id="${r.data.id}" type="button">算了，省下</button>`;
  }

  function mount(body, close) {
    body.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-ract]');
      if (!b) return;
      const act = b.dataset.ract;
      const rerender = () => {
        const html = renderBody();
        body.innerHTML = html;
        body.scrollTop = 0;
        mount(body, close);
      };

      if (act === 'sub-off') {
        S.ignoreSub(b.dataset.key, true);
        U.toast('已标记，不再提醒这个订阅', 'success');
        rerender();
      } else if (act === 'sub-rule') {
        const items = list();
        const r = items.find((x) => x.kind === 'sub' && x.data.key === b.dataset.key);
        if (r) {
          try {
            S.subToRepeat(r.data);
            S.ignoreSub(b.dataset.key, true);
            U.toast('已转成周期记账规则', 'success');
          } catch (err) { U.toast(err.message || '转换失败', 'error'); }
        }
        rerender();
      } else if (act === 'sub-later') {
        S.markSubReminded(b.dataset.key, Number(b.dataset.next) || Date.now());
        U.toast('好，这次先不提醒了');
        rerender();
      } else if (act === 'adv-settle') {
        // 归还 = 这笔不是你花的钱，记录留着（划掉），但不再算支出
        S.settleAdvance(b.dataset.id);
        U.toast('已归还：记录留着，但这笔不再计入支出', 'success');
        if (global.App) global.App.refresh();
        rerender();
      } else if (act === 'adv-snooze') {
        const t = S.txById(b.dataset.id);
        if (t && t.advance) {
          const base = Math.max(Date.now(), t.advance.dueTs || 0);
          S.setAdvance(t.id, { dueTs: base + 3 * DAY });
          U.toast('已推迟 3 天');
        }
        rerender();
      } else if (act === 'wish-buy') {
        S.buyWish(b.dataset.id);
        U.toast('已记成一笔支出', 'success');
        if (global.App) global.App.refresh();
        rerender();
      } else if (act === 'wish-drop') {
        S.dropWish(b.dataset.id);
        U.toast('省下了，已累积到「忍住基金」', 'success');
        if (global.App) global.App.refresh();
        rerender();
      }
    });
  }

  global.Remind = {
    list, urgentCount, showBanner, hideBanner, open, renderBody,
  };
})(window);
