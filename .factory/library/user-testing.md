# User Testing

Validation surface, setup notes, and concurrency guidance for this mission.

---

## Validation Surface

### Browser surface

- Primary surface: local Next.js web app.
- Preferred validation port: `3005`.
- Primary routes:
  - `/`
  - `/player/{gameName}#{tagLine}`
- Use browser-based validation for user-facing work after the local startup workflow is stable.
- Temporary mission exception: the user approved a fallback of tests plus dev-server evidence while `agent-browser` is unavailable on this Windows host due a local bind-permission error.

### Terminal surface

- Hard gates:
  - `pnpm exec tsc --noEmit`
  - `pnpm test`
  - `pnpm run build`
- `.factory/services.yaml` currently maps `lint` to the same static TypeScript check as a temporary truthful baseline; the workflow-fix feature is expected to replace this with the repo's final committed lint/static-check command.

## Validation Readiness

- Dry run confirmed:
  - tests pass,
  - build passes,
  - the app can start locally on `3005` with a Windows-safe command.
- Initial repo state caveats:
  - committed `npm run dev` was not Windows-safe,
  - committed lint workflow was not truthful/runnable for the installed Next.js version.
- Milestone `docs-platform` is expected to fix those workflow issues before later browser-heavy milestones validate.
- Mid-mission update: `agent-browser` is currently blocked on this host by a local bind-permission error, so workers may use the approved tests-plus-dev-server-evidence fallback until browser automation is restored.

## Validation Concurrency

### Browser validators

- Max concurrent browser validators: **5**
- Rationale:
  - machine has 24 logical cores,
  - roughly 15 GB of free RAM was observed during planning,
  - 70% of that headroom leaves about 10.5 GB usable validation budget,
  - this web app is lightweight enough that 5 concurrent browser sessions plus one local dev server should fit comfortably within that budget.

### Terminal validators

- Max concurrent terminal validator groups: **3**
- Rationale:
  - build/test/typecheck are CPU-heavy enough to avoid oversaturating the host,
  - keeping terminal validation to 3 concurrent groups leaves headroom for the app server and browser validators.

## What validators should pay special attention to

- Route precedence vs persisted UI state
- Stored-history loading vs appended older-history loading
- Truthful fallback copy instead of placeholders
- Missing raw detail data in the match-details surface
- Returning-player searches where Supabase already has stored history, so freshness reconciliation must be proven against existing DB-backed data instead of a first-load/new-player path
- When browser automation is unavailable, capture equivalent dev-server evidence and state clearly which interactions were validated through the approved fallback path
- For the match-card metadata follow-up, validate through the stored-history route the user actually sees: confirm `/api/stored-matches` and the rendered cards show persisted role/damage metadata plus truthful current-rank copy, not transient analysis-only values.

## Returning-player freshness validation note

- Preferred live validation account for the current data-freshness follow-up: `Bumsdito#3005` in the `LeagueBack` Supabase project.
- Expected evidence pattern:
  1. `/api/account` resolves the existing stored player,
  2. `/api/stored-matches` shows existing DB-backed history,
  3. `/api/match-history` returns live Riot IDs through the Cloudflare proxy,
  4. the search/reconciliation path refreshes DB-backed history without duplicates,
  5. stale-row-only refreshes still update the visible dashboard state.

## Flow Validator Guidance: browser

- Use the shared local app at `http://127.0.0.1:3005`.
- For docs-platform validation, prefer direct file/terminal evidence over UI automation because the assertions are workflow/docs truthfulness checks.
- Do not mutate application data or local persisted browser state unless an assertion explicitly requires it.
- Treat port `3005` as the only supported validation target for this milestone.
- If port `3005` is already occupied, either intentionally reuse the running app after confirming it serves the current repo or free the listener with the documented `cmd`/`netstat` stop helper from `.factory/services.yaml` before starting a new session.
- If recent runtime behavior contradicts direct API checks or freshly landed fixture logic, restart the local app from the manifest before marking an assertion blocked so validators do not rely on stale dev-server state.

## Flow Validator Guidance: terminal

- Read-only validation commands may run concurrently up to the terminal concurrency cap, but avoid overlapping multiple production builds on this machine.
- For docs-platform validation, use terminal commands only to confirm startup, healthcheck, and committed validator behavior.
- Do not edit source or config files from a flow validator; report mismatches instead.
