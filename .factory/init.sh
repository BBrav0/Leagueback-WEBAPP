#!/bin/bash
set -e
cd "$(dirname "$0")/.."

if [ ! -d "node_modules" ] || [ "pnpm-lock.yaml" -nt "node_modules/.modules.yaml" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

echo "Environment ready."
