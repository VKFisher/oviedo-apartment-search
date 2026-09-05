# Oviedo apartment search

Weighted heat map over the Oviedo / Lugones / Colloto area for the family flat hunt.
Each factor (park, supermarket, health centre, slope, rent, noise, flood, barrio
reputation, ...) is precomputed per 100 m cell; the web page combines them live with
per-factor on/off, weight and distance sliders, plus hard "must" filters that leave
failing cells unshaded.

The address bar always holds the current settings (`?park=r700_m550&view=b-9&map=...`),
so copying the URL shares the exact view. Defaults are omitted; URL beats the browser's
remembered settings, which beat the defaults.

Deployed to GitHub Pages from `web/` by `.github/workflows/pages.yml` on every push to `main`.

## Run

    uv run python pipeline/fetch_osm.py   # once, or to refresh OSM (writes data/raw/osm.json)
    uv run python pipeline/fetch_dem.py   # once: IGN 25 m terrain model (writes data/raw/mdt25.asc)
    uv run python pipeline/clip_shapefiles.py <dir>   # once: clip MITECO flood/noise shapefiles -> data/clipped/ (committed)
    uv run python pipeline/build.py       # writes web/data/*
    uv run python -m http.server 8124 -d web   # open http://localhost:8124

## Layout

- `config.py` — bbox, cell size, hospital list, thresholds
- `pipeline/fetch_osm.py`, `pipeline/fetch_dem.py` — raw inputs (Overpass, IDEE WCS)
- `pipeline/osm.py` — Overpass elements -> projected shapely geometries
- `pipeline/build.py` — grid, per-factor raw values, POIs, barrio outlines
- `data/manual/rent.json` — idealista district rents + district -> OSM barrio mapping
- `data/clipped/` — official flood zones (SNCZI T=100/T=500) and noise bands (MER phase 3, Lden/Ln) clipped to the box
- `data/manual/dossiers.json` — researched barrio dossiers (score, confidence, sources); `dossier-areas.json` maps them to polygons
- `web/` — static Leaflet app (`app.js` holds the factor definitions, score functions and URL state)
