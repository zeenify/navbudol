"""Free-tier geo services proxied through the backend so their keys never
ship inside the APK:

  GET  /api/weather   → OpenWeatherMap current conditions
  GET  /api/geocode   → Geoapify autocomplete (better than Photon)
  GET  /api/reverse   → Geoapify reverse geocode
  POST /api/directions → OpenRouteService routing (walking! + elevation)
  POST /api/isochrone → OpenRouteService isochrone polygon
"""

import json
import os
import time

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["geo"])

ORS_BASE = "https://api.openrouteservice.org/v2"
OWM_BASE = "https://api.openweathermap.org/data/2.5"
GEOAPIFY_BASE = "https://api.geoapify.com/v1"

# General Tinio (Papaya) Poblacion — the demo's home turf
HOME_LAT, HOME_LNG = 15.3519, 121.0633

# One-time snapshot of every named place around General Tinio. Overpass is
# heavy, so this is cached in memory for 6 hours and served to the app,
# which keeps its own daily copy. Mirrors tried in order.
OVERPASS_MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
_LOCAL_POIS_CACHE: dict = {"ts": 0.0, "data": None}
_UA = {"User-Agent": "NavBudol/1.0 (student navigation project)", "Accept": "application/json"}

# ORS numeric step types → voice-friendly maneuver type
ORS_TYPE_NAMES = {
    0: "turn left",
    1: "turn right",
    2: "turn sharp left",
    3: "turn sharp right",
    4: "continue straight",
    5: "turn slight left",
    6: "turn slight right",
    7: "continue straight",
    8: "turn slight right",
    9: "turn slight left",
    10: "arrive",
    11: "uturn",
}


class DirectionsRequest(BaseModel):
    frm: dict  # {"lat": ..., "lng": ...}
    to: dict  # {"lat": ..., "lng": ...}
    profile: str = "driving-car"  # or foot-walking


class IsochroneRequest(BaseModel):
    lat: float
    lng: float
    minutes: int = 10
    profile: str = "foot-walking"


def _ors_key() -> str:
    key = os.getenv("ORS_API_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="ORS_API_KEY not set in backend/.env")
    return key


@router.get("/weather")
def weather(lat: float, lon: float):
    key = os.getenv("OWM_API_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="OWM_API_KEY not set in backend/.env")
    try:
        resp = httpx.get(
            f"{OWM_BASE}/weather",
            params={"lat": lat, "lon": lon, "appid": key, "units": "metric"},
            timeout=15,
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"weather failed: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"weather HTTP {resp.status_code}: {resp.text[:200]}")
    d = resp.json()
    return {
        "temp": round(d.get("main", {}).get("temp", 0)),
        "feelsLike": round(d.get("main", {}).get("feels_like", 0)),
        "description": (d.get("weather") or [{}])[0].get("description", ""),
        "humidity": d.get("main", {}).get("humidity"),
        "windMs": d.get("wind", {}).get("speed"),
        "city": d.get("name", ""),
    }


@router.get("/geocode")
def geocode(q: str, lat: float | None = None, lon: float | None = None, limit: int = 8):
    key = os.getenv("GEOAPIFY_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="GEOAPIFY_KEY not set in backend/.env")
    params = {
        "text": q,
        "apiKey": key,
        "limit": limit,
        "lang": "en",
        # PH-only + proximity bias keeps results local instead of the
        # whole planet matching the same word.
        "filter": "countrycode:ph",
    }
    if lat is not None and lon is not None:
        params.update({"bias:proximity": f"{lon},{lat}"})
    try:
        # AUTOCOMPLETE endpoint (not /search) — designed for partial keystrokes.
        resp = httpx.get(f"{GEOAPIFY_BASE}/geocode/autocomplete", params=params, timeout=15)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"geocode failed: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"geocode HTTP {resp.status_code}")
    features = resp.json().get("features", [])
    out = []
    for f in features:
        p = f.get("properties", {})
        coords = f.get("geometry", {}).get("coordinates", [None, None])
        out.append({
            "name": p.get("name") or p.get("street") or p.get("formatted", "Unnamed place"),
            "detail": p.get("formatted"),
            "lat": coords[1],
            "lng": coords[0],
            "type": p.get("category"),
        })
    return out


@router.get("/localpois")
def localpois():
    """Instant local search index — THE merged dataset.

    backend/data/places_final.json is the single source of truth: 386 raw
    records from Foursquare + Overture (Meta/Microsoft) + OSM, smart-merged
    (name-similarity + distance; chains keep separate branches; verified
    pins for famous landmarks). Rebuild with:
      fetch_localpois.py -> foursquare_fetch.py -> overture_fetch.py -> merge_final.py
    """
    here = os.path.dirname(os.path.abspath(__file__))

    final = os.path.join(here, "..", "data", "places_final.json")
    if os.path.exists(final):
        try:
            with open(final, encoding="utf-8") as f:
                return json.load(f)
        except (ValueError, OSError):
            pass

    # Fallback: legacy per-source union (only if the merged file is missing)
    merged: list[dict] = []
    seen: set[str] = set()

    def near_dup_key(name: str, lat: float, lng: float) -> str:
        return f"{name.strip().lower()}|{round(lat, 3)}|{round(lng, 3)}"

    for fname in ("foursquare_gt.json", "overture_gt.json", "localpois.json"):
        path = os.path.join(here, "..", "data", fname)
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                for p in json.load(f):
                    k = near_dup_key(p.get("name", ""), p.get("lat", 0), p.get("lng", 0))
                    if k in seen:
                        continue
                    seen.add(k)
                    merged.append(p)
        except (ValueError, OSError):
            continue

    if merged:
        return merged

    now = time.time()
    if _LOCAL_POIS_CACHE["data"] and now - _LOCAL_POIS_CACHE["ts"] < 6 * 3600:
        return _LOCAL_POIS_CACHE["data"]

    query = (
        "[out:json][timeout:25];"
        f'(nwr["name"](around:6000,{HOME_LAT},{HOME_LNG}););'
        "out center 600;"
    )
    for mirror in OVERPASS_MIRRORS:
        try:
            resp = httpx.post(mirror, data={"data": query}, headers=_UA, timeout=45)
            if resp.status_code != 200:
                continue
            elements = resp.json().get("elements", [])
            out = []
            for el in elements:
                tags = el.get("tags", {})
                name = tags.get("name")
                lat = el.get("lat") or el.get("center", {}).get("lat")
                lng = el.get("lon") or el.get("center", {}).get("lon")
                if not name or lat is None or lng is None:
                    continue
                kind = tags.get("amenity") or tags.get("shop") or tags.get("tourism") or tags.get("leisure") or "place"
                out.append({
                    "name": name,
                    # No blanket municipality here — the radius spans several
                    # towns. enrich_localpois.py stamps the real one into the
                    # persisted snapshot; this live path is only a fallback.
                    "detail": kind.replace("_", " ").title(),
                    "lat": round(lat, 6),
                    "lng": round(lng, 6),
                    "type": kind,
                })
            # dedupe by name+round coords
            seen = set()
            deduped = []
            for p in out:
                k = f"{p['name']}|{p['lat']}|{p['lng']}"
                if k in seen:
                    continue
                seen.add(k)
                deduped.append(p)
            if deduped:
                _LOCAL_POIS_CACHE["ts"] = now
                _LOCAL_POIS_CACHE["data"] = deduped
                return deduped
            return []
        except (httpx.HTTPError, ValueError):
            continue
    raise HTTPException(status_code=502, detail="All Overpass mirrors unavailable right now")


@router.get("/health-geo")
def health_geo():
    return {"overpass_cached": _LOCAL_POIS_CACHE["data"] is not None}


@router.get("/reverse")
def reverse(lat: float, lon: float):
    key = os.getenv("GEOAPIFY_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="GEOAPIFY_KEY not set in backend/.env")
    try:
        resp = httpx.get(
            f"{GEOAPIFY_BASE}/geocode/reverse",
            params={"lat": lat, "lon": lon, "apiKey": key},
            timeout=15,
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"reverse failed: {e}")
    if resp.status_code != 200:
        return {"label": None}
    p = resp.json().get("features", [{}])[0].get("properties", {})
    label = ", ".join(
        part for part in [p.get("street"), p.get("district") or p.get("suburb"), p.get("city")] if part
    ) or p.get("formatted")
    return {"label": label}


@router.post("/directions")
def directions(req: DirectionsRequest):
    key = _ors_key()
    try:
        resp = httpx.post(
            f"{ORS_BASE}/directions/{req.profile}/geojson",
            headers={"Authorization": key, "Content-Type": "application/json"},
            json={
                "coordinates": [[req.frm["lng"], req.frm["lat"]], [req.to["lng"], req.to["lat"]]],
                "elevation": True,
                "instructions": True,
                "preference": "recommended",
            },
            timeout=30,
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"ORS failed: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"ORS HTTP {resp.status_code}: {resp.text[:200]}")

    feature = resp.json()["features"][0]
    props = feature["properties"]
    coords = [[c[1], c[0]] for c in feature["geometry"]["coordinates"]]  # → [lat, lng]

    steps = []
    for seg in props.get("segments", []):
        for s in seg.get("steps", []):
            wp = s.get("way_points", [0])
            idx = wp[0] if wp else 0
            lat, lng = coords[min(idx, len(coords) - 1)]
            instr = s.get("instruction", "Continue")
            tcode = s.get("type", -1)
            mtype = ORS_TYPE_NAMES.get(tcode, instr.lower())
            steps.append({
                "instruction": instr,
                "name": "",
                "distanceM": s.get("distance", 0),
                "durationS": s.get("duration", 0),
                "maneuverType": mtype,
                "maneuverModifier": _modifier_from(mtype),
                "location": {"lat": lat, "lng": lng},
                "cumulativeDistanceM": 0,
            })
    # cumulative distances from step distances
    run = 0
    for s in steps:
        run += s["distanceM"]
        s["cumulativeDistanceM"] = run

    return {
        "geometry": coords,
        "steps": steps,
        "distanceM": props.get("summary", {}).get("distance", 0),
        "durationS": props.get("summary", {}).get("duration", 0),
        "ascentM": props.get("ascent", 0),
    }


def _modifier_from(mtype: str) -> str:
    if "left" in mtype:
        return "left"
    if "right" in mtype:
        return "right"
    if "uturn" in mtype:
        return "uturn"
    return "straight"


@router.post("/isochrone")
def isochrone(req: IsochroneRequest):
    key = _ors_key()
    try:
        resp = httpx.post(
            f"{ORS_BASE}/isochrones/{req.profile}/geojson",
            headers={"Authorization": key, "Content-Type": "application/json"},
            json={
                "locations": [[req.lng, req.lat]],
                "range": [req.minutes * 60],
                "range_type": "time",
            },
            timeout=30,
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"ORS failed: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"ORS HTTP {resp.status_code}: {resp.text[:200]}")
    return resp.json()
