// 把 index.html 的 GBK 双重编码修复回 UTF-8。
// 文件内容是「UTF-8 中文 → 被按 GBK 解码 → 再按 UTF-8 重写」的 mojibake。
// 修法：把文件文本按 GBK 编码回原始字节，即是原始 UTF-8。
const fs = require('fs');
const iconv = require('iconv-lite');

const p = 'C:/Code/Jizhang/index.html';
const raw = fs.readFileSync(p);
const text = raw.toString('utf8');
// 检测：正确 UTF-8 中文不应出现「鈥」「鑺」等 mojibake 特征
const isMojibake = /[鈥鑺鍎縷鏋佺]/.test(text);
if (!isMojibake) { console.log('looks fine already, no-op'); process.exit(0); }
const orig = iconv.encode(text, 'gbk'); // mojibake 文本按 GBK 编码回原始字节
// 校验：orig 应该是合法 UTF-8 且含「花哪儿了」
const check = orig.toString('utf8');
if (!check.includes('花哪儿了')) { console.log('GBK 回转失败，放弃'); process.exit(1); }
fs.writeFileSync(p, orig);
console.log('fixed, new len', orig.length);
console.log('sample:', check.slice(0, 80));
