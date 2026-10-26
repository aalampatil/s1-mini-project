/* geo.js – spherical geometry helpers (great-circle maths, seeded RNG) */
window.FRP = window.FRP || {};
FRP.geo = (function () {
  'use strict';
  const R = 6371.0088;               // mean Earth radius (km)
  const rad = Math.PI / 180, deg = 180 / Math.PI;

  /** Great-circle distance in km (haversine formula). */
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Initial bearing (deg, 0 = north, 90 = east) from point 1 to point 2. */
  function bearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * rad, p2 = lat2 * rad, dl = (lon2 - lon1) * rad;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * deg + 360) % 360;
  }

  /** Point at fraction f (0..1) along the great circle 1 -> 2 (spherical interpolation). */
  function interpolate(lat1, lon1, lat2, lon2, f) {
    const d = haversine(lat1, lon1, lat2, lon2) / R;
    if (d < 1e-9) return [lat1, lon1];
    const p1 = lat1 * rad, l1 = lon1 * rad, p2 = lat2 * rad, l2 = lon2 * rad;
    const s = Math.sin(d);
    const A = Math.sin((1 - f) * d) / s, B = Math.sin(f * d) / s;
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    return [Math.atan2(z, Math.sqrt(x * x + y * y)) * deg, Math.atan2(y, x) * deg];
  }

  /** Sample a great circle every ~stepKm. Longitudes are unwrapped (continuous) for drawing. */
  function samplePath(lat1, lon1, lat2, lon2, stepKm) {
    const d = haversine(lat1, lon1, lat2, lon2);
    const n = Math.max(2, Math.min(60, Math.ceil(d / stepKm)));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(interpolate(lat1, lon1, lat2, lon2, i / n));
    for (let i = 1; i < pts.length; i++) {
      while (pts[i][1] - pts[i - 1][1] > 180) pts[i][1] -= 360;
      while (pts[i][1] - pts[i - 1][1] < -180) pts[i][1] += 360;
    }
    return pts;
  }

  /** Destination point given start, bearing (deg) and distance (km). */
  function destination(lat, lon, brg, distKm) {
    const dd = distKm / R, t = brg * rad, p1 = lat * rad, l1 = lon * rad;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(dd) + Math.cos(p1) * Math.sin(dd) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(dd) * Math.cos(p1),
      Math.cos(dd) - Math.sin(p1) * Math.sin(p2));
    return [p2 * deg, l2 * deg];
  }

  /** Polygon approximating a geodesic circle (for drawing weather cells / no-fly zones). */
  function circlePoints(lat, lon, rKm, n) {
    n = n || 48;
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(destination(lat, lon, (360 * i) / n, rKm));
    for (let i = 1; i < pts.length; i++) {
      while (pts[i][1] - pts[i - 1][1] > 180) pts[i][1] -= 360;
      while (pts[i][1] - pts[i - 1][1] < -180) pts[i][1] += 360;
    }
    return pts;
  }

  /** Small deterministic PRNG so experiments are reproducible. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return { R, rad, deg, haversine, bearing, interpolate, samplePath, destination, circlePoints, mulberry32 };
})();
