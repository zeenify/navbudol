"""Miss-check: with the PH-wide sweep (data/fsq_ph_wide.json), verify how
many General Tinio places exist in Foursquare and whether any were missed
by the coordinate-only boundary filter.

Method:
  A. Count places whose pin is INSIDE Gen. Tinio's boundary polygon.
  B. Count places whose TEXT (name/address/locality/post_town) mentions
     "General Tinio" or "Papaya" but whose pin is OUTSIDE — these are
     mis-geocoded entries that the boundary filter alone would drop.
  C. Report permanently-closed entries separately (date_closed).

Output is a console report; the final dataset update is a separate step.
"""
import json
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

GT_CENTER = (15.3519, 121.0633)
GT_RE = re.compile(r"\bgeneral\s*tinio\b", re.I)
PAPAYA_RE = re.compile(r"\bpapaya\b", re.I)


def load_rings(path: str) -> list[list]:
    if not os.path.exists(path):
        return []
    g = json.load(open(path, encoding="utf-8"))
    if g["type"] == "Polygon":
        return [g["coordinates"][0]]
    if g["type"] == "MultiPolygon":
        return [poly[0] for poly in g["coordinates"]]
    return []


def point_in_ring(lat: float, lng: float, ring: list) -> bool:
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


def km_from_gt(lat: float, lng: float) -> float:
    return math.hypot((lat - GT_CENTER[0]) * 111, (lng - GT_CENTER[1]) * 107)


def main() -> None:
    wide = json.load(open(os.path.join(DATA, "fsq_ph_wide.json"), encoding="utf-8"))
    rect = json.load(open(os.path.join(DATA, "foursquare_gt.json"), encoding="utf-8"))
    gt_rings = load_rings(os.path.join(DATA, "gen_tinio_boundary.geojson"))

    def inside_gt(p) -> bool:
        return any(point_in_ring(p["lat"], p["lng"], r) for r in gt_rings)

    in_gt = [p for p in wide if inside_gt(p)]
    print(f"A. pins INSIDE Gen. Tinio boundary (PH-wide sweep): {len(in_gt)}")
    print(f"   current dataset (rect filter on small box):      {len(rect)}")

    # text mentions outside the boundary
    gt_mentions, papaya_near, papaya_far = [], [], []
    for p in wide:
        if inside_gt(p):
            continue
        text = f"{p.get('name','')} {p.get('detail','')}"
        d = km_from_gt(p["lat"], p["lng"])
        if GT_RE.search(text):
            gt_mentions.append((p, d))
        elif PAPAYA_RE.search(text):
            (papaya_near if d < 30 else papaya_far).append((p, d))

    print(f"\nB. text says 'General Tinio' but pin OUTSIDE: {len(gt_mentions)}")
    for p, d in sorted(gt_mentions, key=lambda t: t[1])[:20]:
        print(f"   [{d:5.1f} km] {p['name']} | {p['detail']}")

    print(f"\nC. text says 'Papaya' but pin outside, within 30 km: {len(papaya_near)}")
    for p, d in sorted(papaya_near, key=lambda t: t[1])[:12]:
        print(f"   [{d:5.1f} km] {p['name']} | {p['detail']}")

    print(f"\nD. 'Papaya' far away (other Papayas — correctly excluded): {len(papaya_far)}")


if __name__ == "__main__":
    main()
