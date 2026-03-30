---
name: platform-docs-worker
description: Handles repo markdown, developer workflow, validation-command, and platform-truthfulness features for the Leagueback web mission.
---

# Platform Docs Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for features that primarily change:
- repository markdown,
- `.env.example`,
- `package.json` scripts,
- CI workflow truthfulness,
- local dev/validation workflow configuration,
- `.factory` workflow/service metadata tied to the platform feature itself.

## Required Skills

None.

## Work Procedure

1. Read the assigned feature, `mission.md`, `AGENTS.md`, `.factory/library/*.md`, and the files the feature is likely to change.
2. Identify the exact truth gaps first. For docs features, make a before/after checklist of every misleading statement to remove. For workflow features, list every broken or contradictory command before editing.
3. If the feature changes executable workflow (scripts, CI, services), verify the current failure mode first so the fix is grounded in observed behavior.
4. Add or adjust automated coverage where practical before implementation. For script/config/docs features that cannot reasonably be covered by tests, explicitly record that limitation in the handoff and rely on concrete command verification instead.
5. Make the smallest coherent set of edits needed to satisfy the feature without expanding into unrelated product work.
6. Re-read the changed markdown/config files for internal consistency:
   - package manager naming,
   - port usage,
   - supported commands,
   - web-only scope,
   - implemented vs backlog separation.
7. Before finishing, perform a truth-source checklist against the final repo state, not just the latest diff. Re-read at minimum:
   - `README.md`
   - `.env.example`
   - `package.json`
   - `.github/workflows/ci.yml`
   - any committed workflow helper scripts touched or introduced by the feature
   Confirm the required sections still exist, no duplicated/conflicting guidance remains, and no helper claims behavior broader than the committed workflow actually provides.
8. Run the relevant committed validators affected by the change. For workflow features, this usually means the full set from `.factory/services.yaml`.
9. If the feature changes the local startup workflow, manually verify the documented startup path and healthcheck.
10. Prepare a detailed handoff that names the exact files changed, commands run, and any remaining gaps.

## Example Handoff

```json
{
  "salientSummary": "Updated the repo docs to reflect the web-only Next.js app and fixed the committed Windows-safe dev/typecheck/lint workflow. README, ROADMAP, .env.example, package.json, CI, and .factory/services.yaml now agree on pnpm-based local setup and validation on port 3005.",
  "whatWasImplemented": "Rewrote README/ROADMAP sections that still implied desktop/native direction, removed the stray roadmap note, aligned .env.example with the current web architecture, replaced the POSIX-only dev script with a Windows-safe committed command, added truthful committed typecheck/lint/build/test commands, and updated CI plus service metadata so contributors and validators use the same workflow.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm run lint",
        "exitCode": 0,
        "observation": "Committed lint/static-check command completed successfully."
      },
      {
        "command": "pnpm exec tsc --noEmit",
        "exitCode": 0,
        "observation": "TypeScript check passed."
      },
      {
        "command": "pnpm test",
        "exitCode": 0,
        "observation": "Existing unit tests passed after workflow/docs changes."
      },
      {
        "command": "pnpm run build",
        "exitCode": 0,
        "observation": "Production build passed."
      },
      {
        "command": "powershell -NoProfile -Command \"$env:PORT=3005; pnpm exec next dev -p 3005\"",
        "exitCode": 0,
        "observation": "Local app started successfully on the documented mission port."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Manually read README, ROADMAP, and .env.example after edits",
        "observed": "All three files describe the web-only product truthfully and no longer mention desktop/native scope."
      }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- A truthful workflow fix would require a new dependency or tooling choice not already approved.
- The repo has contradictory package-manager or CI constraints that cannot be reconciled within the feature scope.
- A requested markdown change conflicts with the approved mission scope or would require product decisions the user has not made.
