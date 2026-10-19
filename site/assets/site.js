/* 花哪儿了 · 官网交互（≤120 行）
 *
 * 原则（任务书 §6.3）：JS 只负责"更顺"，不负责"能用"。
 * 关掉它以后：全部文案在、FAQ 能开、安卓能下载、iOS 三步能看。
 * 地址只有一个来源：HTML 里那个 #app-url，下面从不重复写死。
 */
(function () {
  'use strict';

  var UA = navigator.userAgent;
  var html = document.documentElement;
  var APP_URL = (document.getElementById('app-url') || {}).href || '';

  /* ---- 1. 平台判定：顺序不能改（微信 UA 里既有 iPhone 也有 Android） ---- */
  var isWeChat = /MicroMessenger|QQ\/|Weibo/i.test(UA);
  var isIOS = /iPhone|iPad|iPod/i.test(UA) && !/CriOS|FxiOS|EdgiOS/i.test(UA);
  var isAndroid = /Android|HarmonyOS/i.test(UA) && !isIOS;

  if (isWeChat) html.classList.add('is-wechat');

  var box = document.querySelector('.install');
  if (box) {
    var mine = isIOS ? 'ios' : isAndroid ? 'android' : '';
    if (mine) {
      var card = box.querySelector('[data-platform="' + mine + '"]');
      var badge = card && card.querySelector('.pcard__badge');
      if (card && card.parentNode.firstElementChild !== card) box.insertBefore(card, box.firstElementChild);
      if (badge) badge.hidden = false;
    }
  }

  /* ---- 2. iOS 卡的按钮：点开三步，不跳走 ---- */
  var openBtn = document.querySelector('[data-open="ios"]');
  if (openBtn) {
    openBtn.addEventListener('click', function (e) {
      var d = document.getElementById('ios-steps');
      if (!d) return;
      e.preventDefault();
      d.open = true;
      d.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  /* ---- 3. 复制网址（失败降级：选中那段文本） ---- */
  var copyBtn = document.getElementById('copy');
  var tip = document.getElementById('copy-tip');
  if (copyBtn && APP_URL) {
    copyBtn.addEventListener('click', function () {
      var done = function (msg) { if (tip) tip.textContent = msg; };
      var fallback = function () {
        var a = document.getElementById('app-url');
        if (!a) return;
        var r = document.createRange();
        r.selectNodeContents(a);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        done('已选中，按 Ctrl/⌘+C 复制');
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(APP_URL).then(function () { done('已复制'); }, fallback);
      } else {
        fallback();
      }
    });
  }

  /* ---- 4. 顶栏：滚过 80px 才出现底边线 ---- */
  var topbar = document.querySelector('.topbar');
  if (topbar) {
    var onScroll = function () {
      topbar.classList.toggle('is-stuck', window.scrollY > 80);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---- 5. 从 zip 版跳回来时，在下载卡上方说清楚版本 ---- */
  var bar = document.getElementById('compare');
  if (bar) {
    var q = new URLSearchParams(location.search);
    var from = q.get('from');
    var v = q.get('v');
    var now = (document.querySelector('[data-build="version"]') || {}).textContent || '';
    if (from === 'zip' && v && v !== now.replace(/^v/, '')) {
      bar.textContent = '你手上的是 v' + v + '，最新 ' + now + '，建议重新下载一份。';
      bar.classList.add('is-on');
    }
  }

  /* ---- 6. 微信里把下载按钮变成"只提示" ---- */
  if (isWeChat) {
    var zip = document.getElementById('zip-link');
    if (zip) {
      zip.addEventListener('click', function (e) { e.preventDefault(); });
      zip.setAttribute('aria-disabled', 'true');
    }
  }
})();
