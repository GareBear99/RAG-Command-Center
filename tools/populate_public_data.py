#!/usr/bin/env python3
import argparse
import csv
import hashlib
import io
import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW_DIR = DATA / "raw"
INTERNAL_DIR = DATA / "internal"
PUBLIC_DIR = DATA / "public"

NOW = datetime.now(timezone.utc)
FIELD_TTLS = {
    "address": 24 * 365,
    "city": 24 * 365,
    "province": 24 * 365,
    "postal_code": 24 * 365,
    "property_type": 24 * 30,
    "beds": 24 * 30,
    "baths": 24 * 30,
    "sqft": 24 * 30,
    "year_built": 24 * 365,
    "list_price": 24,
    "status": 12,
    "days_on_market": 24,
    "description": 24 * 14,
}
TIER_CONFIDENCE = {"A": 0.95, "B": 0.82, "C": 0.68}
CRITICAL_FIELDS = {"list_price", "status"}
PROVINCE_NAMES = {
    "BC": "British Columbia",
    "AB": "Alberta",
    "SK": "Saskatchewan",
    "MB": "Manitoba",
    "ON": "Ontario",
    "QC": "Quebec",
    "NB": "New Brunswick",
    "NS": "Nova Scotia",
    "PE": "Prince Edward Island",
    "NL": "Newfoundland and Labrador",
    "YT": "Yukon",
    "NT": "Northwest Territories",
    "NU": "Nunavut",
}
DEFAULT_SEED_FALLBACK_MIN_NON_SEED = 50
MONTREAL_TAXES_AHUNTSIC_URL = (
    "https://donnees.montreal.ca/dataset/0a912de3-9307-4b63-bf19-3a4594f87e1f"
    "/resource/da06242e-86c7-4e97-baf2-4a13dc33ebc0/download"
    "/taxes-municipales-ahuntsic-cartierville.csv"
)
DEFAULT_BOOTSTRAP_LEADS_MAX = 120


def get_json(url: str):
    with urllib.request.urlopen(url, timeout=40) as resp:
        return json.loads(resp.read().decode("utf-8"))


def to_float(value):
    try:
        return float(str(value).replace(",", "").strip())
    except Exception:
        return 0.0

def parse_args():
    parser = argparse.ArgumentParser(
        description="Populate local R&G pipeline data from open feeds plus optional local manual packs."
    )
    parser.add_argument(
        "--seed-mode",
        choices=["on", "off", "fallback"],
        default="off",
        help="Seed generation is disabled in strict real-data mode; accepted only for backward CLI compatibility.",
    )
    parser.add_argument(
        "--manual-pack",
        action="append",
        default=[],
        help="Path to a JSON array pack to load as manual_uploads input. Can be passed multiple times.",
    )
    parser.add_argument(
        "--no-existing-manual",
        action="store_true",
        help="Ignore data/raw/manual_uploads.json when no --manual-pack is supplied.",
    )
    parser.add_argument(
        "--seed-fallback-min-non-seed",
        type=int,
        default=DEFAULT_SEED_FALLBACK_MIN_NON_SEED,
        help="Deprecated compatibility flag; ignored because seed generation is disabled.",
    )
    parser.add_argument(
        "--lead-pack",
        action="append",
        default=[],
        help="Path to a JSON array pack to load as internal leads. Can be passed multiple times.",
    )
    parser.add_argument(
        "--no-default-lead-seed",
        action="store_true",
        help="Deprecated compatibility flag; default lead seeding is disabled.",
    )
    parser.add_argument(
        "--bootstrap-leads-from-listings",
        action="store_true",
        help="Generate internal opportunity leads from compiled listing intelligence (no public CRM inquiries required).",
    )
    parser.add_argument(
        "--bootstrap-leads-from",
        choices=["canonical", "released"],
        default="canonical",
        help="Choose which listing corpus powers opportunity-lead bootstrap.",
    )
    parser.add_argument(
        "--bootstrap-leads-max",
        type=int,
        default=DEFAULT_BOOTSTRAP_LEADS_MAX,
        help="Maximum number of listing-derived opportunity leads to generate when bootstrap mode is enabled.",
    )
    return parser.parse_args()


def load_json_array(path: Path):
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"Failed to parse JSON at {path}: {exc}") from exc
    if not isinstance(payload, list):
        raise ValueError(f"Expected JSON array at {path}, got {type(payload).__name__}")
    return payload


def is_seed_record(record):
    src_id = str(record.get("source_record_id") or "")
    src_name = str(record.get("source_name") or "")
    src_class = str(record.get("source_class") or "")
    return src_id.startswith("seed-") or src_name == "Local Seed Pack" or src_class == "manual_seed_pack"


def dedupe_records(records):
    seen = set()
    out = []
    for rec in records:
        key = (
            str(rec.get("source_record_id") or "").strip(),
            str(rec.get("address") or "").strip().lower(),
            str(rec.get("city") or "").strip().lower(),
            str(rec.get("province") or "").strip().upper(),
            str(rec.get("list_price") or "").strip(),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(rec)
    return out


def normalize_manual_input_record(record, idx=0):
    if not isinstance(record, dict):
        return None
    rec = dict(record)
    rec["address"] = str(rec.get("address") or "").strip()
    rec["city"] = str(rec.get("city") or "").strip()
    rec["province"] = str(rec.get("province") or "").strip().upper()
    rec["status"] = str(rec.get("status") or "active").strip().lower()
    rec["source_name"] = rec.get("source_name") or "Manual Upload"
    rec["source_class"] = rec.get("source_class") or "manual_upload"
    rec["authority_tier"] = str(rec.get("authority_tier") or "C").upper()
    try:
        if rec.get("list_price") not in (None, ""):
            rec["list_price"] = int(round(float(rec.get("list_price"))))
    except Exception:
        pass
    fetched_at = rec.get("fetched_at") or NOW.isoformat()
    rec["fetched_at"] = fetched_at
    rec["first_seen_at"] = rec.get("first_seen_at") or fetched_at
    rec["last_seen_at"] = rec.get("last_seen_at") or fetched_at
    if not rec.get("source_record_id"):
        base = f"{rec.get('address','')}|{rec.get('city','')}|{rec.get('province','')}|{idx}"
        rec["source_record_id"] = rec.get("mls") or rec.get("listing_id") or ("manual-" + hashlib.md5(base.encode("utf-8")).hexdigest()[:12])
    return rec


def resolve_manual_records(seed_mode="fallback", manual_pack_paths=None, include_existing_manual=True, seed_fallback_min_non_seed=DEFAULT_SEED_FALLBACK_MIN_NON_SEED):
    manual_pack_paths = manual_pack_paths or []
    existing_manual = []
    if include_existing_manual:
        existing_manual = load_json_array(RAW_DIR / "manual_uploads.json")

    loaded_packs = []
    if manual_pack_paths:
        for raw_path in manual_pack_paths:
            pack_path = Path(raw_path).expanduser()
            if not pack_path.is_absolute():
                pack_path = (ROOT / pack_path).resolve()
            pack_rows = load_json_array(pack_path)
            loaded_packs.extend(pack_rows)

    candidate_manual = loaded_packs if manual_pack_paths else existing_manual
    non_seed_manual = [r for r in candidate_manual if not is_seed_record(r)]
    normalized_manual = []
    for idx, row in enumerate(non_seed_manual):
        rec = normalize_manual_input_record(row, idx)
        if rec:
            normalized_manual.append(rec)
    final_manual = dedupe_records(normalized_manual)

    meta = {
        "seed_mode": "off",
        "requested_seed_mode": seed_mode,
        "effective_seed_mode": "off",
        "manual_pack_paths": len(manual_pack_paths),
        "loaded_pack_records": len(loaded_packs),
        "existing_manual_records": len(existing_manual),
        "non_seed_manual_records": len(normalized_manual),
        "seed_records_available": 0,
        "seed_fallback_min_non_seed": int(seed_fallback_min_non_seed),
    }
    return final_manual, meta


def normalize_lead_input_record(record, idx=0):
    if not isinstance(record, dict):
        return None
    lead_id = str(record.get("lead_id") or f"lead-{idx+1:04d}").strip()
    name = str(record.get("name") or "").strip()
    if not name:
        return None
    score_band = str(record.get("score_band") or record.get("score") or "warm").strip().lower()
    if score_band not in {"hot", "warm", "cold"}:
        score_band = "warm"
    created_at = str(record.get("created_at") or NOW.isoformat())
    market = str(record.get("market") or "").strip()
    timeline = str(record.get("timeline") or "").strip()
    notes = str(record.get("notes") or "").strip()
    return {
        "id": lead_id,
        "lead_id": lead_id,
        "name": name,
        "phone": str(record.get("phone") or "").strip(),
        "email": str(record.get("email") or "").strip(),
        "inquiry_type": str(record.get("intent") or "buying").strip().lower(),
        "intent": str(record.get("intent") or "buying").strip().lower(),
        "budget": str(record.get("budget") or "").strip(),
        "beds_min": int(float(record.get("beds_min") or 0)) if str(record.get("beds_min") or "").strip() else 0,
        "target_areas": [x.strip() for x in str(market).split(",") if x.strip()],
        "market": market,
        "timeline": timeline,
        "preapproved": bool(record.get("preapproved") or False),
        "city": market.split(",")[0].strip() if market else "",
        "source": str(record.get("source") or "manual").strip(),
        "status": str(record.get("status") or "new").strip(),
        "score": score_band,
        "score_band": score_band,
        "licensed_priority": 3 if any(c in market.lower() for c in ["vancouver", "victoria"]) else (2 if ("bc" in market.lower() or "british columbia" in market.lower()) else 1),
        "routing_queue": "licensed_bc_priority" if any(c in market.lower() for c in ["vancouver", "victoria"]) else ("bc_general_queue" if ("bc" in market.lower() or "british columbia" in market.lower()) else "canada_wide_queue"),
        "notes": notes,
        "created_at": created_at,
        "task": (
            "Call within 1 hour — hot lead"
            if score_band == "hot"
            else ("Follow up within 24 hours" if score_band == "warm" else "Low urgency / nurture queue")
        ),
    }


def listing_opportunity_rank(record):
    score = float(record.get("deal_score") or 0)
    flags = record.get("flags") or {}
    quality = record.get("data_quality") or {}
    if flags.get("below_market"):
        score += 12
    if flags.get("price_drop"):
        score += 10
    if flags.get("investor"):
        score += 6
    if flags.get("new_listing"):
        score += 4
    dom = float(record.get("days_on_market") or 0)
    if dom and dom <= 7:
        score += 3
    if quality.get("critical_stale"):
        score -= 15
    score -= min(20, int(quality.get("unresolved_conflicts_count") or 0) * 4)
    return score


def listing_to_opportunity_lead(record):
    listing_id = str(record.get("id") or record.get("listing_id") or "").strip()
    address = str(record.get("address") or "").strip()
    city = str(record.get("city") or "").strip()
    province = str(record.get("province") or "").strip().upper()
    if not listing_id or not address or not city or not province:
        return None
    list_price = int(float(record.get("list_price") or 0))
    rank = listing_opportunity_rank(record)
    score_band = "hot" if rank >= 70 else ("warm" if rank >= 52 else "cold")
    flags = record.get("flags") or {}
    quality = record.get("data_quality") or {}
    summary_bits = []
    if flags.get("below_market"):
        summary_bits.append("below-market")
    if flags.get("price_drop"):
        summary_bits.append("price-drop")
    if flags.get("new_listing"):
        summary_bits.append("new-listing")
    if quality.get("critical_stale"):
        summary_bits.append("stale-critical")
    deal_pct = int(round(float(record.get("deal_score") or 0)))
    if deal_pct > 0:
        summary_bits.append(f"deal-score-{deal_pct}%")
    market = f"{city}, {province}"
    market_lc = market.lower()
    licensed_priority = 3 if any(c in market_lc for c in ["vancouver", "victoria"]) else (2 if ("bc" in market_lc or "british columbia" in market_lc) else 1)
    routing_queue = "licensed_bc_priority" if licensed_priority >= 3 else ("bc_general_queue" if licensed_priority == 2 else "canada_wide_queue")
    timeline = "immediate_review" if score_band == "hot" else ("review_this_week" if score_band == "warm" else "monitor_queue")
    task = (
        "Review today and assign outreach strategy"
        if score_band == "hot"
        else ("Review within 72 hours and prepare comp note" if score_band == "warm" else "Keep monitored in nurture queue")
    )
    lead_id = "opp-" + hashlib.md5(listing_id.encode("utf-8")).hexdigest()[:12]
    return {
        "id": lead_id,
        "lead_id": lead_id,
        "name": f"Opportunity — {address}",
        "phone": "",
        "email": "",
        "inquiry_type": "listing_opportunity",
        "intent": "listing_opportunity",
        "budget": f"${list_price:,}" if list_price > 0 else "",
        "beds_min": int(float(record.get("beds") or 0)) if float(record.get("beds") or 0) > 0 else 0,
        "target_areas": [city],
        "market": market,
        "timeline": timeline,
        "preapproved": False,
        "city": city,
        "source": "listing_analytics",
        "status": "new",
        "score": score_band,
        "score_band": score_band,
        "licensed_priority": licensed_priority,
        "routing_queue": routing_queue,
        "notes": (
            f"Auto-compiled from verified listing intelligence for {address}. "
            + ("Signals: " + ", ".join(summary_bits) + "." if summary_bits else "Signals pending.")
        ),
        "created_at": NOW.isoformat(),
        "task": task,
        "listing_id": listing_id,
        "origin_listing": {
            "id": listing_id,
            "address": address,
            "city": city,
            "province": province,
            "list_price": list_price,
            "deal_score": float(record.get("deal_score") or 0),
        },
    }


def bootstrap_leads_from_listings(records=None, max_count=DEFAULT_BOOTSTRAP_LEADS_MAX):
    records = records or []
    if max_count <= 0:
        return []
    ranked = sorted(
        records,
        key=lambda r: (
            listing_opportunity_rank(r),
            float(r.get("deal_score") or 0),
            float(r.get("list_price") or 0),
        ),
        reverse=True,
    )
    leads = []
    seen_listing_ids = set()
    for record in ranked:
        listing_id = str(record.get("id") or record.get("listing_id") or "").strip()
        if not listing_id or listing_id in seen_listing_ids:
            continue
        lead = listing_to_opportunity_lead(record)
        if not lead:
            continue
        leads.append(lead)
        seen_listing_ids.add(listing_id)
        if len(leads) >= int(max_count):
            break
    return leads


def resolve_lead_records(lead_pack_paths=None, bootstrap_records=None, bootstrap_max=0):
    lead_pack_paths = lead_pack_paths or []
    lead_rows = []
    if lead_pack_paths:
        for raw_path in lead_pack_paths:
            pack_path = Path(raw_path).expanduser()
            if not pack_path.is_absolute():
                pack_path = (ROOT / pack_path).resolve()
            lead_rows.extend(load_json_array(pack_path))
    normalized = []
    for idx, row in enumerate(lead_rows):
        lead = normalize_lead_input_record(row, idx)
        if lead:
            normalized.append(lead)
    dedup = {}
    for lead in normalized:
        dedup[lead["lead_id"]] = lead
    explicit_count = len(dedup)

    bootstrap_records = bootstrap_records or []
    bootstrap_rows = bootstrap_leads_from_listings(bootstrap_records, max_count=int(bootstrap_max or 0))
    for lead in bootstrap_rows:
        dedup.setdefault(lead["lead_id"], lead)

    meta = {
        "enabled": bool(int(bootstrap_max or 0) > 0 and len(bootstrap_records) > 0),
        "source": "listing_bootstrap",
        "bootstrap_max": int(bootstrap_max or 0),
        "bootstrap_listing_leads": len(bootstrap_rows),
        "explicit_pack_leads": explicit_count,
        "total_internal_leads": len(dedup),
    }
    return list(dedup.values()), meta

def normalize_source_record(
    source: str,
    address: str,
    city: str,
    province: str,
    list_price: float,
    year_built=None,
    source_url: str = "",
    beds=None,
    baths=None,
    sqft=None,
    property_type=None,
    source_name: str = "",
    source_class: str = "municipal_public_record",
    authority_tier: str = "B",
):
    return {
        "listing_id": f"{source}-{hashlib.md5((address + city + province).encode('utf-8')).hexdigest()[:10]}",
        "address": address,
        "city": city,
        "province": province,
        "postal_code": "",
        "list_price": int(round(float(list_price))),
        "beds": beds,
        "baths": baths,
        "sqft": sqft,
        "property_type": property_type,
        "status": "active",
        "description": f"Public municipal assessment-derived residential record in {city}.",
        "url": source_url,
        "source_name": source_name or source,
        "source_class": source_class,
        "authority_tier": authority_tier,
        "images": [],
        "year_built": int(float(year_built)) if year_built not in (None, "", "0", 0) else "",
        "fetched_at": NOW.isoformat(),
        "first_seen_at": NOW.isoformat(),
        "last_seen_at": NOW.isoformat(),
        "source_record_id": "",
    }


def load_vancouver(limit=100):
    url = f"https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/property-tax-report/records?limit={limit}"
    rows = get_json(url).get("results", [])
    out = []
    for r in rows:
        land = float(r.get("current_land_value") or 0)
        imp = float(r.get("current_improvement_value") or 0)
        price = land + imp
        if price <= 0:
            continue
        civic = (r.get("from_civic_number") or "").strip()
        street = (r.get("street_name") or "").strip()
        address = f"{civic} {street}".strip()
        if not address:
            continue
        rec = normalize_source_record(
            "source_a",
            address=address,
            city="Vancouver",
            province="BC",
            list_price=price,
            year_built=r.get("year_built"),
            source_url="https://opendata.vancouver.ca/explore/dataset/property-tax-report/",
            beds=None,
            baths=None,
            sqft=None,
            property_type=(r.get("legal_type") or "").strip().lower() or None,
            source_name="Vancouver Open Data",
            source_class="municipal_public_record",
            authority_tier="B",
        )
        rec["source_record_id"] = str(r.get("pid") or rec["listing_id"])
        out.append(rec)
    return out


def load_calgary(limit=160):
    params = {
        "$limit": str(limit),
        "$where": "assessment_class_description='Residential'",
        "$order": "assessed_value DESC",
    }
    url = "https://data.calgary.ca/resource/4bsw-nn7w.json?" + urllib.parse.urlencode(params)
    rows = get_json(url)
    out = []
    for r in rows:
        address = (r.get("address") or "").strip()
        if not address:
            continue
        price = float(r.get("assessed_value") or 0)
        if price <= 0:
            continue
        rec = normalize_source_record(
            "source_a",
            address=address,
            city="Calgary",
            province="AB",
            list_price=price,
            year_built=r.get("year_of_construction"),
            source_url="https://data.calgary.ca/Government/Current-Year-Property-Assessments-Parcel/4bsw-nn7w",
            beds=None,
            baths=None,
            sqft=None,
            property_type=(r.get("property_type") or "").strip().lower() or None,
            source_name="Calgary Open Data",
            source_class="municipal_public_record",
            authority_tier="B",
        )
        rec["source_record_id"] = str(r.get("roll_number") or rec["listing_id"])
        out.append(rec)
    return out
def load_montreal(limit=140):
    account_best = {}
    with urllib.request.urlopen(MONTREAL_TAXES_AHUNTSIC_URL, timeout=60) as resp:
        text_stream = io.TextIOWrapper(resp, encoding="utf-8-sig", newline="")
        reader = csv.DictReader(text_stream)
        for row in reader:
            account = str(row.get("NO_COMPTE") or "").strip()
            if not account:
                continue
            price = to_float(row.get("VAL_IMPOSABLE"))
            if price <= 0:
                continue

            civ1 = str(row.get("AD_EMPLAC_CIV1") or "").strip()
            civ2 = str(row.get("AD_EMPLAC_CIV2") or "").strip()
            general = str(row.get("AD_EMPLAC_GENER") or "").strip()
            street = str(row.get("AD_EMPLAC_RUE") or "").strip()
            orient = str(row.get("AD_EMPLAC_ORIENT") or "").strip()
            civic = civ1 if not civ2 or civ2 == civ1 else f"{civ1}-{civ2}"
            address = " ".join(x for x in [civic, general, street, orient] if x).strip()
            if not address:
                continue

            current = account_best.get(account)
            if current and current.get("list_price", 0) >= price:
                continue

            rec = normalize_source_record(
                "source_b",
                address=address,
                city="Montréal",
                province="QC",
                list_price=price,
                year_built="",
                source_url=MONTREAL_TAXES_AHUNTSIC_URL,
                beds=None,
                baths=None,
                sqft=None,
                property_type="assessed_record",
                source_name="Montréal Open Data",
                source_class="municipal_public_record",
                authority_tier="B",
            )
            rec["source_record_id"] = account
            rec["description"] = "Municipal tax-assessed property record in Montréal."
            account_best[account] = rec

    out = sorted(account_best.values(), key=lambda r: int(r.get("list_price") or 0), reverse=True)
    return out[:max(0, int(limit))]


def load_edmonton(limit=140):
    params = {
        "$limit": str(limit),
        "$where": "tax_class='Residential'",
        "$order": "assessed_value DESC",
    }
    url = "https://data.edmonton.ca/resource/q7d6-ambg.json?" + urllib.parse.urlencode(params)
    rows = get_json(url)
    out = []
    for r in rows:
        house = (r.get("house_number") or "").strip()
        street = (r.get("street_name") or "").strip()
        address = f"{house} {street}".strip()
        if not address:
            continue
        price = float(r.get("assessed_value") or 0)
        if price <= 0:
            continue
        rec = normalize_source_record(
            "source_b",
            address=address,
            city="Edmonton",
            province="AB",
            list_price=price,
            year_built="",
            source_url="https://data.edmonton.ca/City-Administration/Property-Assessment-Data-Current-Calendar-Year/q7d6-ambg",
            beds=None,
            baths=None,
            sqft=None,
            property_type=(r.get("tax_class") or "").strip().lower() or None,
            source_name="Edmonton Open Data",
            source_class="municipal_public_record",
            authority_tier="B",
        )
        rec["source_record_id"] = str(r.get("account_number") or rec["listing_id"])
        out.append(rec)
    return out


def load_winnipeg(limit=140):
    params = {
        "$limit": str(limit),
        "$where": "proposed_property_class_1 like 'RESIDENTIAL%'",
    }
    url = "https://data.winnipeg.ca/resource/d4mq-wa44.json?" + urllib.parse.urlencode(params)
    rows = get_json(url)
    out = []
    for r in rows:
        address = str(r.get("full_address") or "").strip()
        if not address:
            continue
        price = to_float(r.get("proposed_assessment_value_1"))
        if price <= 0:
            continue
        detail_url = r.get("detail_url")
        if isinstance(detail_url, dict):
            detail_url = detail_url.get("url") or ""
        sqft = int(round(to_float(r.get("total_living_area")))) if to_float(r.get("total_living_area")) > 0 else None
        rec = normalize_source_record(
            "source_b",
            address=address,
            city="Winnipeg",
            province="MB",
            list_price=price,
            year_built=r.get("year_built"),
            source_url=str(detail_url or ""),
            beds=None,
            baths=None,
            sqft=sqft,
            property_type=(r.get("building_type") or "residential").strip().lower(),
            source_name="Winnipeg Open Data",
            source_class="municipal_public_record",
            authority_tier="B",
        )
        rec["lat"] = str(r.get("centroid_lat") or "").strip()
        rec["lng"] = str(r.get("centroid_lon") or "").strip()
        rec["source_record_id"] = str(r.get("roll_number") or rec["listing_id"])
        out.append(rec)
    return out



def score_listing(price, sqft, beds, baths, days_on_market, description):
    ppsf = price / sqft if sqft else 9999
    score = 34
    flags = {"price_drop": False, "below_market": False, "new_listing": False, "investor": False, "fixer": False}
    if days_on_market <= 7:
        score += 8
        flags["new_listing"] = True
    if days_on_market >= 45:
        score += 7
    if ppsf < 330:
        score += 14
        flags["below_market"] = True
    if price < 650000:
        score += 6
    d = (description or "").lower()
    if any(k in d for k in ["fixer", "handyman", "reno", "sweat equity"]):
        score += 9
        flags["fixer"] = True
    if beds >= 3 and baths >= 2:
        score += 5
    if "suite" in d:
        score += 7
        flags["investor"] = True
    score = max(1, min(99, round(score)))
    return score, flags, int(round(ppsf)) if math.isfinite(ppsf) else None


def reconcile(raw):
    def parse_iso(v):
        try:
            return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        except Exception:
            return NOW

    def field_provenance(records, latest, conflicts):
        out = {}
        conflict_fields = {c[0] for c in conflicts}
        fields = ["address","city","province","postal_code","property_type","beds","baths","sqft","year_built","list_price","status","days_on_market","description"]
        for field in fields:
            rec = next((r for r in records if r.get(field) not in (None, "")), latest)
            captured_at = rec.get("fetched_at") or NOW.isoformat()
            age_hours = max(0.0, (NOW - parse_iso(captured_at)).total_seconds() / 3600.0)
            ttl = FIELD_TTLS.get(field, 24 * 30)
            stale = age_hours > ttl
            base_conf = TIER_CONFIDENCE.get(str(rec.get("authority_tier") or "C").upper(), 0.68)
            conf = max(0.30, min(0.99, base_conf - (0.18 if stale else 0) - (0.15 if field in conflict_fields else 0)))
            out[field] = {
                "value": rec.get(field, ""),
                "source": rec.get("_src", ""),
                "source_name": rec.get("source_name", rec.get("_src", "")),
                "source_class": rec.get("source_class", "unclassified"),
                "authority_tier": str(rec.get("authority_tier") or "C").upper(),
                "captured_at": captured_at,
                "ttl_hours": ttl,
                "age_hours": round(age_hours, 1),
                "stale": stale,
                "confidence": round(conf, 2),
            }
        return out
    def group_key(r):
        return f"{r.get('address','').strip().lower()}|{r.get('city','').strip().lower()}|{r.get('province','').strip().upper()}"

    grouped = {}
    for src_name, rows in raw.items():
        for row in rows:
            rr = dict(row)
            rr["_src"] = src_name
            grouped.setdefault(group_key(rr), []).append(rr)

    canonical = []
    conflicts = []
    for key, records in grouped.items():
        records = sorted(records, key=lambda x: x.get("fetched_at", ""), reverse=True)
        latest = records[0]
        first_seen = sorted([r.get("first_seen_at") for r in records if r.get("first_seen_at")])[0]
        last_seen = latest.get("last_seen_at") or NOW.isoformat()
        fields_to_check = ["list_price", "beds", "baths", "sqft", "property_type"]
        local_conflicts = []
        for field in fields_to_check:
            vals = [r.get(field) for r in records if r.get(field) not in (None, "")]
            uniq = []
            for v in vals:
                if v not in uniq:
                    uniq.append(v)
            if len(uniq) > 1:
                local_conflicts.append((field, uniq))

        days_on_market = max(0, (NOW - datetime.fromisoformat(first_seen.replace("Z", "+00:00"))).days) if first_seen else 0
        score, flags, ppsf = score_listing(
            price=float(latest.get("list_price") or 0),
            sqft=float(latest.get("sqft") or 0),
            beds=float(latest.get("beds") or 0),
            baths=float(latest.get("baths") or 0),
            days_on_market=days_on_market,
            description=latest.get("description", ""),
        )
        profile_missing_fields = []
        if int(latest.get("list_price") or 0) <= 0:
            profile_missing_fields.append("list_price")
        if not str(latest.get("address") or "").strip():
            profile_missing_fields.append("address")
        if not str(latest.get("city") or "").strip():
            profile_missing_fields.append("city")
        if not str(latest.get("province") or "").strip():
            profile_missing_fields.append("province")
        if not str(latest.get("property_type") or "").strip():
            profile_missing_fields.append("property_type")
        has_source_ref = any(str(r.get("source_record_id") or "").strip() or str(r.get("url") or "").strip() for r in records)
        if not has_source_ref:
            profile_missing_fields.append("source_reference")
        profile_ready = len(profile_missing_fields) == 0
        lid = "LST-" + hashlib.md5(key.encode("utf-8")).hexdigest()[:12]
        fprov = field_provenance(records, latest, local_conflicts)
        stale_fields = [k for k, v in fprov.items() if v.get("stale")]
        critical_stale = any(f in stale_fields for f in CRITICAL_FIELDS)
        trust_score = round(sum(v.get("confidence", 0) for v in fprov.values()) / max(1, len(fprov)) * 100)
        source_tiers = sorted({str(r.get("authority_tier") or "C").upper() for r in records})
        canonical_item = {
            "id": lid,
            "listing_id": lid,
            "address": latest.get("address", ""),
            "address_full": latest.get("address", ""),
            "address_normalized": latest.get("address", ""),
            "city": latest.get("city", ""),
            "province": latest.get("province", ""),
            "postal_code": latest.get("postal_code", ""),
            "lat": latest.get("lat", ""),
            "lng": latest.get("lng", ""),
            "property_type": latest.get("property_type", "detached"),
            "beds": latest.get("beds", 0),
            "baths": latest.get("baths", 0),
            "sqft": latest.get("sqft", 0),
            "lot_size": "",
            "year_built": latest.get("year_built", ""),
            "list_price": int(latest.get("list_price", 0)),
            "price_label": f"{int(latest.get('list_price', 0)):,}",
            "status": "verified_internal",
            "canonical_status": latest.get("status", "active"),
            "days_on_market": days_on_market,
            "description": latest.get("description", ""),
            "images": [],
            "first_seen_at": first_seen,
            "last_seen_at": last_seen,
            "fetched_at": latest.get("fetched_at", NOW.isoformat()),
            "public_eligible": False,
            "public_released_at": "",
            "instant_update_mode": False,
            "verification_status": "verified_internal",
            "internal_gate_note": (
                f"Data profile incomplete for public release ({', '.join(profile_missing_fields)})."
                if not profile_ready else
                f"Source inconsistencies noted across {len(local_conflicts)} fields."
                if local_conflicts else
                ("Critical market fields are stale and should be refreshed before public release." if critical_stale else "Verified internally with no current field conflicts.")
            ),
            "source_records": [
                {
                    "source": r.get("_src"),
                    "source_name": r.get("source_name", r.get("_src")),
                    "source_class": r.get("source_class", "unclassified"),
                    "authority_tier": str(r.get("authority_tier") or "C").upper(),
                    "source_record_id": r.get("source_record_id", ""),
                    "source_url": r.get("url", ""),
                    "fetched_at": r.get("fetched_at", NOW.isoformat()),
                }
                for r in records
            ],
            "source_conflicts": [],
            "field_provenance": fprov,
            "data_quality": {
                "trust_score": trust_score,
                "stale_fields": stale_fields,
                "stale_fields_count": len(stale_fields),
                "critical_stale": critical_stale,
                "unresolved_conflict_fields": [f for f, _ in local_conflicts],
                "unresolved_conflicts_count": len(local_conflicts),
                "source_tiers": source_tiers,
                "profile_ready": profile_ready,
                "profile_missing_fields": profile_missing_fields,
                "freshness_status": "stale_critical" if critical_stale else ("stale_noncritical" if stale_fields else "fresh"),
                "requires_review": bool(local_conflicts) or critical_stale or not profile_ready,
            },
            "deal_score": score,
            "flags": flags,
            "internal_signals": [
                "Below-market signal detected from price-per-square-foot comparison." if flags["below_market"] else "Standard market fit signal.",
                "Source mismatch found; keep public note light until reviewed." if local_conflicts else "No active source mismatch in current intake.",
                "Critical fields are stale (price/status); refresh source before public release." if critical_stale else ("Non-critical stale fields are present." if stale_fields else "Field freshness is within configured SLA windows."),
            ],
            "public_summary": f"{latest.get('city','')}, {latest.get('province','')} · {latest.get('beds') or 0} bed · {latest.get('baths') or 0} bath · {int((latest.get('sqft') or 0)):,} sqft · " + (f"${ppsf}/sqft" if ppsf else "sqft pending"),
            "market_slug": f"{latest.get('province','').lower()}-{latest.get('city','').lower().replace(' ','-')}",
            "source_inconsistency": {"public_note": "Some source fields were reconciled by Gary Doman & Ricki Kohli before release."} if local_conflicts else None,
            "price_history": [{"at": latest.get("fetched_at", NOW.isoformat()), "price": int(latest.get("list_price", 0))}],
        }
        for field, uniq in local_conflicts:
            conflict = {
                "listing_id": lid,
                "address": latest.get("address", ""),
                "city": latest.get("city", ""),
                "province": latest.get("province", ""),
                "field": field,
                "source_a_value": uniq[0],
                "source_b_value": uniq[1] if len(uniq) > 1 else uniq[0],
                "canonical_value": latest.get(field, ""),
                "resolution": "latest_source_wins_pending_review",
                "status": "review",
            }
            conflicts.append(conflict)
            canonical_item["source_conflicts"].append(conflict)
        canonical.append(canonical_item)

    canonical.sort(key=lambda x: x["deal_score"], reverse=True)
    release_queue = [
        {
            "id": c["id"],
            "address": c["address"],
            "city": c["city"],
            "province": c["province"],
            "verification_status": c["verification_status"],
            "first_seen_at": c["first_seen_at"],
            "status": "internal_only",
        }
        for c in canonical
    ]
    return canonical, conflicts, release_queue


def compile_public(canonical, grace_bypass_until=1000):
    def has_high_risk_unresolved_conflict(item):
        high_risk = {"list_price", "status", "address", "city", "province"}
        for c in item.get("source_conflicts", []) or []:
            if (c.get("status") or "review") != "resolved" and str(c.get("field") or "").lower() in high_risk:
                return True
        return False
    def has_minimum_public_profile(item):
        quality = item.get("data_quality") or {}
        if quality.get("profile_ready") is False:
            return False
        return bool(
            (item.get("list_price") or 0)
            and str(item.get("address") or "").strip()
            and str(item.get("city") or "").strip()
            and str(item.get("province") or "").strip()
            and str(item.get("property_type") or "").strip()
        )
    count = len(canonical)
    released = []
    for c in canonical:
        if c.get("verification_status") != "verified_internal":
            continue
        if not has_minimum_public_profile(c):
            continue
        if (c.get("data_quality") or {}).get("critical_stale"):
            continue
        if has_high_risk_unresolved_conflict(c):
            continue
        if count < grace_bypass_until:
            cc = dict(c)
            cc["status"] = "public_live"
            cc["public_eligible"] = True
            cc["release_reason"] = "grace_bypass"
            cc["public_released_at"] = NOW.isoformat()
            cc["instant_update_mode"] = True
            released.append(cc)
            continue
        first_seen = datetime.fromisoformat(str(c["first_seen_at"]).replace("Z", "+00:00"))
        if (NOW - first_seen) >= timedelta(hours=24):
            cc = dict(c)
            cc["status"] = "public_live"
            cc["public_eligible"] = True
            cc["release_reason"] = "aged_24h"
            cc["public_released_at"] = NOW.isoformat()
            cc["instant_update_mode"] = True
            released.append(cc)

    provinces = {}
    for r in released:
        p = (r.get("province") or "").upper()
        if not p:
            continue
        bucket = provinces.setdefault(
            p,
            {
                "province_code": p,
                "slug": PROVINCE_NAMES.get(p, p).lower().replace(" ", "-"),
                "name": PROVINCE_NAMES.get(p, p),
                "listing_count": 0,
                "summary": "Verified public release coverage for this province or territory.",
                "cities": {},
            },
        )
        bucket["listing_count"] += 1
        city_slug = (r.get("city") or "").lower().replace(" ", "-")
        city = bucket["cities"].setdefault(city_slug, {"slug": city_slug, "name": r.get("city", ""), "listing_count": 0, "top_deal_score": 0})
        city["listing_count"] += 1
        city["top_deal_score"] = max(city["top_deal_score"], r.get("deal_score", 0))

    index = {
        "generated_at": NOW.isoformat(),
        "grace_bypass_until_listing_count": grace_bypass_until,
        "provinces": sorted(
            [
                {
                    **v,
                    "cities": sorted(v["cities"].values(), key=lambda x: x["listing_count"], reverse=True),
                }
                for v in provinces.values()
            ],
            key=lambda x: x["listing_count"],
            reverse=True,
        ),
    }
    released.sort(key=lambda x: x.get("deal_score", 0), reverse=True)
    return released, index


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")

def build_markets(directory_index):
    province_index = {
        str(p.get("province_code") or "").upper(): p
        for p in (directory_index.get("provinces") or [])
    }
    provinces = []
    for code, name in PROVINCE_NAMES.items():
        entry = province_index.get(code, {})
        listing_count = int(entry.get("listing_count") or 0)
        city_count = len(entry.get("cities") or [])
        summary = (
            f"{listing_count} released listing{'s' if listing_count != 1 else ''} across {city_count} market{'s' if city_count != 1 else ''}."
            if listing_count
            else "No loaded records from current ingest sources."
        )
        provinces.append(
            {
                "slug": name.lower().replace(" ", "-"),
                "province_code": code,
                "name": name,
                "summary": summary,
                "active_markets": city_count,
                "listing_count": listing_count,
            }
        )
    return {"provinces": provinces}


def json_hash(obj):
    payload = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()

def coverage_snapshot(records):
    province_codes = sorted({
        str(r.get("province") or "").strip().upper()
        for r in records
        if str(r.get("province") or "").strip()
    })
    city_keys = {
        f"{str(r.get('province') or '').strip().upper()}::{str(r.get('city') or '').strip().lower()}"
        for r in records
        if str(r.get("province") or "").strip() and str(r.get("city") or "").strip()
    }
    return {
        "province_codes": province_codes,
        "province_count": len(province_codes),
        "city_count": len(city_keys),
    }


def build_release_manifest(raw, canonical, conflicts, release_queue, released, directory_index, leads, manual_meta, lead_meta):
    raw_all = (raw.get("source_a") or []) + (raw.get("source_b") or []) + (raw.get("manual_uploads") or [])
    raw_coverage = coverage_snapshot(raw_all)
    released_coverage = coverage_snapshot(released)
    national_total = len(PROVINCE_NAMES)
    return {
        "generated_at": NOW.isoformat(),
        "compiler_version": "rg-local-v1",
        "counts": {
            "raw_source_a": len(raw.get("source_a") or []),
            "raw_source_b": len(raw.get("source_b") or []),
            "raw_manual_uploads": len(raw.get("manual_uploads") or []),
            "canonical_listings": len(canonical),
            "released_listings": len(released),
            "conflicts": len(conflicts),
            "release_queue": len(release_queue),
            "internal_leads": len(leads),
            "directory_provinces": len(directory_index.get("provinces") or []),
        },
        "hashes": {
            "canonical_listings_sha256": json_hash(canonical),
            "released_listings_sha256": json_hash(released),
            "directory_index_sha256": json_hash(directory_index),
            "internal_leads_sha256": json_hash(leads),
            "raw_source_a_sha256": json_hash(raw.get("source_a") or []),
            "raw_source_b_sha256": json_hash(raw.get("source_b") or []),
            "raw_manual_uploads_sha256": json_hash(raw.get("manual_uploads") or []),
        },
        "coverage": {
            "national_province_target": national_total,
            "raw_ingest": {
                **raw_coverage,
                "is_national": raw_coverage["province_count"] >= national_total,
            },
            "released_public": {
                **released_coverage,
                "is_national": released_coverage["province_count"] >= national_total,
            },
        },
        "manual_mode": manual_meta,
        "lead_mode": lead_meta,
    }

def load_source_with_guard(name, fn):
    try:
        return fn()
    except Exception as exc:
        print(f"[warn] {name} ingest failed: {exc}", file=sys.stderr)
        return []


def main():
    args = parse_args()
    vancouver = load_source_with_guard("vancouver", lambda: load_vancouver(limit=100))
    calgary = load_source_with_guard("calgary", lambda: load_calgary(limit=160))
    edmonton = load_source_with_guard("edmonton", lambda: load_edmonton(limit=140))
    winnipeg = load_source_with_guard("winnipeg", lambda: load_winnipeg(limit=140))
    montreal = load_source_with_guard("montreal", lambda: load_montreal(limit=140))

    source_a = vancouver + calgary[:120]
    source_b = edmonton + winnipeg + montreal
    manual, manual_meta = resolve_manual_records(
        seed_mode=args.seed_mode,
        manual_pack_paths=args.manual_pack,
        include_existing_manual=not args.no_existing_manual,
        seed_fallback_min_non_seed=args.seed_fallback_min_non_seed,
    )

    raw = {"source_a": source_a, "source_b": source_b, "manual_uploads": manual}
    canonical, conflicts, release_queue = reconcile(raw)
    released, directory_index = compile_public(canonical, grace_bypass_until=1000)
    bootstrap_source_records = []
    bootstrap_max = 0
    if args.bootstrap_leads_from_listings:
        bootstrap_source_records = canonical if args.bootstrap_leads_from == "canonical" else released
        bootstrap_max = max(0, int(args.bootstrap_leads_max))
    leads, lead_meta = resolve_lead_records(
        lead_pack_paths=args.lead_pack,
        bootstrap_records=bootstrap_source_records,
        bootstrap_max=bootstrap_max,
    )
    markets = build_markets(directory_index)
    release_manifest = build_release_manifest(raw, canonical, conflicts, release_queue, released, directory_index, leads, manual_meta, lead_meta)

    lead_mode_label = "none"
    if len(args.lead_pack):
        lead_mode_label = "local_lead_pack"
    if lead_meta.get("bootstrap_listing_leads"):
        lead_mode_label = f"{lead_mode_label}+listing_bootstrap({args.bootstrap_leads_from})" if lead_mode_label != "none" else f"listing_bootstrap({args.bootstrap_leads_from})"

    runs = {
        "runs": [
            {"source": "source_a", "records": len(source_a), "mode": "public_open_data_ingest", "captured_at": NOW.isoformat(), "status": "ok"},
            {"source": "source_b", "records": len(source_b), "mode": "public_open_data_ingest", "captured_at": NOW.isoformat(), "status": "ok"},
            {"source": "manual_uploads", "records": len(manual), "mode": f"local_pack_seed_mode_{manual_meta.get('effective_seed_mode', 'off')}", "captured_at": NOW.isoformat(), "status": "ok"},
            {"source": "internal_leads", "records": len(leads), "mode": lead_mode_label, "captured_at": NOW.isoformat(), "status": "ok"},
        ]
    }

    write_json(RAW_DIR / "source_a.json", source_a)
    write_json(RAW_DIR / "source_b.json", source_b)
    write_json(RAW_DIR / "manual_uploads.json", manual)

    write_json(INTERNAL_DIR / "canonical_listings.json", canonical)
    write_json(INTERNAL_DIR / "source_conflicts.json", conflicts)
    write_json(INTERNAL_DIR / "release_queue.json", release_queue)
    write_json(INTERNAL_DIR / "source_runs.json", runs)
    write_json(INTERNAL_DIR / "leads.json", leads)

    write_json(PUBLIC_DIR / "released_listings.json", released)
    write_json(PUBLIC_DIR / "directory_index.json", directory_index)
    write_json(PUBLIC_DIR / "release_manifest.json", release_manifest)

    # Keep compatibility with older pages.
    public_safe_leads = [lead for lead in leads if str(lead.get("source") or "").strip().lower() != "listing_analytics"]
    write_json(DATA / "listings.json", released)
    write_json(DATA / "leads.json", public_safe_leads)
    write_json(DATA / "markets.json", markets)

    bootstrap = {
        "raw": raw,
        "internal": {
            "canonical_listings": canonical,
            "source_conflicts": conflicts,
            "release_queue": release_queue,
            "source_runs": runs,
            "leads": leads,
        },
        "public": {
            "released_listings": released,
            "directory_index": directory_index,
            "release_manifest": release_manifest,
        },
        "markets": markets,
    }
    (DATA / "bootstrap.js").write_text("window.GRR_BOOTSTRAP = " + json.dumps(bootstrap, ensure_ascii=False) + ";\n", encoding="utf-8")

    print("Population complete.")
    print(f"source_a: {len(source_a)} records")
    print(f"source_b: {len(source_b)} records")
    print(f"manual_uploads: {len(manual)} records")
    print(f"manual_mode: {manual_meta['effective_seed_mode']} (requested={manual_meta['requested_seed_mode']}, non_seed={manual_meta['non_seed_manual_records']}, loaded_packs={manual_meta['loaded_pack_records']}, fallback_min={manual_meta['seed_fallback_min_non_seed']})")
    print(f"internal_leads: {len(leads)} (explicit_pack={lead_meta.get('explicit_pack_leads', 0)}, bootstrap={lead_meta.get('bootstrap_listing_leads', 0)})")
    print(f"canonical: {len(canonical)}")
    print(f"conflicts: {len(conflicts)}")
    print(f"released: {len(released)}")


if __name__ == "__main__":
    main()
