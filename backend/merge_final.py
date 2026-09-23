"""Smart merge of all local place sources into ONE final dataset.

Sources (priority high -> low):
  1. foursquare_gt.json   — curated business DB
  2. overture_gt.json     — Meta/Foursquare/Microsoft merged, confidence-scored
  3. localpois.json       — OpenStreetMap snapshot

Merge rules (location-aware — multiple branches of the same brand at
DIFFERENT spots all survive; the same place from 3 datasets collapses):
  - normalized + de-accented name
  - merge when:  distance < 80 m  AND (name similarity >= 0.55 OR share a
                 significant token)
            or: distance < 150 m AND name similarity >= 0.8
  - base record = highest priority; fills gaps (category/address/confidence)
    from the others; provenance recorded in `sources`.

Output: data/places_final.json  (this is what the backend serves)
"""
import json
import math
import os
import re
import unicodedata
from difflib import SequenceMatcher

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(DATA, "places_final.json")

SOURCES = [
    ("foursquare_gt.json", "fsq", 0),
    ("overture_gt.json", "ov", 1),
    ("localpois.json", "osm", 2),
]

STOPWORDS = {"the", "and", "of", "sa", "ng", "de", "la"}

# Large/geographic features get a much wider merge radius: sources pin the
# same park/river/resort anywhere across its area.
GEO_WORDS = re.compile(
    r"\b(park|river|forest|mount|mountain|falls|waterfall|lake|cave|spring|"
    r"resort|farm|bridge|dam|plaza|cemetery|memorial)\b",
    re.I,
)
GEO_CATS = {
    "national_park", "park", "river", "mountain", "forest", "lake", "water",
    "nature_reserve", "campground", "golf_course",
}


def is_geo(r: dict) -> bool:
    return (r.get("category") or "") in GEO_CATS or bool(GEO_WORDS.search(r["name"]))


# --- Canonical names + verified pins -----------------------------------------
# Some sources geocode the same famous place to wildly different pins (bad
# locality centroids). These name variants are THE SAME place: canonicalize
# before merging (distance-independent) and snap to a verified coordinate,
# so the entry users get has the correct pin.
#
# Deliberately NOT canonicalized (real, distinct venues at the park):
#   Minalungao Zipline / Picnic and Adventure Grounds / Canaria River side /
#   Jonah's Transient / Hostel-KTV-Restaurant / Lanie's Restaurant
NAME_CANON = {
    "minalungao": "minalungao national park",
    "minalungao nueva ecija": "minalungao national park",
    "minalungao national park, general tinio, nueva ecija": "minalungao national park",
    "minalungao national park": "minalungao national park",
}
PIN_OVERRIDES = {
    "minalungao national park": (15.29893, 121.12291),  # verified via OSM/Nominatim
}


def canonical(normed: str) -> str:
    return NAME_CANON.get(normed, normed)


def norm_name(n: str) -> str:
    n = unicodedata.normalize("NFKD", n or "")
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = n.lower().replace("\u2019", "'").replace("&", " and ")
    n = re.sub(r"\b(inc|corp|co|store|shop|branch)\b\.?", " ", n)
    n = re.sub(r"[^a-z0-9' ]+", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def tokens(n: str) -> set:
    return {t for t in norm_name(n).split() if t and t not in STOPWORDS}


def sim(a: str, b: str) -> float:
    return SequenceMatcher(None, norm_name(a), norm_name(b)).ratio()


def meters(a: dict, b: dict) -> float:
    return math.hypot((a["lat"] - b["lat"]) * 111_000, (a["lng"] - b["lng"]) * 107_000)


def should_merge(a: dict, b: dict) -> bool:
    d = meters(a, b)
    s = sim(a["name"], b["name"])
    shared = tokens(a["name"]) & tokens(b["name"])

    # Canonicalized (same famous place, bad pins from some sources) —
    # merge regardless of distance.
    ca, cb = canonical(norm_name(a["name"])), canonical(norm_name(b["name"]))
    if ca in PIN_OVERRIDES and ca == cb:
        return True

    # Geographic features: same or subset name anywhere in the municipality.
    # NOT plain token-sharing — a shared prefix ("Minalungao Zipline" vs
    # "Minalungao National Park") must stay separate: they're different venues.
    if (is_geo(a) or is_geo(b)) and d < 12_000:
        ta, tb = tokens(a["name"]), tokens(b["name"])
        if s >= 0.8 or ta <= tb or tb <= ta:
            return True

    if d >= 150:
        return False
    if len(shared) >= 2:  # two significant shared tokens + close = same place
        return True
    if d < 80 and (s >= 0.55 or shared):
        return True
    return s >= 0.8


def main() -> None:
    records = []
    for fname, tag, prio in SOURCES:
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            continue
        for p in json.load(open(path, encoding="utf-8")):
            records.append({
                "name": p["name"].strip(),
                "lat": p["lat"],
                "lng": p["lng"],
                "category": (p.get("type") or "place"),
                "detail_hint": p.get("detail", ""),
                "address": p.get("address"),
                "confidence": p.get("confidence"),
                "prio": prio,
                "sources": [tag],
            })

    records.sort(key=lambda r: (r["prio"], -(r["confidence"] or 0)))

    merged: list[dict] = []
    for r in records:
        hit = None
        for m in merged:
            if should_merge(r, m):
                hit = m
                break
        if hit is None:
            merged.append(r)
        else:
            hit["sources"].append(r["sources"][0])
            if not hit.get("address") and r.get("address"):
                hit["address"] = r["address"]
            if r.get("confidence") and (hit.get("confidence") or 0) < r["confidence"]:
                hit["confidence"] = r["confidence"]
            # prefer a specific category over the generic "place"
            if (hit.get("category") in (None, "place")) and r.get("category") not in (None, "place"):
                hit["category"] = r["category"]

    out = []
    for m in merged:
        kind = (m["category"] or "place").replace("_", " ").title()
        lat, lng = m["lat"], m["lng"]
        # snap verified pins
        cname = canonical(norm_name(m["name"]))
        if cname in PIN_OVERRIDES:
            lat, lng = PIN_OVERRIDES[cname]
        entry = {
            "name": m["name"],
            "detail": f"{kind} · General Tinio",
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "type": m["category"] or "place",
            "sources": "+".join(sorted(set(m["sources"]))),
        }
        if m.get("confidence") is not None:
            entry["confidence"] = round(m["confidence"], 2)
        if m.get("address"):
            entry["address"] = m["address"]
        out.append(entry)

    out.sort(key=lambda p: p["name"].lower())
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    total_in = len(records)
    multi = [m for m in merged if len(set(m["sources"])) > 1]
    print(f"input records: {total_in}  ->  final places: {len(out)}")
    print(f"cross-source merges: {len(multi)}")
    print("\nsample merged groups:")
    for m in multi[:12]:
        print(f"  {m['name']}  [{'+'.join(sorted(set(m['sources'])))}]")


if __name__ == "__main__":
    main()
