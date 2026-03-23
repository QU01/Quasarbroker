// ─── Pure GeoJSON builder functions ─────────────────────────────────────────
// Extracted from MaplibreViewer to reduce component size and enable unit testing.
// Each function takes data arrays + optional helpers and returns a GeoJSON FeatureCollection or null.

import type { Earthquake, GPSJammingZone, FireHotspot, InternetOutage, DataCenter, MilitaryBase, PowerPlant, PemexFacility, MexicoVolcano, MexicoEarthquake, MexicoWeatherAlert, MexicoStateNews, MexicoAirport, MexicoBorderCrossing, MexicoPort, MexicoPrison, MexicoDam, GDELTIncident, LiveUAmapIncident, CCTVCamera, KiwiSDR, FrontlineGeoJSON, UAV, Satellite, Ship, ActiveLayers } from "@/types/dashboard";
import { classifyAircraft } from "@/utils/aircraftClassification";
import { MISSION_COLORS, MISSION_ICON_MAP } from "@/components/map/icons/SatelliteIcons";

type FC = GeoJSON.FeatureCollection | null;
type InViewFilter = (lat: number, lng: number) => boolean;

// ─── Earthquakes ────────────────────────────────────────────────────────────

export function buildEarthquakesGeoJSON(earthquakes?: Earthquake[]): FC {
    if (!earthquakes?.length) return null;
    return {
        type: 'FeatureCollection',
        features: earthquakes.map((eq, i) => {
            if (eq.lat == null || eq.lng == null) return null;
            return {
                type: 'Feature' as const,
                properties: {
                    id: i,
                    type: 'earthquake',
                    name: `[M${eq.mag}]\n${eq.place || 'Unknown Location'}`,
                    title: eq.title,
                },
                geometry: { type: 'Point' as const, coordinates: [eq.lng, eq.lat] }
            };
        }).filter(Boolean) as GeoJSON.Feature[]
    };
}

// ─── GPS Jamming Zones ──────────────────────────────────────────────────────

export function buildJammingGeoJSON(zones?: GPSJammingZone[]): FC {
    if (!zones?.length) return null;
    return {
        type: 'FeatureCollection',
        features: zones.map((zone, i) => {
            const halfDeg = 0.5;
            return {
                type: 'Feature' as const,
                properties: {
                    id: i,
                    severity: zone.severity,
                    ratio: zone.ratio,
                    degraded: zone.degraded,
                    total: zone.total,
                    opacity: zone.severity === 'high' ? 0.45 : zone.severity === 'medium' ? 0.3 : 0.18
                },
                geometry: {
                    type: 'Polygon' as const,
                    coordinates: [[
                        [zone.lng - halfDeg, zone.lat - halfDeg],
                        [zone.lng + halfDeg, zone.lat - halfDeg],
                        [zone.lng + halfDeg, zone.lat + halfDeg],
                        [zone.lng - halfDeg, zone.lat + halfDeg],
                        [zone.lng - halfDeg, zone.lat - halfDeg]
                    ]]
                }
            };
        })
    };
}

// ─── CCTV Cameras ──────────────────────────────────────────────────────────

export function buildCctvGeoJSON(cameras?: CCTVCamera[], inView?: InViewFilter): FC {
    if (!cameras?.length) return null;
    return {
        type: 'FeatureCollection' as const,
        features: cameras.filter(c => c.lat != null && c.lon != null && (!inView || inView(c.lat, c.lon))).map((c, i) => ({
            type: 'Feature' as const,
            properties: {
                id: c.id || i,
                type: 'cctv',
                name: c.direction_facing || 'Camera',
                source_agency: c.source_agency || 'Unknown',
                media_url: c.media_url || '',
                media_type: c.media_type || 'image'
            },
            geometry: { type: 'Point' as const, coordinates: [c.lon, c.lat] }
        }))
    };
}

// ─── KiwiSDR Receivers ─────────────────────────────────────────────────────

export function buildKiwisdrGeoJSON(receivers?: KiwiSDR[], inView?: InViewFilter): FC {
    if (!receivers?.length) return null;
    return {
        type: 'FeatureCollection' as const,
        features: receivers.filter(k => k.lat != null && k.lon != null && (!inView || inView(k.lat, k.lon))).map((k, i) => ({
            type: 'Feature' as const,
            properties: {
                id: i,
                type: 'kiwisdr',
                name: k.name || 'Unknown SDR',
                url: k.url || '',
                users: k.users || 0,
                users_max: k.users_max || 0,
                bands: k.bands || '',
                antenna: k.antenna || '',
                location: k.location || '',
                lat: k.lat,
                lon: k.lon,
            },
            geometry: { type: 'Point' as const, coordinates: [k.lon, k.lat] }
        }))
    };
}

// ─── NASA FIRMS Fires ───────────────────────────────────────────────────────

export function buildFirmsGeoJSON(fires?: FireHotspot[]): FC {
    if (!fires?.length) return null;
    return {
        type: 'FeatureCollection',
        features: fires.map((f, i) => {
            const frp = f.frp || 0;
            const iconId = frp >= 100 ? 'fire-darkred' : frp >= 20 ? 'fire-red' : frp >= 5 ? 'fire-orange' : 'fire-yellow';
            return {
                type: 'Feature' as const,
                properties: {
                    id: i,
                    type: 'firms_fire',
                    name: `Fire ${frp.toFixed(1)} MW`,
                    frp,
                    iconId,
                    brightness: f.brightness || 0,
                    confidence: f.confidence || '',
                    daynight: f.daynight === 'D' ? 'Day' : 'Night',
                    acq_date: f.acq_date || '',
                    acq_time: f.acq_time || '',
                },
                geometry: { type: 'Point' as const, coordinates: [f.lng, f.lat] }
            };
        })
    };
}

// ─── Internet Outages ───────────────────────────────────────────────────────

export function buildInternetOutagesGeoJSON(outages?: InternetOutage[]): FC {
    if (!outages?.length) return null;
    return {
        type: 'FeatureCollection',
        features: outages.map((o) => {
            if (o.lat == null || o.lng == null) return null;
            const severity = o.severity || 0;
            const region = o.region_name || o.region_code || '?';
            const country = o.country_name || o.country_code || '';
            const label = `${region}, ${country}`;
            const detail = `${label}\n${severity}% drop · ${o.datasource || 'IODA'}`;
            return {
                type: 'Feature' as const,
                properties: {
                    id: o.region_code || region,
                    type: 'internet_outage',
                    name: label,
                    country,
                    region,
                    level: o.level,
                    severity,
                    datasource: o.datasource || '',
                    detail,
                },
                geometry: { type: 'Point' as const, coordinates: [o.lng, o.lat] }
            };
        }).filter(Boolean) as GeoJSON.Feature[]
    };
}

// ─── Data Centers ───────────────────────────────────────────────────────────

export function buildDataCentersGeoJSON(datacenters?: DataCenter[]): FC {
    if (!datacenters?.length) return null;
    return {
        type: 'FeatureCollection',
        features: datacenters.map((dc, i) => ({
            type: 'Feature' as const,
            properties: {
                id: `dc-${i}`,
                type: 'datacenter',
                name: dc.name || 'Unknown',
                company: dc.company || '',
                street: dc.street || '',
                city: dc.city || '',
                country: dc.country || '',
                zip: dc.zip || '',
            },
            geometry: { type: 'Point' as const, coordinates: [dc.lng, dc.lat] }
        }))
    };
}

// ─── Power Plants ──────────────────────────────────────────────────────────

export function buildPowerPlantsGeoJSON(plants?: PowerPlant[]): FC {
    if (!plants?.length) return null;
    return {
        type: 'FeatureCollection',
        features: plants.map((p, i) => ({
            type: 'Feature' as const,
            properties: {
                id: `pp-${i}`,
                type: 'power_plant',
                name: p.name || 'Unknown',
                country: p.country || '',
                fuel_type: p.fuel_type || 'Unknown',
                capacity_mw: p.capacity_mw ?? 0,
                owner: p.owner || '',
            },
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] }
        }))
    };
}

// ─── Military Bases ─────────────────────────────────────────────────────────

// Classify base alignment: red = adversary, blue = US/allied, green = ROC
const _ADVERSARY_COUNTRIES = new Set(["China", "Russia", "North Korea"]);
const _ROC_COUNTRIES = new Set(["Taiwan"]);

function _baseSide(country: string, operator: string): "red" | "blue" | "green" {
    if (_ADVERSARY_COUNTRIES.has(country)) return "red";
    if (_ROC_COUNTRIES.has(country)) return "green";
    return "blue";
}

export function buildMilitaryBasesGeoJSON(bases?: MilitaryBase[]): FC {
    if (!bases?.length) return null;
    return {
        type: 'FeatureCollection',
        features: bases.map((base, i) => ({
            type: 'Feature' as const,
            properties: {
                id: `milbase-${i}`,
                type: 'military_base',
                name: base.name || 'Unknown',
                country: base.country || '',
                operator: base.operator || '',
                branch: base.branch || '',
                side: _baseSide(base.country || '', base.operator || ''),
            },
            geometry: { type: 'Point' as const, coordinates: [base.lng, base.lat] }
        }))
    };
}

// ─── PEMEX Infrastructure ──────────────────────────────────────────────────

export function buildPemexGeoJSON(facilities?: PemexFacility[]): FC {
    if (!facilities?.length) return null;
    return {
        type: 'FeatureCollection',
        features: facilities.map((f, i) => ({
            type: 'Feature' as const,
            properties: {
                id: `pemex-${i}`,
                type: 'pemex',
                name: f.name || 'Unknown',
                facility_type: f.type || '',
                subtype: f.subtype || '',
                state: f.state || '',
                status: f.status || '',
                capacity: f.capacity || '',
                notes: f.notes || '',
            },
            geometry: { type: 'Point' as const, coordinates: [f.lng, f.lat] }
        }))
    };
}

// ─── Mexico Volcanoes ──────────────────────────────────────────────────────

export function buildVolcanoesGeoJSON(volcanoes?: MexicoVolcano[]): FC {
    if (!volcanoes?.length) return null;
    return {
        type: 'FeatureCollection',
        features: volcanoes.map((v, i) => {
            const colorMap: Record<string, string> = { red: '#ff0000', orange: '#ff6600', yellow: '#ffcc00', green: '#00cc44' };
            return {
                type: 'Feature' as const,
                properties: {
                    id: `volcano-${i}`,
                    type: 'volcano',
                    name: v.name || 'Unknown',
                    elevation_m: v.elevation_m || 0,
                    last_eruption: v.last_eruption || '',
                    alert_level: v.alert_level || 'green',
                    monitoring: v.monitoring || '',
                    color: colorMap[v.alert_level] || '#00cc44',
                },
                geometry: { type: 'Point' as const, coordinates: [v.lng, v.lat] }
            };
        })
    };
}

// ─── Mexico Earthquakes ────────────────────────────────────────────────────

export function buildMexicoEarthquakesGeoJSON(quakes?: MexicoEarthquake[]): FC {
    if (!quakes?.length) return null;
    return {
        type: 'FeatureCollection',
        features: quakes.map((eq, i) => {
            if (eq.lat == null || eq.lng == null) return null;
            return {
                type: 'Feature' as const,
                properties: {
                    id: eq.id || `mxeq-${i}`,
                    type: 'mexico_earthquake',
                    name: `[M${eq.mag}] ${eq.place || 'Mexico'}`,
                    mag: eq.mag,
                    depth: eq.depth || 0,
                    source: eq.source || '',
                },
                geometry: { type: 'Point' as const, coordinates: [eq.lng, eq.lat] }
            };
        }).filter(Boolean) as GeoJSON.Feature[]
    };
}

// ─── Mexico Weather Alerts ─────────────────────────────────────────────────

export function buildMexicoWeatherAlertsGeoJSON(alerts?: MexicoWeatherAlert[]): FC {
    if (!alerts?.length) return null;
    return {
        type: 'FeatureCollection',
        features: alerts.map((a, i) => {
            if (a.lat == null || a.lng == null) return null;
            const severityColor: Record<string, string> = {
                'Severe': '#ef4444', 'Extreme': '#dc2626',
                'Moderate': '#f59e0b', 'Minor': '#3b82f6', 'Unknown': '#6b7280',
            };
            return {
                type: 'Feature' as const,
                properties: {
                    id: `mxwx-${i}`,
                    type: 'mexico_weather_alert',
                    name: a.headline || a.event || 'Alert',
                    event: a.event || '',
                    severity: a.severity || 'Unknown',
                    area: a.area || '',
                    description: a.description || '',
                    color: severityColor[a.severity] || '#6b7280',
                },
                geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] }
            };
        }).filter(Boolean) as GeoJSON.Feature[]
    };
}

// ─── Mexico State News ────────────────────────────────────────────────────

export function buildMexicoNewsGeoJSON(stateNews?: MexicoStateNews[]): FC {
    if (!stateNews?.length) return null;
    const withArticles = stateNews.filter(s => s.articles?.length > 0);
    if (!withArticles.length) return null;
    return {
        type: 'FeatureCollection',
        features: withArticles.map(s => {
            // Color based on max risk score
            const riskColor = s.max_risk >= 7 ? '#ef4444' :  // red
                              s.max_risk >= 5 ? '#f97316' :  // orange
                              s.max_risk >= 3 ? '#eab308' :  // yellow
                              '#22c55e';                      // green
            // Top article headline
            const topTitle = s.articles[0]?.title || '';
            const topSource = s.articles[0]?.source || '';
            return {
                type: 'Feature' as const,
                properties: {
                    id: `mxnews-${s.state_code}`,
                    type: 'mexico_news',
                    state_code: s.state_code,
                    state_name: s.state_name,
                    article_count: s.article_count,
                    max_risk: s.max_risk,
                    top_title: topTitle.length > 60 ? topTitle.slice(0, 57) + '...' : topTitle,
                    top_source: topSource,
                    articles_json: JSON.stringify(s.articles.slice(0, 3)),
                    color: riskColor,
                },
                geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] }
            };
        })
    };
}

// ─── GDELT Mexico Filter ──────────────────────────────────────────────────

// Mexico bounding box: lat 14.5-32.7, lng -118.4 to -86.7
const MX_BBOX = { minLat: 14.5, maxLat: 32.7, minLng: -118.4, maxLng: -86.7 };

export function buildMexicoIncidentsGeoJSON(gdelt?: GDELTIncident[]): FC {
    if (!gdelt?.length) return null;
    const filtered = gdelt.filter(g => {
        if (!g.geometry?.coordinates) return false;
        const [lng, lat] = g.geometry.coordinates;
        return lat >= MX_BBOX.minLat && lat <= MX_BBOX.maxLat &&
               lng >= MX_BBOX.minLng && lng <= MX_BBOX.maxLng;
    });
    if (!filtered.length) return null;
    return {
        type: 'FeatureCollection',
        features: filtered.map((g) => ({
            type: 'Feature' as const,
            properties: {
                id: g.properties?.name || String(g.geometry.coordinates),
                type: 'mexico_incident',
                title: g.properties?.name || '',
                count: g.properties?.count || 0,
            },
            geometry: g.geometry
        }))
    };
}

// ─── Mexico Airports ──────────────────────────────────────────────────────

export function buildMexicoAirportsGeoJSON(airports?: MexicoAirport[]): FC {
    if (!airports?.length) return null;
    return {
        type: 'FeatureCollection',
        features: airports.map((a) => ({
            type: 'Feature' as const,
            properties: {
                id: `mxap-${a.iata || a.name}`,
                type: 'mexico_airport',
                name: `${a.name} (${a.iata})`,
                iata: a.iata,
                airport_type: a.type,
                city: a.city,
                color: a.type === 'international' ? '#38bdf8' : '#7dd3fc',
            },
            geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] }
        }))
    };
}

// ─── Mexico Border Crossings ──────────────────────────────────────────────

export function buildMexicoBorderCrossingsGeoJSON(crossings?: MexicoBorderCrossing[]): FC {
    if (!crossings?.length) return null;
    const trafficColor: Record<string, string> = {
        'high': '#ef4444', 'medium': '#f59e0b', 'low': '#22c55e',
    };
    return {
        type: 'FeatureCollection',
        features: crossings.map((c) => ({
            type: 'Feature' as const,
            properties: {
                id: `mxbr-${c.name}`,
                type: 'mexico_border_crossing',
                name: c.name,
                crossing_type: c.type,
                border: c.border,
                traffic: c.traffic,
                state: c.state,
                color: trafficColor[c.traffic] || '#6b7280',
            },
            geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] }
        }))
    };
}

// ─── Mexico Ports ─────────────────────────────────────────────────────────

export function buildMexicoPortsGeoJSON(ports?: MexicoPort[]): FC {
    if (!ports?.length) return null;
    const portColor: Record<string, string> = {
        'commercial': '#3b82f6', 'oil': '#f59e0b', 'cruise': '#a855f7',
        'naval': '#ef4444', 'ferry': '#06b6d4', 'fishing': '#22c55e',
    };
    return {
        type: 'FeatureCollection',
        features: ports.map((p) => ({
            type: 'Feature' as const,
            properties: {
                id: `mxpt-${p.name}`,
                type: 'mexico_port',
                name: p.name,
                port_type: p.type,
                coast: p.coast,
                state: p.state,
                capacity: p.capacity,
                color: portColor[p.type] || '#3b82f6',
            },
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] }
        }))
    };
}

// ─── Mexico Prisons ───────────────────────────────────────────────────────

export function buildMexicoPrisonsGeoJSON(prisons?: MexicoPrison[]): FC {
    if (!prisons?.length) return null;
    const prisonColor: Record<string, string> = {
        'federal_max': '#dc2626', 'federal_med': '#ef4444', 'federal_fem': '#f472b6',
        'state_max': '#ea580c', 'state': '#f97316', 'historical': '#6b7280',
    };
    return {
        type: 'FeatureCollection',
        features: prisons.map((p) => ({
            type: 'Feature' as const,
            properties: {
                id: `mxpr-${p.name}`,
                type: 'mexico_prison',
                name: p.name,
                prison_type: p.type,
                state: p.state,
                notes: p.notes,
                color: prisonColor[p.type] || '#f97316',
            },
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] }
        }))
    };
}

// ─── Mexico Dams ──────────────────────────────────────────────────────────

export function buildMexicoDamsGeoJSON(dams?: MexicoDam[]): FC {
    if (!dams?.length) return null;
    return {
        type: 'FeatureCollection',
        features: dams.map((d) => ({
            type: 'Feature' as const,
            properties: {
                id: `mxdm-${d.name}`,
                type: 'mexico_dam',
                name: d.name,
                dam_type: d.type,
                state: d.state,
                capacity_mw: d.capacity_mw,
                river: d.river,
                notes: d.notes || '',
                color: d.type === 'hydroelectric' ? '#06b6d4' : d.type === 'irrigation' ? '#22c55e' : '#3b82f6',
            },
            geometry: { type: 'Point' as const, coordinates: [d.lng, d.lat] }
        }))
    };
}

// ─── GDELT Incidents ────────────────────────────────────────────────────────

export function buildGdeltGeoJSON(gdelt?: GDELTIncident[], inView?: InViewFilter): FC {
    if (!gdelt?.length) return null;
    return {
        type: 'FeatureCollection',
        features: gdelt.map((g) => {
            if (!g.geometry || !g.geometry.coordinates) return null;
            const [gLng, gLat] = g.geometry.coordinates;
            if (inView && !inView(gLat, gLng)) return null;
            return {
                type: 'Feature' as const,
                properties: { id: g.properties?.name || String(g.geometry.coordinates), type: 'gdelt', title: g.properties?.name || '' },
                geometry: g.geometry
            };
        }).filter(Boolean) as GeoJSON.Feature[]
    };
}

// ─── LiveUAMap Incidents ────────────────────────────────────────────────────

export function buildLiveuaGeoJSON(incidents?: LiveUAmapIncident[], inView?: InViewFilter): FC {
    if (!incidents?.length) return null;
    return {
        type: 'FeatureCollection',
        features: incidents.map((incident) => {
            if (incident.lat == null || incident.lng == null) return null;
            if (inView && !inView(incident.lat, incident.lng)) return null;
            const isViolent = /bomb|missil|strike|attack|kill|destroy|fire|shoot|expl|raid/i.test(incident.title || "");
            return {
                type: 'Feature' as const,
                properties: {
                    id: incident.id,
                    type: 'liveuamap',
                    title: incident.title || '',
                    iconId: isViolent ? 'icon-liveua-red' : 'icon-liveua-yellow',
                },
                geometry: { type: 'Point' as const, coordinates: [incident.lng, incident.lat] }
            };
        }).filter(Boolean) as GeoJSON.Feature[]
    };
}

// ─── Ukraine Frontline ──────────────────────────────────────────────────────

export function buildFrontlineGeoJSON(frontlines?: FrontlineGeoJSON | null): FC {
    if (!frontlines?.features?.length) return null;
    return frontlines;
}

// ─── Parameterized Flight Layer ─────────────────────────────────────────────
// Deduplicates commercial / private / jets / military flight GeoJSON builders.

export interface FlightLayerConfig {
    colorMap: Record<string, string>;
    groundedMap: Record<string, string>;
    typeLabel: string;
    idPrefix: string;
    /** For military flights: special icon overrides by military_type */
    milSpecialMap?: Record<string, string>;
    /** If true, prefer true_track over heading for rotation (commercial flights) */
    useTrackHeading?: boolean;
}

export function buildFlightLayerGeoJSON(
    flights: any[] | undefined,
    config: FlightLayerConfig,
    helpers: {
        interpFlight: (f: any) => [number, number];
        inView: InViewFilter;
        trackedIcaoSet: Set<string>;
    }
): FC {
    if (!flights?.length) return null;
    const { colorMap, groundedMap, typeLabel, idPrefix, milSpecialMap, useTrackHeading } = config;
    const { interpFlight, inView, trackedIcaoSet } = helpers;
    return {
        type: 'FeatureCollection',
        features: flights.map((f: any, i: number) => {
            if (f.lat == null || f.lng == null) return null;
            if (!inView(f.lat, f.lng)) return null;
            if (f.icao24 && trackedIcaoSet.has(f.icao24.toLowerCase())) return null;
            const acType = classifyAircraft(f.model, f.aircraft_category);
            const grounded = f.alt != null && f.alt <= 100;

            let iconId: string;
            if (milSpecialMap) {
                const milType = f.military_type || 'default';
                iconId = milSpecialMap[milType] || '';
                if (!iconId) {
                    iconId = grounded ? groundedMap[acType] : colorMap[acType];
                } else if (grounded) {
                    iconId = groundedMap[acType];
                }
            } else {
                iconId = grounded ? groundedMap[acType] : colorMap[acType];
            }

            const rotation = useTrackHeading ? (f.true_track || f.heading || 0) : (f.heading || 0);
            const [iLng, iLat] = interpFlight(f);
            return {
                type: 'Feature' as const,
                properties: { id: f.icao24 || f.callsign || `${idPrefix}${i}`, type: typeLabel, callsign: f.callsign || f.icao24, rotation, iconId },
                geometry: { type: 'Point' as const, coordinates: [iLng, iLat] }
            };
        }).filter(Boolean) as GeoJSON.Feature[]
    };
}

// ─── UAVs / Drones ──────────────────────────────────────────────────────────

export function buildUavGeoJSON(uavs?: UAV[], inView?: InViewFilter): FC {
    if (!uavs?.length) return null;
    return {
        type: 'FeatureCollection',
        features: uavs.map((uav, i) => {
            if (uav.lat == null || uav.lng == null) return null;
            if (inView && !inView(uav.lat, uav.lng)) return null;
            return {
                type: 'Feature' as const,
                properties: {
                    id: (uav as any).id || `uav-${i}`,
                    type: 'uav',
                    callsign: uav.callsign,
                    rotation: uav.heading || 0,
                    iconId: 'svgDrone',
                    name: uav.aircraft_model || uav.callsign,
                    country: uav.country || '',
                    uav_type: uav.uav_type || '',
                    alt: uav.alt || 0,
                    wiki: uav.wiki || '',
                    speed_knots: uav.speed_knots || 0,
                    icao24: uav.icao24 || '',
                    registration: uav.registration || '',
                    squawk: uav.squawk || '',
                },
                geometry: { type: 'Point' as const, coordinates: [uav.lng, uav.lat] }
            };
        }).filter(Boolean) as GeoJSON.Feature[]
    };
}
// ─── Satellites ─────────────────────────────────────────────────────────────

export function buildSatellitesGeoJSON(
    satellites: Satellite[] | undefined,
    inView: InViewFilter,
    interpSat: (s: Satellite) => [number, number]
): FC {
    if (!satellites?.length) return null;
    return {
        type: 'FeatureCollection',
        features: satellites
            .filter((s) => s.lat != null && s.lng != null && inView(s.lat, s.lng))
            .map((s, i) => ({
                type: 'Feature' as const,
                properties: {
                    id: s.id || i, type: 'satellite', name: s.name, mission: s.mission || 'general',
                    sat_type: s.sat_type || 'Satellite', country: s.country || '', alt_km: s.alt_km || 0,
                    wiki: s.wiki || '', color: MISSION_COLORS[s.mission] || '#aaaaaa',
                    iconId: MISSION_ICON_MAP[s.mission] || 'sat-gen'
                },
                geometry: { type: 'Point' as const, coordinates: interpSat(s) }
            }))
    };
}

// ─── Ships (non-carrier) ────────────────────────────────────────────────────

export function buildShipsGeoJSON(
    ships: Ship[] | undefined,
    activeLayers: ActiveLayers,
    inView: InViewFilter,
    interpShip: (s: Ship) => [number, number]
): FC {
    if (!(activeLayers.ships_military || activeLayers.ships_cargo || activeLayers.ships_civilian || activeLayers.ships_passenger || activeLayers.ships_tracked_yachts) || !ships) return null;
    return {
        type: 'FeatureCollection',
        features: ships.map((s, i) => {
            if (s.lat == null || s.lng == null) return null;
            if (!inView(s.lat, s.lng)) return null;
            const isTrackedYacht = !!s.yacht_alert;
            const isMilitary = s.type === 'carrier' || s.type === 'military_vessel';
            const isCargo = s.type === 'tanker' || s.type === 'cargo';
            const isPassenger = s.type === 'passenger';

            if (s.type === 'carrier') return null; // Handled by buildCarriersGeoJSON

            if (isTrackedYacht) {
                if (activeLayers?.ships_tracked_yachts === false) return null;
            } else if (isMilitary && activeLayers?.ships_military === false) return null;
            else if (isCargo && activeLayers?.ships_cargo === false) return null;
            else if (isPassenger && activeLayers?.ships_passenger === false) return null;
            else if (!isMilitary && !isCargo && !isPassenger && activeLayers?.ships_civilian === false) return null;

            let iconId = 'svgShipBlue';
            if (isTrackedYacht) iconId = 'svgShipPink';
            else if (isCargo) iconId = 'svgShipRed';
            else if (s.type === 'yacht' || isPassenger) iconId = 'svgShipWhite';
            else if (isMilitary) iconId = 'svgShipYellow';

            const [iLng, iLat] = interpShip(s);
            return {
                type: 'Feature',
                properties: { id: s.mmsi || s.name || `ship-${i}`, type: 'ship', name: s.name, rotation: s.heading || 0, iconId },
                geometry: { type: 'Point', coordinates: [iLng, iLat] }
            };
        }).filter(Boolean) as GeoJSON.Feature[]
    };
}

// ─── Carriers ───────────────────────────────────────────────────────────────

export function buildCarriersGeoJSON(ships: Ship[] | undefined): FC {
    if (!ships?.length) return null;
    return {
        type: 'FeatureCollection',
        features: ships.map((s, i) => {
            if (s.type !== 'carrier' || s.lat == null || s.lng == null) return null;
            return {
                type: 'Feature',
                properties: { id: s.mmsi || s.name || `carrier-${i}`, type: 'ship', name: s.name, rotation: s.heading || 0, iconId: 'svgCarrier' },
                geometry: { type: 'Point', coordinates: [s.lng, s.lat] }
            };
        }).filter(Boolean) as GeoJSON.Feature[]
    };
}
