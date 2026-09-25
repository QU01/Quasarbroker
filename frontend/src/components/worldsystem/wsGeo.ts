// GeoJSON builders for the world-system and static OSINT layers (MapLibre view).
import { colorFor, type IndicatorDef, type Matrix, type WorldSystemMeta } from "@/lib/worldsystem";
import type { CountriesFC, StaticData } from "@/hooks/useWorldSystem";

type Pos = [number, number];
type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
export type FC = { type: "FeatureCollection"; features: Feature[] };
const fc = (features: Feature[]): FC => ({ type: "FeatureCollection", features });

/** Great-circle interpolation with unwrapped longitudes (continuous across the antimeridian). */
export function greatCircle(a: Pos, b: Pos, n = 32): Pos[] {
  const toR = Math.PI / 180;
  const [l1, p1, l2, p2] = [a[0] * toR, a[1] * toR, b[0] * toR, b[1] * toR];
  const v1 = [Math.cos(p1) * Math.cos(l1), Math.cos(p1) * Math.sin(l1), Math.sin(p1)];
  const v2 = [Math.cos(p2) * Math.cos(l2), Math.cos(p2) * Math.sin(l2), Math.sin(p2)];
  const d = Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2])));
  if (d < 1e-6) return [a, b];
  const out: Pos[] = [];
  let prev = a[0];
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    const s1 = Math.sin((1 - f) * d) / Math.sin(d), s2 = Math.sin(f * d) / Math.sin(d);
    const x = s1 * v1[0] + s2 * v2[0], y = s1 * v1[1] + s2 * v2[1], z = s1 * v1[2] + s2 * v2[2];
    let lng = Math.atan2(y, x) / toR;
    const lat = Math.atan2(z, Math.hypot(x, y)) / toR;
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    prev = lng;
    out.push([lng, lat]);
  }
  return out;
}

/** Split a polyline where it jumps across the antimeridian. */
export function splitDateline(pts: Pos[]): Pos[][] {
  const parts: Pos[][] = [[]];
  pts.forEach((p, i) => {
    if (i > 0 && Math.abs(p[0] - pts[i - 1][0]) > 180) parts.push([]);
    parts[parts.length - 1].push(p);
  });
  return parts.filter((p) => p.length > 1);
}

export function choropleth(countries: CountriesFC | null, meta: WorldSystemMeta | null, values: Matrix | undefined,
  ind: IndicatorDef, year: number, selected: string | null): FC | null {
  if (!countries || !meta || !values) return null;
  const t = meta.years.indexOf(year);
  const byNum = new Map(meta.isonum.map((n, i) => [n, i]));
  return fc(countries.features.filter((f) => f.properties.name !== "Antarctica").map((f) => {
    const i = byNum.get(f.id);
    const v = i == null || t < 0 ? null : values[i]?.[t] ?? null;
    const iso = i == null ? null : meta.iso3[i];
    return {
      type: "Feature",
      properties: { type: "ws_country", id: iso ? `ws-${iso}` : `ws-${f.id}`, iso3: iso, name: i == null ? f.properties.name : meta.names[i],
        value: v, label: v == null ? "sin datos" : ind.fmt(v), color: colorFor(ind, v) ?? "rgba(120,130,140,0.25)", sel: iso === selected ? 1 : 0 },
      geometry: f.geometry,
    };
  }));
}

export function conflicts(sd: StaticData, meta: WorldSystemMeta | null, year: number, modelConflict?: Matrix): FC | null {
  const c = sd.conflictos;
  if (!c) return null;
  if (c.ged && c.ged.filas.length) {
    return fc(c.ged.filas.map(([lng, lat, n, d, k]) => ({ type: "Feature", properties: { kind: "ged", events: n, deaths: d, violence: k },
      geometry: { type: "Point", coordinates: [lng, lat] } })));
  }
  const pos = c.modelo.posiciones;
  if (year <= 2019) {
    return fc(c.modelo.conflictos.filter((i) => pos[i]).map((i) => ({ type: "Feature",
      properties: { kind: "pais", name: meta?.names[i] ?? "", deaths: 1000 }, geometry: { type: "Point", coordinates: pos[i] } })));
  }
  // after the observed data: countries with modelled conflict probability >= 30 %
  const t = meta ? meta.years.indexOf(year) : -1;
  const feats: Feature[] = [];
  if (modelConflict && t >= 0) modelConflict.forEach((row, i) => {
    const v = row?.[t];
    if (v != null && v >= 0.3 && pos[i]) feats.push({ type: "Feature", properties: { kind: "riesgo", name: meta?.names[i] ?? "", risk: v, deaths: 300 },
      geometry: { type: "Point", coordinates: pos[i] as Pos } });
  });
  return fc(feats);
}

export function trade(sd: StaticData, meta: WorldSystemMeta | null): FC | null {
  const m = sd.comercio;
  if (!m) return null;
  const mx = Math.max(1, ...m.comercio.map((r) => r[2]));
  return fc(m.comercio.filter(([i, j]) => m.posiciones[i] && m.posiciones[j]).flatMap(([i, j, v]) =>
    splitDateline(greatCircle(m.posiciones[i] as Pos, m.posiciones[j] as Pos, 40)).map((pts) => ({ type: "Feature" as const,
      properties: { value: v, w: Math.sqrt(v / mx), name: `${meta?.names[i] ?? i} → ${meta?.names[j] ?? j}` }, geometry: { type: "LineString", coordinates: pts } }))));
}

export function airRoutes(sd: StaticData): FC | null {
  const v = sd.vuelos;
  if (!v) return null;
  const mx = v.filas[0]?.[4] ?? 1;
  return fc(v.filas.flatMap((r) => splitDateline(greatCircle([r[0], r[1]], [r[2], r[3]], 24)).map((pts) => ({ type: "Feature" as const,
    properties: { w: r[4] / mx, name: `${r[5]} – ${r[6]}` }, geometry: { type: "LineString", coordinates: pts } }))));
}

function lineFC(items: { pts: Pos[]; props: Record<string, unknown> }[]): FC {
  return fc(items.flatMap(({ pts, props }) =>
    splitDateline(pts).map((p) => ({ type: "Feature" as const, properties: props, geometry: { type: "LineString", coordinates: p } }))));
}

export function shipping(sd: StaticData): FC | null {
  return sd.maritimo ? lineFC(sd.maritimo.filas.map(([tier, pts]) => ({ pts, props: { tier } }))) : null;
}
export function pipelines(sd: StaticData): FC | null {
  return sd.ductos ? lineFC(sd.ductos.filas.map(([fluid, name, pts]) => ({ pts, props: { fluid, name } }))) : null;
}
export function cables(sd: StaticData): FC | null {
  return sd.cables ? lineFC(sd.cables.filas.map(([name, color, pts]) => ({ pts, props: { name, color } }))) : null;
}

export function energy(sd: StaticData): FC | null {
  const e = sd.energia;
  if (!e) return null;
  return fc(e.filas.map(([lng, lat, cap, kind, name, detail]) => ({ type: "Feature", properties: { kind, name, cap, detail },
    geometry: { type: "Point", coordinates: [lng, lat] } })));
}

export function ports(sd: StaticData): FC | null {
  const p = sd.puertos;
  if (!p) return null;
  return fc(p.filas.map(([lng, lat, name, size, iso]) => ({ type: "Feature", properties: { name, size, iso },
    geometry: { type: "Point", coordinates: [lng, lat] } })));
}
