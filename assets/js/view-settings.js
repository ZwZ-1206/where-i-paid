/* ============================================================
 * 花哪儿了 · 设置
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;
  const $ = U.$;

  const CYCLE_LABELS = {
    month: '按月（可选起始日）',
    week: '按周',
    biweek: '双周（14 天）',
    custom: '自定义天数',
  };
  const CYCLE_SHORT = {
    month: '按月',
    week: '按周',
    biweek: '双周',
    custom: '自定义',
  };

  function render(root) {
    const st = S.settings;
    const c = st.cycle;
    const b = st.budget;
    const alert = st.alert;
    const tipOn = st.tip ? st.tip.enabled !== false : true;
    const aiCfg = st.ai || {};
    const aiOn = !!aiCfg.enabled && !!aiCfg.apiKey;
    const aiPresetName = (() => {
      const pr = global.AI && global.AI.preset(aiCfg.preset);
      return pr ? pr.name : '自定义';
    })();
    const scanEngine = (st.scan && st.scan.engine) || 'auto';
    const SCAN_LABEL = { auto: '自动选择', ai: 'AI 识图', ocr: '本地 OCR' };
    const p = S.currentPeriod();
    const totalTx = S.state.tx.length;

    const bookCount = S.books().length;
    const activeBookName = (S.activeBook() || {}).name || '日常';
    const cc = S.catConfig();
    const catTotal = Icons.CATEGORIES.length;
    const catDesc = (cc.custom.length || cc.hidden.length || Object.keys(cc.overrides).length)
      ? `${cc.custom.length} 个自定义 · ${cc.hidden.length} 个隐藏 · ${Object.keys(cc.overrides).length} 个改名`
      : '内置 22 个分类，可新增 / 改名 / 隐藏';

    // 新功能状态
    const autoSave = st.autoSave || {};
    const autoSaveOn = !!autoSave.enabled && !!autoSave.goalId;
    let autoSaveDesc = '每期没花完的预算自动存进攒钱目标';
    if (autoSaveOn) {
      const g = S.goalById(autoSave.goalId);
      const pv = S.autoSavePreview();
      autoSaveDesc = g
        ? `结余存入「${g.name}」· 本期预计 ${U.money(pv.amount)}`
        : '所选目标已不存在，请重新选择';
    }
    const cur = S.bookCurrency();
    const curLabel = cur ? cur.code : 'CNY';
    const curDesc = cur
      ? `当前账本用 ${cur.code} 记，统计自动折算 ¥`
      : '当前账本用人民币记（旅行账本可改成外币）';
    const subAlert = st.subAlert || {};
    let subCount = 0;
    try { subCount = S.scanSubscriptions().length; } catch (e) { subCount = 0; }
    const subDesc = subCount
      ? `发现 ${subCount} 个 App 自动扣费${subAlert.enabled !== false ? `，提前 ${subAlert.daysBefore || 3} 天提醒` : '，提醒已关闭'}`
      : '自动从历史账目里找出忘了关的自动续费';
    let fixedCount = 0;
    try { fixedCount = S.fixedExpenses().length; } catch (e) { fixedCount = 0; }
    const fixedDesc = fixedCount
      ? `房租、话费、宽带这些每月固定的一笔`
      : '房租 / 话费 / 宽带：设一次，每月自动记';
    let adv = { openCount: 0, openAmount: 0 };
    try { adv = S.advanceSummary(); } catch (e) { /* 忽略 */ }
    const advCount = adv.openCount;
    const advAmount = adv.openAmount;
    const advRemind = (st.advance || {}).remindDays || 0;
    const advDesc = advCount
      ? `待收回 ${advCount} 笔 · ${advRemind ? `到期前 ${advRemind} 天提醒` : '到期当天提醒'}`
      : '帮别人垫的钱先挂账，收回后再勾掉';
    const wishCfg = st.wish || {};
    const wishOn = wishCfg.enabled !== false;
    let wishCoolingCount = 0, wishReadyCount = 0;
    try { wishCoolingCount = S.wishCooling().length; wishReadyCount = S.wishReady().length; } catch (e) { /* 忽略 */ }
    const savedFund = (() => { try { return S.savedFund(); } catch (e) { return 0; } })();
    const wishPending = wishCoolingCount + wishReadyCount;
    const wishDesc = wishOn
      ? `冷静 ${wishCfg.hours || 48} 小时再决定${wishCoolingCount ? ` · ${wishCoolingCount} 件在等` : ''}${wishReadyCount ? ` · ${wishReadyCount} 件到期了` : ''}${savedFund ? ` · 已省下 ${U.moneyCompact(savedFund)}` : ''}`
      : '已关闭，记账页不再显示「想买先放着」';
    let reconLast = null;
    try { reconLast = (S.reconList() || [])[0] || null; } catch (e) { reconLast = null; }
    const reconDesc = reconLast
      ? `上次对账：${reconLast.diff === 0 ? '完全对上' : reconLast.diff > 0 ? `少了 ${U.money(reconLast.diff)}` : `多了 ${U.money(-reconLast.diff)}`} · ${U.humanDate(reconLast.ts)}`
      : '输入一次真实余额，算出漏记了多少钱';

    const cycleDesc = c.type === 'month'
      ? (Number(c.startDay) === 1 ? '每月 1 日 - 月末' : `每月 ${c.startDay} 日 - 次月 ${Number(c.startDay) - 1} 日`)
      : c.type === 'week' ? `每周${['日', '一', '二', '三', '四', '五', '六'][Number(c.weekStart) || 0]}起算`
        : c.type === 'biweek' ? '每 14 天为一个周期'
          : `每 ${c.days} 天为一个周期`;

    root.innerHTML = `
      <div class="card" style="background:var(--card-2);border-style:dashed">
        <div class="row gap8">
          <span style="font-size:24px">${st.nickname ? '🙂' : '💰'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:14.5px;font-weight:650">${U.escapeHtml(st.nickname || '我的账本')}</div>
            <div class="small muted">共 ${totalTx} 笔账目 · 当前周期 ${U.escapeHtml(p.label)}</div>
          </div>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">记账设置</div>
        <div class="set-card">
          <button class="set-row" data-act="cycle" type="button">
            <span class="set-ic">${Icons.svg('calendar', 16)}</span>
            <span class="set-main"><span class="set-name">自定义记账周期</span>
              <span class="set-desc">${U.escapeHtml(cycleDesc)}</span></span>
            <span class="set-val"><span>${U.escapeHtml(CYCLE_SHORT[c.type] || '')}</span>${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="budget" type="button">
            <span class="set-ic income">${Icons.svg('wallet', 16)}</span>
            <span class="set-main"><span class="set-name">预算设置</span>
              <span class="set-desc">${b.amount > 0 ? '每周期预算' + (Object.keys(b.split || {}).length ? ` · ${Object.keys(b.split).length} 个分类预算` : '') : '尚未设置预算'}</span></span>
            <span class="set-val"><b>${b.amount > 0 ? U.moneyCompact(b.amount) : '未设置'}</b>${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="alert" type="button">
            <span class="set-ic warn">${Icons.svg('bell', 16)}</span>
            <span class="set-main"><span class="set-name">低预算提醒</span>
              <span class="set-desc">${alert.enabled ? '超过 ' + (alert.thresholds || []).join('% / ') + '% 时提醒' : '已关闭'}</span></span>
            <span class="set-val">
              <span class="switch ${alert.enabled ? 'on' : ''}" data-toggle="alert"></span>
            </span>
          </button>
          <button class="set-row" data-act="tip" type="button">
            <span class="set-ic" style="background:rgba(255,176,32,.14)">🌤</span>
            <span class="set-main"><span class="set-name">暖心提示</span>
              <span class="set-desc">${tipOn ? '每天根据前一天开销，说句贴心话' : '已关闭'}</span></span>
            <span class="set-val">
              <span class="switch ${tipOn ? 'on' : ''}" data-toggle="tip"></span>
            </span>
          </button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">AI 增强（可选）</div>
        <div class="set-card">
          <button class="set-row" data-act="ai" type="button">
            <span class="set-ic" style="background:rgba(124,92,255,.13)">${Icons.svg('sparkle', 16)}</span>
            <span class="set-main"><span class="set-name">接入自己的 AI 接口</span>
              <span class="set-desc">${aiOn ? `${U.escapeHtml(aiPresetName)} · ${U.escapeHtml(aiCfg.model || '')}` : '不填也能用，填了让每日/每月总结更生动'}</span></span>
            <span class="set-val">
              <span class="switch ${aiOn ? 'on' : ''}" data-toggle="ai"></span>
            </span>
          </button>
          <button class="set-row" data-act="scan" type="button">
            <span class="set-ic">${Icons.svg('camera', 16)}</span>
            <span class="set-main"><span class="set-name">识图记账</span>
              <span class="set-desc">截图自动识别金额与分类</span></span>
            <span class="set-val"><span>${U.escapeHtml(SCAN_LABEL[scanEngine] || '自动选择')}</span>${Icons.svg('chevronRight', 16)}</span>
          </button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">外观</div>
        <div class="set-card">
          <div class="set-row" style="cursor:default">
            <span class="set-ic">${Icons.svg(st.theme === 'dark' ? 'moon' : st.theme === 'light' ? 'sun' : 'info', 16)}</span>
            <span class="set-main"><span class="set-name">主题</span>
              <span class="set-desc">跟随系统 / 浅色 / 深色</span></span>
          </div>
          <div style="padding:0 15px 14px">
            <div class="segmented">
              <button class="${st.theme === 'auto' ? 'on' : ''}" data-theme="auto" type="button">跟随系统</button>
              <button class="${st.theme === 'light' ? 'on' : ''}" data-theme="light" type="button">浅色</button>
              <button class="${st.theme === 'dark' ? 'on' : ''}" data-theme="dark" type="button">深色</button>
            </div>
          </div>
          <button class="set-row" data-act="nickname" type="button">
            <span class="set-ic">${Icons.svg('edit', 16)}</span>
            <span class="set-main"><span class="set-name">账本昵称</span></span>
            <span class="set-val">${U.escapeHtml(st.nickname || '未设置')}${Icons.svg('chevronRight', 16)}</span>
          </button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">账本</div>
        <div class="set-card">
          <button class="set-row" data-act="books" type="button">
            <span class="set-ic">${Icons.svg('grid', 16)}</span>
            <span class="set-main"><span class="set-name">多账本</span>
              <span class="set-desc">${bookCount > 1 ? `${bookCount} 个账本 · 当前「${U.escapeHtml(activeBookName)}」` : '日常 / 旅行 / 装修，分开记互不干扰'}</span></span>
            <span class="set-val"><b>${bookCount}</b>${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="currency" type="button">
            <span class="set-ic" style="background:rgba(20,184,122,.13)">${Icons.svg('wallet', 16)}</span>
            <span class="set-main"><span class="set-name">账本币种</span>
              <span class="set-desc">${curDesc}</span></span>
            <span class="set-val"><span>${U.escapeHtml(curLabel)}</span>${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="cats" type="button">
            <span class="set-ic warn">${Icons.svg('filter', 16)}</span>
            <span class="set-main"><span class="set-name">自定义分类</span>
              <span class="set-desc">${catDesc}</span></span>
            <span class="set-val"><span>${catTotal} 个</span>${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="autoSave" type="button">
            <span class="set-ic income">${Icons.svg('target', 16)}</span>
            <span class="set-main"><span class="set-name">余钱归仓</span>
              <span class="set-desc">${autoSaveDesc}</span></span>
            <span class="set-val">
              <span class="switch ${autoSaveOn ? 'on' : ''}" data-toggle="autoSave"></span>
            </span>
          </button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">省钱与提醒</div>
        <div class="set-card">
          <button class="set-row" data-act="subs" type="button">
            <span class="set-ic" style="background:rgba(255,122,69,.13)">🔁</span>
            <span class="set-main"><span class="set-name">自动扣费提醒</span>
              <span class="set-desc">${subDesc}</span></span>
            <span class="set-val"><span>${subCount ? subCount + ' 个' : '未发现'}</span>${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="fixed" type="button">
            <span class="set-ic" style="background:rgba(146,84,222,.13)">🏠</span>
            <span class="set-main"><span class="set-name">固定月支出</span>
              <span class="set-desc">${fixedDesc}</span></span>
            <span class="set-val"><span>${fixedCount ? fixedCount + ' 项' : '未设置'}</span>${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="advances" type="button">
            <span class="set-ic warn">💸</span>
            <span class="set-main"><span class="set-name">垫付待收</span>
              <span class="set-desc">${advDesc}</span></span>
            <span class="set-val"><span>${advCount ? U.moneyCompact(advAmount) : '无'}</span>${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="wishlist" type="button">
            <span class="set-ic" style="background:rgba(165,108,255,.13)">🛍️</span>
            <span class="set-main"><span class="set-name">想买清单</span>
              <span class="set-desc">${wishDesc}</span></span>
            <span class="set-val">
              <span>${wishOn ? (wishPending ? wishPending + ' 件' : '空') : '已关'}</span>${Icons.svg('chevronRight', 16)}
            </span>
          </button>
          <button class="set-row" data-act="recon" type="button">
            <span class="set-ic">${Icons.svg('check', 16)}</span>
            <span class="set-main"><span class="set-name">余额反推对账</span>
              <span class="set-desc">${reconDesc}</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">数据</div>
        <div class="set-card">
          <button class="set-row" data-act="backup" type="button">
            <span class="set-ic">${Icons.svg('download', 16)}</span>
            <span class="set-main"><span class="set-name">导出备份</span>
              <span class="set-desc">JSON 完整备份，换手机不丢数据</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="restore" type="button">
            <span class="set-ic income">${Icons.svg('upload', 16)}</span>
            <span class="set-main"><span class="set-name">导入备份</span>
              <span class="set-desc">从 JSON 备份文件恢复</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="csv" type="button">
            <span class="set-ic warn">${Icons.svg('list', 16)}</span>
            <span class="set-main"><span class="set-name">导出全部 CSV</span>
              <span class="set-desc">用 Excel / WPS 查看</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-group-title">关于</div>
        <div class="set-card">
          <button class="set-row" data-act="sponsor" type="button">
            <span class="set-ic" style="background:rgba(255,106,155,.14);color:#FF6A9B">${Icons.svg('heart', 16)}</span>
            <span class="set-main"><span class="set-name">赞助作者</span>
              <span class="set-desc">这个 App 一直免费、无广告</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="check-update" type="button">
            <span class="set-ic" style="background:rgba(89,126,247,.13)">${Icons.svg('refresh', 16)}</span>
            <span class="set-main"><span class="set-name">检查更新</span>
              <span class="set-desc">当前版本 <b data-ver>…</b> · 联网只核对一次</span></span>
            <span class="set-val"><span data-ver-state>未检查</span>${Icons.svg('chevronRight', 16)}</span>
          </button>
          <button class="set-row" data-act="clear" type="button">
            <span class="set-ic danger">${Icons.svg('trash', 16)}</span>
            <span class="set-main"><span class="set-name" style="color:var(--expense)">清空所有数据</span>
              <span class="set-desc">删除全部账目与目标，不可恢复</span></span>
            <span class="set-val">${Icons.svg('chevronRight', 16)}</span>
          </button>
        </div>
      </div>

      <div class="center small muted" style="padding:18px 0 8px;line-height:1.8">
        花哪儿了 v1.8.1<br/>
        数据仅保存在本机浏览器，不上传服务器
      </div>
    `;

    bind(root);
    syncVersion(root);
  }

  function bind(root) {
    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'cycle') openCycleSheet();
        else if (act === 'budget') openBudgetSheet();
        else if (act === 'alert') openAlertSheet();
        else if (act === 'tip') openTipSheet();
        else if (act === 'ai') openAiSheet();
        else if (act === 'scan') openScanSheet();
        else if (act === 'nickname') openNicknameSheet();
        else if (act === 'backup') doBackup();
        else if (act === 'restore') doRestore();
        else if (act === 'bill') { if (global.Bills) global.Bills.open(); else U.toast('账单模块未加载', 'error'); }
        else if (act === 'books') openBooksSheet();
        else if (act === 'cats') openCatsSheet();
        else if (act === 'currency') openCurrencySheet();
        else if (act === 'autoSave') openAutoSaveSheet();
        else if (act === 'subs') openSubsSheet();
        else if (act === 'fixed') openFixedSheet();
        else if (act === 'advances') openAdvancesSheet();
        else if (act === 'check-update') doCheckUpdate(root);
        else if (act === 'sponsor') openSponsorSheet();
        else if (act === 'wishlist') openWishSheet();
        else if (act === 'recon') openReconSheet();
        else if (act === 'csv') {
          App.download('花哪儿了-全部账目-' + U.ymd(new Date()) + '.csv', S.exportCSV(null), 'text/csv;charset=utf-8');
          U.toast('已导出 CSV', 'success');
        } else if (act === 'clear') doClear();
      });
    });

    root.querySelectorAll('[data-toggle]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const which = b.dataset.toggle;
        if (which === 'tip') {
          const on = !(S.settings.tip ? S.settings.tip.enabled !== false : true);
          S.setSettings({ tip: { enabled: on } });
          if (global.Tips) global.Tips.clearCache();
          render(root);
          U.toast(on ? '已开启暖心提示' : '已关闭暖心提示', on ? 'success' : 'info');
          return;
        }
        if (which === 'ai') {
          const cur = S.settings.ai || {};
          if (!cur.apiKey) {
            U.toast('先填 API Key 才能开启', 'info');
            openAiSheet();
            return;
          }
          S.setSettings({ ai: { enabled: !cur.enabled } });
          if (global.AI) global.AI.clearCache();
          render(root);
          U.toast(!cur.enabled ? 'AI 增强已开启' : 'AI 增强已关闭', !cur.enabled ? 'success' : 'info');
          return;
        }
        if (which === 'autoSave') {
          const cfg = S.settings.autoSave || {};
          if (cfg.enabled && cfg.goalId) {
            S.setSettings({ autoSave: { enabled: false } });
            render(root);
            U.toast('已关闭余钱归仓', 'info');
          } else {
            openAutoSaveSheet();
          }
          return;
        }
        if (which === 'wish') {
          const on = !(S.settings.wish ? S.settings.wish.enabled !== false : true);
          S.setSettings({ wish: { enabled: on } });
          render(root);
          U.toast(on ? '已开启想买清单' : '已关闭，记账页不再显示「想买先放着」', on ? 'success' : 'info');
          return;
        }
        const on = !S.settings.alert.enabled;
        S.setSettings({ alert: { enabled: on } });
        if (on) S.resetAlertLog();
        render(root);
        U.toast(on ? '已开启低预算提醒' : '已关闭低预算提醒', on ? 'success' : 'info');
      });
    });

    root.querySelectorAll('[data-theme]').forEach((b) => {
      b.addEventListener('click', () => {
        S.setSettings({ theme: b.dataset.theme });
        App.applyTheme();
        render(root);
      });
    });
  }

  // ------------------------------------------------------------
  // 周期设置
  // ------------------------------------------------------------
  function openCycleSheet() {
    const c = { ...S.settings.cycle };
    const TYPES = [
      { v: 'month', n: '按月', d: '自然月或自定义起始日' },
      { v: 'week', n: '按周', d: '7 天一个周期' },
      { v: 'biweek', n: '双周', d: '14 天一个周期' },
      { v: 'custom', n: '自定义', d: '任意天数' },
    ];

    UI.openSheet({
      title: '自定义记账周期',
      content: `
        <div class="field">
          <div class="field-label">周期类型</div>
          <div class="opt-grid opt-grid--2" id="c-types">
            ${TYPES.map((t) => `<button class="opt ${c.type === t.v ? 'on' : ''}" data-type="${t.v}" type="button"
              style="flex-direction:column;height:56px;gap:1px">
              <span>${t.n}</span><small>${t.d}</small></button>`).join('')}
          </div>
        </div>
        <div class="field" id="f-startday" ${c.type === 'month' ? '' : 'hidden'}>
          <div class="field-label">每月起始日（发薪日）</div>
          <div class="opt-grid" id="c-startdays">
            ${[1, 5, 10, 15, 20, 25].map((d) => `<button class="opt ${Number(c.startDay) === d ? 'on' : ''}" data-day="${d}" type="button">${d} 日</button>`).join('')}
          </div>
          <div class="row gap8 mt8">
            <!-- 刻意保留 type="number"：min/max 是此字段唯一的边界校验层（不走 amountToCents），改成 text 会让约束静默失效 -->
            <input class="field-input" id="c-startday-custom" type="number" inputmode="numeric" min="1" max="28" style="flex:1"
              placeholder="自定义 1-28" value="${Number(c.startDay) > 0 && [1, 5, 10, 15, 20, 25].indexOf(Number(c.startDay)) < 0 ? c.startDay : ''}" />
            <button class="btn btn--ghost btn--sm" style="width:auto;padding:0 16px" data-act="apply-day" type="button">应用</button>
          </div>
        </div>
        <div class="field" id="f-weekstart" ${c.type === 'week' ? '' : 'hidden'}>
          <div class="field-label">每周起始日</div>
          <div class="opt-grid" id="c-weekstarts">
            ${[1, 0].map((d) => `<button class="opt ${Number(c.weekStart) === d ? 'on' : ''}" data-ws="${d}" type="button">${d === 1 ? '周一' : '周日'}</button>`).join('')}
          </div>
        </div>
        <div class="field" id="f-days" ${c.type === 'custom' ? '' : 'hidden'}>
          <div class="field-label">每个周期多少天</div>
          <div class="opt-grid" id="c-days">
            ${[7, 14, 21, 28, 30, 60].map((d) => `<button class="opt ${Number(c.days) === d ? 'on' : ''}" data-days="${d}" type="button">${d} 天</button>`).join('')}
          </div>
          <!-- 刻意保留 type="number"：min/max 是此字段唯一的边界校验层（不走 amountToCents），改成 text 会让约束静默失效 -->
          <input class="field-input mt8" id="c-days-custom" type="number" inputmode="numeric" min="1" max="366" placeholder="自定义天数" value="${c.days}" />
        </div>
        <div class="field" id="f-anchor" ${(c.type === 'custom' || c.type === 'biweek') ? '' : 'hidden'}>
          <div class="field-label">周期起始日期（锚点）</div>
          <button class="field-input" id="c-anchor" style="text-align:left;display:flex;align-items:center;justify-content:space-between" type="button">
            <span>${c.anchor || '今天'}</span>${Icons.svg('calendar', 16)}
          </button>
        </div>
        <div class="card" style="background:var(--bg-2);box-shadow:none;border:0;margin-bottom:16px">
          <div class="small muted" style="line-height:1.7">
            💡 周期决定「明细」和「预算」的统计范围。例如把起始日设为 15 日，账单周期就是每月 15 日到次月 14 日，更贴合发薪日。
          </div>
        </div>
        <button class="btn btn--primary" data-act="save" type="button">保存并应用</button>
      `,
      onMount(body, close) {
        const typeBtns = body.querySelectorAll('[data-type]');
        function refreshFields() {
          body.querySelector('#f-startday').hidden = c.type !== 'month';
          body.querySelector('#f-weekstart').hidden = c.type !== 'week';
          body.querySelector('#f-days').hidden = c.type !== 'custom';
          body.querySelector('#f-anchor').hidden = !(c.type === 'custom' || c.type === 'biweek');
        }
        typeBtns.forEach((b) => {
          b.addEventListener('click', () => {
            c.type = b.dataset.type;
            typeBtns.forEach((x) => x.classList.toggle('on', x === b));
            refreshFields();
          });
        });
        body.querySelectorAll('[data-day]').forEach((b) => {
          b.addEventListener('click', () => {
            c.startDay = Number(b.dataset.day);
            body.querySelectorAll('[data-day]').forEach((x) => x.classList.toggle('on', x === b));
            body.querySelector('#c-startday-custom').value = '';
          });
        });
        body.querySelector('[data-act="apply-day"]').addEventListener('click', () => {
          const v = U.clamp(Number(body.querySelector('#c-startday-custom').value) || 1, 1, 28);
          c.startDay = v;
          body.querySelectorAll('[data-day]').forEach((x) => x.classList.remove('on'));
          body.querySelector('#c-startday-custom').value = v;
          U.toast('起始日已设为 ' + v + ' 日', 'success');
        });
        body.querySelectorAll('[data-ws]').forEach((b) => {
          b.addEventListener('click', () => {
            c.weekStart = Number(b.dataset.ws);
            body.querySelectorAll('[data-ws]').forEach((x) => x.classList.toggle('on', x === b));
          });
        });
        body.querySelectorAll('[data-days]').forEach((b) => {
          b.addEventListener('click', () => {
            c.days = Number(b.dataset.days);
            body.querySelector('#c-days-custom').value = c.days;
            body.querySelectorAll('[data-days]').forEach((x) => x.classList.toggle('on', x === b));
          });
        });
        body.querySelector('#c-days-custom').addEventListener('input', (e) => {
          c.days = U.clamp(Number(e.target.value) || 30, 1, 366);
        });
        body.querySelector('#c-anchor').addEventListener('click', () => {
          UI.datePicker({
            title: '选择周期起始日',
            value: c.anchor ? new Date(c.anchor).getTime() : Date.now(),
            onPick(ts) {
              c.anchor = U.ymd(new Date(ts));
              body.querySelector('#c-anchor span').textContent = c.anchor;
            },
          });
        });
        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          if (c.type === 'custom') c.days = U.clamp(Number(body.querySelector('#c-days-custom').value) || 30, 1, 366);
          if ((c.type === 'custom' || c.type === 'biweek') && !c.anchor) c.anchor = U.ymd(new Date());
          S.setCycle(c);
          S.resetAlertLog();
          close();
          App.refresh();
          U.toast('周期已更新', 'success');
        });
      },
    });
  }

  // ------------------------------------------------------------
  // 预算设置
  // ------------------------------------------------------------
  function openBudgetSheet() {
    const st = S.settings.budget;
    const split = { ...(st.split || {}) };
    const cats = Icons.CATEGORIES.filter((c) => c.kind === 'expense');

    UI.openSheet({
      title: '预算设置',
      content: `
        <div class="field">
          <div class="field-label">每周期总预算（元）</div>
          <input class="field-input amount" id="b-total" type="text" inputmode="decimal" enterkeyhint="done"
            placeholder="0.00" value="${st.amount ? (st.amount / 100) : ''}" />
          <div class="row gap8 mt8" style="flex-wrap:wrap">
            ${[1000, 3000, 5000, 8000, 12000].map((v) => `<button class="chip" data-quick="${v}" type="button">${v} 元</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <div class="field-label row-between">
            <span>分类预算（可选，留空表示不限制）</span>
            <button class="filter-btn" data-act="auto-split" type="button" style="height:28px;font-size:11.5px">一键分配</button>
          </div>
          <div id="b-cats" style="max-height:38vh;overflow-y:auto;margin:-4px -2px 0;padding:2px">
            ${cats.map((c) => `
              <div class="row gap8" style="padding:6px 0">
                <span style="width:30px;height:30px;border-radius:10px;display:grid;place-items:center;font-size:15px;background:${c.color}1A;flex:none">${Icons.catIcon ? Icons.catIcon(c) : c.icon}</span>
                <span style="flex:1;font-size:13px">${c.name}</span>
                <input class="field-input" data-cat="${c.id}" type="text" inputmode="decimal" enterkeyhint="done"
                  style="width:104px;height:38px;text-align:right;font-size:13.5px"
                  placeholder="不限" value="${split[c.id] ? (split[c.id] / 100) : ''}" />
              </div>`).join('')}
          </div>
        </div>
        <div class="card" style="background:var(--bg-2);box-shadow:none;border:0;margin-bottom:14px">
          <div class="small muted" style="line-height:1.7">
            💡 预算按「当前记账周期」统计。分类预算可以帮你盯住容易超支的类别，比如餐饮、购物。
          </div>
        </div>
        <div class="sheet-foot">
          <button class="btn btn--primary" data-act="save" type="button">保存预算</button>
        </div>
      `,
      onMount(body, close) {
        const total = body.querySelector('#b-total');
        body.querySelectorAll('[data-quick]').forEach((b) => {
          b.addEventListener('click', () => { total.value = b.dataset.quick; });
        });
        body.querySelector('[data-act="auto-split"]').addEventListener('click', () => {
          const amt = U.toCents(total.value);
          if (amt <= 0) { U.toast('请先填写总预算', 'error'); return; }
          // 按常用比例分配：餐饮 30% / 居住 30% / 交通 10% / 购物 15% / 娱乐 8% / 其他 7%
          const ratio = { food: 0.3, housing: 0.3, transport: 0.1, shopping: 0.15, fun: 0.08, market: 0.07 };
          body.querySelectorAll('[data-cat]').forEach((inp) => {
            const r = ratio[inp.dataset.cat];
            inp.value = r ? Math.round(amt * r / 100) : '';
          });
          U.toast('已按常见比例分配', 'success');
        });
        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          const amt = U.toCents(total.value);
          const out = {};
          body.querySelectorAll('[data-cat]').forEach((inp) => {
            const v = U.toCents(inp.value);
            if (v > 0) out[inp.dataset.cat] = v;
          });
          const sumSplit = Object.values(out).reduce((s, v) => s + v, 0);
          if (amt > 0 && sumSplit > amt) {
            U.toast('分类预算之和超过了总预算', 'error');
            return;
          }
          S.setBudget(amt, out);
          S.resetAlertLog();
          close();
          App.refresh();
          U.toast(amt > 0 ? '预算已保存' : '已关闭预算', 'success');
        });
      },
    });
  }

  // ------------------------------------------------------------
  // 提醒设置
  // ------------------------------------------------------------
  function openAlertSheet() {
    const a = { ...S.settings.alert, thresholds: (S.settings.alert.thresholds || []).slice() };

    UI.openSheet({
      title: '低预算提醒',
      content: `
        <div class="set-card" style="margin-bottom:14px">
          <div class="set-row" style="cursor:default">
            <span class="set-ic warn">${Icons.svg('bell', 16)}</span>
            <span class="set-main"><span class="set-name">开启提醒</span>
              <span class="set-desc">达到阈值时弹窗提示</span></span>
            <span class="switch ${a.enabled ? 'on' : ''}" id="a-enabled"></span>
          </div>
        </div>
        <div class="field">
          <div class="field-label">提醒阈值（可多选）</div>
          <div class="opt-grid" id="a-thresholds">
            ${[50, 60, 70, 80, 90, 100].map((v) => `<button class="opt ${a.thresholds.indexOf(v) >= 0 ? 'on' : ''}" data-th="${v}" type="button">${v}%</button>`).join('')}
          </div>
          <div class="small muted mt8">达到所选比例时提醒一次，每个周期内不重复打扰。</div>
        </div>
        <div class="card" style="background:var(--bg-2);box-shadow:none;border:0;margin-bottom:14px">
          <div class="small muted" style="line-height:1.7">
            💡 预算使用比例达到阈值时，会在记账后弹出提醒；「明细」页顶部也会常驻显示预算状态条。
          </div>
        </div>
        <button class="btn btn--primary" data-act="save" type="button">保存</button>
      `,
      onMount(body, close) {
        const sw = body.querySelector('#a-enabled');
        sw.addEventListener('click', () => {
          a.enabled = !a.enabled;
          sw.classList.toggle('on', a.enabled);
        });
        body.querySelectorAll('[data-th]').forEach((b) => {
          b.addEventListener('click', () => {
            const v = Number(b.dataset.th);
            const i = a.thresholds.indexOf(v);
            if (i >= 0) a.thresholds.splice(i, 1); else a.thresholds.push(v);
            b.classList.toggle('on', i < 0);
          });
        });
        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          if (a.enabled && !a.thresholds.length) {
            U.toast('请至少选择一个阈值', 'error');
            return;
          }
          S.setSettings({ alert: { enabled: a.enabled, thresholds: a.thresholds.sort((x, y) => x - y) } });
          S.resetAlertLog();
          close();
          App.refresh();
          U.toast('提醒设置已保存', 'success');
        });
      },
    });
  }

  function openTipSheet() {
    const cur = S.settings.tip || {};
    const on = cur.enabled !== false;
    const t = global.Tips ? global.Tips.forYesterday() : null;

    UI.openSheet({
      title: '暖心提示',
      content: `
        <div class="set-card" style="margin-bottom:14px">
          <div class="set-row" style="cursor:default">
            <span class="set-ic" style="background:rgba(255,176,32,.14)">🌤</span>
            <span class="set-main"><span class="set-name">每天说句贴心话</span>
              <span class="set-desc">根据前一天的开销分布生成</span></span>
            <span class="switch ${on ? 'on' : ''}" id="t-enabled"></span>
          </div>
        </div>

        ${t && t.items.length ? `
          <div class="field">
            <div class="field-label">昨天的提示（示例）</div>
            <div class="tip-sheet-lines" style="padding-top:0">
              ${t.items.map((it) => `
                <div class="tip-line tone-${it.tone}">
                  <span class="tip-e">${it.emoji}</span>
                  <span class="tip-t">${U.escapeHtml(it.text)}</span>
                </div>`).join('')}
            </div>
          </div>` : ''}

        <div class="field">
          <div class="field-label">显示位置</div>
          <div class="opt-grid" id="t-places">
            ${[['add', '记账页卡片'], ['slim', '仅单行提示'], ['off', '不显示']].map(([v, n]) =>
              `<button class="opt ${(cur.place || 'add') === v ? 'on' : ''}" data-place="${v}" type="button">${n}</button>`).join('')}
          </div>
        </div>

        <div class="card tip-sheet-note" style="background:var(--bg-2);box-shadow:none;border:0;margin-bottom:14px">
          <div class="small muted" style="line-height:1.7">
            💡 提示完全由本机规则生成：先看昨天各类花了多少、占比高低，再挑一句合适的话。<b>不需要联网，也不接任何 AI 接口</b>，你的账目不会离开这台设备。
          </div>
        </div>

        <button class="btn btn--primary" data-act="save" type="button">保存</button>
      `,
      onMount(body, close) {
        const sw = body.querySelector('#t-enabled');
        sw.addEventListener('click', () => { body.__on = !(body.__on === undefined ? on : body.__on); sw.classList.toggle('on', body.__on); });
        body.__on = on;
        let place = cur.place || 'add';
        body.querySelectorAll('[data-place]').forEach((b) => {
          b.addEventListener('click', () => {
            place = b.dataset.place;
            body.querySelectorAll('[data-place]').forEach((x) => x.classList.toggle('on', x === b));
          });
        });
        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          const enabledNow = body.__on;
          S.setSettings({ tip: { enabled: enabledNow, place } });
          if (global.Tips) global.Tips.clearCache();
          close();
          App.refresh();
          U.toast(enabledNow ? '暖心提示已开启' : '暖心提示已关闭', enabledNow ? 'success' : 'info');
        });
      },
    });
  }

  // ------------------------------------------------------------
  // AI 接口配置
  // ------------------------------------------------------------
  function openAiSheet() {
    const cur = { ...(S.settings.ai || {}) };
    const presets = (global.AI && global.AI.PRESETS) || [];
    const style = cur.style || 'warm';

    UI.openSheet({
      title: '接入自己的 AI',
      content: `
        <div class="card" style="background:var(--brand-soft);box-shadow:none;border:0;margin-bottom:16px">
          <div class="small" style="line-height:1.75;color:var(--text-2)">
            <b>完全可选。</b>不填也能正常记账 —— 暖心提示由本机规则生成。
            填了之后，AI 会读你的账目，写出更像人话的每日/每月总结，并自己挑一张最值得看的图。<br>
            Key 只存在这台设备的 localStorage 里，直接发给你选的服务商，不经过任何中间服务器。
          </div>
        </div>

        <div class="field">
          <div class="field-label">服务商</div>
          <div class="ai-preset-grid" id="ai-presets">
            ${presets.map((p) => `
              <button class="ai-preset ${cur.preset === p.id ? 'on' : ''}" data-preset="${p.id}" type="button">
                ${p.badge ? `<span class="ai-badge">${U.escapeHtml(p.badge)}</span>` : ''}
                <b>${U.escapeHtml(p.name)}</b>
                <small>${U.escapeHtml(p.note || '')}</small>
              </button>`).join('')}
          </div>
        </div>

        <div class="field">
          <div class="field-label">API Key <span id="ai-key-hint" class="small muted" style="font-weight:400"></span></div>
          <div class="ai-key-row">
            <input class="field-input" id="ai-key" type="password" autocomplete="off" spellcheck="false"
              placeholder="sk-..." value="${U.escapeHtml(cur.apiKey || '')}" />
            <button class="ai-eye" id="ai-eye" type="button" aria-label="显示/隐藏">👁</button>
          </div>
          <a id="ai-keylink" class="small" href="#" target="_blank" rel="noopener"
            style="display:none;margin-top:7px;color:var(--brand);text-decoration:none">去申请 Key ↗</a>
        </div>

        <div class="field">
          <div class="field-label">接口地址（Base URL）</div>
          <input class="field-input" id="ai-base" type="url" spellcheck="false" autocapitalize="off"
            autocomplete="off" enterkeyhint="done"
            placeholder="https://.../v1" value="${U.escapeHtml(cur.baseUrl || '')}" />
          <div class="small muted" style="margin-top:6px;line-height:1.6">
            兼容 OpenAI 格式的服务都行，会自动补 <code>/chat/completions</code>
          </div>
        </div>

        <div class="field">
          <div class="field-label">文字模型</div>
          <input class="field-input" id="ai-model" type="text" spellcheck="false" enterkeyhint="done"
            placeholder="qwen-plus" value="${U.escapeHtml(cur.model || '')}" />
        </div>

        <div class="field">
          <div class="field-label">识图模型 <span class="small muted" style="font-weight:400">留空则不做 AI 识图</span></div>
          <input class="field-input" id="ai-vmodel" type="text" spellcheck="false" enterkeyhint="done"
            placeholder="qwen-vl-max" value="${U.escapeHtml(cur.visionModel || '')}" />
        </div>

        <div class="field">
          <div class="field-label">说话风格</div>
          <div class="opt-grid" id="ai-styles">
            ${[['warm', '温暖'], ['plain', '平实'], ['funny', '轻松']].map(([v, n]) =>
              `<button class="opt ${style === v ? 'on' : ''}" data-style="${v}" type="button">${n}</button>`).join('')}
          </div>
        </div>

        <div id="ai-status-slot"></div>

        <div class="row gap8" style="margin:4px 0 16px">
          <button class="btn btn--ghost btn--sm" id="ai-test" type="button" style="flex:1">测试连接</button>
          <button class="btn btn--ghost btn--sm" id="ai-testv" type="button" style="flex:1">测试识图</button>
        </div>

        <button class="btn btn--primary" data-act="save" type="button">保存并开启</button>
      `,
      onMount(body, close) {
        const $ = (s) => body.querySelector(s);
        const keyEl = $('#ai-key');
        const baseEl = $('#ai-base');
        const modelEl = $('#ai-model');
        const vmodelEl = $('#ai-vmodel');
        const hintEl = $('#ai-key-hint');
        let preset = cur.preset || 'dashscope';
        let styleNow = style;

        function applyPreset(id, fillOnly) {
          preset = id;
          const pr = global.AI && global.AI.preset(id);
          body.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('on', x.dataset.preset === id));
          if (pr && fillOnly) {
            baseEl.value = pr.baseUrl || '';
            modelEl.value = pr.model || '';
            vmodelEl.value = pr.visionModel || '';
            hintEl.textContent = pr.keyOptional ? '（可留空）' : '';
            keyEl.placeholder = pr.id === 'custom' ? 'sk-...' : '粘贴你的 API Key';
            const linkEl = $('#ai-keylink');
            if (pr.keyUrl) {
              linkEl.style.display = '';
              linkEl.href = pr.keyUrl;
              linkEl.textContent = '去申请 ' + pr.name + ' Key ↗';
            } else {
              linkEl.style.display = 'none';
            }
          }
        }

        body.querySelectorAll('[data-preset]').forEach((b) => {
          b.addEventListener('click', () => applyPreset(b.dataset.preset, true));
        });
        applyPreset(preset, !cur.baseUrl);

        $('#ai-eye').addEventListener('click', () => {
          keyEl.type = keyEl.type === 'password' ? 'text' : 'password';
        });

        body.querySelectorAll('[data-style]').forEach((b) => {
          b.addEventListener('click', () => {
            styleNow = b.dataset.style;
            body.querySelectorAll('[data-style]').forEach((x) => x.classList.toggle('on', x === b));
          });
        });

        function draftCfg() {
          return {
            preset, baseUrl: baseEl.value.trim(), apiKey: keyEl.value.trim(),
            model: modelEl.value.trim(), visionModel: vmodelEl.value.trim(), style: styleNow,
          };
        }

        function setStatus(kind, msg) {
          $('#ai-status-slot').innerHTML = msg
            ? `<div class="ai-status ai-status--${kind}">${kind === 'ok' ? '✅' : kind === 'err' ? '⚠️' : '⏳'} <span>${U.escapeHtml(msg)}</span></div>`
            : '';
        }

        function withDraft(fn) {
          const saved = JSON.parse(JSON.stringify(S.settings.ai || {}));
          const draft = draftCfg();
          S.settings.ai = Object.assign({}, saved, draft, { enabled: true });
          return Promise.resolve()
            .then(fn)
            .finally(() => { S.settings.ai = saved; });
        }

        $('#ai-test').addEventListener('click', (e) => {
          const btn = e.currentTarget;
          if (!draftCfg().baseUrl || !draftCfg().model) { setStatus('err', '先填接口地址和文字模型'); return; }
          btn.disabled = true;
          setStatus('run', '正在连接…');
          withDraft(() => global.AI.test())
            .then((r) => setStatus('ok', `连接成功，模型回了：${String(r && r.text || '').slice(0, 40)}`))
            .catch((err) => setStatus('err', err.message))
            .finally(() => { btn.disabled = false; });
        });

        $('#ai-testv').addEventListener('click', (e) => {
          const btn = e.currentTarget;
          if (!draftCfg().visionModel) { setStatus('err', '先填识图模型，或用「本地 OCR」引擎'); return; }
          btn.disabled = true;
          setStatus('run', '正在试识图…');
          withDraft(() => global.AI.testVision())
            .then(() => setStatus('ok', '识图模型可用'))
            .catch((err) => setStatus('err', err.message))
            .finally(() => { btn.disabled = false; });
        });

        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          const d = draftCfg();
          if (!d.baseUrl) { setStatus('err', '接口地址不能为空'); return; }
          if (!d.model) { setStatus('err', '文字模型不能为空'); return; }
          const pr = global.AI && global.AI.preset(d.preset);
          if (!d.apiKey && !(pr && pr.keyOptional)) { setStatus('err', '这个服务商需要 API Key'); return; }
          S.setSettings({ ai: Object.assign({}, d, { enabled: true }) });
          if (global.AI) global.AI.clearCache();
          close();
          App.refresh();
          U.toast('AI 接口已保存', 'success');
        });
      },
    });
  }

  // ------------------------------------------------------------
  // 识图引擎设置
  // ------------------------------------------------------------
  function openScanSheet() {
    const cur = S.settings.scan || {};
    const engine = cur.engine || 'auto';
    const canAI = !!(global.AI && global.AI.canVision());
    const aiName = canAI ? (S.settings.ai.visionModel || '视觉模型') : '未配置';

    UI.openSheet({
      title: '识图记账',
      content: `
        <div class="small muted" style="line-height:1.75;margin-bottom:16px">
          把微信 / 支付宝 / 拼多多的账单截图丢进来，自动识别金额、商家和分类，确认后一次记入账本。
        </div>

        <div class="field">
          <div class="field-label">识别引擎</div>
          <div class="opt-grid opt-grid--3" id="s-engines">
            ${[['auto', '自动'], ['ai', 'AI 识图'], ['ocr', '本地 OCR']].map(([v, n]) =>
              `<button class="opt ${engine === v ? 'on' : ''}" data-engine="${v}" type="button">${n}</button>`).join('')}
          </div>
        </div>

        <div class="set-card" style="margin-bottom:14px">
          <div class="set-row" style="cursor:default">
            <span class="set-ic">${Icons.svg('sparkle', 16)}</span>
            <span class="set-main"><span class="set-name">AI 识图</span>
              <span class="set-desc">${canAI ? U.escapeHtml(aiName) + ' · 更准，按量计费' : '未配置视觉模型'}</span></span>
            <span class="set-val">${canAI ? '<span class="pill pill--brand">可用</span>' : '<span class="pill">未配置</span>'}</span>
          </div>
          <div class="set-row" style="cursor:default">
            <span class="set-ic warn">${Icons.svg('list', 16)}</span>
            <span class="set-main"><span class="set-name">本地 OCR</span>
              <span class="set-desc">tesseract.js 在手机里跑，首次需联网下载约 20MB</span></span>
            <span class="set-val"><span class="pill">免费</span></span>
          </div>
        </div>

        <div class="card tip-sheet-note" style="background:var(--bg-2);box-shadow:none;border:0;margin-bottom:14px">
          <div class="small muted" style="line-height:1.7">
            💡 <b>自动</b>：配了视觉模型就用 AI，没配就用本地 OCR。<br>
            截图只在设备上处理，压缩后才会发给你自己的 AI 服务商，不经过中间服务器。
          </div>
        </div>

        <button class="btn btn--primary" data-act="save" type="button">保存</button>
      `,
      onMount(body, close) {
        let eng = engine;
        body.querySelectorAll('[data-engine]').forEach((b) => {
          b.addEventListener('click', () => {
            eng = b.dataset.engine;
            body.querySelectorAll('[data-engine]').forEach((x) => x.classList.toggle('on', x === b));
          });
        });
        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          S.setSettings({ scan: { engine: eng } });
          close();
          App.refresh();
          U.toast('识图引擎已设为' + ({ auto: '自动', ai: 'AI 识图', ocr: '本地 OCR' }[eng]), 'success');
        });
      },
    });
  }

  // ------------------------------------------------------------
  // 多账本管理
  // ------------------------------------------------------------
  const BOOK_ICONS = ['📒', '✈️', '🏠', '🎒', '💼', '🎁', '🏝️', '🚗', '🐱', '🎓'];
  const BOOK_COLORS = ['#4F7CFF', '#14B87A', '#FF7A45', '#A56CFF', '#FFB020', '#FF5A5F', '#00B8D9', '#8C8C8C'];

  function openBooksSheet() {
    UI.openSheet({
      title: '多账本',
      content: renderBooksBody(),
      onMount(body, close) { mountBooks(body, close); },
    });
  }

  function renderBooksBody() {
    const list = S.books();
    const active = S.activeBookId();
    return `
      <div class="small muted" style="line-height:1.75;margin-bottom:14px">
        不同用途分开记：日常开销、旅行花销、装修预算各记各的，统计和预算互不干扰。
      </div>
      <div id="bk-rows">
        ${list.map((b) => {
          const n = S.state.tx.filter((t) => t.bookId === b.id).length;
          return `
            <div class="bk-row ${b.id === active ? 'on' : ''}" data-row="${b.id}">
              <span class="bk-row-ic" style="background:${b.color}1F">${b.icon}</span>
              <span class="bk-row-main">
                <span class="bk-row-name">${U.escapeHtml(b.name)}${b.id === active ? ' <span class="pill pill--brand">当前</span>' : ''}</span>
                <span class="bk-row-sub">${n} 笔账目</span>
              </span>
              <span class="bk-row-ops">
                ${b.id === active ? '' : `<button class="bk-op" data-bkact="switch" data-id="${b.id}" type="button" aria-label="切换">${Icons.svg('check', 15)}</button>`}
                <button class="bk-op" data-bkact="edit" data-id="${b.id}" type="button" aria-label="编辑">${Icons.svg('edit', 15)}</button>
                ${list.length > 1 ? `<button class="bk-op danger" data-bkact="del" data-id="${b.id}" type="button" aria-label="删除">${Icons.svg('trash', 15)}</button>` : ''}
              </span>
            </div>`;
        }).join('')}
      </div>
      <button class="btn btn--primary" style="margin-top:14px" data-bkact="add" type="button">
        ${Icons.svg('plus', 16)} 新建账本
      </button>
    `;
  }

  function mountBooks(body, close) {
    const rerender = () => {
      const top = body.scrollTop;
      body.innerHTML = renderBooksBody();
      body.scrollTop = top;
      mountBooks(body, close);
    };

    body.querySelectorAll('[data-bkact]').forEach((b) => {
      b.addEventListener('click', async () => {
        const act = b.dataset.bkact;
        const id = b.dataset.id;
        if (act === 'switch') {
          S.switchBook(id);
          rerender();
          App.refreshTopbar();
          U.toast('已切换到「' + S.activeBook().name + '」', 'success');
        } else if (act === 'add') {
          openBookEdit(null, rerender);
        } else if (act === 'edit') {
          openBookEdit(S.bookById(id), rerender);
        } else if (act === 'del') {
          const bk = S.bookById(id);
          const n = S.state.tx.filter((t) => t.bookId === id).length;
          const ok = await UI.confirm({
            title: `删除账本「${U.escapeHtml(bk.name)}」？`,
            desc: n ? `这个账本里有 <b>${n}</b> 笔账目，会一起删除且无法恢复。<br/>只想合并的话，可以先去编辑里改名，或先导出备份。` : '这个账本是空的，删除没有风险。',
            danger: true, okText: '删除',
          });
          if (!ok) return;
          try {
            S.removeBook(id);
            rerender();
            App.refreshTopbar();
            U.toast('账本已删除', 'success');
          } catch (e) { U.toast(e.message, 'error'); }
        }
      });
    });
  }

  function openBookEdit(book, onDone) {
    const isNew = !book;
    const d = {
      name: book ? book.name : '',
      icon: book ? book.icon : BOOK_ICONS[0],
      color: book ? book.color : BOOK_COLORS[0],
    };
    UI.openSheet({
      title: isNew ? '新建账本' : '编辑账本',
      content: `
        <div class="catm-preview" style="margin-bottom:16px" id="bk-preview">
          <span class="catm-preview-ic" id="bk-pv-ic" style="background:${d.color}22">${d.icon}</span>
          <span class="catm-preview-main">
            <span class="catm-preview-name" id="bk-pv-name">${U.escapeHtml(d.name || '新账本')}</span>
            <span class="catm-preview-sub">${isNew ? '会创建一本空账本' : '账本名称可以随时改'}</span>
          </span>
        </div>

        <div class="field">
          <div class="field-label">账本名称</div>
          <input class="field-input" id="bk-name" type="text" maxlength="12" placeholder="例如：旅行" value="${U.escapeHtml(d.name)}" />
        </div>

        <div class="field">
          <div class="field-label">图标</div>
          <div class="emoji-grid" id="bk-icons">
            ${BOOK_ICONS.map((e) => `<button class="emoji-btn ${e === d.icon ? 'on' : ''}" data-icon="${e}" type="button">${e}</button>`).join('')}
          </div>
        </div>

        <div class="field">
          <div class="field-label">颜色</div>
          <div class="color-row" id="bk-colors">
            ${BOOK_COLORS.map((c) => `<button class="color-dot ${c === d.color ? 'on' : ''}" data-color="${c}" style="background:${c}" type="button"></button>`).join('')}
          </div>
        </div>

        <button class="btn btn--primary" data-act="save" type="button">${isNew ? '创建账本' : '保存'}</button>
      `,
      onMount(body, close) {
        const nameEl = body.querySelector('#bk-name');
        const pvName = body.querySelector('#bk-pv-name');
        const pvIc = body.querySelector('#bk-pv-ic');
        const sync = () => {
          pvName.textContent = nameEl.value.trim() || '新账本';
          pvIc.textContent = d.icon;
          pvIc.style.background = d.color + '22';
        };
        nameEl.addEventListener('input', sync);
        body.querySelectorAll('[data-icon]').forEach((b) => {
          b.addEventListener('click', () => {
            d.icon = b.dataset.icon;
            body.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x === b));
            sync();
          });
        });
        body.querySelectorAll('[data-color]').forEach((b) => {
          b.addEventListener('click', () => {
            d.color = b.dataset.color;
            body.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
            sync();
          });
        });
        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          const nm = nameEl.value.trim();
          if (!nm) { U.toast('给账本起个名字', 'error'); return; }
          if (isNew) {
            const b = S.addBook({ name: nm, icon: d.icon, color: d.color });
            S.switchBook(b.id);
            U.toast('已创建「' + nm + '」并切换过去', 'success');
          } else {
            S.updateBook(book.id, { name: nm, icon: d.icon, color: d.color });
            U.toast('已保存', 'success');
          }
          close();
          App.refreshTopbar();
          if (onDone) onDone();
        });
      },
    });
  }

  // （周期性自动记账功能已删除 —— 与「省钱与提醒」里的固定月支出重复）

  // （周期性自动记账的规则编辑页已随功能一起删除）

  function openCatsSheet() {
    let kind = 'expense';
    UI.openSheet({
      title: '分类管理',
      content: renderCatsBody(kind),
      onMount(body, close) { mountCats(body, close, () => kind, (k) => { kind = k; }); },
    });
  }

  function renderCatsBody(kind) {
    const cc = S.catConfig();
    const all = Icons.CATEGORIES.filter((c) => c.kind === kind);
    const hiddenBuiltin = Icons.BUILTIN.filter((b) => b.kind === kind && cc.hidden.indexOf(b.id) >= 0);
    return `
      <div class="catm-head">
        <button class="${kind === 'expense' ? 'on' : ''}" data-ckind="expense" type="button">支出分类</button>
        <button class="${kind === 'income' ? 'on' : ''}" data-ckind="income" type="button">收入分类</button>
      </div>

      <div class="catm-grid" id="catm-grid">
        ${all.map((c) => `
          <button class="catm-item" data-cedit="${c.id}" type="button">
            <span class="catm-item-ic" style="background:${c.color}1A;color:${c.color}">${Icons.catIcon(c)}</span>
            <span class="catm-item-main">
              <span class="catm-item-name">${U.escapeHtml(c.name)}</span>
              <span class="catm-item-sub">${c.subs && c.subs.length ? c.subs.length + ' 个二级标签' : '无二级标签'}${c.custom ? ' · 自定义' : ''}</span>
            </span>
            <span class="catm-item-op">${Icons.svg('edit', 13)}</span>
          </button>`).join('')}
      </div>

      ${hiddenBuiltin.length ? `
        <div class="field-label" style="margin:16px 0 8px">已隐藏的内置分类</div>
        <div class="catm-grid">
          ${hiddenBuiltin.map((c) => `
            <button class="catm-item hidden" data-crestore="${c.id}" type="button">
              <span class="catm-item-ic" style="background:${c.color}1A;color:${c.color}">${Icons.catIcon(c)}</span>
              <span class="catm-item-main">
                <span class="catm-item-name">${U.escapeHtml(c.name)}</span>
                <span class="catm-item-sub">点一下恢复</span>
              </span>
              <span class="catm-item-op">${Icons.svg('refresh', 13)}</span>
            </button>`).join('')}
        </div>` : ''}

      <div class="catm-tools">
        <button class="btn btn--ghost btn--sm" data-cact="restore-all" type="button">恢复全部内置</button>
        <button class="btn btn--primary btn--sm" data-cact="add" type="button">${Icons.svg('plus', 15)} 新建分类</button>
      </div>
      <div class="small muted" style="margin-top:12px;line-height:1.7">
        内置分类可以改名、换图标、改二级标签或隐藏；自定义分类可以完全删除。<br/>
        删除后，已有账目会归到「其他」，不会丢账。
      </div>
    `;
  }

  function mountCats(body, close, getKind, setKind) {
    const rerender = () => {
      const top = body.scrollTop;
      body.innerHTML = renderCatsBody(getKind());
      body.scrollTop = top;
      mountCats(body, close, getKind, setKind);
    };

    body.querySelectorAll('[data-ckind]').forEach((b) => {
      b.addEventListener('click', () => {
        setKind(b.dataset.ckind);
        rerender();
      });
    });
    body.querySelectorAll('[data-cedit]').forEach((b) => {
      b.addEventListener('click', () => openCatEdit(b.dataset.cedit, null, rerender));
    });
    body.querySelectorAll('[data-crestore]').forEach((b) => {
      b.addEventListener('click', () => {
        S.restoreCategory(b.dataset.crestore);
        rerender();
        U.toast('已恢复', 'success');
      });
    });
    body.querySelectorAll('[data-cact]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (b.dataset.cact === 'add') {
          openCatEdit(null, getKind(), rerender);
        } else if (b.dataset.cact === 'restore-all') {
          const ok = await UI.confirm({ title: '恢复全部内置分类？', desc: '隐藏的内置分类会全部回来，自定义分类保留。', okText: '恢复' });
          if (!ok) return;
          S.restoreAllCategories();
          rerender();
          U.toast('已恢复全部内置分类', 'success');
        }
      });
    });
  }

  const CAT_ICONS = ['🍜', '🛒', '🚌', '🛍️', '🏠', '🎮', '💊', '📚', '🎁', '📱', '🐱', '🍼', '✈️', '💅', '🚗', '📦', '💰', '🎵', '☕', '🏋️', '🎬', '🧾'];
  const CAT_COLORS = ['#4F7CFF', '#14B87A', '#FF7A45', '#A56CFF', '#FFB020', '#FF5A5F', '#00B8D9', '#8C8C8C', '#E91E63', '#7CB342'];

  function openCatEdit(id, newKind, onDone) {
    const isNew = !id;
    const cur = isNew ? null : Icons.cat(id);
    const isBuiltin = isNew ? false : Icons.isBuiltin(id);
    const d = {
      name: cur ? cur.name : '',
      icon: cur ? cur.icon : CAT_ICONS[0],
      color: cur ? cur.color : CAT_COLORS[0],
      kind: cur ? cur.kind : (newKind || 'expense'),
      subs: cur ? (cur.subs || []).slice() : [],
    };
    // 红包的图标是手绘 SVG（不是 emoji），不在 CAT_ICONS 里。不回填的话，
    // 用户只改个名字保存，图标就会被 S.updateCategory 改回第一个 emoji，悄悄丢掉设计好的图标。
    const isSvgIcon = typeof d.icon === 'string' && d.icon.indexOf('<svg') === 0;
    const iconChoices = (isSvgIcon ? [] : CAT_ICONS).slice();
    if (isSvgIcon) iconChoices.unshift(d.icon);

    UI.openSheet({
      title: isNew ? '新建分类' : (isBuiltin ? '编辑内置分类' : '编辑自定义分类'),
      content: `
        <div class="catm-preview" style="margin-bottom:16px">
          <span class="catm-preview-ic" id="cat-pv-ic" style="background:${d.color}22;color:${d.color}">${Icons.catIcon(d)}</span>
          <span class="catm-preview-main">
            <span class="catm-preview-name" id="cat-pv-name">${U.escapeHtml(d.name || '新分类')}</span>
            <span class="catm-preview-sub" id="cat-pv-sub">${d.subs.length} 个二级标签 · ${d.kind === 'income' ? '收入' : '支出'}</span>
          </span>
        </div>

        <div class="field">
          <div class="field-label">名称</div>
          <input class="field-input" id="cat-name" type="text" maxlength="8" placeholder="例如：宠物" value="${U.escapeHtml(d.name)}" />
        </div>

        <div class="field">
          <div class="field-label">图标</div>
          <div class="emoji-grid" id="cat-icons">
            ${iconChoices.map((e) => `<button class="emoji-btn ${e === d.icon ? 'on' : ''}" data-icon="${U.escapeHtml(e)}" type="button">${Icons.catIcon({ icon: e })}</button>`).join('')}
          </div>
        </div>

        <div class="field">
          <div class="field-label">颜色</div>
          <div class="color-row" id="cat-colors">
            ${CAT_COLORS.map((c) => `<button class="color-dot ${c === d.color ? 'on' : ''}" data-color="${c}" style="background:${c}" type="button"></button>`).join('')}
          </div>
        </div>

        <div class="field">
          <div class="field-label">二级标签（用逗号分隔，可留空）</div>
          <input class="field-input" id="cat-subs" type="text" placeholder="例如：猫粮, 狗粮, 宠物医疗" value="${U.escapeHtml(d.subs.join(', '))}" />
        </div>

        <button class="btn btn--primary" data-act="save" type="button">${isNew ? '创建分类' : '保存'}</button>
        ${isBuiltin ? `
          <button class="btn btn--ghost" style="margin-top:9px;color:var(--expense)" data-act="del" type="button">隐藏这个内置分类</button>
          <div class="small muted" style="margin-top:9px;line-height:1.7;text-align:center">
            内置分类不能真删，只能隐藏；隐藏后已有账目归到「其他」。
          </div>` : `
          <button class="btn btn--ghost" style="margin-top:9px;color:var(--expense)" data-act="del" type="button">删除这个分类</button>`}
      `,
      onMount(body, close) {
        const nameEl = body.querySelector('#cat-name');
        const pvName = body.querySelector('#cat-pv-name');
        const pvIc = body.querySelector('#cat-pv-ic');
        const pvSub = body.querySelector('#cat-pv-sub');
        const subsEl = body.querySelector('#cat-subs');
        const sync = () => {
          pvName.textContent = nameEl.value.trim() || '新分类';
          // 选中手绘 SVG 的图标时 textContent 会把它当文字画出来，所以 SVG 走 innerHTML
          pvIc.innerHTML = Icons.catIcon({ icon: d.icon });
          pvIc.style.background = d.color + '22';
          pvIc.style.color = d.color;
          pvSub.textContent = parseSubs().length + ' 个二级标签 · ' + (d.kind === 'income' ? '收入' : '支出');
        };
        const parseSubs = () => String(subsEl.value || '')
          .split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
        nameEl.addEventListener('input', sync);
        subsEl.addEventListener('input', sync);
        const icWrap = body.querySelector('#cat-icons');
        const coWrap = body.querySelector('#cat-colors');
        icWrap.querySelectorAll('[data-icon]').forEach((b) => {
          b.addEventListener('click', () => {
            d.icon = b.dataset.icon;
            icWrap.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x === b));
            sync();
          });
        });
        coWrap.querySelectorAll('[data-color]').forEach((b) => {
          b.addEventListener('click', () => {
            d.color = b.dataset.color;
            coWrap.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
            sync();
          });
        });

        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          const nm = nameEl.value.trim();
          if (!nm) { U.toast('分类名不能为空', 'error'); return; }
          const subs = parseSubs();
          try {
            if (isNew) {
              S.addCategory({ name: nm, icon: d.icon, color: d.color, kind: d.kind, subs });
              U.toast('分类已创建', 'success');
            } else {
              S.updateCategory(id, { name: nm, icon: d.icon, color: d.color, subs });
              U.toast('已保存', 'success');
            }
            close();
            App.refresh();
            if (onDone) onDone();
          } catch (e) { U.toast(e.message, 'error'); }
        });

        const delBtn = body.querySelector('[data-act="del"]');
        if (delBtn) {
          delBtn.addEventListener('click', async () => {
            const ok = await UI.confirm({
              title: isBuiltin ? '隐藏这个分类？' : '删除这个分类？',
              desc: isBuiltin
                ? '隐藏后不再出现在记账页，已有账目会归到「其他」。随时可以在分类管理里恢复。'
                : '删除后不可恢复，已有账目会归到「其他」。',
              danger: true, okText: isBuiltin ? '隐藏' : '删除',
            });
            if (!ok) return;
            S.removeCategory(id);
            close();
            App.refresh();
            if (onDone) onDone();
            U.toast(isBuiltin ? '已隐藏' : '已删除', 'success');
          });
        }
      },
    });
  }

  // ------------------------------------------------------------
  // 账本币种
  // ------------------------------------------------------------
  function openCurrencySheet() {
    const book = S.activeBook();
    const curCode = (book.currency && book.currency.code) || 'CNY';
    const curRate = book.currency && Number(book.currency.rateToCny) || S.currencyOf(curCode).rate;
    let picked = curCode;

    UI.openSheet({
      title: '账本币种',
      content: `
        <div class="card" style="background:var(--card-2);border-style:dashed;margin-bottom:14px">
          <div class="small" style="line-height:1.75;color:var(--text-2)">
            这本账用哪种货币记。记账时显示外币，<b>入库一律存人民币</b>，所以统计、预算、图表都不受影响。<br/>
            汇率可以手动改，改了以后新记的账按新汇率折算（已记的不变）。<b>完全离线，不联网取汇率。</b>
          </div>
        </div>
        <div class="set-group-title">选择币种</div>
        <div class="cur-grid">
          ${S.CURRENCIES.map((c) => `
            <button class="cur-item ${c.code === picked ? 'on' : ''}" data-cur="${c.code}" type="button">
              <span class="cur-sym">${U.escapeHtml(c.symbol)}</span>
              <span class="cur-main"><span class="cur-code">${c.code}</span><span class="cur-name">${U.escapeHtml(c.name)}</span></span>
            </button>`).join('')}
        </div>
        <div class="field" id="cur-rate-field" style="${picked === 'CNY' ? 'display:none' : ''}">
          <label class="field-label">汇率（1 外币 = ? 人民币）</label>
          <input class="field-input" id="cur-rate" type="text" inputmode="decimal" enterkeyhint="done"
            value="${curRate}" placeholder="例如 7.12" />
        </div>
        <button class="btn btn--primary" data-act="save" type="button">保存</button>
      `,
      onMount(body, close) {
        const rateField = body.querySelector('#cur-rate-field');
        body.querySelectorAll('[data-cur]').forEach((b) => {
          b.addEventListener('click', () => {
            picked = b.dataset.cur;
            body.querySelectorAll('[data-cur]').forEach((x) => x.classList.toggle('on', x.dataset.cur === picked));
            rateField.style.display = picked === 'CNY' ? 'none' : '';
            const inp = body.querySelector('#cur-rate');
            if (inp) inp.value = S.currencyOf(picked).rate;
          });
        });
        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          if (picked === 'CNY') {
            S.updateBook(book.id, { currency: { code: 'CNY', symbol: '¥', rateToCny: 1 } });
          } else {
            const rate = Number(body.querySelector('#cur-rate').value);
            if (!(rate > 0)) { U.toast('汇率要大于 0', 'error'); return; }
            const c = S.currencyOf(picked);
            S.updateBook(book.id, { currency: { code: c.code, symbol: c.symbol, rateToCny: rate } });
          }
          close();
          App.refresh();
          render($('#view-settings'));
          U.toast('币种已保存', 'success');
        });
      },
    });
  }

  // ------------------------------------------------------------
  // 余钱归仓
  // ------------------------------------------------------------
  function openAutoSaveSheet() {
    const cfg = S.settings.autoSave || {};
    const goals = (S.state.goals || []).filter((g) => !g.archived);
    let goalId = cfg.goalId || (goals[0] ? goals[0].id : '');
    let ratio = cfg.ratio || 1;
    let cap = cfg.cap || 0;

    UI.openSheet({
      title: '余钱归仓',
      content: `
        <div class="card" style="background:var(--card-2);border-style:dashed;margin-bottom:14px">
          <div class="small" style="line-height:1.75;color:var(--text-2)">
            每个周期结束时，<b>没花完的预算</b>自动存进你选的攒钱目标。<br/>
            同一周期只会结算一次，反复打开也不会重复存。
          </div>
        </div>
        ${goals.length ? `
          <div class="set-group-title">存进哪个目标</div>
          <div class="goal-pick" id="as-goals">
            ${goals.map((g) => `
              <button class="goal-pick-item ${g.id === goalId ? 'on' : ''}" data-goal="${g.id}" type="button">
                <span class="goal-pick-ic" style="background:${g.color || '#4F7CFF'}1F">${g.icon || '🎯'}</span>
                <span class="goal-pick-main">
                  <span class="goal-pick-name">${U.escapeHtml(g.name)}</span>
                  <span class="goal-pick-sub">目标 ${U.money(g.target)} · 已存 ${U.money(g.saved)}</span>
                </span>
              </button>`).join('')}
          </div>
          <div class="set-group-title">存多少</div>
          <div class="ratio-grid" id="as-ratio">
            <button class="ratio-item ${ratio >= 1 ? 'on' : ''}" data-ratio="1" type="button">全部结余</button>
            <button class="ratio-item ${ratio === 0.5 ? 'on' : ''}" data-ratio="0.5" type="button">存一半</button>
            <button class="ratio-item ${ratio === 0.3 ? 'on' : ''}" data-ratio="0.3" type="button">存三成</button>
          </div>
          <div class="field">
            <label class="field-label">每期最多存（0 = 不限）</label>
            <!-- 刻意保留 type="number"：min/step 是此字段唯一的边界校验层（不走 amountToCents），改成 text 会让约束静默失效 -->
            <input class="field-input" id="as-cap" type="number" inputmode="numeric" min="0" step="1"
              value="${cap ? (cap / 100).toFixed(0) : ''}" placeholder="例如 500" />
          </div>
          <div class="small muted" id="as-preview" style="margin:2px 0 14px;line-height:1.7"></div>
          <button class="btn btn--primary" data-act="save" type="button">保存并开启</button>
        ` : `
          <div class="empty" style="padding:22px 0 24px">
            <div class="empty-emoji">🎯</div>
            <div class="empty-title">还没有攒钱目标</div>
            <div class="empty-desc">余钱要存进一个目标里，先去建一个吧</div>
            <button class="empty-btn" data-act="go-goals" type="button">去建目标</button>
          </div>
        `}
      `,
      onMount(body, close) {
        const saveBtn = body.querySelector('[data-act="save"]');
        const goGoals = body.querySelector('[data-act="go-goals"]');
        if (goGoals) {
          goGoals.addEventListener('click', () => { close(); App.go('goals'); });
          return;
        }
        body.querySelectorAll('[data-goal]').forEach((b) => {
          b.addEventListener('click', () => {
            goalId = b.dataset.goal;
            body.querySelectorAll('[data-goal]').forEach((x) => x.classList.toggle('on', x.dataset.goal === goalId));
          });
        });
        body.querySelectorAll('[data-ratio]').forEach((b) => {
          b.addEventListener('click', () => {
            ratio = Number(b.dataset.ratio);
            body.querySelectorAll('[data-ratio]').forEach((x) => x.classList.toggle('on', Number(x.dataset.ratio) === ratio));
          });
        });
        const inp = body.querySelector('#as-cap');
        inp.addEventListener('input', () => { cap = U.amountToCents(inp.value); });
        saveBtn.addEventListener('click', () => {
          if (!goalId) { U.toast('先选一个目标', 'error'); return; }
          cap = Math.max(0, Math.round(Number(inp.value || 0) * 100));
          S.setSettings({ autoSave: { enabled: true, goalId, ratio, cap } });
          close();
          render($('#view-settings'));
          U.toast('余钱归仓已开启', 'success');
        });
      },
    });
  }

  // ------------------------------------------------------------
  // 自动扣费提醒（原「订阅体检」）
  // ------------------------------------------------------------
  // ------------------------------------------------------------
  // 版本与更新
  // ------------------------------------------------------------
  function verLabel(v) { return v ? v : '未知'; }

  /** 把当前版本号填到「检查更新」那一行（APK 读包内 sw.js，网页读缓存名） */
  async function syncVersion(root) {
    const el = root.querySelector('[data-ver]');
    if (!el || !global.App) return;
    try {
      let v = '';
      if (App.isApk && App.isApk() && App.bundledVersion) v = await App.bundledVersion();
      else if (App.currentVersion) v = await App.currentVersion();
      if (v) el.textContent = v;
    } catch (e) { /* 忽略 */ }
  }

  async function doCheckUpdate(root) {
    if (!global.App || !App.checkUpdate) { U.toast('这个环境不支持检查更新', 'error'); return; }
    const state = root.querySelector('[data-ver-state]');
    const setState = (txt) => { if (state) state.textContent = txt; };
    setState('检查中…');
    let r;
    try { r = await App.checkUpdate(); } catch (e) { r = { ok: false, reason: 'offline' }; }
    if (!r.ok) {
      if (r.reason === 'unsupported') { setState('不支持'); U.toast('这个浏览器不支持离线更新', 'error'); }
      else { setState('连不上'); U.toast('现在连不上网，联网后再试', 'error'); }
      return;
    }
    const verEl = root.querySelector('[data-ver]');
    if (verEl && r.local) verEl.textContent = r.local;
    if (!r.hasUpdate) {
      setState('已是最新');
      U.toast(`已是最新版本 ${verLabel(r.remote || r.local)}`, 'success');
      return;
    }
    setState('有新版本');

    // APK：壳没法自己换安装包，只能把用户送去 GitHub Releases 下新包
    if (r.apk) {
      const go = await UI.confirm({
        title: `发现新版本 ${verLabel(r.remote)}`,
        desc: `你现在装的是 ${verLabel(r.local)}。<br/><br/>` +
          '安卓版的新包要重新下载安装：点「去 GitHub 下载」后用浏览器打开，' +
          '下载 <b>' + U.escapeHtml('whereipaid-v' + String(r.remote).replace(/^v/i, '') + '.apk') + '</b> 覆盖安装即可。' +
          '<br/><span style="color:var(--text-3)">覆盖安装不会动你的账目；保险起见可以先「导出备份」。</span>',
        okText: '去 GitHub 下载', cancelText: '等会儿',
      });
      if (go) location.href = App.GITHUB_RELEASES;
      return;
    }

    const yes = await UI.confirm({
      title: `发现新版本 ${verLabel(r.remote)}`,
      desc: `你现在用的是 ${verLabel(r.local)}。更新只换程序代码，<b>你的账目存在本机浏览器里，不会动</b>。` +
        '<br/><br/>更新时页面会自己刷新一下。' +
        '<br/><span style="color:var(--text-3)">保险起见，可以先去「导出备份」存一份。</span>',
      okText: '立即更新', cancelText: '等会儿',
    });
    if (yes && App.applyUpdate) App.applyUpdate();
  }

  // ------------------------------------------------------------
  // 固定月支出：房租 / 话费 / 宽带 / 水电 —— 每月一次，不是 App 订阅
  // ------------------------------------------------------------
  function openFixedSheet() {
    function bodyHtml() {
      let list = [];
      try { list = S.fixedExpenses(); } catch (e) { list = []; }
      const presets = S.fixedPresets ? S.fixedPresets() : [];
      return `
        <div class="card" style="background:var(--card-2);border-style:dashed;margin-bottom:14px">
          <div class="small" style="line-height:1.75;color:var(--text-2)">
            房租、话费、宽带、水电这类<b>每月固定的一笔</b>，在这里填一次，
            之后每个月到日子自动记账。它们不算「自动扣费」，所以不会出现在自动扣费提醒里。
          </div>
        </div>

        <div class="set-group-title">常用模板</div>
        <div class="ratio-grid" style="grid-template-columns:repeat(3,1fr)">
          ${presets.map((x) => `
            <button class="ratio-item" data-fixed-preset="${x.key}" type="button">${x.icon} ${U.escapeHtml(x.name)}</button>
          `).join('')}
        </div>

        <div class="set-group-title">添加 / 修改</div>
        <div class="fx-row">
          <input class="fx-input" id="fx-name" type="text" maxlength="12" placeholder="名称，如 房租" />
          <input class="fx-input" id="fx-amount" type="text" inputmode="decimal" placeholder="每月金额" />
        </div>
        <div class="fx-row">
          <!-- 刻意保留 type="number"：min/max 是此字段唯一的边界校验层（不走 amountToCents），改成 text 会让约束静默失效 -->
          <input class="fx-input" id="fx-day" type="number" inputmode="numeric" min="1" max="28" placeholder="每月几号（1-28）" />
        </div>
        <button class="btn btn--primary" data-act="fixed-add" type="button" style="margin-top:10px">加进每月固定支出</button>

        <div class="set-group-title">已经在自动记的 · ${list.length} 项</div>
        ${list.length ? `<div class="subs-list">
          ${list.map((r) => `
            <div class="subs-row">
              <span class="subs-row-ic">${Icons.cat(r.catId).icon}</span>
              <span class="subs-row-main">
                <span class="subs-row-name">${U.escapeHtml(r.name)}</span>
                <span class="subs-row-meta">每月 ${r.startDay} 号 · ${U.money(r.amount)}</span>
              </span>
              <span class="subs-row-ops">
                <button class="btn btn--sm btn--ghost" data-fixed-del="${r.id}" type="button">删除</button>
              </span>
            </div>
          `).join('')}
        </div>` : `<div class="empty" style="padding:14px 0 20px">
          <div class="empty-desc">还没有固定月支出，上面挑个模板填金额就行</div>
        </div>`}
      `;
    }

    UI.openSheet({
      title: '固定月支出',
      content: bodyHtml(),
      onMount(body, close) {
        function rerender() {
          const sc = body.scrollTop;
          body.innerHTML = bodyHtml();
          body.scrollTop = sc;
          mount();
        }
        function mount() {
          body.querySelectorAll('[data-fixed-preset]').forEach((b) => {
            b.addEventListener('click', () => {
              const p = (S.fixedPresets() || []).find((x) => x.key === b.dataset.fixedPreset);
              if (!p) return;
              const nameEl = body.querySelector('#fx-name');
              const dayEl = body.querySelector('#fx-day');
              if (nameEl) nameEl.value = p.name;
              if (dayEl) dayEl.value = String(p.day);
              const amt = body.querySelector('#fx-amount');
              if (amt) UI.focusKeyboard(amt);
            });
          });
          const add = body.querySelector('[data-act="fixed-add"]');
          if (add) {
            add.addEventListener('click', () => {
              const name = (body.querySelector('#fx-name').value || '').trim();
              const amount = U.amountToCents(body.querySelector('#fx-amount').value || '');
              const day = U.clamp(Number(body.querySelector('#fx-day').value) || 1, 1, 28);
              if (!name) { U.toast('先填个名称', 'error'); return; }
              if (!amount) { U.toast('金额不能为 0', 'error'); return; }
              const preset = (S.fixedPresets() || []).find((x) => x.name === name);
              try {
                S.addFixed({
                  name, amount, day,
                  catId: preset ? preset.catId : 'other_out',
                  sub: preset ? preset.sub : '',
                });
                U.toast(`已加上：每月 ${day} 号记 ${U.money(amount)} 的${name}`, 'success');
                rerender();
                render($('#view-settings'));
              } catch (e) {
                U.toast(e.message || '添加失败', 'error');
              }
            });
          }
          body.querySelectorAll('[data-fixed-del]').forEach((b) => {
            b.addEventListener('click', () => {
              S.removeRepeat(b.dataset.fixedDel);
              U.toast('已删除', 'success');
              rerender();
              render($('#view-settings'));
            });
          });
        }
        mount();
      },
    });
  }

  function openSubsSheet() {
    const cfg = S.settings.subAlert || {};
    let days = Number(cfg.daysBefore) || 3;
    let enabled = cfg.enabled !== false;

    function bodyHtml() {
      let subs = [];
      try { subs = S.scanSubscriptions(); } catch (e) { subs = []; }
      const PERIOD_CN = { weekly: '每周', monthly: '每月', quarterly: '每季', yearly: '每年' };
      return `
        <div class="card" style="background:var(--card-2);border-style:dashed;margin-bottom:14px">
          <div class="small" style="line-height:1.75;color:var(--text-2)">
            只找 <b>App / 线上服务的自动扣费</b>：视频会员、网盘、软件订阅、云服务…
            <b>房租、话费、水电这类不算</b>——它们是每月固定开销，请用「固定月支出」。<br/>
            发现后会在<b>下次扣款前</b>提醒你去关掉自动续费。
            判定方式：同一个商户出现 ≥3 次、间隔稳定、金额一致。<b>纯本地计算，不联网。</b>
          </div>
        </div>
        <div class="set-group-title">提醒设置</div>
        <div class="set-card">
          <div class="set-row" style="cursor:default">
            <span class="set-ic">🔔</span>
            <span class="set-main"><span class="set-name">续费提醒</span>
              <span class="set-desc">扣款前提醒你去关闭自动续费</span></span>
            <span class="set-val"><span class="switch ${enabled ? 'on' : ''}" data-subs-toggle></span></span>
          </div>
          <div style="padding:0 15px 14px">
            <div class="small muted" style="margin-bottom:8px">提前几天提醒</div>
            <div class="ratio-grid">
              ${[0, 1, 3, 7].map((d) => `
                <button class="ratio-item ${days === d ? 'on' : ''}" data-days="${d}" type="button">${d === 0 ? '当天' : d + ' 天前'}</button>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="set-group-title">发现 ${subs.length} 个疑似订阅</div>
        ${subs.length ? `<div class="subs-list" id="subs-list">
          ${subs.map((s) => `
            <div class="subs-row">
              <span class="subs-row-ic">🔁</span>
              <span class="subs-row-main">
                <span class="subs-row-name">${U.escapeHtml(s.name)}</span>
                <span class="subs-row-meta">${PERIOD_CN[s.period] || '每月'} ${U.money(s.avgAmount)} · 已扣 ${s.times} 次 · 累计 ${U.money(s.totalPaid)}</span>
                <span class="subs-row-next">下次预计 ${U.fullDate(s.nextTs)}（${s.daysToNext >= 0 ? s.daysToNext + ' 天后' : '已过 ' + (-s.daysToNext) + ' 天'}）</span>
              </span>
              <span class="subs-row-ops">
                <button class="btn btn--sm btn--ghost" data-sub-rule="${U.escapeHtml(s.key)}" type="button">转周期记账</button>
                <button class="btn btn--sm btn--ghost" data-sub-ignore="${U.escapeHtml(s.key)}" type="button">不是订阅</button>
              </span>
            </div>`).join('')}
        </div>` : `<div class="empty" style="padding:20px 0 24px">
          <div class="empty-emoji">🔍</div>
          <div class="empty-title">还没发现订阅</div>
          <div class="empty-desc">记账满 3 个月、或者导入一份历史账单，就能查得更准</div>
        </div>`}
        <button class="btn btn--primary" data-act="save" type="button" style="margin-top:14px">保存设置</button>
      `;
    }

    UI.openSheet({
      title: '自动扣费提醒',
      content: bodyHtml(),
      onMount(body, close) {
        function mount() {
          const tg = body.querySelector('[data-subs-toggle]');
          if (tg) tg.addEventListener('click', (e) => { e.stopPropagation(); enabled = !enabled; tg.classList.toggle('on', enabled); });
          body.querySelectorAll('[data-days]').forEach((b) => {
            b.addEventListener('click', () => {
              days = Number(b.dataset.days);
              body.querySelectorAll('[data-days]').forEach((x) => x.classList.toggle('on', Number(x.dataset.days) === days));
            });
          });
          body.querySelectorAll('[data-sub-rule]').forEach((b) => {
            b.addEventListener('click', () => {
              const key = b.dataset.subRule;
              let subs = [];
              try { subs = S.scanSubscriptions(); } catch (e) { subs = []; }
              const s = subs.find((x) => x.key === key);
              if (!s) return;
              try {
                S.subToRepeat(s);
                S.ignoreSub(key, true);
                U.toast('已转成周期记账规则', 'success');
                rerender();
              } catch (err) { U.toast(err.message || '转换失败', 'error'); }
            });
          });
          body.querySelectorAll('[data-sub-ignore]').forEach((b) => {
            b.addEventListener('click', () => {
              S.ignoreSub(b.dataset.subIgnore, true);
              U.toast('已标记，不再提醒');
              rerender();
            });
          });
          const sv = body.querySelector('[data-act="save"]');
          if (sv) {
            sv.addEventListener('click', () => {
              S.setSettings({ subAlert: { enabled, daysBefore: days } });
              close();
              render($('#view-settings'));
              U.toast('订阅提醒已保存', 'success');
              if (global.App) App.refreshTopbar();
            });
          }
        }
        function rerender() {
          const top = body.scrollTop;
          body.innerHTML = bodyHtml();
          mount();
          body.scrollTop = top;
        }
        mount();
      },
    });
  }

  // ------------------------------------------------------------
  // 垫付待收
  // ------------------------------------------------------------
  function openAdvancesSheet() {
    const cfg = S.settings.advance || {};
    let remindDays = Number(cfg.remindDays) || 0;

    function bodyHtml() {
      let all = [];
      try { all = S.advances(false); } catch (e) { all = []; }
      const open = all.filter((t) => t.advance.status === 'open');
      const settled = all.filter((t) => t.advance.status === 'settled');
      const total = open.reduce((s, t) => s + t.amount, 0);
      return `
        <div class="card" style="background:var(--card-2);border-style:dashed;margin-bottom:14px">
          <div class="small" style="line-height:1.75;color:var(--text-2)">
            帮别人垫的钱先挂账，<b>未收回的不计入支出和预算</b>；收回后才算真花掉。
            记账时在「这笔是帮别人垫的」里填上是谁，就能在这里跟踪。
          </div>
        </div>
        ${open.length ? `
          <div class="adv-sheet-total">
            <span class="adv-sheet-total-label">待收回</span>
            <span class="adv-sheet-total-amt">${U.money(total)}</span>
            <span class="adv-sheet-total-sub">${open.length} 笔</span>
          </div>
          <div class="subs-list">
            ${open.map((t) => {
              const who = t.advance.who || '别人';
              const left = t.advance.dueTs ? Math.round((U.startOfDay(new Date(t.advance.dueTs)).getTime() - U.startOfDay(new Date()).getTime()) / 86400000) : null;
              const dueTxt = left == null ? '没设催款日' : left < 0 ? `超期 ${-left} 天` : left === 0 ? '今天到期' : `${left} 天后到期`;
              return `<div class="subs-row ${left != null && left < 0 ? 'overdue' : ''}">
                <span class="subs-row-ic">💸</span>
                <span class="subs-row-main">
                  <span class="subs-row-name">${U.escapeHtml(who)} · ${U.money(t.amount)}</span>
                  <span class="subs-row-meta">${U.fullDate(t.ts)}${t.note ? ' · ' + U.escapeHtml(t.note) : ''}</span>
                  <span class="subs-row-next">${U.escapeHtml(dueTxt)}</span>
                </span>
                <span class="subs-row-ops">
                  <button class="btn btn--sm btn--primary" data-adv-settle="${t.id}" type="button">已收回</button>
                  <button class="btn btn--sm btn--ghost" data-adv-due="${t.id}" type="button">改催款日</button>
                </span>
              </div>`;
            }).join('')}
          </div>
        ` : `<div class="empty" style="padding:20px 0 24px">
          <div class="empty-emoji">💸</div>
          <div class="empty-title">没有待收回的垫付</div>
          <div class="empty-desc">记账时点「这笔是帮别人垫的」，就能在这里跟踪催款</div>
        </div>`}
        <div class="set-group-title">催款提醒</div>
        <div class="set-card">
          <div style="padding:14px 15px">
            <div class="small muted" style="margin-bottom:8px">提前几天提醒你催一下</div>
            <div class="ratio-grid">
              ${[0, 1, 3, 7].map((d) => `
                <button class="ratio-item ${remindDays === d ? 'on' : ''}" data-advdays="${d}" type="button">${d === 0 ? '当天' : d + ' 天前'}</button>
              `).join('')}
            </div>
          </div>
        </div>
        ${settled.length ? `
          <div class="set-group-title">已收回 ${settled.length} 笔</div>
          <div class="subs-list">
            ${settled.slice(0, 10).map((t) => `
              <div class="subs-row done">
                <span class="subs-row-ic">✅</span>
                <span class="subs-row-main">
                  <span class="subs-row-name">${U.escapeHtml(t.advance.who || '别人')} · ${U.money(t.advance.settledAmount || t.amount)}</span>
                  <span class="subs-row-meta">${U.fullDate(t.advance.settledTs || t.ts)} 收回</span>
                </span>
              </div>`).join('')}
          </div>` : ''}
        <button class="btn btn--primary" data-act="save" type="button" style="margin-top:14px">保存提醒设置</button>
      `;
    }

    UI.openSheet({
      title: '垫付待收',
      content: bodyHtml(),
      onMount(body, close) {
        function mount() {
          body.querySelectorAll('[data-advdays]').forEach((b) => {
            b.addEventListener('click', () => {
              remindDays = Number(b.dataset.advdays);
              body.querySelectorAll('[data-advdays]').forEach((x) => x.classList.toggle('on', Number(x.dataset.advdays) === remindDays));
            });
          });
          body.querySelectorAll('[data-adv-settle]').forEach((b) => {
            b.addEventListener('click', () => {
              // 归还 = 这笔不是你花的钱，记录留着（划掉），但不再算支出
              const back = S.settleAdvance(b.dataset.advSettle);
              U.toast(back ? '已归还：记录留着，但这笔不再计入支出' : '这笔已经不在了', back ? 'success' : 'info');
              rerender();
              if (global.App) App.refresh();
            });
          });
          body.querySelectorAll('[data-adv-due]').forEach((b) => {
            b.addEventListener('click', () => {
              const id = b.dataset.advDue;
              const t = S.txById(id);
              UI.datePicker({
                title: '催款日期',
                value: (t && t.advance && t.advance.dueTs) || Date.now(),
                onPick(ts) { S.setAdvance(id, { dueTs: ts }); rerender(); },
              });
            });
          });
          const sv = body.querySelector('[data-act="save"]');
          if (sv) {
            sv.addEventListener('click', () => {
              S.setSettings({ advance: { enabled: true, remindDays } });
              close();
              render($('#view-settings'));
              U.toast('催款提醒已保存', 'success');
              if (global.App) App.refreshTopbar();
            });
          }
        }
        function rerender() {
          const top = body.scrollTop;
          body.innerHTML = bodyHtml();
          mount();
          body.scrollTop = top;
        }
        mount();
      },
    });
  }

  // ------------------------------------------------------------
  // 想买清单
  // ------------------------------------------------------------
  function openWishSheet() {
    const cfg = S.settings.wish || {};
    let hours = Number(cfg.hours) || 48;
    let enabled = cfg.enabled !== false;

    function bodyHtml() {
      const list = S.wishlist ? S.wishlist() : [];
      const cooling = list.filter((w) => w.status === 'cooling');
      const ready = list.filter((w) => w.status === 'ready' || (w.status === 'cooling' && w.dueTs <= Date.now()));
      const done = list.filter((w) => w.status === 'dropped' || w.status === 'bought');
      const saved = S.savedFund ? S.savedFund() : 0;
      const now = Date.now();
      return `
        <div class="set-card" style="margin-bottom:14px">
          <div class="set-row" style="cursor:default">
            <span class="set-ic" style="background:rgba(165,108,255,.13)">🛍️</span>
            <span class="set-main"><span class="set-name">开启想买清单</span>
              <span class="set-desc">关掉后记账页不再显示「想买先放着」</span></span>
            <span class="set-val"><span class="switch ${enabled ? 'on' : ''}" data-wish-toggle></span></span>
          </div>
        </div>
        <div class="card" style="background:var(--card-2);border-style:dashed;margin-bottom:14px">
          <div class="small" style="line-height:1.75;color:var(--text-2)">
            想买的东西先记进清单，<b>冷静 ${hours} 小时</b>后再决定。
            想清楚了就买，不想要了就「算了」——放弃的金额会累积成<b>忍住基金</b>。
          </div>
        </div>
        ${saved ? `<div class="wish-saved">
          <span class="wish-saved-ic">🌱</span>
          <span class="wish-saved-main">
            <span class="wish-saved-label">忍住基金</span>
            <span class="wish-saved-amt">${U.money(saved)}</span>
          </span>
          <button class="btn btn--sm btn--primary" data-act="to-goal" type="button">存进目标</button>
        </div>` : ''}
        ${ready.length ? `
          <div class="set-group-title">冷静期到了 · ${ready.length} 件</div>
          <div class="subs-list">
            ${ready.map((w) => `
              <div class="subs-row ready wish">
                <span class="subs-row-ic">⏰</span>
                <span class="subs-row-main">
                  <span class="subs-row-name">${U.escapeHtml(w.name)}</span>
                  <span class="subs-row-meta">${U.money(w.amount)} · 记于 ${U.humanDate(w.createdAt)}</span>
                </span>
                <span class="subs-row-ops">
                  <button class="btn btn--sm btn--primary" data-wish-buy="${w.id}" type="button">还是买了</button>
                  <button class="btn btn--sm btn--ghost" data-wish-drop="${w.id}" type="button">算了</button>
                </span>
              </div>`).join('')}
          </div>` : ''}
        ${cooling.length ? `
          <div class="set-group-title">冷静中 · ${cooling.length} 件</div>
          <div class="subs-list">
            ${cooling.map((w) => {
              const leftMs = Math.max(0, w.dueTs - now);
              const leftTxt = leftMs >= 3600000
                ? `还有 ${Math.ceil(leftMs / 3600000)} 小时`
                : `还有 ${Math.max(1, Math.ceil(leftMs / 60000))} 分钟`;
              return `<div class="subs-row wish">
                <span class="subs-row-ic">🛍️</span>
                <span class="subs-row-main">
                  <span class="subs-row-name">${U.escapeHtml(w.name)}</span>
                  <span class="subs-row-meta">${U.money(w.amount)} · ${leftTxt}</span>
                </span>
                <span class="subs-row-ops">
                  <button class="btn btn--sm btn--ghost" data-wish-drop="${w.id}" type="button">不想要了</button>
                </span>
              </div>`;
            }).join('')}
          </div>` : ''}
        ${!ready.length && !cooling.length ? `<div class="empty" style="padding:20px 0 24px">
          <div class="empty-emoji">🛍️</div>
          <div class="empty-title">清单是空的</div>
          <div class="empty-desc">记账页输入金额后点「想买？先放进清单」就能加进来</div>
        </div>` : ''}
        ${done.length ? `
          <div class="set-group-title">已处理 ${done.length} 件</div>
          <div class="subs-list">
            ${done.slice(0, 8).map((w) => `
              <div class="subs-row done">
                <span class="subs-row-ic">${w.status === 'bought' ? '💳' : '🌱'}</span>
                <span class="subs-row-main">
                  <span class="subs-row-name">${U.escapeHtml(w.name)}</span>
                  <span class="subs-row-meta">${U.money(w.amount)} · ${w.status === 'bought' ? '已买' : '省下了'}</span>
                </span>
              </div>`).join('')}
          </div>` : ''}
        <div class="set-group-title">冷静期时长</div>
        <div class="ratio-grid">
          ${[24, 48, 72, 168].map((h) => `
            <button class="ratio-item ${hours === h ? 'on' : ''}" data-hours="${h}" type="button">${h >= 168 ? '一周' : h + ' 小时'}</button>
          `).join('')}
        </div>
        <button class="btn btn--primary" data-act="save" type="button" style="margin-top:14px">保存</button>
      `;
    }

    UI.openSheet({
      title: '想买清单',
      content: bodyHtml(),
      onMount(body, close) {
        function mount() {
          body.querySelectorAll('[data-hours]').forEach((b) => {
            b.addEventListener('click', () => {
              hours = Number(b.dataset.hours);
              body.querySelectorAll('[data-hours]').forEach((x) => x.classList.toggle('on', Number(x.dataset.hours) === hours));
            });
          });
          body.querySelectorAll('[data-wish-buy]').forEach((b) => {
            b.addEventListener('click', () => {
              S.buyWish(b.dataset.wishBuy);
              U.toast('已记成一笔支出', 'success');
              rerender();
              if (global.App) App.refresh();
            });
          });
          body.querySelectorAll('[data-wish-drop]').forEach((b) => {
            b.addEventListener('click', () => {
              S.dropWish(b.dataset.wishDrop);
              U.toast('省下了，已累积到「忍住基金」', 'success');
              rerender();
            });
          });
          const toGoal = body.querySelector('[data-act="to-goal"]');
          if (toGoal) {
            toGoal.addEventListener('click', () => {
              close();
              App.go('goals');
              U.toast('挑一个目标，把忍住基金存进去', 'info');
            });
          }
          const tg = body.querySelector('[data-wish-toggle]');
          if (tg) {
            tg.addEventListener('click', (e) => {
              e.stopPropagation();
              enabled = !enabled;
              tg.classList.toggle('on', enabled);
            });
          }
          const sv = body.querySelector('[data-act="save"]');
          if (sv) {
            sv.addEventListener('click', () => {
              S.setSettings({ wish: { enabled, hours } });
              close();
              render($('#view-settings'));
              U.toast('想买清单已保存', 'success');
            });
          }
        }
        function rerender() {
          const top = body.scrollTop;
          body.innerHTML = bodyHtml();
          mount();
          body.scrollTop = top;
        }
        mount();
      },
    });
  }

  // ------------------------------------------------------------
  // 余额反推对账
  // ------------------------------------------------------------
  function openReconSheet() {
    const accounts = S.state.accounts;
    let accountId = accounts[0] ? accounts[0].id : 'alipay';

    function bodyHtml() {
      let last = null;
      try { last = (S.reconList() || [])[0] || null; } catch (e) { last = null; }
      return `
        <div class="card" style="background:var(--card-2);border-style:dashed;margin-bottom:14px">
          <div class="small" style="line-height:1.75;color:var(--text-2)">
            记账最容易出错的地方不是算错，是<b>漏记</b>。<br/>
            填一个期初余额和现在的真实余额，就能算出<b>该有多少 / 实际多少 / 差多少</b>。
            全程本地算术，只对比一个账户，不会因为现金、余额宝收益这些把你绕晕。
          </div>
        </div>
        <div class="set-group-title">选择账户</div>
        <div class="ratio-grid">
          ${accounts.map((a) => `
            <button class="ratio-item ${a.id === accountId ? 'on' : ''}" data-acc="${a.id}" type="button">${a.icon} ${U.escapeHtml(a.name)}</button>
          `).join('')}
        </div>
        <div class="field">
          <label class="field-label">期初余额（元）</label>
          <input class="field-input" id="rc-start" type="text" inputmode="decimal" enterkeyhint="done" placeholder="例如 3000" />
        </div>
        <div class="field">
          <label class="field-label">期初日期</label>
          <button class="field-input recon-date" id="rc-date" type="button">${U.fullDate(Date.now() - 30 * 86400000)}</button>
        </div>
        <div class="field">
          <label class="field-label">现在这个账户真实有多少钱（元）</label>
          <input class="field-input" id="rc-now" type="text" inputmode="decimal" enterkeyhint="done" placeholder="例如 2150" />
        </div>
        <div id="rc-result"></div>
        <button class="btn btn--primary" data-act="calc" type="button">算一下</button>
        ${last ? `
          <div class="set-group-title" style="margin-top:18px">上次对账</div>
          <div class="recon-last ${last.diff === 0 ? 'ok' : ''}">
            <span class="recon-last-ic">${last.diff === 0 ? '✅' : last.diff > 0 ? '🔍' : '❓'}</span>
            <span class="recon-last-main">
              <span class="recon-last-title">${last.diff === 0 ? '完全对上，账本很干净' : last.diff > 0 ? `少了 ${U.money(last.diff)}，可能漏记了支出` : `多了 ${U.money(-last.diff)}，可能漏记了收入`}</span>
              <span class="recon-last-sub">账面应有 ${U.money(last.expected)} · 实际 ${U.money(last.actualBalance)} · ${U.fullDate(last.ts)}</span>
            </span>
          </div>` : ''}
      `;
    }

    UI.openSheet({
      title: '余额反推对账',
      content: bodyHtml(),
      onMount(body, close) {
        let startTs = Date.now() - 30 * 86400000;
        const dateBtn = body.querySelector('#rc-date');
        dateBtn.addEventListener('click', () => {
          UI.datePicker({
            title: '期初日期',
            value: startTs,
            onPick(ts) { startTs = ts; dateBtn.textContent = U.fullDate(ts); },
          });
        });
        body.querySelectorAll('[data-acc]').forEach((b) => {
          b.addEventListener('click', () => {
            accountId = b.dataset.acc;
            body.querySelectorAll('[data-acc]').forEach((x) => x.classList.toggle('on', x.dataset.acc === accountId));
          });
        });
        body.querySelector('[data-act="calc"]').addEventListener('click', () => {
          const start = U.amountToCents(body.querySelector('#rc-start').value);
          const now = U.amountToCents(body.querySelector('#rc-now').value);
          if (!start && !now) { U.toast('填一下期初和现在的余额', 'error'); return; }
          const rec = S.reconcile({ accountId, startBalance: start, startTs, actualBalance: now });
          const blank = S.blankDays(14);
          const slot = body.querySelector('#rc-result');
          const diff = rec.diff;
          let hint = '';
          if (diff === 0) hint = '完全对上，账本很干净 🎉';
          else if (diff > 0) hint = `实际比账面多 <b>${U.money(diff)}</b>，大概率<b>漏记了支出</b>`;
          else hint = `实际比账面少 <b>${U.money(-diff)}</b>，可能<b>漏记了收入</b>，或者多记了支出`;
          slot.innerHTML = `
            <div class="recon-result ${diff === 0 ? 'ok' : ''}">
              <div class="recon-row"><span>期初</span><b>${U.money(rec.startBalance)}</b></div>
              <div class="recon-row"><span>+ 这段时间的收入</span><b class="text-income">${U.money(rec.income)}</b></div>
              <div class="recon-row"><span>− 这段时间的支出</span><b>${U.money(rec.expense)}</b></div>
              <div class="recon-row recon-row--total"><span>账面应有</span><b>${U.money(rec.expected)}</b></div>
              <div class="recon-row"><span>你说的实际余额</span><b>${U.money(rec.actualBalance)}</b></div>
              <div class="recon-hint ${diff === 0 ? 'ok' : 'warn'}">${hint}</div>
              ${blank.length ? `<div class="recon-blank">
                <div class="recon-blank-title">近 14 天里这 ${blank.length} 天没有账目，可能是漏记的位置：</div>
                <div class="recon-blank-days">
                  ${blank.slice(0, 6).map((d) => `<span class="recon-day">${U.escapeHtml(d.label)}</span>`).join('')}
                </div>
              </div>` : ''}
            </div>`;
          U.toast('已记录这次对账', 'success');
          render($('#view-settings'));
        });
      },
    });
  }

  function openNicknameSheet() {
    UI.openSheet({
      title: '账本昵称',
      content: `
        <div class="field">
          <input class="field-input" id="n-input" type="text" maxlength="12" placeholder="例如：小明的账本" value="${U.escapeHtml(S.settings.nickname || '')}" />
        </div>
        <button class="btn btn--primary" data-act="save" type="button">保存</button>
      `,
      onMount(body, close) {
        body.querySelector('[data-act="save"]').addEventListener('click', () => {
          S.setSettings({ nickname: body.querySelector('#n-input').value.trim() });
          close(); App.refresh(); U.toast('已保存', 'success');
        });
      },
    });
  }

  // ------------------------------------------------------------
  // 数据操作
  // ------------------------------------------------------------
  function doBackup() {
    App.download('花哪儿了备份-' + U.ymd(new Date()) + '.json', S.exportJSON(), 'application/json');
    U.toast('备份已导出', 'success');
  }

  function doRestore() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          const ok = await UI.confirm({
            title: '导入备份',
            desc: '选择导入方式：<br/><b>合并</b>会保留现有数据，只追加新记录；<br/><b>覆盖</b>会清空当前数据。',
            okText: '合并导入', cancelText: '覆盖导入',
          });
          const res = S.importJSON(String(reader.result), ok ? 'merge' : 'replace');
          App.refresh();
          U.toast(`导入成功，共 ${res.tx} 笔账目`, 'success');
        } catch (e) {
          U.toast(e.message || '导入失败', 'error');
        }
      };
      reader.readAsText(f);
    });
    input.click();
  }

  async function doClear() {
    const ok = await UI.confirm({
      title: '清空所有数据？',
      desc: '全部账目、目标、设置都会被删除，且无法恢复。<br/>建议先导出备份。',
      danger: true, okText: '全部清空',
    });
    if (!ok) return;
    S.clearAll(false);
    App.refresh();
    U.toast('已清空', 'success');
  }

  /**
   * 赞助作者。
   *
   * 页面只陈述事实，不摆占位、不写「敬请期待」、不弹「喜欢就打赏」。
   * 口径必须跟真实情况一致（用户 m03611 指出过旧文案不符实际）：
   *   - 个人账本：永远只在本机，不上传；
   *   - 情侣账本：要做双人同步，之后会同步到作者自己的 Cloudflare，
   *     只传这一本账，其他账本 / 目标 / 设置一律不碰；
   *   - 同步还没上线，所以「现在」仍是全部只在本机。
   * 只写「只传这一本」，不写「端到端加密」之类的未来承诺 —— 没做出来的不写进协议。
   */
  const AUTHOR = {
    // 填了才会出现对应那一行；留空就当没有。
    // 微信 / 支付宝：填的是「收款码图片」地址（放 assets/img/ 下），不是账号。
    wechatQR: 'assets/img/wechat-pay.png',
    alipayQR: '',
    // 爱发电 / BuyMeACoffee 这类页面，填完整网址
    page: '',
    // 一句自己想说的话，会显示在最上面。留空就用下面那句默认的。
    words: '',
  };

  function openSponsorSheet() {
    const has = (s) => typeof s === 'string' && s.trim() !== '';
    const anyWay = has(AUTHOR.wechatQR) || has(AUTHOR.alipayQR) || has(AUTHOR.page);

    const rows = [];
    if (has(AUTHOR.wechatQR)) {
      rows.push(`<div class="sp-qr"><img src="${AUTHOR.wechatQR}" alt="微信收款码" /><span>微信</span></div>`);
    }
    if (has(AUTHOR.alipayQR)) {
      rows.push(`<div class="sp-qr"><img src="${AUTHOR.alipayQR}" alt="支付宝收款码" /><span>支付宝</span></div>`);
    }
    if (has(AUTHOR.page)) {
      rows.push(`<a class="btn btn--primary sp-page" href="${AUTHOR.page}" target="_blank" rel="noopener">去爱发电支持</a>`);
    }

    UI.openSheet({
      title: '赞助作者',
      content: `
        <div class="sp">
          <div class="sp-heart">${Icons.svg('heart', 30)}</div>
          <div class="sp-title">这个 App 不收钱</div>
          <div class="sp-body">
            ${has(AUTHOR.words) ? U.escapeHtml(AUTHOR.words)
              : '没有广告，没有会员，没有「解锁高级功能」。<b>个人账本永远只在这台手机上</b>；情侣账本会同步到作者自己的 Cloudflare 服务器 —— 只传这一本账，不碰你的其他账本、攒钱目标和设置。'}
          </div>

          <div class="sp-facts">
            <div class="sp-fact"><b>0 元</b><span>没有内购</span></div>
            <div class="sp-fact"><b>0 条</b><span>没有广告</span></div>
            <div class="sp-fact"><b>1 本</b><span>只有情侣账上云</span></div>
          </div>

          ${anyWay ? `
            <div class="sp-sub">如果它确实帮到了你</div>
            <div class="sp-ways">${rows.join('')}</div>
            <div class="sp-note">微信扫一扫，金额随意；手机上也可长按图片保存，再用「扫一扫 → 相册」识别。</div>
          ` : `
            <div class="sp-open">
              <div class="sp-open-title">还没有开放赞助</div>
              <div class="sp-open-body">作者暂时没有开收款通道。你能免费用它，就是最好的支持。</div>
            </div>
          `}

          <div class="sp-foot">如果喜欢，请把他推荐给你的朋友吧</div>
        </div>`,
    });
  }

  function refresh() {
    const root = $('#view-settings');
    if (root) render(root);
  }

  global.ViewSettings = {
    render, refresh,
    openBudgetSheet, openCycleSheet, openAlertSheet, openTipSheet,
    openAiSheet, openScanSheet,
    openBooksSheet, openBookEdit, openCatsSheet,
    openCurrencySheet, openAutoSaveSheet, openSubsSheet, openAdvancesSheet,
    openWishSheet, openReconSheet,
  };
})(window);
