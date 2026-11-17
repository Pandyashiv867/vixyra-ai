# VIXYRA AI — Phase 1 Study: Existing Workflow Audit

Date: 2026-11-17
Source of truth: existing skill.md files — NOT recreated, NOT simplified.

## Skills read in full

1. `~/workspace/custom-skills/faceless-shorts/SKILL.md`
   - 6 styles. Production style for VixyraShorts is **Tall Tale 3D**.
   - `styles/tall-tale/STYLE.md` read in full.
2. `~/workspace/custom-skills/viral-25d-explainer-short-v2/SKILL.md`
   - Spec only. **No kit/ included.** Only SKILL.md was uploaded.
   - 60s (also 25–35s), 1080x1920, 30fps, bean-head stick-limb characters in true 3D sets, 4–5 sets, 12–18-frame cross-dissolves, sentence-case 1–2-word captions at y=1350, mastered -14 LUFS, music/SFX at 50% of voice.
3. `~/workspace/custom-skills/resilient_video_renders/SKILL.md`
   - Split long renders into halves/chunks, verify each half with ffprobe, join with ffmpeg concat, verify seam + audio.
4. `~/shorts/ricks-clips-style-guide.md`
   - Studied from 3 Ricks Clips Shorts + vidIQ transcripts. 60–65s, ~160–190 words, cold-open impossible claim in first 2s, "You see," bridge, dialogue + laughing rival, twist + mechanism at end, huge round white heads, bright saturated 3D sets, hard cuts, 1–3-word sentence-case captions lower third, loop back to opening image. Plus 2026-11-17 quality upgrade (5 defects/fixes).

## Current production workflow (verified against real projects)

Projects live in `~/faceless-shorts/<slug>/`, e.g. dancing-plague-1518, emu-war, yamaguchi-double-survivor, sold-the-eiffel-tower (rendering at time of study — do not disrupt).

1. **Intake** — topic / idea, or "you pick". Length default ~30s (faceless) / 60–65s (Ricks/Vixyra). Voice default `am_michael`, speed 1.05–1.12. Music `"bounce"`.
2. **Research + fact-check** — done by Muse AI via web search. Facts + sources listed in `script.json` "sources". Numbers use majority-source wording; disputed numbers are NOT used.
3. **Script** — Muse AI writes narration (~90–110 words for 35s; ~160–190 words for 60s Ricks style). One line = one CUT (1.5–3.5s per cut). Hook first, escalation, twist, punchline / loop-back ending. For Vixyra: ends with subscribe CTA.
4. **`script.json`** — lines + caption chunks (`caps`, `|` separators), `voice`, `speed`, `music`, `title`, `sources`. Example: Dancing Plague, 19 lines, voice am_michael, speed 1.12, music bounce.
5. **Voice** — `scripts/voice.py` → Kokoro ONNX, local, free. ~340 MB model. No API key, no credits.
6. **Word timing** — `scripts/words.py` → faster-whisper `small.en` (~0.5 GB), local. Produces `words.json`, `cues.json`, `lines.json`.
7. **Scene code** — Muse AI writes custom `src/shots.js` per story from the Tall Tale kit (`src/core/engine.js`, `toon.js`, `world.js`, `props.js`, `captions.js`). People are 2D Toon cut-outs (big round heads, stick limbs, hats mark roles) inside sunny 3D Three.js sets. 4–5 sets, camera always moving, faces react on beats. This is the hardest step to automate: it is creative code generation, not a fixed template.
8. **Check** — `node tools/capture.mjs check` must say CHECK OK.
9. **Cues + mix** — `node tools/capture.mjs cues`, then `tools/mix.py` (voice + music bed + SFX: pop, plop, boing, stamp, ding, chirp, chug, whoosh).
10. **QA contact sheet** — `node tools/capture.mjs sheet review/all.jpg 0.5 10` (frame every 0.5s). Muse AI reads the whole sheet visually and judges the 5-point quality upgrade: hero ≥25% frame height, textured ground + set dressing, multi-part detailed props, warmer light + stronger shadows + higher saturation, varied crowd. Fix, re-sheet, re-check. Never ship a frame not looked at.
11. **Render** — `node tools/capture.mjs video renders/<name>.mp4`, headless Chrome + Three.js WebGL + ffmpeg. Software GL ≈2–3 s/frame. 60s at 30fps = ~1,800 frames ≈ 1 hour. Split into halves/chunks, verify each half with ffprobe, join with ffmpeg concat (no re-encode), verify duration/size/codec/1080x1920, volumedetect audio, check seam frames.
12. **Deliver / upload** — MP4 + title + caption + 5–8 hashtags. YouTube upload via browser in YouTube Studio (VixyraShorts, Public) — no YouTube connector; needs Google sign-in. Instagram reels via separate timed-post flow.

## Tools / models / APIs actually used

| Step | Tool | Runs where | Cost / key |
|---|---|---|---|
| Research + script + shots.js + QA judging | Muse AI (LLM + vision) | Muse agent | No key in skill; this IS the agent |
| Voice | Kokoro ONNX, voice am_michael | Local Python venv `~/.faceless-shorts/venv` | $0, ~340 MB download |
| Word timing | faster-whisper small.en | Local Python | $0, ~0.5 GB download |
| Rendering | Three.js r160 (vendored), headless Chrome, Playwright-style capture.mjs | Local Node 22+ + Chrome | $0 |
| Editing / mux | ffmpeg / ffprobe 8.1 | Local | $0 |
| Music / SFX | Built-in beds + numpy-synthesised SFX | Local | $0, royalty-free built-in |
| Images / video AI | NONE — explicitly forbidden by skill ("Never generate images or video with AI") | — | — |
| YouTube upload | Browser / YouTube Studio, or Zapier upload_video (skill §5b, validated 2026-11-03, needs temp file host) | Browser / Zapier | User sign-in required |

Setup: `bash scripts/setup.sh` until "All set" (Node 22+, ffmpeg, Chrome, venv with numpy/scipy/kokoro-onnx/faster-whisper, Kokoro + Whisper downloads, ~0.9 GB total). Verified working in this workspace: Node v24.22.1, ffmpeg 8.1.2, Python 3.12.3.

## What CAN run independently in a website backend

- Everything from `script.json` onward is already executable code: voice.py, words.py, capture.mjs, mix.py, ffmpeg join/verify. These can run in a server worker unchanged, given Node + Chrome + ffmpeg + Python + the vendored Three.js kit + the Tall Tale kit.
- Queue + job status + MP4 download + asset preservation are standard web-backend work.
- Render splitting / resume / retry is already specified by resilient_video_renders.

## What CANNOT run independently as-is (the gaps)

1. **Story / script / fact-check** — currently Muse AI, not code. Website needs an LLM API (OpenAI / Anthropic / Gemini or similar) with a key, plus web-search for fact-checking. No LLM API key is on file in memory. This is a new paid dependency; cost depends on provider.
2. **Custom `shots.js` per story** — currently Muse AI writes Three.js scene code from the kit. Website needs the same LLM to generate constrained shot code from the kit API, with a check → fix loop (CHECK OK, contact-sheet QA). This is the highest-risk automation step. A fixed template alone will NOT match current quality.
3. **Visual QA judging** — currently Muse AI looks at the contact sheet. Website needs either (a) vision-capable LLM API to judge the sheet against the 5-point upgrade, or (b) programmatic checks (framing, caption overlap, face position) + human review step.
4. **Viral-25d skill has no kit** — do NOT build the website on it as a renderer. Build on the Tall Tale 3D kit (the one actually producing VixyraShorts videos), with viral/Ricks rules layered on as script + caption + set rules.
5. **Hosting** — a static web artifact / Space cannot run 1-hour Chrome renders. Needs a real server / VM with Node 22+, Chrome, ffmpeg, Python, ~1 GB models, disk for frames + MP4s, and a job queue. This sandbox is not a production host.
6. **Voice note on viral skill** — it mentions ElevenLabs (speed 1.08–1.15, stability 45%) for voiceover tips, but actual Vixyra builds use local Kokoro am_michael. Keep Kokoro as default ($0); ElevenLabs is a paid optional alternative, not the current workflow.

## Website architecture implied by Phase 1

- **Frontend (ONE interface):** one large typing box + one Generate Video button. Input accepts a story, short idea, topic, or "Create a video and let AI choose the story" (then the backend picks from 10 generated ideas, Ricks Archetype A/B).
- **Backend API:** POST /jobs {prompt} → job id; GET /jobs/:id status (queued / scripting / voicing / building scenes / QA sheet / rendering x% / joining / verifying / done / failed); GET /jobs/:id/video (MP4 download); GET /jobs/:id/sheet (contact sheet); assets preserved per job.
- **Worker pipeline (same as § above, in order):** LLM research+script → script.json → Kokoro voice → Whisper words → LLM shots.js (kit-constrained) → check → cues → mix → contact sheet → LLM-vision QA (fix loop, max N) → split render → join → verify (ffprobe, volumedetect, seam frames) → deliver MP4.
- **No faking:** every stage must report real status from real tool output; failures surface with the actual error + safe retry of only the failed stage.

## Decisions needed before Phase 2 build

1. LLM provider + API key for script + shots.js + QA (who provides the key, which provider, budget cap?).
2. Hosting target: build as a deployable project in the workspace first (recommended), or deploy straight to a named host/VPS?
3. Keep Kokoro local voice as default? (Recommended: yes.)
4. YouTube upload in v1, or MP4 download only in v1?
5. "Let AI choose" topic picker: use the viral skill's 10-idea format, pick automatically?

## Phase 1 verdict

Workflow understood and mapped. Do NOT start Phase 2 implementation until decisions 1–2 above are answered — they determine the backend LLM integration and where the render worker lives.
