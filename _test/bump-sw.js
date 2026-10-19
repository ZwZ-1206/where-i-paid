const fs = require('fs');
let s = fs.readFileSync('sw.js', 'utf8');
s = s.replace("const CACHE = 'jizhang-v1.6.0';", "const CACHE = 'jizhang-v1.7.0';");
s = s.replace("  './assets/js/ocr.js',", "  './assets/js/ocr.js',\n  './assets/js/extras.js',");
s = s.replace("  './assets/js/bills.js',", "  './assets/js/bills.js',\n  './assets/js/remind.js',");
fs.writeFileSync('sw.js', s);
console.log('sw updated');
