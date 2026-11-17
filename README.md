---
title: VIXYRA AI
emoji: 🎬
colorFrom: purple
colorTo: blue
sdk: docker
pinned: false
app_port: 7860
---

# VIXYRA AI

Independent stick-story Shorts generator — the faceless-shorts / Tall Tale 3D
workflow, converted into a standalone web app. One big typing box, one
Generate button. Real pipeline, real MP4. Nothing is simulated.

## What it does

Type a story, idea, or topic — or leave it empty / write "Create a video and
let AI choose the story" — and hit **Generate Video**. The server queues one
job at a time and runs, in order:

1. **intake** — resolves template vs new-topic mode
2. **script** — LLM writes a 60s Ricks-style script as `script.json` (or the
   bundled template script is used)
3. **voice** — Kokoro `am_michael`, local, free (`scripts/voice.py`)
4. **words** — faster-whisper `small.en` word timings, local
5. **scenes** — LLM writes `src/shots.js` from the Tall Tale kit (or the
   template's own shots.js), verified with `CHECK OK` (up to 3 fix attempts)
6. **check** — `node tools/capture.mjs check` must say `CHECK OK`
7. **cues-mix** — `cues` + `tools/mix.py` (narration + SFX + music bed)
8. **sheet-qa** — contact sheet every 0.5s, programmatic checks; vision QA
   only when a vision-capable LLM is configured, otherwise honestly recorded
   as programmatic-only + human review of the sheet
9. **render** — split halves, resume valid halves (resilient renders)
10. **join** — ffmpeg concat, no re-encode
11. **verify** — ffprobe duration/codec/1080×1920, volumedetect (not silent),
    seam frames either side of the join
12. **done** — video player + working MP4 download; all assets kept in
    `jobs/<id>/` (project copy, renders, review, log)

## Without an LLM key

New topics need `LLM_API_KEY` in `.env` (OpenAI-compatible chat
completions — see `.env.example`). Without it, a new-topic job goes to
`awaiting_llm` and says so plainly. It never fakes a script, scene code,
or video.

What DOES run without a key: the **bundled template job** — the skill's own
Tall Tale example, "The Girl Who Was Mailed To Grandma" (52s, fact-checked,
in `vendor/tall-tale-example/`). Submit an empty prompt, "demo", "test",
or "Create a video and let AI choose the story" and the full pipeline runs
for real on that proven story. That is the Phase 6 test path until a key
is added.

## Ollama (free, no key — recommended)

New topics need a model to write the script and scene code. Instead of a
paid key, run a free open model on your own machine with
[Ollama](https://ollama.com). Each machine runs its own model, so there is
no shared key and no shared token limit — ten users means ten machines,
each with its own model. That is the scaling answer.

```bash
# 1. Install Ollama (Linux/macOS/Windows) from https://ollama.com
# 2. Pull a model (one-time download, ~4.7 GB for 7B):
ollama pull qwen2.5:7b
# 3. Make sure the Ollama server is running (it starts automatically
#    after install; otherwise run `ollama serve` in a terminal)
# 4. Point the site at it in .env — no server code changes:
LLM_API_KEY=ollama
LLM_API_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=qwen2.5:7b
# 5. Restart the server: node server.mjs
```

Notes: `qwen2.5:7b` is the default — good balance of story writing and
scene code. A smaller `qwen2.5:3b` (~2 GB) also works but writes weaker
scripts and buggier scene code; the pipeline retries failed scenes up to
3 times, which covers most of it. On a weak machine, generation is slower
(a few minutes per job) — the render already takes ~1 hour, so this is
not the bottleneck. A paid key (OpenAI/Groq/Gemini, see `.env.example`)
is still supported: change the three `LLM_*` lines and restart.

## Run it here

```bash
cd ~/workspace/vixyra-ai
bash scripts/setup.sh     # checks Node 22+, ffmpeg, Chrome, Kokoro/Whisper
cp .env.example .env      # add LLM_API_KEY for new topics (optional for demo)
node server.mjs           # http://127.0.0.1:3000
```

A full 60s render takes roughly an hour on a CPU-only box (software GL,
~2s/frame). The UI shows live stage + progress; the server runs one job
at a time so renders don't fight each other.

## Deploy (real host — a link that works from any device)

The Dockerfile is ready and the skill is vendored in `./skill`, so the
build is self-contained. The server reads `HOST`/`PORT` from the
environment and listens on `0.0.0.0` in the container.

```bash
docker build -t vixyra-ai .
docker run -p 3000:3000 -v vixyra-jobs:/app/jobs \
  -e LLM_API_KEY=gsk_your_groq_key \
  -e LLM_API_BASE_URL=https://api.groq.com/openai/v1 \
  -e LLM_MODEL=openai/gpt-oss-120b \
  vixyra-ai
```

The image installs Node 22, ffmpeg, Python 3, Chromium and the Python
voice/whisper packages, then runs `scripts/setup.sh` (downloads Kokoro
~340 MB + Whisper small.en ~0.5 GB, both free). See `Dockerfile`.

**One-click options (no server to manage):**
- **Render** — `render.yaml` is in the repo (Blueprint). In the Render
  dashboard: New > Blueprint > connect the repo, then set `LLM_API_KEY`
  (free Groq key) in the dashboard. Use plan **Standard (2 GB)** or
  higher — see below.
- **Railway** — `railway.json` is in the repo. `railway up` from the
  project, or connect the repo in the dashboard; set the same three
  `LLM_*` variables. Give the service at least 2 GB of memory.

**Honest costs and limits:**
- The website UI alone runs anywhere, but a render needs headless Chrome
  + voice models: ~2–3 GB of RAM and ~1 hour of CPU per 60s video.
  Free tiers (512 MB) **will crash on renders**. Budget roughly
  $10–25/month for a host that can actually render (Render Standard,
  Railway with 2 GB+, or a small VPS such as Hetzner CX22).
- The LLM on a hosted site should be a cloud key, not local Ollama:
  a 4.7 GB model on the server is heavy, and one server-side model is
  still shared by all visitors. Use the **Groq free tier** (no card) —
  see `.env.example` Option B. The Ollama path stays the answer for
  self-hosted/laptop use, where each user runs their own model.
- One job runs at a time on the server; other users' jobs queue behind
  it. Videos and assets live in `jobs/<id>/` (mount a volume so they
  survive restarts).

## API

- `GET /api/health` — node/ffmpeg/ffprobe/chrome/voice+whisper/template/llm
- `POST /api/jobs {prompt}` → job (201)
- `GET /api/jobs` / `GET /api/jobs/:id`
- `GET /api/jobs/:id/video` — MP4 download
- `GET /api/jobs/:id/sheet` — contact sheet JPG
- `GET /api/jobs/:id/log` — job log
- `POST /api/jobs/:id/retry` — re-run from scratch, reusing valid render halves

## Source of truth

`PHASE1-STUDY.md` — the workflow audit. The skill files are not copied
into this repo's logic; the pipeline shells out to the real faceless-shorts
scripts and kit (`FACELESS_SKILL`, default
`~/workspace/custom-skills/faceless-shorts`), and vendors only the Tall
Tale example as the template. No AI images or video are generated, per
the skill's "Never" list. YouTube upload is NOT in v1 — download the MP4
and upload it yourself, or add the Studio flow later.
