/* ==================================================================
 * view-sync.js — 双人同步的界面：配对面板 + 状态灯
 *
 * 三条产品原则：
 *   1. 配对码只显示一次也永远能「再看一次」，丢了不用重新配对
 *   2. 复制粘贴是主路径（微信转发最可靠），二维码留到以后
 *   3. 出错要说清是哪一种：连不上 / 码不对 / 对方还没发起
 * ================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const UI = global.UI;
  const Icons = global.Icons;
  const S = global.Store;

  /** 刚生成、还没点「我发给 TA 了」的配对码；只活在这次弹层里 */
  let draft = '';

  function CS() {
    return global.CoupleSync || null;
  }

  /** 43 字符 → 4 个一组，方便人眼核对和手抄 */
  function fmt(code) {
    const s = clean(code);
    return s.replace(/(.{4})/g, '$1 ').trim();
  }

  function clean(str) {
    // '-' 是 base64url 的合法字符，不能当分隔符剔除；只去掉空白和其它符号
    return String(str || '').replace(/[^A-Za-z0-9_-]/g, '');
  }

  const ERR = {
    BAD_AUTH: '这串配对码不对，或者 TA 重新发起过配对。',
    ROOM_NOT_FOUND: '对方还没发起配对，或者这串已经失效了。',
    BAD_PAIR: '配对码格式不对：应该是 43 个字符。',
    // 「连不上服务器」只说明这一件事：请求没到服务器。
    // 手机可能明明有网 —— 所以别写「检查网络」，那会让人去重开流量白折腾。
    NETWORK: '连不上同步服务器。手机能上网的话，多半是这个域名被网络拦了，换 Wi-Fi 或流量再试一次。',
    NO_KEY: '密钥还没准备好，稍等一秒再试。',
  };
  function errText(code) {
    return ERR[code] || '没成功，再试一次。';
  }

  // ---------- 剪贴板 ----------
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
      }
    } catch (e) { /* 落到兜底 */ }
    return Promise.resolve(fallbackCopy(text));
  }

  // ---------- 状态灯（情侣主页右上角那颗） ----------
  // 返回 { cls, text, title }：没配对时是「配对」两个字（要显眼），
  // 配对之后才变成「已同步 / 同步中 / 待补 N」这类状态词。
  function lamp() {
    const c = CS();
    if (!c || !c.status) return { cls: 'off', text: '配对', title: '配对两台手机，一起记一本账' };
    const s = c.status();
    if (!s.ready) return { cls: 'off', text: '配对', title: '配对两台手机，一起记一本账' };
    if (s.state === 'syncing') return { cls: 'busy', text: '同步中', title: '正在同步…' };
    if (s.state === 'error') {
      return {
        cls: 'warn', text: s.pending ? '待补 ' + s.pending : '待重试',
        title: s.pending ? '同步出错 · ' + s.pending + ' 条待发' : '同步出错，会自动重试',
      };
    }
    if (s.state === 'offline') {
      return {
        cls: 'warn', text: s.pending ? '待补 ' + s.pending : '离线',
        title: s.pending ? '离线 · ' + s.pending + ' 条待发' : '离线，联网后自动补',
      };
    }
    // idle = 已配对、在线，但**不代表已经同步成功过**（刚配对时 lastSyncAt 还是 0）
    if (s.pending) return { cls: 'busy', text: '待补 ' + s.pending, title: '还有 ' + s.pending + ' 条没发出去' };
    if (!s.lastSyncAt) return { cls: 'busy', text: '待同步', title: '点这里开始第一次同步' };
    return {
      cls: 'on', text: '已同步',
      title: s.lastSyncAt ? '已同步 · ' + U.relTime(s.lastSyncAt) : '已连接',
    };
  }

  /** 页面重新渲染时把灯刷新一下（找不到就静默） */
  function refreshLamp() {
    try {
      const btn = document.querySelector('#view-couple [data-cp="sync"]');
      if (!btn) return;
      const l = lamp();
      btn.className = 'cp-pair cp-pair--' + l.cls;
      btn.title = l.title;
      const txt = btn.querySelector('.cp-pair-txt');
      if (txt) txt.textContent = l.text;
    } catch (e) { /* 忽略 */ }
  }

  // ---------- 各状态的正文 ----------
  function head(icon, title, desc) {
    return `
      <div class="sync-head">
        <span class="sync-head-ic">${Icons.svg(icon, 20)}</span>
        <div class="sync-head-txt">
          <div class="sync-head-title">${U.escapeHtml(title)}</div>
          <div class="sync-head-desc">${desc}</div>
        </div>
      </div>`;
  }

  function renderIdle(body) {
    body.innerHTML = `
      ${head('heart', '两个人共享一本账', '用一串配对码把两台手机连起来。账目端到端加密 —— 服务器只存看不懂的密文。')}
      <button class="btn btn--primary sync-btn" data-sync="create" type="button">我来发起配对</button>
      <button class="btn btn--ghost sync-btn" data-sync="to-join" type="button">我收到了一串配对码</button>
      <div class="sync-note">
        配对码就是钥匙：谁拿到它，谁就能看这本账。<b>别发到群里</b>。
      </div>`;
  }

  function renderDraft(body) {
    const code = draft || (CS() ? CS().pairString() : '');
    body.innerHTML = `
      ${head('copy', '把这串发给 TA', 'TA 在「加入配对」里粘贴这一串就行。')}
      <div class="sync-code" data-code>${U.escapeHtml(fmt(code))}</div>
      <button class="btn btn--primary sync-btn" data-sync="copy" type="button">复制配对码</button>
      <button class="btn btn--ghost sync-btn" data-sync="done" type="button">我已经发给 TA 了</button>
      <div class="sync-note">
        这串随时能在这里再看一次，截图或复制走都行。真正丢了要重新配对，云端旧数据就解不开了。
      </div>`;
  }

  function renderJoin(body) {
    body.innerHTML = `
      ${head('cloud', '粘贴 TA 发来的配对码', '43 个字符，空格和换行会被自动忽略。')}
      <textarea class="sync-input" data-input rows="3" placeholder="例如：AbCd EfGh iJkL …" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
      <div class="sync-err" data-err></div>
      <button class="btn btn--primary sync-btn" data-sync="join" type="button">加入</button>
      <button class="btn btn--ghost sync-btn" data-sync="back" type="button">返回</button>`;
    const input = body.querySelector('[data-input]');
    if (input) setTimeout(() => { try { input.focus(); } catch (e) {} }, 260);
  }

  function renderPaired(body) {
    const c = CS();
    const s = c ? c.status() : null;
    if (!s) {
      body.innerHTML = '<div class="sync-note">同步模块没加载。</div>';
      return;
    }
    const last = s.lastSyncAt ? U.relTime(s.lastSyncAt) : '还没同步过';
    const dot = s.state === 'error' ? 'warn' : s.state === 'offline' ? 'warn' : 'on';
    const stateText =
      s.state === 'syncing' ? '正在同步…'
      : s.state === 'error' ? '上次没同步成功，会自己重试'
      : s.state === 'offline' ? '当前离线，联网后会补'
      : '已连接';

    body.innerHTML = `
      <div class="sync-stat sync-stat--${dot}">
        <span class="sync-dot"></span>
        <span class="sync-stat-txt">${U.escapeHtml(stateText)}</span>
      </div>
      <div class="sync-rows">
        <div class="sync-row"><span>上次同步</span><b>${U.escapeHtml(last)}</b></div>
        <div class="sync-row"><span>待发</span><b>${s.pending ? s.pending + ' 条' : '没有'}</b></div>
        ${s.dropped ? `<div class="sync-row"><span>已放弃的本地改动</span><b>${s.dropped} 条</b></div>` : ''}
      </div>
      <button class="btn btn--primary sync-btn" data-sync="now" type="button">立即同步</button>
      <button class="btn btn--ghost sync-btn" data-sync="show-code" type="button">查看配对码</button>
      <button class="btn btn--ghost sync-btn sync-btn--danger" data-sync="unbind" type="button">解除连接</button>
      <button class="sync-wipe" data-sync="wipe" type="button">删除云端数据</button>
      <div class="sync-note">
        解除只影响这台手机，云端的数据还在；TA 那边照常同步。想一起清掉，用下面的「删除云端数据」。
      </div>`;
  }

  // ---------- 交互 ----------
  function bind(body, close) {
    if (body.dataset.syncBound) return;
    body.dataset.syncBound = '1';

    body.addEventListener('click', async (e) => {
      const btn = e.target.closest && e.target.closest('[data-sync]');
      if (!btn) return;
      const act = btn.dataset.sync;
      const c = CS();
      const err = body.querySelector('[data-err]');
      const showErr = (msg) => {
        if (!err) { U.toast(msg, 'error'); return; }
        err.textContent = msg;
        err.classList.add('in');
      };

      if (act === 'create') {
        if (!c) return;
        btn.disabled = true;
        try {
          draft = c.pair();
          // 本机已有的情侣账先排队推上去（op_id 固定成 boot_+id，重推不会重复）
          if (S && S.syncBootstrap) S.syncBootstrap();
          renderDraft(body);
          c.syncOnce().then(refreshLamp, refreshLamp);
        } catch (ex) {
          btn.disabled = false;
          U.toast('配对码生成失败', 'error');
        }
        return;
      }

      if (act === 'to-join') { renderJoin(body); return; }
      if (act === 'back') { draft = ''; renderIdle(body); return; }

      if (act === 'copy') {
        if (!c) return;
        const ok = await copyText(c.pairString());
        U.toast(ok ? '已复制，发给 TA 吧' : '复制没成功，长按上面的码手动复制', ok ? 'success' : 'error');
        return;
      }

      if (act === 'done') {
        draft = '';
        renderPaired(body);
        refreshLamp();
        if (c) c.syncOnce().then(refreshLamp, refreshLamp);
        return;
      }

      if (act === 'join') {
        if (!c) return;
        const input = body.querySelector('[data-input]');
        const code = clean(input ? input.value : '');
        if (code.length !== 43) { showErr('配对码格式不对：应该是 43 个字符，现在 ' + code.length + ' 个。'); return; }
        btn.disabled = true;
        btn.textContent = '正在连接…';
        const r = await c.join(code);
        if (!r.ok) {
          btn.disabled = false;
          btn.textContent = '加入';
          showErr(errText(r.code));
          return;
        }
        if (S && S.syncBootstrap) S.syncBootstrap();
        await c.syncOnce();
        close();
        refreshLamp();
        U.toast('连上了，正在拉 TA 的账', 'success');
        return;
      }

      if (act === 'now') {
        if (!c) return;
        btn.disabled = true;
        btn.textContent = '同步中…';
        await c.syncOnce();
        renderPaired(body);
        refreshLamp();
        return;
      }

      if (act === 'show-code') { draft = c ? c.pairString() : ''; renderDraft(body); return; }

      if (act === 'wipe') {
        const yes = await UI.confirm({
          title: '删除云端的这本账？',
          desc: '云端的全部记录会被真删，<b>不可恢复</b>；另一台手机下次同步会提示「云端已删除」。<br><br>'
            + '这台手机上已经记下的账目不会被删。',
          okText: '删除云端', danger: true,
        });
        if (!yes) return;
        const again = await UI.confirm({
          title: '再确认一次',
          desc: '删除后两台手机都不再有云端备份，只能靠各自的本地数据。真的要删？',
          okText: '确定删除', danger: true,
        });
        if (!again) return;
        btn.disabled = true;
        btn.textContent = '正在删除…';
        const r = await c.removeRoom();
        btn.disabled = false;
        btn.textContent = '删除云端数据';
        if (!r || !r.ok) {
          showErr(errText(r && r.code));
          return;
        }
        close();
        refreshLamp();
        U.toast('云端已删除', 'success');
        return;
      }

      if (act === 'unbind') {
        UI.confirm({
          title: '解除连接？',
          desc: '这台手机会忘掉配对码，不再同步。<br>云端的数据还在，TA 那边照常；想一起清掉，去设置里用「删除云端数据」。<br><br>'
            + '<b>解绑后要重新配对，得让 TA 再发一次配对码。</b>',
          okText: '解除',
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          if (c) c.leave();
          close();
          refreshLamp();
          U.toast('已解除连接', 'success');
        });
        return;
      }
    });

    const input = body.querySelector('[data-input]');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const go = body.querySelector('[data-sync="join"]');
          if (go) go.click();
        }
      });
    }
  }

  function paint(body, close) {
    const c = CS();
    if (!c) {
      body.innerHTML = '<div class="sync-note">这个版本不支持同步。</div>';
      return;
    }
    if (draft) renderDraft(body);
    else if (c.ready()) renderPaired(body);
    else renderIdle(body);
    bind(body, close);
  }

  function open() {
    draft = '';
    UI.openSheet({
      title: '双人同步',
      content: '<div class="sync-wrap"></div>',
      onMount(body, close) {
        const wrap = body.querySelector('.sync-wrap') || body;
        // 每次重绘只换内容，事件委托挂在 wrap 上，不会被 innerHTML 冲掉
        const holder = document.createElement('div');
        wrap.appendChild(holder);
        const draw = () => paint(holder, close);
        draw();
        const timer = setInterval(() => {
          if (!document.body.contains(holder)) { clearInterval(timer); return; }
          // 已连接状态下让「上次同步 / 待发」自己走字
          if (!body.querySelector('.sync-stat')) return;
          const c = CS();
          if (!c) return;
          const s = c.status();
          const row = body.querySelectorAll('.sync-row b');
          if (row[0]) row[0].textContent = s.lastSyncAt ? U.relTime(s.lastSyncAt) : '还没同步过';
          if (row[1]) row[1].textContent = s.pending ? s.pending + ' 条' : '没有';
        }, 3000);
      },
    });
  }

  global.ViewSync = { open, lamp, refreshLamp, fmt, clean, _errText: errText };
})(window);
