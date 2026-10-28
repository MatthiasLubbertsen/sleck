#!/usr/bin/env bash
# Measures resident memory of the production server bundle: idle, then with a signed-in session,
# an RTM upstream socket, and several browser WebSockets. Needs `npm run build`.
cd "$(dirname "$0")/.."
for p in $(pgrep -f 'tsx.*(mock-slack|server/index)|dist/server/index'); do kill "$p" 2>/dev/null || true; done
sleep 1
D=$(mktemp -d)
MOCK_PUSH=rtm SLACK_SIGNING_SECRET=x nohup npx tsx scripts/mock-slack.ts > /tmp/mock.log 2>&1 &
set -a; . ./.env.test; set +a
export NODE_ENV=production DATA_DIR=$D SLACK_WEB_BASE=http://localhost:4010 PORT=3000
nohup node --disable-warning=ExperimentalWarning dist/server/index.mjs > /tmp/app.log 2>&1 &
sleep 3
PID=$(pgrep -f 'node --disable-warning=ExperimentalWarning dist/server/index.mjs' | head -1)
rss() { awk '/VmRSS/ {printf "%.0f MB", $2/1024}' /proc/$PID/status; }
echo "idle, no sessions:            $(rss)"
node --input-type=module -e "
import WebSocket from 'ws'
const APP='http://localhost:3000'
const blob=Buffer.from(JSON.stringify({token:'xoxc-1234567890-mock-web-token-abcdef',cookie:'xoxd-mockcookievalue0123456789abcdef%2Bxyz',host:'mock.slack.com'})).toString('base64url')
const r=await fetch(APP+'/auth/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({blob})})
const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
await fetch(APP+'/api/bootstrap',{headers:{cookie}})
await fetch(APP+'/api/emoji',{headers:{cookie}})
const socks=[]
for(let i=0;i<3;i++){const w=new WebSocket('ws://localhost:3000/api/ws',{headers:{cookie,origin:APP}});w.on('message',()=>{});socks.push(w)}
for(let i=0;i<300;i++){await fetch('http://localhost:4010/__inject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({channel:'C0000001',text:'load '+i})})}
await new Promise(r=>setTimeout(r,1500))
const fs=await import('node:fs')
console.log('with session + RTM + 3 tabs + 300 events: '+Math.round(Number(fs.readFileSync('/proc/'+process.argv[1]+'/status','utf8').match(/VmRSS:\s+(\d+)/)[1])/1024)+' MB')
process.exit(0)
" "$PID"
sleep 2
echo "settled after load:           $(rss)"
for p in $(pgrep -f 'tsx.*mock-slack|dist/server/index'); do kill "$p" 2>/dev/null || true; done
rm -rf "$D"
