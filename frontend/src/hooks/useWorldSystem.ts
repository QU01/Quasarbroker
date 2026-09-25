"use client";
import { useEffect, useState } from "react";
import {
  STATIC_LAYERS, wsFetch,
  type CountryRecommendation, type Matrix, type StaticLayerId, type WorldSystemMeta, type WorldSystemState,
} from "@/lib/worldsystem";

export interface CountryFeature {
  type: "Feature";
  id: number;
  properties: { name: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
}
export interface CountriesFC { type: "FeatureCollection"; features: CountryFeature[] }

export interface Recommendations {
  mode: string;
  global: Record<string, number> | null;
  paises: Record<string, CountryRecommendation>;
}

// Shapes of the static layers (compact rows, see backend/services/worldsystem.py)
export interface GedYear { year: number; muertes: number | null; filas: [number, number, number, number, number][] }
export interface ModelYear {
  posiciones: ([number, number] | null)[];
  year: number;
  conflictos: number[];
  comercio_anio: number;
  comercio: [number, number, number][];
}
export interface StaticData {
  conflictos?: { ged: GedYear | null; modelo: ModelYear };
  comercio?: ModelYear;
  maritimo?: { filas: [string, [number, number][]][] };
  vuelos?: { filas: [number, number, number, number, number, string, string, number][] };
  ductos?: { filas: [string, string, [number, number][]][] };
  energia?: { filas: [number, number, number, string, string, string][] };
  cables?: { filas: [string, string, [number, number][]][]; n_cables: number };
  puertos?: { filas: [number, number, string, string, string, number][] };
}

/** Loads what the world-system layers need for the current state; everything is cached per request. */
export function useWorldSystem(ws: WorldSystemState, enabled: boolean) {
  const anyOn = enabled && (ws.model || Object.values(ws.osint).some(Boolean) || ws.selected != null);
  const [meta, setMeta] = useState<WorldSystemMeta | null>(null);
  const [countries, setCountries] = useState<CountriesFC | null>(null);
  const [values, setValues] = useState<Matrix | undefined>(undefined);
  const [recs, setRecs] = useState<Recommendations | null>(null);
  const [staticData, setStaticData] = useState<StaticData>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!anyOn || meta) return;
    Promise.all([wsFetch<WorldSystemMeta>("/meta"), wsFetch<CountriesFC>("/countries")])
      .then(([m, c]) => { setMeta(m); setCountries(c); })
      .catch((e) => setError(`Datos del sistema-mundo no disponibles (${e.message})`));
  }, [anyOn, meta]);

  useEffect(() => {
    if (!enabled || !ws.model || !meta) return;
    const vars = meta.scenarios[ws.scenario] ?? [];
    if (!vars.includes(ws.variable)) { setValues(undefined); return; }
    let live = true;
    wsFetch<{ values: Matrix }>(`/layer?scenario=${ws.scenario}&var=${ws.variable}`)
      .then((r) => { if (live) setValues(r.values); })
      .catch((e) => setError(e.message));
    return () => { live = false; };
  }, [enabled, ws.model, ws.scenario, ws.variable, meta]);

  useEffect(() => {
    if (!enabled || !meta || !meta.recommendation_modes.includes(ws.recMode)) return;
    wsFetch<Recommendations>(`/recommendations?mode=${ws.recMode}`).then(setRecs).catch(() => setRecs(null));
  }, [enabled, meta, ws.recMode]);

  // static OSINT layers (year-dependent ones reload when the year changes)
  const onKey = STATIC_LAYERS.filter((l) => ws.osint[l.id]).map((l) => l.id).join(",");
  const yearKey = ws.osint.conflictos || ws.osint.comercio ? ws.year : 0;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const ids = onKey ? (onKey.split(",") as StaticLayerId[]) : [];
    Promise.all(ids.map(async (id): Promise<[StaticLayerId, unknown]> => {
      if (id === "conflictos") {
        const [ged, modelo] = await Promise.all([
          ws.year >= 1989 && ws.year <= 2023 ? wsFetch<GedYear>(`/osint/conflictos_ged?year=${ws.year}`) : Promise.resolve(null),
          wsFetch<ModelYear>(`/osint/modelo?year=${Math.min(ws.year, 2019)}`),
        ]);
        return [id, { ged, modelo }];
      }
      if (id === "comercio") return [id, await wsFetch<ModelYear>(`/osint/modelo?year=${Math.min(ws.year, 2019)}`)];
      const def = STATIC_LAYERS.find((l) => l.id === id)!;
      return [id, await wsFetch(`/osint/${def.api}`)];
    }))
      .then((pairs) => { if (live) setStaticData(Object.fromEntries(pairs) as StaticData); })
      .catch((e) => setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, onKey, yearKey]);

  return { meta, countries, values, recs, staticData, error };
}
