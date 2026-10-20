/**
 * 极简 PDF 文本提取（给「导入账单」用）
 *
 * 为什么自己写：账单导入要离线、要能在 APK 里跑，不能为了读一页流水塞进
 * 一整套 pdf.js（几百 KB + worker）。银行流水 PDF 的排版很规整：
 * 一页里就是「文本块按坐标摆好」，我们只要把文字连同位置抠出来，
 * 按 y 聚成行、按 x 间距切成列，就能喂给现有的表头识别。
 *
 * 支持：
 *   - 未压缩 / FlateDecode（zlib）内容流
 *   - Type0 + Identity-H（中文 CMap）与简单字体，靠 /ToUnicode 还原
 *   - Tj / TJ / ' / " 四种显示文字的操作符，Tm / Td / TD / T* 定位
 * 不支持（会明确告诉用户）：
 *   - 扫描件（整页是图片，没有文字层）→ 建议用「识图导入」
 *   - 加密 PDF
 */
(function (global) {
  'use strict';

  const latin1 = (bytes) => {
    let s = '';
    const CH = 8192;
    for (let i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return s;
  };

  const hexToBytes = (hex) => {
    const h = String(hex).replace(/[^0-9A-Fa-f]/g, '');
    const out = new Uint8Array(Math.ceil(h.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2) || '0', 16);
    return out;
  };

  /** UTF-16BE 的十六进制串 → 字符串（中文 CMap 的目标就是这个） */
  const hexToText = (hex) => {
    const h = String(hex).replace(/[^0-9A-Fa-f]/g, '');
    let s = '';
    for (let i = 0; i + 3 < h.length + 1; i += 4) {
      const code = parseInt(h.substr(i, 4), 16);
      if (!isNaN(code)) s += String.fromCharCode(code);
    }
    return s;
  };

  const hex4 = (n) => ('000' + (n & 0xffff).toString(16).toUpperCase()).slice(-4);
  const hex2 = (n) => ('0' + (n & 0xff).toString(16).toUpperCase()).slice(-2);

  async function inflate(data) {
    if (typeof DecompressionStream !== 'function') return null;
    try {
      const st = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(st).arrayBuffer());
    } catch (e) {
      return null;
    }
  }

  /** 解析 ToUnicode CMap：<src> <dst> 与 <lo> <hi> <dst|[...]> */
  function parseCMap(text) {
    const map = new Map();
    let m;
    const bfchar = /begincmap[\s\S]*?endcmap/.test(text) ? text : text; // 兼容不带 begin/end 的
    const cRe = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = cRe.exec(bfchar))) {
      const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g;
      let p;
      while ((p = pairRe.exec(m[1]))) map.set(p[1].toUpperCase(), hexToText(p[2]));
    }
    const rRe = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = rRe.exec(bfchar))) {
      const body = m[1];
      const one = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      let p;
      while ((p = one.exec(body))) {
        const lo = parseInt(p[1], 16);
        const hi = parseInt(p[2], 16);
        const dst = parseInt(p[3], 16);
        if (!isFinite(lo) || !isFinite(hi) || hi < lo || hi - lo > 65535) continue;
        for (let c = lo; c <= hi; c++) map.set(hex4(c), String.fromCharCode(dst + (c - lo)));
      }
      const many = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
      let q;
      while ((q = many.exec(body))) {
        const lo = parseInt(q[1], 16);
        const items = q[3].match(/<([0-9A-Fa-f]*)>/g) || [];
        items.forEach((it, i) => {
          map.set(hex4(lo + i), hexToText(it.slice(1, -1)));
        });
      }
    }
    return map;
  }

  /** PDF 字符串（字面量或十六进制）→ 字节 */
  function stringBytes(operand) {
    if (operand.hex != null) return hexToBytes(operand.hex);
    if (operand.str != null) {
      const s = operand.str;
      const out = [];
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch !== '\\') { out.push(s.charCodeAt(i) & 0xff); continue; }
        const n = s[++i];
        if (n === 'n') out.push(10);
        else if (n === 'r') out.push(13);
        else if (n === 't') out.push(9);
        else if (n === 'b') out.push(8);
        else if (n === 'f') out.push(12);
        else if (n === '(' || n === ')' || n === '\\') out.push(n.charCodeAt(0));
        else if (n >= '0' && n <= '7') {
          let oct = n;
          for (let k = 0; k < 2 && s[i + 1] >= '0' && s[i + 1] <= '7'; k++) oct += s[++i];
          out.push(parseInt(oct, 8) & 0xff);
        } else if (n === '\n') { /* 续行 */ }
        else if (n != null) out.push(n.charCodeAt(0) & 0xff);
      }
      return new Uint8Array(out);
    }
    return new Uint8Array(0);
  }

  /** 按字体的编码解释字节 → 文字 */
  function decodeText(bytes, font) {
    if (!bytes.length) return '';
    if (font && font.toUnicode && font.toUnicode.size) {
      let out = '';
      if (font.twoByte) {
        for (let i = 0; i + 1 < bytes.length; i += 2) {
          const key = hex4((bytes[i] << 8) | bytes[i + 1]);
          const v = font.toUnicode.get(key);
          if (v != null) out += v;
        }
      } else {
        for (let i = 0; i < bytes.length; i++) {
          const v = font.toUnicode.get(hex2(bytes[i]));
          if (v != null) out += v;
        }
      }
      return out;
    }
    // 没有 ToUnicode：2 字节按 UTF-16BE 赌一把（中文 PDF 常见），单字节按 Latin-1
    if (font && font.twoByte) {
      let out = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        if (code > 0x4e00 && code < 0x9fff) out += String.fromCharCode(code);
      }
      if (out) return out;
    }
    return latin1(bytes);
  }

  /** 极简内容流扫描：只关心文字与定位 */
  function parseContent(cs, fonts, out) {
    let i = 0;
    const ops = [];
    let font = null;
    let size = 10;
    let leading = 0;
    let tm = [1, 0, 0, 1, 0, 0];

    const num = () => {
      const start = i;
      while (i < cs.length && /[-+0-9.]/.test(cs[i])) i++;
      return Number(cs.slice(start, i));
    };

    while (i < cs.length) {
      const ch = cs[i];
      if (ch === '%') { while (i < cs.length && cs[i] !== '\n') i++; continue; }
      if (ch === '(') {
        let depth = 1, j = i + 1, str = '';
        while (j < cs.length && depth > 0) {
          const c = cs[j];
          if (c === '\\') { str += cs[j] + (cs[j + 1] || ''); j += 2; continue; }
          if (c === '(') depth++;
          else if (c === ')') { depth--; if (!depth) break; }
          str += c; j++;
        }
        ops.push({ str }); i = j + 1; continue;
      }
      if (ch === '<' && cs[i + 1] !== '<') {
        let j = i + 1;
        while (j < cs.length && cs[j] !== '>') j++;
        ops.push({ hex: cs.slice(i + 1, j) }); i = j + 1; continue;
      }
      if (ch === '[') {
        // TJ 的数组：里面的字符串按顺序拼，数字是字距，忽略
        let j = i + 1, depth = 1;
        const start = j;
        while (j < cs.length && depth > 0) {
          if (cs[j] === '[') depth++;
          else if (cs[j] === ']') depth--;
          if (depth) j++;
        }
        ops.push({ arr: cs.slice(start, j) }); i = j + 1; continue;
      }
      if (ch === '/') {
        let j = i + 1;
        while (j < cs.length && !/[\s\/\[\]<>()%]/.test(cs[j])) j++;
        ops.push({ name: cs.slice(i, j) }); i = j; continue;
      }
      if (/[-+0-9.]/.test(ch)) { ops.push({ num: num() }); continue; }
      if (/[A-Za-z'"*]/.test(ch)) {
        let j = i;
        while (j < cs.length && /[A-Za-z'"*]/.test(cs[j])) j++;
        const op = cs.slice(i, j);
        i = j;
        // BI ... ID ... EI：内嵌图片，整段跳过
        if (op === 'BI') {
          const id = cs.indexOf('ID', i);
          const ei = cs.indexOf('EI', id < 0 ? i : id);
          i = ei < 0 ? cs.length : ei + 2;
          ops.length = 0;
          continue;
        }
        handle(op, ops);
        ops.length = 0;
        continue;
      }
      i++;
    }

    function handle(op, o) {
      const nums = o.filter((x) => x.num != null).map((x) => x.num);
      const last = o[o.length - 1];
      switch (op) {
        case 'BT': tm = [1, 0, 0, 1, 0, 0]; break;
        case 'Tf': {
          // 字体名是倒数第二个操作数（最后一个是字号）
          const nameOp = o.filter((x) => x.name).pop();
          if (nameOp) font = fonts[nameOp.name] || null;
          if (nums.length) size = nums[nums.length - 1];
          break;
        }
        case 'TL': if (nums.length) leading = nums[nums.length - 1]; break;
        case 'Tm':
          if (nums.length >= 6) tm = nums.slice(-6);
          break;
        case 'Td':
        case 'TD':
          if (nums.length >= 2) {
            const tx = nums[nums.length - 2], ty = nums[nums.length - 1];
            tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + tx * tm[0] + ty * tm[2], tm[5] + tx * tm[1] + ty * tm[3]];
            if (op === 'TD') leading = -ty;
          }
          break;
        case 'T*':
          tm = [tm[0], tm[1], tm[2], tm[3], tm[4] - leading * tm[2], tm[5] - leading * tm[3]];
          break;
        case 'Tj':
        case "'":
        case '"': {
          if (op !== 'Tj') {
            tm = [tm[0], tm[1], tm[2], tm[3], tm[4] - leading * tm[2], tm[5] - leading * tm[3]];
          }
          const strOp = o.filter((x) => x.str != null || x.hex != null).pop();
          if (strOp) show(strOp);
          break;
        }
        case 'TJ': {
          const arrOp = o.filter((x) => x.arr != null).pop();
          if (arrOp) {
            const inner = arrOp.arr.match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>/g) || [];
            inner.forEach((s) => {
              if (s[0] === '<') show({ hex: s.slice(1, -1) });
              else show({ str: s.slice(1, -1) });
            });
          }
          break;
        }
        default: break;
      }
    }

    function show(operand) {
      const bytes = stringBytes(operand);
      const text = decodeText(bytes, font);
      if (!text) return;
      out.push({ x: tm[4], y: tm[5], size: size || 10, text });
      // 粗略推进 x：中文按 1 个字宽，英文按 0.55
      const width = text.split('').reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 1 : 0.55), 0);
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + width * (size || 10) * tm[0], tm[5] + width * (size || 10) * tm[1]];
    }
  }

  /** 把散落的文字块按 y 聚成行、按 x 间距切成列 */
  function toRows(runs) {
    if (!runs.length) return [];
    // y 向下取整到 2pt，避免基线差一点点就被拆成两行
    const lines = new Map();
    runs.forEach((r) => {
      const key = Math.round(r.y / 2) * 2;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(r);
    });
    const rows = [];
    [...lines.keys()].sort((a, b) => b - a).forEach((y) => {
      const items = lines.get(y).sort((a, b) => a.x - b.x);
      let text = '';
      let prevEnd = null;
      items.forEach((it) => {
        const size = it.size || 10;
        const w = it.text.split('').reduce((s, c) => s + (c.charCodeAt(0) > 0x2e80 ? 1 : 0.55), 0) * size;
        if (prevEnd != null && it.x - prevEnd > size * 0.9) text += '\u0001';   // 列分隔
        text += it.text;
        prevEnd = it.x + w;
      });
      const cells = text.split('\u0001').map((s) => s.replace(/\s+/g, ' ').trim());
      if (cells.some((c) => c)) rows.push(cells);
    });
    return rows;
  }

  /**
   * @param {ArrayBuffer} buf
   * @returns {Promise<Array<Array<string>>>} 行 × 列
   */
  async function toRowsFromBuffer(buf) {
    const bytes = new Uint8Array(buf);
    const head = latin1(bytes.subarray(0, 1024));
    if (head.indexOf('%PDF') < 0) throw new Error('这不是 PDF 文件');
    if (/\/Encrypt\b/.test(latin1(bytes.subarray(0, 4096))) || /trailer[\s\S]{0,300}\/Encrypt/.test(latin1(bytes.subarray(Math.max(0, bytes.length - 4096))))) {
      throw new Error('这个 PDF 加了密码，先在电脑上打开并「另存为」去掉密码，再导入。');
    }

    const src = latin1(bytes);
    // 对象表
    const objs = new Map();
    const objRe = /(\d+)\s+\d+\s+obj\b/g;
    let m;
    while ((m = objRe.exec(src))) {
      const num = Number(m[1]);
      const bodyStart = m.index + m[0].length;
      const endObj = src.indexOf('endobj', bodyStart);
      const body = src.slice(bodyStart, endObj < 0 ? src.length : endObj);
      const sm = /stream\r\n|stream\n|stream\r/.exec(body);
      if (sm) {
        const dataStart = bodyStart + sm.index + sm[0].length;
        let dataEnd = src.indexOf('endstream', dataStart);
        if (dataEnd < 0) dataEnd = src.length;
        // 「stream … \nendstream」里那个换行不属于数据；带着它解压会直接报错
        while (dataEnd > dataStart && (bytes[dataEnd - 1] === 0x0a || bytes[dataEnd - 1] === 0x0d)) dataEnd--;
        // 有 /Length 就按它切，最准
        const lm = /\/Length\s+(\d+)/.exec(body.slice(0, sm.index));
        if (lm) {
          const len = Number(lm[1]);
          if (len > 0 && dataStart + len <= bytes.length) dataEnd = dataStart + len;
        }
        objs.set(num, { dict: body.slice(0, sm.index), data: bytes.subarray(dataStart, dataEnd) });
      } else {
        objs.set(num, { dict: body, data: null });
      }
    }

    // 字体：资源名 → { toUnicode, twoByte }
    const fonts = {};
    for (const [num, o] of objs) {
      if (!/\/Type\s*\/Font/.test(o.dict)) continue;
      let map = null;
      const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.dict);
      if (tu && objs.has(Number(tu[1]))) {
        const raw = objs.get(Number(tu[1])).data;
        if (raw) {
          const inf = await inflate(raw);
          const text = inf ? latin1(inf) : latin1(raw);
          if (text.indexOf('beginbfchar') >= 0 || text.indexOf('beginbfrange') >= 0) map = parseCMap(text);
        }
      }
      fonts[num] = { toUnicode: map, twoByte: /\/Identity-H|\/Type0/.test(o.dict) };
    }

    // 页面 /Resources /Font << /F1 5 0 R /F2 6 0 R >>
    const byName = {};
    const resRe = /\/Font\s*<<([\s\S]{0,2000}?)>>/g;
    while ((m = resRe.exec(src))) {
      const pairRe = /\/([A-Za-z0-9]+)\s+(\d+)\s+\d+\s+R/g;
      let p;
      while ((p = pairRe.exec(m[1]))) byName['/' + p[1]] = fonts[Number(p[2])] || null;
    }

    const runs = [];
    for (const [, o] of objs) {
      if (!o.data) continue;
      if (/\/Subtype\s*\/Image/.test(o.dict)) continue;
      const inf = await inflate(o.data);
      const cs = inf ? latin1(inf) : null;
      if (!cs) continue;
      if (cs.indexOf('BT') < 0 || (!/\bTj\b|\bTJ\b/.test(cs) && cs.indexOf("'") < 0)) continue;
      try { parseContent(cs, byName, runs); } catch (e) { /* 单页坏了不影响其它页 */ }
    }
    return toRows(runs);
  }

  global.PDFText = { toRows: toRowsFromBuffer, parseCMap, hexToText };
})(window);
