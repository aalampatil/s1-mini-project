/* graph.js – airport network (topology) + scenario-dependent edge cost model
 *
 * Topology  : which airport pairs are connected (independent of aircraft / weather).
 * evaluate(): turns topology + scenario (aircraft, weather, restricted zones, wind,
 *             congestion, air-traffic load) into a weighted directed graph.
 *
 * Every directed edge carries FOUR metrics:
 *   time (min), fuel (kg), env (kg CO2e), risk (weather exposure index)
 * and one scalar `cost` = weighted, normalised sum of time/fuel/env (see setWeights).
 */
window.FRP = window.FRP || {};
FRP.graph = (function () {
  'use strict';
  const G = FRP.geo;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  /* ------------------------------------------------------------------ topology */
  function buildTopology(nodes, opt) {
    opt = Object.assign({ k: 4, hubs: true }, opt || {});
    const n = nodes.length;
    const key = (a, b) => (a < b ? a * n + b : b * n + a);
    const seen = new Set(), pairs = [];
    const add = (a, b) => {
      if (a === b) return;
      const k = key(a, b);
      if (seen.has(k)) return;
      seen.add(k);
      pairs.push([Math.min(a, b), Math.max(a, b)]);
    };
    const D = (a, b) => G.haversine(nodes[a].lat, nodes[a].lon, nodes[b].lat, nodes[b].lon);

    // 1) k nearest neighbours of every airport (regional connectivity)  O(n^2 k)
    for (let u = 0; u < n; u++) {
      const best = [];
      for (let v = 0; v < n; v++) {
        if (v === u) continue;
        const d = D(u, v);
        if (best.length < opt.k || d < best[best.length - 1][0]) {
          best.push([d, v]);
          let i = best.length - 1;
          while (i > 0 && best[i - 1][0] > d) { best[i] = best[i - 1]; i--; }
          best[i] = [d, v];
          if (best.length > opt.k) best.pop();
        }
      }
      best.forEach(b => add(u, b[1]));
    }

    // 2) hub-to-hub long-haul links
    if (opt.hubs) {
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        const sa = nodes[a].size, sb = nodes[b].size, lo = Math.min(sa, sb), hi = Math.max(sa, sb);
        if (lo < 3) continue;
        const d = D(a, b);
        if ((lo >= 5 && d <= 16000) || (lo >= 4 && hi >= 5 && d <= 12500) ||
            (lo >= 4 && d <= 5500) || (lo >= 3 && d <= 3000)) add(a, b);
      }
    }

    // 3) make sure the graph is connected (join closest components)
    const par = Int32Array.from({ length: n }, (_, i) => i);
    const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    pairs.forEach(([a, b]) => { par[find(a)] = find(b); });
    for (;;) {
      let best = null, bd = Infinity;
      for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) {
        if (find(u) === find(v)) continue;
        const d = D(u, v);
        if (d < bd) { bd = d; best = [u, v]; }
      }
      if (!best) break;
      add(best[0], best[1]);
      par[find(best[0])] = find(best[1]);
    }

    // 4) link objects + synthetic background air-traffic load (gravity model, 0.1 .. ~1.1)
    const links = pairs.map(([a, b], id) => ({ id, a, b, dist: D(a, b), state: 'ok' }));
    let maxRaw = 1e-9;
    links.forEach(L => {
      L.raw = Math.pow(nodes[L.a].size * nodes[L.b].size, 1.1) / Math.pow(L.dist / 1000 + 0.8, 0.5);
      if (L.raw > maxRaw) maxRaw = L.raw;
    });
    const rnd = G.mulberry32(12345 + n);
    links.forEach(L => { L.util = clamp(0.1 + 0.95 * L.raw / maxRaw + (rnd() - 0.5) * 0.12, 0.05, 1.2); });
    const utilFn = (sa, sb, dist) => clamp(0.1 + 0.95 * (Math.pow(sa * sb, 1.1) / Math.pow(dist / 1000 + 0.8, 0.5)) / maxRaw, 0.05, 1.2);
    return { n, links, utilFn };
  }

  /** cached sample points of a link (unwrapped longitudes) */
  function linkPts(topo, nodes, L, step) {
    if (L.ptsStep !== step) {
      const A = nodes[L.a], B = nodes[L.b];
      L.pts = G.samplePath(A.lat, A.lon, B.lat, B.lon, step);
      L.ptsStep = step;
    }
    return L.pts;
  }

  /* ------------------------------------------------------------------ scenario -> graph */
  function jetStream(lat) {                       // mean westerly jet speed (km/h) by latitude
    const x = (Math.abs(lat) - 42) / 16;
    return 75 * Math.exp(-x * x);
  }

  function analyzeLeg(pts, scn) {
    let sum = 0, mx = 0, blocked = false;
    const W = scn.weatherOn ? scn.weather : null, Z = scn.zones;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let sev = 0;
      if (W) for (let j = 0; j < W.length; j++) {
        const c = W[j], d = G.haversine(p[0], p[1], c.lat, c.lon);
        if (d < c.r) { const s = c.sev * (1 - 0.5 * d / c.r); if (s > sev) sev = s; }
      }
      sum += sev; if (sev > mx) mx = sev;
      if (!blocked && scn.zonesOn) for (let j = 0; j < Z.length; j++) {
        if (G.haversine(p[0], p[1], Z[j].lat, Z[j].lon) < Z[j].r) { blocked = true; break; }
      }
    }
    return { avgSev: sum / pts.length, maxSev: mx, blocked };
  }

  function makeEdge(nodes, u, v, L, geo, scn, midLat) {
    const ac = scn.aircraft, A = nodes[u], B = nodes[v];
    const dist = L.dist;
    const mid = G.interpolate(A.lat, A.lon, B.lat, B.lon, 0.5);
    const brg = G.bearing(mid[0], mid[1], B.lat, B.lon);
    const wind = scn.windOn ? jetStream(mid[0]) * Math.sin(brg * G.rad) : 0;   // +tailwind when flying east
    const gs = Math.max(450, ac.speed + wind);
    const wx = 1 + scn.wxScale * geo.avgSev;                                    // weather detour / slow-down factor
    const atm = scn.atmOn ? 1 + 0.3 * Math.pow(L.util, 4) : 1;                  // ATM sector-load delay factor
    const airH = (dist / gs) * wx * atm;

    const cruise = ac.burn * ac.speed * airH * (1 + 0.4 * Math.pow(dist / ac.range, 2)); // + extra burn from carrying fuel for long legs
    const cu = clamp(A.cong * scn.congLevel, 0, 1.5), cv = clamp(B.cong * scn.congLevel, 0, 1.5);
    const taxi = (15 + 25 * cu) + (10 + 30 * cv);          // taxi-out + queue, taxi-in + holding (min)
    const time = airH * 60 + taxi + 40;                    // +40 min ground handling (split dep/arr)
    const fuel = cruise + ac.lto + taxi * ac.lto * 0.008;
    const env = 3.16 * fuel * (1 + 0.6 * Math.min(1, Math.abs(mid[0]) / 60));        // CO2e incl. non-CO2 proxy
    return { u, v, dist, time, fuel, env, risk: geo.avgSev * dist, sev: geo.avgSev, util: L.util, wind, cost: 0, link: L, id: -1 };
  }

  function evaluate(topo, nodes, scn) {
    const ac = scn.aircraft, n = nodes.length, maxLeg = ac.range * 0.92;
    const adj = Array.from({ length: n }, () => []), edges = [];
    const stats = { blocked: 0, range: 0, closed: 0, links: topo.links.length };
    const step = scn.step || 150;
    for (const L of topo.links) {
      if (L.dist > maxLeg) { L.state = 'range'; stats.range++; continue; }
      if (scn.closed.has(L.a) || scn.closed.has(L.b)) { L.state = 'closed'; stats.closed++; continue; }
      const geo = analyzeLeg(linkPts(topo, nodes, L, step), scn);
      if (scn.zonesOn && geo.blocked) { L.state = 'blocked'; stats.blocked++; continue; }
      L.state = 'ok';
      const e1 = makeEdge(nodes, L.a, L.b, L, geo, scn), e2 = makeEdge(nodes, L.b, L.a, L, geo, scn);
      e1.id = edges.length; edges.push(e1); adj[L.a].push(e1);
      e2.id = edges.length; edges.push(e2); adj[L.b].push(e2);
    }
    // reference "cost per km" of each objective – used to put time/fuel/env on one scale
    let st = 0, sf = 0, se = 0;
    edges.forEach(e => { st += e.time / e.dist; sf += e.fuel / e.dist; se += e.env / e.dist; });
    const m = Math.max(1, edges.length);
    const refs = { time: st / m || 1, fuel: sf / m || 1, env: se / m || 1 };

    const g = { n, nodes, adj, edges, links: topo.links, refs, scn, stats, hk: 0, w: null, _fw: null };
    g.setWeights = function (w) {
      let s = w.t + w.f + w.e;
      const wt = s > 0 ? w.t / s : 1 / 3, wf = s > 0 ? w.f / s : 1 / 3, we = s > 0 ? w.e / s : 1 / 3;
      let hk = Infinity;
      for (const e of edges) {
        e.cost = wt * e.time / refs.time + wf * e.fuel / refs.fuel + we * e.env / refs.env;
        const r = e.cost / e.dist; if (r < hk) hk = r;
      }
      g.hk = isFinite(hk) ? hk : 0;           // lower bound of cost per km  -> admissible A* heuristic
      g.w = { t: wt, f: wf, e: we };
      g._fw = null;
    };
    g.setWeights({ t: 1, f: 1, e: 1 });
    return g;
  }

  /** totals for a list of edges */
  function pathMetrics(edges) {
    const m = { dist: 0, time: 0, fuel: 0, env: 0, risk: 0, cost: 0, stops: Math.max(0, edges.length - 1), legs: edges.length, util: 0, maxSev: 0 };
    edges.forEach(e => {
      m.dist += e.dist; m.time += e.time; m.fuel += e.fuel; m.env += e.env; m.risk += e.risk; m.cost += e.cost;
      m.util += e.util; if (e.sev > m.maxSev) m.maxSev = e.sev;
    });
    m.util = edges.length ? m.util / edges.length : 0;
    m.wx = m.dist ? m.risk / m.dist : 0;
    return m;
  }

  /** Metrics of flying a→b directly (baseline), or why that is impossible. */
  function directLeg(topo, nodes, a, b, scn) {
    const ac = scn.aircraft;
    const dist = G.haversine(nodes[a].lat, nodes[a].lon, nodes[b].lat, nodes[b].lon);
    if (scn.closed.has(a) || scn.closed.has(b)) return { feasible: false, reason: 'an airport is closed' };
    if (dist > ac.range * 0.92) return { feasible: false, reason: 'beyond the ' + ac.name + ' range (' + Math.round(ac.range * 0.92).toLocaleString('en-US') + ' km usable)' };
    const L = { a, b, dist, util: topo.utilFn(nodes[a].size, nodes[b].size, dist) };
    const pts = G.samplePath(nodes[a].lat, nodes[a].lon, nodes[b].lat, nodes[b].lon, scn.step || 150);
    const geo = analyzeLeg(pts, scn);
    if (scn.zonesOn && geo.blocked) return { feasible: false, reason: 'it crosses restricted airspace' };
    const e = makeEdge(nodes, a, b, L, geo, scn);
    return { feasible: true, edge: e, metrics: pathMetrics([e]) };
  }

  /* ------------------------------------------------------------------ random graphs (benchmarks) */
  function randomNodes(n, seed) {
    const r = G.mulberry32(seed), out = [];
    const s1 = Math.sin(-60 * G.rad), s2 = Math.sin(72 * G.rad);
    for (let i = 0; i < n; i++) {
      out.push({
        iata: 'N' + i, name: 'Node ' + i, city: 'Node ' + i,
        lat: Math.asin(s1 + r() * (s2 - s1)) * G.deg, lon: -180 + r() * 360,
        size: 1 + Math.floor(Math.pow(r(), 2.2) * 5), cong: r() * 0.6
      });
    }
    return out;
  }

  function randomHazards(cells, zones, seed) {
    const r = G.mulberry32(seed), pos = () => [Math.asin(Math.sin(-55 * G.rad) + r() * (Math.sin(65 * G.rad) - Math.sin(-55 * G.rad))) * G.deg, -180 + r() * 360];
    const weather = [], zs = [];
    for (let i = 0; i < cells; i++) { const p = pos(); weather.push({ lat: p[0], lon: p[1], r: 300 + r() * 700, sev: 0.3 + r() * 0.65 }); }
    for (let i = 0; i < zones; i++) { const p = pos(); zs.push({ lat: p[0], lon: p[1], r: 200 + r() * 450 }); }
    return { weather, zones: zs };
  }

  return { buildTopology, evaluate, pathMetrics, directLeg, linkPts, randomNodes, randomHazards, jetStream };
})();
