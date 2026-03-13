<p align="center">
  <strong>R&G Realty Group — Command Center</strong><br>
  <em>Real estate intelligence platform for the Canadian market</em>
</p>

<p align="center">
  <a href="https://github.com/GareBear99/RG-Command-Center/releases/tag/v1.0.0"><img src="https://img.shields.io/badge/version-1.0.0-d4a843?style=flat-square" alt="Version"></a>
  <a href="https://github.com/GareBear99/RG-Command-Center/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8e97a8?style=flat-square" alt="License"></a>
  <a href="https://github.com/GareBear99/RG-Command-Center/stargazers"><img src="https://img.shields.io/github/stars/GareBear99/RG-Command-Center?style=flat-square&color=d4a843" alt="Stars"></a>
  <a href="https://github.com/GareBear99/RG-Command-Center/network/members"><img src="https://img.shields.io/github/forks/GareBear99/RG-Command-Center?style=flat-square&color=8e97a8" alt="Forks"></a>
  <a href="https://github.com/GareBear99/RG-Command-Center/issues"><img src="https://img.shields.io/github/issues/GareBear99/RG-Command-Center?style=flat-square&color=4b8fcc" alt="Issues"></a>
  <a href="https://github.com/GareBear99/RG-Command-Center/releases"><img src="https://img.shields.io/github/release-date/GareBear99/RG-Command-Center?style=flat-square&color=2ec97a&label=released" alt="Release Date"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-local--first-2ec97a?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/data-real--source--only-4b8fcc?style=flat-square" alt="Data Policy">
  <img src="https://img.shields.io/badge/dependencies-zero-2ec97a?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/listings-615%2B-d4a843?style=flat-square" alt="Listings">
  <img src="https://img.shields.io/badge/markets-5_cities-4b8fcc?style=flat-square" alt="Markets">
  <img src="https://img.shields.io/badge/python-3.8%2B-3776ab?style=flat-square&logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/javascript-vanilla-f7df1e?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
</p>

<p align="center">
  <a href="https://ko-fi.com/GareBear99"><img src="https://img.shields.io/badge/Ko--fi-Support_this_project-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
  <a href="https://buymeacoffee.com/GareBear99"><img src="https://img.shields.io/badge/Buy_Me_a_Coffee-Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee"></a>
  <a href="https://github.com/sponsors/GareBear99"><img src="https://img.shields.io/badge/GitHub_Sponsors-Sponsor-ea4aaa?style=for-the-badge&logo=github-sponsors&logoColor=white" alt="GitHub Sponsors"></a>
</p>

<p align="center">
  <sub>If you find this useful, consider giving it a ⭐ — it helps others discover the project.</sub>
</p>

---

## Overview

Public Site: https://garebear99.github.io/RG-Command-Center/

**R&G Command Center** is a local-first, zero-dependency real estate intelligence platform built with static HTML, vanilla JavaScript, and Python tooling. It ingests real municipal assessment data from Canadian cities, runs a multi-source reconciliation pipeline, scores every listing with a transparent deal engine, and surfaces actionable signals for investment decisions.

**R = Ricki Kohli** · **G = Gary Doman**

### Key Principles

- **Real data only** — every listing traces back to a verified municipal source. No synthetic data, no demo records.
- **Local-first** — runs entirely in the browser with `file://` or any static server. No backend required.
- **Transparent scoring** — deal scores break down into weighted components with full explanations.
- **Source-aware** — tracks field provenance, authority tiers, and flags cross-source conflicts.

---

## Features

### Public Pages

- **`index.html`** — Homepage with released listing overview and map thumbnails
- **`deals.html`** — Top deals surface ranked by composite deal score
- **`directory.html`** — Province-aware public listing browser
- **`listing-detail.html`** — Full listing detail with interactive GPS map

### Internal Command Center (SHA-256 Auth)

- **`command-center.html`** — Dashboard with stats, call queue, top deals, signal feed, pipeline health
- **`listings.html`** — Canonical listing management with source conflict resolution
- **`leads.html`** — Lead operations with prioritized queue and licensed-market routing
- **`add.html`** — Manual listing and lead entry with auto-scoring
- **`settings.html`** — Data pipeline controls: import, reconcile, compile, audit logs

### GPS Map System

- 4 tile providers: CartoDB Dark, OSM Street, Esri Satellite, CartoDB Voyager
- Interactive controls: zoom +/−, layer switching, overlay toggles (marker + 200m area radius)
- Touch support: pinch-to-zoom, single-finger drag
- Listing card thumbnails: real map tiles with GPS precision indicators

### Deal Scoring Engine

Every listing receives a composite deal score (0–100%) built from six weighted components:

- **Below Market** (35%) — $/sqft vs area median benchmarks
- **Price Drop** (20%) — reduction magnitude + recency
- **Days on Market** (15%) — freshness and motivation signals
- **Area Comps** (15%) — comparable listing density
- **Features** (10%) — bed/bath utility score
- **Data Freshness** (5%) — source age and staleness

### Signal Detection

Automated signal engine flags: new listings, price drops, below-market pricing, high DOM (seller motivation), fixer opportunities, investor signals, and family-home matches.

---

## Quick Start

### 1. Clone and open

```bash
git clone https://github.com/GareBear99/RG-Command-Center.git
cd RG-Command-Center
```

Open `index.html` in any modern browser — the app works immediately with the included dataset of 600+ real listings.

### 2. Regenerate data (optional)

```bash
# Rebuild all artifacts from raw sources
python3 tools/populate_public_data.py --seed-mode off --no-existing-manual

# Validate the release
python3 tools/audit_release_integrity.py
```

### 3. Import new market data

1. Prepare a JSON pack matching the format in `tools/examples/`
2. Validate: `python3 tools/validate_local_pack.py --pack your_pack.json`
3. Import via `tools/import-source.html` → Reconcile + Compile in Settings

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Raw Sources                                         │
│  source_a.json · source_b.json · manual_uploads.json │
└────────────────────────┬────────────────────────────┘
                         │ resolver.js
                         ▼
┌─────────────────────────────────────────────────────┐
│  Internal Pipeline                                   │
│  canonical_listings · source_conflicts               │
│  release_queue · leads                               │
└────────────────────────┬────────────────────────────┘
                         │ compiler.js
                         ▼
┌─────────────────────────────────────────────────────┐
│  Public Release                                      │
│  released_listings · directory_index                  │
│  release_manifest · bootstrap.js                     │
└─────────────────────────────────────────────────────┘
```

### File Structure

```
├── index.html, deals.html, directory.html    # Public pages
├── listing-detail.html                       # Public detail view
├── command-center.html                       # Internal dashboard
├── listings.html, leads.html, add.html       # Internal tools
├── settings.html                             # Pipeline controls
├── assets/
│   ├── css/styles.css                        # Shared stylesheet
│   └── js/
│       ├── utils.js                          # Shared utilities (XSS, formatting)
│       ├── resolver.js                       # Source reconciliation engine
│       ├── compiler.js                       # Release compiler
│       ├── public.js                         # Public page renderer
│       ├── command.js                        # Internal page renderer
│       ├── auth.js                           # SHA-256 authentication
│       ├── gps-fallback-map.js               # Tile map engine + thumbnails
│       └── settings.js                       # Pipeline UI controls
├── data/
│   ├── bootstrap.js                          # Compiled runtime data
│   ├── raw/                                  # Source intake files
│   ├── internal/                             # Reconciled pipeline state
│   └── public/                               # Released artifacts
└── tools/
    ├── populate_public_data.py               # Data pipeline runner
    ├── validate_local_pack.py                # Import pack validator
    ├── audit_release_integrity.py            # Release integrity checker
    ├── import-source.html                    # Browser-based import tool
    └── examples/                             # Source data templates
```

---

## Data Coverage

Currently ingesting real municipal assessment data from:

- **BC** — Vancouver (municipal open data)
- **AB** — Calgary, Edmonton (municipal open data)
- **MB** — Winnipeg (municipal open data)
- **QC** — Montréal (municipal open data)

Coverage expands dynamically as new source packs are imported. The platform supports any Canadian city — simply add a validated JSON pack.

---

## Python Tooling

Requires **Python 3.8+**. No external dependencies.

```bash
# Full rebuild (strict real-data mode)
python3 tools/populate_public_data.py --seed-mode off --no-existing-manual

# Validate a source pack before import
python3 tools/validate_local_pack.py --pack path/to/pack.json \
  --require-city Vancouver --require-province BC --min-total 10

# Audit release integrity
python3 tools/audit_release_integrity.py

# Bootstrap internal leads from listing intelligence
python3 tools/populate_public_data.py --seed-mode off \
  --bootstrap-leads-from-listings --bootstrap-leads-from canonical \
  --bootstrap-leads-max 120
```

---

## Licensed-Market Workflow (BC Focus)

R&G operates with a licensed focus on BC markets (Vancouver, Victoria). The platform implements priority routing:

1. **Licensed-city listings** (Vancouver, Victoria) → highest sort priority + `Licensed Focus` tag
2. **BC provincial listings** → elevated priority + `BC` tag
3. **Canada-wide listings** → standard priority

Leads are automatically routed to the appropriate queue based on target areas.

---

## Security

- Internal pages use SHA-256 hashed password authentication
- All user input is sanitized against XSS via shared `escapeHtml` utility
- Image URLs and location data are attribute-escaped in thumbnail generation
- No external API keys or secrets stored in the codebase
- See [SECURITY.md](SECURITY.md) for reporting vulnerabilities

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Support the Project

If R&G Command Center is useful to you, consider supporting continued development:

<p align="center">
  <a href="https://ko-fi.com/GareBear99"><img src="https://img.shields.io/badge/Ko--fi-Support_this_project-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
  <a href="https://buymeacoffee.com/GareBear99"><img src="https://img.shields.io/badge/Buy_Me_a_Coffee-Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee"></a>
  <a href="https://github.com/sponsors/GareBear99"><img src="https://img.shields.io/badge/GitHub_Sponsors-Sponsor-ea4aaa?style=for-the-badge&logo=github-sponsors&logoColor=white" alt="GitHub Sponsors"></a>
  <a href="https://paypal.me/GareBear99"><img src="https://img.shields.io/badge/PayPal-Donate-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="PayPal"></a>
</p>

You can also support by:
- ⭐ **Starring** this repo — helps with discoverability
- 🍴 **Forking** and contributing code or data
- 📣 **Sharing** with real estate professionals who could use it
- 🐛 **Reporting issues** or suggesting features

---

## License

[MIT](LICENSE) — R&G Realty Group

---

<p align="center">
  <sub>Built with care by <a href="https://github.com/GareBear99">GareBear99</a> · R&G Realty Group</sub><br>
  <sub>Vancouver · Calgary · Edmonton · Winnipeg · Montréal</sub>
</p>
