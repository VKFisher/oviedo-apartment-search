"""Fetch every OSM feature the factors need, with geometry, into data/raw/osm.json.

One Overpass call; re-run to refresh. Selectors are listed once here so the
factor code in build.py can filter by tag without knowing about Overpass.
"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import BBOX, RAW_DIR

SELECTORS = [
    # parks & play
    "leisure=park", "leisure=garden", "leisure=playground",
    # shopping
    "shop=mall", "shop=supermarket",
    # health
    "amenity=hospital", "amenity=clinic", "amenity=doctors", "healthcare=hospital", "healthcare=centre",
    # transport
    "highway=bus_stop", "amenity=bus_station", "railway=station", "railway=halt",
    # negatives: industry, big roads, rail lines
    "landuse=industrial", "highway=motorway", "highway=motorway_link", "highway=trunk",
    "highway=trunk_link", "highway=primary", "railway=rail",
    # childcare
    "amenity=kindergarten",
    # boundaries for rent / dossier lookup
    'boundary=administrative', "place=suburb", "place=neighbourhood",
]

QUERY = """[out:json][timeout:180][bbox:{south},{west},{north},{east}];
(
{body}
);
out geom;
"""


def main():
    body = "\n".join(f"  nwr[{s}];" for s in SELECTORS)
    q = QUERY.format(body=body, **BBOX)
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter", data=q.encode(), headers={"User-Agent": "oviedo-apartment-search"}
    )
    with urllib.request.urlopen(req, timeout=240) as r:
        data = json.load(r)
    os.makedirs(RAW_DIR, exist_ok=True)
    out = os.path.join(RAW_DIR, "osm.json")
    with open(out, "w") as f:
        json.dump(data, f)
    print(f"{len(data['elements'])} elements -> {out}")


if __name__ == "__main__":
    main()
