/* benchmark.js – computational experiments (scalability analysis)
 *   1. graph size      : runtime / work of every algorithm vs number of airports
 *   2. airspace detail : graph construction + query time vs number of weather cells / restricted zones
 *   3. traffic load    : ATM strategies vs number of simultaneous flights
 */
window.FRP = window.FRP || {};
FRP.bench = (function () {
  'use strict';
  const A = FRP.algo, GR = FRP.graph, G = FRP.geo;
  const tick = () => new Promise(r => setTimeout(r, 0));
  const AC = () => FRP.data.aircraft.find(a => a.id === 'A359');

  function scenario(h) {
    return { aircraft: AC(), weather: h.weather, zones: h.zones, closed: new Set(), windOn: true, weatherOn: true, wxScale: 1.5,
      zonesOn: true, congLevel: 1, atmOn: true, step: 300 };
  }

  function makeGraph(n, seed, cells, zones) {
    const nodes = GR.randomNodes(n, seed);
    const topo = GR.buildTopology(nodes, { k: 5, hubs: false });
    const g = GR.evaluate(topo, nodes, scenario(GR.randomHazards(cells, zones, seed + 1)));
    g.setWeights({ t: 1, f: 1, e: 1 });
    return { g, nodes, topo };
  }

  function pickPairs(g, q, seed) {
    const r = G.mulberry32(seed), pairs = [];
    for (let tries = 0; tries < 200 && pairs.length < q; tries++) {
      const s = Math.floor(r() * g.n), d = Math.floor(r() * g.n);
      if (s !== d && A.dijkstra(g, s, d).found) pairs.push([s, d]);
    }
    return pairs;
  }

  function timeIt(fn, pairs, reps) {
    let exp = 0, rel = 0;
    const t0 = performance.now();
    for (let r = 0; r < reps; r++) for (const [s, d] of pairs) { const x = fn(s, d); if (r === 0) { exp += x.expanded; rel += x.relaxed; } }
    const ms = (performance.now() - t0) / (reps * pairs.length);
    return { ms, expanded: exp / pairs.length, relaxed: rel / pairs.length };
  }

  /** slope of the least-squares line through (log n, log y): empirical growth exponent */
  function slope(xs, ys) {
    const pts = xs.map((x, i) => [Math.log(x), Math.log(Math.max(ys[i], 1e-6))]).filter(p => isFinite(p[0]) && isFinite(p[1]));
    const n = pts.length; if (n < 2) return NaN;
    const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    let num = 0, den = 0; pts.forEach(p => { num += (p[0] - mx) * (p[1] - my); den += (p[0] - mx) ** 2; });
    return den ? num / den : NaN;
  }

  async function graphScaling(sizes, opt, progress) {
    const rows = [];
    for (const n of sizes) {
      progress('Airports N = ' + n + ' …'); await tick();
      const t0 = performance.now();
      const { g } = makeGraph(n, 1000 + n, Math.round(n / 25), Math.round(n / 80));
      const buildMs = performance.now() - t0;
      const pairs = pickPairs(g, 10, n);
      const row = { n, edges: g.edges.length, buildMs };
      if (!pairs.length) { rows.push(row); continue; }
      const rd = n <= 200 ? 40 : n <= 800 ? 12 : 5;
      row.dijkstra = timeIt((s, d) => A.dijkstra(g, s, d), pairs, rd); await tick();
      row.astar = timeIt((s, d) => A.astar(g, s, d), pairs, rd); await tick();
      row.bellman = timeIt((s, d) => A.bellmanFord(g, s, d), pairs, n <= 200 ? 6 : 2); await tick();
      if (n <= opt.fwMax) {
        g._fw = null; const t1 = performance.now(); g._fw = null; A.floydWarshall(g, pairs[0][0], pairs[0][1]);
        row.floyd = { ms: performance.now() - t1, relaxed: n * n * n, expanded: n };
      }
      rows.push(row);
    }
    const fit = {};
    ['dijkstra', 'astar', 'bellman', 'floyd'].forEach(k => {
      const r = rows.filter(x => x[k] && x.n >= 100);
      fit[k] = slope(r.map(x => x.n), r.map(x => x[k].ms));
    });
    return { rows, fit };
  }

  async function airspaceScaling(counts, n, progress) {
    const nodes = GR.randomNodes(n, 77);
    const topo = GR.buildTopology(nodes, { k: 5, hubs: false });
    const rows = [];
    for (const c of counts) {
      progress('Hazards = ' + c + ' …'); await tick();
      const h = GR.randomHazards(c, Math.round(c / 4), 500 + c);
      const reps = 3, t0 = performance.now(); let g;
      for (let i = 0; i < reps; i++) g = GR.evaluate(topo, nodes, scenario(h));
      const buildMs = (performance.now() - t0) / reps;
      g.setWeights({ t: 1, f: 1, e: 1 });
      const pairs = pickPairs(g, 10, c + 3);
      const q = pairs.length ? timeIt((s, d) => A.astar(g, s, d), pairs, 20) : { ms: 0 };
      rows.push({ count: c, zones: Math.round(c / 4), buildMs, queryMs: q.ms, blocked: g.stats.blocked, edges: g.edges.length });
    }
    return { rows };
  }

  async function trafficScaling(g, counts, capScale, progress) {
    const rows = [];
    for (const f of counts) {
      progress('Flights = ' + f + ' …'); await tick();
      const flights = FRP.atm.genFlights(g, f, 99);
      const row = { flights: f };
      for (const s of ['selfish', 'atm', 'atm+rr']) { row[s] = FRP.atm.run(g, flights, s, capScale, 2); await tick(); }
      rows.push(row);
    }
    return { rows };
  }

  return { graphScaling, airspaceScaling, trafficScaling, slope, makeGraph };
})();
