#!/bin/bash
# Environment setup — idempotent, runs at start of each worker session

# Install dependencies
pnpm install --frozen-lockfile

# Verify TypeScript compiles
pnpm run typecheck

# Verify tests pass
pnpm test
