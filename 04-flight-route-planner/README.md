# SkyPath – Flight Route Planner (DAA Minor Project)

A graph-algorithm based flight route planner written in **plain HTML + CSS + JavaScript** (no libraries, no internet needed).

## How to run
Unzip and double-click `index.html` (any modern browser). That's it.

## Graph model
* **Vertices** – 68 real airports (lat/lon, hub tier 1-5).
* **Edges** – directed airways (≈520 links: nearest neighbours + hub-to-hub long-haul + connectivity repair).
* **Edge weights** – each edge carries `time`, `fuel`, `CO₂e`, `weather risk`. They depend on:
  aircraft (speed, burn, range, take-off/landing fuel) · jet-stream wind · weather cells (severity sampled along the great circle) ·
  restricted airspace (edge removed) · airport congestion (taxi/holding) · ATM sector load · extra burn for long legs.
* **Scalar cost** (weighted-sum objective): `w_t·time/ref_t + w_f·fuel/ref_f + w_e·CO₂e/ref_e`, all non-negative.

## Algorithms (in `js/algorithms.js`, `js/atm.js`)
| Algorithm | Complexity | Use |
|---|---|---|
| Dijkstra (binary heap) | O((V+E) log V) | exact shortest path |
| A* (great-circle heuristic) | O((V+E) log V) worst, fewer expansions | admissible + consistent heuristic = optimal |
| Bellman–Ford | O(V·E) | DP baseline, early exit |
| Floyd–Warshall | O(V³) | all-pairs |
| BFS | O(V+E) | fewest stops baseline |
| Pareto label-setting | O(K²·E) with label cap K + ε-dominance | multi-objective non-dominated routes |
| ATM flow assignment | O(F·(V+E) log V) per round | many flights, BPR congestion `1+0.15(load/cap)^4`, rip-up & re-route |

## Features mapped to the project brief
* **Weather integration** – storm/turbulence cells slow & burn more; edit them live (Storm tool, random weather).
* **Air-traffic-management integration** – sector load factor in edge cost + *Air traffic (ATM)* tab comparing uncoordinated vs coordinated routing, with a utilisation heat-map on the map.
* **Multi-objective optimisation** – weight sliders/presets (fastest, min fuel, greenest) + *Pareto front* tab.
* **Restricted airspace / closed airports** – No-fly tool, Close-airport tool.
* **UI** – interactive map (pan, zoom, click airports), route animation, KPI cards, leg table.
* **Performance analysis** – *Algorithms* tab (same query, all algorithms: cost, expansions, relaxations, µs) and *Scalability* tab
  (runtime/work vs number of airports with fitted growth exponent, airspace complexity, traffic load).

## Project structure
```
index.html          page + all tabs
css/style.css
js/geo.js           haversine, bearing, great-circle interpolation, seeded RNG
js/data.js          airports, aircraft, default weather/no-fly zones, coarse map outlines
js/graph.js         topology + scenario → weighted graph (edge cost model)
js/algorithms.js    heap, Dijkstra, A*, Bellman-Ford, Floyd-Warshall, BFS, Pareto
js/atm.js           traffic simulation (3 strategies)
js/benchmark.js     scalability experiments
js/charts.js        canvas charts      js/map.js  map renderer      js/ui.js  controller
```

## Viva cheat-sheet
* *Why Dijkstra is valid?* all edge costs ≥ 0 (time, fuel, CO₂e are positive).
* *Why is A* optimal here?* h(v) = great-circle(v,dest) × min(cost/km) never overestimates, and is consistent (triangle inequality on the sphere).
* *Why can weighted-sum miss routes?* it only finds points on the convex hull of the Pareto front → label-setting Pareto search.
* *Bellman-Ford vs Dijkstra?* BF tolerates negative edges but is O(VE); not needed here.
* *Limitations* – fuel/CO₂ formulas are simplified; coastlines are coarse; airways are generated, not real ATS routes.
