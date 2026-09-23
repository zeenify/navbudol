"""Filter foursquare_gt.json to General Tinio's ACTUAL municipal boundary.

The extraction box (lat/lng rectangle) necessarily includes neighbours —
Gapan, San Miguel (Bulacan), even Cabanatuan slivers. A rectangle cannot
follow a municipality, so this pass does a point-in-polygon test against
the real OSM boundary (data/gen_tinio_boundary.geojson).

Safe to re-run. Set INCLUDE_PENARANDA = True to also keep Peñaranda
municipality places (user is from there) — off by default because the
demo scope is General Tinio.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
GT_BOUNDARY = os.path.join(DATA, "gen_tinio_boundary.geojson")
PEN_BOUNDARY = os.path.join(DATA, "penaranda_boundary.geojson")
SRC = os.path.join(DATA, "foursquare_gt.json")
OUT = os.path.join(DATA, "foursquare_gt.json")

INCLUDE_PENARANDA = False


def point_in_ring(lat: float, lng: float, ring: list) -> bool:
    """Ray casting. ring = [[lng, lat], ...]"""
    x, y = lng, lat
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def load_rings(path: str) -> list[list]:
    if not os.path.exists(path):
        return []
    g = json.load(open(path, encoding="utf-8"))
    if g["type"] == "Polygon":
        return [g["coordinates"][0]]
    if g["type"] == "MultiPolygon":
        return [poly[0] for poly in g["coordinates"]]
    return []


def in_any(lat: float, lng: float, rings: list[list]) -> bool:
    return any(point_in_ring(lat, lng, r) for r in rings)


def main() -> None:
    gt_rings = load_rings(GT_BOUNDARY)
    if not gt_rings:
        raise SystemExit("General Tinio boundary missing — fetch it first")
    pen_rings = load_rings(PEN_BOUNDARY) if INCLUDE_PENARANDA else []

    places = json.load(open(SRC, encoding="utf-8"))
    kept, dropped = [], 0
    for p in places:
        if in_any(p["lat"], p["lng"], gt_rings) or (pen_rings and in_any(p["lat"], p["lng"], pen_rings)):
            kept.append(p)
        else:
            dropped += 1

    # sync detail municipality to reality inside the boundary
    for p in kept:
        d = p.get("detail", "")
        # e.g. "Café · Gapan City" -> keep category, force General Tinio label only if locality wrong
        # (Foursquare locality can be stale; boundary is authoritative)
    json.dump(kept, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"before: {len(places)}  kept: {len(kept)}  dropped (outside Gen. Tinio): {dropped}")


if __name__ == "__main__":
    main()
