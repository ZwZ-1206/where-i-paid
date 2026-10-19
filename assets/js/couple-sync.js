/* ==================================================================
 * couple-sync.js — 双人同步（客户端引擎）
 *
 * 这一层只做五件事：
 *   1. 配对串的生成 / 解析，派生 encKey + authKey（HKDF，两把子键）
 *   2. 把一次变更塞进本地 outbox（明文排队，发送时才加密）
 *   3. 批量推、增量拉、按 seq 合并（合并内核是纯函数，可单测）
 *   4. 失败退避，但【永不抛错】—— 同步坏了不能影响记账
 *   5. 给界面一个 status()
 *
 * 设计上的三个硬约定：
 *   - encKey 只活在内存里，不落盘；落盘的是 secret（配对串里那 16 字节）
 *   - outbox 存明文：密钥还没派生完就记账也不会丢；发送时才 AES-GCM
 *   - 合并只看服务端 seq，**不看 updatedAt**（两套判据会打起来，见方案 §6.2）
 * ================================================================== */
(function (global) {
  'use strict';

  /** 同步协议版本。payload 结构变了就 +1，老客户端能据此降级 */
  const PROTO = 2;
  /** 本地同步状态（和业务数据分开存：不污染导出备份，不动 state 的体积） */
  const KEY = 'jizhang.sync.v1';
  /** 兼容骨架时期的名字，测试和老代码可能还在引用 */
  const OUTBOX_KEY = 'syncOutbox';
  const SEQ_KEY = 'syncSeq';

  /**
   * API 前缀。
   *
   * 网页 / PWA 和官网同源，用相对路径就行。
   * **APK 不行**：安卓壳加载的是本地资源（origin 是
   * `https://appassets.androidplatform.net`），相对路径 `/api/couple/...`
   * 会打到本地资源加载器上，永远 404 —— 表现就是配对页一直「连不上服务器」。
   * 所以 APK 里要显式指到线上地址，同时 Functions 那边要放行这个 origin 的 CORS。
   */
  const API_BASE = (function () {
    try { return apiBaseFor(location.hostname); } catch (e) { /* 沙箱里没有 location */ }
    return '';
  })();
  const API = API_BASE + '/api/couple';

  /** 哪个 origin 需要打线上接口（抽出来是为了能单测，不依赖真浏览器） */
  function apiBaseFor(host) {
    return host === 'appassets.androidplatform.net' ? 'https://where-i-paid.pages.dev' : '';
  }
  const INFO_ENC = 'jz1/enc/v1';
  const INFO_AUTH = 'jz1/auth/v1';
  const MAX_OUTBOX = 500;
  const MAX_BATCH = 50;
  const MAX_PAGES = 20;
  const DEBOUNCE = 800;
  const POLL_MS = 20000;

  /** 白名单：不是这些前缀的 op 一律丢弃 */
  const ALLOW = { cptx: 1, goal: 1, book: 1, profile: 1 };

  /** 这些 op 要从状态里真的删掉 */
  const REMOVE_KINDS = { 'cptx.remove': 1, 'goal.remove': 1, 'book.remove': 1, 'book.wipe': 1 };

  // ---------- base64url ----------
  const AB = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function bytesToB64url(bytes) {
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += AB[(n >> 18) & 63] + AB[(n >> 12) & 63] + AB[(n >> 6) & 63] + AB[n & 63];
    }
    if (i < bytes.length) {
      const rest = bytes.length - i;
      const n = (bytes[i] << 16) | (rest > 1 ? bytes[i + 1] << 8 : 0);
      out += AB[(n >> 18) & 63] + AB[(n >> 12) & 63];
      if (rest > 1) out += AB[(n >> 6) & 63];
    }
    return out;
  }

  function b64urlToBytes(str) {
    const s = String(str || '').replace(/=+$/, '');
    const out = [];
    let buf = 0;
    let bits = 0;
    for (let i = 0; i < s.length; i++) {
      const v = AB.indexOf(s[i]);
      if (v < 0) throw new Error('BAD_B64URL');
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buf >> bits) & 255);
      }
    }
    return new Uint8Array(out);
  }

  function bytesToHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function enc(str) { return new TextEncoder().encode(str); }
  function dec(buf) { return new TextDecoder().decode(buf); }
  function rand(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  // ---------- 本地状态 ----------
  let S = null;

  function blank() {
    return {
      v: 1,
      room: '',
      secret: '',       // base64url(16 字节 secret)
      lastSeq: 0,
      outbox: [],
      tombstones: {},
      dropped: 0,
      lastSyncAt: 0,
      lastError: '',
      created: false,   // 是否已经在服务端建过房
      ack: {},          // opId -> seq（给实体回填 _seq）
    };
  }

  function state() {
    if (S) return S;
    let raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try { S = Object.assign(blank(), JSON.parse(raw)); } catch (e) { S = blank(); }
    } else {
      S = blank();
    }
    if (!Array.isArray(S.outbox)) S.outbox = [];
    if (!S.tombstones || typeof S.tombstones !== 'object') S.tombstones = {};
    if (!S.ack || typeof S.ack !== 'object') S.ack = {};
    return S;
  }

  function persist() {
    try { global.localStorage.setItem(KEY, JSON.stringify(state())); } catch (e) { /* 满了也不能崩 */ }
  }

  // ---------- 密钥 ----------
  let encKey = null;
  let authKey = '';

  /** 派生两把子键。salt 用 room 的原始 16 字节，info 分开，互不可推 */
  async function deriveKey(secretB64, roomHex) {
    const secret = b64urlToBytes(secretB64);
    if (secret.length !== 16) throw new Error('BAD_SECRET');
    if (!/^[0-9a-f]{32}$/.test(roomHex || '')) throw new Error('BAD_ROOM');
    const room16 = hexToBytes(roomHex);

    const ikm = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey', 'deriveBits']);
    const k = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: room16, info: enc(INFO_ENC) },
      ikm,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: room16, info: enc(INFO_AUTH) },
      ikm,
      256
    );
    encKey = k;
    authKey = bytesToB64url(new Uint8Array(bits));
    return { encKey, authKey };
  }

  /** 密钥懒加载：每次要用之前调一次，成功就缓存 */
  async function ensureKeys() {
    const s = state();
    if (!s.room || !s.secret) return false;
    if (encKey && authKey) return true;
    try {
      await deriveKey(s.secret, s.room);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- 加解密 ----------
  /** 一条 op 的 cipher = base64(iv ‖ ct)，AAD 绑定 room|opId|proto */
  async function encryptOp(obj, opId) {
    if (!(await ensureKeys())) return null;
    const iv = rand(12);
    const aad = enc(state().room + '|' + opId + '|' + PROTO);
    const plain = enc(JSON.stringify(obj));
    let ct;
    try {
      ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, encKey, plain));
    } catch (e) {
      return null;
    }
    const all = new Uint8Array(iv.length + ct.length);
    all.set(iv);
    all.set(ct, iv.length);
    return bytesToB64url(all);
  }

  /** 解不开一律返回 null（不抛）：这是「不是给我的数据」的正常情况 */
  async function decryptOp(b64, opId) {
    if (!(await ensureKeys())) return null;
    try {
      const all = b64urlToBytes(b64);
      if (all.length < 13) return null;
      const aad = enc(state().room + '|' + opId + '|' + PROTO);
      const buf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: all.slice(0, 12), additionalData: aad },
        encKey,
        all.slice(12)
      );
      return JSON.parse(dec(buf));
    } catch (e) {
      return null;
    }
  }

  /** 骨架时期留下的两个入口，保持可用 */
  async function encrypt(json, opId) {
    return encryptOp({ p: PROTO, k: 'raw', d: json, t: Date.now() }, opId || 'raw');
  }
  async function decrypt(b64, opId) {
    const o = await decryptOp(b64, opId || 'raw');
    return o ? o.d : null;
  }

  // ---------- 配对 ----------
  /** 生成一个新的配对串：room16 ‖ secret16 → 43 字符 */
  function makePair() {
    const room16 = rand(16);
    const secret16 = rand(16);
    const all = new Uint8Array(32);
    all.set(room16, 0);
    all.set(secret16, 16);
    return { pair: bytesToB64url(all), room: bytesToHex(room16), secret: bytesToB64url(secret16) };
  }

  /** 解析配对串；非法返回 null */
  function parsePair(str) {
    const clean = String(str || '').replace(/[^A-Za-z0-9_-]/g, '');
    let all;
    try { all = b64urlToBytes(clean); } catch (e) { return null; }
    if (all.length !== 32) return null;
    return {
      room: bytesToHex(all.slice(0, 16)),
      secret: bytesToB64url(all.slice(16)),
      pair: clean,
    };
  }

  /**
   * 发起配对：写入新 room/secret，抹掉旧的同步痕迹。
   * 不建房间 —— 建房放在第一次 push 时（create:true）。
   */
  function pair() {
    const p = makePair();
    S = blank();
    S.room = p.room;
    S.secret = p.secret;
    encKey = null;
    authKey = '';
    persist();
    return p.pair;
  }

  /** 当前配对串（给「再看一次」用） */
  function pairString() {
    const s = state();
    if (!s.room || !s.secret) return '';
    const all = new Uint8Array(32);
    all.set(hexToBytes(s.room), 0);
    all.set(b64urlToBytes(s.secret), 16);
    return bytesToB64url(all);
  }

  /**
   * 加入配对：解析 → 探测一次 pull。
   * 401 才算「配对串不对」；网络不通要报网络，不能混为一谈。
   * 失败时**不改动本机原有状态**。
   */
  async function join(pairStr) {
    const p = parsePair(pairStr);
    if (!p) return { ok: false, code: 'BAD_PAIR' };

    const backup = JSON.parse(JSON.stringify(state()));

    S = blank();
    S.room = p.room;
    S.secret = p.secret;
    encKey = null;
    authKey = '';

    let res;
    try {
      res = await api('GET', '/pull?room=' + p.room + '&since=0&limit=1');
    } catch (e) {
      S = backup; persist(); encKey = null; authKey = '';
      return { ok: false, code: 'NETWORK' };
    }
    if (!res.ok) {
      S = backup; persist(); encKey = null; authKey = '';
      return { ok: false, code: res.code || 'FAILED' };
    }
    // 房间是对方建的，本机永远不该再发 create:true（会被判 ROOM_TAKEN）
    S.created = true;
    persist();
    return { ok: true };
  }

  /** 解绑本机（不删云端） */
  function leave() {
    S = blank();
    encKey = null;
    authKey = '';
    persist();
  }

  /**
   * 删除云端房间：真删 ops + rooms，成功后本机也解绑。
   *
   * 为什么放在同步层而不是设置页自己拼请求：
   * 删除要用 authKey 鉴权（pair 派生出来的那把），设置页拿不到；而且删完必须
   * 清掉本机的 room/secret，否则状态灯会一直显示「已配对但拉不到数据」。
   */
  async function removeRoom() {
    const s = state();
    if (!s.room) return { ok: false, code: 'NOT_PAIRED' };
    const res = await api('DELETE', '/room', { room: s.room, confirm: 'DELETE' });
    if (res && res.ok) {
      leave();
      try { global.dispatchEvent(new global.CustomEvent('couple-sync-wiped')); } catch (e) { /* 忽略 */ }
    }
    return res;
  }

  // ---------- HTTP ----------
  async function api(method, path, body) {
    if (!(await ensureKeys())) return { ok: false, code: 'NO_KEY' };
    const opt = { method, headers: { 'x-couple-auth': authKey } };
    if (body) {
      opt.headers['content-type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await global.fetch(API + path, opt);
    } catch (e) {
      return { ok: false, code: 'NETWORK', network: true };
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || !data || data.ok === false) {
      return { ok: false, code: (data && data.code) || 'HTTP_' + res.status, status: res.status };
    }
    return data;
  }

  // ---------- outbox ----------
  function eidOf(kind, data) {
    const d = data || {};
    return (d.id || d.bookId || '') + '';
  }

  /**
   * 入队。**不加密、不联网**，只排。
   * 同一条实体只留最后状态：add → update → remove 会被压成一条 remove。
   */
  function outboxPush(op) {
    try {
      if (!op || !op.kind) return false;
      const kind = normalizeKind(op.kind);
      const head = kind.split('.')[0];
      if (!ALLOW[head]) return false;             // 白名单兜底

      const s = state();
      if (!s.room || !s.secret) return false;     // 没配对就不排队

      const data = op.data || {};
      const eid = eidOf(kind, data);
      if (!eid) return false;

      const entry = {
        id: op.id || (crypto.randomUUID ? crypto.randomUUID() : 'op' + Date.now() + Math.random()),
        eid,
        kind,
        data,
        ts: Number(op.ts) || Date.now(),
        tries: 0,
      };

      const i = s.outbox.findIndex((x) => x.eid === eid);
      if (i >= 0) {
        const old = s.outbox[i];
        entry.id = old.id;          // 复用 opId：同一条实体的多次改动只占一个服务端幂等键
        entry.tries = old.tries;
        s.outbox[i] = entry;
      } else {
        s.outbox.push(entry);
        while (s.outbox.length > MAX_OUTBOX) s.outbox.shift();
      }
      persist();
      schedule();
      return true;
    } catch (e) {
      return false;   // 同步坏了不能影响记账
    }
  }

  /** 'tx.add' → 'cptx.add'（store.js 旧调用点的兼容） */
  function normalizeKind(kind) {
    const k = String(kind);
    if (k.indexOf('tx.') === 0) return 'cptx.' + k.slice(3);
    return k;
  }

  /** 把 outbox 里最多 50 条推上去；成功才出队 */
  async function outboxFlush() {
    const s = state();
    if (!s.room || !s.secret) return false;
    if (!s.outbox.length) return true;
    if (!(await ensureKeys())) return false;

    const batch = s.outbox.slice(0, MAX_BATCH);
    const ops = [];
    for (const e of batch) {
      const cipher = await encryptOp({ p: PROTO, k: e.kind, d: e.data, t: e.ts }, e.id);
      if (!cipher) continue;
      ops.push({ opId: e.id, ts: e.ts, cipher });
    }
    if (!ops.length) return false;

    const body = { room: s.room, ops };
    if (!s.created) body.create = true;

    const res = await api('POST', '/push', body);
    if (!res.ok) {
      s.lastError = res.code || 'PUSH_FAILED';
      for (const e of batch) e.tries = (e.tries || 0) + 1;
      persist();
      return false;
    }

    if (res.created) s.created = true;
    const seqOf = {};
    (res.seqs || []).forEach((x) => { seqOf[x.opId] = x.seq; });

    const sent = new Set(ops.map((o) => o.opId));
    const accepted = [];
    batch.forEach((e) => {
      if (seqOf[e.id] != null) {
        s.ack[e.id] = seqOf[e.id];
        // 把推上去的内容一起回传：本地要按「服务端已经接受的那个版本」对齐，
        // 否则并发修改时本地会停在旧值（另一方却拿到新值），两台就分叉了
        accepted.push({ eid: e.eid, kind: e.kind, seq: seqOf[e.id], data: e.data });
      }
    });
    s.outbox = s.outbox.filter((e) => !sent.has(e.id));
    s.lastError = '';
    s.lastSyncAt = Date.now();
    persist();

    if (accepted.length && typeof global.CoupleSync.onAccepted === 'function') {
      try { global.CoupleSync.onAccepted(accepted); } catch (e) { /* 忽略 */ }
    }
    return true;
  }

  // ---------- pull ----------
  /**
   * 拉到 since 之后的变更并交给合并层。
   */
  async function pullSince(since) {
    const s = state();
    if (!s.room || !s.secret) return { ok: false, added: 0, dropped: 0, bad: 0, txNew: 0, code: 'NO_ROOM' };
    if (!(await ensureKeys())) return { ok: false, added: 0, dropped: 0, bad: 0, txNew: 0, code: 'NO_KEY' };

    // 第一次同步（刚配对完 / lastSyncAt 还是 0）拉到的全是对面已有的历史账，
    // 那不是「TA 刚记的 N 笔」—— 一次弹「刚记了 47 笔」只会把人吓到。
    const hadSynced = !!s.lastSyncAt;

    let cursor = Number(since) || 0;
    let added = 0;
    let dropped = 0;
    let bad = 0;
    let txNew = 0;
    let pages = 0;

    while (pages++ < MAX_PAGES) {
      const res = await api('GET', '/pull?room=' + s.room + '&since=' + cursor + '&limit=200');
      if (!res.ok) {
        // 房间还没建（第一次同步、还没 push 过）不是错误：
        // 紧接着的 outboxFlush 会用 create:true 把它建出来。
        // 这里若记成 lastError，状态灯会一上来就变黄，白吓用户一跳。
        if (res.code !== 'ROOM_NOT_FOUND') {
          s.lastError = res.code || 'PULL_FAILED';
          persist();
        }
        return { ok: false, added, dropped, bad, txNew, code: res.code || 'PULL_FAILED' };
      }

      const ops = [];
      for (const raw of res.ops || []) {
        const obj = await decryptOp(raw.cipher, raw.opId);
        if (!obj || !obj.k) { bad++; continue; }
        ops.push({ seq: raw.seq, opId: raw.opId, kind: obj.k, data: obj.d, ts: obj.t != null ? obj.t : raw.ts });
      }

      if (ops.length) {
        const r = apply(ops);
        added += r.changed || 0;
        dropped += r.dropped || 0;
        txNew += r.txNew || 0;
      }

      cursor = res.next != null ? res.next : cursor;
      s.lastSeq = cursor;
      s.lastSyncAt = Date.now();
      s.lastError = '';
      persist();

      if (!res.hasMore) break;
    }

    // 对方新记的账要能让界面知道（「TA 刚记了 N 笔」那条提示）。
    // 走窗口事件而不是直接调 ViewCouple：同步层不该知道界面长什么样，
    // 而且轮询是它自己发起的，app.js 那些调用点看不到返回值。
    if (hadSynced && txNew > 0) emitPeerTx(txNew);

    return { ok: true, added, dropped, bad, txNew };
  }

  /** 告诉界面「对方新记了 n 笔」。环境不支持事件（vm 沙箱）就静默跳过 */
  function emitPeerTx(n) {
    try {
      if (typeof global.dispatchEvent !== 'function' || typeof global.CustomEvent !== 'function') return;
      global.dispatchEvent(new global.CustomEvent('couple:peer-tx', { detail: { n } }));
    } catch (e) { /* 界面提示坏了不能影响同步 */ }
  }

  /** 交给 store.js 应用；没有 store（纯测试）就缓存起来 */
  let pendingOps = [];
  function apply(ops) {
    const fn = global.CoupleSync && global.CoupleSync.onRemote;
    if (typeof fn === 'function') {
      try { return fn(ops) || { changed: 0, dropped: 0 }; } catch (e) { return { changed: 0, dropped: 0 }; }
    }
    pendingOps = pendingOps.concat(ops);
    return { changed: 0, dropped: 0 };
  }

  function takePending() {
    const x = pendingOps;
    pendingOps = [];
    return x;
  }

  // ---------- 合并内核（纯函数，可单测） ----------
  /**
   * 只按 seq 合并。
   * - remove：记墓碑（取 max），摘实体
   * - add/update：墓碑 seq >= 本 op 的一律丢（挡乱序到达的旧改动）
   * - 其余按 seq 大者胜，实体上记 _seq
   *
   * @param {Array} list 实体数组（会被就地修改）
   * @param {Object} tomb 墓碑表 { [id]: seq }
   * @param {Array} ops [{seq, kind, data}]
   */
  function mergeList(list, tomb, ops) {
    let changed = 0;
    let dropped = 0;
    // 传进来的不是数组就当作「这个集合不存在」，不要凭空造一个再假装应用成功
    if (!Array.isArray(list)) return { changed: 0, dropped: 0 };
    const arr = list;
    const t = tomb || {};
    const sorted = (ops || []).slice().sort((a, b) => a.seq - b.seq);

    for (const op of sorted) {
      const kind = String(op.kind || '');
      const d = op.data || {};
      const id = d.id;
      if (!id) continue;

      if (REMOVE_KINDS[kind]) {
        if (!(t[id] >= op.seq)) t[id] = op.seq;
        const i = arr.findIndex((x) => x && x.id === id);
        if (i >= 0) { arr.splice(i, 1); changed++; }
        continue;
      }

      if (t[id] != null && op.seq <= t[id]) { dropped++; continue; }

      const i = arr.findIndex((x) => x && x.id === id);
      if (i < 0) {
        arr.push(Object.assign({}, d, { _seq: op.seq }));
        changed++;
      } else if (op.seq > (arr[i]._seq || 0)) {
        arr[i] = Object.assign({}, d, { _seq: op.seq });
        changed++;
      }
    }
    return { changed, dropped };
  }

  // ---------- 同步节奏 ----------
  let timer = null;
  let running = false;
  let polling = false;

  function schedule() {
    if (running || timer) return;
    if (typeof global.setTimeout !== 'function') return;
    timer = global.setTimeout(() => {
      timer = null;
      syncOnce().catch(() => {});
    }, DEBOUNCE);
  }

  /** 一次完整同步：先拉后推（冷启动先拉，别用旧状态覆盖对方） */
  async function syncOnce() {
    const s = state();
    if (!s.room || !s.secret) return { ok: false, code: 'NO_ROOM' };
    if (running) return { ok: false, code: 'BUSY' };
    running = true;
    try {
      // 先拉后推（冷启动先拉，别用旧状态覆盖对方）
      const pull = await pullSince(s.lastSeq);
      // 房间还不存在时 pull 必然 404 —— 那是「还没建房」，不是「同步失败」
      const pullOk = pull.ok || pull.code === 'ROOM_NOT_FOUND';
      const push = await outboxFlush();
      return { ok: pullOk && push !== false, pull, push };
    } catch (e) {
      s.lastError = 'EXCEPTION';
      persist();
      return { ok: false, code: 'EXCEPTION' };
    } finally {
      running = false;
    }
  }

  /** 前台轮询：页面隐藏时停 */
  function startPolling() {
    if (polling) return;
    polling = true;
    if (typeof global.setInterval !== 'function') return;
    global.setInterval(() => {
      const doc = global.document;
      if (doc && doc.visibilityState === 'hidden') return;
      if (global.navigator && global.navigator.onLine === false) return;
      syncOnce().catch(() => {});
    }, POLL_MS);
  }

  // ---------- 对外 ----------
  function ready() {
    const s = state();
    return !!(s.room && s.secret);
  }

  function status() {
    const s = state();
    const online = !global.navigator || global.navigator.onLine !== false;
    let st = 'off';
    if (s.room && s.secret) st = online ? 'idle' : 'offline';
    if (running) st = 'syncing';
    else if (s.room && s.lastError && Date.now() - (s.lastSyncAt || 0) < 60000) st = 'error';
    return {
      ready: ready(),
      state: st,
      proto: PROTO,
      outbox: s.outbox.length,
      pending: s.outbox.length,
      seq: s.lastSeq,
      lastSyncAt: s.lastSyncAt,
      dropped: s.dropped,
      room: s.room,
      text:
        st === 'off' ? '只在本机'
        : st === 'syncing' ? '同步中'
        : st === 'error' ? '同步出错'
        : st === 'offline' ? '离线'
        : '已同步',
    };
  }

  /** store.js 的调用点。这里必须【永不抛错】 */
  function hook(event) {
    try {
      if (!event || !event.kind) return false;
      return outboxPush({
        id: event.opId,
        kind: event.kind,
        ts: event.ts,
        data: event.data || event.payload || null,
      });
    } catch (e) {
      return false;
    }
  }

  const CS = {
    PROTO,
    KEY,
    OUTBOX_KEY,
    SEQ_KEY,
    API,
    apiBaseFor,
    ready,
    deriveKey,
    encrypt,
    decrypt,
    encryptOp,
    decryptOp,
    pair,
    pairString,
    parsePair,
    join,
    leave,
    removeRoom,
    outboxPush,
    outboxFlush,
    pullSince,
    syncOnce,
    startPolling,
    mergeList,
    takePending,
    hook,
    status,
    state,
    _persist: persist,
    _reset() {
      if (timer) { global.clearTimeout(timer); timer = null; }
      S = null;
      encKey = null;
      authKey = '';
      pendingOps = [];
      running = false;
    },
    onRemote: null,
    onAccepted: null,
  };

  // store.js 在 index.html 里先加载（第 94 行），这里把合并与回执接上。
  // 用能力检测而不是直接引用，是为了这个文件单独加载（测试 / 老缓存）时不炸。
  if (global.Store && typeof global.Store.applyRemoteOps === 'function') {
    CS.onRemote = global.Store.applyRemoteOps;
    CS.onAccepted = global.Store.syncAccepted;
  }

  global.CoupleSync = CS;
})(typeof window !== 'undefined' ? window : globalThis);
