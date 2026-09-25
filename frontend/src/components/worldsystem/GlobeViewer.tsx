"use client";
// 3D globe view (globe.gl): world-system choropleth, static OSINT layers and QuasarBroker's live
// feeds (flights, ships, earthquakes) on one interactive Earth.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobeInstance } from "globe.gl";
import { INDICATORS, colorFor, type Matrix, type WorldSystemMeta, type WorldSystemState } from "@/lib/worldsystem";
import type { CountriesFC, CountryFeature, StaticData } from "@/hooks/useWorldSystem";
import type { ActiveLayers, DashboardData } from "@/types/dashboard";

interface Props {
  data: DashboardData;
  activeLayers: ActiveLayers;
  ws: WorldSystemState;
  meta: WorldSystemMeta | null;
  countries: CountriesFC | null;
  values: Matrix | undefined;
  staticData: StaticData;
  onSelectCountry: (iso3: string | null) => void;
  flyTo?: { lat: number; lng: number; ts?: number } | null;
}

type P = { lat: number; lng: number; alt: number; r: number; color: string; label: string };
type Arc = { s: [number, number]; e: [number, number]; color: [string, string]; w: number; alt: number | null; time: number; label: string };
type Path = { pts: [number, number, number][]; color: string; dash: number; time: number; label: string };
type Ring = { lat: number; lng: number; c: string; r: number; speed: number };

const withAlpha = (rgb: string, a: number) => rgb.replace(/^rgb\(/, "rgba(").replace(/\)$/, `,${a})`);
const at = (pts: [number, number][], a: number) => pts.map((p) => [p[0], p[1], a] as [number, number, number]);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const tip = (html: string) => `<div style="font:12px/1.4 ui-monospace,monospace;background:rgba(8,14,20,.92);color:#e6edf3;border:1px solid rgba(0,255,255,.25);padding:6px 8px;border-radius:6px">${html}</div>`;

export default function GlobeViewer({ data, activeLayers, ws, meta, countries, values, staticData, onSelectCountry, flyTo }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);
  const ind = INDICATORS.find((i) => i.id === ws.variable) ?? INDICATORS[0];
  const selectRef = useRef(onSelectCountry);
  selectRef.current = onSelectCountry;
  const lookup = useRef<{ byNum: Map<number, number>; iso3: string[] }>({ byNum: new Map(), iso3: [] });

  // create the globe once
  useEffect(() => {
    let disposed = false;
    import("globe.gl").then(({ default: Globe }) => {
      if (disposed || !host.current) return;
      const g = new Globe(host.current, { animateIn: false, rendererConfig: { antialias: true, alpha: true } })
        .backgroundColor("rgba(0,0,0,0)")
        .globeImageUrl("/earth-night.jpg")
        .showAtmosphere(true).atmosphereColor("#39c6ff").atmosphereAltitude(0.16)
        .polygonsTransitionDuration(0)
        .polygonSideColor(() => "rgba(6,12,18,0.35)")
        .onPolygonClick((f: object) => {
          const i = lookup.current.byNum.get((f as CountryFeature).id);
          if (i != null) selectRef.current(lookup.current.iso3[i]);
        });
      g.pointOfView({ lat: 20, lng: 0, altitude: 2.4 }, 0);
      const ctl = g.controls() as { autoRotate: boolean; autoRotateSpeed: number };
      ctl.autoRotate = true; ctl.autoRotateSpeed = 0.3;
      globe.current = g;
      const fit = () => { if (host.current) g.width(host.current.clientWidth).height(host.current.clientHeight); };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(host.current);
      setReady(true);
      return () => ro.disconnect();
    }).catch((e) => setFailed(String(e)));
    return () => {
      disposed = true;
      globe.current?._destructor();
      globe.current = null;
    };
  }, []);

  useEffect(() => {
    if (!globe.current) return;
    (globe.current.controls() as { autoRotate: boolean }).autoRotate = spin;
  }, [spin, ready]);

  useEffect(() => {
    if (globe.current && flyTo) globe.current.pointOfView({ lat: flyTo.lat, lng: flyTo.lng, altitude: 1.4 }, 1200);
  }, [flyTo, ready]);

  // choropleth
  useEffect(() => {
    const g = globe.current;
    if (!g || !ready) return;
    if (!ws.model || !countries || !meta || !values) { g.polygonsData([]); return; }
    const t = meta.years.indexOf(ws.year);
    const byNum = new Map(meta.isonum.map((n, i) => [n, i]));
    lookup.current = { byNum, iso3: meta.iso3 };
    const sel = ws.selected;
    g.polygonsData(countries.features.filter((f) => f.properties.name !== "Antarctica"))
      .polygonCapColor((f: object) => {
        const i = byNum.get((f as CountryFeature).id);
        const c = i == null ? null : colorFor(ind, values[i]?.[t]);
        return c ? withAlpha(c, 0.78) : "rgba(120,130,140,0.18)";
      })
      .polygonStrokeColor((f: object) => (meta.iso3[byNum.get((f as CountryFeature).id) ?? -1] === sel ? "#ffffff" : "rgba(8,14,20,0.6)"))
      .polygonAltitude((f: object) => (meta.iso3[byNum.get((f as CountryFeature).id) ?? -1] === sel ? 0.02 : 0.006))
      .polygonLabel((f: object) => {
        const i = byNum.get((f as CountryFeature).id);
        if (i == null) return tip(esc((f as CountryFeature).properties.name));
        const v = values[i]?.[t];
        return tip(`<b>${esc(meta.names[i])}</b><br>${esc(ind.name)}: ${v == null ? "sin datos" : esc(ind.fmt(v))}<br><span style="opacity:.6">${ws.year}</span>`);
      });
  }, [ready, ws.model, ws.year, ws.selected, countries, meta, values, ind]);

  // static OSINT layers
  const staticLayers = useMemo(() => {
    const arcs: Arc[] = [], paths: Path[] = [], rings: Ring[] = [], points: P[] = [];
    let hexes: [number, number, number, number, number][] = [];
    let ports: [number, number, string, string, string, number][] = [];
    const sd = staticData;
    if (ws.osint.conflictos && sd.conflictos) {
      if (sd.conflictos.ged?.filas.length) hexes = sd.conflictos.ged.filas;
      else if (ws.year <= 2019) sd.conflictos.modelo.conflictos.forEach((i) => {
        const p = sd.conflictos!.modelo.posiciones[i];
        if (p) rings.push({ lng: p[0], lat: p[1], c: "255,90,71", r: 4.5, speed: 1.4 });
      });
    }
    if (ws.osint.comercio && sd.comercio) {
      const m = sd.comercio, mx = Math.max(1, ...m.comercio.map((r) => r[2]));
      m.comercio.forEach(([i, j, v]) => {
        const a = m.posiciones[i], b = m.posiciones[j];
        if (a && b) arcs.push({ s: a, e: b, color: ["rgba(242,193,78,0.9)", "rgba(242,193,78,0.15)"], w: 0.2 + 1.6 * Math.sqrt(v / mx),
          alt: 0.18 + 0.25 * Math.sqrt(v / mx), time: 4200, label: `${meta?.names[i] ?? ""} → ${meta?.names[j] ?? ""} · ${Math.round(v)} mil M USD (${m.comercio_anio})` });
      });
    }
    if (ws.osint.vuelos && sd.vuelos) {
      const mx = sd.vuelos.filas[0]?.[4] ?? 1;
      sd.vuelos.filas.forEach((r) => arcs.push({ s: [r[0], r[1]], e: [r[2], r[3]], color: ["rgba(124,198,255,0.08)", "rgba(124,198,255,0.75)"],
        w: 0.12 + 0.6 * r[4] / mx, alt: null, time: 2600, label: `${r[5]} – ${r[6]} · ${r[4]} aerolíneas` }));
    }
    if (ws.osint.maritimo && sd.maritimo) sd.maritimo.filas.forEach(([tier, pts]) => paths.push({ pts: at(pts, 0.004),
      color: tier === "principal" ? "rgba(63,224,197,0.95)" : tier === "media" ? "rgba(63,224,197,0.6)" : "rgba(63,224,197,0.35)", dash: 0.08, time: 30000, label: `Ruta marítima ${tier}` }));
    if (ws.osint.cables && sd.cables) sd.cables.filas.forEach(([name, color, pts]) => paths.push({ pts: at(pts, 0.002), color, dash: 1, time: 0, label: name }));
    if (ws.osint.ductos && sd.ductos) sd.ductos.filas.forEach(([fluid, name, pts]) => paths.push({ pts: at(pts, 0.003),
      color: fluid === "gas" ? "rgba(255,180,90,0.8)" : "rgba(231,111,81,0.85)", dash: 1, time: 0, label: name }));
    if (ws.osint.energia && sd.energia) sd.energia.filas.forEach(([lng, lat, cap, kind, name]) => points.push({ lng, lat,
      alt: kind === "yacimiento" ? Math.min(0.08, 0.004 + Math.min(cap, 3e6) / 4e7) : kind === "gnl" ? Math.min(0.08, 0.01 + Math.min(cap, 60) / 900) : 0.02,
      r: kind === "yacimiento" ? 0.18 : 0.3, color: kind === "gnl" ? "#ff7ab8" : kind === "yacimiento" ? "#f15bb5" : "#c77dff", label: name }));
    if (ws.osint.puertos && sd.puertos) ports = sd.puertos.filas;
    return { arcs, paths, rings, points, hexes, ports };
  }, [staticData, ws.osint, ws.year, meta]);

  // live feeds from QuasarBroker (sampled to keep the globe responsive)
  const live = useMemo(() => {
    const points: P[] = [], rings: Ring[] = [];
    const add = (arr: { lat: number; lng: number; alt?: number; callsign?: string }[] | undefined, color: string, cap: number) => {
      if (!arr) return;
      const step = Math.max(1, Math.ceil(arr.length / cap));
      for (let k = 0; k < arr.length; k += step) {
        const f = arr[k];
        if (f.lat == null || f.lng == null) continue;
        points.push({ lat: f.lat, lng: f.lng, alt: Math.min(0.05, 0.004 + (f.alt ?? 0) / 1.2e6), r: 0.09, color, label: f.callsign || "" });
      }
    };
    if (activeLayers.flights) add(data.commercial_flights, "#7cc6ff", 5000);
    if (activeLayers.private) add(data.private_flights, "#b0b8c1", 1500);
    if (activeLayers.jets) add(data.private_jets, "#d0a7ff", 1000);
    if (activeLayers.military) add(data.military_flights, "#ff5d5d", 1500);
    const shipOn = activeLayers.ships_cargo || activeLayers.ships_military || activeLayers.ships_passenger || activeLayers.ships_civilian;
    if (shipOn && data.ships) {
      const step = Math.max(1, Math.ceil(data.ships.length / 5000));
      for (let k = 0; k < data.ships.length; k += step) {
        const s = data.ships[k];
        points.push({ lat: s.lat, lng: s.lng, alt: 0.002, r: 0.08, color: s.type === "military_vessel" || s.type === "carrier" ? "#ff8c42" : "#80ffdb", label: s.name || String(s.mmsi) });
      }
    }
    if (activeLayers.earthquakes && data.earthquakes) data.earthquakes.forEach((q) =>
      rings.push({ lat: q.lat, lng: q.lng, c: "255,214,10", r: Math.max(1, q.mag * 0.9), speed: 2 }));
    return { points, rings };
  }, [data.commercial_flights, data.private_flights, data.private_jets, data.military_flights, data.ships, data.earthquakes, activeLayers]);

  useEffect(() => {
    const g = globe.current;
    if (!g || !ready) return;
    const { arcs, paths, hexes, ports } = staticLayers;
    g.arcsData(arcs).arcStartLat((a: object) => (a as Arc).s[1]).arcStartLng((a: object) => (a as Arc).s[0])
      .arcEndLat((a: object) => (a as Arc).e[1]).arcEndLng((a: object) => (a as Arc).e[0])
      .arcColor((a: object) => (a as Arc).color).arcStroke((a: object) => (a as Arc).w)
      .arcAltitude((a: object) => (a as Arc).alt as number).arcAltitudeAutoScale(0.32)
      .arcDashLength(0.3).arcDashGap(0.15).arcDashAnimateTime((a: object) => (a as Arc).time)
      .arcLabel((a: object) => tip(esc((a as Arc).label)));
    g.pathsData(paths).pathPoints((p: object) => (p as Path).pts).pathPointLat((q: number[]) => q[1]).pathPointLng((q: number[]) => q[0])
      .pathPointAlt((q: number[]) => q[2]).pathColor((p: object) => (p as Path).color)
      .pathDashLength((p: object) => (p as Path).dash).pathDashGap((p: object) => ((p as Path).dash >= 1 ? 0 : 0.02))
      .pathDashAnimateTime((p: object) => (p as Path).time).pathTransitionDuration(0)
      .pathLabel((p: object) => tip(esc((p as Path).label)));
    g.hexBinPointsData(hexes).hexBinPointLng((r: object) => (r as number[])[0]).hexBinPointLat((r: object) => (r as number[])[1])
      .hexBinPointWeight((r: object) => (r as number[])[3] + 1).hexBinResolution(3).hexMargin(0.15).hexTransitionDuration(0)
      .hexAltitude((d: { sumWeight: number }) => Math.min(0.3, 0.004 + Math.log1p(d.sumWeight) / 45))
      .hexTopColor((d: { sumWeight: number }) => `rgba(255,${Math.round(Math.max(40, 150 - 18 * Math.log1p(d.sumWeight)))},70,0.92)`)
      .hexSideColor(() => "rgba(160,30,20,0.75)")
      .hexLabel((d: { points: object[] }) => {
        const deaths = d.points.reduce((s, p) => s + (p as number[])[3], 0), ev = d.points.reduce((s, p) => s + (p as number[])[2], 0);
        return tip(`<b>${deaths.toLocaleString("en-US")} muertes</b><br>${ev.toLocaleString("en-US")} eventos · UCDP GED ${ws.year}`);
      });
    g.labelsData(ports).labelLng((r: object) => (r as number[])[0]).labelLat((r: object) => (r as number[])[1])
      .labelText((r: object) => ((r as string[])[3] === "L" ? (r as string[])[2] : "")).labelSize((r: object) => ((r as string[])[3] === "L" ? 0.28 : 0))
      .labelDotRadius((r: object) => ((r as string[])[3] === "L" ? 0.22 : 0.12)).labelColor(() => "rgba(233,237,241,0.85)")
      .labelResolution(2).labelAltitude(0.004).labelsTransitionDuration(0);
  }, [ready, staticLayers, ws.year]);

  useEffect(() => {
    const g = globe.current;
    if (!g || !ready) return;
    const points = staticLayers.points.concat(live.points);
    g.pointsData(points).pointLat((p: object) => (p as P).lat).pointLng((p: object) => (p as P).lng)
      .pointAltitude((p: object) => (p as P).alt).pointRadius((p: object) => (p as P).r).pointColor((p: object) => (p as P).color)
      .pointsMerge(true).pointsTransitionDuration(0);
    g.ringsData(staticLayers.rings.concat(live.rings)).ringLat((r: object) => (r as Ring).lat).ringLng((r: object) => (r as Ring).lng)
      .ringAltitude(0.01).ringMaxRadius((r: object) => (r as Ring).r).ringPropagationSpeed((r: object) => (r as Ring).speed).ringRepeatPeriod(1300)
      .ringColor((r: object) => (tt: number) => `rgba(${(r as Ring).c},${Math.max(0, 1 - tt)})`);
  }, [ready, staticLayers, live]);

  return (
    <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_50%_45%,#123049_0%,#05090d_65%)]">
      <div ref={host} className="absolute inset-0" />
      {failed && <div className="absolute inset-0 grid place-items-center text-xs font-mono text-red-300">No se pudo iniciar el globo 3D: {failed}</div>}
      <button onClick={() => setSpin((s) => !s)}
        className="absolute bottom-20 right-6 z-[210] text-[9px] font-mono tracking-[0.15em] px-3 py-1.5 rounded-lg border border-cyan-800/60 bg-[var(--bg-primary)]/70 text-cyan-300 hover:text-cyan-100">
        {spin ? "DETENER ROTACIÓN" : "ROTAR"}
      </button>
    </div>
  );
}
