"""Clip the national MITECO shapefiles to the box and save small GeoJSONs in data/clipped/.

Inputs (extracted from the MITECO zips, all ETRS89 / UTM 30N):
  Q100_2Ciclo_PB_*.shp, Q500_2Ciclo_PB_*.shp              flood zones, T=100 / T=500 years
  CDERUI02_Lden_RepGeo_LocalId_Ag.shp                     strategic noise map, Lden bands
  CDERUI03_Ln_RepGeo_LocalId_Ag.shp                       strategic noise map, Ln (night) bands
Usage: uv run python pipeline/clip_shapefiles.py <dir with the .shp/.dbf files>
The outputs are committed; the multi-GB inputs are not.
"""
import glob
import json
import os
import sys

import shapefile
import shapely
from shapely.geometry import Polygon, box, shape

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import BBOX  # noqa: E402
from osm import TO_DEG, TO_M  # noqa: E402

OUT_DIR = "data/clipped"
NOISE_AGGLOMERATION = "Ag_AST_Oviedo"


def box_m():
    xs, ys = TO_M.transform([BBOX["west"], BBOX["east"], BBOX["west"], BBOX["east"]], [BBOX["south"], BBOX["south"], BBOX["north"], BBOX["north"]])
    return box(min(xs), min(ys), max(xs), max(ys))


def to_deg(geom):
    return shapely.transform(geom, lambda c: __import__("numpy").column_stack(TO_DEG.transform(c[:, 0], c[:, 1])))


def write(name, features):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    with open(path, "w") as f:
        json.dump(dict(type="FeatureCollection", features=features), f, separators=(",", ":"))
    print(f"  {len(features)} features -> {path} ({os.path.getsize(path) // 1024} KB)")


def feature(geom, props):
    return dict(type="Feature", properties=props, geometry=json.loads(shapely.to_geojson(to_deg(shapely.simplify(geom, 5)))))


def clip_flood(src, clip, out_name):
    r = shapefile.Reader(src, encoding="utf-8", encodingErrors="replace")
    feats = []
    for sr in r.iterShapeRecords(bbox=clip.bounds):
        g = shape(sr.shape.__geo_interface__).buffer(0).intersection(clip)
        if not g.is_empty:
            feats.append(feature(g, dict(zona=sr.record["ZONA"], rio=sr.record["RIO"])))
    write(out_name, feats)


def clip_noise(src, clip, field, out_name):
    """The MER layers are isophone contours (closed rings). A point is inside band X when it lies
    inside an odd number of X-rings; XOR-ing the rings gives that region as a polygon."""
    r = shapefile.Reader(src, encoding="utf-8", encodingErrors="replace")
    feats = []
    for i, rec in enumerate(r.iterRecords()):
        if rec["AGL_AglomI"].strip() != NOISE_AGGLOMERATION or rec["Tipo_Emiso"].strip() != "Total":
            continue
        s = r.shape(i)
        parts = list(s.parts) + [len(s.points)]
        region = None
        for a, b in zip(parts[:-1], parts[1:]):
            ring = Polygon(s.points[a:b])
            ring = ring if ring.is_valid else ring.buffer(0)
            region = ring if region is None else region.symmetric_difference(ring)
        g = region.intersection(clip)
        if not g.is_empty:
            feats.append(feature(g, dict(db=int(rec[field]))))
    feats.sort(key=lambda f: f["properties"]["db"])
    write(out_name, feats)


def main(src_dir):
    clip = box_m()
    one = lambda pat: glob.glob(os.path.join(src_dir, pat))[0]  # noqa: E731
    print("flood T100");  clip_flood(one("Q100_*.shp"), clip, "flood_q100.geojson")
    print("flood T500");  clip_flood(one("Q500_*.shp"), clip, "flood_q500.geojson")
    print("noise Lden");  clip_noise(one("CDERUI02_Lden_*.shp"), clip, "Lden", "noise_lden.geojson")
    print("noise Ln");    clip_noise(one("CDERUI03_Ln_*.shp"), clip, "Ln", "noise_ln.geojson")


if __name__ == "__main__":
    main(sys.argv[1])
