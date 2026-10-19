/* ============================================================
 * 记账本 · 轻量图表（纯 SVG，无第三方库）
 * ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;

  function polar(cx, cy, r, deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(cx, cy, rOuter, rInner, start, end) {
    const large = end - start > 180 ? 1 : 0;
    const p1 = polar(cx, cy, rOuter, start);
    const p2 = polar(cx, cy, rOuter, end);
    const p3 = polar(cx, cy, rInner, end);
    const p4 = polar(cx, cy, rInner, start);
    return [
      `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
      `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
      'Z',
    ].join(' ');
  }

  /**
   * 环形图
   * data: [{ label, value, color }]
   */
  function donut(data, opts) {
    const o = Object.assign({ size: 168, thickness: 18, gap: 2.4, centerTop: '', centerSub: '', emptyColor: 'rgba(140,150,170,.18)' }, opts);
    const cx = o.size / 2, cy = o.size / 2;
    const rOuter = o.size / 2 - 2;
    const rInner = rOuter - o.thickness;
    const total = data.reduce((s, d) => s + d.value, 0);

    if (!total) {
      return `<svg class="chart-donut" viewBox="0 0 ${o.size} ${o.size}" width="${o.size}" height="${o.size}" role="img">
        <circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="${o.emptyColor}" stroke-width="${o.thickness}"/>
        <text x="${cx}" y="${cy + 6}" text-anchor="middle" class="donut-center">暂无</text>
      </svg>`;
    }

    let angle = 0;
    const segs = data.filter((d) => d.value > 0).map((d, i) => {
      const span = (d.value / total) * 360;
      const gap = data.filter((x) => x.value > 0).length > 1 ? o.gap : 0;
      const start = angle + gap / 2;
      const end = angle + span - gap / 2;
      angle += span;
      const mid = (start + end) / 2;
      const outer = polar(cx, cy, rOuter + 3, mid);
      const inner = polar(cx, cy, rInner - 3, mid);
      return `<path d="${arcPath(cx, cy, rOuter, rInner, Math.max(start, 0), Math.max(end, start + 0.6))}"
        fill="${d.color}" class="donut-seg" style="--i:${i};--mx:${((outer.x - inner.x) / 2).toFixed(1)}px;--my:${((outer.y - inner.y) / 2).toFixed(1)}px">
        <title>${U.escapeHtml(d.label)}</title>
      </path>`;
    }).join('');

    const top = o.centerTop
      ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-val">${o.centerTop}</text>` : '';
    const sub = o.centerSub
      ? `<text x="${cx}" y="${cy + 18}" text-anchor="middle" class="donut-sub">${o.centerSub}</text>` : '';

    return `<svg class="chart-donut" viewBox="0 0 ${o.size} ${o.size}" width="${o.size}" height="${o.size}" role="img">
      <circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="${o.emptyColor}" stroke-width="${o.thickness}"/>
      <g class="donut-segs">${segs}</g>
      ${top}${sub}
    </svg>`;
  }

  /**
   * 柱状趋势图（带平均线 + 预算线可选）
   * data: [{ day, amount, label }]
   */
  function bars(data, opts) {
    const o = Object.assign({
      w: 320, h: 132, pad: 8, bottom: 18, color: 'var(--brand)',
      avgLine: true, highlight: -1, labels: 5, gradient: true,
    }, opts);
    const max = Math.max.apply(null, data.map((d) => d.amount).concat([1]));
    const innerW = o.w - o.pad * 2;
    const innerH = o.h - o.bottom - o.pad;
    const n = data.length || 1;
    const step = innerW / n;
    const bw = Math.max(2.5, Math.min(step * 0.62, 16));
    const uid = 'g' + Math.random().toString(36).slice(2, 7);

    const barsHtml = data.map((d, i) => {
      const h = max ? Math.max(d.amount > 0 ? 2.5 : 0, (d.amount / max) * innerH) : 0;
      const x = o.pad + step * i + (step - bw) / 2;
      const y = o.pad + innerH - h;
      const active = i === o.highlight;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(bw / 2, 3).toFixed(1)}"
        fill="${active ? 'url(#${uid}hi)' : (o.gradient ? `url(#${uid})` : o.color)}" class="bar" style="--i:${i}">
        <title>${d.label || ''} ${U.money(d.amount)}</title></rect>`;
    }).join('');

    // 平均线
    let avg = '';
    if (o.avgLine) {
      const avgVal = data.reduce((s, d) => s + d.amount, 0) / Math.max(1, data.filter((d) => d.amount > 0).length || 1);
      const y = o.pad + innerH - (avgVal / max) * innerH;
      if (avgVal > 0) {
        avg = `<line x1="${o.pad}" x2="${o.w - o.pad}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"
          stroke="var(--warn)" stroke-width="1" stroke-dasharray="3 3" opacity=".65"/>`;
      }
    }

    // x 轴标签
    const labels = [];
    const count = Math.min(o.labels, n);
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i * (n - 1)) / Math.max(1, count - 1));
      const d = data[idx];
      if (!d) continue;
      labels.push(`<text x="${(o.pad + step * idx + step / 2).toFixed(1)}" y="${o.h - 4}" text-anchor="middle" class="bar-label">${d.day || d.label || ''}</text>`);
    }

    return `<svg class="chart-bars" viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--brand)" stop-opacity=".95"/>
          <stop offset="100%" stop-color="var(--brand)" stop-opacity=".35"/>
        </linearGradient>
        <linearGradient id="${uid}hi" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="1"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity=".5"/>
        </linearGradient>
      </defs>
      ${avg}${barsHtml}${labels.join('')}
    </svg>`;
  }

  /**
   * 折线/面积图
   * data: [{ day, amount }]
   */
  function line(data, opts) {
    const o = Object.assign({ w: 320, h: 120, pad: 10, bottom: 16, color: 'var(--brand)' }, opts);
    if (!data.length) return '';
    const max = Math.max.apply(null, data.map((d) => d.amount).concat([1]));
    const innerW = o.w - o.pad * 2;
    const innerH = o.h - o.bottom - o.pad;
    const n = data.length;
    const pts = data.map((d, i) => ({
      x: o.pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
      y: o.pad + innerH - (d.amount / max) * innerH,
      d,
    }));
    const uid = 'l' + Math.random().toString(36).slice(2, 7);

    let path = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      const cxp = (p0.x + p1.x) / 2;
      path += ` C ${cxp} ${p0.y}, ${cxp} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    const area = `${path} L ${pts[pts.length - 1].x} ${o.pad + innerH} L ${pts[0].x} ${o.pad + innerH} Z`;

    return `<svg class="chart-line" viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" role="img">
      <defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--brand)" stop-opacity=".28"/>
        <stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${uid})"/>
      <path d="${path}" fill="none" stroke="var(--brand)" stroke-width="2.2" stroke-linecap="round" class="line-path"/>
    </svg>`;
  }

  /**
   * 进度环
   */
  function ring(pct, opts) {
    const o = Object.assign({ size: 64, thickness: 6, color: 'var(--brand)', track: 'rgba(140,150,170,.2)', label: '' }, opts);
    const r = (o.size - o.thickness) / 2;
    const c = 2 * Math.PI * r;
    const p = U.clamp(pct, 0, 1);
    return `<svg class="chart-ring" width="${o.size}" height="${o.size}" viewBox="0 0 ${o.size} ${o.size}" role="img">
      <circle cx="${o.size / 2}" cy="${o.size / 2}" r="${r}" fill="none" stroke="${o.track}" stroke-width="${o.thickness}"/>
      <circle cx="${o.size / 2}" cy="${o.size / 2}" r="${r}" fill="none" stroke="${o.color}" stroke-width="${o.thickness}"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}"
        transform="rotate(-90 ${o.size / 2} ${o.size / 2})" class="ring-fill"/>
      ${o.label ? `<text x="${o.size / 2}" y="${o.size / 2 + 4}" text-anchor="middle" class="ring-label">${o.label}</text>` : ''}
    </svg>`;
  }

  /** 迷你环形（分类占比小图） */
  function miniRing(pct, color, size) {
    const s = size || 34;
    const th = 4;
    const r = (s - th) / 2;
    const c = 2 * Math.PI * r;
    const p = U.clamp(pct, 0, 1);
    return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" class="mini-ring">
      <circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="rgba(140,150,170,.18)" stroke-width="${th}"/>
      <circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${th}" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}" transform="rotate(-90 ${s / 2} ${s / 2})"/>
    </svg>`;
  }

  /** 同比柱状对比（两个周期的分类对比） */
  function compareBars(items, opts) {
    const o = Object.assign({ w: 320, h: 120, colorA: 'var(--brand)', colorB: 'rgba(140,150,170,.45)' }, opts);
    const max = Math.max.apply(null, items.map((i) => Math.max(i.a, i.b)).concat([1]));
    const rowH = o.h / Math.max(1, items.length);
    const barH = Math.min(6, rowH / 3.2);
    const labelW = 0;
    const innerW = o.w - labelW;
    return `<svg class="chart-compare" viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" role="img">
      ${items.map((it, i) => {
        const y = i * rowH + rowH / 2;
        const wa = (it.a / max) * innerW;
        const wb = (it.b / max) * innerW;
        return `<g>
          <rect x="0" y="${(y - barH - 1.5).toFixed(1)}" width="${Math.max(1, wb).toFixed(1)}" height="${barH}" rx="${barH / 2}" fill="${o.colorB}"/>
          <rect x="0" y="${(y + 1.5).toFixed(1)}" width="${Math.max(1, wa).toFixed(1)}" height="${barH}" rx="${barH / 2}" fill="${o.colorA}"/>
          <title>${U.escapeHtml(it.label)} 本期 ${U.money(it.a)} / 上期 ${U.money(it.b)}</title>
        </g>`;
      }).join('')}
    </svg>`;
  }

  global.Charts = { donut, bars, line, ring, miniRing, compareBars };
})(window);
