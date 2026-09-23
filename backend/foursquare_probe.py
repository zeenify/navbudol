"""Dry-run probe: price a wider extraction WITHOUT downloading data.

Reads only Parquet footers (metadata) of all 100 shards and reports, per
box: how many row groups overlap + estimated compressed download size.
Run before foursquare_fetch to decide the sweep size.
"""
import json
import os
import sys

import fsspec
import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))

BOXES = {
    "nueva_ecija": (14.95, 16.15, 120.55, 121.85),
    "luzon": (12.4, 18.7, 119.7, 124.4),
}

RELEASE = "release/dt=2026-09-15"
BASE = (
    "https://huggingface.co/datasets/foursquare/fsq-os-places/resolve/main/"
    f"{RELEASE}/places/parquet"
)
SHARDS = [f"{BASE}/places_{i:06d}.parquet" for i in range(100)]


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
        raise SystemExit("HF_TOKEN not set")
    return t


def main() -> int:
    fs = fsspec.filesystem("http", client_kwargs={"headers": {"Authorization": f"Bearer {token()}"}})
    stats = {name: {"groups": 0, "bytes": 0, "shards": 0} for name in BOXES}

    for i, shard in enumerate(SHARDS):
        try:
            with fs.open(shard, "rb") as f:
                pf = pq.ParquetFile(f)
                meta = pf.metadata
                cols = list(pf.schema_arrow.names)
                li, gi = cols.index("latitude"), cols.index("longitude")
                for name, (la0, la1, ln0, ln1) in BOXES.items():
                    picked_b = 0
                    picked_n = 0
                    for g in range(meta.num_row_groups):
                        rg = meta.row_group(g)
                        lat_st, lng_st = rg.column(li).statistics, rg.column(gi).statistics
                        if not lat_st or not lng_st or not lat_st.has_min_max:
                            picked_n += 1
                            picked_b += rg.total_byte_size
                            continue
                        if (lat_st.max >= la0 and lat_st.min <= la1 and
                                lng_st.max >= ln0 and lng_st.min <= ln1):
                            picked_n += 1
                            picked_b += rg.total_byte_size
                    if picked_n:
                        stats[name]["groups"] += picked_n
                        stats[name]["bytes"] += picked_b
                        stats[name]["shards"] += 1
        except Exception as e:  # noqa: BLE001
            print(f"[{i:3d}] ERR {type(e).__name__}", flush=True)

    print(json.dumps({k: {**v, "MB": round(v["bytes"] / 1e6, 1)} for k, v in stats.items()}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
