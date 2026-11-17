#!/bin/bash
# Smoke test: start the server, check health, create a template job and
# confirm it is queued/running. Does NOT wait for the full render.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
(node server.mjs > /tmp/vixyra-server.log 2>&1 & echo $! > /tmp/vixyra-server.pid)
sleep 2
echo "--- health ---"
curl -s http://127.0.0.1:3000/api/health; echo
echo "--- create template job ---"
curl -s -X POST http://127.0.0.1:3000/api/jobs -H 'Content-Type: application/json' -d '{"prompt":""}'; echo
echo "--- jobs ---"
curl -s http://127.0.0.1:3000/api/jobs | head -c 600; echo
echo "Server log:"; tail -5 /tmp/vixyra-server.log
echo "Stop it with: kill \$(cat /tmp/vixyra-server.pid)"
