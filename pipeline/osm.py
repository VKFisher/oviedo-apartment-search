"""Turn the raw Overpass dump into projected shapely geometries.

Everything downstream works in metres (ETRS89 / UTM 30N, EPSG:25830).
"""
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

TO_M = Transformer.from_crs("EPSG:4326", "EPSG:25830", always_xy=True)
TO_DEG = Transformer.from_crs("EPSG:25830", "EPSG:4326", always_xy=True)

# A closed way with one of these keys is an area, not a ring-shaped line.
AREA_KEYS = {"leisure", "landuse", "shop", "amenity", "healthcare", "building", "boundary"}


def _xy(points):
    xs, ys = TO_M.transform([p["lon"] for p in points], [p["lat"] for p in points])
    return list(zip(xs, ys))


def geometry(el):
    """Projected geometry for one Overpass element (with `out geom`), or None."""
    t = el["type"]
    tags = el.get("tags", {})
    if t == "node":
        return Point(*TO_M.transform(el["lon"], el["lat"]))
    if t == "way":
        g = el.get("geometry")
        if not g or len(g) < 2:
            return None
        xy = _xy(g)
        closed = g[0] == g[-1] and len(xy) >= 4
        if closed and (AREA_KEYS & tags.keys()) and tags.get("area") != "no" and "highway" not in tags:
            return Polygon(xy)
        return LineString(xy)
    if t == "relation":
        outers, inners = [], []
        for m in el.get("members", []):
            if m["type"] != "way" or "geometry" not in m or len(m["geometry"]) < 2:
                continue
            (inners if m.get("role") == "inner" else outers).append(LineString(_xy(m["geometry"])))
        if not outers:
            return None
        polys = list(polygonize(unary_union(outers)))
        if not polys:
            return None
        geom = unary_union(polys)
        holes = list(polygonize(unary_union(inners))) if inners else []
        return geom.difference(unary_union(holes)) if holes else geom
    return None
