"""Copy the world-system model outputs into backend/data/worldsystem/ (gzip JSON).

Usage:
    python scripts/sync_worldsystem.py /path/to/Reproducible-Research-Project-2

Reads results/dashboard_data.json, dashboard/geo.json and dashboard/osint/*.json from the research
repository (produced by src/analyze.py, src/build_dashboard.py and src/osint.py there).
"""
import gzip
import json
import shutil
import sys
from pathlib import Path

DEST = Path(__file__).resolve().parent.parent / "data" / "worldsystem"


def gz(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with open(src, "rb") as fi, gzip.open(dst, "wb", compresslevel=9) as fo:
        shutil.copyfileobj(fi, fo)
    print(f"{dst.relative_to(DEST.parent.parent)}  {src.stat().st_size / 1e6:.1f} MB -> {dst.stat().st_size / 1e6:.1f} MB")


def main(repo: str) -> None:
    root = Path(repo)
    gz(root / "results" / "dashboard_data.json", DEST / "dashboard_data.json.gz")
    gz(root / "dashboard" / "geo.json", DEST / "countries.json.gz")
    # power plants and live traffic are already covered by QuasarBroker's own feeds
    for f in sorted((root / "dashboard" / "osint").glob("*.json")):
        if f.stem not in ("plantas", "trafico"):
            gz(f, DEST / "osint" / f"{f.stem}.json.gz")
    json.dump({"source": "https://github.com/QU01/Reproducible-Research-Project-2"}, open(DEST / "SOURCE.json", "w"))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
