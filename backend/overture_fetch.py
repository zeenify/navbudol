"""Extract Overture Maps places (Meta + Microsoft + Foursquare merged) for
General Tinio — public S3, no account/token needed.

Overture adds what neither OSM nor Foursquare alone has, especially Meta's
Facebook-Page businesses (sari-sari stores, salons, water stations) that
dominate PH rural commerce.

  duckdb reads the bbox predicate remotely (S3 public bucket), then a local
  point-in-polygon pass keeps only places inside Gen. Tinio's boundary.
"""
import json
import os
import sys

import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(DATA, "overture_gt.json")
BOUNDARY = os.path.join(DATA, "gen_tinio_boundary.geojson")

RELEASE = "2026-08-19.0"
SRC = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*.parquet"

BOX = (15.15, 15.55, 120.90, 121.25)  # generous bbox, polygon filters after


def load_ring() -> list:
    g = json.load(open(BOUNDARY, encoding="utf-8"))
    return g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]


def inside(lat: float, lng: float, ring: list) -> bool:
    x, y = lng, lat
    ins = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            ins = not ins
        j = i
    return ins


def main() -> int:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")

    lat0, lat1, lng0, lng1 = BOX
    rows = con.execute(f"""
        SELECT
          names.primary AS name,
          categories.primary AS category,
          confidence,
          (bbox.xmin + bbox.xmax) / 2 AS lng,
          (bbox.ymin + bbox.ymax) / 2 AS lat,
          list_transform(addresses, a -> a.freeform)[1] AS address,
          list_transform(sources, s -> s.dataset) AS datasets
        FROM read_parquet('{SRC}')
        WHERE bbox.xmin < {lng1} AND bbox.xmax > {lng0}
          AND bbox.ymin < {lat1} AND bbox.ymax > {lat0}
          AND names.primary IS NOT NULL
    """).fetchall()
    print(f"overture rows in bbox: {len(rows)}")

    ring = load_ring()
    out, seen = [], set()
    for name, category, conf, lng, lat, address, datasets in rows:
        if lat is None or lng is None or not inside(lat, lng, ring):
            continue
        key = f"{name.strip().lower()}|{round(lat, 3)}|{round(lng, 3)}"
        if key in seen:
            continue
        seen.add(key)
        kind = (category or "place").replace("_", " ").title()
        who = (datasets or ["overture"])[0]
        out.append({
            "name": name.strip(),
            "detail": f"{kind} · General Tinio",
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "type": category or "place",
            "source": f"overture/{who}",
            **({"address": address} if address else {}),
            **({"confidence": round(conf, 2)} if conf is not None else {}),
        })

    out.sort(key=lambda p: -(p.get("confidence") or 0))
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"SAVED {len(out)} places inside General Tinio -> {OUT}")
    from collections import Counter

    print("by source:", Counter(p["source"] for p in out).most_common())
    return 0


if __name__ == "__main__":
    sys.exit(main())
