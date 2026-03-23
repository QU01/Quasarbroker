"""Mexico state-level news aggregator — fetches from 40+ Mexican RSS feeds,
geocodes each article to one of 32 states, and groups them for map display."""
import re
import logging
import concurrent.futures
import hashlib
from datetime import datetime, timedelta
import feedparser
from services.network_utils import fetch_with_curl
from services.fetchers._store import latest_data, _data_lock, _mark_fresh
from services.fetchers.retry import with_retry

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Mexico state centroids (32 entities)
# ---------------------------------------------------------------------------
MEXICO_STATES = {
    "AGU": {"name": "Aguascalientes",       "lat": 21.88,  "lng": -102.29},
    "BCN": {"name": "Baja California",      "lat": 30.84,  "lng": -115.28},
    "BCS": {"name": "Baja California Sur",  "lat": 24.14,  "lng": -110.31},
    "CAM": {"name": "Campeche",             "lat": 19.84,  "lng": -90.53},
    "CHP": {"name": "Chiapas",              "lat": 16.75,  "lng": -93.12},
    "CHH": {"name": "Chihuahua",            "lat": 28.63,  "lng": -106.09},
    "CMX": {"name": "Ciudad de México",     "lat": 19.43,  "lng": -99.13},
    "COA": {"name": "Coahuila",             "lat": 25.42,  "lng": -100.99},
    "COL": {"name": "Colima",               "lat": 19.24,  "lng": -103.72},
    "DUR": {"name": "Durango",              "lat": 24.02,  "lng": -104.67},
    "GUA": {"name": "Guanajuato",           "lat": 21.02,  "lng": -101.26},
    "GRO": {"name": "Guerrero",             "lat": 17.44,  "lng": -99.55},
    "HID": {"name": "Hidalgo",              "lat": 20.09,  "lng": -98.76},
    "JAL": {"name": "Jalisco",              "lat": 20.66,  "lng": -103.35},
    "MEX": {"name": "Estado de México",     "lat": 19.36,  "lng": -99.64},
    "MIC": {"name": "Michoacán",            "lat": 19.57,  "lng": -101.71},
    "MOR": {"name": "Morelos",              "lat": 18.92,  "lng": -99.23},
    "NAY": {"name": "Nayarit",              "lat": 21.50,  "lng": -104.89},
    "NLE": {"name": "Nuevo León",           "lat": 25.67,  "lng": -100.31},
    "OAX": {"name": "Oaxaca",              "lat": 17.07,  "lng": -96.72},
    "PUE": {"name": "Puebla",               "lat": 19.04,  "lng": -98.20},
    "QUE": {"name": "Querétaro",            "lat": 20.59,  "lng": -100.39},
    "ROO": {"name": "Quintana Roo",         "lat": 21.16,  "lng": -86.85},
    "SLP": {"name": "San Luis Potosí",      "lat": 22.15,  "lng": -100.98},
    "SIN": {"name": "Sinaloa",              "lat": 24.81,  "lng": -107.39},
    "SON": {"name": "Sonora",               "lat": 29.07,  "lng": -110.96},
    "TAB": {"name": "Tabasco",              "lat": 17.99,  "lng": -92.93},
    "TAM": {"name": "Tamaulipas",           "lat": 23.74,  "lng": -99.15},
    "TLA": {"name": "Tlaxcala",             "lat": 19.32,  "lng": -98.24},
    "VER": {"name": "Veracruz",             "lat": 19.53,  "lng": -96.92},
    "YUC": {"name": "Yucatán",              "lat": 20.97,  "lng": -89.62},
    "ZAC": {"name": "Zacatecas",            "lat": 22.77,  "lng": -102.58},
}

# ---------------------------------------------------------------------------
# Keyword-to-state mapping (city -> state code)
# Sorted by descending length so "ciudad de mexico" matches before "mexico"
# ---------------------------------------------------------------------------
_CITY_TO_STATE: list[tuple[str, str]] = sorted([
    # CDMX
    ("ciudad de mexico", "CMX"), ("cdmx", "CMX"), ("mexico city", "CMX"),
    ("iztapalapa", "CMX"), ("coyoacan", "CMX"), ("tlalpan", "CMX"),
    ("xochimilco", "CMX"), ("azcapotzalco", "CMX"), ("gustavo a. madero", "CMX"),
    ("alvaro obregon", "CMX"), ("benito juarez", "CMX"), ("cuauhtemoc", "CMX"),
    ("miguel hidalgo", "CMX"), ("tepito", "CMX"), ("reforma", "CMX"),
    ("chapultepec", "CMX"), ("zocalo", "CMX"), ("polanco", "CMX"),
    # Aguascalientes
    ("aguascalientes", "AGU"),
    # Baja California
    ("tijuana", "BCN"), ("mexicali", "BCN"), ("ensenada", "BCN"),
    ("tecate", "BCN"), ("rosarito", "BCN"), ("baja california norte", "BCN"),
    ("baja california", "BCN"),
    # Baja California Sur
    ("baja california sur", "BCS"), ("la paz", "BCS"), ("los cabos", "BCS"),
    ("cabo san lucas", "BCS"), ("san jose del cabo", "BCS"),
    # Campeche
    ("campeche", "CAM"), ("ciudad del carmen", "CAM"), ("calakmul", "CAM"),
    # Chiapas
    ("chiapas", "CHP"), ("tuxtla gutierrez", "CHP"), ("san cristobal", "CHP"),
    ("tapachula", "CHP"), ("palenque", "CHP"), ("comitan", "CHP"),
    # Chihuahua
    ("chihuahua", "CHH"), ("ciudad juarez", "CHH"), ("juarez", "CHH"),
    ("cuauhtemoc", "CHH"), ("delicias", "CHH"), ("parral", "CHH"),
    ("sierra tarahumara", "CHH"), ("tarahumara", "CHH"),
    # Coahuila
    ("coahuila", "COA"), ("saltillo", "COA"), ("torreon", "COA"),
    ("monclova", "COA"), ("piedras negras", "COA"), ("acuna", "COA"),
    # Colima
    ("colima", "COL"), ("manzanillo", "COL"), ("tecoman", "COL"),
    # Durango
    ("durango", "DUR"), ("gomez palacio", "DUR"), ("lerdo", "DUR"),
    # Guanajuato
    ("guanajuato", "GUA"), ("leon", "GUA"), ("irapuato", "GUA"),
    ("celaya", "GUA"), ("salamanca", "GUA"), ("silao", "GUA"),
    # Guerrero
    ("guerrero", "GRO"), ("acapulco", "GRO"), ("chilpancingo", "GRO"),
    ("iguala", "GRO"), ("taxco", "GRO"), ("zihuatanejo", "GRO"),
    # Hidalgo
    ("hidalgo", "HID"), ("pachuca", "HID"), ("tula", "HID"), ("tulancingo", "HID"),
    # Jalisco
    ("jalisco", "JAL"), ("guadalajara", "JAL"), ("zapopan", "JAL"),
    ("puerto vallarta", "JAL"), ("tlaquepaque", "JAL"), ("tonala", "JAL"),
    ("lagos de moreno", "JAL"), ("chapala", "JAL"), ("tequila", "JAL"),
    # Estado de México
    ("estado de mexico", "MEX"), ("edomex", "MEX"), ("toluca", "MEX"),
    ("ecatepec", "MEX"), ("naucalpan", "MEX"), ("nezahualcoyotl", "MEX"),
    ("tlalnepantla", "MEX"), ("chimalhuacan", "MEX"), ("texcoco", "MEX"),
    # Michoacán
    ("michoacan", "MIC"), ("morelia", "MIC"), ("uruapan", "MIC"),
    ("lazaro cardenas", "MIC"), ("zamora", "MIC"), ("apatzingan", "MIC"),
    ("tierra caliente", "MIC"), ("patzcuaro", "MIC"),
    # Morelos
    ("morelos", "MOR"), ("cuernavaca", "MOR"), ("cuautla", "MOR"),
    ("jiutepec", "MOR"), ("temixco", "MOR"),
    # Nayarit
    ("nayarit", "NAY"), ("tepic", "NAY"), ("bahia de banderas", "NAY"),
    # Nuevo León
    ("nuevo leon", "NLE"), ("monterrey", "NLE"), ("san pedro garza garcia", "NLE"),
    ("san nicolas de los garza", "NLE"), ("apodaca", "NLE"), ("guadalupe", "NLE"),
    ("santa catarina", "NLE"), ("garcia", "NLE"),
    # Oaxaca
    ("oaxaca", "OAX"), ("juchitan", "OAX"), ("salina cruz", "OAX"),
    ("huatulco", "OAX"), ("puerto escondido", "OAX"), ("istmo", "OAX"),
    # Puebla
    ("puebla", "PUE"), ("tehuacan", "PUE"), ("cholula", "PUE"),
    ("atlixco", "PUE"), ("san martin texmelucan", "PUE"),
    # Querétaro
    ("queretaro", "QUE"), ("san juan del rio", "QUE"),
    # Quintana Roo
    ("quintana roo", "ROO"), ("cancun", "ROO"), ("playa del carmen", "ROO"),
    ("chetumal", "ROO"), ("tulum", "ROO"), ("cozumel", "ROO"),
    ("riviera maya", "ROO"),
    # San Luis Potosí
    ("san luis potosi", "SLP"), ("ciudad valles", "SLP"), ("matehuala", "SLP"),
    # Sinaloa
    ("sinaloa", "SIN"), ("culiacan", "SIN"), ("mazatlan", "SIN"),
    ("los mochis", "SIN"), ("guasave", "SIN"), ("navolato", "SIN"),
    # Sonora
    ("sonora", "SON"), ("hermosillo", "SON"), ("ciudad obregon", "SON"),
    ("nogales", "SON"), ("guaymas", "SON"), ("caborca", "SON"),
    ("san luis rio colorado", "SON"), ("puerto penasco", "SON"),
    # Tabasco
    ("tabasco", "TAB"), ("villahermosa", "TAB"), ("cardenas", "TAB"),
    ("comalcalco", "TAB"), ("paraiso", "TAB"), ("dos bocas", "TAB"),
    # Tamaulipas
    ("tamaulipas", "TAM"), ("reynosa", "TAM"), ("matamoros", "TAM"),
    ("nuevo laredo", "TAM"), ("tampico", "TAM"), ("ciudad victoria", "TAM"),
    ("altamira", "TAM"), ("ciudad madero", "TAM"),
    # Tlaxcala
    ("tlaxcala", "TLA"), ("apizaco", "TLA"),
    # Veracruz
    ("veracruz", "VER"), ("xalapa", "VER"), ("coatzacoalcos", "VER"),
    ("minatitlan", "VER"), ("poza rica", "VER"), ("cordoba", "VER"),
    ("orizaba", "VER"), ("tuxpan", "VER"), ("boca del rio", "VER"),
    # Yucatán
    ("yucatan", "YUC"), ("merida", "YUC"), ("valladolid", "YUC"),
    ("progreso", "YUC"), ("tizimin", "YUC"),
    # Zacatecas
    ("zacatecas", "ZAC"), ("fresnillo", "ZAC"), ("jerez", "ZAC"),
    ("guadalupe", "ZAC"), ("rio grande", "ZAC"),
], key=lambda x: len(x[0]), reverse=True)

# ---------------------------------------------------------------------------
# Risk keywords for scoring (Spanish + English)
# ---------------------------------------------------------------------------
_RISK_KEYWORDS_ES = [
    ("asesinato", 3), ("homicidio", 3), ("ejecucion", 3), ("masacre", 4),
    ("narcotrafico", 3), ("cartel", 3), ("sicario", 3), ("narco", 2),
    ("secuestro", 3), ("extorsion", 2), ("desaparecido", 2), ("desaparicion", 2),
    ("fosa clandestina", 4), ("levanton", 3),
    ("tiroteo", 3), ("balacera", 3), ("enfrentamiento", 2), ("emboscada", 3),
    ("explosion", 2), ("incendio", 1), ("derrumbe", 2),
    ("alerta", 1), ("emergencia", 2), ("crisis", 2),
    ("protesta", 1), ("bloqueo", 1), ("marcha", 1),
    ("huracan", 2), ("sismo", 2), ("terremoto", 3), ("inundacion", 2),
    ("violencia", 2), ("inseguridad", 1), ("crimen", 2),
    ("muerto", 2), ("victima", 1), ("cadaver", 3),
    ("robo", 1), ("asalto", 1), ("feminicidio", 3),
    ("militar", 1), ("sedena", 1), ("guardia nacional", 1),
    ("detencion", 1), ("operativo", 1), ("decomiso", 1),
]

_RISK_KEYWORDS_EN = [
    ("murder", 3), ("homicide", 3), ("killing", 3), ("massacre", 4),
    ("drug trafficking", 3), ("cartel", 3), ("hitman", 3),
    ("kidnapping", 3), ("extortion", 2), ("disappearance", 2),
    ("shooting", 3), ("gunfight", 3), ("ambush", 3),
    ("explosion", 2), ("fire", 1), ("collapse", 2),
    ("emergency", 2), ("crisis", 2), ("protest", 1), ("blockade", 1),
    ("hurricane", 2), ("earthquake", 2), ("flood", 2),
    ("violence", 2), ("crime", 2), ("femicide", 3),
]

# ---------------------------------------------------------------------------
# RSS feed sources — national + state/regional outlets
# ---------------------------------------------------------------------------
MEXICO_NEWS_FEEDS = [
    # === Verified working national outlets ===
    {"name": "Aristegui",        "url": "https://aristeguinoticias.com/feed/",                 "weight": 5, "type": "national"},
    {"name": "Reforma",          "url": "https://www.reforma.com/rss/portada.xml",            "weight": 5, "type": "national"},
    {"name": "El Financiero",    "url": "https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/", "weight": 4, "type": "national"},
    {"name": "Expansión",        "url": "https://expansion.mx/rss",                           "weight": 3, "type": "national"},
    {"name": "La Silla Rota",    "url": "https://lasillarota.com/feed/",                      "weight": 3, "type": "national"},
    {"name": "Quadratín",        "url": "https://www.quadratin.com.mx/feed/",                 "weight": 3, "type": "national"},
    # === Security / Crime specific ===
    {"name": "InSight Crime",    "url": "https://insightcrime.org/feed/",                     "weight": 5, "type": "security"},
    {"name": "El Blog del Narco","url": "https://elblogdelnarco.com/feed/",                   "weight": 4, "type": "security"},
    {"name": "Borderland Beat",  "url": "https://www.borderlandbeat.com/feeds/posts/default?alt=rss", "weight": 4, "type": "security"},
    # === Regional / State outlets (verified) ===
    {"name": "El Norte (NL)",    "url": "https://www.elnorte.com/rss/portada.xml",            "weight": 3, "type": "regional", "state": "NLE"},
    {"name": "Zeta Tijuana (BCN)","url": "https://zetatijuana.com/feed/",                     "weight": 4, "type": "regional", "state": "BCN"},
    {"name": "El Diario (CHH)", "url": "https://diario.mx/feed/",                             "weight": 3, "type": "regional", "state": "CHH"},
    {"name": "Tribuna (SON)",    "url": "https://www.tribuna.com.mx/feed/",                   "weight": 2, "type": "regional", "state": "SON"},
    # === Google News RSS per state (always available, high coverage) ===
    {"name": "GN CDMX",         "url": "https://news.google.com/rss/search?q=Ciudad+de+Mexico+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "CMX"},
    {"name": "GN Jalisco",      "url": "https://news.google.com/rss/search?q=Jalisco+Guadalajara+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "JAL"},
    {"name": "GN Nuevo León",   "url": "https://news.google.com/rss/search?q=Nuevo+Leon+Monterrey+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "NLE"},
    {"name": "GN Sinaloa",      "url": "https://news.google.com/rss/search?q=Sinaloa+Culiacan+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "SIN"},
    {"name": "GN Guanajuato",   "url": "https://news.google.com/rss/search?q=Guanajuato+Leon+Celaya+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "GUA"},
    {"name": "GN Guerrero",     "url": "https://news.google.com/rss/search?q=Guerrero+Acapulco+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "GRO"},
    {"name": "GN Michoacán",    "url": "https://news.google.com/rss/search?q=Michoacan+Morelia+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "MIC"},
    {"name": "GN Tamaulipas",   "url": "https://news.google.com/rss/search?q=Tamaulipas+Reynosa+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "TAM"},
    {"name": "GN Chihuahua",    "url": "https://news.google.com/rss/search?q=Chihuahua+Ciudad+Juarez+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "CHH"},
    {"name": "GN Veracruz",     "url": "https://news.google.com/rss/search?q=Veracruz+Xalapa+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "VER"},
    {"name": "GN Oaxaca",       "url": "https://news.google.com/rss/search?q=Oaxaca+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "OAX"},
    {"name": "GN Chiapas",      "url": "https://news.google.com/rss/search?q=Chiapas+Tapachula+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "CHP"},
    {"name": "GN Puebla",       "url": "https://news.google.com/rss/search?q=Puebla+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "PUE"},
    {"name": "GN Sonora",       "url": "https://news.google.com/rss/search?q=Sonora+Hermosillo+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "SON"},
    {"name": "GN Tabasco",      "url": "https://news.google.com/rss/search?q=Tabasco+Villahermosa+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "TAB"},
    {"name": "GN Baja California","url": "https://news.google.com/rss/search?q=Tijuana+Baja+California+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "BCN"},
    {"name": "GN Quintana Roo", "url": "https://news.google.com/rss/search?q=Cancun+Quintana+Roo+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "ROO"},
    {"name": "GN Coahuila",     "url": "https://news.google.com/rss/search?q=Coahuila+Saltillo+Torreon+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "COA"},
    {"name": "GN Zacatecas",    "url": "https://news.google.com/rss/search?q=Zacatecas+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "ZAC"},
    {"name": "GN Durango",      "url": "https://news.google.com/rss/search?q=Durango+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "DUR"},
    {"name": "GN Morelos",      "url": "https://news.google.com/rss/search?q=Morelos+Cuernavaca+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "MOR"},
    {"name": "GN EdoMex",       "url": "https://news.google.com/rss/search?q=Estado+de+Mexico+Ecatepec+Toluca+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "google", "state": "MEX"},
    {"name": "GN SLP",          "url": "https://news.google.com/rss/search?q=San+Luis+Potosi+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "SLP"},
    {"name": "GN Hidalgo",      "url": "https://news.google.com/rss/search?q=Hidalgo+Pachuca+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "HID"},
    {"name": "GN Yucatán",      "url": "https://news.google.com/rss/search?q=Yucatan+Merida+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "YUC"},
    {"name": "GN Nayarit",      "url": "https://news.google.com/rss/search?q=Nayarit+Tepic+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "NAY"},
    {"name": "GN Colima",       "url": "https://news.google.com/rss/search?q=Colima+Manzanillo+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "COL"},
    {"name": "GN Campeche",     "url": "https://news.google.com/rss/search?q=Campeche+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "CAM"},
    {"name": "GN Querétaro",    "url": "https://news.google.com/rss/search?q=Queretaro+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "QUE"},
    {"name": "GN Aguascalientes","url": "https://news.google.com/rss/search?q=Aguascalientes+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "AGU"},
    {"name": "GN Tlaxcala",     "url": "https://news.google.com/rss/search?q=Tlaxcala+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "TLA"},
    {"name": "GN BCS",          "url": "https://news.google.com/rss/search?q=Baja+California+Sur+Los+Cabos+noticias&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 2, "type": "google", "state": "BCS"},
    # === Mexico security Google News ===
    {"name": "GN Narco MX",     "url": "https://news.google.com/rss/search?q=narcotrafico+Mexico+cartel&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 4, "type": "security"},
    {"name": "GN Violencia MX", "url": "https://news.google.com/rss/search?q=violencia+homicidio+Mexico&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 4, "type": "security"},
    {"name": "GN Guardia Nac",  "url": "https://news.google.com/rss/search?q=Guardia+Nacional+SEDENA+operativo&hl=es-419&gl=MX&ceid=MX:es-419", "weight": 3, "type": "security"},
    # === International ===
    {"name": "BBC Mundo",        "url": "https://feeds.bbci.co.uk/mundo/rss.xml",             "weight": 3, "type": "international"},
]

# Maximum articles per state
MAX_PER_STATE = 5
# Maximum concurrent feed fetches
MAX_WORKERS = 12


def _resolve_state(text: str, feed_state: str | None = None) -> str | None:
    """Resolve text to a Mexican state code. Returns state code or None."""
    text_lower = text.lower()

    # Check city/state keywords (longest first)
    for keyword, state_code in _CITY_TO_STATE:
        # Use word boundary for short keywords, substring for longer
        if len(keyword) <= 4:
            if re.search(r'\b' + re.escape(keyword) + r'\b', text_lower):
                return state_code
        else:
            if keyword in text_lower:
                return state_code

    # Fall back to feed's default state if regional
    if feed_state:
        return feed_state

    return None


def _score_risk(title: str, summary: str) -> int:
    """Calculate risk score 1-10 based on Spanish + English keywords."""
    text = (title + " " + summary).lower()
    score = 1

    for kw, weight in _RISK_KEYWORDS_ES:
        if kw in text:
            score += weight

    for kw, weight in _RISK_KEYWORDS_EN:
        if kw in text:
            score += weight

    return min(10, score)


def _article_id(title: str, source: str) -> str:
    """Generate a short deterministic ID for deduplication."""
    return hashlib.md5(f"{source}:{title}".encode()).hexdigest()[:12]


@with_retry(max_retries=1, base_delay=2)
def fetch_mexico_news():
    """Fetch news from 30+ Mexican sources, geocode to states, aggregate per state."""
    # State-level aggregation: { "CMX": [articles...], "JAL": [...], ... }
    state_articles: dict[str, list] = {code: [] for code in MEXICO_STATES}
    seen_ids: set[str] = set()

    def _fetch_feed(feed_info):
        name = feed_info["name"]
        url = feed_info["url"]
        try:
            resp = fetch_with_curl(url, timeout=12, headers={"User-Agent": "QuasarBroker-MX-News/1.0"})
            if resp.status_code != 200:
                return name, None
            return name, feedparser.parse(resp.text)
        except Exception as e:
            logger.debug(f"Mexico news feed {name} failed: {e}")
            return name, None

    # Fetch all feeds concurrently
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        results = list(pool.map(_fetch_feed, MEXICO_NEWS_FEEDS))

    now = datetime.utcnow()
    total_articles = 0

    for i, (source_name, feed) in enumerate(results):
        if not feed or not hasattr(feed, 'entries'):
            continue

        feed_info = MEXICO_NEWS_FEEDS[i]
        feed_weight = feed_info.get("weight", 3)
        feed_state = feed_info.get("state")  # Regional feeds have a default state

        for entry in feed.entries[:8]:  # Up to 8 articles per feed
            title = entry.get("title", "").strip()
            summary = entry.get("summary", "").strip()
            link = entry.get("link", "")
            published = entry.get("published", "")

            if not title:
                continue

            # Dedup
            aid = _article_id(title, source_name)
            if aid in seen_ids:
                continue
            seen_ids.add(aid)

            # Geocode to state
            state_code = _resolve_state(title + " " + summary, feed_state)
            if not state_code:
                continue

            # Risk scoring
            risk = _score_risk(title, summary)

            # Parse date, skip articles older than 48h
            pub_date = None
            if published:
                try:
                    import email.utils
                    parsed = email.utils.parsedate_to_datetime(published)
                    if (now - parsed.replace(tzinfo=None)) > timedelta(hours=48):
                        continue
                    pub_date = parsed.isoformat()
                except Exception:
                    pub_date = published

            article = {
                "id": aid,
                "title": title,
                "summary": summary[:200] if summary else "",
                "source": source_name,
                "link": link,
                "published": pub_date or "",
                "risk_score": risk,
                "weight": feed_weight,
                "state": state_code,
            }

            state_articles[state_code].append(article)
            total_articles += 1

    # Sort each state's articles by risk*weight, keep top N
    mexico_news = []
    for code, articles in state_articles.items():
        if not articles:
            continue

        articles.sort(key=lambda a: (a["risk_score"] * a["weight"], a["risk_score"]), reverse=True)
        top = articles[:MAX_PER_STATE]
        state_info = MEXICO_STATES[code]
        max_risk = top[0]["risk_score"] if top else 0

        mexico_news.append({
            "state_code": code,
            "state_name": state_info["name"],
            "lat": state_info["lat"],
            "lng": state_info["lng"],
            "article_count": len(articles),
            "max_risk": max_risk,
            "articles": top,
        })

    # Sort states by max risk
    mexico_news.sort(key=lambda s: s["max_risk"], reverse=True)

    with _data_lock:
        latest_data["mexico_news"] = mexico_news
    _mark_fresh("mexico_news")
    logger.info(f"Mexico news: {total_articles} articles across {len([s for s in mexico_news if s['articles']])} states from {len([r for r in results if r[1]])} feeds")
