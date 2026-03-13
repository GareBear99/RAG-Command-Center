# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainers or use GitHub's private vulnerability reporting feature
3. Include a clear description of the vulnerability and steps to reproduce

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Model

This is a **local-first static application**. The security boundary is the user's browser and filesystem.

### What is protected

- **Internal pages** — SHA-256 hashed password gate (client-side)
- **User input** — all rendering passes through `escapeHtml()` to prevent XSS
- **Image URLs** — attribute-escaped before DOM injection
- **Data integrity** — pipeline audit tool validates release artifacts

### Known limitations

- Authentication is client-side only — it prevents casual access, not determined attackers with dev tools
- Data files are readable on disk — this is by design for a local-first tool
- No server-side validation exists (there is no server)

## Scope

The following are **in scope** for security reports:
- XSS vectors in any rendered listing, lead, or form data
- DOM injection through source data fields
- Authentication bypass that doesn't require dev tools
- Data pipeline manipulation that produces misleading public outputs

The following are **out of scope**:
- Client-side auth bypass via browser dev tools (known limitation)
- Physical access to the local filesystem
- Issues in third-party tile providers (CartoDB, OSM, Esri)
