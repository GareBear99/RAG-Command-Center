#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

FAKE_MARKERS = [
    "seed-",
    "Local Seed Pack",
    "manual_seed_pack",
    "showcase",
    "618 Harbinger Ave",
    "3341 Betula Pl",
    "1842 Fairfield Rd",
    "1056 Colville Rd",
    "Stephanie Nguyen",
    "Doug Aldridge",
    "Karen Whitfield",
    "Marcus & Jen Tran",
]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def iter_json_files(base: Path):
    for p in sorted(base.rglob("*.json")):
        if p.is_file():
            yield p


def main():
    parser = argparse.ArgumentParser(description="Audit release artifacts for strict real-data integrity.")
    parser.add_argument("--allow-nonempty-leads", action="store_true", help="Allow non-empty leads arrays.")
    args = parser.parse_args()

    failures = []
    warnings = []

    manifest_path = DATA / "public" / "release_manifest.json"
    released_path = DATA / "public" / "released_listings.json"
    internal_leads_path = DATA / "internal" / "leads.json"
    public_leads_path = DATA / "leads.json"

    for p in [manifest_path, released_path, internal_leads_path, public_leads_path]:
        if not p.exists():
            failures.append(f"missing required file: {p}")

    if failures:
        for f in failures:
            print(f"[FAIL] {f}")
        return 2

    manifest = read_json(manifest_path)
    released = read_json(released_path)
    internal_leads = read_json(internal_leads_path)
    public_leads = read_json(public_leads_path)

    manual_mode = manifest.get("manual_mode") or {}
    if manual_mode.get("effective_seed_mode") != "off":
        failures.append("manual_mode.effective_seed_mode must be 'off'")
    if int(manual_mode.get("seed_records_available") or 0) != 0:
        failures.append("manual_mode.seed_records_available must be 0")

    if not args.allow_nonempty_leads:
        if len(internal_leads) != 0:
            failures.append("data/internal/leads.json must be empty in strict default mode")
        if len(public_leads) != 0:
            failures.append("data/leads.json must be empty in strict default mode")

    marker_hits = []
    for p in iter_json_files(DATA):
        text = p.read_text(encoding="utf-8", errors="ignore")
        for marker in FAKE_MARKERS:
            if marker.lower() in text.lower():
                marker_hits.append(f"{p}: marker '{marker}'")
    if marker_hits:
        failures.extend(marker_hits)

    released_total = len(released)
    if released_total == 0:
        failures.append("released_listings.json is empty")

    missing_profile = 0
    for row in released:
        sqft = float(row.get("sqft") or 0)
        year = row.get("year_built")
        has_year = year not in (None, "", 0, "0")
        if not (sqft > 0 or has_year):
            missing_profile += 1
    if missing_profile:
        warnings.append(f"{missing_profile} released listings missing both sqft and year_built")

    coverage = (manifest.get("coverage") or {}).get("released_public") or {}
    coverage_provinces = int(coverage.get("province_count") or 0)
    coverage_cities = int(coverage.get("city_count") or 0)
    if coverage_provinces == 0:
        failures.append("coverage.released_public.province_count must be > 0")
    if coverage_cities == 0:
        warnings.append("coverage.released_public.city_count is 0")

    print("AUDIT SUMMARY")
    print(f"released_total: {released_total}")
    print(f"coverage_provinces: {coverage_provinces}")
    print(f"coverage_cities: {coverage_cities}")
    print(f"internal_leads: {len(internal_leads)}")
    print(f"public_leads: {len(public_leads)}")
    print(f"failures: {len(failures)}")
    print(f"warnings: {len(warnings)}")

    if warnings:
        print("\nWARNINGS:")
        for w in warnings:
            print(f"- {w}")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"- {f}")
        return 1

    print("\nPASS: strict real-data integrity checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
