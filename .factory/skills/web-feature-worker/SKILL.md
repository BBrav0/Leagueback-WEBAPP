---
name: web-feature-worker
description: Implements and verifies user-facing Leagueback web features across the dashboard, API routes, and supporting data mappers.
---

# Web Feature Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for features that change:
- dashboard UI or copy,
- route/search behavior,
- local persisted UI state,
- history filters/export behavior,
- match summary/detail data mapping,
- API routes or helpers that directly support those user-facing web features.

## Required Skills

- `agent-browser` — use for browser verification of user-facing changes whenever it is available on this host.

## Work Procedure

1. Read the assigned feature, `mission.md`, `AGENTS.md`, `.factory/library/*.md`, and the exact code paths the feature will touch.
2. Trace the current user flow before editing so you know what must be preserved (routing, mixed history loading, fallback states, persisted state, etc.).
3. Write failing tests first whenever the behavior can be covered with unit/component tests:
   - mapping helpers,
   - persistence helpers,
   - filter/export helpers,
   - route/state logic,
   - detail/fallback behavior.
4. Implement the smallest coherent change set that makes the new tests pass and preserves existing behavior.
5. For UI features, verify truthful copy and fallback behavior alongside the happy path. Placeholder text is not acceptable on mission-covered surfaces.
6. Use `agent-browser` to manually verify the real web flow on the configured mission port whenever it is available. If mission guidance documents an approved temporary fallback, use that fallback instead and capture explicit dev-server evidence plus the limits of what was not interactively proven. On this Windows host, if the documented stop helper fails through the exec wrapper, reuse the already-running validated server when safe or fall back to a plain `netstat` + `taskkill` port cleanup flow instead of inventing a new port.
7. Run the relevant validators during iteration, then the committed mission gates before finishing:
   - lint/static-check,
   - typecheck,
   - tests,
   - build if the change materially affects shipped app behavior or the worker-base guidance requires it.
   Do not skip the committed lint/static-check gate when it exists.
8. If the feature involves persisted state, verify refresh/revisit behavior and route precedence explicitly.
9. If the feature involves mixed stored-history plus older-history loading, verify both sources still behave correctly together.
10. Before claiming automated coverage for a new test file, confirm that the file is actually included by the committed test runner configuration. In this repo, be especially careful with Vitest include globs before adding route/component tests outside `lib/**`.
11. Prepare a handoff that makes shortcuts obvious: list tests added first, then commands, browser flows, and any discovered gaps.

## Example Handoff

```json
{
  "salientSummary": "Added recent Riot ID persistence plus route-safe re-selection, and verified that switching players now replaces prior dashboard state cleanly. Also added unit coverage for saved-lookup storage and browser-verified home search, deep-link auto-load, invalid lookup handling, and recent selection on the local web app.",
  "whatWasImplemented": "Created a local saved-lookup helper with dedupe/recency logic, wired it into the dashboard search flow, prevented failed lookups from being persisted, ensured selecting a saved Riot ID updates the route and reloads the player, and fixed stale state so switching to a different player replaces the prior player's history/error context instead of mixing identities.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm test",
        "exitCode": 0,
        "observation": "New storage/search flow tests and existing suites passed."
      },
      {
        "command": "pnpm exec tsc --noEmit",
        "exitCode": 0,
        "observation": "Type checking passed after dashboard and helper changes."
      },
      {
        "command": "pnpm run lint",
        "exitCode": 0,
        "observation": "Committed lint/static-check command passed."
      },
      {
        "command": "pnpm run build",
        "exitCode": 0,
        "observation": "Production build passed with the new search UI behavior."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Used browser automation on http://127.0.0.1:3005 to search for a valid Riot ID from `/`",
        "observed": "The app navigated to the player route and rendered the requested player's dashboard."
      },
      {
        "action": "Reloaded a deep-linked player route and then selected a saved Riot ID entry",
        "observed": "The explicit route loaded first, the saved entry re-ran the lookup correctly, and the route/player context stayed in sync."
      },
      {
        "action": "Triggered an invalid or incomplete identity case",
        "observed": "The UI showed a truthful failure state and the bad lookup was not saved."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "lib/saved-lookups.test.ts",
        "cases": [
          {
            "name": "deduplicates repeated successful lookups by Riot ID",
            "verifies": "Saved entries update recency instead of duplicating."
          },
          {
            "name": "does not persist failed lookups",
            "verifies": "Invalid identities are excluded from saved state."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The feature needs a new backend/external integration that is not already in scope.
- Required browser validation is blocked by an environment problem the worker cannot fix from within the feature.
- The requested UX behavior conflicts with the approved validation contract or needs a product decision (for example export scope or exact saved-lookup behavior) not already specified.
