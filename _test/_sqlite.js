/**
 * node:sqlite 需要 --experimental-sqlite。
 *
 * run-all 是用 `node <套件>` 裸起的，不会带这个flag。所以这里做一次
 * 自重启：检测到没带 flag，就带上 flag 把「当前主模块」重新跑一遍，
 * 把子进程的输出和退出码原样传回去。
 *
 * 用法：在所有 require 之前，第一行 require('./_sqlite');
 */
'use strict';
const { spawnSync } = require('child_process');

if (process.execArgv.indexOf('--experimental-sqlite') < 0) {
  const main = require.main && require.main.filename;
  if (!main) {
    console.error('无法确定入口文件，不能自动加 --experimental-sqlite');
    process.exit(1);
  }
  const r = spawnSync(process.execPath, ['--experimental-sqlite'].concat(process.execArgv, [main]), {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  process.exit(r.status == null ? 1 : r.status);
}

module.exports = {};
