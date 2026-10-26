/* ui.js – application controller: state, DOM wiring, rendering of the result tabs */
(function () {
  'use strict';
  const D = FRP.data, GEO = FRP.geo, GR = FRP.graph, A = FRP.algo, CH = FRP.charts;
  const $ = id => document.getElementById(id);

  /* ------------------------------------------------------------------ data & state */
  const airports = D.airports.map((a, i) => ({
    i, iata: a[0], name: a[1], city: a[2], lat: a[3], lon: a[4], size: a[5], cong: [0.12, 0.22, 0.36, 0.5, 0.66][a[5] - 1]
  }));
  const topo = GR.buildTopology(airports, { k: 4 });
  const idx = c => airports.findIndex(a => a.iata === c);
  let uid = 1;
  const withId = o => Object.assign({ id: uid++ }, o);

  const S = {
    airports, origin: idx('DEL'), dest: idx('JFK'), next: 'origin',
    algo: 'astar', weights: { t: 34, f: 33, e: 33 }, aircraftId: 'A359',
    scn: { aircraft: null, weather: [], zones: [], closed: new Set(), windOn: true, weatherOn: true, wxScale: 1.5, zonesOn: true, congLevel: 1, atmOn: true, step: 150 },
    tool: 'select', toolRadius: 600, toolSev: 0.7, showNetwork: true, showPareto: false,
    g: null, result: null, shown: null, shownLabel: '', direct: null, pareto: null, selPareto: -1,
    overlay: null, poly: null, anim: { p: 0, show: false, playing: false }, tab: 'route', atmRes: null, bench: null
  };
  function resetScenario() {
    S.scn.weather = D.weather.map(withId);
    S.scn.zones = D.zones.map(withId);
    S.scn.closed = new Set();
  }
  resetScenario();

  /* ------------------------------------------------------------------ formatting */
  const fmt = {
    int: v => Math.round(v).toLocaleString('en-US'),
    dur: m => { const t = Math.round(m); return Math.floor(t / 60) + 'h ' + String(t % 60).padStart(2, '0') + 'm'; },
    kg: v => Math.round(v).toLocaleString('en-US') + ' kg',
    t: v => (v / 1000).toFixed(1) + ' t',
    pct: v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'
  };
  const pathStr = edges => edges.length ? [airports[edges[0].u].iata].concat(edges.map(e => airports[e.v].iata)).join(' → ') : '';
  const utilCls = u => (u > 0.85 ? 'r' : u > 0.55 ? 'a' : 'g');

  /* ------------------------------------------------------------------ map */
  const hooks = {
    click(lat, lon, h) {
      switch (S.tool) {
        case 'select': if (h >= 0) pickAirport(h); break;
        case 'storm': S.scn.weather.push(withId({ name: 'Custom storm', lat, lon, r: S.toolRadius, sev: S.toolSev })); scheduleRebuild(); break;
        case 'zone': S.scn.zones.push(withId({ name: 'R-' + (S.scn.zones.length + 1) + ' Custom zone', lat, lon, r: S.toolRadius })); scheduleRebuild(); break;
        case 'close': if (h >= 0) { S.scn.closed.has(h) ? S.scn.closed.delete(h) : S.scn.closed.add(h); scheduleRebuild(); } break;
        case 'erase': eraseAt(lat, lon); break;
      }
    },
    areaInfo(lat, lon) {
      for (const c of S.scn.weather) if (GEO.haversine(lat, lon, c.lat, c.lon) < c.r) return '<b>⛈ ' + c.name + '</b><br>severity ' + Math.round(c.sev * 100) + '% · radius ' + c.r + ' km' + (S.scn.weatherOn ? '' : ' (ignored)');
      for (const z of S.scn.zones) if (GEO.haversine(lat, lon, z.lat, z.lon) < z.r) return '<b>⛔ ' + z.name + '</b><br>radius ' + z.r + ' km' + (S.scn.zonesOn ? ' · airways through here are removed' : ' (ignored)');
      return null;
    }
  };
  const map = new FRP.MapView($('map'), S, hooks, $('tip'));

  function eraseAt(lat, lon) {
    let best = null, bd = Infinity, kind = '';
    S.scn.weather.forEach(c => { const d = GEO.haversine(lat, lon, c.lat, c.lon); if (d < c.r && d < bd) { bd = d; best = c; kind = 'w'; } });
    S.scn.zones.forEach(z => { const d = GEO.haversine(lat, lon, z.lat, z.lon); if (d < z.r && d < bd) { bd = d; best = z; kind = 'z'; } });
    if (!best) return;
    if (kind === 'w') S.scn.weather = S.scn.weather.filter(c => c !== best); else S.scn.zones = S.scn.zones.filter(z => z !== best);
    scheduleRebuild();
  }

  function pickAirport(h) {
    if (S.next === 'origin') { S.origin = h; S.next = 'dest'; if (S.dest === h) { S.dest = (h + 1) % airports.length; } }
    else { S.dest = h; S.next = 'origin'; if (S.origin === h) { S.origin = (h + 1) % airports.length; } }
    syncSelects(); schedulePlan();
  }

  function updateHint() {
    const t = S.tool;
    $('mapHint').textContent =
      t === 'select' ? 'Click an airport to set the ' + (S.next === 'origin' ? 'ORIGIN' : 'DESTINATION') :
      t === 'storm' ? 'Click the map to add a storm (' + S.toolRadius + ' km, severity ' + Math.round(S.toolSev * 100) + '%)' :
      t === 'zone' ? 'Click the map to add a no-fly zone (' + S.toolRadius + ' km)' :
      t === 'close' ? 'Click an airport to close / reopen it' : 'Click a storm or no-fly zone to remove it';
  }

  /* ------------------------------------------------------------------ planning pipeline */
  let timer = null, needRebuild = false;
  function scheduleRebuild() { needRebuild = true; kick(); }
  function schedulePlan() { kick(); }
  function kick() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (needRebuild) { needRebuild = false; rebuild(); } else { S.g.setWeights(S.weights); plan(); } }, 35);
  }

  function rebuild() {
    S.scn.aircraft = D.aircraft.find(a => a.id === S.aircraftId);
    S.g = GR.evaluate(topo, airports, S.scn);
    S.g.setWeights(S.weights);
    S.overlay = null; S.atmRes = null;
    document.querySelector('input[name=ov][value=none]').checked = true;
    plan();
  }

  function runAlgo(name, s, d) {
    const g = S.g;
    switch (name) {
      case 'dijkstra': return A.dijkstra(g, s, d);
      case 'astar': return A.astar(g, s, d);
      case 'bellman': return A.bellmanFord(g, s, d);
      case 'floyd': return A.floydWarshall(g, s, d);
      default: return A.bfs(g, s, d);
    }
  }

  function plan() {
    S.selPareto = -1; S.anim.p = 0; S.anim.show = false; S.anim.playing = false; $('btnPlay').textContent = '▶ Fly route';
    if (S.origin === S.dest) { S.result = null; S.shown = null; S.direct = null; S.pareto = null; renderAll(); return; }
    S.result = runAlgo(S.algo, S.origin, S.dest);
    S.shown = S.result.found ? S.result.edges : null; S.shownLabel = '';
    S.direct = GR.directLeg(topo, airports, S.origin, S.dest, S.scn);
    S.pareto = S.result.found ? computePareto() : null;
    renderAll();
  }

  function computePareto() {
    const g = S.g, s = S.origin, d = S.dest, cands = [];
    const pr = A.pareto(g, s, d, {});
    pr.routes.forEach(r => cands.push(r));
    [{ t: 1, f: 0, e: 0 }, { t: 0, f: 1, e: 0 }, { t: 0, f: 0, e: 1 }].forEach(w => {   // single-objective extremes
      g.setWeights(w); const r = A.dijkstra(g, s, d); if (r.found) cands.push(r.edges);
    });
    g.setWeights(S.weights);
    if (S.result.found) cands.push(S.result.edges);
    const uniq = new Map();
    cands.forEach(edges => { const key = edges.map(e => e.id).join(','); if (!uniq.has(key)) uniq.set(key, { edges, key, m: GR.pathMetrics(edges) }); });
    let list = [...uniq.values()];
    const dom = (b, a) => b !== a && b.m.time <= a.m.time && b.m.fuel <= a.m.fuel && b.m.env <= a.m.env && (b.m.time < a.m.time || b.m.fuel < a.m.fuel || b.m.env < a.m.env);
    list = list.filter(a => !list.some(b => dom(b, a)));
    list.sort((a, b) => a.m.time - b.m.time);
    const minOf = k => Math.min(...list.map(r => r.m[k]));
    const pick = S.result.found ? S.result.edges.map(e => e.id).join(',') : '';
    list.forEach(r => {
      r.tags = [];
      if (r.m.time === minOf('time')) r.tags.push(['Fastest', 'g']);
      if (r.m.fuel === minOf('fuel')) r.tags.push(['Min fuel', 'a']);
      if (r.m.env === minOf('env')) r.tags.push(['Greenest', 'g']);
      if (r.key === pick) r.tags.push(['Planner pick', '']);
    });
    list.stats = { labels: pr.labels, settled: pr.expanded, ms: pr.ms };
    return list;
  }

  /* ------------------------------------------------------------------ rendering */
  function renderAll() {
    renderTop(); renderRoute(); renderTab(S.tab); updateHint(); map.draw();
  }

  function renderTop() {
    const g = S.g, st = g.stats;
    $('topstats').innerHTML =
      '<span><b>' + airports.length + '</b> airports</span><span><b>' + (g.edges.length / 2) + '</b> usable airways</span>' +
      '<span><b>' + st.blocked + '</b> blocked by no-fly zones</span><span><b>' + st.range + '</b> beyond aircraft range</span>' +
      (st.closed ? '<span><b>' + st.closed + '</b> closed</span>' : '');
  }

  function renderRoute() {
    const o = airports[S.origin], d = airports[S.dest], ac = S.scn.aircraft, g = S.g;
    const kp = (l, v, s) => '<div class="kpi"><span class="l">' + l + '</span><b>' + v + '</b><span class="s">' + (s || '&nbsp;') + '</span></div>';
    $('routeTitle').innerHTML = o.iata + ' → ' + d.iata + '<small>' + o.city + ' to ' + d.city + ' · ' + ac.name + '</small>';
    $('btnPlay').style.display = S.shown ? '' : 'none';
    if (S.origin === S.dest) { $('kpis').innerHTML = ''; $('legTable').innerHTML = ''; $('routeNote').innerHTML = '<div class="msg warn">Choose two different airports.</div>'; return; }
    if (!S.shown) {
      const st = g.stats, why = [];
      if (S.scn.closed.has(S.origin) || S.scn.closed.has(S.dest)) why.push('the origin or destination airport is <b>closed</b>');
      if (st.blocked) why.push('<b>' + st.blocked + '</b> airways are removed by restricted airspace');
      if (st.range) why.push('<b>' + st.range + '</b> airways exceed the ' + ac.name + ' range');
      if (st.closed) why.push('<b>' + st.closed + '</b> airways touch a closed airport');
      $('kpis').innerHTML = ''; $('legTable').innerHTML = '';
      $('routeNote').innerHTML = '<div class="msg bad"><b>No feasible route</b> from ' + o.iata + ' to ' + d.iata + ' with these constraints. ' + (why.length ? 'Reasons: ' + why.join('; ') + '.' : '') +
        '<br>Try a longer-range aircraft, disable “Respect restricted airspace”, remove a zone with the Erase tool, or reopen airports.</div>';
      return;
    }
    const edges = S.shown, m = GR.pathMetrics(edges);
    const gc = GEO.haversine(o.lat, o.lon, d.lat, d.lon);
    $('routeTitle').innerHTML = pathStr(edges).replace(/ → /g, ' <span style="color:var(--amber)">→</span> ') +
      '<small>' + (S.shownLabel || S.result.name) + ' · ' + ac.name + '</small>';
    $('kpis').innerHTML =
      kp('Distance', fmt.int(m.dist) + ' km', fmt.pct(m.dist / gc - 1) + ' vs great circle (' + fmt.int(gc) + ')') +
      kp('Flight time', fmt.dur(m.time), 'block time incl. ground ops') +
      kp('Fuel', fmt.kg(m.fuel), (m.fuel / m.dist).toFixed(2) + ' kg per km') +
      kp('CO₂e', fmt.t(m.env), 'illustrative incl. non-CO₂') +
      kp('Stops', m.stops, m.legs + ' leg' + (m.legs > 1 ? 's' : '')) +
      kp('Weather exposure', Math.round(m.wx * 100) + '%', 'mean severity on route · max ' + Math.round(m.maxSev * 100) + '%') +
      kp('Airspace load', Math.round(m.util * 100) + '%', S.scn.atmOn ? 'mean sector utilisation' : 'ATM load ignored') +
      kp('Search effort', (S.result.expanded) + ' / ' + S.result.relaxed, 'expanded / relaxed · ' + (S.result.ms * 1000).toFixed(0) + ' µs');

    let note = '';
    if (S.direct && S.direct.feasible) {
      const dm = S.direct.metrics;
      if (edges.length === 1) note = '<div class="msg">The best route under these weights is the <b>direct flight</b>.</div>';
      else note = '<div class="msg">Direct great-circle flight would take <b>' + fmt.dur(dm.time) + '</b>, burn <b>' + fmt.kg(dm.fuel) + '</b> and emit <b>' + fmt.t(dm.env) + '</b> CO₂e. This route: <b>' +
        fmt.pct(m.time / dm.time - 1) + '</b> time, <b>' + fmt.pct(m.fuel / dm.fuel - 1) + '</b> fuel, <b>' + fmt.pct(m.env / dm.env - 1) + '</b> CO₂e.</div>';
    } else if (S.direct) note = '<div class="msg warn">A direct flight is <b>not possible</b>: ' + S.direct.reason + '. The planner finds the best multi-leg route instead.</div>';
    $('routeNote').innerHTML = note;

    let rows = '';
    edges.forEach(e => {
      rows += '<tr><td class="l">' + airports[e.u].iata + ' → ' + airports[e.v].iata + '</td><td>' + fmt.int(e.dist) + ' km</td><td>' + fmt.dur(e.time) + '</td><td>' + fmt.kg(e.fuel) +
        '</td><td>' + fmt.t(e.env) + '</td><td>' + (e.wind >= 0 ? '+' : '') + Math.round(e.wind) + ' km/h</td><td>' + Math.round(e.sev * 100) + '%</td><td><span class="tag ' + utilCls(e.util) + '">' + Math.round(e.util * 100) + '%</span></td></tr>';
    });
    rows += '<tr><td class="l"><b>Total</b></td><td><b>' + fmt.int(m.dist) + ' km</b></td><td><b>' + fmt.dur(m.time) + '</b></td><td><b>' + fmt.kg(m.fuel) + '</b></td><td><b>' + fmt.t(m.env) + '</b></td><td></td><td></td><td></td></tr>';
    $('legTable').innerHTML = '<thead><tr><th class="l">Leg</th><th>Distance</th><th>Time</th><th>Fuel</th><th>CO₂e</th><th>Wind</th><th>Weather</th><th>ATM load</th></tr></thead><tbody>' + rows + '</tbody>';
  }

  /* ---------------- algorithm comparison ---------------- */
  function runCompare() {
    const g = S.g, s = S.origin, d = S.dest;
    if (s === d) { $('cmpTable').innerHTML = ''; return; }
    const defs = [
      { name: 'Dijkstra', cx: 'O((V+E) log V)', fn: () => A.dijkstra(g, s, d), reps: 300 },
      { name: 'A*', cx: 'O((V+E) log V)', fn: () => A.astar(g, s, d), reps: 300 },
      { name: 'Bellman–Ford', cx: 'O(V·E)', fn: () => A.bellmanFord(g, s, d), reps: 150 },
      { name: 'Floyd–Warshall', cx: 'O(V³)', fn: () => { g._fw = null; return A.floydWarshall(g, s, d); }, reps: 8 },
      { name: 'BFS (fewest stops)', cx: 'O(V+E)', fn: () => A.bfs(g, s, d), reps: 500 }
    ];
    const rows = defs.map(df => {
      const res = df.fn(); const t0 = performance.now();
      for (let i = 0; i < df.reps; i++) df.fn();
      return { df, res, us: (performance.now() - t0) / df.reps * 1000 };
    });
    g._fw = null;
    const ref = rows[0].res.found ? rows[0].res.cost : NaN;
    const fastestExact = Math.min(...rows.filter(r => r.res.found && Math.abs(r.res.cost - ref) <= 1e-9 * Math.max(1, ref)).map(r => r.us));
    let html = '<thead><tr><th class="l">Algorithm</th><th class="l">Complexity</th><th>Cost</th><th>Time</th><th>Fuel</th><th>CO₂e</th><th>Stops</th><th>Expanded</th><th>Relaxations</th><th>Runtime</th><th class="l">Optimal?</th></tr></thead><tbody>';
    rows.forEach(r => {
      const x = r.res;
      if (!x.found) { html += '<tr><td class="l">' + r.df.name + '</td><td class="l">' + r.df.cx + '</td><td colspan="9" class="l">no route</td></tr>'; return; }
      const m = GR.pathMetrics(x.edges), opt = Math.abs(x.cost - ref) <= 1e-9 * Math.max(1, ref);
      html += '<tr><td class="l"><b>' + r.df.name + '</b></td><td class="l">' + r.df.cx + '</td><td>' + x.cost.toFixed(1) + '</td><td>' + fmt.dur(m.time) + '</td><td>' + fmt.kg(m.fuel) + '</td><td>' + fmt.t(m.env) + '</td><td>' + m.stops +
        '</td><td>' + fmt.int(x.expanded) + '</td><td>' + fmt.int(x.relaxed) + '</td><td>' + r.us.toFixed(1) + ' µs' + (opt && r.us === fastestExact ? ' <span class="tag g">fastest exact</span>' : '') + '</td><td class="l">' +
        (opt ? '<span class="tag g">optimal</span>' : '<span class="tag r">+' + ((x.cost / ref - 1) * 100).toFixed(1) + '% cost</span>') + '</td></tr>';
    });
    $('cmpTable').innerHTML = html + '</tbody>';
    const pl = S.pareto ? S.pareto.stats : null;
    $('cmpInfo').textContent = 'V = ' + g.n + ' airports, E = ' + g.edges.length + ' directed airways. Runtimes are averaged over many repetitions.' + (pl ? ' Pareto search: ' + pl.settled + ' labels settled in ' + pl.ms.toFixed(1) + ' ms → ' + S.pareto.length + ' non-dominated routes.' : '');
    CH.groupedBars($('cmpChart'), {
      title: 'Mean runtime per query (µs)', cats: rows.map(r => r.df.name.replace(' (fewest stops)', '')),
      series: [{ name: 'µs', color: CH.palette[0], values: rows.map(r => +r.us.toFixed(1)) }], yLabel: 'µs'
    });
  }

  /* ---------------- Pareto ---------------- */
  const AX = { time: ['Flight time (min)', m => m.time], fuel: ['Fuel (kg)', m => m.fuel], env: ['CO₂e (kg)', m => m.env], dist: ['Distance (km)', m => m.dist], stops: ['Stops', m => m.stops], wx: ['Weather exposure (%)', m => m.wx * 100] };
  function renderPareto() {
    const list = S.pareto || [];
    if (!list.length) { $('parTable').innerHTML = '<tbody><tr><td class="l">No route available.</td></tr></tbody>'; $('parInfo').textContent = ''; CH.scatter($('parChart'), { points: [] }); return; }
    const kx = $('axX').value, ky = $('axY').value;
    const pts = list.map((r, i) => ({
      x: AX[kx][1](r.m), y: AX[ky][1](r.m), r: i === S.selPareto ? 8 : 6, label: String(i + 1),
      color: i === S.selPareto ? '#fbbf24' : CH.palette[0], ring: r.tags.some(t => t[0] === 'Planner pick') ? '#34d399' : null
    }));
    CH.scatter($('parChart'), { points: pts, xLabel: AX[kx][0], yLabel: AX[ky][0], title: 'Non-dominated routes (green ring = current planner pick)' });
    $('parInfo').textContent = list.length + ' Pareto-optimal route' + (list.length > 1 ? 's' : '') + ' · ' + list.stats.settled + ' labels settled in ' + list.stats.ms.toFixed(1) + ' ms';
    let html = '<thead><tr><th class="l">#</th><th class="l">Route</th><th>Time</th><th>Fuel</th><th>CO₂e</th><th>Stops</th><th class="l"></th></tr></thead><tbody>';
    list.forEach((r, i) => {
      html += '<tr class="click ' + (i === S.selPareto ? 'sel' : '') + '" data-i="' + i + '"><td class="l">' + (i + 1) + '</td><td class="l">' + pathStr(r.edges) + '</td><td>' + fmt.dur(r.m.time) + '</td><td>' + fmt.kg(r.m.fuel) + '</td><td>' + fmt.t(r.m.env) + '</td><td>' + r.m.stops + '</td><td class="l">' +
        r.tags.map(t => '<span class="tag ' + t[1] + '">' + t[0] + '</span>').join('') + '</td></tr>';
    });
    $('parTable').innerHTML = html + '</tbody>';
    $('parTable').querySelectorAll('tr.click').forEach(tr => tr.addEventListener('click', () => selectPareto(+tr.dataset.i)));
  }
  function selectPareto(i) {
    const r = S.pareto[i]; if (!r) return;
    S.selPareto = i; S.shown = r.edges; S.shownLabel = 'Pareto route ' + (i + 1);
    S.anim.p = 0; S.anim.show = false;
    renderRoute(); renderPareto(); map.draw();
  }

  /* ---------------- ATM ---------------- */
  const STRAT = [['selfish', 'Uncoordinated', CH.palette[3]], ['atm', 'ATM sequential', CH.palette[0]], ['atm+rr', 'ATM + re-route', CH.palette[2]]];
  function runAtm() {
    const g = S.g, F = +$('rFl').value, cap = +$('rCap').value;
    const flights = FRP.atm.genFlights(g, F, 2024);
    S.atmRes = STRAT.map(s => FRP.atm.run(g, flights, s[0], cap, 3));
    $('atmOverlayRow').style.display = '';
    renderAtm();
  }
  function renderAtm() {
    const res = S.atmRes;
    if (!res) { $('atmTable').innerHTML = '<tbody><tr><td class="l">Press “Simulate traffic”.</td></tr></tbody>'; CH.groupedBars($('atmChart'), { cats: [], series: [] }); return; }
    const rowsDef = [
      ['Mean flight time (free flow)', r => fmt.dur(r.avgFree)],
      ['Mean flight time (with congestion)', r => fmt.dur(r.avgReal)],
      ['Congestion delay', r => '+' + r.delayPct.toFixed(1) + '%', r => r.delayPct],
      ['Peak link utilisation', r => Math.round(r.maxUtil * 100) + '%', r => r.maxUtil],
      ['Overloaded links (>100%)', r => r.overloaded, r => r.overloaded],
      ['Mean utilisation of used links', r => Math.round(r.meanUtil * 100) + '%'],
      ['Utilisation std-dev (balance)', r => r.utilStd.toFixed(2), r => r.utilStd],
      ['Airways in use', r => r.usedLinks],
      ['Mean stops per flight', r => r.avgStops.toFixed(2)],
      ['Compute time', r => r.ms.toFixed(0) + ' ms']
    ];
    let html = '<thead><tr><th class="l">' + res[0].routed + ' flights</th>' + STRAT.map(s => '<th>' + s[1] + '</th>').join('') + '</tr></thead><tbody>';
    rowsDef.forEach(rd => {
      const best = rd[2] ? Math.min(...res.map(rd[2])) : null;
      html += '<tr><td class="l">' + rd[0] + '</td>' + res.map(r => '<td>' + (best !== null && rd[2](r) === best && res.some(x => rd[2](x) !== best) ? '<span class="tag g">' + rd[1](r) + '</span>' : rd[1](r)) + '</td>').join('') + '</tr>';
    });
    $('atmTable').innerHTML = html + '</tbody>';
    CH.groupedBars($('atmChart'), {
      title: 'Number of airways by utilisation band', yLabel: 'airways', cats: ['<25%', '25–50%', '50–75%', '75–100%', '100–150%', '>150%'],
      series: res.map((r, i) => ({ name: STRAT[i][1], color: STRAT[i][2], values: r.bins }))
    });
  }
  function setOverlay(kind) {
    if (kind === 'none' || !S.atmRes) { S.overlay = null; map.draw(); return; }
    const r = S.atmRes.find(x => x.strategy === kind);
    const linkUtil = new Map();
    S.g.edges.forEach(e => { const u = r.load[e.id] / r.cap[e.id]; if (u > (linkUtil.get(e.link.id) || 0)) linkUtil.set(e.link.id, u); });
    S.overlay = { linkUtil }; map.draw();
  }

  /* ---------------- scalability experiments ---------------- */
  const SC = { dijkstra: CH.palette[0], astar: CH.palette[1], bellman: CH.palette[2], floyd: CH.palette[3] };
  function setBusy(b, msg) { ['btnB1', 'btnB2', 'btnB3'].forEach(i => { $(i).disabled = b; }); $('benchInfo').textContent = msg || ''; }
  function drawBench() { if (S.bench) S.bench(); }

  async function runB1() {
    setBusy(true, 'running …');
    try {
      const sizes = [50, 100, 200, 400, 800, 1600];
      const r = await FRP.bench.graphScaling(sizes, { fwMax: 400 }, m => setBusy(true, m));
      S.bench = () => {
        const ser = (k, f) => r.rows.filter(x => x[k]).map(x => [x.n, f(x[k])]);
        CH.lineChart($('benchA'), { title: 'Runtime per query vs number of airports', xLabel: 'airports (V)', yLabel: 'ms', logX: true, logY: true,
          series: [{ name: 'Dijkstra', color: SC.dijkstra, pts: ser('dijkstra', x => x.ms) }, { name: 'A*', color: SC.astar, pts: ser('astar', x => x.ms) }, { name: 'Bellman–Ford', color: SC.bellman, pts: ser('bellman', x => x.ms) }, { name: 'Floyd–Warshall (all pairs)', color: SC.floyd, pts: ser('floyd', x => x.ms) }] });
        CH.lineChart($('benchB'), { title: 'Edge relaxations (work) vs number of airports', xLabel: 'airports (V)', yLabel: 'relaxations', logX: true, logY: true,
          series: [{ name: 'Dijkstra', color: SC.dijkstra, pts: ser('dijkstra', x => x.relaxed) }, { name: 'A*', color: SC.astar, pts: ser('astar', x => x.relaxed) }, { name: 'Bellman–Ford', color: SC.bellman, pts: ser('bellman', x => x.relaxed) }, { name: 'Floyd–Warshall', color: SC.floyd, pts: ser('floyd', x => x.relaxed) }] });
        const f = r.fit, e = v => (isFinite(v) ? v.toFixed(2) : '–');
        $('benchNote').innerHTML = '<div class="msg">Empirical growth exponent (log–log least squares, V ≥ 100): runtime ∝ V<sup>k</sup> with <b>Dijkstra k ≈ ' + e(f.dijkstra) + '</b>, <b>A* k ≈ ' + e(f.astar) + '</b>, <b>Bellman–Ford k ≈ ' + e(f.bellman) +
          '</b>, <b>Floyd–Warshall k ≈ ' + e(f.floyd) + '</b> (theory: ≈1, ≈1, 1–2 with early exit, 3). Floyd–Warshall is only run up to V = 400. Sparse graphs have E ≈ 3–6·V.</div>';
        let h = '<thead><tr><th>Airports</th><th>Airways</th><th>Build (ms)</th><th>Dijkstra ms</th><th>A* ms</th><th>Bellman–Ford ms</th><th>Floyd–W. ms</th><th>Dij. expanded</th><th>A* expanded</th></tr></thead><tbody>';
        r.rows.forEach(x => { h += '<tr><td>' + x.n + '</td><td>' + x.edges + '</td><td>' + x.buildMs.toFixed(0) + '</td><td>' + (x.dijkstra ? x.dijkstra.ms.toFixed(3) : '–') + '</td><td>' + (x.astar ? x.astar.ms.toFixed(3) : '–') + '</td><td>' + (x.bellman ? x.bellman.ms.toFixed(3) : '–') + '</td><td>' + (x.floyd ? x.floyd.ms.toFixed(1) : '–') + '</td><td>' + (x.dijkstra ? x.dijkstra.expanded.toFixed(0) : '–') + '</td><td>' + (x.astar ? x.astar.expanded.toFixed(0) : '–') + '</td></tr>'; });
        $('benchTable').innerHTML = h + '</tbody>';
      };
      drawBench(); setBusy(false, 'done');
    } catch (err) { console.error(err); setBusy(false, 'error: ' + err.message); }
  }

  async function runB2() {
    setBusy(true, 'running …');
    try {
      const r = await FRP.bench.airspaceScaling([0, 10, 20, 40, 80, 160, 320], 400, m => setBusy(true, m));
      S.bench = () => {
        CH.lineChart($('benchA'), { title: 'Cost of modelling airspace (400 airports)', xLabel: 'weather cells (+ 1 no-fly zone per 4 cells)', yLabel: 'ms', xZero: true,
          series: [{ name: 'Graph construction', color: CH.palette[1], pts: r.rows.map(x => [x.count, x.buildMs]) }, { name: 'A* query', color: CH.palette[0], pts: r.rows.map(x => [x.count, x.queryMs]) }] });
        CH.lineChart($('benchB'), { title: 'Airways removed by restricted airspace', xLabel: 'weather cells (+ zones)', yLabel: 'airways', xZero: true,
          series: [{ name: 'blocked airways', color: CH.palette[5], pts: r.rows.map(x => [x.count, x.blocked]) }, { name: 'usable (directed ÷ 2)', color: CH.palette[2], pts: r.rows.map(x => [x.count, x.edges / 2]) }] });
        $('benchNote').innerHTML = '<div class="msg">Graph construction is <b>O(E · samples · (W + Z))</b>: every airway is sampled along its great circle and tested against each hazard, so it grows linearly with the number of weather cells and zones. The shortest-path query itself hardly changes – it only sees the (shrinking) set of surviving airways.</div>';
        let h = '<thead><tr><th>Weather cells</th><th>No-fly zones</th><th>Build (ms)</th><th>A* query (ms)</th><th>Blocked airways</th><th>Directed edges</th></tr></thead><tbody>';
        r.rows.forEach(x => { h += '<tr><td>' + x.count + '</td><td>' + x.zones + '</td><td>' + x.buildMs.toFixed(1) + '</td><td>' + x.queryMs.toFixed(3) + '</td><td>' + x.blocked + '</td><td>' + x.edges + '</td></tr>'; });
        $('benchTable').innerHTML = h + '</tbody>';
      };
      drawBench(); setBusy(false, 'done');
    } catch (err) { console.error(err); setBusy(false, 'error: ' + err.message); }
  }

  async function runB3() {
    setBusy(true, 'running …');
    try {
      const cap = +$('rCap').value;
      const r = await FRP.bench.trafficScaling(S.g, [50, 100, 200, 400, 800, 1600], cap, m => setBusy(true, m));
      S.bench = () => {
        CH.lineChart($('benchA'), { title: 'Routing runtime vs number of flights (world network)', xLabel: 'flights', yLabel: 'ms', xZero: true,
          series: STRAT.map(s => ({ name: s[1], color: s[2], pts: r.rows.map(x => [x.flights, x[s[0]].ms]) })) });
        CH.lineChart($('benchB'), { title: 'Congestion delay vs number of flights', xLabel: 'flights', yLabel: 'delay %', xZero: true,
          series: STRAT.map(s => ({ name: s[1], color: s[2], pts: r.rows.map(x => [x.flights, x[s[0]].delayPct]) })) });
        $('benchNote').innerHTML = '<div class="msg">Capacity multiplier ×' + cap.toFixed(1) + ' (from the ATM tab). Routing F flights costs <b>O(F · (V+E) log V)</b> per pass – linear in F; each re-route round adds one more pass. Coordination keeps delay lower as demand grows because later flights see the load of earlier ones and spread over alternative airways.</div>';
        let h = '<thead><tr><th>Flights</th>' + STRAT.map(s => '<th>' + s[1] + ' ms</th><th>delay</th><th>peak util</th>').join('') + '</tr></thead><tbody>';
        r.rows.forEach(x => { h += '<tr><td>' + x.flights + '</td>' + STRAT.map(s => '<td>' + x[s[0]].ms.toFixed(0) + '</td><td>+' + x[s[0]].delayPct.toFixed(1) + '%</td><td>' + Math.round(x[s[0]].maxUtil * 100) + '%</td>').join('') + '</tr>'; });
        $('benchTable').innerHTML = h + '</tbody>';
      };
      drawBench(); setBusy(false, 'done');
    } catch (err) { console.error(err); setBusy(false, 'error: ' + err.message); }
  }

  /* ---------------- tabs ---------------- */
  function renderTab(t) {
    S.showPareto = t === 'pareto';
    if (t === 'algos') runCompare();
    else if (t === 'pareto') renderPareto();
    else if (t === 'atm') renderAtm();
    else if (t === 'scale') drawBench();
  }
  function setTab(t) {
    S.tab = t;
    document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + t));
    renderTab(t); map.draw();
  }

  /* ------------------------------------------------------------------ controls wiring */
  function fillSelects() {
    const opts = airports.slice().sort((a, b) => a.city.localeCompare(b.city)).map(a => '<option value="' + a.i + '">' + a.city + ' (' + a.iata + ')</option>').join('');
    $('selOrigin').innerHTML = opts; $('selDest').innerHTML = opts;
    $('selAircraft').innerHTML = D.aircraft.map(a => '<option value="' + a.id + '">' + a.name + '</option>').join('');
    ['axX', 'axY'].forEach(id => { $(id).innerHTML = Object.keys(AX).map(k => '<option value="' + k + '">' + AX[k][0] + '</option>').join(''); });
    $('axX').value = 'time'; $('axY').value = 'fuel';
    $('selAircraft').value = S.aircraftId;
  }
  function syncSelects() { $('selOrigin').value = S.origin; $('selDest').value = S.dest; }

  const ALGO_INFO = {
    astar: 'O((V+E) log V). Dijkstra steered by the great-circle distance × min cost/km – admissible and consistent, so the answer is optimal but fewer airports are expanded.',
    dijkstra: 'O((V+E) log V) with a binary min-heap. Exact for non-negative weights; explores outward in rings of equal cost.',
    bellman: 'O(V·E). Repeatedly relaxes every airway (dynamic programming); stops early when a full pass changes nothing.',
    floyd: 'O(V³) time, O(V²) space. Computes the shortest path between all airport pairs; the table is then reused for any query.',
    bfs: 'O(V+E). Minimises the number of legs and ignores weights – shows what “fewest stops” costs in time, fuel and CO₂e.'
  };
  function updateInfo() {
    const ac = D.aircraft.find(a => a.id === S.aircraftId);
    $('acInfo').textContent = 'Cruise ' + ac.speed + ' km/h · burn ' + ac.burn + ' kg/km · usable range ' + fmt.int(ac.range * 0.92) + ' km';
    $('algoInfo').textContent = ALGO_INFO[S.algo];
    const sum = S.weights.t + S.weights.f + S.weights.e || 1;
    $('oT').textContent = Math.round(S.weights.t / sum * 100) + '%';
    $('oF').textContent = Math.round(S.weights.f / sum * 100) + '%';
    $('oE').textContent = Math.round(S.weights.e / sum * 100) + '%';
    $('oWx').textContent = '×' + S.scn.wxScale.toFixed(1);
    $('oCong').textContent = Math.round(S.scn.congLevel * 100) + '%';
    $('oRad').textContent = S.toolRadius + ' km';
    $('oSev').textContent = Math.round(S.toolSev * 100) + '%';
    $('oFl').textContent = $('rFl').value; $('oCap').textContent = '×' + (+$('rCap').value).toFixed(1);
  }

  function wire() {
    $('selOrigin').addEventListener('change', e => { S.origin = +e.target.value; schedulePlan(); });
    $('selDest').addEventListener('change', e => { S.dest = +e.target.value; schedulePlan(); });
    $('btnSwap').addEventListener('click', () => { [S.origin, S.dest] = [S.dest, S.origin]; syncSelects(); schedulePlan(); });
    $('selAircraft').addEventListener('change', e => { S.aircraftId = e.target.value; updateInfo(); scheduleRebuild(); });
    $('selAlgo').addEventListener('change', e => { S.algo = e.target.value; updateInfo(); schedulePlan(); });

    const wl = { wT: 't', wF: 'f', wE: 'e' };
    Object.keys(wl).forEach(id => $(id).addEventListener('input', e => { S.weights[wl[id]] = +e.target.value; updateInfo(); schedulePlan(); }));
    const PRE = { fast: [100, 0, 0], fuel: [0, 100, 0], green: [0, 0, 100], bal: [34, 33, 33] };
    document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
      const p = PRE[b.dataset.preset]; S.weights = { t: p[0], f: p[1], e: p[2] };
      $('wT').value = p[0]; $('wF').value = p[1]; $('wE').value = p[2]; updateInfo(); schedulePlan();
    }));

    $('cWind').addEventListener('change', e => { S.scn.windOn = e.target.checked; scheduleRebuild(); });
    $('cWx').addEventListener('change', e => { S.scn.weatherOn = e.target.checked; scheduleRebuild(); });
    $('rWx').addEventListener('input', e => { S.scn.wxScale = +e.target.value; updateInfo(); scheduleRebuild(); });
    $('cZones').addEventListener('change', e => { S.scn.zonesOn = e.target.checked; scheduleRebuild(); });
    $('cAtm').addEventListener('change', e => { S.scn.atmOn = e.target.checked; scheduleRebuild(); });
    $('rCong').addEventListener('input', e => { S.scn.congLevel = +e.target.value; updateInfo(); scheduleRebuild(); });
    $('cNet').addEventListener('change', e => { S.showNetwork = e.target.checked; map.draw(); });

    $('rRad').addEventListener('input', e => { S.toolRadius = +e.target.value; updateInfo(); updateHint(); });
    $('rSev').addEventListener('input', e => { S.toolSev = +e.target.value; updateInfo(); updateHint(); });
    $('btnRandWx').addEventListener('click', () => {
      const h = GR.randomHazards(8, 0, Math.floor(Math.random() * 1e6));
      S.scn.weather = h.weather.map((w, i) => withId(Object.assign({ name: 'Cell ' + (i + 1) }, w, { r: Math.round(w.r / 50) * 50, sev: Math.round(w.sev * 20) / 20 })));
      scheduleRebuild();
    });
    $('btnClearWx').addEventListener('click', () => { S.scn.weather = []; scheduleRebuild(); });
    $('btnReset').addEventListener('click', () => { resetScenario(); scheduleRebuild(); });

    document.querySelectorAll('#maptools button').forEach(b => b.addEventListener('click', () => {
      S.tool = b.dataset.tool;
      document.querySelectorAll('#maptools button').forEach(x => x.classList.toggle('on', x === b));
      updateHint();
    }));
    $('zIn').addEventListener('click', () => map.zoomBy(1.4));
    $('zOut').addEventListener('click', () => map.zoomBy(1 / 1.4));
    $('zReset').addEventListener('click', () => map.reset());

    document.querySelectorAll('#tabbar button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('btnCompare').addEventListener('click', runCompare);
    $('axX').addEventListener('change', renderPareto); $('axY').addEventListener('change', renderPareto);
    $('parChart').addEventListener('click', e => {
      const c = $('parChart'), r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let best = -1, bd = 18 * 18;
      (c._hit || []).forEach(h => { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = h.i; } });
      if (best >= 0) selectPareto(best);
    });
    $('rFl').addEventListener('input', updateInfo); $('rCap').addEventListener('input', updateInfo);
    $('btnAtm').addEventListener('click', runAtm);
    document.querySelectorAll('input[name=ov]').forEach(r => r.addEventListener('change', e => setOverlay(e.target.value)));
    $('btnB1').addEventListener('click', runB1); $('btnB2').addEventListener('click', runB2); $('btnB3').addEventListener('click', runB3);

    // animation
    $('btnPlay').addEventListener('click', () => {
      if (!S.poly) return;
      if (S.anim.playing) { S.anim.playing = false; $('btnPlay').textContent = '▶ Fly route'; return; }
      if (S.anim.p >= 1) S.anim.p = 0;
      S.anim.show = true; S.anim.playing = true; $('btnPlay').textContent = '⏸ Pause';
      let last = performance.now();
      const loop = now => {
        if (!S.anim.playing) return;
        const dt = now - last; last = now;
        S.anim.p = Math.min(1, S.anim.p + dt / 8000);
        map.draw();
        if (S.anim.p >= 1) { S.anim.playing = false; $('btnPlay').textContent = '↻ Fly again'; return; }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });

    let rz = null;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => renderTab(S.tab), 120); });
  }

  /* ------------------------------------------------------------------ boot */
  fillSelects(); syncSelects(); updateInfo(); wire();
  rebuild();
  window.FRP.app = { S, rebuild, plan, setTab };   // handy for the browser console / testing
})();
