/* 一键清理截图产出物。
 *
 * 为什么还要这个脚本：
 *   截图现在默认落在系统临时目录（`env.shots()`，见 _test/_env.js / 施工单 O1），
 *   但历史上它们写在 `_test/shots` 和 `_test/_shots`，两个目录累计过 42MB。
 *   换机器、拉旧分支、或者用旧脚本跑过一次，这两个目录就会重新长回来。
 *
 * 用法：
 *   node _test/clean-shots.js            # 删 _test/shots、_test/_shots 和临时目录里的截图
 *   node _test/clean-shots.js --dry      # 只看会删什么、占多少，不动手
 *
 * 只删「截图目录」，不碰任何脚本、日志、源码。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname);
const TMP_SHOTS = path.join(os.tmpdir(), 'jizhang-shots');
const TARGETS = [path.join(ROOT, 'shots'), path.join(ROOT, '_shots')];
const dry = process.argv.indexOf('--dry') >= 0;

function sizeOf(dir) {
  let total = 0;
  const walk = (d) => {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    es.forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; } catch (x) {} }
    });
  };
  walk(dir);
  return total;
}

function countPng(dir) {
  let n = 0;
  const walk = (d) => {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    es.forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(e.name)) n++;
    });
  };
  walk(dir);
  return n;
}

let freed = 0;
let removed = 0;
TARGETS.concat([TMP_SHOTS]).forEach((dir) => {
  if (!fs.existsSync(dir)) return;
  const bytes = sizeOf(dir);
  const files = countPng(dir);
  if (dry) {
    console.log(`  将删除 ${dir}  (${files} 张图, ${(bytes / 1048576).toFixed(1)} MB)`);
    freed += bytes;
    return;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`  已删除 ${dir}  (${files} 张图, ${(bytes / 1048576).toFixed(1)} MB)`);
    freed += bytes;
    removed++;
  } catch (e) {
    console.log(`  删除失败 ${dir}：${e.message}（可能有截图脚本正在跑）`);
  }
});

if (!freed) console.log('  没有截图目录，干净的');
else if (dry) console.log(`\n可回收 ${(freed / 1048576).toFixed(1)} MB（加 --dry 只是预览，去掉就真删）`);
else console.log(`\n已回收 ${(freed / 1048576).toFixed(1)} MB，共 ${removed} 个目录`);
