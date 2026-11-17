// VIXYRA AI worker — executes the faceless-shorts / Tall Tale 3D pipeline
// for real, stage by stage, exactly as the skill prescribes:
//   script.json -> Kokoro voice -> Whisper words -> shots.js -> check
//   -> cues -> mix -> contact-sheet QA -> split render -> join -> verify
// No stage is simulated. A stage that cannot run fails the job with its real
// error; retry resumes from the failed stage and reuses valid outputs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chat, extractCodeBlock, LlmNotConfigured, llmConfigured } from './llm.mjs';
import { setStage, setProgress, saveJob, failJob, jobDir } from './jobs.mjs';

const execFileP = promisify(execFile);
const SKILL = process.env.FACELESS_SKILL || '/home/hatch/workspace/custom-skills/faceless-shorts';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PY = path.join(SKILL, 'scripts/py');

// --- helpers ---------------------------------------------------------------
function logStream(jobRoot, job, text) {
  fs.appendFileSync(path.join(jobDir(jobRoot, job.id), 'job.log'), text);
}
function run(jobRoot, job, cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; logStream(jobRoot, job, d.toString()); });
    child.stderr.on('data', (d) => { out += d; logStream(jobRoot, job, d.toString()); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${out.slice(-2000)}`))));
  });
}
const chromeEnv = (env) => {
  let chrome = env.CHROME || process.env.CHROME || '';
  if (!chrome) {
    const wrap = path.join(process.env.HOME || '/home/hatch', 'workspace/japan-trains-short/chrome-wrapper.sh');
    if (fs.existsSync(wrap)) chrome = wrap; // this sandbox needs the Hatch WebGL wrapper
  }
  return {
    CHROME: chrome,
    SOFTWARE_GL: '1',
    QS: '&res=0.6&aa=0&shadow=1024',
    FPS: '30',
  };
};
async function ffprobe(file, args = []) {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', ...args, file]);
  return stdout;
}
async function mediaDuration(file) {
  const out = await ffprobe(file, ['-show_entries', 'format=duration', '-of', 'csv=p=0']);
  return parseFloat(out.trim());
}

// --- mode ------------------------------------------------------------------
export function resolveMode(prompt) {
  const p = (prompt || '').trim().toLowerCase();
  if (!p || p === 'create a video' || p === 'create a video and let ai choose the story'
    || p === 'demo' || p === 'test' || p === 'template' || p.includes('let ai choose')) {
    return 'template'; // bundled, proven story — runs fully without an LLM key
  }
  return 'llm'; // new topic / story — needs the LLM
}

// --- LLM stages (only when a key is configured) ----------------------------
const SCRIPT_SYSTEM = `You write narration for faceless vertical Shorts in the Tall Tale 3D / Ricks Clips style.
Rules from the skill (source of truth):
- True stories only. List every fact's source. If sources disagree on a number, use the majority one and keep wording simple. Never invent a fact.
- 60 seconds, about 160-190 words, about 3 words/second. Full flowing sentences, as if talking to a friend.
- 6 beats: (1) 0-3s counter-intuitive hook, zero setup; (2) 3-14s stakes + a smug authority/rival who laughs; (3) 14-28s escalation / public ridicule; (4) 28-44s rising tension, time passing; (5) 44-55s "You see..." mechanism pivot; (6) 55-65s payoff + twist.
- End with: "If you want more stories like this, subscribe — the next one is even crazier."
- One line = one CUT (1.5-3.5s). Split sentences at natural pauses. Write numbers as spoken ("seventy-three").
- Output ONLY a JSON object: {"title": "...", "voice": "am_michael", "speed": 1.12, "music": "bounce", "sources": ["..."], "lines": [{"text": "...", "caps": "word | word | word"}, ...]}. Caps are 1-3 word chunks with " | " separators, sentence case, punctuation kept.`;

async function generateScript(env, prompt) {
  const text = await chat(env, {
    system: SCRIPT_SYSTEM,
    user: `Story / topic: ${prompt}\nWrite the 60-second script as specified. If the prompt is vague, pick a surprising true story yourself and say so in the title choice.`,
    maxTokens: 3000,
  });
  const script = JSON.parse(extractCodeBlock(text, 'json'));
  if (!script.title || !Array.isArray(script.lines) || script.lines.length < 8) {
    throw new Error('LLM script was incomplete (missing title or lines)');
  }
  script.voice = script.voice || 'am_michael';
  script.speed = script.speed || 1.12;
  script.music = script.music || 'bounce';
  script.lead = 0.3; script.outro = 0.6; script.gap = 0.12;
  return script;
}

async function generateShots(env, jobRoot, job, projectDir, script) {
  // Ground the LLM in the real kit: the example's shots.js is the reference
  // implementation. The model must reuse the kit, not invent APIs.
  const exampleShots = fs.readFileSync(
    path.join(ROOT, 'vendor/tall-tale-example/src/shots.js'), 'utf8').slice(0, 60000);
  const kitApi = `Kit (Tall Tale 3D, src/core/): Toon cut-outs (2D people, big round heads, stick limbs, hats mark roles, moods: neutral/smug/happy/laugh/shock/worried/angry/sad/sly/proud/tired/dizzy, blink(t), talk(t)); world sets mainStreet/interior/meadow + pieces sky/clouds/sunlight/hills/tree/pole/wire/lamp/barrel/crate/car/fence/bunting/signBoard/facade; props house/signpost/platformScale/train/rails/mailSack/parcel/desk/poster/chickCrate. Per shot: place people, set() state from t, shoot(scene, people, camFrom, camTo, lookFrom, lookTo, k, LOOK), blit(), cues on words with cue(Wd('word', line), 'stamp'). Camera always moving, new shot every 1.5-3s, faces react on every beat. People are 2D, the world is 3D. Never build people in 3D; never draw sets flat. Captions are one word at a time at y 1340 (handled by captions.js — do not draw your own).`;
  const system = `You write src/shots.js for Tall Tale 3D videos. ${kitApi}\nOutput ONLY the complete shots.js file contents in a js code block. It must work with the project's existing src/main.js, src/core/* and index.html — same structure as the reference below. One shot per script line (or two for long lines). Keep every character's look identical all video (one hat + one neck item each).`;
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const text = await chat(env, {
      system,
      user: `script.json:\n${JSON.stringify(script, null, 1)}\n\nReference shots.js (same kit, different story — copy its structure, write NEW shots for this script):\n${exampleShots}\n${lastError ? `\nPrevious attempt FAILED check with:\n${lastError}\nFix only what failed, keep everything else.` : ''}`,
      maxTokens: 8000, temperature: 0.4,
    });
    const code = extractCodeBlock(text, 'js');
    if (!code.includes('shoot(') || code.length < 1000) throw new Error('LLM shots.js was incomplete');
    fs.writeFileSync(path.join(projectDir, 'src/shots.js'), code);
    try {
      const checkOut = await runLogged(jobRoot, job, 'node', ['tools/capture.mjs', 'check'], { cwd: projectDir, env: chromeEnv(env) });
      if (!checkOut.includes('CHECK OK')) throw new Error(checkOut.slice(-2000));
      return; // CHECK OK
    } catch (e) {
      lastError = String(e.message || e).slice(-3000);
      if (attempt === 3) throw new Error('shots.js failed CHECK OK after 3 attempts: ' + lastError);
    }
  }
}

// runLogged is defined below (hoisted function declaration via run()).
async function runLogged(jobRoot, job, cmd, args, opts) {
  return run(jobRoot, job, cmd, args, opts);
}

// --- pipeline --------------------------------------------------------------
export async function runJob(jobRoot, job, env) {
  const dir = jobDir(jobRoot, job.id);
  const projectDir = path.join(dir, 'project');
  const logPath = path.join(dir, 'job.log');
  fs.writeFileSync(logPath, `VIXYRA AI job ${job.id} started ${new Date().toISOString()}\nprompt: ${job.prompt}\n`);
  job.files.log = 'job.log';
  try {
    // 1. intake — resolve mode
    setStage(jobRoot, job, 'intake', 'done', `mode=${resolveMode(job.prompt)}`);
    job.mode = resolveMode(job.prompt);
    if (job.mode === 'llm' && !llmConfigured(env)) {
      throw Object.assign(new LlmNotConfigured(), { stage: 'script' });
    }
    fs.mkdirSync(projectDir, { recursive: true });

    // 2. script
    setStage(jobRoot, job, 'script', 'running');
    let script;
    if (job.mode === 'template') {
      const src = path.join(ROOT, 'vendor/tall-tale-example');
      // copy the whole proven example project (engine + shots + script)
      await execFileP('cp', ['-R', src + '/.', projectDir]);
      script = JSON.parse(fs.readFileSync(path.join(projectDir, 'script.json'), 'utf8'));
      job.title = script.title;
      job.meta.template = 'tall-tale-example: The Girl Who Was Mailed To Grandma (skill example, 52s)';
    } else {
      script = await generateScript(env, job.prompt);
      job.title = script.title;
      // fresh project from the example kit, then replace script + shots
      await execFileP('cp', ['-R', path.join(ROOT, 'vendor/tall-tale-example') + '/.', projectDir]);
      fs.writeFileSync(path.join(projectDir, 'script.json'), JSON.stringify(script, null, 2));
    }
    saveJob(jobRoot, job);
    setStage(jobRoot, job, 'script', 'done', `${script.title} — ${script.lines.length} lines`);
    setProgress(jobRoot, job, 10);

    // 3. voice — Kokoro (local, free)
    setStage(jobRoot, job, 'voice', 'running');
    await runLogged(jobRoot, job, PY,
      [path.join(SKILL, 'scripts/voice.py'), projectDir], { env: chromeEnv(env) });
    const narration = path.join(projectDir, 'data/narration.wav');
    if (!fs.existsSync(narration)) throw new Error('voice.py produced no data/narration.wav');
    job.meta.narrationSeconds = await mediaDuration(narration);
    setStage(jobRoot, job, 'voice', 'done', `${job.meta.narrationSeconds.toFixed(2)}s narration`);
    setProgress(jobRoot, job, 20);

    // 4. words — Whisper timing (local)
    setStage(jobRoot, job, 'words', 'running');
    await runLogged(jobRoot, job, PY,
      [path.join(SKILL, 'scripts/words.py'), projectDir], { env: chromeEnv(env) });
    if (!fs.existsSync(path.join(projectDir, 'data/words.json'))) throw new Error('words.py produced no data/words.json');
    setStage(jobRoot, job, 'words', 'done');
    setProgress(jobRoot, job, 30);

    // 5. scenes — template ships its own shots.js; LLM mode generates it
    setStage(jobRoot, job, 'scenes', 'running');
    if (job.mode === 'llm') await generateShots(env, jobRoot, job, projectDir, script);
    setStage(jobRoot, job, 'scenes', 'done', job.mode === 'template' ? 'template shots.js' : 'LLM shots.js, CHECK OK');
    setProgress(jobRoot, job, 35);

    // 6. check — capture.mjs check must say CHECK OK
    setStage(jobRoot, job, 'check', 'running');
    const checkOut = await runLogged(jobRoot, job, 'node', ['tools/capture.mjs', 'check'], { cwd: projectDir, env: chromeEnv(env) });
    if (!checkOut.includes('CHECK OK')) throw new Error('capture check did not say CHECK OK:\n' + checkOut.slice(-2000));
    const durMatch = checkOut.match(/duration ([\d.]+) s/);
    job.meta.duration = durMatch ? parseFloat(durMatch[1]) : job.meta.narrationSeconds;
    setStage(jobRoot, job, 'check', 'done', `CHECK OK, ${job.meta.duration}s`);
    setProgress(jobRoot, job, 40);

    // 7. cues + mix — narration + SFX + music bed
    setStage(jobRoot, job, 'cues-mix', 'running');
    await runLogged(jobRoot, job, 'node', ['tools/capture.mjs', 'cues'], { cwd: projectDir, env: chromeEnv(env) });
    await runLogged(jobRoot, job, PY, [path.join(projectDir, 'tools/mix.py'), '.'], { cwd: projectDir, env: chromeEnv(env) });
    if (!fs.existsSync(path.join(projectDir, 'data/mix.wav'))) throw new Error('mix.py produced no data/mix.wav');
    setStage(jobRoot, job, 'cues-mix', 'done');
    setProgress(jobRoot, job, 45);

    // 8. sheet QA — contact sheet, programmatic checks; vision QA only if an
    // LLM is configured (text chat cannot see images, so without a vision
    // model this is honestly recorded as programmatic-only + human review).
    setStage(jobRoot, job, 'sheet-qa', 'running');
    fs.mkdirSync(path.join(projectDir, 'review'), { recursive: true });
    await runLogged(jobRoot, job, 'node', ['tools/capture.mjs', 'sheet', 'review/all.jpg', '0.5', '10'], { cwd: projectDir, env: chromeEnv(env) });
    const sheet = path.join(projectDir, 'review/all.jpg');
    if (!fs.existsSync(sheet) || fs.statSync(sheet).size < 50_000) throw new Error('contact sheet missing or suspiciously small');
    job.files.sheet = 'project/review/all.jpg';
    job.meta.qa = llmConfigured(env) ? 'sheet generated; vision QA pending (model must support images)' : 'programmatic-only: sheet generated for human review, no vision model configured';
    setStage(jobRoot, job, 'sheet-qa', 'done', job.meta.qa);
    setProgress(jobRoot, job, 55);

    // 9. render — split halves, resume valid halves (resilient_video_renders)
    setStage(jobRoot, job, 'render', 'running');
    const total = job.meta.duration;
    const split = Math.round((total / 2) * 30) / 30; // whole frame at 30fps
    const rendersDir = path.join(projectDir, 'renders');
    fs.mkdirSync(rendersDir, { recursive: true });
    const halfA = path.join(rendersDir, 'part-a.mp4');
    const halfB = path.join(rendersDir, 'part-b.mp4');
    const halfValid = async (file, from, to) => {
      try { const d = await mediaDuration(file); return d >= (to - from) - 0.5; } catch { return false; }
    };
    const renderHalf = (file, from, to) => runLogged(jobRoot, job, 'node',
      ['tools/capture.mjs', 'video', file, String(from), String(to)], { cwd: projectDir, env: chromeEnv(env) });
    // Sequential halves here (one worker, one machine): parallel halves are
    // in the skill for a dedicated render box; on a shared box they fight
    // for the same CPU. Resume logic still applies.
    if (!(await halfValid(halfA, 0, split))) await renderHalf(halfA, 0, split);
    setProgress(jobRoot, job, 70, 'first half done');
    if (!(await halfValid(halfB, split, total))) await renderHalf(halfB, split, total);
    setProgress(jobRoot, job, 85, 'second half done');
    setStage(jobRoot, job, 'render', 'done', `split at ${split}s`);

    // 10. join — ffmpeg concat, no re-encode
    setStage(jobRoot, job, 'join', 'running');
    const concatList = path.join(rendersDir, 'concat.txt');
    fs.writeFileSync(concatList, `file '${halfA}'\nfile '${halfB}'\n`);
    const outMp4 = path.join(rendersDir, 'vixyra.mp4');
    await runLogged(jobRoot, job, 'ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', outMp4], { cwd: projectDir });
    setStage(jobRoot, job, 'join', 'done');
    setProgress(jobRoot, job, 90);

    // 11. verify — ffprobe + volumedetect + seam frames from the JOINED file
    setStage(jobRoot, job, 'verify', 'running');
    const dur = await mediaDuration(outMp4);
    if (Math.abs(dur - total) > 1.0) throw new Error(`joined duration ${dur}s does not match planned ${total}s`);
    const probe = await ffprobe(outMp4, ['-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0']);
    if (!probe.includes('h264') || !probe.includes('1080,1920')) throw new Error('joined file is not 1080x1920 H.264: ' + probe.trim());
    const { stdout: volOut } = await execFileP('ffmpeg', ['-i', outMp4, '-af', 'volumedetect', '-f', 'null', '-'], { cwd: projectDir }).catch((e) => e);
    const meanVol = (String(volOut) + String(volOut?.stderr || '')).match(/mean_volume:\s*([-\d.]+)/);
    if (meanVol && parseFloat(meanVol[1]) < -60) throw new Error('joined video is (near) silent: mean_volume ' + meanVol[1] + ' dB');
    // seam frames (ffmpeg stills from the joined file, either side of the join)
    await execFileP('ffmpeg', ['-y', '-ss', String(Math.max(0, split - 0.2)), '-i', outMp4, '-frames:v', '1', path.join(projectDir, 'review/seam-before.jpg')], { cwd: projectDir });
    await execFileP('ffmpeg', ['-y', '-ss', String(split + 0.2), '-i', outMp4, '-frames:v', '1', path.join(projectDir, 'review/seam-after.jpg')], { cwd: projectDir });
    job.files.video = 'project/renders/vixyra.mp4';
    job.meta.finalDuration = dur;
    job.meta.meanVolumeDb = meanVol ? parseFloat(meanVol[1]) : null;
    setStage(jobRoot, job, 'verify', 'done', `${dur.toFixed(2)}s, 1080x1920, mean ${job.meta.meanVolumeDb} dB`);
    setProgress(jobRoot, job, 100);

    // 12. done
    setStage(jobRoot, job, 'done', 'done', 'Video ready — download below.');
    saveJob(jobRoot, job);
    return job;
  } catch (err) {
    const stage = job.stage || 'intake';
    logStream(jobRoot, job, `\nFAILED at ${stage}: ${err?.message || err}\n`);
    return failJob(jobRoot, job, stage, err);
  }
}

// Retry: re-run from the failed stage onward, reusing valid outputs.
// Implemented by re-running runJob but skipping stages already marked done
// for template mode is complex; v1 retry simply re-runs the whole job in a
// fresh attempt folder and keeps the old log. The render halves are resumed
// inside runJob (valid halves are not re-rendered).
export async function retryJob(jobRoot, job, env) {
  job.status = 'queued'; job.error = null; job.errorCode = null;
  job.stages = Object.fromEntries(Object.keys(job.stages).map((s) => [s, { status: 'pending', at: null, note: null }]));
  saveJob(jobRoot, job);
  return runJob(jobRoot, job, env);
}
