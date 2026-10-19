/**
 * 同步测试夹具：把「真 Functions + 真 SQLite」和「真 couple-sync.js」接起来。
 *
 * 一台设备 = 一个 vm 沙箱 + 一个 localStorage + 一条指向本地 server 的 fetch。
 * 这样测出来的东西和线上一致：客户端真的加密、服务端真的验 auth、SQLite 真的分配 seq。
 *
 * 注意：沙箱里的定时器被换成了空实现，避免 800ms 防抖在测试里自己触发导致不稳定。
 * 要推要拉就显式调 syncOnce() —— 测试要确定性。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { makeDB } = require('./_d1');

const ROOT = path.join(__dirname, '..');
const FN_DIR = path.join(ROOT, 'functions', 'api', 'couple');

/** 起一个「服务端」：真 SQLite + 真 handler */
async function makeServer() {
  const db = makeDB(path.join(ROOT, 'schema.sql'));
  const env = { DB: db };

  const mods = {
    push: await import(pathToFileURL(path.join(FN_DIR, 'push.js')).href),
    pull: await import(pathToFileURL(path.join(FN_DIR, 'pull.js')).href),
    room: await import(pathToFileURL(path.join(FN_DIR, 'room.js')).href),
    health: await import(pathToFileURL(path.join(FN_DIR, 'health.js')).href),
  };

  const stat = { calls: 0, offline: false, lastPath: '' };

  async function fetchFn(url, init) {
    stat.calls++;
    if (stat.offline) throw new Error('NETWORK_DOWN');
    const u = new URL(String(url), 'http://local.test');
    stat.lastPath = u.pathname + u.search;
    const req = new Request(u.toString(), init || {});
    const ctx = { request: req, env };

    if (u.pathname.endsWith('/api/couple/health')) return mods.health.onRequestGet(ctx);
    if (u.pathname.endsWith('/api/couple/push')) return mods.push.onRequestPost(ctx);
    if (u.pathname.endsWith('/api/couple/pull')) return mods.pull.onRequestGet(ctx);
    if (u.pathname.endsWith('/api/couple/room')) return mods.room.onRequestDelete(ctx);

    return new Response(JSON.stringify({ ok: false, code: 'NO_ROUTE' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  return {
    db,
    env,
    mods,
    fetchFn,
    stats: stat,
    setOffline(v) { stat.offline = !!v; },
    /** 直接读库，用来断言「服务端真的没存明文」 */
    rows(sql, ...args) {
      return db.raw.prepare(sql).all(...args).map((r) => Object.assign({}, r));
    },
  };
}

/** 一台「手机」：vm 沙箱里跑真实的 couple-sync.js */
function makeDevice(server) {
  const box = new Map();
  const localStorage = {
    getItem: (k) => (box.has(k) ? box.get(k) : null),
    setItem: (k, v) => { box.set(k, String(v)); },
    removeItem: (k) => { box.delete(k); },
    clear: () => box.clear(),
    get length() { return box.size; },
    key: (i) => Array.from(box.keys())[i] || null,
  };

  const noopTimer = () => 0;
  const sandbox = {
    localStorage,
    crypto: crypto.webcrypto,
    TextEncoder,
    TextDecoder,
    fetch: server && server.fetchFn ? server.fetchFn : () => { throw new Error('NO_NETWORK'); },
    navigator: { onLine: true },
    document: { visibilityState: 'visible' },
    setTimeout: noopTimer,
    clearTimeout: noopTimer,
    setInterval: noopTimer,
    clearInterval: noopTimer,
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'couple-sync.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'couple-sync.js' });

  const CS = sandbox.CoupleSync;
  if (!CS) throw new Error('couple-sync.js 没有挂上 window.CoupleSync');

  const dev = {
    CS,
    sandbox,
    localStorage,
    /** 模拟「这台手机上的账本」：合并结果落在这里 */
    txs: [],
    tomb: {},
    /** 在设备上记一笔 */
    add(id, amount, note) {
      const t = { id, type: 'expense', amount, catId: 'food', note: note || '', ts: 1730000000000, cpBookId: 'cp1' };
      this.txs.push(t);
      CS.hook({ kind: 'cptx.add', data: t, ts: t.ts });
      return t;
    },
    edit(id, patch) {
      const t = this.txs.find((x) => x.id === id);
      if (!t) return null;
      Object.assign(t, patch, { updatedAt: Date.now() });
      CS.hook({ kind: 'cptx.update', data: t, ts: t.ts });
      return t;
    },
    remove(id) {
      const i = this.txs.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const [t] = this.txs.splice(i, 1);
      // 与 store.cpRemoveTx 对齐：本地删除也要落墓碑，否则下次 pull 会把
      // 自己的旧 add 拉回来、把这笔复活
      if (t && t._seq != null) this.tomb[id] = Math.max(this.tomb[id] || 0, t._seq);
      CS.hook({ kind: 'cptx.remove', data: t, ts: t.ts });
      return t;
    },
    /** 手动跑一次合并（对应 store.applyRemoteOps） */
    merge(ops) {
      const r = CS.mergeList(this.txs, this.tomb, ops);
      // 与 store.applyRemoteOps 对齐：对方删掉的，本机待发项一并放弃并计数
      const s = CS.state();
      let purged = 0;
      (ops || []).forEach((op) => {
        if (op.kind === 'cptx.remove' && op.data && op.data.id) {
          const before = s.outbox.length;
          s.outbox = s.outbox.filter((e) => e.eid !== op.data.id);
          purged += before - s.outbox.length;
        }
      });
      if (purged) {
        s.dropped = (s.dropped || 0) + purged;
        CS._persist();
      }
      return { changed: r.changed, dropped: r.dropped + purged };
    },
    load() {
      return CS.state();
    },
  };

  // 对端来的 op 落到本设备的账本上；自己推成功的 op 回填 _seq
  CS.onRemote = (ops) => dev.merge(ops);
  CS.onAccepted = (list) => {
    (list || []).forEach((x) => {
      const seq = Number(x.seq) || 0;
      const isRemove = /\.(remove|wipe)$/.test(String(x.kind || ''));
      const i = dev.txs.findIndex((y) => y.id === x.eid);
      if (isRemove) {
        if (!(dev.tomb[x.eid] >= seq)) dev.tomb[x.eid] = seq;
        if (i >= 0) dev.txs.splice(i, 1);
        return;
      }
      if (i < 0) {
        if (x.data) dev.txs.push(Object.assign({}, x.data, { _seq: seq }));
      } else if (x.data) {
        dev.txs[i] = Object.assign({}, x.data, { _seq: seq });
      } else {
        dev.txs[i]._seq = Math.max(dev.txs[i]._seq || 0, seq);
      }
    });
  };

  return dev;
}

/** 生成一对配对串（直接调客户端实现，保证和线上同一套字节序） */
function makePair(dev) {
  const pair = dev.CS.pair();
  return { pair, parsed: dev.CS.parsePair(pair) };
}

module.exports = { makeServer, makeDevice, makePair, ROOT };
