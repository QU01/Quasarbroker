import { describe, expect, it } from "vitest";
import { choropleth, greatCircle, splitDateline, trade } from "@/components/worldsystem/wsGeo";
import { INDICATORS, colorFor } from "@/lib/worldsystem";
import type { WorldSystemMeta } from "@/lib/worldsystem";
import type { CountriesFC, StaticData } from "@/hooks/useWorldSystem";

const meta: WorldSystemMeta = {
  years: [2018, 2019], iso3: ["MEX", "USA"], names: ["Mexico", "United States"], isonum: [484, 840],
  channels: [], channel_names: {}, last_data_year: 2019, scenarios: { datos: ["ly"] }, recommendation_modes: ["bienestar"],
};
const square = (x: number) => ({ type: "Polygon" as const, coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
const countries: CountriesFC = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", id: 484, properties: { name: "Mexico" }, geometry: square(0) },
    { type: "Feature", id: 840, properties: { name: "United States" }, geometry: square(2) },
    { type: "Feature", id: 10, properties: { name: "Antarctica" }, geometry: square(4) },
  ],
};

describe("greatCircle", () => {
  it("starts and ends at the endpoints", () => {
    const pts = greatCircle([-99.1, 19.4], [-74, 40.7], 16);
    expect(pts).toHaveLength(17);
    expect(pts[0][0]).toBeCloseTo(-99.1, 5);
    expect(pts[16][1]).toBeCloseTo(40.7, 5);
  });
  it("keeps longitudes continuous across the antimeridian", () => {
    const pts = greatCircle([170, 0], [-170, 0], 8);
    for (let k = 1; k < pts.length; k++) expect(Math.abs(pts[k][0] - pts[k - 1][0])).toBeLessThan(180);
  });
});

describe("splitDateline", () => {
  it("splits a line that jumps across ±180", () => {
    expect(splitDateline([[170, 0], [179, 0], [-179, 0], [-170, 0]])).toHaveLength(2);
  });
});

describe("choropleth", () => {
  it("colors countries by the selected year, drops Antarctica and marks the selection", () => {
    const ly = INDICATORS.find((i) => i.id === "ly")!;
    const out = choropleth(countries, meta, [[9.5, 9.6], [null, 11.0]], ly, 2019, "USA")!;
    expect(out.features).toHaveLength(2);
    const [mex, usa] = out.features.map((f) => f.properties);
    expect(mex.value).toBe(9.6);
    expect(mex.color).toBe(colorFor(ly, 9.6));
    expect(usa.sel).toBe(1);
  });
  it("returns null until the data is loaded", () => {
    expect(choropleth(countries, meta, undefined, INDICATORS[0], 2019, null)).toBeNull();
  });
});

describe("trade", () => {
  it("draws one arc per flow between known positions", () => {
    const sd: StaticData = { comercio: { posiciones: [[-99, 19], [-77, 39], null], year: 2010, conflictos: [], comercio_anio: 2010,
      comercio: [[0, 1, 300], [1, 2, 50]] } };
    const out = trade(sd, meta)!;
    expect(out.features).toHaveLength(1);
    expect(out.features[0].properties.w).toBeCloseTo(1);
  });
});

describe("colorFor", () => {
  it("returns null for missing values and clamps outside the domain", () => {
    const ind = INDICATORS.find((i) => i.id === "debt")!;
    expect(colorFor(ind, null)).toBeNull();
    expect(colorFor(ind, 99)).toBe(colorFor(ind, 1.5));
  });
});
