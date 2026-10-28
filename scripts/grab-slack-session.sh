#!/usr/bin/env bash
# Spins up a real browser, you sign in to Slack, and it prints the session blob for Sleck.
# First run installs Playwright (dev dependency) and, if you have no Chrome, a Chromium build.
set -e
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Node.js 22+ is required."; exit 1; }
[ -d node_modules/playwright ] || npm install --no-audit --no-fund
if ! node -e "require('playwright').chromium.executablePath()" >/dev/null 2>&1 || [ ! -e "$(node -p "require('playwright').chromium.executablePath()")" ]; then
  if ! command -v google-chrome >/dev/null && ! command -v chrome >/dev/null && [ ! -d "/Applications/Google Chrome.app" ]; then
    npx playwright install chromium
  fi
fi
exec node scripts/grab-slack-session.mjs "$@"
