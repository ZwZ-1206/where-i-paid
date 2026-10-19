/* ============================================================
 * 花哪儿了 · 攒钱目标
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;
  const $ = U.$;

  const ICONS = ['🎯', '✈️', '🏠', '🚗', '💻', '📱', '🎓', '💍', '🏖️', '🎸', '🚲', '🐱', '🎁', '💰', '🛋️', '⌚'];
  const COLORS = ['#4F7CFF', '#7C5CFF', '#14B87A', '#FF7A45', '#FF5A5F', '#FFB020', '#13C2C2', '#EB2F96'];

  function render(root) {
    // 情侣那几本（小金库 / 约会基金 / 见面基金）不在这儿露面：
    // 它们的存取流水是一份共同回忆，入口都在「情侣」栏里。
    const all = S.state.goals.filter((g) => !g.archived);
    const goals = all.filter((g) => g.kind !== 'couple');
    const done = goals.filter((g) => g.target > 0 && g.saved >= g.target);
    const totalSaved = goals.reduce((s, g) => s + g.saved, 0);
    const totalTarget = goals.reduce((s, g) => s + g.target, 0);
    const pct = totalTarget ? totalSaved / totalTarget : 0;

    root.innerHTML = `
      <div class="goal-hero anim-in">
        <div class="gh-label">累计已攒</div>
        <div class="gh-amount">${U.money(totalSaved)}</div>
        <div class="gh-sub">${goals.length} 个进行中的目标 · 总目标 ${U.money(totalTarget)}</div>
        <div class="budget-bar" style="margin-top:14px"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
        <div class="hero-foot"><span>完成度 ${Math.round(pct * 100)}%</span><span>${done.length} 个已达成</span></div>
      </div>

      <button class="btn btn--primary" style="margin-bottom:14px" data-act="new" type="button">
        ${Icons.svg('plus', 18)} 新建攒钱目标
      </button>

      ${goals.length ? goals.map(goalCard).join('') : `
        <div class="empty">
          <div class="empty-emoji">🎯</div>
          <div class="empty-title">还没有攒钱目标</div>
          <div class="empty-desc">给自己定一个小目标，比如一次旅行、一台新电脑，<br/>每次存入都能看到进度条往前走。</div>
          <button class="empty-btn" data-act="new" type="button">创建第一个目标</button>
        </div>`}

      ${done.length ? `
        <div class="section-title">已达成 · ${done.length}</div>
        ${done.map(goalCard).join('')}
      ` : ''}
    `;

    bind(root);
  }

  function goalCard(g) {
    const p = S.goalProgress(g);
    const done = p.done;
    // 情侣金库可以先把钱存着、之后再定目标（target 为 0）
    const noTarget = !g.target;
    const isCouple = g.kind === 'couple';
    return `
      <div class="goal-card ${isCouple ? 'goal-card--couple' : ''}" data-goal="${g.id}">
        <div class="goal-top">
          <span class="goal-icon" style="background:${g.color}1F">${g.icon}</span>
          <span class="goal-name">${U.escapeHtml(g.name)}</span>
          ${isCouple ? '<span class="goal-badge goal-badge--couple">我们的</span>' : ''}
          ${done ? '<span class="goal-badge">已达成 🎉</span>' : ''}
        </div>
        <div class="goal-nums">
          <span class="now">${U.money(g.saved)}</span>
          ${noTarget
            ? '<span class="tgt">还没定目标</span>'
            : `<span class="tgt">/ ${U.money(g.target)}</span>
               <span class="pct" style="color:${g.color}">${Math.round(p.pct * 100)}%</span>`}
        </div>
        <div class="goal-track"><i style="width:${(p.pct * 100).toFixed(1)}%;background:linear-gradient(90deg,${g.color},${g.color}CC)"></i></div>
        <div class="goal-foot">
          <span>${noTarget ? '点右边铅笔设个目标金额'
            : done ? '恭喜达成目标' : '还差 ' + U.money(p.left)}</span>
          <span>${noTarget ? '' : p.daysLeft != null
            ? (done ? `目标日 ${fmtD(g.deadline)}` : `还剩 ${p.daysLeft} 天 · 每月存 ${U.money(p.perMonth)}`)
            : (p.eta != null ? `按当前速度约 ${p.eta} 天达成` : '未设截止日期')}</span>
        </div>
        <div class="goal-actions">
          <button class="goal-btn" data-act="deposit" data-id="${g.id}" type="button">${Icons.svg('plus', 14)} 存入</button>
          <button class="goal-btn goal-btn--ghost" data-act="withdraw" data-id="${g.id}" type="button">${Icons.svg('minus', 14)} 取出</button>
          <button class="goal-btn goal-btn--ghost" style="flex:0 0 40px" data-act="more" data-id="${g.id}" type="button">${Icons.svg('edit', 15)}</button>
        </div>
      </div>`;
  }

  function fmtD(s) {
    if (!s) return '—';
    const d = new Date(s);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  function bind(root) {
    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'new') openEditor(null);
        else if (act === 'deposit') openDeposit(b.dataset.id, 'in');
        else if (act === 'withdraw') openDeposit(b.dataset.id, 'out');
        else if (act === 'more') openMore(b.dataset.id);
      });
    });
  }

  // ------------------------------------------------------------
  // 新建 / 编辑目标
  // ------------------------------------------------------------
  function openEditor(goal) {
    const g = goal || {
      name: '', icon: '🎯', target: '', deadline: U.ymd(U.addDays(new Date(), 180)),
      color: COLORS[0], note: '', saved: 0,
    };
    let cur = { icon: g.icon, color: g.color, deadline: g.deadline };

    UI.openSheet({
      title: goal ? '编辑目标' : '新建攒钱目标',
      content: `
        <div class="field">
          <div class="field-label">目标名称</div>
          <input class="field-input" id="g-name" type="text" maxlength="20" placeholder="例如：日本旅行基金" value="${U.escapeHtml(g.name)}" />
        </div>
        <div class="field">
          <div class="field-label">选择图标</div>
          <div class="emoji-grid" id="g-icons">
            ${ICONS.map((i) => `<button class="emoji-opt ${i === cur.icon ? 'on' : ''}" data-emoji="${i}" type="button">${i}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <div class="field-label">目标金额（元）</div>
          <input class="field-input amount" id="g-target" type="text" inputmode="decimal" enterkeyhint="done"
            placeholder="0.00" value="${g.target ? (g.target / 100) : ''}" />
        </div>
        <div class="field">
          <div class="field-label">目标日期</div>
          <button class="field-input" id="g-deadline" style="text-align:left;display:flex;align-items:center;justify-content:space-between" type="button">
            <span>${cur.deadline ? fmtD(cur.deadline) : '不设期限'}</span>
            ${Icons.svg('calendar', 16)}
          </button>
        </div>
        <div class="field">
          <div class="field-label">主题色</div>
          <div class="color-grid" id="g-colors">
            ${COLORS.map((c) => `<button class="color-opt ${c === cur.color ? 'on' : ''}" data-color="${c}"
              style="background:${c};color:${c}" type="button"></button>`).join('')}
          </div>
        </div>
        ${!goal ? `
          <div class="field">
            <div class="field-label">初始已存金额（元，可留空）</div>
            <input class="field-input" id="g-saved" type="text" inputmode="decimal" enterkeyhint="done" placeholder="0.00" />
          </div>` : ''}
        <button class="btn btn--primary mt8" data-act="save" type="button">${goal ? '保存修改' : '创建目标'}</button>
      `,
      onMount(body, close) {
        body.querySelectorAll('[data-emoji]').forEach((b) => {
          b.addEventListener('click', () => {
            cur.icon = b.dataset.emoji;
            body.querySelectorAll('[data-emoji]').forEach((x) => x.classList.toggle('on', x === b));
          });
        });
        body.querySelectorAll('[data-color]').forEach((b) => {
          b.addEventListener('click', () => {
            cur.color = b.dataset.color;
            body.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
          });
        });
        body.querySelector('#g-deadline').addEventListener('click', () => {
          // 目标日期只能是「今天之后」：
          //   min = 明天 0 点（今天和过去全部灰掉、点不动）
          //   max = 10 年后（和情侣基金的「攒到哪天」同一个口径，不让人选到 2100 年）
          // 以前这里没传 min/max，datePicker 的默认 max 是「明天 0 点」，
          // 结果整块日历里只有今天和过去能点 —— 目标日期挑不到未来，是 bug。
          const today0 = U.startOfDay(new Date()).getTime();
          const minTs = today0 + 86400000;
          const maxTs = today0 + 3650 * 86400000;
          // 默认值：没设过 → 180 天后；设过但已经不在未来（含今天）→ 也回落到 180 天后，
          // 否则一打开日历就停在一个灰掉的日子上（默认值和禁用状态自相矛盾）。
          const d0 = cur.deadline ? U.parseYmd(cur.deadline) : null;
          const curTs = d0 && !isNaN(d0.getTime()) ? d0.getTime() : NaN;
          const base = Number.isFinite(curTs) && curTs >= minTs ? curTs : minTs + 179 * 86400000;
          UI.datePicker({
            title: '目标日期',
            value: base,
            min: minTs,
            max: maxTs,
            onPick(ts) {
              cur.deadline = U.ymd(new Date(ts));
              body.querySelector('#g-deadline span').textContent = fmtD(cur.deadline);
            },
          });
        });
        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          const name = body.querySelector('#g-name').value.trim();
          const target = U.toCents(body.querySelector('#g-target').value);
          if (!name) { U.toast('请填写目标名称', 'error'); return; }
          // 情侣金库允许先不定目标金额（target 为 0），普通目标仍要求填
          const isCouple = !!(goal && goal.kind === 'couple');
          if (target <= 0 && !isCouple) { U.toast('请填写目标金额', 'error'); return; }
          // 提交时再验一次：日历里已经点不动过去，但「编辑一个旧目标」时
          // deadline 可能是过去存下来的，直接保存等于把非法值又写回去。
          if (cur.deadline) {
            const dl = U.parseYmd(cur.deadline);
            const dlTs = dl && !isNaN(dl.getTime()) ? dl.getTime() : NaN;
            if (!(dlTs > U.startOfDay(new Date()).getTime())) {
              U.toast('目标日期要选今天之后的，请重新选一个', 'error');
              return;
            }
          }
          if (goal) {
            S.updateGoal(goal.id, {
              name, target: Math.max(0, target), icon: cur.icon, color: cur.color, deadline: cur.deadline,
            });
            U.toast('已保存', 'success');
          } else {
            const saved = U.toCents((body.querySelector('#g-saved') || {}).value || 0);
            S.addGoal({
              name, target: Math.max(0, target), icon: cur.icon, color: cur.color, deadline: cur.deadline, saved,
            });
            U.toast('目标已创建 🎉', 'success');
          }
          close();
          App.refresh();
        });
      },
    });
  }

  // ------------------------------------------------------------
  // 存入 / 取出
  // ------------------------------------------------------------
  function openDeposit(id, dir) {
    const g = S.goalById(id);
    if (!g) return;
    const p = S.goalProgress(g);
    const isIn = dir === 'in';
    const quick = isIn ? [10000, 50000, 100000, 200000] : [10000, 50000, 100000];
    const targetLine = g.target
      ? `已存 ${U.money(g.saved)} / ${U.money(g.target)} · ${Math.round(p.pct * 100)}%`
      : `已存 ${U.money(g.saved)} · 还没定目标金额`;

    UI.openSheet({
      title: isIn ? '存入目标' : '从目标取出',
      content: `
        <div style="display:flex;align-items:center;gap:11px;margin-bottom:16px">
          <span style="width:42px;height:42px;border-radius:14px;display:grid;place-items:center;font-size:20px;background:${g.color}1F">${g.icon}</span>
          <div style="flex:1">
            <div style="font-size:14.5px;font-weight:650">${U.escapeHtml(g.name)}</div>
            <div class="small muted">${targetLine}</div>
          </div>
        </div>
        <div class="field">
          <div class="field-label">金额（元）</div>
          <input class="field-input amount" id="d-amt" type="text" inputmode="decimal" min="0" step="0.01" placeholder="0.00" />
        </div>
        <div class="row gap8" style="flex-wrap:wrap;margin-bottom:16px">
          ${quick.map((q) => `<button class="chip" data-quick="${q}" type="button">${isIn ? '+' : '-'}${U.money(q, { decimals: 0 })}</button>`).join('')}
          ${isIn ? `<button class="chip" data-quick="${Math.max(0, p.left)}" type="button">补齐差额</button>` : ''}
        </div>
        <div class="field">
          <div class="field-label">备注（可选）</div>
          <input class="field-input" id="d-note" type="text" maxlength="30" placeholder="${isIn ? '例如：本月结余' : '例如：临时周转'}" />
        </div>
        <button class="btn ${isIn ? 'btn--primary' : 'btn--ghost'}" data-act="ok" type="button">${isIn ? '确认存入' : '确认取出'}</button>
      `,
      onMount(body, close) {
        const amt = body.querySelector('#d-amt');
        // 同步 focus 唤出数字键盘（还在用户点「存一笔」那趟手势里）。
        // 旧写法是 setTimeout(320) focus + HTML autofocus 属性：
        // autofocus 对动态插入的节点普遍不生效，setTimeout 又落在手势外，
        // 安卓/iOS 常常不弹键盘。
        UI.focusKeyboard(amt);
        body.querySelectorAll('[data-quick]').forEach((b) => {
          b.addEventListener('click', () => {
            amt.value = (Number(b.dataset.quick) / 100).toFixed(2).replace(/\.00$/, '');
          });
        });
        body.querySelector('[data-act="ok"]').addEventListener('click', () => {
          const v = U.toCents(amt.value);
          if (v <= 0) { U.toast('请输入金额', 'error'); return; }
          if (!isIn && v > g.saved) { U.toast('取出金额不能超过已存金额', 'error'); return; }
          S.depositGoal(g.id, isIn ? v : -v, body.querySelector('#d-note').value.trim());
          close();
          const np = S.goalProgress(S.goalById(g.id));
          if (isIn && np.done) {
            U.toast('目标达成啦 🎉', 'success');
            setTimeout(() => celebrate(g), 400);
          } else {
            U.toast(isIn ? `已存入 ${U.money(v)}` : `已取出 ${U.money(v)}`, 'success');
          }
          App.refresh();
        });
      },
    });
  }

  function celebrate(g) {
    UI.openSheet({
      title: '目标达成',
      content: `
        <div style="text-align:center;padding:10px 0 22px">
          <div style="font-size:56px;line-height:1;margin-bottom:14px">🎉</div>
          <div style="font-size:17px;font-weight:700;margin-bottom:8px">${U.escapeHtml(g.name)} 已达成</div>
          <div class="small muted" style="line-height:1.7">
            你为目标攒下了 <b style="color:var(--text)">${U.money(g.saved)}</b>，<br/>
            可以继续攒，也可以给它放个假。
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn--ghost btn--sm" data-act="archive" type="button">标记完成并归档</button>
          <button class="btn btn--primary btn--sm" data-act="keep" type="button">继续攒</button>
        </div>
      `,
      onMount(body, close) {
        body.querySelector('[data-act="keep"]').addEventListener('click', close);
        body.querySelector('[data-act="archive"]').addEventListener('click', () => {
          S.updateGoal(g.id, { archived: true });
          close();
          App.refresh();
          U.toast('已归档', 'success');
        });
      },
    });
  }

  // ------------------------------------------------------------
  // 更多操作
  // ------------------------------------------------------------
  function openMore(id) {
    const g = S.goalById(id);
    if (!g) return;
    UI.openSheet({
      title: U.escapeHtml(g.name),
      content: `
        <div class="set-card" style="margin-bottom:14px">
          <button class="set-row" data-act="edit" type="button">
            <span class="set-ic">${Icons.svg('edit', 16)}</span>
            <span class="set-main"><span class="set-name">编辑目标</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="history" type="button">
            <span class="set-ic income">${Icons.svg('list', 16)}</span>
            <span class="set-main"><span class="set-name">存入记录</span>
              <span class="set-desc">共 ${(g.logs || []).length} 笔</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="reset" type="button">
            <span class="set-ic warn">${Icons.svg('refresh', 16)}</span>
            <span class="set-main"><span class="set-name">清零重新开始</span>
              <span class="set-desc">保留目标，已存金额归零</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="del" type="button">
            <span class="set-ic danger">${Icons.svg('trash', 16)}</span>
            <span class="set-main"><span class="set-name" style="color:var(--expense)">删除目标</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
        </div>
      `,
      onMount(body, close) {
        body.querySelector('[data-act="edit"]').addEventListener('click', () => {
          close(); setTimeout(() => openEditor(g), 200);
        });
        body.querySelector('[data-act="history"]').addEventListener('click', () => {
          close(); setTimeout(() => openHistory(g), 200);
        });
        body.querySelector('[data-act="reset"]').addEventListener('click', async () => {
          close();
          const ok = await UI.confirm({ title: '清零已存金额？', desc: '目标会保留，已存金额与记录将归零。', danger: true, okText: '清零' });
          if (!ok) return;
          S.updateGoal(g.id, { saved: 0, logs: [] });
          App.refresh(); U.toast('已清零', 'success');
        });
        body.querySelector('[data-act="del"]').addEventListener('click', async () => {
          close();
          const ok = await UI.confirm({ title: '删除这个目标？', desc: '目标与存入记录都会被删除，无法恢复。', danger: true, okText: '删除' });
          if (!ok) return;
          S.removeGoal(g.id);
          App.refresh(); U.toast('已删除', 'success');
        });
      },
    });
  }

  function openHistory(g) {
    const logs = (g.logs || []).slice().sort((a, b) => b.ts - a.ts);
    UI.openSheet({
      title: '存入记录',
      content: logs.length ? `
        <div class="set-card">
          ${logs.map((l) => `
            <div class="set-row">
              <span class="set-ic ${l.amount > 0 ? 'income' : 'danger'}">${Icons.svg(l.amount > 0 ? 'arrowUp' : 'arrowDown', 15)}</span>
              <span class="set-main">
                <span class="set-name">${l.note ? U.escapeHtml(l.note) : (l.amount > 0 ? '存入' : '取出')}</span>
                <span class="set-desc">${U.humanDate(l.ts)} ${U.timeStr(l.ts)}</span>
              </span>
              <span class="set-val" style="color:${l.amount > 0 ? 'var(--income)' : 'var(--expense)'};font-weight:650">
                ${l.amount > 0 ? '+' : ''}${U.money(l.amount, { symbol: false })}
              </span>
            </div>`).join('')}
        </div>` : `<div class="empty" style="padding:30px 0"><div class="empty-emoji">📭</div>
          <div class="empty-desc">还没有存入记录</div></div>`,
    });
  }

  function refresh() {
    const root = $('#view-goals');
    if (root) render(root);
  }

  global.ViewGoals = { render, refresh, openEditor };
})(window);
