"""Merge the research agents' group-*.json files into data/manual/dossiers.json.

Validates the schema, keeps a stable order (the order of data/manual/dossier-areas.json),
and preserves any `score_override` already present in the existing dossiers file.
Usage: uv run python pipeline/merge_dossiers.py <dir with group-*.json>
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data/manual/dossiers.json")
FIELDS = ["key", "name", "character", "families", "safety", "nuisances", "housing", "score", "confidence", "sources"]


def main(src_dir):
    order = list(json.load(open(os.path.join(ROOT, "data/manual/dossier-areas.json")))["polygons"])
    old = {d["key"]: d for d in json.load(open(OUT))} if os.path.exists(OUT) else {}
    merged = {}
    for path in sorted(glob.glob(os.path.join(src_dir, "group-*.json"))):
        for d in json.load(open(path)):
            missing = [f for f in FIELDS if f not in d]
            assert not missing, f"{path}: {d.get('key')} missing {missing}"
            assert d["score"] is None or 0 <= d["score"] <= 1, f"{d['key']}: bad score {d['score']}"
            assert d["confidence"] in ("low", "medium", "high"), f"{d['key']}: bad confidence"
            assert d["key"] in order, f"{path}: unknown key {d['key']}"
            if "score_override" in old.get(d["key"], {}):
                d["score_override"] = old[d["key"]]["score_override"]
            merged[d["key"]] = {f: d[f] for f in FIELDS + (["score_override"] if "score_override" in d else [])}
    out = [merged[k] for k in order if k in merged]
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{len(out)} dossiers -> {OUT}; missing: {[k for k in order if k not in merged]}")
    for d in out:
        print(f"  {d['score'] if d['score'] is not None else ' n/a':>5}  {d['confidence']:6s}  {d['name']}  ({len(d['sources'])} sources)")


if __name__ == "__main__":
    main(sys.argv[1])
