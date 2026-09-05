"""Shared configuration for the Oviedo apartment-search heat map."""

# Search area: screenshot box (El Cristo <-> El Berron, Ables <-> Roces) + ~1 km margin.
BBOX = dict(south=43.32, west=-5.92, north=43.45, east=-5.68)

# Grid cell size in metres.
CELL_M = 100

# Paths
RAW_DIR = "data/raw"
MANUAL_DIR = "data/manual"
CLIPPED_DIR = "data/clipped"  # MITECO flood/noise layers clipped to the box (pipeline/clip_shapefiles.py)
WEB_DATA_DIR = "web/data"

# Hospitals that count for the "hospital" factor (paediatric emergencies). OSM names.
HOSPITALS = ["Hospital Universitario Central de Asturias", "Centro Médico de Asturias"]

# The park factor is precomputed for each of these minimum park sizes (hectares); the app has a
# slider over them. Adjacent park polygons are merged before measuring. Playgrounds are a separate factor.
PARK_AREA_STEPS_HA = [0.5, 1, 2, 3, 5, 10]

# IGN MDT25 bare-earth terrain model for the box, ESRI ASCII grid (see pipeline/fetch_dem.py).
DEM_FILE = "mdt25.asc"
