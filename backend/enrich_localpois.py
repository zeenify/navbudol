"""Fix municipality attribution in backend/data/localpois.json.

The bulk Overpass snapshot uses a 6 km radius around General Tinio Poblacion,
which legitimately includes places from NEIGHBOURING municipalities
(Peñaranda, Gapan edge, etc). This script reverse-geocodes every entry with
Geoapify and rewrites `detail` to the place's TRUE municipality — never a
blanket "General Tinio".

Run once after fetch_localpois.py; safe to re-run.
"""
import json
import os
import time

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "data", "localpois.json")
KEY = os.environ.get("GEOAPIFY_KEY", "")

if not KEY:
    # read from .env if not exported
    env_path = os.path.join(HERE, ".env")
    if os.path.exists(env_path):
        for line in open(env_path, encoding="utf-8"):
            if line.startswith("GEOAPIFY_KEY="):
                KEY = line.split("=", 1)[1].strip()
                break

if not KEY:
    raise SystemExit("GEOAPIFY_KEY not found")


def municipality_for(lat: float, lng: float) -> str:
    try:
        r = httpx.get(
            "https://api.geoapify.com/v1/geocode/reverse",
            params={"lat": lat, "lon": lng, "apiKey": KEY, "limit": 1},
            timeout=15,
        )
        p = r.json().get("features", [{}])[0].get("properties", {})
        return (
            p.get("city")
            or p.get("town")
            or p.get("municipality")
            or p.get("village")
            or p.get("county")
            or "Nueva Ecija"
        )
    except Exception:
        return "Nueva Ecija"


def main() -> None:
    data = json.load(open(PATH, encoding="utf-8"))
    print(f"enriching {len(data)} places ...")
    for i, place in enumerate(data):
        kind = (place.get("type") or "place").replace("_", " ").title()
        muni = municipality_for(place["lat"], place["lng"])
        place["detail"] = f"{kind} · {muni}"
        if (i + 1) % 20 == 0:
            print(f"  {i + 1}/{len(data)}")
        time.sleep(0.15)
    json.dump(data, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("done — labels now carry the real municipality")


if __name__ == "__main__":
    main()
