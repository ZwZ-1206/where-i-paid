const fs = require('fs');
const lines = fs.readFileSync('C:/Code/Jizhang/assets/js/view-couple.js', 'utf8').split('\n');
lines.forEach((l, i) => {
  const n = i + 1;
  // crude scan: bare word 'income' not property access / string / css class
  const re = /(^|[^.\w'"-])income([^_]?$|[^_\w])/;
  if (re.test(l)) {
    console.log(n + ': ' + l.trim().slice(0, 140));
  }
});
