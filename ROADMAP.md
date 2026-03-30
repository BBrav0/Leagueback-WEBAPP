# Leagueback Roadmap

This roadmap documents the shipped web app behavior and the future work still
outstanding for Leagueback as a browser-first product.

## Product Scope

- Web-only Next.js application.
- No desktop, mobile-native, Electron, or C# delivery is in active scope.
- Core priority: ship truthful web UX and data behavior before platform expansion.

## ✅ Implemented

- Player account lookup with deep-linkable web routes (`/player/{gameName}#{tagLine}`).
- Ranked match history loading with incremental append controls.
- Impact category classification and summary dashboard charts.
- Timeline and lifetime analytics visuals.
- Supabase-backed caching and API orchestration for Riot lookup/match data.

## 🔧 Backlog (future work)

- Match-card detail and metadata improvements (e.g., richer rank/context visibility and
  truthful empty/fallback states).
- Search and history experience quality:
  - Saved lookups persistence and route-behavior reliability.
  - Filter and display preference persistence.
- Match details surfaces, filtering, and export workflows.
- API/data-path robustness and observability improvements.

## Notes

- Items are ordered by web product value, not by external integrations or platform
  packaging.
- Community feedback is welcome through GitHub issues for upcoming milestones.