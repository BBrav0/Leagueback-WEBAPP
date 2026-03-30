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
