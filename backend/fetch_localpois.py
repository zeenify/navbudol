"""One-shot fetcher: snapshot every named OSM place around General Tinio
(Papaya) and persist it to backend/data/localpois.json.

IMPORTANT: the 6 km radius crosses municipal boundaries — results include
neighbouring towns (Peñaranda etc). Municipality labels are therefore NOT
stamped here; run `enrich_localpois.py` right after this script to
reverse-geocode every entry to its TRUE municipality.

Once the file exists, /api/localpois serves it instantly and never needs
Overpass again. Safe to re-run (it overwrites with fresher data).
"""
import json
import os
import sys
import time

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "localpois.json")
HOME_LAT, HOME_LNG = 15.3519, 121.0633

MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

QUERIES = [
    # primary: everything named in a 6 km radius
    f'[out:json][timeout:120];(nwr["name"](around:6000,{HOME_LAT},{HOME_LNG}););out center 2000;',
    # fallback: narrower radius if the big one keeps dying
    f'[out:json][timeout:90];(nwr["name"](around:3500,{HOME_LAT},{HOME_LNG}););out center 1500;',
]

UA = {
    "User-Agent": "NavBudol/1.0 (student navigation project; General Tinio NG; one-time bulk)",
    "Accept": "application/json",
}


def try_fetch() -> list | None:
    for qi, query in enumerate(QUERIES):
        for mirror in MIRRORS:
            print(f"query#{qi} -> {mirror.split('/')[2]} ...", flush=True)
            t0 = time.time()
            try:
                r = httpx.post(mirror, data={"data": query}, headers=UA, timeout=150)
            except httpx.HTTPError as e:
                print(f"   network fail after {time.time()-t0:.0f}s: {type(e).__name__}")
                continue
            print(f"   HTTP {r.status_code} in {time.time()-t0:.0f}s", flush=True)
            if r.status_code != 200:
                continue
            try:
                elements = r.json().get("elements", [])
            except ValueError:
                print("   non-JSON body")
                continue
            out, seen = [], set()
            for el in elements:
                tags = el.get("tags", {})
                name = tags.get("name")
                lat = el.get("lat") or el.get("center", {}).get("lat")
                lng = el.get("lon") or el.get("center", {}).get("lon")
                if not name or lat is None or lng is None:
                    continue
                kind = (
                    tags.get("amenity")
                    or tags.get("shop")
                    or tags.get("tourism")
                    or tags.get("leisure")
                    or tags.get("office")
                    or tags.get("landuse")
                    or "place"
                )
                k = f"{name}|{round(lat, 5)}|{round(lng, 5)}"
                if k in seen:
                    continue
                seen.add(k)
                out.append({
                    "name": name,
                    "detail": kind.replace("_", " ").title(),  # municipality fixed by enrich_localpois.py
                    "lat": round(lat, 6),
                    "lng": round(lng, 6),
                    "type": kind,
                })
            if out:
                return out
            print("   empty result set")
    return None


def main() -> int:
    data = try_fetch()
    if not data:
        print("ALL SOURCES FAILED")
        return 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"SAVED {len(data)} places -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
