# Contributing to R&G Command Center

Thanks for your interest in contributing. This document covers the basics.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Open `index.html` in a browser to verify everything works
4. Create a feature branch: `git checkout -b feature/your-feature`

## Development

This is a **zero-dependency static project**. No build tools, no bundlers, no npm.

- **HTML pages** — each page is self-contained with inline styles where page-specific
- **JavaScript** — vanilla JS in `assets/js/`. No frameworks.
- **CSS** — shared styles in `assets/css/styles.css`
- **Python tools** — stdlib only, Python 3.8+

### Before Submitting

1. **Syntax check all JS files:**
   ```bash
   for f in assets/js/*.js; do node --check "$f"; done
   ```

2. **Run the data pipeline:**
   ```bash
   python3 tools/populate_public_data.py --seed-mode off --no-existing-manual
   ```

3. **Run the integrity audit:**
   ```bash
   python3 tools/audit_release_integrity.py
   ```

4. **Verify pages load without console errors** in Chrome/Firefox/Safari

## Data Policy

- **No synthetic data.** Every listing must trace to a real source.
- **No hardcoded credentials.** Auth uses client-side SHA-256 hashing.
- All user-facing strings must pass through `escapeHtml()` or equivalent.

## Pull Requests

- Keep PRs focused on a single change
- Include a clear description of what changed and why
- Reference any related issues
- Ensure all existing functionality still works

## Issues

Use the issue templates when available. Label your issues appropriately:
- `feature` — new functionality
- `bug` — something broken
- `data-pipeline` — resolver, compiler, or tooling changes
- `ui` — visual or interaction changes
- `security` — vulnerability reports (see SECURITY.md for private reporting)

## Code Style

- 2-space indentation in JS/HTML
- Single quotes in JS
- `camelCase` for functions and variables
- No semicolons are fine — match existing file style
- Comment non-obvious logic
