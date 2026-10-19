/* ============================================================
 * 花哪儿了 · 情侣账本（步骤 1：外壳 / 同意流程 / 模式选择）
 *
 * 本文件这一阶段**完全不联网**：
 *  - 只负责界面骨架、协议同意、必填资料、同城/异地选择
 *  - 数据全部落在 settings.couple 里，不上传任何东西
 *  - 真正上云在后续步骤接 sync.js
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  const S = global.Store;
  const Icons = global.Icons;

  // 协议版本：改了协议正文就 +1，老用户会被要求重新同意
  const CONSENT_VERSION = 3;
  // 引导过程中的临时草稿：重渲染（选日期、切步骤）后不丢
  const draft = { meName: '', peerName: '', togetherSince: '', meBirthday: '', peerBirthday: '' };
  // 主界面内分页：
  // 'home' 主页 / 'bill' 情侣账单 / 'mode' 选模式 / 'memories' 回忆小票墙 / 'days' 重要日子
  const PAGES = ['home', 'bill', 'mode', 'memories', 'days', 'report', 'favor'];
  let page = 'home';
  // 情侣账单页的状态：按自然月翻页，0 = 本月
  const billState = { offset: 0, filterType: 'all' };
  // 「TA 刚记了 N 笔」：同步层拉到对方新记的账就 +N，进账单页清零。
  // 只放内存不落盘 —— 拉取是增量的（lastSeq），重启后不会把老账再数一遍。
  let peerNew = 0;

  const MODE = {
    local: {
      key: 'local', emoji: '🏙️', name: '我们在同城',
      title: '同城',
      items: ['约会基金', '回忆小票墙', '在一起第 N 天', '今天想一起干嘛'],
    },
    remote: {
      key: 'remote', emoji: '✈️', name: '我们在异地',
      title: '异地',
      items: ['见面倒计时', '下次见面基金', '时差与作息', '想你的时候'],
    },
  };

  // ------------------------------------------------------------
  // 模式卡插图：手绘 SVG
  // 不用图片文件、不用外链，离线也能显示，深色模式下也不掉色。
  // ------------------------------------------------------------
  // ------------------------------------------------------------
  // 模式卡插图：真实照片（assets/couple/），图片底下压一层同色渐变，
  // 保证深色模式、图片还没加载完的时候都不会露出一块白。
  // 用 <img> 而不是内联 SVG：真机上手指点在图片上时，合成点击同样不会
  // 冒泡到 button，所以点击统一走 bindOnboarding 的事件委托。
  // ------------------------------------------------------------
  const ART = {
    // 同城：黄昏下的两个人，暖紫粉色调
    local: `
      <img class="cp-art-img" src="assets/couple/tongcheng.jpg" alt="两个人靠在一起看日落" loading="lazy" decoding="async" />
      <span class="cp-art-veil cp-art-veil--local"></span>`,
    // 异地：夜里各自的房间，中间隔着屏幕
    remote: `
      <img class="cp-art-img" src="assets/couple/yidi.jpg" alt="一个在屏幕这头，一个在那头" loading="lazy" decoding="async" />
      <span class="cp-art-veil cp-art-veil--remote"></span>`,
  };

  // 引导流程的步骤
  // intro → consent → profile → mode → 主界面
  let step = 'intro';

  // 协议步骤的 resize 监听句柄（只保留一个，见 bindOnboarding 的 consent 分支）
  // window 是全局对象，不会因为重渲染而销毁，所以必须自己记账并解绑。
  let consentResizeHandler = null;

  // ------------------------------------------------------------
  // 读取 / 写入设置
  // ------------------------------------------------------------
  function cfg() {
    return (S.settings && S.settings.couple) || {};
  }

  function on() {
    const c = cfg();
    return !!c.enabled && c.consent && c.consent.agreed && !!c.mode
      && !!(c.meName && c.peerName && c.togetherSince);
  }

  /** 账本开着，只是用户把它从首页收起来了 */
  function hidden() {
    const c = cfg();
    return !!c.enabled && !!c.hidden;
  }

  function consentOk() {
    const c = cfg();
    return !!(c.consent && c.consent.agreed && c.consent.version === CONSENT_VERSION);
  }

  function viewName() {
    return 'couple';
  }

  /** 顶栏副标题：和 XX 在一起的第 N 天 */
  function subtitle() {
    const c = cfg();
    if (!on()) return '';
    return `和 ${c.peerName} 在一起的第 ${daysTogether()} 天`;
  }

  function daysTogether() {
    const c = cfg();
    if (!c.togetherSince) return 1;
    const p = String(c.togetherSince).split('-');
    if (p.length !== 3) return 1;
    const start = new Date(+p[0], +p[1] - 1, +p[2]);
    const today = U.startOfDay(new Date());
    const s0 = U.startOfDay(start);
    const n = Math.floor((today - s0) / 86400000) + 1;
    return Math.max(1, n);
  }

  // ------------------------------------------------------------
  // 同月内的滚动位置保持（O3）
  //
  // 设计总监定稿：翻月跳顶是**正确行为**（月份标题在容器顶部，翻月后回到
  // 顶部是让用户看到新月份的名字）。真正要修的只有一类场景 —— 在长列表里
  // 点某一天 / 某一笔账单，弹层关掉后重渲染，滚动位置丢了。
  // 所以：只有「同月内的交互」才记账并恢复；翻月 / 选年月一律不恢复（跳顶）。
  // ------------------------------------------------------------

  /** 记下「下一次 render 要把滚动位置放回去」的 scrollTop；null = 不恢复 */
  let keepScrollTop = null;

  /** 滚动容器：内容直接铺在 #view-couple 上，它自己就是那个 overflow-y:auto 的
   *  盒子（.view { overflow-y: auto }，见 app.css）。root 可能传的是内部子容器，
   *  所以往上找一层真正的 .view。 */
  function scrollHost(root) {
    const host = root && root.closest ? root.closest('.view') : null;
    return host || root;
  }

  /** 当前滚动位置（读不到就是 0，恢复时会跳过 0） */
  function scrollTopOf(root) {
    const host = scrollHost(root);
    return host && typeof host.scrollTop === 'number' ? host.scrollTop : 0;
  }

  /** 进入前调用：记下当前 scrollTop，下一次 render 结束后会放回去。
   *  render 一开头就用 takeKeepScroll 取走，所以这个值只会服务紧跟着的
   *  那一次重渲染，不会残留到翻月之类的别的交互上。 */
  function markKeepScroll(root) {
    keepScrollTop = scrollTopOf(root);
  }

  /** render 开头取一次就用掉 */
  function takeKeepScroll() {
    const v = keepScrollTop;
    keepScrollTop = null;
    return v;
  }

  /** 恢复：先同步放一次（不让下一帧闪一下顶部），再在 rAF 之后校准一次，
   *  等新内容真正布局完；两次都 clamp 到 scrollHeight - clientHeight ——
   *  新内容比原来矮时，不加钳制会滚到虚无区域。 */
  function restoreScroll(root, top) {
    const host = scrollHost(root);
    if (!host || !(top > 0)) return;
    const apply = () => {
      const max = Math.max(0, host.scrollHeight - host.clientHeight);
      const want = Math.min(top, max);
      try { if (host.scrollTop !== want) host.scrollTop = want; } catch (e) { /* 忽略 */ }
    };
    apply();
    const raf = typeof global.requestAnimationFrame === 'function' ? global.requestAnimationFrame : null;
    if (raf) raf(() => raf(apply));
  }

  /** 同月内的原地重画：记住位置 → 重画 → 放回去。
   *  翻月 / 选年月一律不调这里，直接 render(root)，保持「跳到顶部」。 */
  function renderKeep(root) {
    markKeepScroll(root);
    render(root);
  }

  // ------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------
  function render(root) {
    if (!root) return;
    // 这一次重渲染要不要把滚动位置放回去：有值才放（见 markKeepScroll）
    const keepTop = takeKeepScroll();
    try {
      // 收起状态也走「引导页」这条分支：它不是主界面，只是一张「还开着」的卡
      if (!on() || hidden()) {
        peerNew = 0;
        renderOnboarding(root);
        return;
      }
      if (page === 'bill') renderBill(root);
      else if (page === 'mode') renderModePage(root);
      else if (page === 'memories') renderMemories(root);
      else if (page === 'report') renderReport(root);
      else if (page === 'days') renderDays(root);
      else if (page === 'favor') renderFavorPage(root);
      else renderMain(root);
      // 提示条不进 renderMain 的模板：它会在「同步完成」时被单独贴上去，
      // 走同一个函数，重渲染后也不会丢。
      if (page === 'home') paintPeerNew();
      restoreScroll(root, keepTop);
    } catch (err) {
      // 任何一步渲染失败都不能留白屏：把错误显示出来，方便定位（也避免「点了没反应」的假象）
      console.error('[ViewCouple] render 出错：', err);
      try { step = 'main'; } catch (e) { /* 忽略 */ }
      root.innerHTML = `
        <div class="cp-error">
          <div class="cp-error-title">这个页面没渲染出来</div>
          <div class="cp-error-msg">${U.escapeHtml((err && (err.message || err.toString())) || '未知错误')}</div>
          <button class="btn btn--ghost btn--sm" data-cp="retry" type="button">重试</button>
        </div>`;
      const retry = root.querySelector('[data-cp="retry"]');
      if (retry) retry.addEventListener('click', () => render(root));
    }
  }

  // ---- 引导流程 ----
  function renderOnboarding(root) {
    const c = cfg();
    // 资料齐全但开关是关的 → 停在「重新打开」起手页，不要直接跳到同城/异地（任务书 G8）
    const canResume = !!(c.meName && c.peerName && c.togetherSince && c.mode);
    if (step === 'intro' && consentOk() && !canResume) step = 'mode';
    // 决定这一页到底是哪种「不在」：
    //   hidden  → 账本还开着，只是首页不显示（一句话就能放回来）
    //   closed  → 关掉了，数据都在（7 天内给一键反悔）
    //   none    → 手机上真的没有账本了，从头开始
    //
    // 注意顺序：只要 step 已经往前走（同意页 / 资料页 / 模式页），就必须照着 step 渲染，
    // 不能被「没账本」「有账本但没开通」这些分支抢走。
    // 以前把 !hasBook 和 stepReopen 排在 stepConsent 前面，点「去同意」之后
    // 页面纹丝不动（直接把 step 改了、却还是画起手页），看起来就是按钮坏了。
    const hasBook = S.cpBooks().length > 0;
    // 「一本都不剩了」和「第一次开通（本来就没有）」要分开：
    // 前者要把 step 归零，后者不能归零。deletedAt / closedAt 是「真的有过一本」的痕迹，
    // S.wipeCpBook 删最后一本时会把 deletedAt 记上；关掉时记 closedAt。
    const hadBookBefore = !!(c.deletedAt || c.closedAt);
    if (step !== 'intro' && !hasBook && hadBookBefore && !canResume) step = 'intro';
    let body = '';
    if (step === 'consent') body = stepConsent();
    else if (step === 'profile') body = stepProfile();
    else if (step === 'mode') body = stepMode();
    else if (c.hidden) body = stepHidden(c);
    else if (hasBook && !c.enabled) body = stepReopen(c);
    else body = stepIntro(canResume ? c : null);

    // 只有「选模式」那一屏用定高铺满的 --mode（两张卡片要平分一屏）。
    // 介绍 / 协议 / 资料页内容高度不固定，必须用基础 .cp-onboard：
    // 它是 min-height:100% 的纵向 flex，内容多了能滚，底部按钮靠
    // margin-top:auto 贴底。套上 --mode 会被 overflow:hidden 裁掉按钮。
    const cls = step === 'mode' ? 'cp-onboard cp-onboard--mode' : 'cp-onboard';
    root.innerHTML = `<div class="${cls}">${body}</div>`;
    bindOnboarding(root);
  }

  /** 收起状态：账本还开着，只把入口放回来就行 */
  function stepHidden(c) {
    return `
      <div class="cp-hero">
        <div class="cp-hero-hearts">💞</div>
        <h1 class="cp-hero-title">账本还开着</h1>
        <p class="cp-hero-sub">你把它从首页收起来了。点一下就能放回去。</p>
      </div>
      <div class="cp-card cp-card--resume">
        <div class="cp-card-title">和 ${U.escapeHtml(c.peerName || 'TA')} 的那一本</div>
        <div class="cp-desc">里面的账、小金库、一起存过的每一笔，都还在。</div>
        <button class="btn btn--primary" data-cp="unhide" type="button"
          style="margin-top:13px;width:100%">放回首页</button>
      </div>`;
  }

  /** 关闭后重新进来的第一页：先给「恢复」，再给「换一本」 */
  function stepReopen(c) {
    const undoable = S.cpCanUndo && S.cpCanUndo();
    const n = S.cpTxsOf ? S.cpTxsOf(S.cpActiveId()).length : 0;
    const others = S.cpBooks().length - 1;
    const book = S.cpActiveBook ? S.cpActiveBook() : null;
    // 资料齐全就一步打开（走 resume）；资料缺了（老数据没填过）才回去走一遍开通
    const ready = !!(book && book.meName && book.peerName && book.mode && book.togetherSince);
    const resumeAct = ready ? (undoable ? 'undo-close' : 'resume') : 'to-consent';
    const resumeTxt = !ready ? '重新填资料' : (undoable ? '恢复这本账本' : '重新打开');
    return `
      <div class="cp-hero">
        <div class="cp-hero-hearts">💞</div>
        <h1 class="cp-hero-title">最近关掉的那一本</h1>
        <p class="cp-hero-sub">${undoable
          ? '7 天内点一下就能回来，什么都还在。'
          : '数据都还在手机上，想回来随时可以。'}</p>
      </div>
      <div class="cp-card cp-card--resume">
        <div class="cp-card-title">和 ${U.escapeHtml(c.peerName || 'TA')} 的那一本</div>
        <div class="cp-desc">${n} 笔记录 · 小金库和一起存过的钱都原样留着。</div>
        <button class="btn btn--primary" data-cp="${resumeAct}" type="button"
          style="margin-top:13px;width:100%">${resumeTxt}</button>
      </div>
      <div class="cp-card cp-card--soft">
        <div class="cp-card-title">想重新开始？</div>
        <div class="cp-desc">换一本新的，这一本会整本收进「历史账本」，记录一条都不会少。</div>
        <div class="cp-btn-row" style="margin-top:12px">
          <button class="btn btn--ghost btn--sm" data-cp="new-book" type="button">换一本新的</button>
          <button class="btn btn--ghost btn--sm" data-cp="books" type="button">历史账本${others > 0 ? `（${others}）` : ''}</button>
        </div>
      </div>`;
  }

  function stepIntro(resume) {
    return `
      <div class="cp-hero">
        <div class="cp-hero-hearts">💞</div>
        <h1 class="cp-hero-title">情侣账本</h1>
        <p class="cp-hero-sub">两个人记一本账，看的是「我们」花了什么，不是谁花得多。</p>
      </div>

      ${resume ? `
      <div class="cp-card cp-card--resume">
        <div class="cp-card-title">上次的情侣账本还在</div>
        <div class="cp-desc">
          和 <b>${U.escapeHtml(resume.peerName || 'TA')}</b> 的那本账、小金库、
          记过的每一笔都原样留着，只是关掉了开关。
        </div>
        <button class="btn btn--primary btn--sm" data-cp="resume" type="button"
          style="margin-top:12px;width:auto">重新打开</button>
      </div>` : ''}

      <div class="cp-card">
        <div class="cp-card-title">记下来的东西放哪</div>
        <div class="cp-list">
          <div class="cp-line cp-line--ok">
            <span class="cp-line-ic">${Icons.svg('check', 15)}</span>
            <span><b>只在这台手机上</b>，哪儿也不去</span>
          </div>
          <div class="cp-line">
            <span class="cp-line-ic">${Icons.svg('close', 15)}</span>
            <span>其他账本、攒钱目标、所有设置 <b>一律不上传</b></span>
          </div>
        </div>
        <div class="cp-note">
          只有情侣这一本账会在配对后加密同步；其他账本、攒钱目标、所有设置一个字节都不传。
        </div>
      </div>

      <div class="cp-card cp-card--soft">
        <div class="cp-card-title">两个人怎么共用一本账</div>
        <div class="cp-desc">
          配好对之后，两台手机自动同步这一本（端到端加密，服务器只存密文）。
          没配对时就是<b>各记各的</b>，TA 记的你看不到。
          换手机、清浏览器数据会丢，重要的记得先在设置里导出备份。
        </div>
      </div>

      <div class="cp-foot">
        <button class="btn btn--primary" data-cp="to-consent" type="button">${resume ? '重新走一遍开通' : '开始'}</button>
        ${resume ? `<button class="btn btn--ghost cp-foot-alt" data-cp="new-book" type="button">换一本新的</button>` : ''}
      </div>
    `;
  }

  function stepConsent() {
    const c = cfg();
    const agreed = !!(c.consent && c.consent.agreed && c.consent.version === CONSENT_VERSION);
    return `
      <div class="cp-onboard-top">
        <button class="cp-back" data-cp="back" type="button" aria-label="返回">${Icons.svg('chevronLeft', 18)}</button>
        <div class="cp-onboard-title">数据同步说明</div>
      </div>

      <div class="cp-scroll" id="cp-consent-scroll">
        <div class="cp-doc">
          <h3>情侣账本数据同步说明</h3>
          <p style="font-size:12.5px;line-height:1.85;color:var(--text-2);margin:0 0 14px">
            两个人共用一本账，需要一台服务器帮忙转交。下面是数据<b>真实去哪了</b>、
            怎么保护，以及你随时能收回什么。
          </p>

          <div style="font-size:12.5px;font-weight:700;color:var(--text);margin:0 0 6px">现在就是这样</div>
          <ol>
            <li><b>个人账本永远不上传</b>：个人账目、目标、预算、设置、AI Key 都只存在这台手机上。</li>
            <li><b>只有情侣这一本会同步</b>：配对之后，情侣账目（金额、分类、备注、归属）、小金库 / 约会基金 / 见面基金，以及情侣资料（昵称、在一起的日子、生日、同城异地、见面时间、TA 的时区）会加密后存到作者自己的 Cloudflare 服务器。</li>
            <li><b>服务器只存密文</b>：上传前在手机上用 AES-GCM 加密，钥匙由配对串里 128 位随机密钥派生（HKDF-SHA256）。服务器拿到的是「房间号 + 乱码 + 时间」，看不到金额、备注和名字 —— 作者登录 Cloudflare 也看不到。</li>
            <li><b>配对串就是钥匙</b>：43 个字符，谁拿到它，谁就能看这本账。<b>别发到群里</b>；丢了云端数据就解不开，建议截图存好。</li>
            <li><b>不收集别的</b>：不要手机号、不要密码，不收集位置、通讯录、设备型号。Cloudflare 作为托管方会记录普通访问日志（IP、时间）。</li>
            <li><b>随时收回</b>：「解除连接」只影响这台手机；「删除云端数据」会把云端这本账真删，不可恢复。关掉情侣账本不会删本机已有的账。</li>
            <li><b>什么时候同步</b>：打开 App 时、记完一笔后、以及在前台每 20 秒一次。没有后台推送，关掉 App 不会自己传；对方记的账，你切回来或下次打开时会立刻同步到。</li>
          </ol>

          <p style="font-size:12px;line-height:1.8;color:var(--text-3);margin:8px 0 0">
            这份说明会随功能变化更新；变化时会重新弹给你确认一次。
          </p>
          <p class="cp-doc-end">— 以上 —</p>
        </div>
      </div>

      <div class="cp-foot cp-foot--consent">
        <div class="cp-consent-hint" id="cp-consent-hint">滚动到最底部，才能勾选</div>
        <label class="cp-check" id="cp-check-wrap" for="cp-agree">
          <input type="checkbox" id="cp-agree" ${agreed ? 'checked' : ''} />
          <span class="cp-box">${Icons.svg('check', 13)}</span>
          <span class="cp-check-text">我已阅读并同意《情侣账本数据同步说明》</span>
        </label>
        <button class="btn btn--primary" id="cp-consent-ok" type="button" ${agreed ? '' : 'disabled'}>同意并继续</button>
      </div>
    `;
  }

  /**
   * 生日的显示文案。
   * 只显示「M 月 D 日」不带年份：生日是每年都过的，年份对用法没有帮助，
   * 反而在「今天是不是 TA 生日」这种判断上容易让人误以为是按年比较。
   */
  function bdText(ymd) {
    const d = U.parseYmd(ymd);
    if (!d) return '选一个日子';
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  function stepProfile() {
    const c = cfg();
    return `
      <div class="cp-onboard-top">
        <button class="cp-back" data-cp="back" type="button" aria-label="返回">${Icons.svg('chevronLeft', 18)}</button>
        <div class="cp-onboard-title">认识一下</div>
      </div>

      <div class="cp-form">
        <div class="cp-field">
          <label class="cp-label">你叫什么</label>
          <input class="cp-input" id="cp-me" type="text" maxlength="8" placeholder="例如：小懒" value="${U.escapeHtml(draft.meName || c.meName || '')}" />
          <div class="cp-err" id="cp-me-err"></div>
        </div>

        <div class="cp-field">
          <label class="cp-label">TA 叫什么</label>
          <input class="cp-input" id="cp-peer" type="text" maxlength="8" placeholder="例如：小满" value="${U.escapeHtml(draft.peerName || c.peerName || '')}" />
          <div class="cp-err" id="cp-peer-err"></div>
        </div>

        <div class="cp-field">
          <label class="cp-label">你们从哪天开始的</label>
          <button class="cp-input cp-input--btn" id="cp-since" type="button">
            ${(draft.togetherSince || c.togetherSince) ? U.escapeHtml(U.fullDate(U.parseYmd(draft.togetherSince || c.togetherSince).getTime())) : '选一个日子'}
            ${Icons.svg('calendar', 16)}
          </button>
          <div class="cp-err" id="cp-since-err"></div>
        </div>

        <!-- 生日：选填。不填也能开通，填了日历上会在那天标一行小字
             注意类名不能叫 .cp-pair —— 那是右上角「配对」按钮的类（紫色胶囊），
             同名会被它覆盖成 30px 高的一条渐变，两个输入框全挤出来（v1.18.5 的截图就是这样）。 -->
        <div class="cp-bday-pair">
          <div class="cp-field">
            <label class="cp-label">你的生日<span class="cp-label-opt">选填</span></label>
            <button class="cp-input cp-input--btn" id="cp-mybd" type="button">
              ${(draft.meBirthday || c.meBirthday) ? U.escapeHtml(bdText(draft.meBirthday || c.meBirthday)) : '选一个日子'}
              ${Icons.svg('calendar', 15)}
            </button>
          </div>
          <div class="cp-field">
            <label class="cp-label">TA 的生日<span class="cp-label-opt">选填</span></label>
            <button class="cp-input cp-input--btn" id="cp-peerbd" type="button">
              ${(draft.peerBirthday || c.peerBirthday) ? U.escapeHtml(bdText(draft.peerBirthday || c.peerBirthday)) : '选一个日子'}
              ${Icons.svg('calendar', 15)}
            </button>
          </div>
        </div>
        <div class="cp-note cp-note--center">生日可以不填，填了日历上会替你记着</div>
      </div>

      <div class="cp-foot">
        <button class="btn btn--primary" id="cp-profile-ok" type="button" disabled>继续</button>
      </div>
    `;
  }

  function stepMode() {
    const c = cfg();
    return `
      <div class="cp-onboard-top cp-onboard-top--mode">
        <div class="cp-onboard-title">你们现在是</div>
      </div>
      <div class="cp-mode-grid cp-mode-grid--fill">
        ${Object.keys(MODE).map((k) => {
          const m = MODE[k];
          const picked = c.mode === k;
          return `
            <button class="cp-mode cp-mode--fill ${picked ? 'on' : ''}" data-cp="mode" data-mode="${k}" type="button">
              <div class="cp-mode-head">
                <div class="cp-mode-name">${m.name}</div>
                <div class="cp-mode-pick">${picked ? '已选择' : '选这个'}</div>
              </div>
              <div class="cp-mode-art">${ART[k] || ''}</div>
              <ul class="cp-mode-list">
                ${m.items.map((x) => `<li>${U.escapeHtml(x)}</li>`).join('')}
              </ul>
            </button>`;
        }).join('')}
      </div>
      <div class="cp-note cp-note--center cp-mode-hint">之后随时可以切换，数据会保留</div>
    `;
  }

  function bindOnboarding(root) {
    // 步骤切换。
    // ⚠️ 用事件委托挂在容器上，而不是逐个按钮 addEventListener：
    // 模式卡里嵌了内联 SVG（.cp-mode-art），真机手指点在 SVG 上时，
    // 某些 WebView 的合成点击不会冒泡到 button 上，表现就是「点了没反应」。
    // 委托 + closest 能兜住卡片的任何一个子元素。
    const section = root.closest ? root.closest('.view') : null;
    const host = section || root;
    if (!host.__cpBound) {
      host.__cpBound = true;
      let lastAct = 0;
      let lastEl = null;
      const fire = (b) => {
        const now = Date.now();
        // 防抖只防「同一个按钮」被 pointerup + click 连发两次。
        // 以前是按时间去抖，结果真机上连点两个不同按钮（比如先点「去同意」
        // 再点别的）时第二个会被直接丢掉，表现出来就是「点了没反应」。
        if (b === lastEl && now - lastAct < 350) return;
        lastEl = b;
        lastAct = now;
        handleAct(b);
      };
      host.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('[data-cp]');
        if (b) fire(b);
      });
      // 兜底：有些真机在滚动容器里会吞掉 click，用 pointerup 补一刀
      host.addEventListener('pointerup', (e) => {
        const b = e.target.closest && e.target.closest('[data-cp]');
        if (b) fire(b);
      });
    }

    function handleAct(b) {
      try {
        handleAct2(b);
      } catch (err) {
        if (global.console) console.error('[couple] 点了没反应：', err);
        try { U.toast('这一步没走通：' + ((err && err.message) || '未知错误'), 'error'); } catch (e) {}
      }
    }

    function handleAct2(b) {
        const act = b.getAttribute('data-cp');
        // 收起态：这两个动作在收起页上也要能用，所以放在最前面
        if (act === 'unhide') { unhideCouple(root); return; }
        if (act === 'undo-close') { undoClose(root); return; }
        if (act === 'new-book') { openNewBookFlow(root); return; }
        if (act === 'books') { openBooksList(root); return; }
        if (act === 'to-consent') { step = 'consent'; render(root); return; }
        if (act === 'back') {
          if (step === 'consent') step = 'intro';
          else if (step === 'profile') step = 'consent';
          else if (step === 'mode') step = 'profile';
          render(root);
          return;
        }
        if (act === 'mode') {
          const k = b.getAttribute('data-mode');
          const c = cfg();
          const commit = () => {
            // 走到这一步说明同意 + 必填资料都齐了，正式开通。
            // 真机上任何一步抛错都不能「点了没反应」，所以整段兜住并给可见反馈。
            try {
              S.enableCouple({ mode: k });
              // 开通后把当前账本切到情侣账本，省得用户还要自己去切
              step = 'main';
              render(root);
              if (global.App) { global.App.refreshTopbar(); global.App.refresh(); }
              U.toast(`已经开通啦 · ${(MODE[k] || MODE.local).title}模式`, 'success');
            } catch (err) {
              console.error('[ViewCouple] 开通失败：', err);
              U.toast('开通没成功：' + ((err && err.message) || '未知错误'), 'error');
            }
          };
          if (c.mode && c.mode !== k) {
            UI.confirm({
              title: '切换模式？',
              desc: k === 'remote'
                ? '切到异地后「回忆小票墙」等模块会隐藏，<b>数据保留不删除</b>。确定切换吗？'
                : '切到同城后「见面倒计时」等模块会隐藏，<b>数据保留不删除</b>。确定切换吗？',
              okText: '确定切换',
            }).then((yes) => {
              if (!yes) return;
              if (c.enabled) {
                S.setSettings({ couple: { mode: k } });
                render(root);
                if (global.App) global.App.refreshTopbar();
              } else {
                commit();
              }
            });
            return;
          }
          commit();
          return;
        }
        if (act === 'resume') {
          // 资料齐全、只是开关关着：一步打开，不用重走同意（任务书 G8）
          try {
            S.enableCouple({ enabled: true });
            step = 'main';
            page = 'home';
            render(root);
            if (global.App) { global.App.refreshTopbar(); global.App.refresh(); }
            U.toast('欢迎回来 💞', 'success');
          } catch (err) {
            console.error('[ViewCouple] 重新打开失败：', err);
            U.toast('重新打开没成功：' + ((err && err.message) || '未知错误'), 'error');
          }
          return;
        }
        if (act === 'unhide') { unhideCouple(root); return; }
        if (act === 'undo-close') { undoClose(root); return; }
        if (act === 'new-book') { openNewBookFlow(root); return; }
        if (act === 'books') { openBooksList(root); return; }
    }

    // 引导里只有「同意页」「资料页」「模式选择页」需要下面这段绑定；
    // 收起 / 关掉 / 历史账本这几页绑完委托就收工。
    // 按 step 判断最稳：用元素判断很容易误伤 —— 模式页和恢复页的按钮都叫 [data-cp="mode"]，
    // 资料页上又没有协议滚动区，写成按元素找会连资料页一起挡掉。
    // resize 监听挂在 window 上，不会随重渲染销毁，所以每次渲染都要自己解掉旧的：
    // 旧闭包还抓着已经被换掉的 #cp-consent-scroll，留着既没用又占着不放。
    // 这里无条件清理（不管当前 step 是不是 consent），保证任何时刻最多只有一个。
    if (consentResizeHandler) {
      window.removeEventListener('resize', consentResizeHandler, { passive: true });
      consentResizeHandler = null;
    }
    if (step !== 'consent' && step !== 'profile' && step !== 'mode') return;

    // 协议：滚到底才解锁。手机上正文比一屏高，先藏住勾选框，
    // 滚到底了再放开，并给一个明显的提示，免得用户以为「勾选没反应」。
    const sc = root.querySelector('#cp-consent-scroll');
    const cb = root.querySelector('#cp-agree');
    const okBtn = root.querySelector('#cp-consent-ok');
    const hint = root.querySelector('#cp-consent-hint');
    const wrap = root.querySelector('#cp-check-wrap');
    if (sc && cb && okBtn) {
      const TH = 8; // 阈值放宽，免得浏览器地址栏抖动导致永远差几像素到不了底
      const atEnd = () => sc.scrollHeight - sc.scrollTop - sc.clientHeight <= TH;
      const overflow = () => sc.scrollHeight - sc.clientHeight > 4;
      let unlocked = false;
      const setUnlocked = (v) => {
        unlocked = v;
        if (cb) cb.disabled = !v;
        if (hint) {
          hint.textContent = v ? '已读完，可以勾选了' : '滚动到最底部，才能勾选';
          hint.classList.toggle('is-ok', v);
        }
        if (wrap) wrap.classList.toggle('is-locked', !v);
        if (v && sc) sc.scrollTop = sc.scrollTop; // 触发一次重绘，部分机型需要
      };
      // 没溢出（内容本来就一屏装得下）：直接解锁，不要求滚动
      setUnlocked(!overflow());
      if (overflow()) {
        sc.addEventListener('scroll', () => {
          if (!unlocked && atEnd()) setUnlocked(true);
        }, { passive: true });
        // iOS 上 scroll 事件有时会丢，resize（地址栏收起）也再算一次。
        // 上面的统一清理已经保证这里注册时 consentResizeHandler 一定是 null。
        consentResizeHandler = () => {
          // 这一路监听绑的是这一次渲染出来的节点，节点被换掉后就没用了
          if (!sc.isConnected) return;
          if (!unlocked && atEnd()) setUnlocked(true);
        };
        window.addEventListener('resize', consentResizeHandler, { passive: true });
      }
      cb.addEventListener('change', () => {
        okBtn.disabled = !cb.checked;
      });
      okBtn.addEventListener('click', () => {
        if (!cb.checked) return;
        S.setSettings({
          couple: { consent: { agreed: true, at: Date.now(), version: CONSENT_VERSION } },
        });
        step = 'profile';
        render(root);
      });
    }

    // 必填资料
    const me = root.querySelector('#cp-me');
    const peer = root.querySelector('#cp-peer');
    const sinceBtn = root.querySelector('#cp-since');
    const ok = root.querySelector('#cp-profile-ok');
    if (me && peer && ok) {
      const c = cfg();
      // 草稿优先，其次已保存的设置
      // showErrors：第一次渲染时不弹红字。用户还没开始填就被告知「给 TA 一个称呼吧」，
      // 像是被训了一顿（截图里三行红字从上到下全是「你还没填」）。只在真的动手之后才提示。
      const validate = (showErrors) => {
        const meV = (me.value || '').trim();
        const peerV = (peer.value || '').trim();
        draft.meName = meV;
        draft.peerName = peerV;
        const since = draft.togetherSince || c.togetherSince || '';
        const meErr = root.querySelector('#cp-me-err');
        const peerErr = root.querySelector('#cp-peer-err');
        const sinceErr = root.querySelector('#cp-since-err');
        if (meErr) meErr.textContent = (!showErrors || meV) ? '' : '给 TA 一个称呼吧';
        if (peerErr) peerErr.textContent = (!showErrors || peerV) ? '' : 'TA 该怎么称呼？';
        if (sinceErr) sinceErr.textContent = (!showErrors || since) ? '' : '选一个日子，之后能改';
        const good = !!meV && !!peerV && !!since;
        ok.disabled = !good;
        return { meV, peerV, good };
      };

      me.addEventListener('input', () => validate(true));
      peer.addEventListener('input', () => validate(true));
      me.addEventListener('blur', () => validate(true));
      peer.addEventListener('blur', () => validate(true));
      // 已有资料（或刚选完日期）时要立刻算一次，否则「继续」一直是灰的。
      // 但这一次不弹红字 —— 只是把按钮的可用状态算出来。
      validate(false);

      if (sinceBtn) {
        sinceBtn.addEventListener('click', () => {
          UI.datePicker({
            title: '在一起的第一天',
            value: (draft.togetherSince || c.togetherSince) ? U.parseYmd(draft.togetherSince || c.togetherSince).getTime() : Date.now(),
            max: Date.now(),
            onPick(ts) {
              const d = U.startOfDay(new Date(ts)).getTime();
              if (d > U.startOfDay(new Date()).getTime()) {
                U.toast('不能选未来的日子', 'error');
                return;
              }
              draft.togetherSince = U.ymd(new Date(d));
              sinceBtn.innerHTML = `${U.escapeHtml(U.fullDate(d))} ${Icons.svg('calendar', 16)}`;
              validate(false);
            },
          });
        });
      }

      ok.addEventListener('click', () => {
        const r = validate(true);
        if (!r.good) return;
        S.setSettings({
          couple: {
            meName: r.meV,
            peerName: r.peerV,
            togetherSince: draft.togetherSince || c.togetherSince || '',
            // 生日选填：空字符串也是有效值（用户可能就是想清掉）
            meBirthday: draft.meBirthday || c.meBirthday || '',
            peerBirthday: draft.peerBirthday || c.peerBirthday || '',
          },
        });
        step = 'mode';
        render(root);
      });

      // 生日：两个按钮走同一个日期选择器，只回填月-日（年份随便选，日历按「月-日」匹配）
      const bdBtn = (sel, key, title) => {
        const b = root.querySelector(sel);
        if (!b) return;
        b.addEventListener('click', () => {
          const cur = draft[key] || c[key] || '';
          UI.datePicker({
            title,
            value: cur ? U.parseYmd(cur).getTime() : new Date(2000, 0, 1).getTime(),
            max: Date.now(),
            onPick(ts) {
              draft[key] = U.ymd(new Date(U.startOfDay(new Date(ts)).getTime()));
              b.innerHTML = `${U.escapeHtml(bdText(draft[key]))} ${Icons.svg('calendar', 15)}`;
            },
          });
        });
      };
      bdBtn('#cp-mybd', 'meBirthday', '你是哪天生日');
      bdBtn('#cp-peerbd', 'peerBirthday', 'TA 是哪天生日');
    }
  }

  // ---- 主界面 ----
  /**
   * 情侣账单的账目（独立数据，和「记一笔」的个人账目完全分开）
   * 走 Store.cpTxIn，不碰 state.tx，也不受当前选中账本影响。
   */
  function cpTx(p) {
    if (!S.cpTxIn) return [];
    return p ? S.cpTxIn(p) : S.cpTxIn();
  }

  /** 里程碑：100 天 / 1 年 / 520 天 …，返回下一个和剩余天数 */
  const MILES = [100, 200, 300, 365, 520, 730, 1000, 1314];
  function nextMile(days) {
    const n = MILES.find((m) => m > days);
    if (!n) return null;
    return { days: n, left: n - days };
  }

  // ------------------------------------------------------------
  // TA 时区
  // 我们不知道对方在哪：不开同步就拿不到 TA 的手机时区，硬猜一个
  // 只会显示错的时间。所以这里由你手动选一次（记住在配置里），
  // 同时给一条「你所在时区 +N」的兜底说明，标清楚依据是什么。
  // ------------------------------------------------------------
  const TZ_PRESETS = [
    { off: 8, name: '中国 / 新加坡 / 马来西亚' },
    { off: 9, name: '日本 / 韩国' },
    { off: 7, name: '泰国 / 越南 / 印尼（西）' },
    { off: 6.5, name: '缅甸' },
    { off: 6, name: '孟加拉 / 哈萨克斯坦' },
    { off: 5.5, name: '印度 / 斯里兰卡' },
    { off: 5, name: '巴基斯坦' },
    { off: 4, name: '迪拜 / 阿联酋' },
    { off: 3.5, name: '伊朗' },
    { off: 3, name: '莫斯科 / 土耳其' },
    { off: 2, name: '希腊 / 南非' },
    { off: 1, name: '德国 / 法国 / 意大利' },
    { off: 0, name: '英国 / 葡萄牙' },
    { off: -1, name: '亚速尔群岛' },
    { off: -3, name: '巴西 / 阿根廷' },
    { off: -4, name: '智利 / 委内瑞拉' },
    { off: -5, name: '纽约 / 多伦多' },
    { off: -6, name: '芝加哥 / 墨西哥' },
    { off: -7, name: '丹佛 / 菲尼克斯' },
    { off: -8, name: '洛杉矶 / 温哥华' },
    { off: -9, name: '阿拉斯加' },
    { off: -10, name: '夏威夷' },
    { off: 10, name: '悉尼 / 墨尔本（夏令时）' },
    { off: 11, name: '所罗门群岛' },
    { off: 12, name: '新西兰（夏令时）' },
  ];

  function localOffHours() {
    return -new Date().getTimezoneOffset() / 60;
  }

  function tzLabel(off) {
    const sign = off >= 0 ? '+' : '−';
    const abs = Math.abs(off);
    const h = Math.floor(abs);
    const mm = Math.round((abs - h) * 60);
    return 'UTC' + sign + h + (mm ? ':' + String(mm).padStart(2, '0') : '');
  }

  function tzPresetName(off) {
    const p = TZ_PRESETS.find((x) => x.off === off);
    return p ? p.name : '';
  }

  /** 异地：TA 那边现在几点 */
  function peerClock() {
    const c = cfg();
    const tz = Number(c.tzOffset);
    if (c.tzOffset === '' || c.tzOffset == null || !isFinite(tz)) return null;
    const localOff = localOffHours();
    const d = new Date(Date.now() + (tz - localOff) * 3600000);
    const h = d.getHours();
    let mood;
    if (h >= 1 && h < 6) mood = '应该在睡觉，别吵';
    else if (h < 9) mood = '刚起床，问句早安吧';
    else if (h < 12) mood = '上午忙着呢';
    else if (h < 14) mood = '吃午饭的时间';
    else if (h < 18) mood = '下午，适合说句话';
    else if (h < 23) mood = '晚上，正好聊聊天';
    else mood = '这么晚还没睡，在等你吗';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    // 和你差几个小时：0 就是同一时区，用文案区分开
    const diff = tz - localOff;
    let rel;
    if (Math.abs(diff) < 0.01) rel = '和你同一个时区';
    else {
      const ad = Math.abs(diff);
      const txt = (ad % 1 ? ad.toFixed(1) : String(ad)) + ' 小时';
      rel = diff > 0 ? '比你快 ' + txt : '比你慢 ' + txt;
    }
    return {
      text: hh + ':' + mm,
      mood,
      hour: h,
      tz,
      rel,
      where: tzPresetName(tz),
      basis: '按你选的时区算的，不是从 TA 手机读的',
    };
  }

  /** 选 TA 的时区 */
  function openTzPicker() {
    const c = cfg();
    const localOff = localOffHours();
    const cur = c.tzOffset === '' || c.tzOffset == null ? null : Number(c.tzOffset);
    const rows = TZ_PRESETS.map((p) => {
      const on = cur != null && Math.abs(cur - p.off) < 0.01;
      const diff = p.off - localOff;
      const rel = Math.abs(diff) < 0.01 ? '和你一样' : (diff > 0 ? '快 ' + (diff % 1 ? diff.toFixed(1) : diff) + ' 小时' : '慢 ' + (Math.abs(diff) % 1 ? Math.abs(diff).toFixed(1) : Math.abs(diff)) + ' 小时');
      return `<button class="cp-tz-row ${on ? 'on' : ''}" data-tz="${p.off}" type="button">
        <span class="cp-tz-main">
          <span class="cp-tz-name">${U.escapeHtml(p.name)}</span>
          <span class="cp-tz-sub">${tzLabel(p.off)} · ${rel}</span>
        </span>
        <span class="cp-tz-check">${on ? Icons.svg('check', 14) : ''}</span>
      </button>`;
    }).join('');

    const sheet = UI.openSheet({
      title: 'TA 那边在哪个时区',
      content: `
        <div class="cp-tz-lead">
          我们没法知道 TA 在哪个时区——不开同步的话，两台手机之间什么都读不到。
          选一次，以后就一直按它算。
        </div>
        <div class="cp-tz-list">${rows}</div>
        <div class="cp-tz-foot">
          <button class="btn btn--ghost btn--sm" data-tz="local" type="button">我们就同一个时区</button>
        </div>
      `,
      onMount(body, close) {
        body.querySelector('[data-tz="local"]').addEventListener('click', () => {
          S.setCoupleConfig({ tzOffset: localOff });
          close();
          U.toast('已设为和你同一个时区', 'success');
          soundRefresh();
        });
        body.querySelectorAll('[data-tz]').forEach((btn) => {
          const v = btn.getAttribute('data-tz');
          if (v === 'local') return;
          btn.addEventListener('click', () => {
            S.setCoupleConfig({ tzOffset: Number(v) });
            close();
            U.toast('已记为 ' + tzLabel(Number(v)), 'success');
            soundRefresh();
          });
        });
      },
    });
    return sheet;
  }

  /** 改完配置后重画主界面 + 顶栏 */
  function soundRefresh() {    try {
      const root = document.querySelector('#view-couple');
      if (root && on()) {
        if (page === 'home') renderMain(root);
        else render(root);
      }
      refreshTop();
    } catch (e) {}
  }

  /**
   * 右上角同步入口的状态。
   *
   * 没配对时它必须是**一眼看得见的「配对」按钮**，而不是一颗灰点 ——
   * 用户反馈：原来那颗小刷新图标没人知道是干嘛的，配对入口等于不存在。
   * 配对之后才收成低调的状态灯：绿点已同步 / 蓝点同步中 / 黄点离线或待补。
   */
  function pairLamp() {
    const vs = global.ViewSync;
    if (vs && typeof vs.lamp === 'function') {
      try {
        const l = vs.lamp();
        if (l && l.cls) {
          return { cls: l.cls, text: l.text || '配对', title: l.title || '双人同步' };
        }
      } catch (e) { /* 落到下面兜底 */ }
    }
    const CS = global.CoupleSync;
    if (!CS || typeof CS.status !== 'function') {
      return { cls: 'off', text: '配对', title: '配对两台手机，一起记一本账' };
    }
    const s = CS.status();
    if (!s.ready) return { cls: 'off', text: '配对', title: '配对两台手机，一起记一本账' };
    if (s.state === 'syncing') return { cls: 'busy', text: '同步中', title: '正在同步…' };
    if (s.state === 'error' || s.state === 'offline') {
      return { cls: 'warn', text: s.pending ? '待补 ' + s.pending : '离线', title: '联网后会自动补上' };
    }
    // 已配对 ≠ 已同步：刚配对还没跑过第一次同步时，别写「已同步」
    if (s.pending) return { cls: 'busy', text: '待补 ' + s.pending, title: '还有 ' + s.pending + ' 条没发出去' };
    if (!s.lastSyncAt) return { cls: 'busy', text: '待同步', title: '点这里开始第一次同步' };
    return {
      cls: 'on', text: '已同步',
      title: '已同步 · ' + U.relTime(s.lastSyncAt),
    };
  }

  // ------------------------------------------------------------
  // 「TA 刚记了 N 笔」提示条
  //
  // 没有实时推送（也不打算做：轮询 20 秒够用，装第二个 App 不值），
  // 但「我离开的这会儿 TA 记了账」这件事得让人一眼看见 —— 否则回到首页
  // 跟离开时长得一模一样，用户只能自己去账单里数。
  //
  // 不用 U.toast：toast 2.2 秒就没了，而这条消息的价值恰恰是「你不在的时候」发生的，
  // 可能半分钟后才看到。做成一条细条，待在右上入口下面，点一下进账单页，进账单页就清零。
  // ------------------------------------------------------------
  function peerBarHtml() {
    // 离开一天回来可能一次多出十几笔，「刚记了 12 笔」听着别扭
    const verb = peerNew <= 3 ? '刚记了' : '新记了';
    return `<button class="cp-peernew" data-cp="peernew" type="button">
      <span class="cp-peernew-dot"></span>
      <span class="cp-peernew-txt">TA ${verb} <b>${peerNew}</b> 笔</span>
      <span class="cp-peernew-go">去看看${Icons.svg('chevronRight', 12)}</span>
    </button>`;
  }

  /** 按当前状态把条子贴上 / 摘掉。只在主页显示 —— 别的页面没有「首页概览」这层语义。 */
  function paintPeerNew() {
    const root = document.getElementById('view-couple');
    if (!root) return;
    const old = root.querySelector('.cp-peernew');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!peerNew || page !== 'home') return;
    const head = root.querySelector('.cp-main > .cp-head');
    if (!head) return;
    head.insertAdjacentHTML('afterend', peerBarHtml());
    // bindMain 是「渲染时给所有 [data-cp] 挂一次监听」，而这条是渲染之后才插进去的，
    // 挂不到那份名单上 —— 必须自己挂，否则点下去毫无反应（这是本轮踩到的坑）。
    const bar = head.nextElementSibling;
    if (bar && bar.classList.contains('cp-peernew') && !bar.__cpBound) {
      bar.__cpBound = true;
      bar.addEventListener('click', () => goBillPage(root));
    }
  }

  /** 进「我们的账单」页：提示条本身就是入口，进去就清零 */
  function goBillPage(root) {
    clearPeerNew();
    page = 'bill';
    render(root || document.getElementById('view-couple'));
    refreshTop();
  }

  /** 同步层拉到对方新记的账时调这里（见 couple:peer-tx 事件） */
  function notePeerNew(n) {
    const k = Number(n) || 0;
    if (k < 1) return;
    // 人正站在账单页：列表自己会刷新，再喊一声反而像在催
    if (page === 'bill') return;
    peerNew += k;
    paintPeerNew();
  }

  function clearPeerNew() {
    if (!peerNew) return;
    peerNew = 0;
    const old = document.querySelector('#view-couple .cp-peernew');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  // 同步层不认识界面，只抛事件；界面自己决定怎么表现。
  try {
    global.addEventListener('couple:peer-tx', (e) => {
      notePeerNew(e && e.detail ? e.detail.n : 0);
    });
  } catch (e) { /* 老浏览器没有 CustomEvent 也不影响记账 */ }

  function renderMain(root) {
    const c = cfg();
    const m = MODE[c.mode] || MODE.local;
    const remote = c.mode === 'remote';
    const days = daysTogether();
    const lamp = pairLamp();
    // 情侣账单按自然月算，和个人记账周期无关
    const p = S.monthPeriod();
    const list = cpTx(p);
    const sum = S.cpSummary ? S.cpSummary(p, list) : S.summary(p, list);
    const vault = S.coupleVault ? S.coupleVault() : null;
    const stats = S.attribStats ? S.attribStats(list) : null;
    root.innerHTML = `
      <div class="cp-main">
        <div class="cp-head">
          <div class="cp-avatars">
            <span class="cp-avatar">${U.escapeHtml((c.meName || '我').slice(0, 1))}</span>
            <span class="cp-avatar cp-avatar--peer">${U.escapeHtml((c.peerName || 'TA').slice(0, 1))}</span>
          </div>
          <div class="cp-head-main">
            <div class="cp-head-title">和 ${U.escapeHtml(c.peerName)} 的情侣账单</div>
            <div class="cp-head-sub">在一起的第 <b>${days}</b> 天 · ${m.title}模式</div>
          </div>
          <button class="cp-pair cp-pair--${lamp.cls}" data-cp="sync" type="button"
            title="${U.escapeHtml(lamp.title)}" aria-label="${U.escapeHtml(lamp.title)}">
            <span class="cp-pair-dot"></span><span class="cp-pair-txt">${U.escapeHtml(lamp.text)}</span>
          </button>
        </div>

        <!-- 情侣账单入口：这是「情侣」栏自己的账，和「记一笔」完全没关系 -->
        <div class="cp-bill-entry">
          <button class="cp-bill-entry-main" data-cp="to-bill" type="button">
            <span class="cp-bill-entry-ic">🧾</span>
            <span class="cp-bill-entry-txt">
              <span class="cp-bill-entry-title">我们的账单</span>
              <span class="cp-bill-entry-sub">${list.length
                ? `这个月 ${sum.count} 笔 · ${U.money(sum.expense)}`
                : '还没记过，点进去记第一笔'}</span>
            </span>
          </button>
          <button class="cp-bill-entry-add" data-cp="bill-add" type="button" aria-label="记一笔情侣账">
            ${Icons.svg('plus', 17)}
          </button>
        </div>

        <div class="cp-card cp-vault">
          <button class="cp-vault-head ${vault ? '' : 'cp-vault-head--off'}" data-cp="${vault ? 'vault-go' : 'vault-new'}" type="button">
            <span class="cp-vault-head-ic">💞</span>
            <span class="cp-vault-head-main">
              <span class="cp-vault-head-title">我们的小金库</span>
              <span class="cp-vault-head-sub">${vault
                ? '两个人一起往里存，看着两颗心慢慢靠近'
                : '建一个共同的金库，一起存约会基金'}</span>
            </span>
            ${vault ? `<span class="cp-vault-head-go">去存 ${Icons.svg('chevronRight', 12)}</span>` : ''}
          </button>
          ${vault ? renderVault(vault) : `
            <button class="btn btn--primary cp-vault-build" data-cp="vault-new" type="button">建一个小金库</button>`}
        </div>

        <div class="cp-stat">
          <div class="cp-stat-cell">
            <div class="cp-stat-label">本月我们的支出</div>
            <div class="cp-stat-val">${U.money(sum.expense)}</div>
          </div>
          <div class="cp-stat-cell">
            <div class="cp-stat-label">这个月记了</div>
            <div class="cp-stat-val">${sum.count} <span class="cp-stat-unit">笔</span></div>
          </div>
        </div>

        ${stats && stats.total ? renderAttribCard(stats) : ''}

        ${renderFavorCard()}

        ${remote ? renderRemoteModules(c) : renderLocalModules(c, days, sum)}

        <div class="cp-card cp-card--soft">
          <div class="cp-btn-row">
            <button class="btn btn--ghost btn--sm" data-cp="switch-mode" type="button">切换同城 / 异地</button>
            <button class="btn btn--ghost btn--sm" data-cp="off" type="button">关闭账本</button>
          </div>
          <!-- 「历史账本」故意做得不显眼：它是回头路，不是主路径。
               用户要的是「历史账本要稍微隐秘一点」，所以用极小的一行淡字，
               而不是和上面同级的胶囊按钮。 -->
          <div class="cp-hist-row">
            <button class="cp-hist-link" data-cp="books" type="button">
              ${S.cpBooks().length > 1 ? `历史账本（${S.cpBooks().length - 1}）` : '历史账本'}
            </button>
          </div>
          <div class="cp-desc cp-desc--tiny">现在只存在本机。联网同步在下一步接入。</div>
        </div>
      </div>
    `;

    bindMain(root);
  }

  /**
   * 「来自 TA 的偏爱」：双向的红包往来墙。
   *
   * 出现在两处，各管一件事：
   *   ① 情侣首页（本函数）：最近 40 天、最多 3 条，TA 给的那几条排前面，
   *      再补上我发出去的 —— 让人一眼看到「有来有回」，而不是只看到自己在收。
   *   ② 点「全部」进独立偏爱页（renderFavorPage）：全部记录，一笔一行，补记在顶部。
   * 一条都没有时不画这张卡：一块写着「还没有」的空白卡，
   * 对刚开通的情侣账本来说就是一次没必要的失望。
   */
  function renderFavorCard() {
    const f = favorRows();
    // 空态也要出卡：以前一块「还没有」的都不画，用户根本不知道这个功能存在
    // （以为「来自 TA 的偏爱」没做）。空卡本身就是一个入口 —— 一眼看到、点进去补记。
    if (!f.rows.length) {
      return `
        <button class="cp-favor cp-favor--empty" data-cp="to-favor" type="button" aria-label="来自 TA 的偏爱">
          <span class="cp-favor-head">
            <span class="cp-favor-ic">${Icons.svg('hearts', 16)}</span>
            <span class="cp-favor-title">来自 TA 的偏爱</span>
          </span>
          <span class="cp-favor-empty">
            TA 给你发的红包，都会落在这里 💗
            <i class="cp-favor-empty-go">去补一笔 / 看看 ${Icons.svg('chevronRight', 11)}</i>
          </span>
        </button>`;
    }
    // 首屏只给两条：一张卡里放三条，首页就要多滚半屏。
    // 「全部」点进去是完整清单（renderFavorHistory），所以这里省掉的不算丢。
    // 这页只装「TA 给我的」——自己发的红包在「记一笔」里记，不混进来。
    const picked = f.rows.slice(0, 2);
    const peerSum = f.sumIn;
    return `
      <button class="cp-favor" data-cp="to-favor" type="button" aria-label="来自 TA 的偏爱">
        <span class="cp-favor-head">
          <span class="cp-favor-ic">${Icons.svg('hearts', 16)}</span>
          <span class="cp-favor-title">来自 TA 的偏爱</span>
          ${peerSum ? `<span class="cp-favor-sum">${U.money(peerSum)}</span>` : ''}
        </span>
        <span class="cp-favor-rows">
          ${picked.map((r) => `
            <span class="cp-favor-row">
              <span class="cp-favor-row-ic">${Icons.svg('redPacket', 13)}</span>
              <span class="cp-favor-row-main">
                <span class="cp-favor-row-top">TA 给你的红包</span>
                <span class="cp-favor-row-sub">${U.escapeHtml(U.humanDate(r.t.ts))}${r.t.note ? ' · ' + U.escapeHtml(r.t.note) : ''}${r.net < r.t.amount ? ` · 已退 ${U.money(r.t.amount - r.net)}` : ''}</span>
              </span>
              <span class="cp-favor-amt">+${U.money(r.net, { symbol: false })}</span>
            </span>`).join('')}
        </span>
        <span class="cp-favor-foot">
          <span>TA 一共给你 ${U.money(f.fromPeer)} 💗</span>
          <span class="cp-favor-go">全部 ${Icons.svg('chevronRight', 12)}</span>
        </span>
      </button>`;
  }

  /** 爱的账单：只数次数，不算金额 */
  function renderAttribCard(stats) {
    const line = S.attribLine(stats);
    return `
      <div class="cp-card cp-attribs">
        <div class="cp-card-title">这个月</div>
        <div class="cp-attrib-nums">
          <span class="cp-attrib-cell"><i style="--ac:#4F7CFF"></i>我请了 <b>${stats.me}</b> 次</span>
          <span class="cp-attrib-cell"><i style="--ac:#7C5CFF"></i>TA 请了 <b>${stats.peer}</b> 次</span>
          <span class="cp-attrib-cell"><i style="--ac:#FF6A9B"></i>互相请 <b>${stats.mutual}</b> 次</span>
          <span class="cp-attrib-cell"><i style="--ac:#FF6A9B"></i>红包 <b>${stats.redpacket || 0}</b> 次</span>
        </div>
        <div class="cp-attrib-line">${U.escapeHtml(line)}</div>
      </div>`;
  }

  /** 同城模块 */
  function renderLocalModules(c, days, sum) {
    // 不能用 S.coupleGoals()：任务书 P1 规定「情侣账不是账本的一个分支」，
    // coupleGoals 反过来把 kind:'couple' 的目标都当成情侣的了 ——
    // 那样普通目标里那些名字带「约会」「见面」的也会被算进来。
    // 这里按 slot 认，只认这三个槽位。
    const bySlot = (k) => (S.goalBySlot ? S.goalBySlot(k) : null);
    const dateGoal = bySlot('date') || (S.coupleDateFund && S.coupleDateFund()) || null;
    const receipts = cpTx().filter((t) => t.type === 'expense').length;
    const mile = nextMile(days);
    // 小金库只在页面上出现一次（上面那张大的 .cp-vault 卡）。
    // 这里曾经还有一张同名的 .cp-mod 小卡，同一个东西说两遍，
    // 用户的原话是「重复了会让用户觉得廉价」，所以删掉了。
    return `
      <div class="cp-mods">
        <button class="cp-mod cp-mod--tap" data-cp="to-days" type="button">
          <div class="cp-mod-head"><span class="cp-mod-ic">📅</span><span class="cp-mod-name">在一起</span></div>
          <div class="cp-mod-val">${days} <span class="cp-mod-unit">天</span></div>
          <div class="cp-mod-desc">${mile ? `还有 ${mile.left} 天到第 ${mile.days} 天` : '每天都算数'}</div>
        </button>
        <div class="cp-mod">
          <div class="cp-mod-head"><span class="cp-mod-ic">🎟️</span><span class="cp-mod-name">约会基金</span></div>
          <div class="cp-mod-val">${U.money(dateGoal ? (dateGoal.saved || 0) : 0)}</div>
          <div class="cp-mod-desc">${dateGoal && dateGoal.target ? `目标 ${U.money(dateGoal.target)}` : '攒多少都行'}</div>
          <button class="link-btn" data-cp="${dateGoal ? 'date-goal-go' : 'date-goal'}" type="button">去存</button>
        </div>
        <button class="cp-mod cp-mod--tap" data-cp="to-memories" type="button">
          <div class="cp-mod-head"><span class="cp-mod-ic">🧾</span><span class="cp-mod-name">回忆小票墙</span></div>
          <div class="cp-mod-val">${receipts} <span class="cp-mod-unit">张</span></div>
          <div class="cp-mod-desc">点开看看我们都花在了哪</div>
        </button>
        <div class="cp-mod">
          <div class="cp-mod-head"><span class="cp-mod-ic">🫶</span><span class="cp-mod-name">今天想一起干嘛</span></div>
          <div class="cp-mod-val cp-mod-val--empty">等联网</div>
          <div class="cp-mod-desc">联网后两个人各选一个</div>
        </div>
      </div>`;
  }

  /**
   * 异地模块 */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * 解析 nextMeet。老数据只有 'YYYY-MM-DD'，新数据是 'YYYY-MM-DD HH:MM'。
   * 返回 { day: 当天 0 点时间戳, h, m, hasTime } —— hasTime 用来决定界面上要不要写几点。
   */
  function parseMeet(s) {
    const str = String(s || '');
    const day = U.parseYmd(str.slice(0, 10));
    if (!day) return null;
    const mt = str.match(/(\d{1,2}):(\d{2})\s*$/);
    const h = mt ? U.clamp(Number(mt[1]), 0, 23) : 14;
    const m = mt ? U.clamp(Number(mt[2]), 0, 59) : 0;
    return { day: day.getTime(), h, m, hasTime: !!mt };
  }
  function parseMeetHm(s) {
    const r = parseMeet(s);
    return r && r.hasTime ? { h: r.h, m: r.m } : null;
  }

  /** 异地模块 */
  function renderRemoteModules(c) {
    const clock = peerClock();
    const fund = S.coupleMeetFund ? S.coupleMeetFund() : null;
    // vault 不再在这里取：这块不再画小金库卡（见下面那句注释），
    // 留着这个变量只会让人以为「异地的小金库」还有第二条渲染路径。
    const meet = parseMeet(c.nextMeet);
    let left = null, meetAtText = '';
    if (meet) {
      // 用「几点几分」算，不是只看到天：明早 8 点的飞机和后天半夜 2 点的火车，
      // 剩余时间差了快一天，只显示「2 天」会把这件事抹平。
      const at = meet.day + meet.h * 3600000 + meet.m * 60000;
      const diff = at - Date.now();
      left = diff >= 0 ? Math.ceil(diff / 3600000) : 0;
      meetAtText = U.fullDate(meet.day) + (meet.hasTime ? ` ${pad2(meet.h)}:${pad2(meet.m)}` : '');
    }
    return `
      <div class="cp-mods">
        <div class="cp-mod">
          <div class="cp-mod-head"><span class="cp-mod-ic">✈️</span><span class="cp-mod-name">见面倒计时</span></div>
          ${meet == null
            ? `<div class="cp-mod-val cp-mod-val--empty">还没定</div>
               <button class="link-btn" data-cp="next-meet" type="button">挑个日子</button>`
            : `<div class="cp-mod-val">${Math.floor(left / 24)} <span class="cp-mod-unit">天</span>${left % 24 ? ` ${left % 24} <span class="cp-mod-unit">小时</span>` : ''}</div>
               <div class="cp-mod-time">${U.escapeHtml(meetAtText)}</div>
               <button class="link-btn" data-cp="next-meet" type="button">改个时间</button>`}
        </div>
        <div class="cp-mod">
          <div class="cp-mod-head"><span class="cp-mod-ic">💝</span><span class="cp-mod-name">下次见面基金</span></div>
          ${fund
            ? `<div class="cp-mod-val">${U.money(fund.saved || 0)}</div>
               <div class="cp-mod-desc">${fund.target ? `目标 ${U.money(fund.target)}` : '攒多少都行'}</div>
               <button class="link-btn" data-cp="fund-goal-go" type="button">去存</button>`
            : `<div class="cp-mod-val">¥0.00</div>
               <div class="cp-mod-desc">攒多少都行</div>
               <button class="link-btn" data-cp="fund-goal" type="button">去存</button>`}
        </div>
        <button class="cp-mod cp-mod--tap" data-cp="to-memories" type="button">
          <div class="cp-mod-head"><span class="cp-mod-ic">🧾</span><span class="cp-mod-name">回忆小票墙</span></div>
          <div class="cp-mod-val">${cpTx().filter((t) => t.type === 'expense').length} <span class="cp-mod-unit">张</span></div>
          <div class="cp-mod-desc">隔着屏幕，也攒了一堆小票</div>
        </button>
        <!-- 小金库**不**在这里再画一遍。
             上面的主体（renderMain 的 .cp-vault 大卡）同城/异地都会渲染，
             这里以前为了「异地也露个脸」又塞了一张进 .cp-mods 网格，
             结果网格把它压成半宽的一格，看起来就成了「多出来的一个小小金库选项卡」，
             而且和上面那张大卡完全重复。异地用户离不开的是「一起攒钱」这件事，
             大卡已经承担了，这里留空位给下面真正异地专属的模块。 -->
        <div class="cp-mod">
          <div class="cp-mod-head"><span class="cp-mod-ic">🌙</span><span class="cp-mod-name">TA 那边现在</span></div>
          <div class="cp-mod-val">${clock ? clock.text : '--:--'}</div>
          <div class="cp-mod-desc">${clock ? U.escapeHtml(clock.mood) : '还没设时区'}</div>
          <div class="cp-mod-desc cp-mod-desc--dim">${clock
            ? U.escapeHtml((clock.where ? clock.where.split(' / ')[0] + ' · ' : '') + tzLabel(clock.tz) + ' · ' + clock.rel)
            : '不知道该按哪个时区算'}</div>
          <button class="link-btn" data-cp="tz" type="button">${clock ? '换时区' : '选 TA 的时区'}</button>
        </div>
        <div class="cp-mod">
          <div class="cp-mod-head"><span class="cp-mod-ic">💗</span><span class="cp-mod-name">想你的时候</span></div>
          <div class="cp-mod-desc">联网后这一下会送到 TA 手机</div>
          <button class="link-btn" data-cp="miss" type="button">按一下</button>
        </div>
      </div>`;
  }

  /**
   * 情侣页分两页（主页 / 账单），顶栏标题跟着变，所以要手动刷一次。
   * 包一层 try：单元测试里 App 可能还没起来。
   */
  function refreshTop() {
    try { if (global.App && global.App.refreshTopbar) global.App.refreshTopbar(); } catch (e) { /* 忽略 */ }
  }

  /**
   * 弹层里改完账之后，立刻把情侣页当前那一屏重画一遍。
   *
   * 为什么不用 App.refresh()：它会重跑整个视图的 render()，
   * 把页面状态（此刻停在小票墙 / 哪一天 / 哪一年）一起清掉，
   * 用户点个「删掉这笔」就被踢回首页。render(root) 自己按 page 分发，
   * 重画完还停在原地。
   *
   * 为什么要传 root：弹层的 onMount 拿不到视图节点，调用方手里都有。
   */
  function refreshHere(root) {
    const host = root || document.querySelector('#view-couple');
    try {
      if (host && on()) render(host);
    } catch (e) { /* 忽略 */ }
    refreshTop();
  }

  /** 弹层里改完账之后的同月内重画：先把位置记下来，重画完放回去。
   *  调用点都是「点某一天里的某一笔」这类原地操作，跨月翻页不走这里。 */
  function refreshHereKeep(root) {
    const host = root || document.querySelector('#view-couple');
    markKeepScroll(host);
    refreshHere(host);
  }

  /**
   * 同步拉下来之后自动重画。
   *
   * 为什么必须要有：`applyRemoteOps` 只改数据、不碰 DOM，同步层也根本不知道
   * 界面长什么样。以前配对成功后，对方记的账要**手动刷新整个页面**才出现
   * （真机反馈：「不刷新无法同步」）。
   *
   * 三条约束，缺一不可：
   *   1. 合并 120ms 内的事件 —— 一次 pull 会连着 emit cptx / goal / couple 三次，别连画三遍；
   *   2. 有弹层开着就不画 —— 用户可能正在填金额，重画会把输入冲掉；关掉弹层后各入口本来也会自己刷；
   *   3. 记下滚动位置再画 —— 否则每 20 秒轮询一次就把人弹回顶部。
   */
  let softTimer = null;
  function softRefresh() {
    if (softTimer) return;
    softTimer = setTimeout(() => {
      softTimer = null;
      const root = document.getElementById('view-couple');
      if (!root) return;
      if (document.querySelector('#sheet-root .sheet')) return;
      try {
        markKeepScroll(root);
        render(root);
        refreshTop();
      } catch (e) { /* 自动刷新失败不能影响记账 */ }
    }, 120);
  }

  /**
   * 切换同城 / 异地（已开通后的独立页面）。
   *
   * 之前的写法是 `step = 'mode'; render()`，可 `step` 是引导流程的局部状态，
   * `on()` 为真时 render() 根本不看 step，行为取决于残留值——用户看到的是
   * 「被踢回引导流程，像是要重填资料」。现在它是 page 的一种，和 home/bill 平级。
   */
  function renderModePage(root) {
    const c = cfg();
    const cur = c.mode;
    root.innerHTML = `
      <div class="cp-onboard cp-onboard--fit">
        <div class="cp-onboard-top cp-onboard-top--mode">
          <button class="cp-back cp-back--bub" data-cp="mode-back" type="button" aria-label="返回">${Icons.svg('chevronLeft', 17)}</button>
          <div class="cp-onboard-title">你们现在是</div>
          <div class="cp-onboard-sub">换个模式不会丢任何数据</div>
        </div>
        <div class="cp-mode-grid cp-mode-grid--fill">
          ${Object.keys(MODE).map((k) => {
            const m = MODE[k];
            const picked = cur === k;
            return `
              <button class="cp-mode cp-mode--fill ${picked ? 'on' : ''}" data-cp="mode-page-pick" data-mode="${k}" type="button">
                <div class="cp-mode-head">
                  <div class="cp-mode-name">${m.name}</div>
                  <div class="cp-mode-pick">${picked ? '现在是这个' : '切到这个'}</div>
                </div>
                <div class="cp-mode-art">${ART[k] || ''}</div>
                <ul class="cp-mode-list">
                  ${m.items.map((x) => `<li>${U.escapeHtml(x)}</li>`).join('')}
                </ul>
              </button>`;
          }).join('')}
        </div>
        <div class="cp-note cp-note--center cp-mode-hint">之后随时可以再切回来</div>
      </div>
    `;

    const host = root.closest ? root.closest('.view') : null;
    const wrap = host || root;
    if (!wrap.__cpModeBound) {
      wrap.__cpModeBound = true;
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('[data-cp]');
        if (!b) return;
        const act = b.getAttribute('data-cp');
        if (act === 'mode-back') { page = 'home'; render(root); refreshTop(); return; }
        if (act !== 'mode-page-pick') return;
        const k = b.getAttribute('data-mode');
        const curMode = cfg().mode;
        if (k === curMode) { page = 'home'; render(root); refreshTop(); return; }
        const go = () => {
          S.setSettings({ couple: { mode: k } });
          page = 'home';
          render(root);
          refreshTop();
          U.toast(`换成${(MODE[k] || MODE.local).title}模式了`, 'success');
        };
        UI.confirm({
          title: '切换模式？',
          desc: k === 'remote'
            ? '切到异地后「回忆小票墙」等模块会隐藏，<b>数据保留不删除</b>。确定切换吗？'
            : '切到同城后「见面倒计时」等模块会隐藏，<b>数据保留不删除</b>。确定切换吗？',
          okText: '确定切换',
        }).then((yes) => { if (yes) go(); });
      });
    }
  }

  // ------------------------------------------------------------
  // 来自 TA 的偏爱（红包）
  //
  // 视觉只负责「长什么样」，数据由工程师接：一方把一笔情侣账的 catId 记成
  // Icons.RED_PACKET_ID，就在另一方这里出现一条「TA 给你的红包」。
  //
  // 为什么做成一张卡片（而不是红包分类里的一个二级列表）：
  //   红包是「被记得」的证据，不是「花了多少」的分类统计。放分类里只能查到金额，
  //   放在首页才能在打开账本的第一眼看到「今天 TA 递过来一个」。
  //   整张卡同时是入口：点一下进独立的「来自 TA 的偏爱」页看全部 + 补记，
  //   不在首页再铺一屏（以前埋在「重要日子」页底部，补记入口等于没有）。
  // ------------------------------------------------------------
  const FAVOR_WINDOW = 40; // 只回看最近 40 天的红包：再老的已经不是「偏爱」，是历史

  /** 红包类账目（只认情侣账本里、未作废的支出） */
  function favorList() {
    if (!S.cpTxIn) return [];
    const rid = (Icons && Icons.RED_PACKET_ID) || 'redpacket';
    return S.cpTxIn()
      // 退款记录（refundOf）不单独成行 —— 和账单页同一口径。
      // 它已经核销在原红包的净额里了（见 S.cpNetOf）；留着会被当成
      // 「TA 又给了你 ¥20」，52 变成 52+20，还多出一条假账单。
      .filter((t) => t && t.type === 'expense' && t.catId === rid
        && !t.refundOf && !(S.isVoid && S.isVoid(t)))
      .sort((a, b) => b.ts - a.ts);
  }

  /**
   * 这笔红包是谁发的。判据只认 `rpFrom`（'peer' = TA 发的、'me' = 我发的），
   * 和 store 的 cpFavorsIn / cpFavorsOut 同一口径。读不到 rpFrom（老数据）
   * 时退回 attrib 兜底；'both' / 'mutual' 一律返回空 ——「一起花」的钱
   * 不该说成谁送谁的。
   */
  function favorFrom(t) {
    if (!t) return '';
    if (t.rpFrom === 'peer' || t.rpFrom === 'me') return t.rpFrom;
    if (t.attrib === 'peer' || t.attrib === 'me') return t.attrib;
    return '';
  }

  /**
   * 「来自 TA 的偏爱」清单 —— 只装 TA 发给我的红包。
   *
   * 判据只认 `rpFrom`（'peer' = TA 发的），和 store 的 cpFavorsIn 同一口径。
   * 自己发的红包（rpFrom='me'）不进这页：那在「记一笔」里是支出，
   * 混进来会把「收到的偏爱」变成对账单。读不到 rpFrom（老数据）时
   * 退回 attrib 兜底，'me' / 'both' / 'mutual' 一律不算。
   */
  function favorRows() {
    const winTs = U.startOfDay(new Date()).getTime() - FAVOR_WINDOW * 86400000;
    // 金额一律走净额（S.cpNetOf）：退回去的那部分不算「TA 给你的」。
    // 以前这里用 t.amount 毛额累加，于是红包退了一半之后，首页写
    // 「TA 一共给你 ¥100」、月报和账单却只算 ¥60 —— 同一件事两个数。
    const net = (t) => (S.cpNetOf ? S.cpNetOf(t) : t.amount);
    let fromPeer = 0, lastFromPeer = null;
    const rows = [];
    favorList().forEach((t) => {
      const dir = favorFrom(t);
      if (dir !== 'peer') return; // 只收 TA 给的
      fromPeer += net(t);
      if (!lastFromPeer) lastFromPeer = t;
      if (t.ts >= winTs && rows.length < 40) rows.push({ t, isFromPeer: true, net: net(t) });
    });
    // 同一件事的两种说法要一致：合计（sumIn）跟清单是同一个窗口，
    // 否则会出现「收到 ¥9.87」底下却只有一条 ¥8.88 的账。
    let sumIn = 0;
    rows.forEach((r) => { sumIn += r.net; });
    return { rows, fromPeer, sumIn, lastFromPeer };
  }

  /**
   * 见面基金攒满时会问一句：「已攒满本次见面基金，快和 TA 见一面吧」，
   * 并让用户决定要不要重新定个目标（下一趟）。
   *
   * beforeSaved 传「刚才那次操作之前」的已存金额：只有「这一次刚好填满」
   * 才弹，否则存进去之后每笔都会再问一遍。
   * 返回 true 表示弹了确认框（调用方就不用再做别的了）。
   */
  function checkMeetFundFull(beforeSaved, goalId) {
    // 用户刚才实际存的那个基金优先 —— 可能目标设在小金库上而不是见面基金上。
    // 以前是先无条件取见面基金、取了就不再往下找，结果是「见面基金存在但没设目标、
    // 目标设在小金库上」时永远不弹窗。现在按「谁刚刚攒满」来挑：
    // 实际存的那个先看，它不满足再看见面基金。
    const just = goalId ? S.goalById(goalId) : null;
    const meet = S.coupleMeetFund ? S.coupleMeetFund() : null;
    const full = (g) => {
      if (!g) return false;
      const target = g.target || 0;
      if (target <= 0) return false;
      if (beforeSaved >= target) return false; // 之前就已经满了，不算「刚刚攒满」
      return (g.saved || 0) >= target;
    };
    let g = null;
    if (just && full(just)) g = just;
    else if (meet && full(meet)) g = meet;
    else if (just && (just.saved || 0) >= (just.target || 0) && (just.target || 0) > 0) g = just;
    if (!g) return false;
    if (g.target <= 0) return false;
    if (beforeSaved >= g.target) return false;
    if ((g.saved || 0) < g.target) return false;
    UI.confirm({
      title: '已攒满本次见面基金',
      desc: '快和 TA 见一面吧 ✈️<br>见面基金已经攒够了，接下来要做什么？',
      okText: '重新定个目标',
      cancelText: '先留着，下次再说',
    }).then((ok) => {
      if (!ok) return;
      // 重新定目标 = 把这一趟收档，开一趟新的：
      // 已攒的钱留在记录里（logs 不动），但新目标的起点从 0 算，
      // 否则刚定完就又显示「已攒满」。
      S.updateGoal(g.id, { saved: 0, target: 0 });
      U.toast('这次见面基金已归档，给它定个新目标吧', 'success');
      try { render(document.querySelector('#view-couple')); } catch (e) {}
      const g2 = S.coupleMeetFund();
      if (g2) openVaultSheet(g2, { askTarget: true });
    });
    return true;
  }

  /**
   * 三个基金都不需要「先建一个」：点进去就是一枚 0 元的口袋，
   * 钱放进去之后才叫基金。第一次点的时候顺手把口袋建出来。
   * 返回 goal（已存在就返回已有的），调用方接着 openVaultSheet 就行。
   */
  function makeFund(slot) {
    const remote = cfg().mode === 'remote';
    const name = slot === 'vault' ? '我们的小金库'
      : slot === 'date' ? '约会基金'
        : '下次见面基金';
    const exist = slot === 'vault' ? S.coupleVault()
      : slot === 'date' ? S.coupleDateFund() : S.coupleMeetFund();
    const goal = exist || S.addGoal({
      name,
      icon: slot === 'vault' ? '💞' : (remote ? '✈️' : '🎟️'),
      target: 0, color: '#FF6A9B', kind: 'couple', slot,
    });
    // 关键：刚补上 slot 的老目标要跟着刷新页面 —
    // coupleVault() 在没有 slot 的目标时会退回到「第一个目标」，
    // 页面上那块卡就还顶着「小金库」的名字和按钮，
    // 于是用户点「约会基金 · 去存」进的是小金库，之后定目标也定到了小金库头上。
    const fixed = goal && !goal.slot;
    if (fixed) {
      try { S.updateGoal(goal.id, { slot }); } catch (e) {}
      goal.slot = slot;
    }
    if (exist || fixed) {
      try {
        const host = document.querySelector('#view-couple');
        if (host) render(host);
      } catch (e) {}
    }
    return S.goalById(goal.id) || goal;
  }

  /**
   * 爱情保险箱：一个普通弹层。
   * 只碰 Store.depositGoal，和个人目标页完全无关（不动 App.go('goals')）。
   */
  function openVaultSheet(goal, opts) {
    if (!goal) return;
    const g0 = () => S.goalById(goal.id) || goal;

    let curClose = null;

    // 定目标金额：以前只能在「目标」页里改，情侣页根本没有入口
    function openTargetSheet(body) {
      const g = g0();
      // 截止日期：非必填，纯粹给个盼头 —— 有了就能算出「每月要存多少」
      let deadline = g.deadline || '';
      UI.openSheet({
        title: '给它定个目标',
        content: `
          <div class="cv-target">
            <div class="cv-target-label">想一起攒到多少</div>
            <div class="cv-target-input">
              <span class="cv-target-yen">¥</span>
              <input id="cvt-amount" type="text" inputmode="decimal" enterkeyhint="done"
                autocomplete="off"
                placeholder="0" value="${g.target ? (g.target / 100).toFixed(g.target % 100 ? 2 : 0) : ''}" />
            </div>
            <div class="cv-target-hint">定好之后，卡片上会显示「还差多少就合上」。留空或填 0 表示不设目标，只记存了多少。</div>
            <div class="cv-target-quick">
              ${[50000, 100000, 200000, 500000].map((v) => `
                <button class="cv-qk" data-qk="${v}" type="button">${U.money(v)}</button>`).join('')}
            </div>
          </div>
          <div class="cv-dl">
            <div class="cv-dl-head">
              <span class="cv-dl-label">截止日期 <b>可不填</b></span>
              <button class="cv-dl-pick" data-cvdl="pick" type="button">
                <span data-cvdl="txt">${deadline ? U.fullDate(U.parseYmd(deadline).getTime()) : '选个日子'}</span>
                ${Icons.svg('chevronRight', 13)}
              </button>
            </div>
            <div class="cv-dl-hint" data-cvdl="hint">${deadline
              ? '有了日子就能算出「每月要存多少」，存起来更有盼头'
              : '决定你们攒到哪天 —— 不填也没关系'}</div>
          </div>`,
        onMount(mb, close) {
          const inp = mb.querySelector('#cvt-amount');
          const dlTxt = mb.querySelector('[data-cvdl="txt"]');
          const dlHint = mb.querySelector('[data-cvdl="hint"]');
          mb.querySelectorAll('[data-qk]').forEach((b) => {
            b.addEventListener('click', () => {
              inp.value = (Number(b.dataset.qk) / 100).toFixed(0);
            });
          });
          const refreshHint = () => {
            const cents = U.amountToCents(inp.value);
            if (!deadline) {
              dlHint.textContent = '决定你们攒到哪天 —— 不填也没关系';
              return;
            }
            const days = Math.max(1, Math.round((U.startOfDay(new Date(deadline)) - U.startOfDay(new Date())) / 86400000));
            const perDay = cents > 0 ? cents / days : 0;
            dlHint.textContent = cents > 0
              ? `还有 ${days} 天 · 每天存 ${U.money(Math.ceil(perDay))} 就能攒到`
              : `还有 ${days} 天`;
          };
          inp.addEventListener('input', refreshHint);
          mb.querySelector('[data-cvdl="pick"]').addEventListener('click', () => {
            const today0 = U.startOfDay(new Date()).getTime();
            UI.datePicker({
              title: '攒到哪天',
              value: deadline ? U.parseYmd(deadline).getTime() : today0 + 90 * 86400000,
              min: today0 + 86400000,
              max: today0 + 3650 * 86400000,
              hideTip: true,
              onPick(ts) {
                deadline = U.ymd(new Date(ts));
                dlTxt.textContent = U.fullDate(U.startOfDay(new Date(ts)).getTime());
                refreshHint();
              },
            });
          });
          const foot = U.el('div', { class: 'sheet-foot' });
          const ok = U.el('button', { class: 'btn btn--primary', type: 'button' }, '保存目标');
          foot.appendChild(ok);
          mb.appendChild(foot);
          ok.addEventListener('click', () => {
            const cents = U.amountToCents(inp.value);
            // 关掉「定目标」这一层，再把下面的存取面板重新开一遍。
            // 以前是直接 renderBody(下面那层 body)：那层的节点早被上层盖住、
            // 关上层时一起销毁了，用户看到的是「保存了但什么都没变」。
            S.updateGoal(g.id, {
              target: cents > 0 ? cents : 0,
              deadline: cents > 0 ? deadline : '',
            });
            U.toast(cents > 0 ? `目标定成 ${U.money(cents)}` : '已取消目标金额', 'success');
            close();
            if (typeof curClose === 'function') curClose();
            UI.closeAllSheets();
            const live = S.goalById(g.id) || g;
            const host = document.querySelector('#view-couple');
            if (host) { try { render(host); } catch (e) {} }
            openVaultSheet(live);
          });
          // 定目标面板一开就聚焦金额框：同步调用（仍在用户点「目标金额」那趟手势里），
          // 数字键盘跟着出来。
          UI.focusKeyboard(inp);
        },
      });
    }

    const renderBody = (body) => {
      const g = g0();
      const prog = S.goalProgress(g);
      const pct = Math.round((prog.pct || 0) * 100);
      const logs = (g.logs || []).slice(-8).reverse();
      const rest = Math.max(0, (g.target || 0) - (g.saved || 0));
      body.innerHTML = `
        <div class="cp-vault-sheet">
          <div class="cv-hero">
            ${renderVault(g)}
          </div>

          <button class="cv-target-row" data-cv="target" type="button">
            <span class="cv-target-row-ic">🎯</span>
            <span class="cv-target-row-main">
              <span class="cv-target-row-name">目标金额</span>
              <span class="cv-target-row-sub">${g.target
                ? (rest > 0 ? `还差 ${U.money(rest)}` : '已经达到目标啦')
                : '还没定，点这里定一个'}</span>
            </span>
            <span class="cv-target-row-val">${g.target ? U.money(g.target) : '未设置'}</span>
            ${Icons.svg('chevronRight', 13)}
          </button>

          <div class="cv-form">
            <div class="cv-amount-row">
              <span class="cv-amount-cur">¥</span>
              <input id="cv-amount" class="cv-amount-input" type="text" inputmode="decimal"
                placeholder="0.00" autocomplete="off" />
            </div>
            <input id="cv-note" class="cv-note" type="text" maxlength="24" enterkeyhint="done"
              autocomplete="off" placeholder="留一句话（可不填）" />
            <div class="cv-acts">
              <button class="btn btn--primary cv-act" id="cv-in" type="button">存进去</button>
              <button class="btn btn--ghost cv-act" id="cv-out" type="button" ${g.saved > 0 ? '' : 'disabled'}>取出来</button>
            </div>
          </div>

          <div class="cv-log-title">最近的记录</div>
          ${logs.length
            ? `<div class="cv-logs">${logs.map((l) => `
                <div class="cv-log">
                  <span class="cv-log-dot ${l.amount > 0 ? 'is-in' : 'is-out'}"></span>
                  <span class="cv-log-note">${U.escapeHtml(l.note || (l.amount > 0 ? '存了一笔' : '取了一笔'))}</span>
                  <span class="cv-log-date">${l.ts ? U.humanDate(l.ts) : ''}</span>
                  <span class="cv-log-amt ${l.amount > 0 ? 'is-in' : 'is-out'}">${l.amount > 0 ? '+' : '-'}${U.money(Math.abs(l.amount))}</span>
                </div>`).join('')}</div>`
            : `<div class="cv-log-empty">还没有记录，先存第一笔吧</div>`}
          <div class="cv-foot-note">这里存的是「记一笔」，不会动你真实的银行卡余额。</div>
        </div>`;

      const amt = body.querySelector('#cv-amount');
      const note = body.querySelector('#cv-note');
      body.querySelector('[data-cv="target"]').addEventListener('click', () => openTargetSheet(body));
      const readAmt = () => {
        const cents = U.amountToCents(amt.value);
        return cents > 0 ? cents : 0;
      };
      const submit = (sign) => {
        const cents = readAmt();
        if (!cents) { U.toast('先填个金额', 'error'); amt.focus(); return; }
        const cur = g0();
        if (sign < 0 && cents > (cur.saved || 0)) { U.toast('取出来的比存的还多', 'error'); return; }
        const beforeSaved = cur.saved || 0;
        S.depositGoal(cur.id, sign * cents, note.value.trim());
        U.toast(sign > 0 ? `存进 ${U.money(cents)}` : `取出 ${U.money(cents)}`, 'success');
        // 弹层里的进度条要重画；
        // 外面的情侣首页也得跟着重画 —— 以前只重画了弹层内部，
        // 关掉弹层回到首页还停在「0% · 还没设目标」，得刷新整页才更新。
        renderBody(body);
        try {
          const host = document.querySelector('#view-couple');
          if (host) render(host);
        } catch (e) {}
        // 只在「这一次存钱刚好把目标填满」的时候问一句。已经满了再存不重复问。
        if (sign > 0 && checkMeetFundFull(beforeSaved, cur.id)) return;
      };
      body.querySelector('#cv-in').addEventListener('click', () => submit(1));
      const outBtn = body.querySelector('#cv-out');
      if (outBtn) outBtn.addEventListener('click', () => submit(-1));
      amt.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(1); });
    };

    UI.openSheet({
      title: '我们的小金库',
      content: '<div id="cv-body"></div>',
      onMount(body, close) {
        curClose = close;
        const inner = body.querySelector('#cv-body') || body;
        renderBody(inner);
        // 小金库一开就先聚焦金额框：用户打开这个弹层九成是来存钱的，
        // 数字键盘直接跟着出来，省一次点击。同步调用，仍在手势内。
        const amt0 = inner.querySelector('#cv-amount');
        if (amt0 && !(opts && opts.askTarget)) UI.focusKeyboard(amt0);
        // 攒满后选了「重新定个目标」：先是把钱归档到 0，直接接上定目标面板，
        // 不用让用户再自己去点目标那一行。
        if (opts && opts.askTarget) openTargetSheet(inner);
      },
    });
  }

  /**
   * 回忆小票墙 —— 2026-10 改造成「一张日历」。
   *
   * 为什么是一块有边的纸，而不是「平铺的网格画几根线」：
   * 日历之所以像日历，靠的是三件事 —— 一个干净的矩形边界、一条把
   * 「年月」和「日期」分开的双线、以及周末两列被压暗。撕页纸/装订孔
   * 那种造型在 390px 里要吃掉 16-24px 的宽度换一层装饰，还会和 App
   * 整体的极简气质打架，所以只取「体」，不取「饰」。
   *
   * 尺寸按 390px 屏算：卡片左右内边距 10，七列每格 (370-20-12)/7 ≈ 48.3px，
   * 高度用数字定死（不用 aspect-ratio），一周正好 40px，
   * 整块日历（含头、摘要、图例）压在 320px 出头，一屏能连简报一起看完。
   *
   * 格子里不放金额：30 个格子铺满数字，这页就变成一张催款单。
   * 分类图标最多 2 个（那天一起做了什么）+ ❤️（那天一起存了钱）+ ★（重要日子），
   * 最底下一行是「这一天是什么日子」的小字（节日 / 生日 / 第 N 天）。
   */
  // 日历锚定月份：显式 { year, mon(0-11) }，不用「相对本月的偏移」写法。
  // 旧实现 memoOffset/memoYear 两套状态混用：选年后 memoOffset 归 0，
  // 右箭头被 `memoOffset >= 0` 守卫卡死，往回翻又撞上 1970 夹逼 —— 用户点不动。
  let memoYm = (() => { const n = new Date(); return { year: n.getFullYear(), mon: n.getMonth() }; })();
  let memoDay = '';    // 选中的那一天 'YYYY-MM-DD'

  function pad2n(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 年月归一化：mon 超出 0..11 交给 Date 进/退位；下限夹到 1970-01 */
  function normYm(year, mon) {
    const d = new Date(year, mon, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    if (y < 1970) return { year: 1970, mon: 0 };
    return { year: y, mon: m };
  }

  /** 当前锚定的 { year, mon }。memoYm 永远是真实年月（normYm 保证过），
   *  翻月时用 normYm 做加减归一化，12 月→次年 1 月、1 月→上年 12 月都安全。 */
  function memoAnchor() {
    return memoYm;
  }

  /** 日历当前停在本月吗（决定「这个月还没一起记过什么」这类文案） */
  function memoIsNow() {
    const n = new Date();
    return memoYm.year === n.getFullYear() && memoYm.mon === n.getMonth();
  }

  /** 当前锚定月份第一天 0 点的时间戳 */
  function monthAnchor() {
    return new Date(memoYm.year, memoYm.mon, 1).getTime();
  }

  function memoPeriod() {
    // monthPeriod(date) 收的是 Date，不是时间戳 —— 直接喂数字它会去调 getFullYear
    const a = new Date(monthAnchor());
    return S.monthPeriod ? S.monthPeriod(a) : S.scopePeriod('month', a);
  }

  // ------------------------------------------------------------
  // 「这一天是什么日子」
  //
  // 为什么不引农历算法：算农历要一张节气/朔日表（几十 KB），而这个 App
  // 是零依赖单页，为了日历里一个 8px 的小词背上整张表不划算。
  // 所以固定公历的节日直接写月日；七夕用一张 2026-2040 的公历近似日期表，
  // 表里没有的年份就不标 —— 宁可少标一天，也不标错一天。
  // ------------------------------------------------------------
  // 固定公历的节日（都在粉色系里标，和纪念日区分开）
  const CP_FESTIVALS = [
    { md: '02-14', name: '情人节', tone: 'pink' },
    { md: '03-14', name: '白色情', tone: 'pink' },
    { md: '05-20', name: '520', tone: 'pink' },
    { md: '05-21', name: '521', tone: 'pink' },
    { md: '12-24', name: '平安夜', tone: 'pink' },
    { md: '12-25', name: '圣诞节', tone: 'pink' },
  ];
  // 七夕（农历七月初七）的公历近似日期，按年索引；缺的年份就不标
  const QIXI = {
    2026: '08-19', 2027: '08-08', 2028: '08-26', 2029: '08-16', 2030: '08-05',
    2031: '08-24', 2032: '08-12', 2033: '08-02', 2034: '08-20', 2035: '08-10',
    2036: '08-28', 2037: '08-17', 2038: '08-06', 2039: '08-25', 2040: '08-13',
  };

  /** 某个 'YYYY-MM-DD' 是第几天（在一起的第一天算第 1 天） */
  function dayIndex(k) {
    const c = cfg();
    if (!c.togetherSince) return 0;
    const s = U.parseYmd(String(c.togetherSince));
    const d = U.parseYmd(k);
    if (!s || !d) return 0;
    return Math.round((d.getTime() - s.getTime()) / 86400000) + 1;
  }

  /**
   * 这一天是什么日子。返回数组（通常 0 或 1 项，最多 2 项），
   * 每项 { key, label, tone }，label ≤ 4 个汉字（390px 下格子 46.3×43px，
   * 8px 小字连 8px padding 一行只放得下 4 个字+省略号）。
   * 顺序 = 优先级：纪念日 > 节日 > 生日。
   */
  function dayEvents(k) {
    const out = [];
    const mt = /^-?(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || ''));
    if (!mt) return out;
    const md = mt[2] + '-' + mt[3];
    const y = +mt[1];
    const n = dayIndex(k);
    const MILE_NAMES = { 100: '百日', 200: '200天', 300: '300天', 365: '一周年', 520: '520天', 730: '两周年', 1000: '千日', 1314: '1314天' };
    const PINK_MD = { '02-14': '情人节', '03-14': '白色情', '05-20': '520', '05-21': '521', '12-24': '平安夜', '12-25': '圣诞节' };
    // 优先级：在一起 > 里程碑 > 节日 > 生日（生日和节日撞同一天时两行都留）
    if (n === 1) out.push({ key: 'since', label: '在一起', tone: 'pink', day: 1 });
    else if (n > 1 && MILE_NAMES[n]) out.push({ key: 'mile', label: MILE_NAMES[n], tone: 'mile', day: n });
    if (PINK_MD[md]) out.push({ key: 'fest', label: PINK_MD[md], tone: 'pink' });
    if (QIXI[y] === md) out.push({ key: 'qixi', label: '七夕', tone: 'pink' });
    const c = cfg();
    if (c.meBirthday && String(c.meBirthday).slice(5) === md) out.push({ key: 'bday-me', label: '我的生日', tone: 'cake' });
    if (c.peerBirthday && String(c.peerBirthday).slice(5) === md) out.push({ key: 'bday-peer', label: 'TA 生日', tone: 'cake' });
    return out.slice(0, 2);
  }

  /** 日历页顶部的返回气泡 + 月份切换 + 月报胶囊 */
  function memoHeader(p) {
    const a = memoAnchor();
    const isNow = memoIsNow();
    return `
      <div class="cp-sub-top cp-sub-top--cal">
        <button class="cp-back cp-back--bub" data-cp="sub-back" type="button" aria-label="返回">${Icons.svg('chevronLeft', 17)}</button>
        <div class="cp-cal-head">
          <div class="cp-cal-switch">
            <button class="cp-cal-nav" data-cp="cal-prev" type="button" aria-label="上个月">${Icons.svg('chevronLeft', 14)}</button>
            <div class="cp-cal-title">
              <button class="cp-cal-hit" data-cp="cal-year" type="button" aria-label="选择年份">
                <span class="cp-cal-title-num">${a.year}</span><span class="cp-cal-title-unit">年</span>
              </button>
              <button class="cp-cal-hit" data-cp="cal-pick-month" type="button" aria-label="选择月份">
                <span class="cp-cal-title-num">${a.mon + 1}</span><span class="cp-cal-title-unit">月</span>
              </button>
            </div>
            <button class="cp-cal-nav ${isNow ? 'is-off' : ''}" data-cp="cal-next" type="button" aria-label="下个月">${Icons.svg('chevronRight', 14)}</button>
          </div>
        </div>
        <button class="cp-cal-report" data-cp="to-report" type="button">月报</button>
      </div>`;
  }

  /** 落到某年某月（可带具体某一天）：改锚点 → 设选中日 → 重画。
   *  选年（气泡）、选月（组合面板）两条路都走这里，行为一致。
   *  day 传 'YYYY-MM-DD' 时会把那天点亮并把简报滚到眼前；
   *  只选年月（点「xx月」的组合面板）不带 day，保持「跳到顶部」。 */
  function gotoYm(year, mon, day) {
    memoYm = normYm(year, mon);
    memoDay = day || '';
    const root = document.getElementById('view-couple');
    if (root) render(root);
    refreshTop();
    if (day) revealDayBrief();
  }

  /**
   * 把某一天的简报滚到看得见的位置。
   *
   * 为什么需要：从「年 / 月 / 日」气泡里选定一天之后，日历格里那天已经点亮，
   * 但简报在日历下方，手机上大概率在屏幕外 —— 用户看到的只是「月份跳了一下」，
   * 会以为选了哪天没生效（用户 m03602 反馈的正是这个）。
   * 只滚到「刚好能看见」：已经完整可见就不动，避免每次重渲染都跳一下。
   */
  function revealDayBrief() {
    const host = scrollHost(document.getElementById('view-couple'));
    const el = document.getElementById('cp-cal-brief');
    if (!host || !el) return;
    const go = () => {
      try {
        // 两次 rAF 之间用户可能已经翻页 / 返回，节点从文档里摘了 —— 别再拿它量位置
        if (!el.isConnected) return;
        const hr = host.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.top >= hr.top + 8 && r.bottom <= hr.bottom - 8) return;
        host.scrollTop = Math.max(0, host.scrollTop + (r.top - hr.top) - 12);
      } catch (e) { /* 滚动失败不影响选中 */ }
    };
    const raf = typeof global.requestAnimationFrame === 'function' ? global.requestAnimationFrame : null;
    if (raf) raf(() => raf(go)); // 等这一帧布局完成再量位置
    else go();
  }

  /** 选年份：点「xxxx年」弹 UI.datePicker 气泡
   *  （和建情侣账本选生日同一套交互：年→确定→月→确定），
   *  日历板上少一排占位的年份按钮，看起来更清爽。 */
  /** 选年月日：点「xxxx年xx月」弹 UI.datePicker 气泡。
   *  用户定稿的交互（m02075）：点「年」出年份气泡 → 确定 →
   *  点「月」出月份气泡 → 确定 → 日视图选「日」（今天之后灰掉），
   *  三段都走完才落到目标「那一天」。datePicker 本身就是这个两段式：
   *  日视图头部「年 / 月」分开点、各自进网格，月视图「确定」进日视图。
   *  边界：这是回看记录的日历 —— 过去全放开，未来（今天之后）灰掉。 */
  function openCalPick() {
    const a = memoAnchor();
    // 已经选中过某一天就从那天开始，否则从当前月份的 1 号开始；
    // 都取中午 12 点，避开时区 / 夏令时把日期挪到前一天。
    const sel = memoDay ? U.parseYmd(memoDay) : null;
    const base = sel && !isNaN(sel.getTime()) ? sel : new Date(a.year, a.mon, 1);
    UI.datePicker({
      // title:null：不弹「看哪个月」标题行 —— 用户反馈（m02263）直接去掉。
      title: null,
      value: base.getTime() + 12 * 3600000,
      // min:0 = 过去不限；max = 今天 24 点 = 今天之后的日子画灰点不动。
      // tip 那行两个条件都不命中，只显示「翻到哪个月就选哪一天」。
      min: 0,
      max: U.startOfDay(new Date()).getTime() + 86399999,
      onPick(ts) {
        const d = new Date(ts);
        // 这里选的是「年 → 月 → 日」三段里的具体某一天，所以要把日一起带过去：
        // 以前只传年月，memoDay 被清空，表现就是「选完确定只跳了月，没跳到那天」。
        gotoYm(d.getFullYear(), d.getMonth(), U.ymd(d));
      },
    });
  }

  // ------------------------------------------------------------
  // 选月：年 + 月联动的组合面板
  //
  // 为什么不做成「只选月份」的一条 1–12 横条：
  //   560px 的弹层里 12 格横排，每格只有 ~40px，手指点不准；
  //   而且只选月会绕远路 —— 想跳 2025 年 11 月，得先点月份选 11，
  //   发现年份不对，再点年份选 2025，开两次弹层。
  // 现在是 3×4 网格（每格 ~169×48，热区 ≥44，Apple HIG），
  // 上面再挂一条年份条：年和月在一个面板里改完，一次关闭。
  // ------------------------------------------------------------

  /** 年份条上要出现哪些年：在过的这几年 + 在一起那年 + 有账的那些年，
   *  一直排到今年。未来年不列，空数据也不报错（至少给 3 个）。 */
  function calYearList(curY, selY) {
    const set = [curY, selY];
    const c = cfg() || {};
    const since = String(c.togetherSince || '').slice(0, 4);
    if (/^\d{4}$/.test(since)) set.push(+since);
    try {
      (S.cpTxs() || []).forEach((t) => {
        const y = new Date(t.ts).getFullYear();
        if (y >= 1970 && y <= curY) set.push(y);
      });
    } catch (e) { /* 空数据不算错 */ }
    let lo = Math.max(1970, Math.min.apply(null, set));
    const hi = Math.max(curY, selY);
    const out = [];
    for (let y = lo; y <= hi; y++) out.push(y);
    if (out.length > 12) out.splice(0, out.length - 12); // 年头太多就只留最近 12 个
    if (out.indexOf(selY) < 0) out.unshift(selY);
    while (out.length < 3) out.unshift(out[0] - 1);
    return out;
  }

  /** 点「xx月」：弹「年份条 + 3×4 月份网格」的组合面板 */
  function openCalPickMonth() {
    const n = new Date();
    const curY = n.getFullYear(), curM = n.getMonth();
    const anchor = memoAnchor();
    let selY = anchor.year;
    const years = calYearList(curY, selY);

    UI.openSheet({
      title: null,
      content: `
        <div class="cp-cal-pick">
          <div class="cp-cal-pick-lab">年</div>
          <div class="cp-cal-year" id="cp-cal-years" role="group" aria-label="选择年份"></div>
          <div class="cp-cal-pick-lab">月</div>
          <div class="cp-cal-mons" id="cp-cal-mons" role="group" aria-label="选择月份"></div>
          <div class="cp-cal-pick-note">以后的月份还没到，选不了</div>
        </div>`,
      onMount(body, close) {
        const strip = body.querySelector('#cp-cal-years');
        const grid = body.querySelector('#cp-cal-mons');
        const paint = () => {
          const a = memoAnchor();
          strip.innerHTML = years.map((y) => `
            <button class="cp-cal-year-i${y === selY ? ' is-on' : ''}${y > curY ? ' is-off' : ''}"
              data-cp="cal-pick-year" data-year="${y}" type="button">${y}</button>`).join('');
          let h = '';
          for (let m = 1; m <= 12; m++) {
            // 未来月（今年之后的月份）继续用 is-off + pointer-events:none 关掉
            const off = selY > curY || (selY === curY && m - 1 > curM);
            const on = selY === a.year && m === a.mon + 1;
            h += `<button class="cp-cal-mon${on ? ' is-on' : ''}${off ? ' is-off' : ''}"
              data-cp="cal-pick-month" data-year="${selY}" data-mon="${m}" type="button"
              aria-label="${selY} 年 ${m} 月">${m}月</button>`;
          }
          grid.innerHTML = h;
        };
        paint();
        body.addEventListener('click', (e) => {
          const yb = e.target.closest && e.target.closest('[data-cp="cal-pick-year"]');
          if (yb) {
            selY = +yb.getAttribute('data-year');
            paint();
            return;
          }
          const mb = e.target.closest && e.target.closest('[data-cp="cal-pick-month"][data-mon]');
          if (!mb || mb.classList.contains('is-off')) return; // 未来月点不动
          const y = +mb.getAttribute('data-year');
          const m = +mb.getAttribute('data-mon');
          close();
          // 注意 normYm 的 mon 是 0 起（和 Date#getMonth 一致），
          // 面板里的 data-mon 是给人看的 1–12，落锚点时要减回去。
          gotoYm(y, m - 1);
        });
      },
    });
  }

  function renderMemories(root) {
    const p = memoPeriod();
    const cal = S.cpCalendar(p);
    const a = memoAnchor();
    const year = a.year, mon = a.mon;

    // 网格：周一开始，前面补空格
    const first = new Date(year, mon, 1);
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, mon + 1, 0).getDate();
    const todayK = U.ymd(new Date());

    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cp-cal-cell is-blank" aria-hidden="true"></div>');
    for (let d = 1; d <= daysInMonth; d++) {
      const k = `${year}-${pad2n(mon + 1)}-${pad2n(d)}`;
      const info = cal.days[k];
      const cats = info ? info.cats.slice(0, 2) : [];
      // 和记账时同一套图标、同一套主题色（Icons.cat 拿到的就是记账页用的对象）
      const icons = cats
        .map((id) => {
          const m = Icons.cat(id) || { icon: 'other_out', color: '#8D97AB' };
          return `<span class="cp-cal-ic" style="--mc:${m.color || '#8D97AB'}">${Icons.catIcon(m)}</span>`;
        })
        .join('');
      const heart = info && info.deposits.length ? '<span class="cp-cal-heart">❤️</span>' : '';
      const star = isMileDay(k) ? '<span class="cp-cal-star">★</span>' : '';
      const evs = dayEvents(k);
      const evHtml = evs.length
        ? `<span class="cp-cal-ev">${evs.map((e) => `<span class="cp-cal-ev-i is-${e.tone}">${U.escapeHtml(e.label)}</span>`).join('')}</span>`
        : '';
      const cls = [
        'cp-cal-cell',
        info && info.count ? 'has' : '',
        k === todayK ? 'is-today' : '',
        memoDay === k ? 'is-on' : '',
        evs.length ? 'has-ev' : '',
        ((d + lead - 1) % 7) >= 5 ? 'is-wk' : '',
        // 未来的日子还没发生，置灰点不动 —— 日历是回看用的
        k > todayK ? 'is-future' : '',
      ].filter(Boolean).join(' ');
      // 小字放不下时，屏幕阅读器仍然要能听到「这一天是什么日子」
      const aria = evs.length ? ` aria-label="${U.escapeHtml(`${d} 日，${evs.map((e) => e.label).join('、')}`)}"` : '';
      cells.push(`
        <button class="${cls}" data-calday="${k}" type="button"${aria}>
          <span class="cp-cal-num">${d}</span>
          <span class="cp-cal-marks">${icons}${heart}${star}</span>
          ${evHtml}
        </button>`);
    }

    const briefK = memoDay || (memoIsNow() && cal.days[todayK] ? todayK : '');
    const brief = briefK ? renderDayBrief(briefK) : '';

    root.innerHTML = `
      <div class="cp-sub cp-sub--cal">
        ${memoHeader(p)}
        <div class="cp-cal-board">
          <div class="cp-cal-sum">${cal.count
            ? `这个月一起记了 ${cal.count} 笔${cal.depositCount ? ` · 一起存了 ${cal.depositCount} 次` : ''}`
            : (memoIsNow() ? '这个月还没一起记过什么' : '这个月没有记录')}</div>
          <div class="cp-cal-week">
            ${['一', '二', '三', '四', '五', '六', '日'].map((w, i) => `<span class="${i >= 5 ? 'is-wk' : ''}">${w}</span>`).join('')}
          </div>
          <div class="cp-cal-grid">${cells.join('')}</div>
          <div class="cp-cal-legend">
            <span class="cp-cal-legend-i"><span class="cp-cal-heart">❤️</span>那天往基金里存过钱</span>
            <span class="cp-cal-legend-i"><span class="cp-cal-star">★</span>那天是个重要日子</span>
          </div>
        </div>
        <div class="cp-cal-brief" id="cp-cal-brief">${brief}</div>
        <div class="cp-desc cp-desc--tiny">点某一天，先看那天是什么日子，再看那天的账。</div>
      </div>`;
    bindCal(root);
  }

  /** 某天是不是里程碑日（复用重要日子那套 MILES） */
  function isMileDay(k) {
    const c = cfg();
    if (!c.togetherSince) return false;
    const start = U.parseYmd(c.togetherSince);
    if (!start) return false;
    const startK = U.ymd(start);
    const start0 = U.parseYmd(startK).getTime();
    const day0 = U.parseYmd(k).getTime();
    if (isNaN(day0)) return false;
    const n = Math.round((day0 - start0) / 86400000) + 1;
    return MILES.indexOf(n) >= 0;
  }

  /**
   * 展开某一天：那天的账 + 那天的存款 + 「补记这一天」。
   *
   * 补记只对**过去**开放（用户 m03610：今天不开，往日开放）：
   *   - 今天：要记就直接记，不需要「补」；日历里选中今天也不出现这个入口。
   *   - 未来：日子还没到，格子本身就点不动。
   * 入口按「你正在看的那一天」来，不另开一个要选日期的弹层 ——
   * 这页本来就是按天回看的，补哪天已经在眼前了。
   */
  function renderDayBrief(k) {
    // U.parseYmd 只吃 'YYYY-MM-DD' 字符串（喂时间戳会拿回 null）；
    // 而 S.cpDayTxs / cpDayDeposits 收的是时间戳，两边别搞反了。
    const d = U.parseYmd(k) || new Date();
    const dayTs = d.getTime();
    const txs = S.cpDayTxs ? S.cpDayTxs(dayTs) : [];
    const deps = S.cpDayDeposits ? S.cpDayDeposits(dayTs) : [];
    const title = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    const evs = dayEvents(k);
    // 今天 / 未来都不给补记入口（字符串 'YYYY-MM-DD' 可以直接比大小）
    const addFoot = k < U.ymd(new Date())
      ? `<div class="cp-brief-foot">
          <button class="cp-brief-add" data-cp="day-add" data-day="${k}" type="button">
            ${Icons.svg('plus', 12)} 补记这一天的账
          </button>
        </div>`
      : '';
    // 「这天是什么日子」永远排在最前面，账单在下面 —— 先看故事，再看账
    const evRow = evs.length
      ? `<div class="cp-brief-evs">${evs.map((e) => `
          <div class="cp-brief-ev">
            <span class="cp-brief-ev-ic">${Icons.svg(e.key === 'mile' || e.key === 'since' ? 'hearts' : 'heart', 13)}</span>
            <span class="cp-brief-ev-main">
              <span class="cp-brief-ev-label">这天是${U.escapeHtml(e.label)}</span>
              <span class="cp-brief-ev-sub">${e.day ? `在一起的第 ${e.day} 天` : '记下来，别忘了'}</span>
            </span>
          </div>`).join('')}</div>`
      : '';
    if (!txs.length && !deps.length) {
      return `<div class="cp-brief${evs.length ? ' has-ev' : ''}"><div class="cp-brief-title">${title}</div>
        ${evRow}
        <div class="cp-brief-empty">这天没有一起记下什么</div>${addFoot}</div>`;
    }
    const rows = txs.map((t) => {
      const m = Icons.cat(t.catId) || { name: '其他', icon: 'other_out', color: '#8D97AB' };
      return `<div class="cp-brief-row" data-cptx="${U.escapeHtml(t.id)}">
        <span class="cp-brief-ic" style="--mc:${m.color || '#8D97AB'}">${Icons.catIcon(m)}</span>
        <span class="cp-brief-main">
          <span class="cp-brief-name">${U.escapeHtml(t.note || m.name || '')}</span>
          <span class="cp-brief-cat">${U.escapeHtml(m.name || '')}</span>
        </span>
        <span class="cp-brief-amt${t.rpFrom === 'peer' ? ' is-in' : ''}">${t.rpFrom === 'peer' ? '+' : '-'}${U.money(t.amount, { symbol: false })}</span>
      </div>`;
    }).join('');
    const depRows = deps.map((l) => `
      <div class="cp-brief-row cp-brief-row--dep">
        <span class="cp-brief-ic cp-brief-ic--heart">❤️</span>
        <span class="cp-brief-main">
          <span class="cp-brief-name">我们一起存了 ${U.money(l.amount, { symbol: false })} 块</span>
          <span class="cp-brief-cat">${U.escapeHtml(l.goal.name || '')}</span>
        </span>
      </div>`).join('');
    return `<div class="cp-brief${evs.length ? ' has-ev' : ''}">
      <div class="cp-brief-title">${title}</div>
      ${evRow}
      ${rows}${depRows}
      ${addFoot}
    </div>`;
  }

  /** 日历页的绑定：翻月、点格子、去月报 */
  function bindCal(root) {
    if (root.__cpCalBound) return; // 委托挂在容器上，重渲染节点换了也不用重挂
    root.__cpCalBound = true;
    root.addEventListener('click', (e) => {
      const t = e.target;
      const day = t.closest && t.closest('[data-calday]');
      if (day && !(day.classList && day.classList.contains && day.classList.contains('is-future'))) {
        memoDay = memoDay === day.getAttribute('data-calday') ? '' : day.getAttribute('data-calday');
        renderKeep(root);   // 同月内点格子：只展开/收起那一天的简报，位置要留住
        return;
      }
      const tx = t.closest && t.closest('[data-cptx]');
      if (tx) {
        const one = S.cpTxById(tx.getAttribute('data-cptx'));
        // 点某一笔账：弹层关掉后 refreshHere 会重画整屏，位置要留住
        if (one) openBillActions(one, () => refreshHereKeep(root));
        return;
      }
      const nav = t.closest && t.closest('[data-cp]');
      if (!nav) return;
      const act = nav.getAttribute('data-cp');
      if (act === 'cal-prev') {
        // 翻月就是 memoYm 本身加减一个月，normYm 负责跨年归一化
        const a = memoAnchor();
        memoYm = normYm(a.year, a.mon - 1);
        memoDay = '';
        render(root);
        refreshTop();
      } else if (act === 'cal-next') {
        const a = memoAnchor();
        memoYm = normYm(a.year, a.mon + 1);
        memoDay = '';
        render(root);
        refreshTop();
      } else if (act === 'cal-year') {
        // 点「xxxx年」弹日期气泡（和选生日同一套交互）：
        // 年份 → 确定 → 月份 → 确定，直接跳到那一个月
        openCalPick();
      } else if (act === 'cal-pick-month') {
        // 点「xx月」弹「年份条 + 3×4 月份网格」的组合面板
        if (!nav.getAttribute('data-mon')) openCalPickMonth();
      } else if (act === 'day-add') {
        // 补记那一天：把日期带进记账弹层，存的时候落在那一天中午 12 点。
        // 只有过去的日子会渲染这个按钮（见 renderDayBrief），这里再兜一层。
        const k = nav.getAttribute('data-day');
        if (k && k < U.ymd(new Date())) {
          openBillEditor(null, () => refreshHereKeep(root), { day: k });
        }
      } else if (act === 'to-report') {
        page = 'report';
        render(root);
        refreshTop();
      } else if (act === 'sub-back') {
        page = 'home';
        const n = new Date();
        memoYm = { year: n.getFullYear(), mon: n.getMonth() };
        memoDay = '';
        render(root);
        refreshTop();
      }
    });
  }

  // ------------------------------------------------------------
  // 月报：从日历里点「月报」进来
  //
  // 设计意图（创意总监定稿）：这是「回看」，不是考核。
  //   - 不设目标、不排名、不给建议、不和上个月比较涨跌
  //   - 数字只摆事实，让人自己读出情绪
  //   - 「隐形对比」只回看、不预告：以前写「下个月换 TA 来爱你」，
  //     那会变成 KPI，异地恋尤其被这句话扎。改成「这个月你请得多一点 ❤️」
  //   - 样本太少（不到 3 次）不下任何结论
  // ------------------------------------------------------------
  function renderReport(root) {
    const p = memoPeriod();
    const list = S.cpTxsOf(S.cpActiveId ? S.cpActiveId() : '');
    const monthList = list.filter((t) => t.ts >= p.start && t.ts < p.end);
    // 情侣账本只记支出。月报里的所有金额都走「净额」口径：
    // 一笔 800 的火锅退回来 200，这里就该是 600 —— 和账单页头部一致。
    // 红包口径（m02455 用户定稿）：月报是「各自视角」的，不是共用的。
    //   rpFrom='me'   = 我发给 TA → 我的支出
    //   rpFrom='peer' = 我收到的 → 我的收入（不是「不算」，是要进收入）
    const expense = monthList.filter((t) => t.type !== 'income' && !t.refundOf && t.rpFrom !== 'peer');
    const rpIn = monthList.filter((t) => t.rpFrom === 'peer' && !t.refundOf);
    const rpInSum = rpIn.reduce((s, t) => s + S.cpNetOf(t), 0);
    const expSum = expense.reduce((s, t) => s + S.cpNetOf(t), 0);
    const refundBack = expense.reduce((s, t) => s + (t.amount - S.cpNetOf(t)), 0);
    const a = new Date(monthAnchor());

    // 我们这个月一起存了多少
    const fund = S.cpFundMonthSummary ? S.cpFundMonthSummary(p) : { rows: [], total: 0 };

    // 花在了哪：按分类汇总，取前三（净额）
    const byCat = {};
    expense.forEach((t) => {
      const id = t.catId || 'other_out';
      const net = S.cpNetOf(t);
      if (!net) return;
      if (!byCat[id]) byCat[id] = { catId: id, sum: 0, count: 0 };
      byCat[id].sum += net;
      byCat[id].count += 1;
    });
    const cats = Object.keys(byCat).map((k) => byCat[k]).sort((x, y) => y.sum - x.sum);
    const top3 = cats.slice(0, 3);
    const catMax = top3.length ? top3[0].sum : 0;

    // 这个月之最：单笔最大的一笔
    let biggest = null;
    expense.forEach((t) => {
      if (!biggest || (t.amount || 0) > (biggest.amount || 0)) biggest = t;
    });

    // 隐形对比：谁请得多。只在同城显示，且次数够才说。
    const stats = cfg().mode === 'remote' ? null : S.attribStats(monthList);
    const totalCount = stats ? (stats.me + stats.peer + stats.mutual) : 0;

    const statCards = `
      <div class="cp-rep-stats">
        <div class="cp-rep-stat">
          <div class="cp-rep-stat-label">一起花了</div>
          <div class="cp-rep-stat-val">${U.money(expSum)}</div>
        </div>
        <div class="cp-rep-stat">
          <div class="cp-rep-stat-label">一起记了</div>
          <div class="cp-rep-stat-val">${expense.length} <span>笔</span></div>
        </div>
        <div class="cp-rep-stat">
          <div class="cp-rep-stat-label">一起存了</div>
          <div class="cp-rep-stat-val">${U.money(fund.total)}</div>
        </div>
      </div>
      ${rpInSum ? `
      <div class="cp-rep-rpin">
        <span class="cp-rep-rpin-ic">🧧</span>
        <span class="cp-rep-rpin-main">这个月收到 TA 的红包</span>
        <span class="cp-rep-rpin-val">+${U.money(rpInSum)}</span>
      </div>` : ''}`;

    // 基金本月新增（只列有动静的）
    const fundRows = fund.rows.length
      ? `<div class="cp-rep-block">
          <div class="cp-rep-block-title">我们这个月攒下的</div>
          ${fund.rows.map((r) => `
            <div class="cp-rep-row">
              <span class="cp-rep-row-ic">${U.escapeHtml(r.icon || '💞')}</span>
              <span class="cp-rep-row-main">${U.escapeHtml(r.name || '一起攒的')}</span>
              <span class="cp-rep-row-val">+${U.money(r.added)}</span>
            </div>`).join('')}
        </div>`
      : '';

    const catRows = top3.length
      ? `<div class="cp-rep-block">
          <div class="cp-rep-block-title">花在了哪</div>
          ${top3.map((c) => {
            const m = Icons.cat(c.catId) || { name: '其他', icon: 'other_out', color: '#8D97AB' };
            const pct = catMax ? Math.round((c.sum / catMax) * 100) : 0;
            return `<div class="cp-rep-row">
              <span class="cp-rep-row-ic" style="--mc:${m.color || '#8D97AB'}">${Icons.svg(m.icon || 'other_out', 14)}</span>
              <span class="cp-rep-row-main">
                <span class="cp-rep-row-name">${U.escapeHtml(m.name || '')}</span>
                <span class="cp-rep-bar"><i style="width:${pct}%;--mc:${m.color || '#8D97AB'}"></i></span>
              </span>
              <span class="cp-rep-row-val">${U.money(c.sum)}</span>
            </div>`;
          }).join('')}
        </div>`
      : '';

    const biggestBlock = biggest
      ? (() => {
        const m = Icons.cat(biggest.catId) || { name: '其他', icon: 'other_out', color: '#8D97AB' };
        const d = new Date(biggest.ts);
        return `<div class="cp-rep-block">
          <div class="cp-rep-block-title">这个月之最</div>
          <div class="cp-rep-best">
            <span class="cp-rep-best-ic" style="--mc:${m.color || '#8D97AB'}">${Icons.svg(m.icon || 'other_out', 15)}</span>
            <span class="cp-rep-best-main">
              <span class="cp-rep-best-name">${U.escapeHtml(biggest.note || m.name || '一笔')}</span>
              <span class="cp-rep-best-sub">${d.getMonth() + 1} 月 ${d.getDate()} 日${biggest.attrib && biggest.attrib !== 'both' ? ' · ' : ''}${attribName(biggest.attrib)}</span>
            </span>
            <span class="cp-rep-best-val">${U.money(biggest.amount)}</span>
          </div>
        </div>`;
      })()
      : '';

    // 隐形对比 —— 只回看、不预告。
    // 少于 3 次不下结论（样本太少，说啥都是瞎猜）。
    let compareLine = '';
    if (stats && totalCount >= 3 && S.cpCompareLine) {
      const line = S.cpCompareLine(stats, monthAnchor());
      if (line) compareLine = `<div class="cp-rep-compare">${U.escapeHtml(line)}</div>`;
    }

    // 底部一句话：这个月空着的时候，也别写「继续努力」这类 KPI 话
    const footer = expense.length
      ? (expSum > 0
        ? '这些钱都花在了两个人身上。'
        : '一笔一笔，都是两个人一起过的日子。')
      : (memoIsNow() ? '这个月还没开始记。' : '这个月没有记录，也没关系。');

    const emptyState = !monthList.length && !fund.total;

    root.innerHTML = `
      <div class="cp-sub cp-sub--report">
        <div class="cp-sub-top cp-sub-top--cal">
          <button class="cp-back cp-back--bub" data-cp="rep-back" type="button" aria-label="返回">${Icons.svg('chevronLeft', 17)}</button>
          <div class="cp-cal-title">${a.getFullYear()} 年 ${a.getMonth() + 1} 月的月报</div>
        </div>
        ${emptyState ? `
          <div class="cp-rep-empty">
            <div class="cp-rep-empty-ic">🗓</div>
            <div class="cp-rep-empty-title">这个月还没有记录</div>
            <div class="cp-rep-empty-sub">一起记一笔，或者往小金库里存一块，这里就会长出一条线。</div>
          </div>` : `
          ${statCards}
          ${fundRows}
          ${catRows}
          ${biggestBlock}
          ${compareLine}
          <div class="cp-rep-foot">${U.escapeHtml(footer)}</div>
        `}
      </div>`;
    bindReport(root);
  }

  /** 归属人的中文名（键名见 store.js 的 ATTRIBS：me / peer / both / mutual / redpacket） */
  function attribName(a) {
    if (a === 'me') return '你请的';
    if (a === 'peer') return 'TA 请的';
    if (a === 'mutual') return '互相请的';
    if (a === 'both') return '一起花的';
    if (a === 'redpacket') return '红包';
    return '';
  }

  function bindReport(root) {
    if (root.__cpRepBound) return;
    root.__cpRepBound = true;
    root.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-cp="rep-back"]');
      if (!b) return;
      page = 'memories';
      render(root);
      refreshTop();
    });
  }

  /** 重要日子：在一起那天 + 已过 / 未来的里程碑 */
  function renderDays(root) {
    const c = cfg();
    const days = daysTogether();
    const startTs = c.togetherSince ? U.parseYmd(c.togetherSince).getTime() : Date.now();
    const rows = MILES.map((m) => ({
      days: m,
      ts: startTs + (m - 1) * 86400000,
      passed: days >= m,
      left: Math.max(0, m - days),
    }));
    root.innerHTML = `
      <div class="cp-sub">
        <div class="cp-sub-top">
          <button class="cp-back cp-back--bub" data-cp="sub-back" type="button" aria-label="返回">${Icons.svg('chevronLeft', 17)}</button>
          <div class="cp-sub-title">我们走过的重要日子</div>
        </div>
        <div class="cp-sub-hero cp-sub-hero--days">
          <div class="cp-sub-hero-label">在一起的第</div>
          <div class="cp-sub-hero-val">${days} <span class="cp-sub-hero-unit">天</span></div>
          <div class="cp-sub-hero-sub">${c.togetherSince ? `从 ${U.escapeHtml(U.fullDate(startTs))} 开始` : ''}</div>
        </div>
        <div class="cp-day-list">
          <div class="cp-day cp-day--start">
            <div class="cp-day-dot">💗</div>
            <div class="cp-day-main">
              <div class="cp-day-name">在一起的第 1 天</div>
              <div class="cp-day-date">${c.togetherSince ? U.escapeHtml(U.fullDate(startTs)) : ''}</div>
            </div>
            <div class="cp-day-tag">起点</div>
          </div>
          ${rows.map((r) => `
            <div class="cp-day ${r.passed ? 'is-past' : ''}">
              <div class="cp-day-dot">${r.passed ? '✅' : '⏳'}</div>
              <div class="cp-day-main">
                <div class="cp-day-name">第 ${r.days} 天</div>
                <div class="cp-day-date">${U.escapeHtml(U.fullDate(r.ts))}</div>
              </div>
              <div class="cp-day-tag">${r.passed ? '已过' : `还有 ${r.left} 天`}</div>
            </div>`).join('')}
        </div>
        <div class="cp-desc cp-desc--tiny">日子按「在一起那天」算，改资料里的日期会一起变。</div>
      </div>`;
    bindSub(root);
  }

  /**
   * 「来自 TA 的偏爱」的完整清单（独立偏爱页；不再挂在「重要日子」页底部）。
   * 首页那张卡只露出最近一条，点「全部」滑到这里，不在首页再铺一屏。
   */
  function renderFavorHistory() {
    const f = favorRows();
    // 只列 TA 给我的（favorRows 已按 rpFrom='peer' 过滤，这里用全量历史，
    // 不截 40 天 —— 三个月前收到过红包，也要能在历史里翻到）
    const all = favorList().filter((t) => favorFrom(t) === 'peer');
    const net = (t) => (S.cpNetOf ? S.cpNetOf(t) : t.amount);
    const rows = all.slice(0, 12).map((t) => {
      const n = net(t);
      return `
        <div class="cp-favor-hrow" data-cptx="${U.escapeHtml(t.id)}" role="button" tabindex="0">
          <span class="cp-favor-hrow-ic">${Icons.svg('redPacket', 14)}</span>
          <span class="cp-favor-hrow-main">
            <span class="cp-favor-hrow-top">TA 给你的${t.note ? ' · ' + U.escapeHtml(t.note) : ''}</span>
            <span class="cp-favor-hrow-sub">${U.escapeHtml(U.humanDate(t.ts))}${n < t.amount ? ' · 已退 ' + U.money(t.amount - n) : ''}</span>
          </span>
          <span class="cp-favor-hrow-amt">+${U.money(n, { symbol: false })}</span>
        </div>`;
    }).join('');
    // 没有红包时不再整张隐藏：这张卡也是手动补记的唯一入口，
    // 藏起来就等于「你没收到过，也就没法补记」。
    return `
      <div class="cp-favor-list" id="cp-favor-list">
        <div class="cp-favor-list-head">
          <span class="cp-favor-ic">${Icons.svg('hearts', 15)}</span>
          <span class="cp-favor-title">来自 TA 的偏爱</span>
          <span class="cp-favor-list-sum">${f.fromPeer ? `TA 一共给你 ${U.money(f.fromPeer)}` : '还没有'}</span>
          <button class="cp-favor-add" data-cp="favor-add" type="button" aria-label="补记一笔 TA 给我的">
            ${Icons.svg('plus', 12)} 补记
          </button>
        </div>
        ${rows || `<div class="cp-favor-empty">还没有 TA 给你的红包。TA 发的红包会自动出现在这里；也可以点「补记」手动记一笔。</div>`}
        <div class="cp-favor-list-foot">这里只记 TA 给你的；你发的红包在「记一笔情侣账」里选红包记 · 补记会同时记成 TA 的一笔红包支出</div>
      </div>`;
  }

  /**
   * 「来自 TA 的偏爱」独立页。
   *
   * 为什么从「重要日子」页底部搬出来：清单加上里程碑要滚两三屏，
   * 补记入口被埋在最后，等于没有。首页那张卡点「全部」直接进这里，
   * 补记就在第一屏。
   */
  function renderFavorPage(root) {
    root.innerHTML = `
      <div class="cp-sub cp-sub--favor">
        <div class="cp-sub-top">
          <button class="cp-back cp-back--bub" data-cp="favor-back" type="button" aria-label="返回">${Icons.svg('chevronLeft', 17)}</button>
          <div class="cp-sub-title">来自 TA 的偏爱</div>
        </div>
        <div class="cp-desc">红包是两个人之间的来回，不是一笔待还的账。</div>
        ${renderFavorHistory()}
        <div class="cp-desc cp-desc--tiny">补记只写一条账：发红包那一方的支出、收红包这一方的偏爱，是同一笔钱。</div>
      </div>`;
    bindFavor(root);
  }

  /** 偏爱页：返回 / 补记 / 点一笔看详情 */
  function bindFavor(root) {
    const host = root.closest ? root.closest('.view') : null;
    const wrap = host || root;
    if (wrap.__cpFavorBound) return;
    wrap.__cpFavorBound = true;
    wrap.addEventListener('click', (e) => {
      const back = e.target.closest && e.target.closest('[data-cp="favor-back"]');
      if (back) { page = 'home'; render(root); refreshTop(); return; }
      const add = e.target.closest && e.target.closest('[data-cp="favor-add"]');
      if (add) { openFavorAddSheet(() => refreshHere(root)); return; }
      const row = e.target.closest && e.target.closest('[data-cptx]');
      if (row) {
        const tx = S.cpTxById(row.getAttribute('data-cptx'));
        if (tx) openBillActions(tx, () => refreshHereKeep(root));
      }
    });
  }

  /**
   * 「补记一笔偏爱」。
   *
   * 为什么要有：红包是两个人之间的事，但记账的往往只有一个人。
   * TA 微信转来 52，你当时没记，过两天想补 —— 只能靠这里。
   *
   * 为什么只写一条账：同一笔钱在一本账里只能花一次。补记时把它记成
   * 发红包那一方的红包支出（归属 + rpFrom 同时写对），对方的偏爱清单
   * 和「我们花了多少」看到的是同一条记录，不会凭空多出一笔。
   */
  function openFavorAddSheet(onDone) {
    // 偏爱页只装「对方给我的」：自己发的红包走「记一笔情侣账」选红包，
    // 这里补记的每一笔都直接落在 TA 那边当红包支出 —— 不给「谁给谁」的选择，
    // 因为这页的语义就是收到的偏爱。
    let ts = Date.now();
    UI.openSheet({
      title: '补记一笔 TA 给我的',
      content: `
        <div class="cfa-add" id="cfa-add">
          <div class="cp-desc">补记一笔 TA 发给你的红包。记完后在 TA 的账本里会多一笔同额的红包支出。</div>

          <div class="cbe-amount">
            <span class="cbe-cur">¥</span>
            <input class="cbe-input" id="cfa-amount" type="text" inputmode="decimal" enterkeyhint="done"
              autocomplete="off" placeholder="0.00" />
          </div>

          <div class="cbe-label">哪一天</div>
          <button class="cbe-cat" id="cfa-date" type="button">
            <span class="cbe-cat-ic" style="background:rgba(255,106,155,.14);color:#FF6A9B">${Icons.svg('calendar', 15)}</span>
            <span class="cbe-cat-name" id="cfa-date-t">今天</span>
            ${Icons.svg('chevronRight', 14)}
          </button>

          <div class="cbe-label">备注</div>
          <input class="cbe-note" id="cfa-note" type="text" maxlength="60" enterkeyhint="done"
            autocomplete="off" placeholder="比如「生日红包」「请我喝奶茶」" />
        </div>
      `,
      onMount(body, close) {
        const input = body.querySelector('#cfa-amount');
        const dateT = body.querySelector('#cfa-date-t');
        const isToday = (t) => U.ymd(new Date(t)) === U.ymd(new Date());
        const paintDate = () => { dateT.textContent = isToday(ts) ? '今天' : U.humanDate(ts); };
        paintDate();

        body.querySelector('#cfa-date').addEventListener('click', () => {
          UI.datePicker({
            title: '哪一天',
            value: ts,
            max: Date.now(),
            onPick(v) { ts = v; paintDate(); },
          });
        });

        const foot = U.el('div', { class: 'sheet-foot' });
        const ok = U.el('button', { class: 'btn btn--primary', type: 'button' }, '记下来');
        const cancel = U.el('button', { class: 'btn btn--ghost', type: 'button' }, '取消');
        foot.appendChild(ok); foot.appendChild(cancel);
        body.appendChild(foot);
        cancel.addEventListener('click', close);

        ok.addEventListener('click', () => {
          const cents = U.amountToCents(input.value);
          if (!cents) { U.toast('先填个金额', 'error'); input.focus(); return; }
          const note = body.querySelector('#cfa-note').value.trim();
          try {
            // 恒为「TA 发给我的」：一条账同时是「TA 的红包支出」和「我收到的偏爱」
            S.cpAddFavor({ amount: cents, note: note || 'TA 给我的', ts });
          } catch (e) {
            U.toast('没记上：' + ((e && e.message) || '未知错误'), 'error');
            return;
          }
          close();
          U.toast('记下了', 'success');
          if (onDone) onDone(); else refreshHere();
        });

        // 同步 focus 唤出手机数字键盘（仍在用户点击「偏爱」那趟手势里）。
        // 旧写法是 setTimeout(350) + 合成的 .click()：既错过手势窗口，
        // click() 又完全没有作用。
        UI.focusKeyboard(input);
      },
    });
  }

  /** 子页（回忆 / 重要日子）的事件：返回 + 点小票看详情 */
  function bindSub(root) {
    const host = root.closest ? root.closest('.view') : null;
    const wrap = host || root;
    if (!wrap.__cpSubBound) {
      wrap.__cpSubBound = true;
      wrap.addEventListener('click', (e) => {
        const back = e.target.closest && e.target.closest('[data-cp="sub-back"]');
        if (back) { page = 'home'; render(root); refreshTop(); return; }
        const add = e.target.closest && e.target.closest('[data-cp="favor-add"]');
        if (add) { openFavorAddSheet(() => refreshHere(root)); return; }
        const mem = e.target.closest && e.target.closest('[data-cptx]');
        if (mem) {
          const tx = S.cpTxById(mem.getAttribute('data-cptx'));
          if (tx) openBillActions(tx, () => refreshHereKeep(root));
        }
      });
    }
  }

  function bindMain(root) {
    root.querySelectorAll('[data-cp]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.getAttribute('data-cp');
        if (act === 'switch-mode') { page = 'mode'; render(root); refreshTop(); return; }
        if (act === 'tz') { openTzPicker(); return; }
        // 「TA 刚记了 N 笔」条子本身就是进账单页的入口：看完就清零，
        // 不要让它一直杵在首页（那会变成一块永不消失的噪音）。
        if (act === 'peernew') { goBillPage(root); return; }
        if (act === 'to-bill') { goBillPage(root); return; }
        if (act === 'to-favor') { page = 'favor'; render(root); refreshTop(); return; }
        if (act === 'bill-add') { openBillEditor(null, () => render(root)); return; }
        if (act === 'date-goal-go') {
          const g = S.coupleDateFund && S.coupleDateFund();
          if (g) openVaultSheet(g); else makeFund('date');
          return;
        }
        if (act === 'fund-goal-go') {
          const g = S.coupleMeetFund && S.coupleMeetFund();
          if (g) openVaultSheet(g); else makeFund('meet');
          return;
        }
        if (act === 'vault-new' || act === 'date-goal' || act === 'fund-goal') {
          // makeFund 已经返回了目标，直接开面板 ——
          // 以前这里建完不发，按钮点下去看着什么都不发生。
          const g = makeFund(act === 'vault-new' ? 'vault' : act === 'date-goal' ? 'date' : 'meet');
          if (g) openVaultSheet(g);
          return;
        }
        if (act === 'vault-go') {
          // 小金库没有「先建一个」这一步：点进去就是一枚 0 元的口袋
          openVaultSheet(S.coupleVault() || makeFund('vault'));
          return;
        }
        if (act === 'next-meet') {
          // 「下次见面」只可能在未来：今天的 0 点起可选，过去的一律不给点。
          // 以前只给了 max 没给 min，过去的日期画成灰的却点得动，逻辑反了。
          const today0 = U.startOfDay(new Date()).getTime();
          const cur = cfg().nextMeet ? U.parseYmd(cfg().nextMeet) : null;
          // U.parseYmd 认不出来会返回 null，也要退回「今天 + 14 天」
          const curTs = cur ? cur.getTime() : today0 + 14 * 86400000;
          // 已经存过时分的，用存的那个时刻；没存过就默认下午 2 点
          const curHm = parseMeetHm(cfg().nextMeet);
          const initTs = Math.max(curTs, today0) + (curHm ? curHm.h * 3600000 + curHm.m * 60000 : 14 * 3600000);
          UI.datePicker({
            title: '下次见面是哪天',
            value: initTs,
            min: today0,
            max: U.ymd(new Date(today0 + 365 * 86400000)),
            time: true,
            hideTip: true,
            onPick(ts) {
              const d = new Date(ts);
              S.setSettings({ couple: { nextMeet: U.ymd(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) } });
              render(root);
            },
          });
          return;
        }
        if (act === 'to-memories') { page = 'memories'; render(root); refreshTop(); return; }
        if (act === 'to-days') { page = 'days'; render(root); refreshTop(); return; }
        if (act === 'miss') {
          U.toast('记下了，联网后这一下会送到 TA 手机', 'success');
          return;
        }
        if (act === 'resume') {
          // 重新打开：资料都在，只把开关拨回去，不用再走一遍同意
          const r = S.enableCouple({ enabled: true });
          if (r && r.ok === false) { U.toast('重新打开没成功', 'error'); return; }
          panel = 'home';
          page = 'home';
          step = 'main';
          render(root);
          refreshTop();
          U.toast('欢迎回来 💞', 'success');
          return;
        }
        if (act === 'share-ratio') {
          // 功能已删除（用户：「给人一种有隐瞒的感觉」）。留个空分支防止旧缓存点出异常。
          return;
        }
        if (act === 'sync') {
          if (global.ViewSync && typeof global.ViewSync.open === 'function') {
            global.ViewSync.open();
          } else {
            UI.toast('同步面板没加载，刷新一下试试', 'error');
          }
          return;
        }
        if (act === 'off') {
          openCloseFlow(root);
          return;
        }
        if (act === 'hide') {
          // 「从首页收起」已删除（用户要求）。底栏那个 is-hidden 态也不再生效。
          return;
        }
        if (act === 'undo-close') { undoClose(root); return; }
        if (act === 'new-book') { openNewBookFlow(root); return; }
        if (act === 'books') { openBooksList(root); return; }
      });
    });
  }

  // ------------------------------------------------------------
  // 关闭 / 隐藏 / 彻底删除
  //
  // 三件事必须分清楚，混在一起是最伤人的：
  //   隐藏 = 只是从首页收起来，账本还是开着的；
  //   关闭 = 关掉这本，数据一条不动，随时能反悔；
  //   删除 = 真的清干净，谁也找不回来。
  // 所以删除入口不出现在关闭流程里的任何一屏 —— 关闭是关闭，删除是另一件事。
  // ------------------------------------------------------------
  const CLOSE_REASONS = [
    { k: 'quarrel', t: '我们吵架了，想静一静' },
    { k: 'split', t: '我们分开了' },
    { k: 'pause', t: '我们现在不一起记了' },
    { k: 'newone', t: '想换一本新的' },
    { k: 'other', t: '其他' },
  ];

  /** 关掉之后那一页的副文案：只有「我们分开了」一句不一样，其余走通用那句 */
  function afterCloseDesc(reason) {
    if (reason === 'split') return '账本和里面的记录都留在手机上。不需要的话，不用管它。';
    return '它和里面的记录都还在手机上，随时可以回来。';
  }

  function closeSheet(title, html, mount) {
    return UI.openSheet({
      title,
      content: html,
      onMount: mount || function () {},
    });
  }

  /** 第 1 屏：问一句要不要关。主按钮是「再想想」。 */
  function openCloseFlow(root) {
    const s = closeSheet('', `
      <div class="cpq">
        <div class="cpq-title">要关掉这本账本吗？</div>
        <div class="cpq-desc">关上之后，这本账本和里面的记录都会留在手机上，不会删掉。以后想重新打开，随时都可以。</div>
        <div class="cpq-acts">
          <button class="btn btn--primary cpq-main" data-cq="keep" type="button">再想想</button>
          <button class="btn btn--ghost cpq-sub" data-cq="next" type="button">关闭账本</button>
        </div>
      </div>`, (body, close) => {
      body.querySelector('[data-cq="keep"]').addEventListener('click', () => close());
      body.querySelector('[data-cq="next"]').addEventListener('click', () => {
        close();
        setTimeout(() => openReasonFlow(root), 180);
      });
    });
    return s;
  }

  /** 第 2 屏：原因。可以不选。 */
  function openReasonFlow(root) {
    closeSheet('', `
      <div class="cpq">
        <div class="cpq-title">这次是因为什么？</div>
        <div class="cpq-desc">选一个就好，不选也行。你的选择只有你自己看得到。</div>
        <div class="cpq-opts">
          ${CLOSE_REASONS.map((r) => `
            <button class="cpq-opt" data-reason="${r.k}" type="button">${r.t}</button>`).join('')}
        </div>
        <div class="cpq-acts">
          <button class="btn btn--ghost cpq-skip" data-reason="" type="button">跳过</button>
        </div>
      </div>`, (body, close) => {
      body.querySelectorAll('[data-reason]').forEach((b) => {
        b.addEventListener('click', () => {
          const reason = b.dataset.reason || '';
          close();
          setTimeout(() => openConfirmClose(root, reason), 180);
        });
      });
    });
  }

  /** 第 3 屏：说清楚「数据还在、7 天内能反悔」，然后才真关 */
  function openConfirmClose(root, reason) {
    closeSheet('', `
      <div class="cpq">
        <div class="cpq-title">关掉之后</div>
        <div class="cpq-desc">账本和记录都还在这台手机上，只是先不显示了。</div>
        <div class="cpq-note">7 天内点一下就能恢复。</div>
        <div class="cpq-acts">
          <button class="btn btn--primary cpq-main" data-cq="do" type="button">关闭账本</button>
        </div>
      </div>`, (body, close) => {
      body.querySelector('[data-cq="do"]').addEventListener('click', () => {
        close();
        try {
          S.closeCouple(reason);
        } catch (e) {
          U.toast('没关成功：' + ((e && e.message) || '未知错误'), 'error');
          return;
        }
        step = 'intro';
        page = 'home';
        render(root);
        refreshTop();
        if (global.App) global.App.refresh && global.App.refresh();
        setTimeout(() => openAfterClose(root, reason), 220);
      });
    });
  }

  /**
   * 第 4 屏：收好的那一页。
   * 不跳空白页、不跳首页 —— 用户得看到「它还在」才安心。
   * 最下面那行「不再需要它了」是删除入口，故意做得很淡、不放在显眼处。
   */
  function openAfterClose(root, reason) {
    closeSheet('', `
      <div class="cpq cpq--after">
        <div class="cpq-ic">🗂</div>
        <div class="cpq-title">账本收好了。</div>
        <div class="cpq-desc">${afterCloseDesc(reason)}</div>
        <div class="cpq-acts">
          <button class="btn btn--primary cpq-main" data-cq="home" type="button">回到首页</button>
          <button class="btn btn--ghost cpq-sub" data-cq="reopen" type="button">重新打开</button>
        </div>
        <button class="cpq-del" data-cq="del" type="button">不再需要它了</button>
      </div>`, (body, close) => {
      body.querySelector('[data-cq="home"]').addEventListener('click', () => {
        close();
        if (global.App) global.App.go('detail');
      });
      body.querySelector('[data-cq="reopen"]').addEventListener('click', () => {
        close();
        undoClose(root);
      });
      body.querySelector('[data-cq="del"]').addEventListener('click', () => {
        close();
        setTimeout(() => openDeleteFlow(root), 180);
      });
    });
  }

  function undoClose(root) {
    const b = S.cpActiveBook();
    // 必须走 openCpBook：switchCpBook 只是「去看看」，会把 status 留在 closed，
    // 开关开了但账本还是关着的，用户看到的仍是那张「关掉」的页。
    if (b) {
      S.openCpBook(b.id);
    } else {
      S.enableCouple({ enabled: true });
    }
    step = 'main';
    page = 'home';
    render(root);
    refreshTop();
    if (global.App && global.App.refresh) { try { global.App.refresh(); } catch (e) {} }
    U.toast('欢迎回来 💞', 'success');
  }

  function hideCouple(root) {
    S.hideCouple();
    render(root);
    refreshTop();
    U.toast('首页不显示了，账本还开着');
  }

  function unhideCouple(root) {
    S.unhideCouple();
    step = 'main';
    page = 'home';
    render(root);
    refreshTop();
    if (global.App && global.App.refresh) { try { global.App.refresh(); } catch (e) {} }
    U.toast('放回来了 💞', 'success');
  }

  /**
   * 彻底删除：两关。
   * 第一关把后果说清楚，不安慰也不挽留；
   * 第二关要用户亲手打出「删除」两个字 —— 勾选会变成肌肉记忆，打字才会停一秒。
   */
  function openDeleteFlow(root) {
    closeSheet('', `
      <div class="cpq">
        <div class="cpq-title">彻底删除这本账本？</div>
        <div class="cpq-desc">删除后，账本、记录、小票墙、基金记录会全部从这台手机上清掉，不能恢复。</div>
        <div class="cpq-desc cpq-desc--soft">如果你想留着以后再看看，不用删——关掉它就行，它不会打扰你。</div>
        <div class="cpq-acts">
          <button class="btn btn--primary cpq-main" data-cq="keep" type="button">先不删</button>
          <button class="btn btn--danger cpq-danger" data-cq="next" type="button">删除</button>
        </div>
      </div>`, (body, close) => {
      body.querySelector('[data-cq="keep"]').addEventListener('click', () => close());
      body.querySelector('[data-cq="next"]').addEventListener('click', () => {
        close();
        setTimeout(() => openDeleteConfirm(root), 180);
      });
    });
  }

  function openDeleteConfirm(root) {
    closeSheet('', `
      <div class="cpq">
        <div class="cpq-title">删掉之前，再确认一次</div>
        <div class="cpq-desc">在框里输入「删除」两个字，就可以删掉了。</div>
        <input class="cpq-input" id="cpq-del-input" type="text" autocomplete="off"
          placeholder="删除" maxlength="8" />
        <div class="cpq-acts">
          <button class="btn btn--primary cpq-main" data-cq="do" type="button" disabled>删除</button>
        </div>
      </div>`, (body, close) => {
      const inp = body.querySelector('#cpq-del-input');
      const ok = body.querySelector('[data-cq="do"]');
      inp.addEventListener('input', () => {
        ok.disabled = inp.value.replace(/\s/g, '') !== '删除';
      });
      ok.addEventListener('click', () => {
        if (ok.disabled) return;
        close();
        let res = null;
        try {
          res = S.wipeCpBook();
        } catch (e) {
          U.toast('没删成功：' + ((e && e.message) || '未知错误'), 'error');
          return;
        }
        // 删干净之后剩下什么，就渲染什么：还有别的账本就回到那本的入口，
        // 一本都不剩就回到开通页 —— 绝不能让「上次的账本还在」又冒出来。
        step = 'intro';
        page = 'home';
        try { render(root); } catch (e) {}
        refreshTop();
        if (global.App) global.App.refresh && global.App.refresh();
        setTimeout(() => openAfterDelete(root), 220);
      });
    });
  }

  function openAfterDelete(root) {
    closeSheet('', `
      <div class="cpq cpq--after">
        <div class="cpq-title">删掉了。</div>
        <div class="cpq-desc">这本账本已经清掉了，不会再出现。</div>
        <div class="cpq-acts">
          <button class="btn btn--primary cpq-main" data-cq="home" type="button">回到首页</button>
        </div>
      </div>`, (body, close) => {
      body.querySelector('[data-cq="home"]').addEventListener('click', () => {
        close();
        if (global.App) global.App.go('detail');
      });
    });
  }

  /**
   * 换一本新的：老的那本整本收进历史，新的从零开始。
   * 首页和设置里点进去的都是「当前这一本」，历史账本要专门去列表里点 ——
   * 这样和新人记了三个月，也不会随手一点就翻出上一段的账。
   */
  function openNewBookFlow(root) {
    closeSheet('', `
      <div class="cpq">
        <div class="cpq-title">换一本新的？</div>
        <div class="cpq-desc">现在这本会整本收进「历史账本」，记录一条都不会少，也随时能翻回去看。</div>
        <div class="cpq-desc cpq-desc--soft">新的一本从空白开始，资料要重新填一遍。</div>
        <div class="cpq-acts">
          <button class="btn btn--primary cpq-main" data-cq="keep" type="button">先不了</button>
          <button class="btn btn--ghost cpq-sub" data-cq="do" type="button">换一本新的</button>
        </div>
      </div>`, (body, close) => {
      body.querySelector('[data-cq="keep"]').addEventListener('click', () => close());
      body.querySelector('[data-cq="do"]').addEventListener('click', () => {
        close();
        try {
          S.startNewCpBook({});
        } catch (e) {
          U.toast('没换成功：' + ((e && e.message) || '未知错误'), 'error');
          return;
        }
        step = 'intro';
        page = 'home';
        render(root);
        refreshTop();
        U.toast('换好了，资料重新填一下', 'success');
      });
    });
  }

  /**
   * 历史账本列表。
   *
   * 两条硬规则（用户 2026-10 明确要求）：
   *   1. **只有「关闭」过的账本才会出现在这里**，正在用的那一本永远在首页，
   *      不列进来 —— 否则「历史」两个字就没意义了。
   *   2. 每一本都能**永久删除**。关闭只保留、删除才清干净，
   *      想忘掉的人需要一个真正清空的出口。
   */
  function openBooksList(root) {
    const renderList = (body) => {
      // 每次重画都重新取一次。以前 archived 是在打开弹层时算死的，
      // 永久删除成功后列表还是那份旧快照 —— 行还在、按钮还能看，
      // 但要退出去再进来才真的消失。
      const currentId = S.cpActiveId();
      // 只列「不是当前这本」的。当前这本在用，它不属于历史。
      const archived = S.cpBooks().filter((b) => b.id !== currentId);
      const rows = archived.map((b) => {
        const list = S.cpTxsOf(b.id);
        const saved = S.coupleGoalsOf(b.id).reduce((s, g) => s + (g.saved || 0), 0);
        const last = list.reduce((m, t) => Math.max(m, t.ts || 0), 0);
        const span = list.length
          ? `${U.humanDate(Math.min.apply(null, list.map((t) => t.ts)))} 起`
          : '还没有记录';
        const closed = b.status === 'closed';
        return `
          <div class="cpb-item">
            <button class="cpb-row" data-book="${U.escapeHtml(b.id)}" type="button">
              <span class="cpb-row-main">
                <span class="cpb-row-name">${U.escapeHtml(b.peerName || '还没填名字')}${closed ? '<i class="cpb-tag">已收起</i>' : ''}</span>
                <span class="cpb-row-sub">${list.length} 笔 · 一起存了 ${U.money(saved)} · ${span}</span>
              </span>
              <span class="cpb-row-go">${Icons.svg('chevronRight', 14)}</span>
            </button>
            <button class="cpb-del" data-del="${U.escapeHtml(b.id)}" type="button">永久删除</button>
          </div>`;
      }).join('');
      const host = body.querySelector('#cpb-list');
      host.innerHTML = rows || `<div class="cpb-empty">${S.cpBooks().length > 1
        ? '当前这本在用，还没有别的历史账本'
        : '还没有历史账本'}<br/><span class="cpb-empty-sub">关掉一本账本后，它会收进这里</span></div>`;

      host.querySelectorAll('[data-book]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-book');
          try {
            // 从历史账本点进来是「重新打开」，不是「切过去看看」
            S.openCpBook(id);
          } catch (e) {
            U.toast('没打开成功：' + ((e && e.message) || '未知错误'), 'error');
            return;
          }
          step = 'main';
          page = 'home';
          try { UI.closeAllSheets(); } catch (e) {}
          render(root);
          refreshTop();
          try { App.refresh(); } catch (e) {}
          U.toast('打开了', 'success');
        });
      });

      host.querySelectorAll('[data-del]').forEach((el) => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const id = el.getAttribute('data-del');
          openWipeBook(id, root, () => {
            // 删完要把列表重画。但如果刚才删的是最后一本历史账本，
            // 底下那层 #cpb-list 已经随着第二关关闭被一并拆掉了 ——
            // 这时直接 renderList(body) 等于在画一块已经不在文档里的节点，
            // 用户看到的就是「弹层凭空消失、什么都没说」。
            // 所以先看那层还在不在：不在就重新开一遍历史账本。
            const alive = body && body.isConnected && body.querySelector('#cpb-list');
            if (alive) {
              renderList(body);
            } else {
              // 上一层关掉之后再重开，等它拆完再开，避免两层叠一起
              setTimeout(() => openBooksList(root), 340);
            }
            // 首页那句「历史账本（N）」的数字也要跟着变，否则还停在删之前。
            // 这里只改那一个数字，不整页重画 —— 删东西的时候背后闪一下很难看。
            try {
              const n = S.cpBooks().filter((b) => b.id !== S.cpActiveId()).length;
              const link = root && root.querySelector('.cp-hist-link');
              if (link) {
                const label = n > 0 ? `历史账本（${n}）` : '历史账本';
                if (link.textContent.trim() !== label) link.textContent = label;
              }
            } catch (e) { /* 忽略 */ }
          });
        });
      });
    };

    closeSheet('历史账本', `
      <div class="cpb">
        <div class="cpb-lead">关掉的账本都收在这里，点哪本重新打开哪本。</div>
        <div class="cpb-list" id="cpb-list"></div>
        <div class="cpb-foot">
          <button class="btn btn--ghost cpb-new" data-cq="newbook" type="button">再开一本新的</button>
        </div>
      </div>`, (body, close) => {
      renderList(body);
      body.querySelector('[data-cq="newbook"]').addEventListener('click', () => {
        close();
        setTimeout(() => openNewBookFlow(root), 180);
      });
    });
  }

  /**
   * 永久删除某一本。两关：
   *   第一关讲清后果，主按钮是「先不删」；
   *   第二关要照着输入「删除」两个字才放行 ——
   *   勾选框会变成肌肉记忆，输入才能迫使人清醒一秒钟。
   */
  function openWipeBook(id, root, onDone) {
    const book = S.cpBookById(id);
    if (!book) return;
    const list = S.cpTxsOf(id);
    const saved = S.coupleGoalsOf(id).reduce((s, g) => s + (g.saved || 0), 0);
    closeSheet('', `
      <div class="cpq">
        <div class="cpq-ic">🗑</div>
        <div class="cpq-title">彻底删除这一本？</div>
        <div class="cpq-desc">
          删除后，${U.escapeHtml(book.peerName || '这本账本')}${list.length ? ` 的 ${list.length} 笔记录` : ''}${saved ? `、一起存下的 ${U.money(saved)}` : ''}和基金流水，
          都会从这台手机上清掉，不能恢复。
        </div>
        <div class="cpq-desc cpq-desc--soft">如果你想留着以后再看看，不用删 —— 关掉它就行，它不会打扰你。</div>
        <div class="cpq-acts">
          <button class="btn btn--primary cpq-main" data-cq="keep" type="button">先不删</button>
          <button class="btn btn--danger cpq-sub" data-cq="next" type="button">删除</button>
        </div>
      </div>`, (body, close) => {
      body.querySelector('[data-cq="keep"]').addEventListener('click', () => close());
      body.querySelector('[data-cq="next"]').addEventListener('click', () => {
        close();
        setTimeout(() => openWipeConfirm(id, root, onDone), 180);
      });
    });
  }

  /** 第二关：输入「删除」两个字 */
  function openWipeConfirm(id, root, onDone) {
    closeSheet('', `
      <div class="cpq">
        <div class="cpq-title">在框里输入「删除」两个字，就可以删掉了。</div>
        <div class="cpq-desc cpq-desc--soft">删掉之后找不回来。</div>
        <input class="cpq-input" id="cpq-del-input" type="text" placeholder="删除" autocomplete="off" />
        <div class="cpq-acts">
          <button class="btn btn--primary cpq-main" data-cq="keep" type="button">先不删</button>
          <button class="btn btn--danger cpq-sub" id="cpq-del-go" data-cq="do" type="button" disabled>删掉</button>
        </div>
      </div>`, (body, close) => {
      const inp = body.querySelector('#cpq-del-input');
      const go = body.querySelector('#cpq-del-go');
      inp.addEventListener('input', () => {
        go.disabled = String(inp.value || '').trim() !== '删除';
      });
      body.querySelector('[data-cq="keep"]').addEventListener('click', () => close());
      go.addEventListener('click', () => {
        if (go.disabled) return;
        try {
          S.wipeCpBook(id);
        } catch (e) {
          U.toast('没删成功：' + ((e && e.message) || '未知错误'), 'error');
          return;
        }
        close();
        U.toast('删掉了。', 'success');
        if (typeof onDone === 'function') onDone();
        step = 'intro';
        page = 'home';
        render(root);
        refreshTop();
        try { App.refresh(); } catch (e) {}
      });
    });
  }

  // ------------------------------------------------------------
  // 情侣账单（独立页面，只属于「情侣」栏）
  //
  // 这里是「我们」的账，跟「记一笔」里的个人账目完全没有关系：
  // 数据存在 Store.cpTxs 里，不进任何账本，也不会出现在明细/总结里。
  // ------------------------------------------------------------
  /** 账单页当前停留的月份 */
  function billMonth() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + billState.offset, 1);
  }

  function billPeriod() {
    return S.monthPeriod(billMonth());
  }

  function renderBill(root) {
    const p = billPeriod();
    // 情侣账本只记支出：本页没有「收入」筛选，也不用 type 过滤。
    // 退款记录不单独成行 —— 它已经核销在对应的原支出上了（见 S.cpSummary）。
    const list = cpTx(p).filter((t) => !t.refundOf);
    const sum = S.cpSummary ? S.cpSummary(p, cpTx(p)) : { expense: 0, count: 0, byCat: [] };
    // 收到的红包（TA 发给我的）：我的收入，不进「我们一共花了」，单独一行亮出来
    const rpInSum = list
      .filter((t) => t.rpFrom === 'peer')
      .reduce((s, t) => s + S.cpNetOf(t), 0);
    const stats = S.attribStats ? S.attribStats(list) : null;
    const c = cfg();
    const isCur = billState.offset === 0;

    root.innerHTML = `
      <div class="cp-bill">
        <div class="cp-bill-bar">
          <button class="cp-back cp-back--bub" data-cp="bill-home" type="button" aria-label="返回">${Icons.svg('chevronLeft', 17)}</button>
          <span class="cp-bill-spacer"></span>
          <button class="cp-bill-nav" data-cp="bill-prev" type="button" aria-label="上个月">${Icons.svg('chevronLeft', 16)}</button>
          <button class="cp-bill-month" data-cp="bill-pick" type="button">
            ${U.escapeHtml(p.label)}${isCur ? '<span class="cp-bill-now">本月</span>' : ''}
          </button>
          <button class="cp-bill-nav" data-cp="bill-next" type="button" aria-label="下个月"
            ${isCur ? 'disabled' : ''}>${Icons.svg('chevronRight', 16)}</button>
        </div>

        <div class="cp-bill-hero">
          <div class="cp-bill-hero-label">我们一共花了</div>
          <div class="cp-bill-hero-val">${U.money(sum.expense)}</div>
          <div class="cp-bill-hero-sub">
            记了 <b>${sum.count}</b> 笔${sum.refundTotal ? ` · 退回来 ${U.money(sum.refundTotal)}，已经减掉了` : ''}
          </div>
          ${rpInSum ? `
          <div class="cp-bill-rpin">
            <span>🧧 收到 TA 的红包</span>
            <b>+${U.money(rpInSum)}</b>
          </div>` : ''}
        </div>

        ${stats && stats.total ? `
          <div class="cp-card cp-attribs">
            <div class="cp-card-head">
              <div class="cp-card-title">爱的账单</div>
              <span class="cp-attrib-say">${U.escapeHtml(S.attribLine(stats))}</span>
            </div>
            <div class="cp-attrib-nums">
              <span class="cp-attrib-cell"><i style="--ac:#4F7CFF"></i>我请了 <b>${stats.me}</b> 次</span>
              <span class="cp-attrib-cell"><i style="--ac:#7C5CFF"></i>TA 请了 <b>${stats.peer}</b> 次</span>
              <span class="cp-attrib-cell"><i style="--ac:#FF6A9B"></i>互相请 <b>${stats.mutual}</b> 次</span>
              <span class="cp-attrib-cell"><i style="--ac:#FF6A9B"></i>红包 <b>${stats.redpacket || 0}</b> 次</span>
            </div>
          </div>` : ''}

        ${list.length ? renderBillList(list) : `
          <div class="empty">
            <div class="empty-emoji">💞</div>
            <div class="empty-title">${isCur ? '这个月还没记' : '这个月没有账目'}</div>
            <div class="empty-sub">${isCur ? '点下面的按钮，记一笔你们一起花的钱' : ''}</div>
          </div>`}

        <div class="cp-bill-foot">
          <button class="btn btn--primary" data-cp="bill-add" type="button">
            ${Icons.svg('plus', 17)} 记一笔情侣账
          </button>
        </div>
      </div>`;

    bindBill(root);

    // 和 XX 的情侣账单 这一页的说明文案
    if (c && c.peerName && root.querySelector('.cp-bill-hero-label')) {
      root.querySelector('.cp-bill-hero-label').setAttribute('title', `和 ${c.peerName} 一起花的`);
    }
  }

  /** 按天分组的账目列表 */
  function renderBillList(list) {
    const groups = [];
    list.forEach((t) => {
      const day = U.ymd(new Date(t.ts));
      let g = groups[groups.length - 1];
      if (!g || g.day !== day) { g = { day, ts: t.ts, items: [] }; groups.push(g); }
      g.items.push(t);
    });
    return `<div class="cp-bill-list">
      ${groups.map((g) => `
        <div class="cp-bill-day">
          <div class="cp-bill-day-head">
            <span>${U.escapeHtml(U.humanDate(g.ts))}</span>
            <span class="cp-bill-day-sum">${U.money(g.items.reduce((s, t) => s + (t.rpFrom === 'peer' ? 0 : S.cpNetOf(t)), 0))}</span>
          </div>
          ${g.items.map(billRow).join('')}
        </div>`).join('')}
    </div>`;
  }

  function billRow(t) {
    const c = Icons.cat(t.catId);
    const at = S.attrib(t.attrib);
    const net = S.cpNetOf(t);
    const back = t.amount - net;
    // 红包是「一条记录、两边视角」：rpFrom='peer' = TA 发给我的，
    // 在我的账单里这不是我花的钱，是收到的偏爱 —— 显示 +520（收入色），
    // 归属印记也换成「TA 发的」，不然看到 -520 会以为自己也出了这笔。
    const fromPeer = t.rpFrom === 'peer';
    const amtCls = fromPeer ? 'in' : 'out';
    const amtSign = fromPeer ? '+' : '-';
    const attribName = fromPeer ? 'TA 发的' : at.name;
    return `
      <button class="cp-bill-row" data-cp="bill-item" data-id="${t.id}" type="button">
        <span class="cp-bill-avatar" style="background:${c.color}1A;color:${c.color}">${Icons.catIcon(c)}</span>
        <span class="cp-bill-main">
          <span class="cp-bill-name">
            ${U.escapeHtml(c.name)}${t.sub ? `<span class="sub-tag">${U.escapeHtml(t.sub)}</span>` : ''}
            <span class="cp-bill-attrib" style="--ac:${at.color}">${U.escapeHtml(attribName)}</span>
            ${back ? '<span class="cp-bill-refund">退了一部分</span>' : ''}
          </span>
          <span class="cp-bill-meta">${U.timeStr(t.ts)}${t.note ? ' · ' + U.escapeHtml(t.note) : ''}${
            back ? ` · 原 ${U.money(t.amount)}，退回来 ${U.money(back)}` : ''}</span>
        </span>
        <span class="cp-bill-amt ${amtCls}">${amtSign}${U.money(net, { symbol: false })}</span>
      </button>`;
  }

  function bindBill(root) {
    root.querySelectorAll('[data-cp]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.getAttribute('data-cp');
        if (act === 'bill-prev') { billState.offset -= 1; render(root); return; }
        if (act === 'bill-next') {
          if (billState.offset >= 0) return;
          billState.offset += 1;
          render(root);
          return;
        }
        if (act === 'bill-pick') {
          UI.datePicker({
            title: '看哪个月',
            value: billMonth().getTime(),
            onPick(ts) {
              const t = new Date(ts);
              const now = new Date();
              billState.offset = (t.getFullYear() - now.getFullYear()) * 12 + (t.getMonth() - now.getMonth());
              if (billState.offset > 0) billState.offset = 0;
              render(root);
            },
          });
          return;
        }
        if (act === 'bill-filter') {
          billState.filterType = b.getAttribute('data-f') || 'all';
          render(root);
          return;
        }
        if (act === 'bill-add') { openBillEditor(null, () => render(root)); return; }
        if (act === 'favor-add') { openFavorAddSheet(() => refreshHere(root)); return; }
        if (act === 'bill-item') {
          const t = S.cpTxById(b.getAttribute('data-id'));
          // 点某一笔账：弹层关掉后重画整屏，位置要留住（翻月 bill-prev/next 不走这里）
          if (t) openBillActions(t, () => refreshHereKeep(root));
          return;
        }
        if (act === 'bill-home') { page = 'home'; render(root); refreshTop(); return; }
      });
    });
  }

  /**
   * 记账/改账弹层。attrib 四选一，点一下就换。
   * 金额用元为单位输入，存的时候换成「分」。
   *
   * 【只记支出】这里没有「支出/收入」切换。
   * 情侣账本不回答「我还剩多少」，它回答的是「我们一起花在哪、一起攒了多少」；
   * 收入属于各自，开销才属于两人。而且一旦有收入，
   * 「谁赚得多」就会变成一条随时可见的对比线 —— 关系里最不该被数字化的线。
   * 需要记进账的东西有两个出口：退回来了 → 这里；红包礼金 → 「收了一笔」进基金。
   *
   * 反直觉的一点：**不要**在这写一句「情侣账本不记收入，因为……」。
   * 解释一个不在场的东西，反而会让用户意识到它本该在。
   *
   * @param {object|null} tx 传了就进入「改这一笔」
   * @param {function} onDone 存完/删完后的回调
   * @param {{day?: string}} [opts] day='YYYY-MM-DD' → 补记某一天（只接受过去，
   *        今天和未来一律忽略：今天要记直接记，不必「补」）
   */
  function openBillEditor(tx, onDone, opts) {
    const editing = !!tx;
    // 补记的日子：必须能解析、且严格早于今天。解析不了 / 是今天 / 是未来 → 当普通新增
    const backDay = (function () {
      const raw = opts && opts.day;
      if (!raw) return null;
      const d = U.parseYmd(raw);
      if (!d || isNaN(d.getTime())) return null;
      if (U.ymd(d) >= U.ymd(new Date())) return null;
      return d;
    })();
    // 落在当天中午 12 点：避开时区 / 夏令时把日期挪到前一天
    const backTs = backDay ? backDay.getTime() + 12 * 3600000 : 0;
    const cur = tx ? Object.assign({}, tx) : {
      type: 'expense', amount: 0, catId: 'food', sub: '',
      accountId: 'alipay', note: '', ts: backTs || Date.now(), attrib: S.ATTRIB_DEFAULT,
    };
    // 老账的印记是「一起花」时不自动改，只在新选时才换 —— 用户的历史别被我们重写
    let amountText = tx ? (tx.amount / 100).toFixed(2).replace(/\.00$/, '') : '';

    UI.openSheet({
      // 不加标题：从「我们的账单」页点进来的，上下文已经很清楚了，
      // 顶上再写一遍「记一笔情侣账」只是重复占位置（用户 m03602 要求去掉）。
      // 改账时仍写「改这一笔」—— 那时用户需要知道自己动的是已有记录；
      // 从日历补记时写「补记一笔」，因为那是另一种来意。
      title: editing ? '改这一笔' : (backDay ? '补记一笔' : null),
      content: `
        <div class="cbe" id="cbe">
          <div class="cbe-amount">
            <span class="cbe-cur">¥</span>
            <input class="cbe-input" id="cbe-amount" type="text" inputmode="decimal" enterkeyhint="done"
              autocomplete="off" placeholder="0.00" value="${U.escapeHtml(amountText)}" />
          </div>

          ${backDay ? `<div class="cbe-back">${Icons.svg('calendar', 13)} 记在 ${U.escapeHtml(bdText(U.ymd(backDay)))}</div>` : ''}

          <div class="cbe-label">这笔是谁请的</div>
          <div class="attrib-chips" id="cbe-attrib">
            ${S.ATTRIBS.map((a) => `
              <button class="attrib-chip ${cur.attrib === a.id ? 'on' : ''}"
                data-e="attrib" data-attrib="${a.id}" type="button" style="--ac:${a.color}">
                <i class="attrib-dot"></i>${U.escapeHtml(a.name)}
              </button>`).join('')}
          </div>
          <div class="cbe-hint cbe-hint--favor" id="cbe-hint">钱都算「我们」的，只是留个记号</div>

          <div class="cbe-label">花了什么</div>
          <button class="cbe-cat" data-e="cat" type="button" id="cbe-cat">
            <span class="cbe-cat-ic" id="cbe-cat-ic"></span>
            <span class="cbe-cat-name" id="cbe-cat-name"></span>
            ${Icons.svg('chevronRight', 14)}
          </button>

          <div class="cbe-label">备注</div>
          <input class="cbe-note" id="cbe-note" type="text" maxlength="60" enterkeyhint="done"
            autocomplete="off"
            placeholder="写点什么，比如「一起吃的火锅」" value="${U.escapeHtml(cur.note || '')}" />

          ${editing
            ? `<div class="cbe-links">
                <button class="cbe-link" data-e="refund" type="button">${Icons.svg('refresh', 13)} 这笔退回来了</button>
                <button class="cbe-link" data-e="income" type="button">${Icons.svg('plus', 13)} 收了一笔</button>
              </div>`
            : `<div class="cbe-links cbe-links--new">
                <button class="cbe-link" data-e="income" type="button">${Icons.svg('plus', 13)} 收了一笔</button>
              </div>`}

          <button class="cbe-del ${editing ? '' : 'is-hidden'}" data-e="delete" type="button">删除这一笔</button>
        </div>
      `,
      onMount(body, close) {
        const input = body.querySelector('#cbe-amount');
        const hint = body.querySelector('#cbe-hint');
        const catIc = body.querySelector('#cbe-cat-ic');
        const catName = body.querySelector('#cbe-cat-name');

        // 提示文案：默认解释归属印记；选了归属印记或换了分类都会被重新说一次。
        // 选了「红包」时优先说红包的去向 —— 「来自 TA 的偏爱」是这一笔的落点，
        // 比「钱都算我们的」更值得在按下保存前让用户知道一次。
        const HINT_TXT = '钱都算「我们」的，只是留个记号';
        const HINT_RED = '这一笔会出现在 TA 的「来自 TA 的偏爱」里 💗';
        const sayHint = () => {
          const isRed = cur.catId === (Icons.RED_PACKET_ID || 'redpacket');
          // 红包只代表「我发给 TA」：从我这记出去，落在 TA 的偏爱里。
          hint.textContent = isRed
            ? HINT_RED
            : (cur.attrib === 'mutual' ? '今天你请，明天我请 ✨' : HINT_TXT);
          // 换成粉色系，和红包图标、偏爱卡同一个色 —— 提示本身就是「这一笔进粉色那一栏」
          hint.classList.toggle('is-red', isRed);
        };
        const paintCat = () => {
          const c = Icons.cat(cur.catId);
          // 红包的图标是手绘 SVG，cat-bubble 以外的容器也不需要额外 class
          catIc.innerHTML = Icons.catIcon(c);
          catIc.style.background = c.color + '1F';
          catIc.style.color = c.color;
          catName.textContent = c.name;
          sayHint();
        };
        paintCat();

        // 底部按钮
        const foot = U.el('div', { class: 'sheet-foot' });
        const ok = U.el('button', { class: 'btn btn--primary', type: 'button' }, editing ? '保存' : '记下来');
        const cancel = U.el('button', { class: 'btn btn--ghost', type: 'button' }, '取消');
        foot.appendChild(ok);
        foot.appendChild(cancel);
        body.appendChild(foot);
        cancel.addEventListener('click', close);

        body.querySelectorAll('[data-e]').forEach((b) => {
          b.addEventListener('click', async () => {
            const act = b.getAttribute('data-e');
            if (act === 'attrib') {
              const a = S.attrib(b.getAttribute('data-attrib'));
              cur.attrib = a.id;
              // 选「红包」= 分类跟着切成红包（用户原话：把红包做成记账选项）；
              // 切回别的印记且分类还停在红包上时，把分类放回「餐饮」，别让红包标签到处粘
              if (a.id === 'redpacket') {
                cur.catId = Icons.RED_PACKET_ID || 'redpacket';
              } else if (cur.catId === (Icons.RED_PACKET_ID || 'redpacket')) {
                cur.catId = 'food';
              }
              body.querySelectorAll('[data-e="attrib"]').forEach((x) => {
                x.classList.toggle('on', x.getAttribute('data-attrib') === a.id);
              });
              paintCat();
              sayHint();
              return;
            }
            if (act === 'cat') {
              UI.catPicker({
                kind: 'expense',
                value: cur.catId,
                onPick(id) { cur.catId = id; paintCat(); },
              });
              return;
            }
            if (act === 'refund') {
              close();
              setTimeout(() => openRefundSheet(tx, onDone), 180);
              return;
            }
            if (act === 'income') {
              close();
              setTimeout(() => openIncomeSheet(onDone), 180);
              return;
            }
            if (act === 'delete') {
              const yes = await UI.confirm({
                title: '删掉这一笔？',
                desc: '两个人都会看不到这笔账。',
                danger: true, okText: '删掉',
              });
              if (!yes) return;
              const gone = S.cpRemoveTx(tx.id);
              close();
              if (gone && global.App) global.App.refresh();
              U.toast('已删除', 'success');
              if (onDone) onDone();
            }
          });
        });

        ok.addEventListener('click', () => {
          const cents = U.amountToCents(input.value);
          if (!cents) {
            U.toast('先填个金额', 'error');
            input.focus();
            return;
          }
          const patch = {
            type: 'expense',
            amount: cents,
            catId: cur.catId,
            sub: '',
            accountId: cur.accountId,
            note: body.querySelector('#cbe-note').value.trim(),
            attrib: cur.attrib,
            // 补记：用日历里选中的那一天；改账保留原时间；普通新增用当前时刻
            ts: editing ? tx.ts : (backTs || Date.now()),
          };
          // 红包：方向只认 rpFrom，且恒为 'me'（我发给 TA）—— 记账人发出的
          // 红包从我这记支出、落在 TA 的「来自 TA 的偏爱」里；编辑旧账时
          // 保留这笔原有的方向，不给改的入口。
          // 不是红包的账把 rpFrom 清掉。
          const isRedTx = patch.catId === (Icons.RED_PACKET_ID || 'redpacket') || cur.attrib === 'redpacket';
          if (isRedTx) {
            patch.catId = Icons.RED_PACKET_ID || 'redpacket';
            patch.attrib = 'redpacket';
            patch.rpFrom = editing && tx.rpFrom === 'peer' ? 'peer' : 'me';
          } else {
            patch.rpFrom = '';
          }
          if (editing) S.cpUpdateTx(tx.id, patch);
          else S.cpAddTx(patch);
          close();
          if (onDone) onDone(); else refreshHere();
          U.toast(editing ? '改好了' : '记下了', 'success');
        });

        // m02799：金额框要能唤出手机数字键盘。
        //
        // 旧写法是 setTimeout(350) 里 focus() + click()：350ms 踩在 sheet
        // 入场动画（.34s）的尾巴上，有的机型动画一结束就把焦点吞了，
        // 键盘不弹；合成的 .click() 更是没有任何作用，白写。
        //
        // 关键点：手机浏览器只在「用户手势的同一趟任务」里保证弹键盘。
        // openBillEditor 是从「记一笔」按钮的 click 同步走过来的
        // （click → openBillEditor → UI.openSheet → 这里），所以此刻
        // focus() 一定在手势内；之后 250ms/650ms 只是补刀，防止
        // 入场动画/滚动布局把焦点挤掉。
        UI.focusKeyboard(input);
      },
    });
  }

  /**
   * 「这笔退回来了」：网购退货、票务退款、失效订单。
   *
   * 为什么不记成收入：退款不是进账，是「这笔没花成」。
   * 记成收入，「一起花了多少」就变成「花了多少、又收回来多少」，
   * 用户还得自己做减法；而且月报就会虚高 —— 一笔 800 的火锅退回来 200，
   * 应该是 600，不是「花了 800，收入 200」。
   *
   * 做法：核销对应的原支出，月报按净额算。不新增分类、不进「收入」。
   */
  function openRefundSheet(tx, onDone) {
    if (!tx || tx.refundOf) return;
    const already = S.cpRefundedOf(tx.id);
    const remain = Math.max(0, tx.amount - already);
    if (remain <= 0) {
      U.toast('这笔已经全退回来了');
      return;
    }
    const full = remain === tx.amount;
    let amountText = '';

    UI.openSheet({
      title: '这笔退回来了',
      content: `
        <div class="crs" id="crs">
          <div class="crs-src">
            <span class="crs-src-ic" style="background:${Icons.cat(tx.catId).color}1A">${Icons.cat(tx.catId).icon}</span>
            <span class="crs-src-main">
              <span class="crs-src-name">${U.escapeHtml(Icons.cat(tx.catId).name)}${tx.note ? ' · ' + U.escapeHtml(tx.note) : ''}</span>
              <span class="crs-src-sub">原支出 ${U.money(tx.amount)}${already ? ` · 已经退过 ${U.money(already)}` : ''}</span>
            </span>
          </div>

          <div class="crs-opt">
            <button class="crs-opt-btn on" data-r="full" type="button">
              <span class="crs-opt-name">全退回来</span>
              <span class="crs-opt-sub">${U.money(remain)} · 这笔就不算花了</span>
            </button>
            <button class="crs-opt-btn" data-r="part" type="button">
              <span class="crs-opt-name">退了一部分</span>
              <span class="crs-opt-sub">只把退回来的那部分减掉</span>
            </button>
          </div>

          <div class="crs-part is-hidden" id="crs-part">
            <div class="crs-part-label">退回来多少</div>
            <div class="crs-amount">
              <span class="crs-cur">¥</span>
              <input class="crs-input" id="crs-amount" type="text" inputmode="decimal"
                enterkeyhint="done" autocomplete="off"
                placeholder="0.00" value="${U.escapeHtml(amountText)}" />
            </div>
            <div class="crs-hint">最多 ${U.money(remain)}</div>
          </div>

          <div class="crs-note">退回来的钱不算收入，只是这笔没花成。</div>
        </div>
      `,
      onMount(body, close) {
        const partBox = body.querySelector('#crs-part');
        const input = body.querySelector('#crs-amount');
        let mode = 'full';

        body.querySelectorAll('[data-r]').forEach((b) => {
          b.addEventListener('click', () => {
            mode = b.getAttribute('data-r') === 'part' ? 'part' : 'full';
            body.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b));
            partBox.classList.toggle('is-hidden', mode !== 'part');
            // 切到「退了一部分」时同步 focus（仍在用户点这一下的手势里），
            // 键盘跟着出来。旧写法是 setTimeout(80) focus，落在手势外，
            // 部分安卓/iOS 不弹。
            if (mode === 'part') UI.focusKeyboard(input);
          });
        });

        const foot = U.el('div', { class: 'sheet-foot' });
        const ok = U.el('button', { class: 'btn btn--primary', type: 'button' }, full ? '全额退回来了' : '确定');
        const cancel = U.el('button', { class: 'btn btn--ghost', type: 'button' }, '取消');
        foot.appendChild(ok);
        foot.appendChild(cancel);
        body.appendChild(foot);
        cancel.addEventListener('click', close);

        ok.addEventListener('click', () => {
          let val = 'full';
          if (mode === 'part') {
            const cents = U.amountToCents(input.value);
            if (!cents) { U.toast('先填退回来多少', 'error'); input.focus(); return; }
            if (cents > remain) { U.toast(`最多退 ${U.money(remain)}`, 'error'); return; }
            val = cents;
          }
          const r = S.cpRefundTx(tx.id, val, '退回来了');
          if (!r) { U.toast('没记上，再试一次', 'error'); return; }
          close();
          if (global.App) global.App.refresh();
          U.toast(val === 'full' ? '这笔不算花了' : '减掉了退回来的部分', 'success');
          if (onDone) onDone();
        });
      },
    });
  }

  /**
   * 「收了一笔」：纪念日礼金、双方父母给的见面红包这一类。
   *
   * 为什么不进交易列表：情侣账本只记支出。这笔钱一进来就是「两个人的钱」，
   * 共同的钱在基金里 —— 放进支出列表，它下一秒就会被拿去和
   * 「我们花了多少」做减法，可它本来不是一笔花销。
   * 界面上不出现「收入」二字。
   */
  function openIncomeSheet(onDone) {
    const goals = (S.coupleGoals && S.coupleGoals()) || [];
    const vault = S.coupleVault && S.coupleVault();
    const list = goals.length ? goals.slice() : [];
    let goalId = vault ? vault.id : (list[0] ? list[0].id : '');

    UI.openSheet({
      title: '收了一笔',
      content: `
        <div class="cis" id="cis">
          <div class="cis-lead">红包、礼金、转账进来的钱，记成两个人的共同基金。</div>

          <div class="crs-amount">
            <span class="crs-cur">¥</span>
            <input class="crs-input" id="cis-amount" type="text" inputmode="decimal"
              enterkeyhint="done" autocomplete="off" placeholder="0.00" />
          </div>

          ${list.length ? `
            <div class="cbe-label">放进哪个</div>
            <div class="cis-goals" id="cis-goals">
              ${list.map((g) => `
                <button class="cis-goal ${g.id === goalId ? 'on' : ''}" data-g="${g.id}" type="button">
                  <span class="cis-goal-ic">${U.escapeHtml(g.icon || '💞')}</span>
                  <span class="cis-goal-name">${U.escapeHtml(g.name || '一起攒的')}</span>
                  <span class="cis-goal-val">${U.money(g.saved || 0)}</span>
                </button>`).join('')}
            </div>` : ''}

          <div class="cbe-label">备注</div>
          <input class="cbe-note" id="cis-note" type="text" maxlength="40" enterkeyhint="done"
            autocomplete="off" placeholder="比如「爸妈给的见面红包」" />

          <div class="crs-note">它不会出现在账目列表里。进的是共同的钱，不是一笔花销。</div>
        </div>
      `,
      onMount(body, close) {
        const input = body.querySelector('#cis-amount');
        body.querySelectorAll('[data-g]').forEach((b) => {
          b.addEventListener('click', () => {
            goalId = b.getAttribute('data-g');
            body.querySelectorAll('[data-g]').forEach((x) => x.classList.toggle('on', x === b));
          });
        });

        const foot = U.el('div', { class: 'sheet-foot' });
        const ok = U.el('button', { class: 'btn btn--primary', type: 'button' }, '收进来');
        const cancel = U.el('button', { class: 'btn btn--ghost', type: 'button' }, '取消');
        foot.appendChild(ok);
        foot.appendChild(cancel);
        body.appendChild(foot);
        cancel.addEventListener('click', close);

        ok.addEventListener('click', () => {
          const cents = U.amountToCents(input.value);
          if (!cents) { U.toast('先填个金额', 'error'); input.focus(); return; }
          const g = S.cpFundDeposit(goalId, cents, body.querySelector('#cis-note').value.trim());
          if (!g) { U.toast('没存上，再试一次', 'error'); return; }
          close();
          if (global.App) global.App.refresh();
          U.toast(`已存进「${g.name}」`, 'success');
          if (onDone) onDone();
        });

        // 同步 focus 唤出手机数字键盘（仍在用户点击那趟手势里）。
        // 旧写法 setTimeout(120) 落在手势外，部分机型不弹。
        UI.focusKeyboard(input);
      },
    });
  }

  // m02510：详情弹层防重入 —— 同一笔账 600ms 内只许开一次。
  // 委托可能被多个容器同时命中（同一节点上挂了 bindCal/bindFavor/bindSub），
  // 一个 click 连开两层一模一样的 sheet，mask 叠 mask，点一次空白只关掉一层，
  // 用户就得点两次才彻底关掉 —— 正是「回忆小票墙重弹」的老症状。
  let billActionsAt = 0;
  function openBillActions(t, onDone) {
    const now = Date.now();
    if (now - billActionsAt < 600) return;
    billActionsAt = now;
    const c = Icons.cat(t.catId);
    const at = S.attrib(t.attrib);
    // 重排：金额当主角（大字居中），下面三条整行操作（图标+文字，一行一个）。
    // 以前两个 ghost 并排 + 一行红字删除，按钮挤在卡片边上、主次靠猜；
    // 竖排一行一个，点哪行是哪行，删除放最后且整行淡红 —— 顺眼也不易误触。
    UI.openSheet({
      title: '这笔情侣账',
      content: `
        <div class="cfa" id="cfa">
          <div class="cfa-hero">
            <span class="cfa-hero-ic" style="--ac:${c.color}">${Icons.catIcon(c)}</span>
            <div class="cfa-hero-amt${t.type === 'income' || t.rpFrom === 'peer' ? ' is-income' : ''}">
              <span class="cfa-amt-sign">${t.type === 'income' || t.rpFrom === 'peer' ? '+' : '-'}</span>${U.money(t.amount, { symbol: false })}
              <i class="cfa-hero-cur">元</i>
            </div>
            <div class="cfa-hero-meta">
              <span class="cfa-at" style="--ac:${at.color}"><i class="cfa-dot"></i>${U.escapeHtml(at.name)}</span>
              <span class="cfa-when">${U.escapeHtml(c.name)} · ${U.fullDate(t.ts)}</span>
            </div>
          </div>
          ${t.note ? `<div class="cfa-note">${U.escapeHtml(t.note)}</div>` : ''}
          <div class="cfa-list">
            <button class="cfa-row" data-act="copy" type="button">
              <span class="cfa-row-ic">${Icons.svg('copy', 17)}</span>
              <span class="cfa-row-t">再来一笔<i>同样的账，记在今天</i></span>
              ${Icons.svg('chevronRight', 14)}
            </button>
            <button class="cfa-row" data-act="edit" type="button">
              <span class="cfa-row-ic">${Icons.svg('edit', 17)}</span>
              <span class="cfa-row-t">改一下<i>金额、备注、日期都能改</i></span>
              ${Icons.svg('chevronRight', 14)}
            </button>
            <button class="cfa-row cfa-row--del" data-act="del" type="button">
              <span class="cfa-row-ic">${Icons.svg('trash', 17)}</span>
              <span class="cfa-row-t">删掉这笔<i>两个人都会看不到</i></span>
              ${Icons.svg('chevronRight', 14)}
            </button>
          </div>
        </div>
      `,
      onMount(body, close) {
        body.querySelector('[data-act="edit"]').addEventListener('click', () => {
          close();
          setTimeout(() => openBillEditor(t, onDone), 180);
        });
        body.querySelector('[data-act="copy"]').addEventListener('click', () => {
          close();
          // 老版照抄 type/attrib 却不抄 rpFrom：红包再记一笔，对面就收不到
          // 「来自 TA 的偏爱」了。同一笔账抄下来，归属记号也得跟着抄。
          S.cpAddTx({
            type: t.type, amount: t.amount, catId: t.catId, sub: t.sub,
            accountId: t.accountId, note: t.note, attrib: t.attrib, rpFrom: t.rpFrom || '',
            ts: Date.now(),
          });
          U.toast('又记了一笔一样的', 'success');
          if (onDone) onDone(); else refreshHere();
        });
        body.querySelector('[data-act="del"]').addEventListener('click', async () => {
          close();
          const yes = await UI.confirm({
            title: '删掉这一笔？',
            desc: `${c.name} ${U.money(t.amount)}<br/>两个人都会看不到这笔账`,
            danger: true, okText: '删掉',
          });
          if (!yes) return;
          const gone = S.cpRemoveTx(t.id);
          U.toast(gone ? '已删除' : '这笔已经不在了', gone ? 'success' : 'error');
          // 删完必须当场重画：账可能已经不在（对面删的、或者刚才连点），
          // 所以两种情况都画一次，别停在「这笔情侣账」里点空气。
          if (onDone) onDone(); else refreshHere();
        });
      },
    });
  }

  /** 双心合拢进度条 */
  function renderVault(goal) {
    const prog = S.goalProgress(goal);
    const pct = Math.round((prog.pct || 0) * 100);
    const done = pct >= 100;
    // 两颗心从两侧往中间靠：--gap 是心与心之间剩下的距离，
    // 0% 时分开 124px，每存一点靠近一点，100% 时合成一颗 💞。
    const gap = Math.round(124 * (1 - U.clamp(prog.pct || 0, 0, 1)));
    const rest = done ? 0 : Math.max(0, (goal.target || 0) - (goal.saved || 0));
    return `
      <div class="cp-vault-hearts ${done ? 'is-done' : ''}" data-pct="${pct}"
        style="--gap:${gap}px">
        ${done
          ? '<span class="cp-heart cp-heart--big">💞</span>'
          : `<span class="cp-heart cp-heart--l">❤️</span>
             <span class="cp-heart cp-heart--r">❤️</span>`}
      </div>
      <div class="cp-vault-bar"><i style="width:${done ? 100 : U.clamp(pct, 0, 100)}%"></i></div>
      <div class="cp-vault-nums">
        <b>${U.money(goal.saved || 0)}</b>${goal.target ? ` / ${U.money(goal.target)}` : ''}
        <span class="cp-vault-name">${U.escapeHtml(goal.name || '')}${done ? ' · 存满啦' : ''}</span>
      </div>
      <div class="cp-vault-cap">${done
        ? '两颗心已经合在一起了 💞'
        : goal.target
          ? `两颗心靠拢了 ${pct}% · 还差 ${U.money(rest)} 就合上`
          // 没设目标时不能只写「0%」：钱明明存进去了，百分比却永远是 0，
          // 看起来像没存上。改成直接报「已经攒了多少」，再提示去定目标。
          : (goal.saved || 0) > 0
            ? `已经攒了 ${U.money(goal.saved)} · 还没设目标，去定一个吧`
            : '还没设目标金额'}</div>
    `;
  }

  // ------------------------------------------------------------
  // 对外接口
  // ------------------------------------------------------------
  global.ViewCouple = {
    render,
    get step() { return step; },
    setStep(s) { step = s; },
    subtitle,
    daysTogether,
    on,
    hidden,
    MODE,
    CONSENT_VERSION,
    get config() { return cfg(); },
    // 主界面分页（home / bill / mode / memories / days / report）
    get page() { return page; },
    setPage(p) { page = PAGES.indexOf(p) >= 0 ? p : 'home'; if (page === 'bill') clearPeerNew(); },
    get billState() { return billState; },
    resetBill() { billState.offset = 0; billState.filterType = 'all'; },
    openBillEditor,
    // 供测试与外部复用
    peerClock,
    nextMile,
    cpTx,
    billPeriod,
    MILES,
    renderMemories,
    renderDays,
    // 同步层拉到对方的改动后，由 app.js 调它自动重画（不用用户手动刷新）
    softRefresh,
    // 日历小字标注的唯一算法入口（节日 / 生日 / 第 N 天），外部与探针共用
    dayEvents,
    dayIndex,
  };
})(window);
