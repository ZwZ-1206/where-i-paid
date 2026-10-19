/* ============================================================
 * 花哪儿了 · 应用主控
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;
  const $ = U.$;
  const $$ = U.$$;

  const VIEWS = {
    add: { title: '记一笔', sub: '', render: () => ViewAdd.render($('#view-add')), topbar: 'add' },
    detail: { title: '明细', sub: '', render: () => ViewDetail.render($('#view-detail')), topbar: 'detail' },
    report: { title: '月度总结', sub: '', render: () => ViewReport.render($('#view-report')), topbar: 'report' },
    goals: { title: '攒钱目标', sub: '', render: () => ViewGoals.render($('#view-goals')), topbar: 'goals' },
    settings: { title: '设置', sub: '', render: () => ViewSettings.render($('#view-settings')), topbar: 'settings' },
    couple: {
      title: '情侣账本', sub: '',
      render: () => global.ViewCouple.render($('#view-couple')),
      topbar: 'couple',
    },
  };

  let current = 'add';
  const history = [];

  // ------------------------------------------------------------
  // 主题
  // ------------------------------------------------------------
  function resolveTheme() {
    const t = S.settings.theme || 'auto';
    if (t === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return t;
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', resolveTheme());
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolveTheme() === 'dark' ? '#0C0F15' : '#F4F6FB');
  }

  // ------------------------------------------------------------
  // 顶栏
  // ------------------------------------------------------------
  function renderTopbar() {
    const bar = $('#topbar');
    const cfg = VIEWS[current];
    // 页面专属动作（最右边一格）
    // 明细 / 总结 已经是底栏 Tab，不再在顶栏重复放「查看明细」入口
    let right = '';
    if (current === 'detail') {
      right = `<button class="tb-btn tb-btn--brand" data-top="go-add" type="button" aria-label="记一笔">${Icons.svg('plus', 19)}</button>`;
    } else if (current === 'goals') {
      right = `<button class="tb-btn tb-btn--brand" data-top="new-goal" type="button" aria-label="新建目标">${Icons.svg('plus', 19)}</button>`;
    }

    let left = '';
    if (current === 'add' && ViewAdd.draft.editingId) {
      left = `<button class="tb-btn tb-btn--ghost" data-top="cancel-edit" type="button" aria-label="取消">${Icons.svg('close', 19)}</button>`;
    }

    // 提醒铃铛（有待办才显示红点）
    let bellCount = 0;
    try { bellCount = global.Remind ? global.Remind.list().length : 0; } catch (e) { bellCount = 0; }
    const bell = `<button class="tb-btn tb-btn--ghost tb-bell" data-top="remind" type="button" aria-label="提醒中心">
      ${Icons.svg('bell', 19)}${bellCount ? `<i class="tb-dot">${bellCount > 9 ? '9+' : bellCount}</i>` : ''}
    </button>`;

    const titles = {
      add: ViewAdd.draft.editingId ? '编辑账目' : '记一笔',
      detail: '明细',
      report: '总结',
      goals: '攒钱目标',
      settings: '设置',
    };

    // 情侣页分两个页面：主页 / 情侣账单
    const onCoupleBill = () => {
      try { return global.ViewCouple && global.ViewCouple.page === 'bill'; } catch (e) { return false; }
    };
    if (current === 'couple') titles.couple = onCoupleBill() ? '情侣账单' : '情侣';

    // 明细页标题要跟着周期导航走，否则翻到历史月份标题还显示本月
    const detailPeriod = () => {
      const off = (global.ViewDetail && global.ViewDetail.state && global.ViewDetail.state.offset) || 0;
      const cur = S.currentPeriod();
      return off === 0 ? cur : S.shiftPeriod(cur, off);
    };

    // 情侣页副标题：主页显示在一起第 N 天，账单页显示月份
    const coupleSub = () => {
      try {
        if (!global.ViewCouple) return '';
        if (onCoupleBill()) {
          const p = global.ViewCouple.billPeriod ? global.ViewCouple.billPeriod() : null;
          return p ? p.label : '';
        }
        if (global.ViewCouple.subtitle) return global.ViewCouple.subtitle();
      } catch (e) { /* 忽略 */ }
      return '';
    };

    // 总结页副标题跟着日/月/年选项卡走
    const reportSub = () => {
      const st = (global.ViewReport && global.ViewReport.state) || { scope: 'month' };
      const p = S.scopePeriod(st.scope, new Date(st.anchor || Date.now()));
      return p.label;
    };

    bar.className = 'topbar is-blur';
    // 全局齿轮：每一页都有，位置固定在铃铛右边、页面专属动作左边
    // 设置不再占底栏一格（方案 D″），所以它必须到处可达，否则从任何页面进设置都要两步
    const gear = `<button class="tb-btn tb-btn--ghost tb-gear" data-top="go-settings" type="button" aria-label="设置">${Icons.svg('settings', 19)}</button>`;

    bar.innerHTML = `
      ${left}
      <div class="tb-title">${titles[current] || cfg.title}
        ${current === 'detail' ? `<small>${U.escapeHtml(detailPeriod().label)}</small>` : ''}
        ${current === 'report' ? `<small>${U.escapeHtml(reportSub())}</small>` : ''}
        ${current === 'goals' ? `<small>${S.state.goals.filter((g) => !g.archived).length} 个进行中</small>` : ''}
        ${current === 'couple' ? `<small>${U.escapeHtml(coupleSub())}</small>` : ''}
      </div>
      ${bell}
      ${gear}
      ${right}
    `;

    bar.querySelectorAll('[data-top]').forEach((b) => {
      b.addEventListener('click', () => {
        const a = b.dataset.top;
        if (a === 'go-add') go('add');
        else if (a === 'go-settings') go('settings');
        else if (a === 'new-goal') ViewGoals.openEditor(null);
        else if (a === 'remind') { if (global.Remind) global.Remind.open(); }
        else if (a === 'cancel-edit') { ViewAdd.reset(); go('detail'); }
      });
    });
  }

  /** 情侣格：m02510 定稿 —— 图标永远和其他底栏一致（线条轮廓心），不上色。
   *  启用/收起只影响整格淡化（is-on / is-hidden），不再换实心心。 */
  function paintCoupleTab() {
    const tab = document.querySelector('.tab--couple');
    if (!tab) return;
    const ic = tab.querySelector('.tab-ic');
    if (!ic) return;
    let enabled = false;
    let hidden = false;
    try {
      enabled = !!(global.ViewCouple && global.ViewCouple.on && global.ViewCouple.on());
      hidden = !!(global.ViewCouple && global.ViewCouple.hidden && global.ViewCouple.hidden());
    } catch (e) { enabled = false; }
    // 收起不等于关闭：数据都还在，只是想从首页退到后面，所以心还是实心的（is-on 留着），
    // 只把这一格淡化。判断只能看 hidden —— 收起时 on() 依然是 true，
    // 写成 hidden && !enabled 的话收起态永远画不出来。
    tab.classList.toggle('is-on', enabled);
    tab.classList.toggle('is-hidden', hidden);
    ic.innerHTML = Icons.svg('heart', 22);
  }

  // ------------------------------------------------------------
  // 路由
  // ------------------------------------------------------------
  function go(name, opts) {
    if (!VIEWS[name]) return;
    const isBack = opts && opts.back;
    if (name !== current) {
      history.push(current);
      if (history.length > 20) history.shift();
    }
    current = name;

    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
    // 底栏高亮：settings 已经不在底栏里了，所以它不会点亮任何一格
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    paintCoupleTab();

    VIEWS[name].render();
    renderTopbar();

    const view = $('#view-' + name);
    if (view && !isBack) view.scrollTop = 0;

    try {
      if (location.hash !== '#' + name) {
        history.replaceState
          ? window.history.replaceState({ view: name }, '', '#' + name)
          : (location.hash = name);
      }
    } catch (e) { /* file:// 下可能受限，忽略 */ }

    // 切换后关闭残留弹层
    UI.closeAllSheets();
  }

  function refresh() {
    VIEWS[current].render();
    renderTopbar();
  }

  // ------------------------------------------------------------
  // 下载
  // ------------------------------------------------------------
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1200);
  }

  // ------------------------------------------------------------
  // 启动
  // ------------------------------------------------------------
  function boot() {
    S.init();

    // 双人同步：已配对就开前台轮询，并在回到前台/联网时补一次。
    // 全程 try/catch —— 同步挂了不能影响记账，这是这套东西的底线。
    try {
      const CS = global.CoupleSync;
      if (CS && typeof CS.ready === 'function' && CS.ready()) {
        CS.startPolling();
        setTimeout(() => { CS.syncOnce().catch(() => {}); }, 1500);
        window.addEventListener('online', () => { CS.syncOnce().catch(() => {}); });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') CS.syncOnce().catch(() => {});
        });
      }
    } catch (e) { /* 同步坏了不能影响启动 */ }

    // 首次运行保持空白：数据由用户自己记 / 导入，不塞示例账目

    applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((S.settings.theme || 'auto') === 'auto') applyTheme();
    });

    // 周期性自动记账：每次启动补记到期规则（幂等，同一期只生成一笔）
    try {
      const added = S.runRepeats();
      if (added && added.length) {
        setTimeout(() => {
          U.toast(`已自动记下 ${added.length} 笔周期账目`, 'success');
        }, 900);
      }
    } catch (e) { /* 规则异常不影响启动 */ }

    // 余钱归仓：结算已结束周期的结余，存进攒钱目标（幂等）
    try {
      const moved = S.settlePeriods();
      if (moved && moved.length) {
        const total = moved.reduce((s, x) => s + x.amount, 0);
        setTimeout(() => {
          U.toast(`上期结余 ${U.money(total)} 已自动存进攒钱目标`, 'success');
        }, 1600);
      }
    } catch (e) { /* 归仓异常不影响启动 */ }

    // 底部导航
    $$('.tab').forEach((t) => {
      t.addEventListener('click', () => {
        U.vibrate(6);
        if (t.dataset.tab === 'add' && current === 'add') {
          ViewAdd.reset();
          refresh();
          return;
        }
        go(t.dataset.tab);
      });
    });

    // 图标注入
    $$('[data-ic]').forEach((n) => {
      n.innerHTML = Icons.svg(n.dataset.ic, 21);
    });

    // 初始视图
    const hash = (location.hash || '').replace('#', '');
    current = VIEWS[hash] ? hash : 'add';

    paintCoupleTab();

    $('#app').hidden = false;
    go(current);

    // 隐藏闪屏
    setTimeout(() => {
      const sp = $('#splash');
      if (sp) {
        sp.classList.add('out');
        setTimeout(() => sp.remove(), 500);
      }
    }, 260);

    // 提醒中心：订阅快续费 / 垫付到期 / 想买冷静期到了
    setTimeout(() => {
      try { if (global.Remind) global.Remind.showBanner(); } catch (e) { /* 忽略 */ }
    }, 2400);

    // 返回键
    window.addEventListener('popstate', () => {
      const h = (location.hash || '').replace('#', '');
      if (VIEWS[h] && h !== current) {
        current = h;
        $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === h));
        $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === h));
        VIEWS[h].render();
        renderTopbar();
      }
    });

    // 数据变更时刷新当前视图的统计（写入已由各视图自行处理）
    S.subscribe((evt) => {
      if (evt.type === 'settings') { applyTheme(); paintCoupleTab(); }
    });

    // Service Worker
    // 注意：注册时加 updateViaCache:'none'，否则浏览器可能用 HTTP 缓存里的旧 sw.js，
    // 导致改了代码要清缓存才能生效。
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
          // 每次启动主动查一次更新
          reg.update().catch(() => {});
          // 有新版本就绪时提示用户（不强制打断）
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                U.toast('新版本已就绪，刷新即可使用', 'info');
              }
            });
          });
        }).catch(() => { /* 忽略 */ });
        // 启动后悄悄核对一次版本（失败就静默）
        setTimeout(() => { autoCheckUpdate(); }, 3500);
        checkTempOrigin();
      });
    }
  }

  // ------------------------------------------------------------
  // 版本与更新
  // 思路：sw.js 里的 CACHE 名就是版本号，既能离线读，也能联网比。
  // ------------------------------------------------------------
  /** 当前实际在用的版本（读本地缓存名，离线也能读到） */
  async function currentVersion() {
    try {
      const keys = await caches.keys();
      const mine = keys.filter((k) => k.indexOf('jizhang-') === 0);
      if (mine.length) return mine[0].replace('jizhang-', '');
    } catch (e) { /* 忽略 */ }
    return '';
  }

  /** 服务器上最新的版本（拉一次 sw.js 读 CACHE） */
  async function remoteVersion() {
    const res = await fetch('sw.js?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const txt = await res.text();
    const m = /CACHE\s*=\s*['"]([^'"]+)['"]/.exec(txt);
    if (!m) throw new Error('读不到版本号');
    return m[1].replace('jizhang-', '');
  }

  /**
   * 检查更新
   * @returns {Promise<{ok, local?, remote?, hasUpdate?, offline?, reason?}>}
   */
  async function checkUpdate() {
    if (!('serviceWorker' in navigator)) return { ok: false, reason: 'unsupported' };
    let local = '';
    try { local = await currentVersion(); } catch (e) { local = ''; }
    let remote = '';
    try {
      remote = await remoteVersion();
    } catch (e) {
      return { ok: false, reason: 'offline', local, message: e.message };
    }
    const hasUpdate = !!remote && remote !== local;
    if (hasUpdate) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      } catch (e) { /* 拉取失败也照样能把版本号告诉用户 */ }
    }
    return { ok: true, local, remote, hasUpdate };
  }

  /** 真的更新：让新 SW 接管，然后刷新页面 */
  async function applyUpdate() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.waiting) reg.waiting.postMessage('skipWaiting');
    } catch (e) { /* 忽略 */ }
    // 等新 controller 接管（最多 1.5 秒），然后硬刷新
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
      setTimeout(finish, 1500);
    });
    location.reload();
  }

  // ------------------------------------------------------------
  // 启动时自动核对版本
  // ------------------------------------------------------------
  /** 底部一条「有新版本」提示，点一下就能更新 */
  function showUpdateBar(remote, local) {
    const host = $('#toast-host') || (() => {
      const h = U.el('div', { id: 'toast-host', class: 'toast-host' });
      document.body.appendChild(h);
      return h;
    })();
    const old = host.querySelector('.update-bar');
    if (old) return;
    const bar = U.el('div', { class: 'update-bar' });
    bar.innerHTML =
      '<span class="ub-ic">⬆️</span>' +
      '<span class="ub-txt">发现新版本 <b>' + U.escapeHtml(remote) + '</b>' +
      (local ? '<span class="ub-from">当前 ' + U.escapeHtml(local) + '</span>' : '') + '</span>' +
      '<button class="ub-go" type="button">更新</button>' +
      '<button class="ub-later" type="button">以后</button>';
    host.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('in'));

    const close = () => {
      bar.classList.remove('in');
      setTimeout(() => { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 260);
    };
    bar.querySelector('.ub-go').addEventListener('click', () => {
      close();
      U.toast('正在更新…', 'info');
      applyUpdate();
    });
    bar.querySelector('.ub-later').addEventListener('click', close);
    // 30 秒后自己收起来，别一直挡着
    setTimeout(() => { if (bar.parentNode) close(); }, 30000);
  }

  // ------------------------------------------------------------
  // 临时地址提醒
  // 用「手机安装.bat」装到手机上时，地址是 tunnelmole 的临时隧道，
  // 关掉电脑上那个窗口就失效了。那时再打开 App 只能靠缓存，
  // 拿不到更新、也导不出数据。所以一进来就提醒先备份。
  // ------------------------------------------------------------
  const TEMP_HOST = /\.(tunnelmole\.net|trycloudflare\.com|ngrok\.io|ngrok-free\.app|loca\.lt|serveo\.net)$/i;
  const TEMP_TIP_KEY = 'jizhang.tempOriginTip';

  function isTempOrigin() {
    try { return TEMP_HOST.test(location.hostname); } catch (e) { return false; }
  }

  function showTempOriginBar() {
    const host = $('#toast-host') || (() => {
      const h = U.el('div', { id: 'toast-host', class: 'toast-host' });
      document.body.appendChild(h);
      return h;
    })();
    if (host.querySelector('.temp-bar')) return;
    const bar = U.el('div', { class: 'update-bar temp-bar' });
    bar.innerHTML =
      '<span class="ub-ic">⏳</span>' +
      '<span class="ub-txt">这是<b>临时地址</b><span class="ub-from">关掉电脑上的窗口后，这个 App 就打不开了</span></span>' +
      '<button class="ub-go" type="button">先备份</button>' +
      '<button class="ub-later" type="button">知道了</button>';
    host.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('in'));
    const close = () => {
      bar.classList.remove('in');
      setTimeout(() => { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 260);
    };
    bar.querySelector('.ub-go').addEventListener('click', () => {
      close();
      go('settings');
      setTimeout(() => { U.toast('设置 → 数据 → 导出备份，存一份到手机里', 'info'); }, 500);
    });
    bar.querySelector('.ub-later').addEventListener('click', () => {
      try { localStorage.setItem(TEMP_TIP_KEY, '1'); } catch (e) { /* 忽略 */ }
      close();
    });
  }

  function checkTempOrigin() {
    if (!isTempOrigin()) return;
    let seen = '';
    try { seen = localStorage.getItem(TEMP_TIP_KEY) || ''; } catch (e) { seen = ''; }
    if (seen) return;
    setTimeout(showTempOriginBar, 1800);
  }

  /** 每次启动悄悄核对一次；断网、不支持都静默跳过 */
  async function autoCheckUpdate() {
    let r;
    try { r = await checkUpdate(); } catch (e) { return; }
    if (!r || !r.ok || !r.hasUpdate) return;
    showUpdateBar(r.remote, r.local);
  }

  global.App = {
    boot, go, refresh, download, applyTheme, refreshTopbar: renderTopbar,
    checkUpdate, applyUpdate, autoCheckUpdate, currentVersion, remoteVersion,
    isTempOrigin, checkTempOrigin, paintCoupleTab,
    get current() { return current; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
