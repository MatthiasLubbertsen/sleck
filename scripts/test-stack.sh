#!/usr/bin/env bash
# Start mock Slack + the built app for e2e. Usage: scripts/test-stack.sh [oauth|web]
#   oauth: sign in via OAuth, live updates arrive through the signed Events API
#   web:   sign in by importing a browser session (xoxc + d cookie), live updates arrive over RTM
cd "$(dirname "$0")/.."
MODE=${1:-oauth}
for p in $(pgrep -f 'tsx.*(mock-slack|server/index)' || true); do kill "$p" 2>/dev/null || true; done
sleep 1
rm -rf data-test
if [ "$MODE" = web ]; then
  export MOCK_PUSH=rtm
  export SLACK_WEB_BASE=http://localhost:4010
fi
SLACK_SIGNING_SECRET=mock-signing-secret nohup npx tsx scripts/mock-slack.ts > /tmp/mock.log 2>&1 &
nohup npx tsx --env-file=.env.test server/index.ts > /tmp/app.log 2>&1 &
for _ in $(seq 1 40); do
  if curl -sf localhost:3000/healthz > /dev/null && curl -sf localhost:4010/files/x > /dev/null; then echo "stack up ($MODE)"; exit 0; fi
  sleep 0.5
done
echo "stack failed to start"; cat /tmp/app.log /tmp/mock.log; exit 1
