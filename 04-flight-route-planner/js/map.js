/* map.js – canvas map renderer (equirectangular projection, pan / zoom, interactive tools) */
window.FRP = window.FRP || {};
FRP.MapView = class MapView {
  constructor(canvas, S, hooks, tipEl) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.S = S; this.hooks = hooks; this.tip = tipEl;
    this.view = { lon: 15, lat: 22, zoom: 1 };
    this.hover = -1; this.drag = null; this.cache = {};
    this.resize();
    const c = canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointerleave', () => { this.hover = -1; this.tip.style.display = 'none'; this.draw(); });
    c.addEventListener('wheel', e => this.wheel(e), { passive: false });
    c.addEventListener('dblclick', () => { this.view = { lon: 15, lat: 22, zoom: 1 }; this.draw(); });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.w = Math.max(300, r.width); this.h = Math.max(240, r.height);
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.c.style.width = this.w + 'px'; this.c.style.height = this.h + 'px';
    this.dpr = dpr;
    this.base = Math.max(this.w / 360, this.h / 150);
    this.draw();
  }
  get k() { return this.base * this.view.zoom; }
  project(lat, lon) { return [this.w / 2 + (lon - this.view.lon) * this.k, this.h / 2 - (lat - this.view.lat) * this.k]; }
  invert(x, y) { return [this.view.lat - (y - this.h / 2) / this.k, this.view.lon + (x - this.w / 2) / this.k]; }

  /* ---------------- interaction ---------------- */
  pos(e) { const r = this.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  down(e) { const [x, y] = this.pos(e); this.drag = { x, y, lon: this.view.lon, lat: this.view.lat, moved: false }; this.c.setPointerCapture(e.pointerId); }
  move(e) {
    const [x, y] = this.pos(e);
    if (this.drag) {
      const dx = x - this.drag.x, dy = y - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      if (this.drag.moved) {
        this.view.lon = this.drag.lon - dx / this.k;
        this.view.lat = Math.max(-70, Math.min(85, this.drag.lat + dy / this.k));
        this.tip.style.display = 'none'; this.draw(); return;
      }
    }
    const h = this.hit(x, y);
    if (h !== this.hover) { this.hover = h; this.draw(); }
    const [lat, lon] = this.invert(x, y);
    let html = null;
    if (h >= 0) {
      const a = this.S.airports[h], closed = this.S.scn.closed.has(h);
      html = '<b>' + a.iata + '</b> · ' + a.name + '<br>' + a.city + ' · hub tier ' + a.size + ' · congestion ' + Math.round(Math.min(1.5, a.cong * this.S.scn.congLevel) * 100) + '%' + (closed ? ' · <span style="color:#f87171">CLOSED</span>' : '');
    } else html = this.hooks.areaInfo(lat, lon);
    if (html) { this.tip.innerHTML = html; this.tip.style.display = 'block'; this.tip.style.left = Math.min(x + 14, this.w - 230) + 'px'; this.tip.style.top = Math.max(4, y - 10) + 'px'; }
    else this.tip.style.display = 'none';
    this.c.style.cursor = h >= 0 || this.S.tool !== 'select' ? 'pointer' : 'grab';
  }
  up(e) {
    if (!this.drag) return;
    const d = this.drag; this.drag = null;
    if (d.moved) return;
    const [x, y] = this.pos(e), [lat, lon] = this.invert(x, y), h = this.hit(x, y);
    this.hooks.click(lat, lon, h);
  }
  wheel(e) {
    e.preventDefault();
    const [x, y] = this.pos(e), [lat, lon] = this.invert(x, y);
    const z = Math.max(1, Math.min(14, this.view.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
    this.view.zoom = z;
    // keep the point under the cursor fixed
    this.view.lon = lon - (x - this.w / 2) / this.k;
    this.view.lat = Math.max(-70, Math.min(85, lat + (y - this.h / 2) / this.k));
    this.draw();
  }
  zoomBy(f) { this.view.zoom = Math.max(1, Math.min(14, this.view.zoom * f)); this.draw(); }
  reset() { this.view = { lon: 15, lat: 22, zoom: 1 }; this.draw(); }

  hit(x, y) {
    let best = -1, bd = 13 * 13;
    for (const a of this.S.airports) {
      for (const off of [0, -360, 360]) {
        const [px, py] = this.project(a.lat, a.lon + off), d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bd) { bd = d; best = a.i; }
      }
    }
    return best;
  }

  /* ---------------- drawing helpers ---------------- */
  poly(pts, close) {
    const ctx = this.ctx;
    pts.forEach((p, i) => { const [x, y] = this.project(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    if (close) ctx.closePath();
  }
  // draw a (lat,lon) polyline / polygon at the three longitude copies of the world
  stroke(pts, close) { for (const o of [-360, 0, 360]) { this.ctx.beginPath(); this.poly(pts.map(p => [p[0], p[1] + o]), close); this.ctx.stroke(); } }
  fill(pts) { for (const o of [-360, 0, 360]) { this.ctx.beginPath(); this.poly(pts.map(p => [p[0], p[1] + o]), true); this.ctx.fill(); } }

  routePolyline(edges) {
    const G = FRP.geo, nodes = this.S.airports, out = [];
    edges.forEach(e => {
      const A = nodes[e.u], B = nodes[e.v];
      const pts = G.samplePath(A.lat, A.lon, B.lat, B.lon, 120);
      if (out.length) {
        const shift = Math.round((out[out.length - 1][1] - pts[0][1]) / 360) * 360;
        pts.forEach(p => { p[1] += shift; });
        pts.shift();
      }
      out.push(...pts);
    });
    return out;
  }

  planePos(poly, p) {
    if (poly.length < 2) return null;
    const seg = [0]; let tot = 0;
    for (let i = 1; i < poly.length; i++) { tot += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]); seg.push(tot); }
    const t = p * tot; let i = 1;
    while (i < poly.length - 1 && seg[i] < t) i++;
    const f = (t - seg[i - 1]) / (seg[i] - seg[i - 1] || 1);
    return { lat: poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * f, lon: poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * f, a: poly[i - 1], b: poly[i] };
  }

  drawPlane(lat, lon, a, b, lonOff) {
    const ctx = this.ctx;
    const [x, y] = this.project(lat, lon + lonOff);
    const [x1, y1] = this.project(a[0], a[1] + lonOff), [x2, y2] = this.project(b[0], b[1] + lonOff);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(3, -2.6); ctx.lineTo(-1, -11); ctx.lineTo(-4.5, -11); ctx.lineTo(-3, -2.6); ctx.lineTo(-9, -2); ctx.lineTo(-11, -5.5); ctx.lineTo(-13, -5.5); ctx.lineTo(-12.5, 0);
    ctx.lineTo(-13, 5.5); ctx.lineTo(-11, 5.5); ctx.lineTo(-9, 2); ctx.lineTo(-3, 2.6); ctx.lineTo(-4.5, 11); ctx.lineTo(-1, 11); ctx.lineTo(3, 2.6);
    ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  utilColor(u) { // 0..1.5 -> green / amber / red
    const t = Math.min(1, u / 1.2), hue = 140 - 140 * t;
    return 'hsl(' + hue + ',85%,55%)';
  }

  /* ---------------- main draw ---------------- */
  draw() {
    const ctx = this.ctx, S = this.S, w = this.w, h = this.h, G = FRP.geo;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // ocean
    const og = ctx.createLinearGradient(0, 0, 0, h);
    og.addColorStop(0, '#0c1a2e'); og.addColorStop(1, '#0a1626');
    ctx.fillStyle = og; ctx.fillRect(0, 0, w, h);

    // graticule
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,150,190,.10)'; ctx.fillStyle = 'rgba(150,175,210,.35)'; ctx.font = '10px system-ui'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    for (let lat = -60; lat <= 80; lat += 20) { const [, y] = this.project(lat, 0); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.fillText(lat + '°', 4, y + 2); }
    for (let lon = -180; lon <= 360; lon += 30) { const [x] = this.project(0, lon); if (x < -2 || x > w + 2) continue; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }

    // land
    ctx.fillStyle = '#16263d'; ctx.strokeStyle = 'rgba(120,160,210,.35)'; ctx.lineWidth = 1;
    for (const poly of FRP.data.land) {
      const pts = poly.map(p => [p[1], p[0]]);
      this.fill(pts); this.stroke(pts, true);
    }

    // restricted zones
    for (const z of S.scn.zones) {
      const pts = this.circle(z, 'z');
      ctx.fillStyle = S.scn.zonesOn ? 'rgba(239,68,68,.20)' : 'rgba(239,68,68,.05)';
      ctx.strokeStyle = S.scn.zonesOn ? 'rgba(248,113,113,.9)' : 'rgba(248,113,113,.3)';
      ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      this.fill(pts); this.stroke(pts, true); ctx.setLineDash([]);
      const [x, y] = this.project(z.lat, z.lon);
      if (this.view.zoom > 1.3) { ctx.fillStyle = 'rgba(252,165,165,.9)'; ctx.textAlign = 'center'; ctx.fillText(z.name.split(' ')[0], x, y - 5); }
    }
    // weather cells
    for (const c of S.scn.weather) {
      const pts = this.circle(c, 'w'), hue = 55 - 55 * c.sev;
      ctx.fillStyle = 'hsla(' + hue + ',95%,55%,' + (S.scn.weatherOn ? 0.12 + 0.28 * c.sev : 0.05) + ')';
      ctx.strokeStyle = 'hsla(' + hue + ',95%,60%,' + (S.scn.weatherOn ? 0.8 : 0.25) + ')';
      ctx.lineWidth = 1.2; this.fill(pts); this.stroke(pts, true);
      const [x, y] = this.project(c.lat, c.lon);
      ctx.fillStyle = 'hsla(' + hue + ',95%,75%,.95)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '12px system-ui';
      ctx.fillText('⛈', x, y);
    }

    // network
    const g = S.g;
    if (g) {
      ctx.lineWidth = 1;
      for (const L of g.links) {
        if (L.state !== 'ok' && L.state !== 'blocked') continue;
        if (!L.dpts) { const A = S.airports[L.a], B = S.airports[L.b]; L.dpts = FRP.geo.samplePath(A.lat, A.lon, B.lat, B.lon, 300); }
        const pts = L.dpts;
        if (L.state === 'blocked') {
          if (!S.showNetwork) continue;
          ctx.strokeStyle = 'rgba(248,113,113,.28)'; ctx.setLineDash([3, 4]); this.stroke(pts); ctx.setLineDash([]);
        } else if (S.overlay) {
          const u = S.overlay.linkUtil.get(L.id);
          if (u > 0) { ctx.strokeStyle = this.utilColor(u); ctx.lineWidth = 1 + Math.min(4, u * 2.5); this.stroke(pts); ctx.lineWidth = 1; }
          else if (S.showNetwork) { ctx.strokeStyle = 'rgba(100,150,210,.10)'; this.stroke(pts); }
        } else if (S.showNetwork) { ctx.strokeStyle = 'rgba(80,170,240,.17)'; this.stroke(pts); }
      }
    }

    // alternative (Pareto) routes
    if (S.showPareto && S.pareto) {
      S.pareto.forEach((r, i) => {
        if (i === S.selPareto) return;
        ctx.strokeStyle = FRP.charts.palette[(i + 4) % 6]; ctx.globalAlpha = 0.75; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
        this.stroke(this.routePolyline(r.edges)); ctx.setLineDash([]); ctx.globalAlpha = 1;
      });
    }

    // main route
    let poly = null;
    if (S.shown && S.shown.length) {
      poly = this.routePolyline(S.shown); S.poly = poly;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(251,191,36,.22)'; ctx.lineWidth = 10; this.stroke(poly);
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3; this.stroke(poly);
      ctx.lineCap = 'butt';
    } else S.poly = null;

    // airports
    const routeNodes = new Set();
    if (S.shown) S.shown.forEach(e => { routeNodes.add(e.u); routeNodes.add(e.v); });
    ctx.textBaseline = 'middle';
    for (const a of S.airports) {
      const [x, y] = this.project(a.lat, a.lon);
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
      const isO = a.i === S.origin, isD = a.i === S.dest, onR = routeNodes.has(a.i), closed = S.scn.closed.has(a.i);
      const r = 2.5 + a.size * 0.7;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
      ctx.fillStyle = closed ? '#64748b' : onR ? '#fde68a' : '#7dd3fc'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = '#0b1220'; ctx.stroke();
      if (closed) { ctx.strokeStyle = '#f87171'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke(); }
      if (isO || isD) { ctx.lineWidth = 2.5; ctx.strokeStyle = isO ? '#34d399' : '#f472b6'; ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 7); ctx.stroke(); }
      if (a.i === this.hover) { ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 7); ctx.stroke(); }
      const showLabel = isO || isD || onR || a.i === this.hover || (this.view.zoom >= 1.0 && a.size >= 5) || (this.view.zoom >= 1.6 && a.size >= 4) || this.view.zoom >= 2.6;
      if (showLabel) {
        ctx.font = (isO || isD || onR ? '600 ' : '') + '11px system-ui'; ctx.textAlign = 'left';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,15,28,.85)'; ctx.strokeText(a.iata, x + r + 4, y);
        ctx.fillStyle = isO ? '#6ee7b7' : isD ? '#f9a8d4' : onR ? '#fde68a' : '#cfe3f8'; ctx.fillText(a.iata, x + r + 4, y);
      }
    }

    // plane
    if (poly && S.anim.show) {
      const p = this.planePos(poly, S.anim.p);
      if (p) for (const off of [-360, 0, 360]) this.drawPlane(p.lat, p.lon, p.a, p.b, off);
    }
  }

  circle(c, kind) {
    const key = kind + c.id;
    const sig = c.lat + ',' + c.lon + ',' + c.r;
    const hit = this.cache[key];
    if (hit && hit.sig === sig) return hit.pts;
    const pts = FRP.geo.circlePoints(c.lat, c.lon, c.r, 48);
    this.cache[key] = { sig, pts };
    return pts;
  }
};
