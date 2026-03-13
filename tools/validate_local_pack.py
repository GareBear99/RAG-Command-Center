#!/usr/bin/env python3
import argparse
import json
from collections import Counter
from pathlib import Path

PROVINCE_CODES = {
    "BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL", "YT", "NT", "NU"
}
PROVINCE_ALIASES = {
    "BRITISH COLUMBIA": "BC",
    "ALBERTA": "AB",
    "SASKATCHEWAN": "SK",
    "MANITOBA": "MB",
    "ONTARIO": "ON",
    "QUEBEC": "QC",
    "NEW BRUNSWICK": "NB",
    "NOVA SCOTIA": "NS",
    "PRINCE EDWARD ISLAND": "PE",
    "NEWFOUNDLAND AND LABRADOR": "NL",
    "YUKON": "YT",
    "NORTHWEST TERRITORIES": "NT",
    "NUNAVUT": "NU",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Validate and optionally normalize local JSON source packs before import."
    )
    parser.add_argument(
        "--pack",
        action="append",
        required=True,
        help="Path to a JSON array source pack. Pass multiple times to validate/merge multiple files.",
    )
    parser.add_argument(
        "--write-output",
        help="Optional output JSON path for deduplicated normalized records.",
    )
    parser.add_argument(
        "--require-city",
        action="append",
        default=[],
        help="City that must appear at least once in the merged pack (case-insensitive).",
    )
    parser.add_argument(
        "--require-province",
        action="append",
        default=[],
        help="Province code that must appear at least once in the merged pack.",
    )
    parser.add_argument(
        "--min-total",
        type=int,
        default=1,
        help="Minimum required valid record count after normalization/deduplication.",
    )
    parser.add_argument(
        "--fail-on-warnings",
        action="store_true",
        help="Exit non-zero when warnings are present.",
    )
    return parser.parse_args()


def to_province_code(raw):
    value = str(raw or "").strip().upper()
    if value in PROVINCE_CODES:
        return value
    if value in PROVINCE_ALIASES:
        return PROVINCE_ALIASES[value]
    return value


def load_array(path: Path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"{path} must contain a JSON array.")
    return payload


def normalize_one(record, idx, source_label):
    errors = []
    warnings = []

    if not isinstance(record, dict):
        return None, [f"{source_label}[{idx}] is not an object"], warnings

    normalized = dict(record)
    normalized["address"] = str(record.get("address") or "").strip()
    normalized["city"] = str(record.get("city") or "").strip()
    normalized["province"] = to_province_code(record.get("province"))

    if not normalized["address"]:
        errors.append(f"{source_label}[{idx}] missing address")
    if not normalized["city"]:
        errors.append(f"{source_label}[{idx}] missing city")
    if not normalized["province"]:
        errors.append(f"{source_label}[{idx}] missing province")
    elif normalized["province"] not in PROVINCE_CODES:
        errors.append(f"{source_label}[{idx}] invalid province code '{normalized['province']}'")

    try:
        price = float(record.get("list_price"))
        if price <= 0:
            raise ValueError("must be > 0")
        normalized["list_price"] = int(round(price))
    except Exception:
        errors.append(f"{source_label}[{idx}] invalid list_price '{record.get('list_price')}'")

    for field in ("beds", "baths", "sqft"):
        if record.get(field) in (None, ""):
            continue
        try:
            n = float(record.get(field))
            if n <= 0:
                raise ValueError("must be > 0")
            normalized[field] = n
        except Exception:
            errors.append(f"{source_label}[{idx}] invalid {field} '{record.get(field)}'")

    if not record.get("status"):
        normalized["status"] = "active"
        warnings.append(f"{source_label}[{idx}] missing status -> defaulted to 'active'")
    if not record.get("property_type"):
        normalized["property_type"] = "detached"
        warnings.append(f"{source_label}[{idx}] missing property_type -> defaulted to 'detached'")

    normalized.setdefault("source_name", "Manual Upload")
    normalized.setdefault("source_class", "manual_upload")
    normalized.setdefault("authority_tier", "C")
    return normalized, errors, warnings


def dedupe(records):
    deduped = []
    seen = set()
    for rec in records:
        key = (
            str(rec.get("address") or "").strip().lower(),
            str(rec.get("city") or "").strip().lower(),
            str(rec.get("province") or "").strip().upper(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(rec)
    return deduped


def main():
    args = parse_args()
    normalized = []
    errors = []
    warnings = []

    for raw_path in args.pack:
        path = Path(raw_path).expanduser()
        if not path.is_absolute():
            path = (Path.cwd() / path).resolve()
        if not path.exists():
            errors.append(f"Missing pack: {path}")
            continue
        try:
            rows = load_array(path)
        except Exception as exc:
            errors.append(str(exc))
            continue
        for idx, row in enumerate(rows):
            rec, rec_errors, rec_warnings = normalize_one(row, idx, str(path.name))
            errors.extend(rec_errors)
            warnings.extend(rec_warnings)
            if rec and not rec_errors:
                normalized.append(rec)

    deduped = dedupe(normalized)
    provinces = Counter(str(r.get("province") or "").upper() for r in deduped)
    cities = Counter(str(r.get("city") or "").strip() for r in deduped)

    required_city_misses = [
        city for city in args.require_city
        if city.strip() and city.strip().lower() not in {c.lower() for c in cities}
    ]
    required_province_misses = [
        code for code in args.require_province
        if to_province_code(code) not in provinces
    ]

    print("PACK VALIDATION SUMMARY")
    print(f"input_files: {len(args.pack)}")
    print(f"valid_records_before_dedupe: {len(normalized)}")
    print(f"valid_records_after_dedupe: {len(deduped)}")
    print(f"province_distribution: {dict(sorted((k, v) for k, v in provinces.items() if k))}")
    print(f"top_cities: {cities.most_common(10)}")
    print(f"errors: {len(errors)}")
    print(f"warnings: {len(warnings)}")

    if errors:
        print("\nERRORS:")
        for msg in errors[:80]:
            print(f"- {msg}")
    if warnings:
        print("\nWARNINGS:")
        for msg in warnings[:80]:
            print(f"- {msg}")

    if required_city_misses:
        print(f"\nREQUIRED_CITY_MISSING: {required_city_misses}")
    if required_province_misses:
        print(f"REQUIRED_PROVINCE_MISSING: {required_province_misses}")
    if len(deduped) < args.min_total:
        print(f"MIN_TOTAL_NOT_MET: need {args.min_total}, have {len(deduped)}")

    if args.write_output:
        out_path = Path(args.write_output).expanduser()
        if not out_path.is_absolute():
            out_path = (Path.cwd() / out_path).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(deduped, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"normalized_output_written: {out_path}")

    if errors:
        return 2
    if required_city_misses or required_province_misses or len(deduped) < args.min_total:
        return 3
    if args.fail_on_warnings and warnings:
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
