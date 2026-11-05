/* ============================================================
 * 花哪儿了 · 数据安全（主屏安装引导 + 定期备份提醒）
 *
 * 为什么有这两个功能（2026-10-24 的真机数据丢失惊魂）：
 * 账目只存在本机 localStorage（key: jizhang.v1）。iOS Safari 的
 * ITP 会删除「连续 7 个 Safari 使用日无用户交互」网站的所有脚本可写
 * 存储——localStorage、IndexedDB、Service Worker 注册都在其中。
 * 普通标签页形态躲不掉；WebKit 官方明确：**添加到主屏幕的 Web App
 * 不属于 Safari，有自己的使用计数器，数据不在清理范围内**。
 *
 * 所以：
 *   1. 引导用户把网页加到主屏幕 —— 治本；
 *   2. 定期提醒导出 JSON 备份 —— 兜底（设备存储压力回收、误清网站
 *      数据、换设备，都只有备份救得回来）。
 * ============================================================ */
(function (global) {
  'use strict';

  const S = global.Store;
  const U = global.U;
  const UI = global.UI;

  const DAY = 86400000;
  const BACKUP_INTERVAL = 14 * DAY;   // 两周没导出就提醒一次
  const REPROMPT_AFTER = 30 * DAY;    // 引导被关掉后，隔一个月再自动问一次

  // ------------------------------------------------------------
  // 环境检测
  // ------------------------------------------------------------

  /** 是不是已经以「主屏 App」形态在跑（iOS 主屏 / Android 安装的 PWA） */
  function isStandalone() {
    try {
      if (global.navigator.standalone === true) return true;                    // iOS Safari 主屏
      if (global.matchMedia) {
        if (global.matchMedia('(display-mode: standalone)').matches) return true;
        if (global.matchMedia('(display-mode: minimal-ui)').matches) return true;
      }
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /** 是不是跑在安卓 APK 壳里（数据在 WebView 里，没有 ITP 这回事） */
  function isApkShell() {
    try { return location.hostname === 'appassets.androidplatform.net'; } catch (e) { return false; }
  }

  function isIOS() {
    try {
      const ua = navigator.userAgent || '';
      if (/iPad|iPhone|iPod/.test(ua)) return true;
      // iPadOS 13+ 桌面模式会伪装成 Macintosh，靠触控点位数区分
      return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------
  // 底部提示条（复用 App 更新提示的 update-bar 样式与 toast-host）
  // ------------------------------------------------------------
  function host() {
    return document.getElementById('toast-host') || (() => {
      const h = U.el('div', { id: 'toast-host', class: 'toast-host' });
      document.body.appendChild(h);
      return h;
    })();
  }

  /**
   * 弹一条底部提示。
   * o = { cls, icon, title, desc, go: { label, fn }, later: { label, fn } }
   */
  function showBar(o) {
    const h = host();
    if (h.querySelector('.' + o.cls)) return;          // 同一条不重复弹
    const bar = U.el('div', { class: 'update-bar ' + o.cls });
    bar.innerHTML =
      '<span class="ub-ic">' + o.icon + '</span>' +
      '<span class="ub-txt">' + o.title +
      (o.desc ? '<span class="ub-from">' + o.desc + '</span>' : '') + '</span>' +
      '<button class="ub-go" type="button">' + o.go.label + '</button>' +
      (o.later ? '<button class="ub-later" type="button">' + o.later.label + '</button>' : '');
    h.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('in'));

    const close = () => {
      bar.classList.remove('in');
      setTimeout(() => { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 260);
    };
    bar.querySelector('.ub-go').addEventListener('click', () => { close(); o.go.fn(); });
    if (o.later) {
      bar.querySelector('.ub-later').addEventListener('click', () => {
        close();
        if (o.later.fn) o.later.fn();
      });
    }
    // 30 秒后自己收起来，别一直挡着
    setTimeout(() => { if (bar.parentNode) close(); }, 30000);
  }

  // ------------------------------------------------------------
  // 1. 添加到主屏幕
  // ------------------------------------------------------------
  function checkInstall() {
    if (isStandalone() || isApkShell()) return;         // 已经安全 / 不适用
    const cfg = S.settings.install || {};
    if (cfg.done) return;                                // 用户说过不再提醒
    // 自动弹出的节奏：第一次进 App 弹一次；关掉后一个月内不再自动弹
    if (cfg.promptedAt && Date.now() - cfg.promptedAt < REPROMPT_AFTER) return;
    S.setSettings({ install: { promptedAt: Date.now() } });
    showBar({
      cls: 'install-bar',
      icon: '📲',
      title: '把「花哪儿了」加到主屏幕',
      desc: 'Safari 标签页连续 7 个使用日不打开，iOS 可能自动清掉账目',
      go: { label: '怎么加', fn: showInstallSheet },
      later: { label: '以后再说', fn: null },
    });
  }

  /** 操作说明弹层。iOS / Android 各一套步骤；认不出来就都给。 */
  function showInstallSheet() {
    if (!UI || !UI.openSheet) {
      U.toast('iOS：分享 → 添加到主屏幕；安卓：浏览器菜单 → 添加到主屏幕', 'info');
      return;
    }
    const ios = isIOS();
    const steps = (arr) => arr.map((s, i) =>
      '<div class="safe-step"><i>' + (i + 1) + '</i><span>' + s + '</span></div>'
    ).join('');
    const iosSteps = [
      '点 Safari 底部工具栏的<b>分享</b>按钮（方框带向上箭头）',
      '在菜单里找到并点<b>添加到主屏幕</b>',
      '右上角点<b>添加</b>，以后从桌面图标打开',
    ];
    const androidSteps = [
      '点浏览器右上角 <b>⋮</b>（更多）菜单',
      '点<b>添加到主屏幕</b>（有的浏览器叫「安装应用」）',
      '确认添加，桌面会出现「花哪儿了」图标',
    ];
    UI.openSheet({
      title: '添加到主屏幕',
      content:
        '<div class="safe-steps">' + steps(ios ? iosSteps : androidSteps) + '</div>' +
        (ios ? '' : '<div class="safe-note" style="margin-bottom:12px">用的是 iPhone / iPad 的话：Safari 底部<b>分享</b>按钮 → <b>添加到主屏幕</b>。</div>') +
        '<div class="safe-note">加到主屏幕后，它就不受「连续 7 个使用日不打开就清数据」的影响，' +
        '桌面图标打开和普通 App 一样；账目还是同一份，不会多出来一份。</div>' +
        '<button class="btn btn--ghost" data-act="never" type="button" style="margin-top:14px">不再提醒我</button>',
      onMount(body, close) {
        const never = body.querySelector('[data-act="never"]');
        if (never) {
          never.addEventListener('click', () => {
            S.setSettings({ install: { done: true } });
            close();
            U.toast('已关闭引导，设置 → 数据安全里还能找到', 'info');
          });
        }
      },
    });
  }

  // ------------------------------------------------------------
  // 2. 定期导出备份提醒
  // ------------------------------------------------------------
  function checkBackup() {
    const cfg = S.settings.backup || {};
    if (cfg.remind === false) return;
    const since = Math.max(cfg.lastExportAt || 0, cfg.lastRemindAt || 0);
    if (Date.now() - since < BACKUP_INTERVAL) return;
    const never = !(cfg.lastExportAt > 0);
    showBar({
      cls: 'backup-bar',
      icon: '💾',
      title: never ? '还没导出过备份' : '两周没备份了',
      desc: '账目只存在这台设备上，导出一份放手里才安心',
      go: {
        label: '去导出',
        fn: () => {
          global.App.go('settings');
          setTimeout(() => U.toast('设置 → 数据 → 导出备份', 'info'), 450);
        },
      },
      later: {
        label: '稍后',
        // 记一次提醒时间：顺延一个周期，不会天天跳出来
        fn: () => S.setSettings({ backup: { lastRemindAt: Date.now() } }),
      },
    });
  }

  // ------------------------------------------------------------
  // 启动检查（由 app.js 的 boot 调用）
  // ------------------------------------------------------------
  function check() {
    try {
      // 一次只出一条，避免底部叠一摞提示
      if (host().querySelector('.update-bar')) return;
      checkInstall();
    } catch (e) { /* 数据安全的提醒挂了不能影响启动 */ }
    setTimeout(() => {
      try {
        if (!host().querySelector('.update-bar')) checkBackup();
      } catch (e) { /* 忽略 */ }
    }, 1600);
  }

  global.Safety = {
    check,
    checkInstall,
    checkBackup,
    showInstallSheet,
    isStandalone,
    isApkShell,
  };
})(window);
