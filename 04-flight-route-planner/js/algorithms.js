/* algorithms.js – shortest-path algorithms on the flight graph
 *
 *  dijkstra        – binary-heap Dijkstra                 O((V+E) log V)
 *  astar           – A* with great-circle heuristic        O((V+E) log V) worst, far fewer expansions
 *  bellmanFord     – dynamic-programming relaxation        O(V·E)
 *  floydWarshall   – all-pairs dynamic programming         O(V^3)
 *  bfs             – fewest stops (hop count) baseline     O(V+E)
 *  pareto          – multi-objective label-setting         polynomial with ε-dominance + label cap
 *
 * Every function returns { name, found, cost, edges[], expanded, relaxed, ms }.
 */
window.FRP = window.FRP || {};
FRP.algo = (function () {
  'use strict';
  const G = FRP.geo, INF = Infinity;
  const now = () => performance.now();

  /* ---- binary min-heap (array based) ---- */
  class MinHeap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v;
      let i = k.length; k.push(key); v.push(val);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (k[p] <= key) break;
        k[i] = k[p]; v[i] = v[p]; i = p;
      }
      k[i] = key; v[i] = val;
    }
    pop() {                       // returns value with the smallest key
      const k = this.k, v = this.v;
      const topV = v[0], lastK = k.pop(), lastV = v.pop(), n = k.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lastK) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lastK; v[i] = lastV;
      }
      return topV;
    }
  }

  function edgesTo(prevE, dst) {
    const out = [];
    let e = prevE[dst];
    while (e) { out.push(e); e = prevE[e.u]; }
    return out.reverse();
  }
  const sumCost = (edges, costFn) => edges.reduce((s, e) => s + (costFn ? costFn(e) : e.cost), 0);

  /* ---- Dijkstra / A* share one implementation (A* = Dijkstra + heuristic) ---- */
  function search(g, src, dst, useH, costFn, name) {
    const t0 = now(), n = g.n, nodes = g.nodes;
    const dist = new Float64Array(n).fill(INF), done = new Uint8Array(n), prevE = new Array(n).fill(null);
    let h = null;
    if (useH && dst >= 0) {
      const hk = g.hk, T = nodes[dst], cache = new Float64Array(n).fill(-1);
      h = v => {
        let c = cache[v];
        if (c < 0) { c = G.haversine(nodes[v].lat, nodes[v].lon, T.lat, T.lon) * hk; cache[v] = c; }
        return c;
      };
    }
    const heap = new MinHeap();
    dist[src] = 0; heap.push(h ? h(src) : 0, src);
    let expanded = 0, relaxed = 0;
    while (heap.size) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1; expanded++;
      if (u === dst) break;
      const du = dist[u], a = g.adj[u];
      for (let i = 0; i < a.length; i++) {
        const e = a[i]; relaxed++;
        const v = e.v;
        if (done[v]) continue;
        const nd = du + (costFn ? costFn(e) : e.cost);
        if (nd < dist[v]) { dist[v] = nd; prevE[v] = e; heap.push(nd + (h ? h(v) : 0), v); }
      }
    }
    const found = dst < 0 ? true : dist[dst] < INF;
    return { name: name || (useH ? 'A*' : 'Dijkstra'), found, cost: dst >= 0 ? dist[dst] : 0, edges: found && dst >= 0 ? edgesTo(prevE, dst) : [],
      expanded, relaxed, ms: now() - t0, dist, prevE };
  }
  const dijkstra = (g, s, d, costFn) => search(g, s, d, false, costFn, 'Dijkstra');
  const astar = (g, s, d) => search(g, s, d, true, null, 'A*');

  /* ---- Bellman-Ford with early termination ---- */
  function bellmanFord(g, src, dst) {
    const t0 = now(), n = g.n;
    const dist = new Float64Array(n).fill(INF), prevE = new Array(n).fill(null);
    dist[src] = 0;
    let passes = 0, relaxed = 0;
    for (let i = 0; i < n - 1; i++) {
      let changed = false; passes++;
      for (let u = 0; u < n; u++) {
        const du = dist[u];
        if (du === INF) continue;
        const a = g.adj[u];
        for (let j = 0; j < a.length; j++) {
          const e = a[j]; relaxed++;
          const nd = du + e.cost;
          if (nd < dist[e.v]) { dist[e.v] = nd; prevE[e.v] = e; changed = true; }
        }
      }
      if (!changed) break;
    }
    const found = dist[dst] < INF;
    return { name: 'Bellman–Ford', found, cost: dist[dst], edges: found ? edgesTo(prevE, dst) : [], expanded: passes, relaxed, ms: now() - t0 };
  }

  /* ---- Floyd–Warshall (all pairs, result cached on the graph) ---- */
  function computeFW(g) {
    const n = g.n, D = new Float64Array(n * n).fill(INF), N = new Int32Array(n * n).fill(-1);
    for (let i = 0; i < n; i++) { D[i * n + i] = 0; N[i * n + i] = i; }
    for (const e of g.edges) {
      const idx = e.u * n + e.v;
      if (e.cost < D[idx]) { D[idx] = e.cost; N[idx] = e.v; }
    }
    for (let k = 0; k < n; k++) {
      const kn = k * n;
      for (let i = 0; i < n; i++) {
        const dik = D[i * n + k];
        if (dik === INF) continue;
        const in_ = i * n, nik = N[in_ + k];
        for (let j = 0; j < n; j++) {
          const alt = dik + D[kn + j];
          if (alt < D[in_ + j]) { D[in_ + j] = alt; N[in_ + j] = nik; }
        }
      }
    }
    return { D, N };
  }
  function floydWarshall(g, src, dst) {
    const t0 = now(), n = g.n;
    if (!g._fw) g._fw = computeFW(g);
    const { D, N } = g._fw;
    const found = D[src * n + dst] < INF;
    const edges = [];
    if (found) {
      let u = src, guard = 0;
      while (u !== dst && guard++ <= n) {
        const v = N[u * n + dst];
        const e = g.adj[u].find(x => x.v === v);
        if (!e) break;
        edges.push(e); u = v;
      }
    }
    return { name: 'Floyd–Warshall', found, cost: D[src * n + dst], edges, expanded: n, relaxed: n * n * n, ms: now() - t0 };
  }

  /* ---- BFS: minimum number of hops (ignores weights) ---- */
  function bfs(g, src, dst) {
    const t0 = now(), n = g.n, seen = new Uint8Array(n), prevE = new Array(n).fill(null);
    const q = [src]; seen[src] = 1;
    let head = 0, relaxed = 0;
    while (head < q.length) {
      const u = q[head++];
      if (u === dst) break;
      for (const e of g.adj[u]) {
        relaxed++;
        if (!seen[e.v]) { seen[e.v] = 1; prevE[e.v] = e; q.push(e.v); }
      }
    }
    const found = !!seen[dst];
    const edges = found ? edgesTo(prevE, dst) : [];
    return { name: 'BFS (fewest stops)', found, cost: found ? sumCost(edges) : INF, edges, expanded: head, relaxed, ms: now() - t0 };
  }

  /* ---- Multi-objective: label-setting search for the Pareto front of (time, fuel, env) ----
   * A label is a (node, [t,f,e]) triple. Labels are settled in order of a monotone scalar key,
   * so a settled label can never be dominated by a later one. ε-dominance (1%) and a cap of
   * K settled labels per node keep the label sets small.                                       */
  function pareto(g, src, dst, opt) {
    opt = opt || {};
    const t0 = now(), K = opt.maxLabels || 40, eps = opt.eps === undefined ? 0.01 : opt.eps, maxPops = opt.maxPops || 200000;
    const rf = g.refs, n = g.n;
    const LT = [0], LF = [0], LE = [0], LN = [src], LP = [-1], LEd = [null];
    const heap = new MinHeap();
    heap.push(0, 0);
    const perm = Array.from({ length: n }, () => []);
    const dominated = (set, t, f, e) => {
      const m = 1 + eps;
      for (let i = 0; i < set.length; i++) {
        const j = set[i];
        if (LT[j] <= t * m + 1e-9 && LF[j] <= f * m + 1e-9 && LE[j] <= e * m + 1e-9) return true;
      }
      return false;
    };
    let pops = 0, relaxed = 0;
    while (heap.size && pops < maxPops) {
      const li = heap.pop(), u = LN[li];
      if (dominated(perm[u], LT[li], LF[li], LE[li])) continue;
      if (perm[u].length >= K) continue;
      perm[u].push(li); pops++;
      if (u === dst) continue;
      const a = g.adj[u];
      for (let i = 0; i < a.length; i++) {
        const e = a[i]; relaxed++;
        const t = LT[li] + e.time, f = LF[li] + e.fuel, en = LE[li] + e.env;
        if (dominated(perm[e.v], t, f, en)) continue;
        const id = LT.length;
        LT.push(t); LF.push(f); LE.push(en); LN.push(e.v); LP.push(li); LEd.push(e);
        heap.push(t / rf.time + f / rf.fuel + en / rf.env, id);
      }
    }
    const routes = perm[dst].map(li => {
      const edges = []; let x = li;
      while (LP[x] >= 0) { edges.push(LEd[x]); x = LP[x]; }
      return edges.reverse();
    });
    return { name: 'Pareto label-setting', routes, expanded: pops, relaxed, ms: now() - t0, labels: LT.length };
  }

  return { MinHeap, search, dijkstra, astar, bellmanFord, floydWarshall, bfs, pareto, sumCost };
})();
