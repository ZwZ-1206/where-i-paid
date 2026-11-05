/* ============================================================
 * 花哪儿了 · 桌面小组件的数据来源
 *
 * 只在安卓 APK 里生效：MainActivity 注入了 JZWidget 桥（有它就一定是 APK），
 * 网页侧把**聚合好的快照**推给它，原生侧按这个快照画桌面卡片。
 * 网页版 / iOS 上桥不存在，这里的每一个分支都会安静地什么都不做。
 *
 * 为什么一定要在网页侧算：
 * 账目的口径（周期怎么切、退款怎么抵、垫付已还的怎么剔除、外币怎么折）
 * 全在这套 JS 里。原生侧再实现一遍，桌面上显示的数字迟早会和 App 里对不上，
 * 而那种「差一点点」的 bug 是最难查的。所以原生只做展示，不做计算。
 *
 * 为什么按「天」给而不是给一个「今日」的数：
 * 用户今天没打开 App 时网页根本没运行，昨天推的「今日支出 88 元」跨过零点
 * 就会变成错误答案。给一堆按天的数据，让原生用**本机当前日期**自己去取，
 * 这件事就不用后台也能对。
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;

  /** 给原生多少天的日数据：够覆盖「本月合计」和一些跨零点的抖动，又不会太大 */
  const DAY_SPAN = 92;
  /** 节流：连续写多条账目没必要每条都推一次 */
  const THROTTLE = 400;
  /** 页面可见时多久重推一次（跨零点/长时间挂后台的兜底） */
  const HEARTBEAT = 10 * 60 * 1000;

  let timer = null;
  let lastJson = '';

  function bridge() {
    try { return global.JZWidget || null; } catch (e) { return null; }
  }

  function supported() {
    return !!(bridge() && typeof bridge().postSnapshot === 'function');
  }

  /** 当前视线范围内的账目（跟着 App 里的账本切换走，桌面看到的和 App 里一致） */
  function scopedTx(fromTs) {
    const all = S.isAllBooks();
    const bid = S.activeBookId();
    return S.state.tx.filter((t) => {
      if (t.type !== 'expense') return false;
      if (!t || !isFinite(t.ts)) return false;
      if (t.ts < fromTs) return false;
      if (all || !t.bookId) return true;
      return t.bookId === bid;
    }).filter((t) => !S.isVoid(t));
  }

  function catMeta(id) {
    try { return (global.Icons && global.Icons.cat(id)) || { name: '支出', icon: '💰' }; }
    catch (e) { return { name: '支出', icon: '💰' }; }
  }

  function symbol() {
    try { return (S.bookCurrency() || {}).symbol || '¥'; } catch (e) { return '¥'; }
  }

  function mdLabel(ts) {
    const d = new Date(ts);
    return U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  }

  /**
   * 生成快照。字段刻意写成了短名（d/e/c/i/t/a）——
   * 这份 JSON 会随每次记账反复写进 SharedPreferences，能省一点是一点。
   */
  function snapshot() {
    const p = S.currentPeriod();
    const todayStart = U.startOfDay(new Date()).getTime();
    const from = U.startOfDay(U.addDays(new Date(), -(DAY_SPAN - 1))).getTime();

    const list = scopedTx(from);

    // 按天聚合
    const map = Object.create(null);
    list.forEach((t) => {
      const k = U.ymd(t.ts);
      const slot = map[k] || (map[k] = { e: 0, c: 0 });
      slot.e += t.amount;
      slot.c += 1;
    });
    const days = Object.keys(map).sort().map((k) => ({ d: k, e: map[k].e, c: map[k].c }));

    // 最近几笔：给的是「任何时候都能看」的最近，不受周期边界限制
    const recent = list
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 4)
      .map((t) => {
        const meta = catMeta(t.catId);
        return {
          i: meta.icon || '💰',
          t: String(t.sub || meta.name || '支出').slice(0, 14),
          d: mdLabel(t.ts),
          a: t.amount,
        };
      });

    const sum = S.summary(p, S.txIn(p));
    let budget = 0;
    try { budget = S.budgetFor(p).total || 0; } catch (e) { budget = 0; }

    return {
      v: 1,
      at: Date.now(),
      sym: symbol(),
      days: days,
      recent: recent,
      period: {
        label: p.label,
        start: p.start.getTime(),
        end: p.end.getTime(),
        expense: sum.expense,
      },
      budget: { amount: budget },
      todayStart: todayStart,
    };
  }

  function push(reason) {
    if (!supported()) return false;
    try {
      const json = JSON.stringify(snapshot());
      if (json === lastJson) return true;      // 没变就别折腾了
      const ok = bridge().postSnapshot(json);
      lastJson = json;
      if (!ok) console.warn('[widget] 原生拒绝了这份快照');
      return !!ok;
    } catch (e) {
      console.warn('[widget] 推送失败', reason || '', e);
      return false;
    }
  }

  function schedule() {
    if (!supported()) return;
    clearTimeout(timer);
    timer = setTimeout(() => push('throttle'), THROTTLE);
  }

  /**
   * 原生点了卡片上的按钮 → MainActivity.applyRoute 会调到这里。
   * 「记一笔」要先清掉草稿：留在编辑态的话，用户以为自己在记新的，实际在改旧的。
   */
  function handleRoute(name) {
    if (!name) return;
    if (name === 'add') {
      try { if (global.ViewAdd && global.ViewAdd.reset) global.ViewAdd.reset(); } catch (e) { /* 忽略 */ }
    }
    try { if (global.App && global.App.go) global.App.go(name); } catch (e) { /* 忽略 */ }
  }

  /** 设置页的添加指引：各家 launcher 的说法不一样，只给最常见的两种 */
  function showGuide() {
    const html = `
      <div style="line-height:1.9;font-size:14px">
        <p style="margin:0 0 12px">把小组件放到桌面上，不用打开 App 就能看到今天花了多少。</p>
        <p style="margin:0 0 6px;font-weight:600">安卓怎么加</p>
        <p style="margin:0 0 12px;opacity:.8">在桌面<b>长按空白 → 小组件（或「挂件」）</b>，
        找到「花哪儿了」，拖到桌面即可。不同品牌的叫法略有差别，MIUI / ColorOS 等在
        双指捏合或上滑抽屉里也能找到。</p>
        <p style="margin:0 0 6px;font-weight:600">卡片上的按钮</p>
        <p style="margin:0 0 12px;opacity:.8">「＋记一笔」直接进记账页，「总结」看本月报表，
        右上角箭头只是按当前日期重新算一遍；账目一变 App 会自动推送，不用手动刷新。</p>
        <p style="margin:0 0 6px;font-weight:600">关于数字</p>
        <p style="margin:0;opacity:.8">今日 / 本月是 App 打开时算好的；如果只是很久没打开 App，
        桌面上的数字会停在你上次用完那一刻。</p>
      </div>`;
    if (global.UI && global.UI.openSheet) {
      global.UI.openSheet({ title: '桌面小组件', content: html });
    } else {
      global.alert('长按桌面 → 小组件 → 找到「花哪儿了」拖到桌面');
    }
  }

  // ------------------------------------------------------------
  // 接线
  // ------------------------------------------------------------
  let beat = null;
  function install() {
    if (!supported()) return;
    S.subscribe(schedule);

    // 离开 App 前再推一次：这之后进程可能被系统杀掉，就没有别的机会了
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') schedule();
      else push('hidden');
    });
    window.addEventListener('pagehide', () => push('pagehide'));

    clearInterval(beat);
    beat = setInterval(() => {
      if (document.visibilityState === 'visible') push('heartbeat');
    }, HEARTBEAT);

    push('install');
  }

  global.Widget = {
    install, push, schedule, snapshot, supported, handleRoute, showGuide,
    get lastJson() { return lastJson; },
  };
})(window);
