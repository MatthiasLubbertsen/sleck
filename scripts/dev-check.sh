#!/usr/bin/env bash
# Verifies `npm run dev` (Vite + API) works end to end through the Vite proxy against the mock Slack.
cd "$(dirname "$0")/.."
for p in $(pgrep -f 'tsx.*(mock-slack|server/index)|vite|concurrently'); do kill "$p" 2>/dev/null || true; done
sleep 1
rm -rf data-test
sed -e 's#APP_URL=http://localhost:3000#APP_URL=http://localhost:5173#' .env.test > .env
SLACK_SIGNING_SECRET=mock-signing-secret APP_URL=http://localhost:5173 nohup npx tsx scripts/mock-slack.ts > /tmp/mock.log 2>&1 &
nohup npm run dev > /tmp/dev.log 2>&1 &
sleep 9
tail -6 /tmp/dev.log
J=/tmp/jar2.txt; rm -f $J
L=$(curl -s -c $J -b $J -o /dev/null -w '%{redirect_url}' localhost:5173/auth/login)
CB=$(curl -s -o /dev/null -w '%{redirect_url}' "$L")
echo "callback url: $CB"
curl -s -c $J -b $J -o /dev/null -w 'callback status %{http_code} -> %{redirect_url}\n' "$CB"
echo -n "bootstrap via vite proxy: "; curl -s -b $J localhost:5173/api/bootstrap | head -c 100; echo
echo -n "index served by vite: "; curl -s localhost:5173/ | grep -c 'src/main.tsx'
for p in $(pgrep -f 'tsx.*(mock-slack|server/index)|vite|concurrently'); do kill "$p" 2>/dev/null || true; done
rm -f .env
