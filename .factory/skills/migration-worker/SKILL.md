---
name: migration-worker
description: Worker for migrating Next.js from Vercel to Cloudflare Workers
---

# Migration Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving removing Vercel dependencies, adding Cloudflare adapter/config, adapting code for Workers runtime, and verifying builds.

## Required Skills

None.

## Work Procedure

1. **Read the feature description carefully.** Understand exactly what files need to change.
2. **Read all affected files first** before making changes.
3. **For dependency changes:** Use `pnpm add` / `pnpm remove`. This project uses pnpm, NOT npm.
4. **For process.env fixes:** Move reads from module scope into the functions that use them. Use lazy initialization patterns.
5. **Run tests:** `pnpm test` to verify no regressions.
6. **Run build:** First `pnpm exec next build`, then `pnpm exec opennextjs-cloudflare build`.
7. **Search for remaining Vercel references:** grep for `@vercel` in source directories.
8. **Commit and push** with clear message.

## Example Handoff

```json
{
  "salientSummary": "Removed @vercel/analytics, installed @opennextjs/cloudflare + wrangler, created wrangler.jsonc and open-next.config.ts, added .npmrc, updated .gitignore and package.json scripts. Build verified passing.",
  "whatWasImplemented": "Complete Cloudflare adapter setup with all config files and dependency changes.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "pnpm exec next build", "exitCode": 0, "observation": "12 pages generated" },
      { "command": "pnpm exec opennextjs-cloudflare build", "exitCode": 0, "observation": "worker.js produced" }
    ],
    "interactiveChecks": []
  },
  "tests": { "added": [] },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Build fails with adapter incompatibility
- Package install fails
- Tests break due to migration changes
