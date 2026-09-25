"use client";
// World-system choropleth and static OSINT layers, rendered as children of the MapLibre <Map>.
import { useEffect, useMemo } from "react";
import { Source, Layer, useMap } from "react-map-gl/maplibre";
import { INDICATORS, type Matrix, type WorldSystemMeta, type WorldSystemState } from "@/lib/worldsystem";
import type { CountriesFC, StaticData } from "@/hooks/useWorldSystem";
import * as G from "./wsGeo";

interface Props {
  ws: WorldSystemState;
  meta: WorldSystemMeta | null;
  countries: CountriesFC | null;
  values: Matrix | undefined;
  staticData: StaticData;
  onSelectCountry: (iso3: string | null) => void;
}

const EMPTY: G.FC = { type: "FeatureCollection", features: [] };

export default function WorldSystemMapLayers({ ws, meta, countries, values, staticData, onSelectCountry }: Props) {
  const { current: map } = useMap();
  const ind = INDICATORS.find((i) => i.id === ws.variable) ?? INDICATORS[0];

  const choro = useMemo(() => (ws.model ? G.choropleth(countries, meta, values, ind, ws.year, ws.selected) : null),
    [ws.model, countries, meta, values, ind, ws.year, ws.selected]);
  const conf = useMemo(() => (ws.osint.conflictos ? G.conflicts(staticData, meta, ws.year) : null), [ws.osint.conflictos, staticData, meta, ws.year]);
  const trade = useMemo(() => (ws.osint.comercio ? G.trade(staticData, meta) : null), [ws.osint.comercio, staticData, meta]);
  const air = useMemo(() => (ws.osint.vuelos ? G.airRoutes(staticData) : null), [ws.osint.vuelos, staticData]);
  const lanes = useMemo(() => (ws.osint.maritimo ? G.shipping(staticData) : null), [ws.osint.maritimo, staticData]);
  const pipes = useMemo(() => (ws.osint.ductos ? G.pipelines(staticData) : null), [ws.osint.ductos, staticData]);
  const cabs = useMemo(() => (ws.osint.cables ? G.cables(staticData) : null), [ws.osint.cables, staticData]);
  const ener = useMemo(() => (ws.osint.energia ? G.energy(staticData) : null), [ws.osint.energia, staticData]);
  const prts = useMemo(() => (ws.osint.puertos ? G.ports(staticData) : null), [ws.osint.puertos, staticData]);

  // click a country on the choropleth to select it in the world-system panel
  useEffect(() => {
    if (!map || !choro) return;
    const m = map.getMap();
    const onClick = (e: { features?: { properties?: Record<string, unknown> }[] }) => {
      const iso = e.features?.[0]?.properties?.iso3;
      if (typeof iso === "string") onSelectCountry(iso);
    };
    const enter = () => { m.getCanvas().style.cursor = "pointer"; };
    const leave = () => { m.getCanvas().style.cursor = ""; };
    m.on("click", "ws-choropleth-fill", onClick);
    m.on("mouseenter", "ws-choropleth-fill", enter);
    m.on("mouseleave", "ws-choropleth-fill", leave);
    return () => {
      m.off("click", "ws-choropleth-fill", onClick);
      m.off("mouseenter", "ws-choropleth-fill", enter);
      m.off("mouseleave", "ws-choropleth-fill", leave);
    };
  }, [map, choro, onSelectCountry]);

  return (
    <>
      {choro && (
        <Source id="ws-choropleth" type="geojson" data={choro as never}>
          <Layer id="ws-choropleth-fill" type="fill" paint={{ "fill-color": ["get", "color"], "fill-opacity": 0.62 }} />
          <Layer id="ws-choropleth-line" type="line"
            paint={{ "line-color": ["case", ["==", ["get", "sel"], 1], "#ffffff", "rgba(10,16,22,0.6)"], "line-width": ["case", ["==", ["get", "sel"], 1], 2, 0.4] }} />
        </Source>
      )}
      <Source id="ws-cables" type="geojson" data={(cabs ?? EMPTY) as never}>
        <Layer id="ws-cables-line" type="line" paint={{ "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0.75 }} />
      </Source>
      <Source id="ws-pipelines" type="geojson" data={(pipes ?? EMPTY) as never}>
        <Layer id="ws-pipelines-line" type="line"
          paint={{ "line-color": ["match", ["get", "fluid"], "gas", "#ffb45a", "#e76f51"], "line-width": 1.1, "line-opacity": 0.8 }} />
      </Source>
      <Source id="ws-lanes" type="geojson" data={(lanes ?? EMPTY) as never}>
        <Layer id="ws-lanes-line" type="line"
          paint={{ "line-color": "#3fe0c5", "line-opacity": ["match", ["get", "tier"], "principal", 0.9, "media", 0.55, 0.3],
            "line-width": ["match", ["get", "tier"], "principal", 1.6, 1], "line-dasharray": [2, 1] }} />
      </Source>
      <Source id="ws-air" type="geojson" data={(air ?? EMPTY) as never}>
        <Layer id="ws-air-line" type="line" paint={{ "line-color": "#7cc6ff", "line-opacity": 0.35, "line-width": ["+", 0.3, ["*", 1.5, ["get", "w"]]] }} />
      </Source>
      <Source id="ws-trade" type="geojson" data={(trade ?? EMPTY) as never}>
        <Layer id="ws-trade-line" type="line" paint={{ "line-color": "#f2c14e", "line-opacity": 0.6, "line-width": ["+", 0.4, ["*", 3, ["get", "w"]]] }} />
      </Source>
      <Source id="ws-energy" type="geojson" data={(ener ?? EMPTY) as never}>
        <Layer id="ws-energy-circle" type="circle"
          paint={{ "circle-radius": ["match", ["get", "kind"], "yacimiento", 3, 4.5],
            "circle-color": ["match", ["get", "kind"], "gnl", "#ff7ab8", "yacimiento", "#f15bb5", "#c77dff"],
            "circle-stroke-color": "#0b1117", "circle-stroke-width": 0.6, "circle-opacity": 0.9 }} />
      </Source>
      <Source id="ws-ports" type="geojson" data={(prts ?? EMPTY) as never}>
        <Layer id="ws-ports-circle" type="circle"
          paint={{ "circle-radius": ["match", ["get", "size"], "L", 3.5, 2], "circle-color": "#e9edf1", "circle-opacity": 0.8 }} />
      </Source>
      <Source id="ws-conflicts" type="geojson" data={(conf ?? EMPTY) as never}>
        <Layer id="ws-conflicts-circle" type="circle"
          paint={{ "circle-radius": ["interpolate", ["linear"], ["ln", ["+", 1, ["get", "deaths"]]], 0, 2, 4, 5, 8, 12],
            "circle-color": ["match", ["get", "kind"], "riesgo", "#ffaa3c", "#ff5a47"], "circle-opacity": 0.55,
            "circle-stroke-color": "#ff5a47", "circle-stroke-width": 0.8 }} />
      </Source>
    </>
  );
}
