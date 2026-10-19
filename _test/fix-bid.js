const fs = require('fs');
const f = 'assets/js/store.js';
let s = fs.readFileSync(f, 'utf8');
const subs = [
  ["bookId: input.bookId || activeBookId(),", "bookId: input.bookId || writeBookId(),"],
  ["const bid = bookId || activeBookId();", "const bid = bookId || writeBookId();"],
  ["if (t.bookId && t.bookId !== activeBookId()) continue;", "if (t.bookId && t.bookId !== writeBookId()) continue;"],
  ["state.tx.forEach((t) => { if (t.bookId === activeBookId()) has[U.ymd(t.ts)] = true; });", "state.tx.forEach((t) => { if (t.bookId === writeBookId()) has[U.ymd(t.ts)] = true; });"],
];
let n = 0;
subs.forEach(([a, b]) => { const c = s.split(a).length - 1; if (c) { s = s.split(a).join(b); n += c; } });
fs.writeFileSync(f, s);
console.log('replaced', n);
