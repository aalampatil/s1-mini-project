/* atm.js – Air-Traffic-Management integration
 *
 * Many flights share the same airways. Each directed edge has a capacity (flights per window);
 * the delay on an edge grows with load via the BPR congestion function
 *        delay factor = 1 + 0.15 · (load / capacity)^4
 *
 *  selfish   : every flight takes its own cheapest route, unaware of other traffic
 *  atm       : flights are assigned one after another; each sees the load created so far
 *  atm+rr    : atm + "rip-up and re-route" passes that iteratively re-balance traffic
 */
window.FRP = window.FRP || {};
FRP.atm = (function () {
  'use strict';
  const A = FRP.algo, G = FRP.geo;
  const bpr = (l, c) => 1 + 0.15 * Math.pow(l / c, 4);

  function genFlights(g, count, seed) {
    const r = G.mulberry32(seed), n = g.n, cum = [];
    let s = 0;
    for (let i = 0; i < n; i++) { s += Math.pow(g.nodes[i].size, 1.5); cum.push(s); }
    const pick = () => { const x = r() * s; let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } return lo; };
    const flights = [];
    while (flights.length < count) { const o = pick(), d = pick(); if (o !== d) flights.push({ o, d }); }
    return flights;
  }

  function capacities(g, scale) {
    const cap = new Float64Array(g.edges.length);
    for (const e of g.edges) cap[e.id] = Math.max(2, Math.round((4 + 3 * (g.nodes[e.u].size + g.nodes[e.v].size) / 2) * scale));
    return cap;
  }

  function run(g, flights, strategy, capScale, rounds) {
    const t0 = performance.now(), E = g.edges.length, F = flights.length;
    const cap = capacities(g, capScale), load = new Int32Array(E), routes = new Array(F).fill(null);
    const aware = strategy !== 'selfish';
    const costFn = e => e.cost * bpr(load[e.id], cap[e.id]);
    const cache = new Map();
    const route = f => {
      if (!aware) {                                   // independent of load -> cache per OD pair
        const k = f.o * g.n + f.d;
        if (!cache.has(k)) { const r = A.search(g, f.o, f.d, false, null); cache.set(k, r.found ? r.edges : null); }
        return cache.get(k);
      }
      const r = A.search(g, f.o, f.d, false, costFn);
      return r.found ? r.edges : null;
    };
    for (let i = 0; i < F; i++) { const r = route(flights[i]); routes[i] = r; if (r) for (const e of r) load[e.id]++; }
    if (strategy === 'atm+rr') {
      for (let k = 0; k < rounds; k++) for (let i = 0; i < F; i++) {
        if (routes[i]) for (const e of routes[i]) load[e.id]--;
        const r = route(flights[i]); routes[i] = r;
        if (r) for (const e of r) load[e.id]++;
      }
    }
    // evaluation with the final loads
    let free = 0, real = 0, routed = 0, stops = 0, unroutable = 0;
    for (const r of routes) {
      if (!r) { unroutable++; continue; }
      routed++; stops += r.length - 1;
      for (const e of r) { free += e.time; real += e.time * bpr(load[e.id], cap[e.id]); }
    }
    const utils = []; let maxU = 0, over = 0, sum = 0;
    for (let i = 0; i < E; i++) if (load[i] > 0) {
      const u = load[i] / cap[i]; utils.push(u); sum += u; if (u > maxU) maxU = u; if (u > 1) over++;
    }
    const mean = utils.length ? sum / utils.length : 0;
    const sd = utils.length ? Math.sqrt(utils.reduce((a, u) => a + (u - mean) ** 2, 0) / utils.length) : 0;
    const bins = [0, 0, 0, 0, 0, 0];                  // <.25 .25-.5 .5-.75 .75-1 1-1.5 >1.5
    utils.forEach(u => { bins[u < .25 ? 0 : u < .5 ? 1 : u < .75 ? 2 : u < 1 ? 3 : u < 1.5 ? 4 : 5]++; });
    return {
      strategy, ms: performance.now() - t0, routed, unroutable,
      avgFree: routed ? free / routed : 0, avgReal: routed ? real / routed : 0,
      delayPct: free ? (real / free - 1) * 100 : 0, avgStops: routed ? stops / routed : 0,
      maxUtil: maxU, overloaded: over, meanUtil: mean, utilStd: sd, usedLinks: utils.length, bins,
      load, cap
    };
  }

  return { genFlights, capacities, run, bpr };
})();
