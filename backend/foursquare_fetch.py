"""Extract Foursquare Open Source Places for the General Tinio area.

The dataset (100M+ POIs, NOT derived from OpenStreetMap — it adds the
business/restaurant/store coverage OSM lacks in PH) is distributed as 100
global Parquet shards (~11.5 GB) on the gated Hugging Face mirror.

Pipeline:
  1. For every shard, fetch ONLY the Parquet footer and read row-group
     latitude/longitude min-max statistics.
  2. Keep only row groups whose bbox intersects the widest area box.
  3. Download just those row groups' needed columns, filter precisely.
  4. THEN run filter_foursquare_boundary.py — the bbox is necessarily wider
     than the municipality (a rectangle cannot follow a boundary); that
     script keeps only places inside General Tinio's real OSM polygon.
  5. Exclude permanently-closed places (date_closed set).

Auth: needs a Hugging Face READ token with access to
https://huggingface.co/datasets/foursquare/fsq-os-places
Set HF_TOKEN in backend/.env (or the environment).
"""
import json
import os
import sys
import time

import fsspec
import pyarrow.compute as pc
import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("FSQ_OUT", os.path.join(HERE, "data", "foursquare_gt.json"))

# Boxes: 'gt' = tight demo area, 'ph' = whole Philippines (for the
# miss-check sweep — row groups are geographically clustered so PH-wide
# costs only a few hundred MB).
_BOXES = {
    "gt": (15.18, 15.55, 120.90, 121.22),
    "ph": (4.5, 21.5, 115.5, 127.5),
}
LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX = _BOXES[os.environ.get("FSQ_BOX", "gt")]

RELEASE = "release/dt=2026-09-15"
BASE = (
    "https://huggingface.co/datasets/foursquare/fsq-os-places/resolve/main/"
    f"{RELEASE}/places/parquet"
)
SHARDS = [f"{BASE}/places_{i:06d}.parquet" for i in range(100)]

WANTED_COLS = ["name", "latitude", "longitude", "address", "locality", "region", "fsq_category_labels", "date_closed"]


def token() -> str:
    t = os.environ.get("HF_TOKEN", "").strip()
    if not t:
        env_path = os.path.join(HERE, ".env")
        if os.path.exists(env_path):
            for line in open(env_path, encoding="utf-8"):
                if line.startswith("HF_TOKEN="):
                    t = line.split("=", 1)[1].strip()
                    break
    if not t:
        raise SystemExit("HF_TOKEN not set (backend/.env or environment)")
    return t


def main() -> int:
    fs = fsspec.filesystem("http", client_kwargs={"headers": {"Authorization": f"Bearer {token()}"}})

    rows = []  # collected POIs
    total_groups = 0
    selected_groups = 0

    for i, shard in enumerate(SHARDS):
        try:
            with fs.open(shard, "rb") as f:
                pf = pq.ParquetFile(f)
                meta = pf.metadata
                # top-level names (metadata leaf names repeat struct children
                # like 'element' and would hide fsq_category_labels)
                cols = list(pf.schema_arrow.names)
                if "latitude" not in cols or "longitude" not in cols:
                    continue
                li, gi = cols.index("latitude"), cols.index("longitude")

                picks = []
                for g in range(meta.num_row_groups):
                    total_groups += 1
                    rg = meta.row_group(g)
                    lat_st, lng_st = rg.column(li).statistics, rg.column(gi).statistics
                    if not lat_st or not lng_st or not lat_st.has_min_max or not lng_st.has_min_max:
                        picks.append(g)  # no stats — must read to be safe
                        continue
                    if (lat_st.max >= LAT_MIN and lat_st.min <= LAT_MAX and
                            lng_st.max >= LNG_MIN and lng_st.min <= LNG_MAX):
                        picks.append(g)

                if not picks:
                    print(f"[{i:3d}] no overlap")
                    continue
                selected_groups += len(picks)
                use_cols = [c for c in WANTED_COLS if c in cols]
                tbl = pf.read_row_groups(picks, columns=use_cols)
                mask = pc.and_(
                    pc.and_(pc.greater_equal(tbl["latitude"], LAT_MIN), pc.less_equal(tbl["latitude"], LAT_MAX)),
                    pc.and_(pc.greater_equal(tbl["longitude"], LNG_MIN), pc.less_equal(tbl["longitude"], LNG_MAX)),
                )
                tbl = tbl.filter(mask)
                if tbl.num_rows:
                    for r in tbl.to_pylist():
                        if r.get("date_closed"):  # permanently closed business
                            continue
                        cats = r.get("fsq_category_labels") or []
                        kind = (cats[0].split(" > ")[-1] if cats else "place").lower()
                        rows.append({
                            "name": r.get("name"),
                            "detail": f"{kind.title()} · {r.get('locality') or 'nearby'}",
                            "lat": round(float(r["latitude"]), 6),
                            "lng": round(float(r["longitude"]), 6),
                            "type": kind,
                            "source": "foursquare",
                        })
                print(f"[{i:3d}] groups {len(picks):3d} rows {tbl.num_rows}")
                time.sleep(0.2)
        except Exception as e:  # noqa: BLE001
            print(f"[{i:3d}] FAILED: {type(e).__name__}: {e}")

    # dedupe by name + rounded coords
    seen, out = set(), []
    for p in rows:
        k = f"{p['name']}|{p['lat']:.4f}|{p['lng']:.4f}"
        if k in seen:
            continue
        seen.add(k)
        out.append(p)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\nrow groups scanned {total_groups}, downloaded {selected_groups}")
    print(f"SAVED {len(out)} Foursquare places -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
