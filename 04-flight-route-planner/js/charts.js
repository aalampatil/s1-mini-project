/* charts.js – tiny dependency-free canvas charts (line, scatter, grouped bars) */
window.FRP = window.FRP || {};
FRP.charts = (function () {
  'use strict';
  const COL = { text: '#9db0cb', grid: 'rgba(148,163,184,.13)', axis: 'rgba(148,163,184,.38)', title: '#dbe6f5' };
  const palette = ['#38bdf8', '#fbbf24', '#34d399', '#f472b6', '#a78bfa', '#f87171'];
  const FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';

  function setup(canvas) {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(240, r.width), h = Math.max(160, r.height);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = FONT;
    return { ctx, w, h };
  }

  function fmt(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2).replace(/\.?0+$/, '');
    if (a === 0) return '0';
    return v.toPrecision(2).replace(/\.?0+$/, '');
  }

  function niceTicks(min, max, count) {
    if (max === min) { max = min + 1; }
    const span = max - min, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag, step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  function frame(S, o, xr, yr, X, Y, M, logX, logY, xTicks, yTicks) {
    const { ctx, w, h } = S;
    ctx.strokeStyle = COL.grid; ctx.fillStyle = COL.text; ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yTicks.forEach(t => {
      const y = Y(t);
      ctx.beginPath(); ctx.moveTo(M.l, y); ctx.lineTo(w - M.r, y); ctx.stroke();
      ctx.fillText(fmt(t), M.l - 6, y);
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xTicks.forEach(t => {
      const x = X(t);
      ctx.beginPath(); ctx.moveTo(x, M.t); ctx.lineTo(x, h - M.b); ctx.stroke();
      ctx.fillText(fmt(t), x, h - M.b + 5);
    });
    ctx.strokeStyle = COL.axis;
    ctx.beginPath(); ctx.moveTo(M.l, M.t); ctx.lineTo(M.l, h - M.b); ctx.lineTo(w - M.r, h - M.b); ctx.stroke();
    ctx.fillStyle = COL.text; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    if (o.xLabel) ctx.fillText(o.xLabel, M.l + (w - M.l - M.r) / 2, h - 3);
    if (o.yLabel) { ctx.save(); ctx.translate(12, M.t + (h - M.t - M.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top'; ctx.fillText(o.yLabel, 0, -4); ctx.restore(); }
    if (o.title) { ctx.fillStyle = COL.title; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '600 12px system-ui, sans-serif'; ctx.fillText(o.title, M.l, 4); ctx.font = FONT; }
  }

  function scales(S, M, xs, ys, o) {
    const { w, h } = S, logX = !!o.logX, logY = !!o.logY;
    let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    let xTicks, yTicks;
    const tx = v => (logX ? Math.log10(v) : v), ty = v => (logY ? Math.log10(v) : v);
    if (logX) { xmin = Math.floor(Math.log10(xmin)); xmax = Math.ceil(Math.log10(xmax)); if (xmax === xmin) xmax++; xTicks = []; for (let e = xmin; e <= xmax; e++) xTicks.push(Math.pow(10, e)); xmin = Math.pow(10, xmin); xmax = Math.pow(10, xmax); }
    else { if (o.xZero) xmin = Math.min(0, xmin); xTicks = niceTicks(xmin, xmax, 6); xmin = Math.min(xmin, xTicks[0]); xmax = Math.max(xmax, xTicks[xTicks.length - 1]); }
    if (logY) { ymin = Math.floor(Math.log10(Math.max(ymin, 1e-6))); ymax = Math.ceil(Math.log10(ymax)); if (ymax === ymin) ymax++; yTicks = []; for (let e = ymin; e <= ymax; e++) yTicks.push(Math.pow(10, e)); ymin = Math.pow(10, ymin); ymax = Math.pow(10, ymax); }
    else { if (o.yZero !== false) ymin = Math.min(0, ymin); yTicks = niceTicks(ymin, ymax, 5); ymin = Math.min(ymin, yTicks[0]); ymax = Math.max(ymax, yTicks[yTicks.length - 1]); }
    const X = v => M.l + ((tx(v) - tx(xmin)) / (tx(xmax) - tx(xmin) || 1)) * (w - M.l - M.r);
    const Y = v => h - M.b - ((ty(v) - ty(ymin)) / (ty(ymax) - ty(ymin) || 1)) * (h - M.t - M.b);
    return { X, Y, xTicks, yTicks, xmin, xmax, ymin, ymax };
  }

  function legend(S, items, M) {
    const { ctx, w } = S;
    ctx.font = FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    let x = w - M.r, y = 30;
    const widths = items.map(it => ctx.measureText(it.name).width + 22);
    const total = widths.reduce((a, b) => a + b, 0);
    x = Math.max(M.l, w - M.r - total);
    items.forEach((it, i) => {
      ctx.fillStyle = it.color; ctx.fillRect(x, y - 4, 10, 8);
      ctx.fillStyle = COL.text; ctx.fillText(it.name, x + 14, y);
      x += widths[i];
    });
  }

  /** series: [{name,color,pts:[[x,y],...]}] */
  function lineChart(canvas, o) {
    const S = setup(canvas), M = { l: 58, r: 14, t: 44, b: 38 };
    const all = o.series.flatMap(s => s.pts).filter(p => p[1] > 0 || !o.logY);
    if (!all.length) { S.ctx.fillStyle = COL.text; S.ctx.fillText('no data', 20, 30); return; }
    const sc = scales(S, M, all.map(p => p[0]), all.map(p => p[1]), o);
    frame(S, o, null, null, sc.X, sc.Y, M, o.logX, o.logY, sc.xTicks, sc.yTicks);
    const { ctx } = S;
    o.series.forEach(s => {
      const pts = s.pts.filter(p => p[1] > 0 || !o.logY);
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = 2;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath(); pts.forEach((p, i) => { const x = sc.X(p[0]), y = sc.Y(p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      ctx.setLineDash([]);
      pts.forEach(p => { ctx.beginPath(); ctx.arc(sc.X(p[0]), sc.Y(p[1]), 3, 0, 7); ctx.fill(); });
    });
    legend(S, o.series, M);
  }

  /** points: [{x,y,color,r,ring,label}]; stores screen positions in canvas._hit */
  function scatter(canvas, o) {
    const S = setup(canvas), M = { l: 66, r: 16, t: 44, b: 38 };
    if (!o.points.length) { S.ctx.fillStyle = COL.text; S.ctx.fillText('no data', 20, 30); canvas._hit = []; return; }
    const xs = o.points.map(p => p.x), ys = o.points.map(p => p.y);
    const padX = (Math.max(...xs) - Math.min(...xs)) * 0.08 || Math.max(...xs) * 0.05 || 1, padY = (Math.max(...ys) - Math.min(...ys)) * 0.08 || Math.max(...ys) * 0.05 || 1;
    const o2 = Object.assign({}, o, { yZero: false });
    const sc = scales(S, M, xs.concat([Math.min(...xs) - padX, Math.max(...xs) + padX]), ys.concat([Math.min(...ys) - padY, Math.max(...ys) + padY]), o2);
    frame(S, o, null, null, sc.X, sc.Y, M, false, false, sc.xTicks, sc.yTicks);
    const { ctx } = S; canvas._hit = [];
    o.points.forEach((p, i) => {
      const x = sc.X(p.x), y = sc.Y(p.y);
      ctx.fillStyle = p.color || palette[0]; ctx.beginPath(); ctx.arc(x, y, p.r || 6, 0, 7); ctx.fill();
      if (p.ring) { ctx.strokeStyle = p.ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, (p.r || 6) + 4, 0, 7); ctx.stroke(); }
      if (p.label) { ctx.fillStyle = COL.title; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(p.label, x + 9, y - 4); }
      canvas._hit.push({ x, y, i });
    });
  }

  /** cats: ['<0.25',...]  series: [{name,color,values:[...]}] */
  function groupedBars(canvas, o) {
    const S = setup(canvas), M = { l: 46, r: 14, t: 44, b: 40 }, { ctx, w, h } = S;
    const maxV = Math.max(1, ...o.series.flatMap(s => s.values));
    const ticks = niceTicks(0, maxV, 5), top = Math.max(maxV, ticks[ticks.length - 1]);
    const Y = v => h - M.b - (v / top) * (h - M.t - M.b);
    const X = v => M.l + v;
    frame(S, o, null, null, X, Y, M, false, false, [], ticks);
    const gw = (w - M.l - M.r) / o.cats.length, bw = Math.min(26, (gw * 0.8) / o.series.length);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    o.cats.forEach((c, i) => {
      const cx = M.l + gw * i + gw / 2;
      ctx.fillStyle = COL.text; ctx.fillText(c, cx, h - M.b + 5);
      o.series.forEach((s, j) => {
        const x = cx - (bw * o.series.length) / 2 + bw * j, y = Y(s.values[i]);
        ctx.fillStyle = s.color; ctx.fillRect(x + 1, y, bw - 2, h - M.b - y);
        if (s.values[i] > 0) { ctx.fillStyle = COL.text; ctx.textBaseline = 'bottom'; ctx.fillText(s.values[i], x + bw / 2, y - 1); ctx.textBaseline = 'top'; }
      });
    });
    legend(S, o.series, M);
  }

  return { lineChart, scatter, groupedBars, palette, fmt };
})();
