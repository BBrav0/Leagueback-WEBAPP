# Product Scope

Mission-specific product scope and worker-facing backlog framing.

---

## Current shipped web surfaces

- Riot ID search
- Route-driven player pages
- Stored-history loading plus older-history expansion
- Match summary cards with charts
- Impact statistics panels

## Mission deliverables

- Truthful web-only markdown/docs
- Windows-safe local workflow and truthful validation commands
- Saved/recent lookup UX
- Enriched match cards and truthful rank fallback
- Match details/scoreboard UX
- History filters, persisted preferences, reset controls
- Loaded-history export
- Web-only copy and fallback-state polish
- Returning-player freshness fixes that reconcile existing DB-backed history against Riot and keep the live LeagueBack database aligned with current app behavior
- Match-card metadata follow-up so stored DB-backed cards preserve role/damage context and can show a truthful current-rank snapshot when Riot rank data is available
- PR review remediation covering query safety/performance, truthful lint workflow restoration, migration backfill safety, dashboard maintainability cleanup, fixture hardening, and small repo hygiene fixes explicitly requested before merge

## Explicit exclusions

- No impact algorithm changes
- No desktop/native/Electron work
- No new third-party product surfaces
