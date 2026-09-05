"""Build the per-cell factor grids and support files for the web app.

Reads data/raw (OSM dump, SRTM tile, optional flood/noise shapefiles) and
data/manual (rent table, dossier scores); writes web/data/{grid,pois}.json
and web/data/areas.geojson.

Each factor is stored as its raw measurement per cell (metres to nearest X,
slope %, EUR/m2 ...). Turning raw values into 0..1 scores happens in the
browser so the decay radius can be a slider.
"""
import json
import math
import os
import re
import shutil
import sys
import time

import numpy as np
import shapely
from scipy import ndimage
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import BBOX, CELL_M, CLIPPED_DIR, DEM_FILE, HOSPITALS, MANUAL_DIR, PARK_AREA_STEPS_HA, RAW_DIR, WEB_DATA_DIR  # noqa: E402
from osm import TO_DEG, TO_M, geometry  # noqa: E402

os.chdir(ROOT)


# ----------------------------------------------------------------- categories
def is_health_centre(t):
    return (t.get("amenity") in ("clinic", "doctors") or t.get("healthcare") in ("centre", "clinic", "doctor")) and re.search(
        r"centro de salud|consultorio|ambulatorio", t.get("name", ""), re.I
    )


CATEGORIES = {
    # name: (predicate on tags, geometry kinds kept)
    "park": lambda t: t.get("leisure") == "park",
    "playground": lambda t: t.get("leisure") == "playground",
    "mall": lambda t: t.get("shop") == "mall",
    "supermarket": lambda t: t.get("shop") == "supermarket",
    "health_centre": is_health_centre,
    "hospital": lambda t: t.get("name") in HOSPITALS,
    "bus": lambda t: t.get("highway") == "bus_stop" or t.get("amenity") == "bus_station",
    "rail": lambda t: t.get("railway") in ("station", "halt"),
    "kindergarten": lambda t: t.get("amenity") == "kindergarten",
    "industrial": lambda t: t.get("landuse") == "industrial",
    "big_road": lambda t: t.get("highway") in ("motorway", "motorway_link", "trunk", "trunk_link", "primary"),
    "railway": lambda t: t.get("railway") == "rail",
}


def load_osm():
    with open(os.path.join(RAW_DIR, "osm.json")) as f:
        elements = json.load(f)["elements"]
    cats = {k: [] for k in CATEGORIES}  # name -> [(geom, tags)]
    admin = {}  # level -> [(name, geom)]
    for el in elements:
        tags = el.get("tags", {})
        g = geometry(el)
        if g is None or g.is_empty:
            continue
        if tags.get("boundary") == "administrative" and tags.get("admin_level") in ("8", "9", "10") and "name" in tags:
            admin.setdefault(tags["admin_level"], []).append((tags["name"], g))
            continue
        for name, pred in CATEGORIES.items():
            if pred(tags):
                cats[name].append((g, tags))
    cats["park"] = park_components([(g, t) for g, t in cats["park"] if g.geom_type in ("Polygon", "MultiPolygon")])
    return cats, admin


def park_components(parks):
    """Merge touching park polygons into one park each; tags carry the name and area in ha."""
    merged = shapely.unary_union([g for g, _ in parks])
    out = []
    for comp in getattr(merged, "geoms", [merged]):
        inside = [(g.area, t.get("name", "")) for g, t in parks if t.get("name") and comp.intersects(g)]
        name = max(inside)[1] if inside else ""
        out.append((comp, {"name": name, "area_ha": round(comp.area / 1e4, 1)}))
    return out


# ----------------------------------------------------------------------- grid
def make_grid():
    s, w, n, e = BBOX["south"], BBOX["west"], BBOX["north"], BBOX["east"]
    lat0 = (s + n) / 2
    dlat = CELL_M / 111320
    dlon = CELL_M / (111320 * math.cos(math.radians(lat0)))
    ny, nx = round((n - s) / dlat), round((e - w) / dlon)
    lats = n - (np.arange(ny) + 0.5) * dlat  # row 0 = north (image order)
    lons = w + (np.arange(nx) + 0.5) * dlon
    LON, LAT = np.meshgrid(lons, lats)
    X, Y = TO_M.transform(LON.ravel(), LAT.ravel())
    return dict(
        ny=ny, nx=nx, LON=LON, LAT=LAT, pts=shapely.points(X, Y),
        bounds=dict(south=n - ny * dlat, west=w, north=n, east=w + nx * dlon),
    )


def nearest_distance(pts, geoms):
    if not geoms:
        return np.full(len(pts), np.nan)
    idx, dist = STRtree(geoms).query_nearest(pts, return_distance=True, all_matches=False)
    out = np.full(len(pts), np.nan)
    out[idx[0]] = dist
    return out


def containing(pts, named_polys):
    """Index into named_polys of the polygon containing each point (-1 if none)."""
    out = np.full(len(pts), -1)
    if not named_polys:
        return out
    idx = STRtree([g for _, g in named_polys]).query(pts, predicate="within")
    out[idx[0]] = idx[1]  # later matches overwrite earlier ones; polygons should not overlap
    return out


# ------------------------------------------------------------------ elevation
def read_asc(path):
    """ESRI ASCII grid -> (array[row 0 = north], xll, yll, cellsize_deg, nodata)."""
    with open(path) as f:
        hdr = {}
        while True:
            pos = f.tell()
            parts = f.readline().split()
            if len(parts) != 2 or not parts[0][0].isalpha():
                f.seek(pos)
                break
            hdr[parts[0].lower()] = float(parts[1])
        a = np.loadtxt(f)
    assert a.shape == (int(hdr["nrows"]), int(hdr["ncols"])), a.shape
    return a, hdr["xllcorner"], hdr["yllcorner"], hdr["cellsize"], hdr.get("nodata_value", -9999)


def slope_and_elevation(grid):
    a, xll, yll, cs, nodata = read_asc(os.path.join(RAW_DIR, DEM_FILE))
    a = np.where(a == nodata, np.nan, a)
    if np.isnan(a).any():
        a = np.where(np.isnan(a), np.nanmedian(a), a)
    lat_mid = yll + cs * a.shape[0] / 2
    m_per_row = cs * 111320
    m_per_col = cs * 111320 * math.cos(math.radians(lat_mid))
    gy, gx = np.gradient(a, m_per_row, m_per_col)
    slope = 100 * np.hypot(gx, gy)  # percent
    # ~200 m neighbourhood mean: "how hilly is the walk around here", not the gradient under one house.
    slope = ndimage.uniform_filter(slope, size=(max(1, round(200 / m_per_row)), max(1, round(200 / m_per_col))))
    top = yll + cs * a.shape[0]
    rows, cols = (top - grid["LAT"]).ravel() / cs - 0.5, (grid["LON"] - xll).ravel() / cs - 0.5
    return (
        ndimage.map_coordinates(slope, [rows, cols], order=1, mode="nearest"),
        ndimage.map_coordinates(a, [rows, cols], order=1, mode="nearest"),
    )


# ----------------------------------------------------------------------- rent
def rent_lookup(grid, admin):
    with open(os.path.join(MANUAL_DIR, "rent.json")) as f:
        table = json.load(f)
    by_barrio = {}
    for d in table["districts"]:
        for b in d["barrios"]:
            by_barrio[b] = (d["name"], d["rent"])
    l10, l9, l8 = admin.get("10", []), admin.get("9", []), admin.get("8", [])
    i10, i9, i8 = containing(grid["pts"], l10), containing(grid["pts"], l9), containing(grid["pts"], l8)
    n = len(grid["pts"])
    rent = np.full(n, np.nan)
    area = np.full(n, -1)  # index into `names`
    names = []
    name_idx = {}

    def key(label):
        if label not in name_idx:
            name_idx[label] = len(names)
            names.append(label)
        return name_idx[label]

    for i in range(n):
        muni = l8[i8[i]][0] if i8[i] >= 0 else None
        barrio = l10[i10[i]][0] if i10[i] >= 0 else None
        parroquia = l9[i9[i]][0] if i9[i] >= 0 else None
        label = " / ".join(x for x in (barrio or parroquia, muni) if x) or None
        if label:
            area[i] = key(label)
        if barrio in by_barrio and by_barrio[barrio][1] is not None:
            rent[i] = by_barrio[barrio][1]
        elif muni in table["municipalities"]:
            rent[i] = table["municipalities"][muni]
    return rent, area, names


# ------------------------------------------------------------- flood & noise
def load_clipped(name):
    """[(properties, geometry in metres)] from data/clipped/<name>.geojson, or [] if absent."""
    path = os.path.join(CLIPPED_DIR, name)
    if not os.path.exists(path):
        return []
    with open(path) as f:
        feats = json.load(f)["features"]
    to_m = lambda g: shapely.transform(g, lambda c: np.column_stack(TO_M.transform(c[:, 0], c[:, 1])))  # noqa: E731
    return [(ft["properties"], to_m(shapely.from_geojson(json.dumps(ft["geometry"])))) for ft in feats]


def mark_within(pts, geoms, values, out):
    """out[i] = values[j] for the last j whose geometry contains point i."""
    if geoms:
        idx = STRtree(geoms).query(pts, predicate="within")
        for j in range(len(geoms)):
            out[idx[0][idx[1] == j]] = values[j]
    return out


def subpoints(grid, k=3):
    """k*k sample points per cell (row-major, cell i occupies rows i*k*k .. i*k*k+k*k-1).
    Flood edges and noise corridors are narrower than a cell, so one centre point is a coin flip."""
    b = grid["bounds"]
    dlat, dlon = (b["north"] - b["south"]) / grid["ny"], (b["east"] - b["west"]) / grid["nx"]
    off = (np.arange(k) + 0.5) / k - 0.5
    LAT = grid["LAT"].ravel()[:, None, None] + off[None, :, None] * dlat
    LON = grid["LON"].ravel()[:, None, None] + off[None, None, :] * dlon
    LAT, LON = np.broadcast_arrays(LAT, LON)
    X, Y = TO_M.transform(LON.ravel(), LAT.ravel())
    return shapely.points(X, Y), k * k


def flood_level(grid):
    """Mean over sub-samples of: 0 outside, 1 in the T=500 zone, 2 in the T=100 zone. None if no data."""
    q100, q500 = load_clipped("flood_q100.geojson"), load_clipped("flood_q500.geojson")
    if not q100 and not q500:
        return None
    sub, kk = subpoints(grid)
    out = np.zeros(len(sub))
    mark_within(sub, [g for _, g in q500], [1] * len(q500), out)
    mark_within(sub, [g for _, g in q100], [2] * len(q100), out)
    return out.reshape(-1, kk).mean(axis=1)


def noise_band(grid, name, coverage, below):
    """Mean over sub-samples of the loudest band's lower bound; `below` inside the mapped
    municipality but outside every band; NaN outside the mapped area. None if no data."""
    bands = load_clipped(name)
    if not bands:
        return None
    sub, kk = subpoints(grid)
    out = np.full(len(sub), np.nan)
    mark_within(sub, [coverage], [below], out)
    bands.sort(key=lambda b: b[0]["db"])
    mark_within(sub, [g for _, g in bands], [b[0]["db"] for b in bands], out)
    return out.reshape(-1, kk).mean(axis=1)


# ------------------------------------------------------------------- dossiers
def dossier_lookup(pts, admin):
    """Per cell: index into the dossier list (-1 = none) and the reputation score (NaN = none)."""
    with open(os.path.join(MANUAL_DIR, "dossier-areas.json")) as f:
        areas = json.load(f)
    path = os.path.join(MANUAL_DIR, "dossiers.json")
    dossiers = json.load(open(path)) if os.path.exists(path) else []
    by_key = {d["key"]: i for i, d in enumerate(dossiers)}
    named = {f"{nm}|{lvl}": g for lvl in ("9", "10") for nm, g in admin.get(lvl, [])}
    named.update({nm: g for lvl in ("9", "10") for nm, g in admin.get(lvl, [])})  # bare name: level 10 wins
    idx = np.full(len(pts), -1)
    for key, names in areas["polygons"].items():
        if key not in by_key:
            continue
        polys = [named[n] for n in names if n in named]
        missing = [n for n in names if n not in named]
        if missing:
            print(f"  dossier {key}: polygons not found: {missing}")
        mark_within(pts, polys, [by_key[key]] * len(polys), idx)
    for c in areas["carve"]:
        if c["key"] in by_key:
            x, y = TO_M.transform(c["lon"], c["lat"])
            mark_within(pts, [shapely.Point(x, y).buffer(c["radius_m"])], [by_key[c["key"]]], idx)
    score = np.full(len(pts), np.nan)
    for i, d in enumerate(dossiers):
        v = d.get("score_override", d.get("score"))
        if v is not None:
            score[idx == i] = v
    return idx, score, dossiers


# ---------------------------------------------------------------------- output
def rounded(arr, nd):
    return [None if (x is None or (isinstance(x, float) and math.isnan(x))) else round(float(x), nd) if nd else int(round(float(x))) for x in arr]


def rep_point(g):
    p = g if g.geom_type == "Point" else g.representative_point()
    lon, lat = TO_DEG.transform(p.x, p.y)
    return round(lat, 6), round(lon, 6)


def main():
    t0 = time.time()
    cats, admin = load_osm()
    for k, v in cats.items():
        print(f"  {k:14s} {len(v):4d}")
    for lvl, v in sorted(admin.items()):
        print(f"  admin {lvl}: {len(v)}")
    grid = make_grid()
    pts = grid["pts"]
    print(f"grid {grid['nx']}x{grid['ny']} = {len(pts)} cells")

    factors, variants = {}, {}
    for name in ["playground", "mall", "supermarket", "health_centre", "hospital", "bus", "rail", "kindergarten", "industrial", "big_road", "railway"]:
        factors[name] = rounded(nearest_distance(pts, [g for g, _ in cats[name]]), 0)
    # park: one distance layer per minimum park size; the app picks the layer with a slider
    layers = [rounded(nearest_distance(pts, [g for g, t in cats["park"] if t["area_ha"] >= ha]), 0) for ha in PARK_AREA_STEPS_HA]
    variants["park"] = dict(label="counts as a park from", unit="ha", steps=PARK_AREA_STEPS_HA, values=layers)
    factors["park"] = layers[PARK_AREA_STEPS_HA.index(1)]
    print("  parks by size:", {ha: sum(t["area_ha"] >= ha for _, t in cats["park"]) for ha in PARK_AREA_STEPS_HA})
    slope, elev = slope_and_elevation(grid)
    factors["slope"] = rounded(slope, 1)
    factors["elevation"] = rounded(elev, 0)
    rent, area, names = rent_lookup(grid, admin)
    factors["rent"] = rounded(rent, 1)
    factors["area"] = [int(x) for x in area]
    flood = flood_level(grid)
    if flood is not None:
        factors["flood"] = rounded(flood, 2)
    didx, dscore, dossiers = dossier_lookup(pts, admin)
    if dossiers:
        factors["dossier"] = [int(x) for x in didx]
        factors["reputation"] = rounded(dscore, 2)
        with open(os.path.join(WEB_DATA_DIR, "dossiers.json"), "w") as f:
            json.dump(dossiers, f, ensure_ascii=False, separators=(",", ":"))
    oviedo = next((g for nm, g in admin.get("8", []) if nm == "Oviedo"), None)
    for key, name, below in (("noise_lden", "noise_lden.geojson", 50), ("noise_ln", "noise_ln.geojson", 45)):
        band = noise_band(grid, name, oviedo, below)
        if band is not None:
            factors[key] = rounded(band, 1)

    os.makedirs(WEB_DATA_DIR, exist_ok=True)
    meta = dict(bounds=grid["bounds"], nx=grid["nx"], ny=grid["ny"], cell_m=CELL_M, generated=time.strftime("%Y-%m-%d"), area_names=names)
    with open(os.path.join(WEB_DATA_DIR, "grid.json"), "w") as f:
        json.dump(dict(meta=meta, factors=factors, variants=variants), f, separators=(",", ":"))

    pois = {}
    for name in ["playground", "mall", "supermarket", "health_centre", "hospital", "bus", "rail", "kindergarten", "industrial"]:
        pois[name] = [[*rep_point(g), t.get("name", "")] for g, t in cats[name]]
    pois["park"] = [[*rep_point(g), t["name"], t["area_ha"]] for g, t in cats["park"] if t["area_ha"] >= min(PARK_AREA_STEPS_HA)]
    with open(os.path.join(WEB_DATA_DIR, "pois.json"), "w") as f:
        json.dump(pois, f, ensure_ascii=False, separators=(",", ":"))

    feats = []
    for lvl in ("10", "9"):
        for nm, g in admin.get(lvl, []):
            if lvl == "9" and nm == "Oviedo / Uviéu":
                continue  # covered by its level-10 barrios
            gs = shapely.simplify(g, 15)
            feats.append(dict(type="Feature", properties=dict(name=nm, level=int(lvl)), geometry=json.loads(shapely.to_geojson(shapely.transform(gs, lambda c: np.column_stack(TO_DEG.transform(c[:, 0], c[:, 1])))))))
    with open(os.path.join(WEB_DATA_DIR, "areas.geojson"), "w") as f:
        json.dump(dict(type="FeatureCollection", features=feats), f, ensure_ascii=False, separators=(",", ":"))

    # overlays for eyeballing the official layers
    for src, dst in (("flood_q100.geojson", "flood_q100.geojson"), ("flood_q500.geojson", "flood_q500.geojson"), ("noise_lden.geojson", "noise_lden.geojson")):
        if os.path.exists(os.path.join(CLIPPED_DIR, src)):
            shutil.copyfile(os.path.join(CLIPPED_DIR, src), os.path.join(WEB_DATA_DIR, dst))

    for k in ("park", "mall", "hospital", "bus", "rail", "slope", "rent", "flood", "noise_lden", "noise_ln", "reputation"):
        if k not in factors:
            continue
        v = np.array([x for x in factors[k] if x is not None], dtype=float)
        print(f"  {k:10s} n={len(v)} min={v.min():.1f} med={np.median(v):.1f} max={v.max():.1f}")
    print(f"done in {time.time()-t0:.1f}s; sizes:", {f: os.path.getsize(os.path.join(WEB_DATA_DIR, f)) // 1024 for f in os.listdir(WEB_DATA_DIR)}, "KB")


if __name__ == "__main__":
    main()
