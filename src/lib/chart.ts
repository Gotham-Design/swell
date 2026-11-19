// Pure helpers for the overview chart: "nice" y-axis steps and a smooth path through points.

/** Round a step up to 1, 2, 2.5 or 5 × 10^n so axis labels read cleanly. */
export function niceStep(raw: number): number {
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * pow;
}

/** Ticks from 0 to just above max, about `count` steps. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const step = niceStep(max / count);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** A smooth SVG path through the points that never overshoots them. */
export function smoothPath(points: [number, number][]): string {
  // Monotone cubic (Fritsch–Carlson): smooth, but never overshoots between points, so a
  // line that goes 0 → 0 stays flat and never dips below the axis.
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  const n = points.length;
  const dx = points.slice(1).map((p, i) => p[0] - points[i][0]);
  const slope = points.slice(1).map((p, i) => (p[1] - points[i][1]) / (dx[i] || 1));
  const m = points.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    return slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * slope[i]; m[i + 1] = t * b * slope[i]; }
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const h = dx[i] / 3;
    d += ` C${(x1 + h).toFixed(1)},${(y1 + m[i] * h).toFixed(1)} ${(x2 - h).toFixed(1)},${(y2 - m[i + 1] * h).toFixed(1)} ${x2},${y2}`;
  }
  return d;
}

/** "14k", "3.5k", "800" — axis labels in dollars from cents. */
export function axisLabel(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `${Number((dollars / 1_000_000).toFixed(1))}m`;
  if (dollars >= 1000) return `${Number((dollars / 1000).toFixed(1))}k`;
  return String(Math.round(dollars));
}
