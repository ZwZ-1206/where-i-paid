/* ============================================================
 * 记账本 · 通用工具
 * ============================================================ */
(function (global) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  /** 金额（分）→ 展示字符串 */
  function money(cents, opts) {
    const o = opts || {};
    const v = (Number(cents) || 0) / 100;
    const fixed = o.decimals === undefined ? 2 : o.decimals;
    const s = Math.abs(v).toLocaleString('zh-CN', {
      minimumFractionDigits: fixed,
      maximumFractionDigits: fixed,
    });
    return (v < 0 ? '-' : '') + (o.symbol === false ? '' : '¥') + s;
  }

  /** 金额（分）→ 紧凑展示：1.2万 / 3,456 */
  function moneyCompact(cents) {
    const v = (Number(cents) || 0) / 100;
    if (Math.abs(v) >= 10000) return '¥' + (v / 10000).toFixed(1) + '万';
    return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }

  /** 输入字符串 → 分（安全整数） */
  function toCents(str) {
    if (typeof str === 'number') return Math.round(str * 100);
    const cleaned = String(str == null ? '' : str).replace(/[^\d.-]/g, '');
    const n = Number(cleaned);
    if (!isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  /** 键盘输入态金额字符串 → 分 */
  function amountToCents(text) {
    const t = String(text || '').trim();
    if (!t || t === '.') return 0;
    const n = Number(t);
    if (!isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  // ---------------- 日期 ----------------
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }
  function ymd(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }
  function parseYmd(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }
  /** 带边界钳制的 setDate */
  function dateClamped(y, m, day) {
    const dim = daysInMonth(y, m);
    return new Date(y, m, Math.min(Math.max(1, day), dim), 0, 0, 0, 0);
  }
  const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

  function humanDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const t0 = startOfDay(now).getTime();
    const d0 = startOfDay(d).getTime();
    const diff = Math.round((t0 - d0) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff === 2) return '前天';
    if (diff === -1) return '明天';
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  function fullDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_CN[d.getDay()]}`;
  }
  function timeStr(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function relTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    return humanDate(ts);
  }
  function monthKey(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`;
  }
  function monthLabel(key) {
    const [y, m] = key.split('-');
    return `${y}年${Number(m)}月`;
  }

  // ---------------- DOM ----------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'dataset') Object.assign(n.dataset, attrs[k]);
        else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
      });
    }
    if (html != null) n.innerHTML = html;
    return n;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  let toastTimer = null;
  function toast(msg, type) {
    let host = $('#toast-host');
    if (!host) {
      host = el('div', { id: 'toast-host', class: 'toast-host' });
      document.body.appendChild(host);
    }
    host.innerHTML = '';
    const t = el('div', { class: 'toast toast--' + (type || 'info') }, msg);
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, 2200);
  }

  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { /* ignore */ }
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(ctx, args), ms || 200);
    };
  }

  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

  /**
   * 弹出系统文件选择器。
   *
   * 为什么要有这个函数：安卓 WebView 里，**游离节点**（没挂进文档）的
   * `<input type=file>` 调用 click() 不会触发 onShowFileChooser，
   * 表现就是「点了没反应」——识图导入、导入账单、恢复备份全都中招。
   * 统一在这里挂进 DOM、用完摘掉，避免每个调用点各写一遍还漏掉。
   *
   * @param {{accept?:string, multiple?:boolean, onPick?:(file:File|File[])=>void}} opts
   */
  function pickFile(opts) {
    const o = opts || {};
    const input = document.createElement('input');
    input.type = 'file';
    if (o.accept) input.accept = o.accept;
    if (o.multiple) input.multiple = true;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    document.body.appendChild(input);
    let done = false;
    const drop = () => { if (done) return; done = true; try { input.remove(); } catch (e) { /* 忽略 */ } };
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      drop();
      if (files.length && o.onPick) {
        try { o.onPick(o.multiple ? files : files[0]); } catch (e) { console.error(e); }
      }
    });
    // 用户取消时也要摘掉节点（Chrome 系支持 cancel 事件）
    input.addEventListener('cancel', drop);
    input.click();
    return input;
  }

  global.U = {
    pad, money, moneyCompact, toCents, amountToCents,
    startOfDay, endOfDay, ymd, parseYmd, addDays, daysInMonth, dateClamped,
    WEEK_CN, humanDate, fullDate, timeStr, relTime, monthKey, monthLabel,
    $, $$, el, escapeHtml, toast, vibrate, uid, debounce, clamp, pickFile,
  };
})(window);
