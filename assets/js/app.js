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
      // 同步写进来的情侣数据：正看着情侣页就自动重画。
      // 没有这一步，对方记的账要手动刷新整个页面才出现（真机反馈「不刷新无法同步」）。
      // 只认 action === 'remote'：自己刚记的账，各入口已经在写完后自己刷过了。
      if (evt && evt.action === 'remote' && current === 'couple') {
        const vc = global.ViewCouple;
        if (vc && typeof vc.softRefresh === 'function') vc.softRefresh();
      }
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
  //
  // 两种运行环境，两套判据，不能混：
  //
  //   APK（页面跑在 appassets 虚拟域名里）：sw.js 和网页一起打在包里，
  //     "联网比版本"比的是包内自己，永远相等。所以 APK 必须去 GitHub
  //     Releases 问最新 tag；更新动作是让用户去下新 APK，不是刷新页面。
  //
  //   网页 / PWA：sw.js 来自服务器，本地版本只能从 SW 缓存读。
  //     **缓存读不到时绝不能判定有更新** —— 否则 remote 有值、local 为空，
  //     `remote !== local` 恒成立，就会一直提示"有新版本"，点更新也只是
  //     重载、缓存依旧空，形成死循环。
  // ------------------------------------------------------------

  /** 仓库地址：APK 用户的更新出口 */
  const GITHUB_RELEASES = 'https://github.com/ZwZ-1206/where-i-paid/releases/latest';
  /** 官网（同时也是 APK 的更新源）：GitHub API 在国内经常连不上，不能再当作唯一途径 */
  const SITE_BASE = 'https://where-i-paid.pages.dev';

  /** 是不是装在 APK 壳里 */
  function isApk() {
    try { return location.hostname === 'appassets.androidplatform.net'; } catch (e) { return false; }
  }

  /** 当前实际在用的版本（读本地缓存名，离线也能读到） */
  async function currentVersion() {
    try {
      const keys = await caches.keys();
      const mine = keys.filter((k) => k.indexOf('jizhang-') === 0);
      if (mine.length) return mine[0].replace('jizhang-', '');
    } catch (e) { /* 忽略 */ }
    return '';
  }

  /** 包内版本：APK 里 sw.js 就是打包时那份，直接读它，不依赖缓存 */
  async function bundledVersion() {
    try {
      const res = await fetch('sw.js', { cache: 'no-store' });
      if (!res.ok) return '';
      const m = /CACHE\s*=\s*['"]([^'"]+)['"]/.exec(await res.text());
      return m ? m[1].replace('jizhang-', '') : '';
    } catch (e) {
      return '';
    }
  }

  /** 服务器上最新的版本（拉一次 sw.js 读 CACHE） */
  async function remoteVersion() {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
    try {
      const res = await fetch('sw.js?t=' + Date.now(), { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      const m = /CACHE\s*=\s*['"]([^'"]+)['"]/.exec(txt);
      if (!m) throw new Error('读不到版本号');
      return m[1].replace('jizhang-', '');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 官网上的版本清单（APK 的第一更新源）。
   *
   * 为什么不用 GitHub API 当第一源：`api.github.com` 在国内网络下经常直接超时，
   * 用户明明 5G 满格，界面却报「连不上网」。
   * 官网是我们自己的域名，连通性更好；GitHub 只作为兜底。
   * 读的是 `/app/version.json`，由 build-dist.js 写入、build-site.js 补上 APK 文件名。
   *
   * @returns {Promise<{version:string, apk:string}>} apk 为空表示官网还没放安装包
   */
  async function siteManifest() {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
    try {
      const res = await fetch(SITE_BASE + '/app/version.json?t=' + Date.now(), {
        cache: 'no-store',
        signal: ctl ? ctl.signal : undefined,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const v = String(j.app || j.version || '').replace(/^v/i, '');
      if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('读不到版本号');
      // 只认文件名，防止服务端塞进来一个 javascript: 之类的怪 URL
      const apk = /^[A-Za-z0-9._-]+\.apk$/.test(String(j.apk || '')) ? String(j.apk) : '';
      return { version: v, apk };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 只要版本号（老调用点与测试用） */
  async function siteVersion() {
    return (await siteManifest()).version;
  }

  /** GitHub 上最新 Release 的 tag（APK 唯一的更新渠道） */
  async function githubVersion() {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
    try {
      const res = await fetch('https://api.github.com/repos/ZwZ-1206/where-i-paid/releases/latest', {
        cache: 'no-store',
        signal: ctl ? ctl.signal : undefined,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      return String(j.tag_name || '').replace(/^v/i, '');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 版本号拆成数字数组，'1.18.4' → [1,18,4] */
  function verParts(v) {
    return String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  }

  /** a 是否真的比 b 新（不是"不相等"，是"更大"） */
  function isNewer(a, b) {
    const x = verParts(a);
    const y = verParts(b);
    const len = Math.max(x.length, y.length);
    for (let i = 0; i < len; i++) {
      const p = x[i] || 0;
      const q = y[i] || 0;
      if (p !== q) return p > q;
    }
    return false;
  }

  /**
   * 检查更新
   * @returns {Promise<{ok, local?, remote?, hasUpdate?, apk?, reason?}>}
   */
  async function checkUpdate() {
    // ---------- APK：包内版本 vs 官网（GitHub 兜底） ----------
    if (isApk()) {
      const local = await bundledVersion();
      let remote = '';
      let apkFile = '';
      try {
        const m = await siteManifest();
        remote = m.version;
        apkFile = m.apk;
      } catch (e) { /* 官网不通再试 GitHub */ }
      if (!remote) {
        try { remote = await githubVersion(); } catch (e) { remote = ''; }
      }
      // 两个源都拿不到：这是「服务器连不上」，不是「你没网」，文案必须分开
      if (!remote) return { ok: false, reason: 'network', local, apk: true };
      // 官网放了安装包就直接给自己域名，不再让用户翻 GitHub
      const apkUrl = apkFile ? SITE_BASE + '/download/' + apkFile : '';
      if (!local) return { ok: true, local, remote, hasUpdate: false, apk: true, apkUrl };
      return { ok: true, local, remote, hasUpdate: isNewer(remote, local), apk: true, apkUrl };
    }

    // ---------- 网页 / PWA ----------
    if (!('serviceWorker' in navigator)) return { ok: false, reason: 'unsupported' };
    const local = await currentVersion();
    // 缓存还没建立（首次启动 / SW 未激活）→ 无从比较，直接判定"无更新"。
    // 这一条是"永远提示有更新"的根因修复，别删。
    if (!local) return { ok: true, local: '', hasUpdate: false, reason: 'no-cache' };

    let remote = '';
    try {
      remote = await remoteVersion();
    } catch (e) {
      return { ok: false, reason: 'network', local, message: e.message };
    }
    const hasUpdate = !!remote && isNewer(remote, local);
    if (hasUpdate) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      } catch (e) { /* 拉取失败也照样能把版本号告诉用户 */ }
    }
    return { ok: true, local, remote, hasUpdate };
  }

  /**
   * 下载新版 APK。
   *
   * APK 壳里注入了原生桥 `JZApp`（见 MainActivity.UpdateBridge）：有它就用系统下载器
   * 在 App 内下载，完成后通知栏点一下安装；没有桥（网页版 / 还没更新过的老 APK）
   * 就退回浏览器，行为和以前一样。
   *
   * 只有 `.apk` 才走桥：GitHub Releases 那种页面链接仍交给浏览器。
   */
  function openApkDownload(url) {
    const target = String(url || '');
    const isApk = /\.apk(?:\?|$)/i.test(target);
    try {
      if (isApk && global.JZApp && typeof global.JZApp.downloadApk === 'function') {
        global.JZApp.downloadApk(target);
        return true;
      }
    } catch (e) { /* 桥异常就退回浏览器，不能让按钮点了没反应 */ }
    location.href = target;
    return false;
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
  /** 底部一条「有新版本」提示；APK 去下载新包（官网优先），网页是一键刷新 */
  function showUpdateBar(remote, local, apk, apkUrl) {
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
      '<button class="ub-go" type="button">' + (apk ? '去下载' : '更新') + '</button>' +
      '<button class="ub-later" type="button">以后</button>';
    host.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('in'));

    const close = () => {
      bar.classList.remove('in');
      setTimeout(() => { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 260);
    };
    bar.querySelector('.ub-go').addEventListener('click', () => {
      close();
      if (apk) {
        // 壳里没法自己替换安装包：有原生桥就在 App 内下载（通知栏安装），
        // 没有桥就交给系统浏览器。官网有包用官网，没有才退回 GitHub Releases。
        openApkDownload(apkUrl || GITHUB_RELEASES);
        return;
      }
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
    showUpdateBar(r.remote, r.local, !!r.apk, r.apkUrl);
  }

  global.App = {
    boot, go, refresh, download, applyTheme, refreshTopbar: renderTopbar,
    checkUpdate, applyUpdate, autoCheckUpdate, currentVersion, bundledVersion, remoteVersion, siteVersion, siteManifest,
    openApkDownload,
    isApk, GITHUB_RELEASES, SITE_BASE,
    isTempOrigin, checkTempOrigin, paintCoupleTab,
    get current() { return current; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
