"""Fetch the IGN 25 m bare-earth terrain model (MDT25) for the box into data/raw/mdt25.asc.

Source: IDEE INSPIRE WCS (servicios.idee.es), coverage Elevacion4258_25 (ETRS89 lat/lon).
A bare-earth model matters here: SRTM measures rooftops and shows fake slope in dense blocks.
Uses curl because Python's certificate store rejects the server's chain.
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import BBOX, DEM_FILE, RAW_DIR

URL = (
    "https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
    "&COVERAGEID=Elevacion4258_25&SUBSET=Lat({south},{north})&SUBSET=Long({west},{east})&FORMAT=application/asc"
)


def main():
    raw = subprocess.run(["curl", "-sS", "--max-time", "300", URL.format(**BBOX)], check=True, capture_output=True).stdout
    # The reply is multipart; the ASCII grid is the part starting at its "ncols" header.
    start = raw.index(b"ncols")
    end = raw.index(b"\n--wcs", start)
    os.makedirs(RAW_DIR, exist_ok=True)
    out = os.path.join(RAW_DIR, DEM_FILE)
    with open(out, "wb") as f:
        f.write(raw[start:end] + b"\n")
    print(f"{end - start} bytes -> {out}")


if __name__ == "__main__":
    main()
