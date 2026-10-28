#!/usr/bin/env bash
# Verifies `npm run dev` (Vite + API) end to end through the Vite proxy, including the realtime WebSocket.
cd "$(dirname "$0")/.."
for p in $(pgrep -f 'tsx.*(mock-slack|server/index)|vite|concurrently'); do kill "$p" 2>/dev/null || true; done
sleep 1
rm -rf data-test
sed -e 's#APP_URL=http://localhost:3000#APP_URL=http://localhost:5173#' .env.test > .env
echo "SLACK_WEB_BASE=http://localhost:4010" >> .env
MOCK_PUSH=rtm SLACK_SIGNING_SECRET=mock-signing-secret nohup npx tsx scripts/mock-slack.ts > /tmp/mock.log 2>&1 &
nohup npm run dev > /tmp/dev.log 2>&1 &
sleep 9
node --input-type=module -e "
import WebSocket from 'ws'
const APP='http://localhost:5173'
const blob=Buffer.from(JSON.stringify({token:'xoxc-1234567890-mock-web-token-abcdef',cookie:'xoxd-mockcookievalue0123456789abcdef%2Bxyz',host:'mock.slack.com'})).toString('base64url')
const r=await fetch(APP+'/auth/import',{method:'POST',headers:{'content-type':'application/json',origin:APP},body:JSON.stringify({blob})})
console.log('import via vite proxy:',r.status)
const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
const ws=new WebSocket('ws://localhost:5173/api/ws',{headers:{cookie,origin:APP}})
const got=[]; ws.on('message',d=>got.push(JSON.parse(d.toString()).type)); ws.on('error',e=>console.log('ws error',e.message))
await new Promise(r=>setTimeout(r,2500))
console.log('websocket through vite proxy, frames:',got.join(','))
process.exit(0)
"
for p in $(pgrep -f 'tsx.*(mock-slack|server/index)|vite|concurrently'); do kill "$p" 2>/dev/null || true; done
rm -f .env
