/**
 * D1 的最小适配器：用 Node 自带的 node:sqlite 跑真实 SQL。
 *
 * 为什么不用假的「按 SQL 字符串 if/else」桩：
 * 那只能证明我写的分支能过，证明不了 SQL 本身对。schema.sql 里的
 * `INSERT ... SELECT ... WHERE NOT EXISTS ... RETURNING` 是这套同步的
 * 幂等核心，必须让真 SQLite 执行它。
 *
 * 只实现 Functions 用到的四个方法：prepare / bind / first / all / run。
 * 需要 `node --experimental-sqlite`（Node 22.5+）。
 */
'use strict';
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

function makeDB(schemaPath) {
  const db = new DatabaseSync(':memory:');
  if (schemaPath) db.exec(fs.readFileSync(schemaPath, 'utf8'));

  return {
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) {
          args = a;
          return api;
        },
        async first() {
          const st = db.prepare(sql);
          const row = st.get(...args);
          return row ? Object.assign({}, row) : null;
        },
        async all() {
          const st = db.prepare(sql);
          return { results: st.all(...args).map((r) => Object.assign({}, r)) };
        },
        async run() {
          const st = db.prepare(sql);
          const info = st.run(...args);
          return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
        },
      };
      return api;
    },
    /** 测试里直接查，绕过适配层 */
    raw: db,
  };
}

module.exports = { makeDB };
