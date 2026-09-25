# 🛰️ Q U A S A R B R O K E R

**Advanced Geopolitical OSINT Intelligence Dashboard with AI-Powered Agents**

![License](https://img.shields.io/badge/license-MIT-blue) ![Python](https://img.shields.io/badge/python-3.10+-blue) ![TypeScript](https://img.shields.io/badge/typescript-5.0+-blue)

## Overview

**QuasarBroker** is an enhanced fork of ShadowBroker that adds comprehensive OSINT capabilities, advanced AI agent tools powered by LangChain deepagents, and real-time geopolitical intelligence aggregation.

### Key Enhancements

- **🇲🇽 Mexico OSINT**: Military bases (SEDENA/SEMAR), PEMEX infrastructure, volcanoes (CENAPRED), weather alerts (CONAGUA)
- **🤖 AI Agent Framework**: Conversational OSINT using LangChain deepagents with OpenRouter/Anthropic/OpenAI
- **📰 Mexico News Intelligence**: State-by-state news from 40+ sources with risk scoring
- **🔍 Advanced Tools**: Sherlock (150+ sites), email enumeration, WHOIS, GitHub analysis, HIBP breach check
- **🗺️ Interactive Map**: 30+ GeoJSON layers, clickable news popups, real-time updates

## Quick Start

### Docker (Recommended)

```bash
git clone https://github.com/QU01/Quasarbroker.git
cd quasarbroker

cp backend/.env.example backend/.env
# Edit backend/.env with your API keys

./compose.sh up --build
```

Visit http://localhost:3000 (frontend) and http://localhost:8000 (backend API)

### Manual Setup

**Backend:**
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Add your API keys
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install && npm run dev
```

## Configuration

Create `backend/.env` with your API keys:

```env
OPENSKY_CLIENT_ID=your_id
OPENSKY_CLIENT_SECRET=your_secret
AIS_API_KEY=your_aisstream_key
HIBP_API_KEY=your_hibp_key
OPENROUTER_API_KEY=your_openrouter_key
ADMIN_KEY=your-secret-key
```

**⚠️ NEVER commit `.env` to git** — it's in `.gitignore` for your protection.

## Mexico Features

- **Military Bases**: 37 SEDENA/SEMAR locations
- **PEMEX Infrastructure**: 26 oil/gas facilities
- **Volcanoes**: 15 volcanoes with CENAPRED alerts
- **Weather Alerts**: Real-time CONAGUA SMN warnings
- **News**: State-by-state aggregation from 40+ sources
- **Earthquakes**: USGS + Mexico SSN feeds

## World-System Module (2D map / 3D globe)

The **SISTEMA-MUNDO** button (top center) opens the world-system module, and **MAPA 2D / GLOBO 3D** switches between the MapLibre map and an interactive 3D globe ([globe.gl](https://github.com/vasturiano/globe.gl)). The globe shows the live feeds too: flights, ships and earthquakes.

**Model layer.** It comes from [Reproducible-Research-Project-2](https://github.com/QU01/Reproducible-Research-Project-2), an agent-based model of 180 countries that combines:
- world-systems theory;
- structural-demographic theory;
- Turchin's metaethnic frontier;
- Hubbert resource depletion;
- debt, crises and financing;
- institutions;
- climate damage.

It is calibrated on 1950–2019 data and validated out of sample at 1, 5 and 10 years.

- **Indicators:** 14 per country (GDP per capita, core/periphery position, political stress index, conflict risk, asabiya, elite capture, net world-system rents, resource rents and reserves, debt, democracy, temperature, climate damage, CO₂).
- **Scenarios:** observed data, the model replaying history, the forecast from 1990, the projection to 2030, and four reinforcement-learning policies.
- **Time:** a year slider with playback, 1950–2030.
- **Countries:** click one to see its **incremental recommendation**, the change in spending by channel relative to the country's estimated decision rule. The panel shows the expected effect on consumption, GDP, debt and conflict, the probability of improvement, and how robust the result is across parameter sets.

**New open OSINT layers:**

| Layer | Source |
|---|---|
| Geocoded armed-conflict events, 1989–2023, driven by the year slider | UCDP GED v24.1 |
| Shipping lanes | Benden 2021, from AIS density |
| Bilateral trade flows, 1950–2014 | Correlates of War |
| Global air-route network | OpenFlights |
| Oil and gas pipelines in operation | Global Energy Monitor |
| LNG terminals and oil/gas fields | Global Energy Monitor |
| Reactors under construction or planned | GeoNuclearData |
| Submarine cables | TeleGeography, CC BY-NC-SA 3.0 |
| World ports | NGA World Port Index |

**Backend API.**
- `/api/worldsystem/meta` — countries, scenarios and their variables.
- `/api/worldsystem/layer?scenario=&var=&year=` — indicator values for all countries.
- `/api/worldsystem/country/{iso3}` — one country's series and recommendations.
- `/api/worldsystem/recommendations?mode=bienestar|revelada`
- `/api/worldsystem/insights` — revealed reward, decision rules and validation.
- `/api/worldsystem/countries` — country polygons.
- `/api/worldsystem/osint/{layer}?year=`

**Data.** The data lives in `backend/data/worldsystem/` as gzip JSON, about 3 MB. To refresh it after re-running the model:

```bash
python backend/scripts/sync_worldsystem.py /path/to/Reproducible-Research-Project-2
```

## AI Agent Tools

Access 25+ OSINT tools via conversational interface:

```
get_mexico_state_news(state="Sinaloa")
get_mexico_data()
person_lookup(name="John Doe", email="john@example.com")
get_live_flights()
get_live_ships()
web_search("query")
```

## Data Sources (50+)

- Flights (OpenSky, FlightRadar24)
- Vessels (AIS stream, 25K+ ships)
- Satellites (TLE database)
- Earthquakes (USGS, Mexico SSN)
- News (Reuters, AP, BBC, Mexican outlets)
- Conflicts (GDELT, LiveUAMap)
- Military bases, PEMEX, power plants, data centers
- CCTV (London, Singapore, Austin, NYC)
- Financial (oil prices, defense stocks)

## Project Structure

```
quasarbroker/
├── backend/
│   ├── main.py                    # FastAPI app
│   ├── services/
│   │   ├── agent_tools.py         # 25+ LangChain tools
│   │   ├── fetchers/              # Data fetchers
│   │   └── mexico.py              # CONAGUA + CENAPRED
│   ├── data/                      # Static datasets
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/page.tsx           # Main dashboard
│   │   ├── components/            # UI components
│   │   └── QUASAR.svg             # Logo
│   └── package.json
├── docker-compose.yml
└── README.md
```

## Performance

- **ETag Caching**: 304 Not Modified when data unchanged
- **Viewport Culling**: Reduces AIS data 99% for current view
- **Parallel Fetchers**: ThreadPoolExecutor for concurrent data collection
- **Imperative Map**: Direct `setData()` bypasses React reconciliation
- **Clustering**: Auto-cluster points below zoom 8

## Security

- `.env` files never committed (in `.gitignore`)
- API keys client-side only
- Rate limiting (10 req/min for person-lookup)
- Optional admin authentication
- All data from public sources

## License

MIT License — See LICENSE file

**Original Project**: [ShadowBroker](https://github.com/BigBodyCobain/Shadowbroker) by BigBodyCobain

**Enhancements**: Mexico OSINT, AI agents, advanced person lookup, state news

## FAQ

**Q: Do I need API keys?**  
A: No. Public data works without keys. Keys unlock premium features (flights, vessels).

**Q: Is this real-time?**  
A: Flights/ships: 60s. News/earthquakes/infrastructure: 5-30min.

**Q: Can I add custom sources?**  
A: Yes. Create a fetcher in `backend/services/fetchers/` and register it.

---

**Status**: Active Development  
**Last Updated**: March 2026
