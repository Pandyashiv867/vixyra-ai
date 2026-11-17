#!/bin/bash
# VIXYRA AI setup — checks the tools the real pipeline needs.
# Reuses the faceless-shorts setup for the voice/whisper models.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL="${FACELESS_SKILL:-$HOME/workspace/custom-skills/faceless-shorts}"
ok=1
command -v node >/dev/null && node -e "process.exit(+process.version.slice(1).split('.')[0] < 22 ? 1 : 0)" 2>/dev/null && echo "node ok ($(node -v))" || { echo "node MISSING or < 22"; ok=0; }
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null && echo "ffmpeg ok" || { echo "ffmpeg MISSING"; ok=0; }
if [ -n "${CHROME:-}" ] && [ -x "$CHROME" ]; then echo "chrome ok ($CHROME)";
elif [ -x "$ROOT/../japan-trains-short/chrome-wrapper.sh" ]; then echo "chrome ok (Hatch wrapper) — set CHROME=\$HOME/workspace/japan-trains-short/chrome-wrapper.sh in .env";
elif command -v google-chrome >/dev/null || command -v chromium >/dev/null; then echo "chrome ok";
else echo "chrome MISSING (install Google Chrome or set CHROME=)"; ok=0; fi
if [ -x "$SKILL/scripts/setup.sh" ]; then
  echo "running faceless-shorts setup (Kokoro + Whisper, ~0.9 GB, free)…"
  bash "$SKILL/scripts/setup.sh" || ok=0
else echo "faceless skill NOT FOUND at $SKILL — set FACELESS_SKILL"; ok=0; fi
[ -f "$ROOT/vendor/tall-tale-example/script.json" ] && echo "template ok" || { echo "template MISSING"; ok=0; }
[ $ok = 1 ] && echo "All set" || { echo "Fix the MISSING items above, then re-run."; exit 1; }
