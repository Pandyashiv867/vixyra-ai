# VIXYRA AI — Phase 6 Test Plan (and status)

## What "tested" means here

No stage is declared working from its file existing. Each stage must show
real output from the real tool, on a real story, verified with ffprobe /
file checks. Nothing is simulated.

## Test job (no LLM key needed)

- **Story:** bundled template — "The Girl Who Was Mailed To Grandma"
  (Tall Tale example, 52s, 20 lines, fact-checked, `vendor/tall-tale-example/`).
- **Why this story:** it is the skill's own proven example; it renders as-is.
  It proves the *pipeline*, not story generation. New-topic generation is
  tested separately once an LLM key is added (see below).
- **Entry point:** empty prompt via the UI / `POST /api/jobs {"prompt":""}`,
  or the manual equivalent in `jobs/test-template/project/`.

## Stage checklist

| Stage | Tool | Pass criteria | Status 2026-11-17 |
|---|---|---|---|
| health | `GET /api/health` | node/ffmpeg/ffprobe/chrome/voiceWhisper/template all `ok` | ✅ PASS — all ok, llm: false (no key, expected) |
| LLM gating | `POST /api/jobs` new topic, no key | job → `awaiting_llm`, clear error, no video, no fake | ✅ PASS — job 49a09b5efe4a, "Eiffel Tower" topic |
| script | template script.json | 20 lines, title, sources | ✅ PASS (vendored example) |
| voice | `voice.py` (Kokoro am_michael x1.05) | `data/narration.wav` exists, ~52s | ✅ PASS — 51.72s, 2.4 MB, 20 lines timed |
| words | `words.py` (Whisper small.en) | `data/words.json` exists | ✅ PASS — 151 words heard, 9.3 KB (2026-11-17, manual run) |
| check | `capture.mjs check` | output says `CHECK OK` | ✅ PASS — full caption list through 51.73s, CHECK OK (2026-11-17, manual run; took ~13 min in software GL) |
| cues-mix | `capture.mjs cues` + `tools/mix.py` | `data/cues.json` + `data/mix.wav` exist | ⚠️ NOT PROVEN in manual run — the test folder was deleted mid-run by mistake, so Node failed to start (`uv_cwd` ENOENT). Not a pipeline failure. Re-proven by the server job below. |
| frames proof | `capture.mjs frames` at 2.0 / 25.0 / 48.0s | 3 real JPEGs from the Three.js renderer | ⚠️ NOT PROVEN in manual run — same deleted-folder cause. Re-proven by the server job below (contact sheet + final video). |
| sheet-qa | `capture.mjs sheet review/all.jpg 0.5 10` | sheet exists, >100 KB, read visually | ⏳ RUNNING — server job 60912022838a (started 2026-11-17 12:33 UTC) |
| render | `capture.mjs video` split halves | both halves ffprobe-valid, full duration | ⏳ RUNNING — same server job; ~1 hr total |
| join | ffmpeg concat | `renders/vixyra.mp4` exists | ⏳ QUEUED — same server job |
| verify | ffprobe + volumedetect + seam frames | 1080×1920 H.264+AAC, duration ±1s, not silent | ⏳ QUEUED — same server job |
| download | `GET /api/jobs/:id/video` | MP4 downloads, plays | ⏳ QUEUED — same server job |

## Server job (the real Phase 6 test, on disk)

- **Job:** `60912022838a`, started 2026-11-17 12:33 UTC via `POST /api/jobs {"prompt":""}`.
- **Status:** `curl -s http://127.0.0.1:3000/api/jobs/60912022838a`
- **Video when done:** `curl -O http://127.0.0.1:3000/api/jobs/60912022838a/video`
- **Sheet when done:** `http://127.0.0.1:3000/api/jobs/60912022838a/sheet`
- All assets preserved in `~/workspace/vixyra-ai/jobs/60912022838a/` (project copy, renders, review, job.log).
- Eiffel note: Eiffel's finish pipeline was still waiting for frames at 12:14 UTC (no FINISH-DONE yet) when this job started; its join is ffmpeg-light, so it can finish alongside. Do not start a second render job while this one runs — the server queues one at a time.

## Why the full render is queued, not running

The Eiffel Tower video (user's active priority in the side chat) was
mid-fix-render when this build started. Its frames stopped being written
at 12:13 UTC 2026-11-17, but its capture processes were still listed, so
the full 52s template render (~1,560 frames, ~1 hr CPU) was NOT started
alongside it. Start it only when the Eiffel job is confirmed done:

```bash
curl -s -X POST http://127.0.0.1:3000/api/jobs \
  -H 'Content-Type: application/json' -d '{"prompt":""}'
# then watch: curl -s http://127.0.0.1:3000/api/jobs/<id>
# video when done: curl -O http://127.0.0.1:3000/api/jobs/<id>/video
```

## New-topic test (needs LLM key)

Once `LLM_API_KEY` is in `.env` and the server is restarted:

1. Submit a new true story topic (e.g. "He sold the Eiffel Tower. Twice.").
2. Expect: script stage produces `script.json` with sources; scenes stage
   produces `shots.js` that passes `CHECK OK` (≤3 fix attempts); the rest
   of the pipeline runs exactly as the template test.
3. Compare the finished MP4 with the Muse-built videos on: visual style
   (Tall Tale look, big heads, bright 3D sets), character consistency
   (same hat/outfit all video), animation (camera moving, faces reacting),
   storytelling (hook → twist → payoff), narration (clear, correct pace),
   sound (voice over music, SFX soft), transitions (hard cuts), final
   quality (captions 1–3 words, clear of faces, no flat-green placeholder
   backgrounds — the known weak spot from Dancing Plague).
4. If `shots.js` fails CHECK OK 3 times, the job fails with the real
   error — that is a result, not a reason to fake a video. Fix the prompt
   / model / kit reference and retry.

## Known limits (v1)

- One job at a time; no parallel renders.
- QA vision check is programmatic-only without a vision-capable LLM.
- No YouTube upload in v1 (download the MP4).
- Docker image needs the faceless-shorts skill copied to `./skill` at
  build time (see Dockerfile / README).
- The server in this workspace is a dev server on 127.0.0.1:3000, not a
  public host. Put it behind a proper host / reverse proxy to share it.
