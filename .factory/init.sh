#!/usr/bin/env sh
set -eu

if [ ! -d node_modules ]; then
  pnpm install --frozen-lockfile
fi
