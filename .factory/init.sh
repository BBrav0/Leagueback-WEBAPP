#!/bin/bash
set -e

# Install dependencies (idempotent)
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
