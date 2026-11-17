// VIXYRA AI server — one textbox + Generate, real job queue, real pipeline.
// Node 22+, zero npm dependencies (built-in http/fs only).
// Start:  node server.mjs        (reads .env if present)
// Then:   http://127.0.0.1:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEnv, llmConfigured } from './src/llm.mjs';
import { newJob, loadJob, listJobs, jobDir, saveJob } from './src/jobs.mjs';
import { runJob, retryJob } from './src/pipeline.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const env = loadEnv(ROOT);
// This sandbox needs the Hatch WebGL wrapper for headless Chrome; on a
// normal host CHROME from .env / PATH is used instead.
if (!env.CHROME) {
  const wrap = path.join(process.env.HOME || '/home/hatch', 'workspace/japan-trains-short/chrome-wrapper.sh');
  if (fs.existsSync(wrap)) env.CHROME = wrap;
}
const PORT = parseInt(env.PORT || '3000', 10);
const HOST = env.HOST || '127.0.0.1';
const execFileP = promisify(execFile);

// --- job queue: ONE job at a time. Rendering is CPU-heavy; parallel jobs
// would fight each other and the user's other renders. ----------------------
let active = null;
const queue = [];
async function pump() {
  if (active || !queue.length) return;
  const job = queue.shift();
  active = job.id;
  try { await runJob(ROOT, job, env); }
  catch (e) { console.error('job', job.id, 'crashed:', e); }
  finally { active = null; pump(); }
}

// --- static files -----------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.wav': 'audio/wav' };
function send(res, code, body, type = 'text/plain') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}
function sendJson(res, code, obj) { send(res, code, JSON.stringify(obj), 'application/json'); }
async function readBody(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 200_000) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}

// --- health: what can actually run right now (no guessing) -----------------
async function toolCheck() {
  const out = { node: process.version, llm: llmConfigured(env) };
  for (const [name, cmd, args] of [
    ['ffmpeg', 'ffmpeg', ['-version']], ['ffprobe', 'ffprobe', ['-version']],
  ]) {
    try { await execFileP(cmd, args, { timeout: 15000 }); out[name] = 'ok'; }
    catch (e) { out[name] = 'missing: ' + String(e?.message || e).slice(0, 120); }
  }
  // Chrome: --version is not a valid probe for the Hatch wrapper (it needs
  // the WebGL policy + headless flags capture.mjs supplies). Existence +
  // executability is the honest check; the real proof is a capture run.
  const chromePath = env.CHROME || '';
  let chromeOk = false;
  if (chromePath && fs.existsSync(chromePath)) {
    try { fs.accessSync(chromePath, fs.constants.X_OK); chromeOk = true; } catch { /* not executable */ }
  }
  if (chromeOk) out.chrome = 'ok (' + chromePath + ')';
  else {
    try { await execFileP('google-chrome', ['--version'], { timeout: 15000 }); out.chrome = 'ok'; }
    catch (e) { out.chrome = 'missing: ' + String(e?.message || e).slice(0, 120); }
  }
  try {
    await execFileP(path.join(env.FACELESS_SKILL || '/home/hatch/workspace/custom-skills/faceless-shorts', 'scripts/py'),
      ['-c', 'import kokoro_onnx, faster_whisper; print("ok")'], { timeout: 30000 });
    out.voiceWhisper = 'ok';
  } catch (e) { out.voiceWhisper = 'missing: ' + String(e?.message || e).slice(0, 120); }
  out.template = fs.existsSync(path.join(ROOT, 'vendor/tall-tale-example/script.json')) ? 'ok' : 'missing';
  return out;
}

// --- server -----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;

    if (p === '/api/health') return sendJson(res, 200, await toolCheck());
    if (p === '/api/jobs' && req.method === 'GET') return sendJson(res, 200, listJobs(ROOT));
    if (p === '/api/jobs' && req.method === 'POST') {
      const body = await readBody(req);
      const job = newJob(ROOT, body.prompt || '');
      queue.push(job);
      pump();
      return sendJson(res, 201, job);
    }
    const m = p.match(/^\/api\/jobs\/([0-9a-f]+)(?:\/(video|sheet|log|retry))?$/);
    if (m) {
      const job = loadJob(ROOT, m[1]);
      if (!job) return sendJson(res, 404, { error: 'job not found' });
      if (req.method === 'POST' && m[2] === 'retry') {
        if (active) return sendJson(res, 409, { error: 'another job is running — retry waits in line' });
        active = job.id;
        retryJob(ROOT, job, env).finally(() => { active = null; pump(); });
        return sendJson(res, 202, job);
      }
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      if (!m[2]) return sendJson(res, 200, job);
      const fileMap = { video: job.files.video, sheet: job.files.sheet, log: job.files.log };
      const rel = fileMap[m[2]];
      if (!rel) return sendJson(res, 404, { error: 'file not ready yet' });
      const file = path.join(jobDir(ROOT, job.id), rel);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'file not found on disk' });
      const ext = path.extname(file);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': fs.statSync(file).size,
        ...(m[2] === 'video' ? { 'Content-Disposition': `attachment; filename="vixyra-${job.id}.mp4"` } : {}),
      });
      return fs.createReadStream(file).pipe(res);
    }

    // static frontend
    let file = p === '/' ? '/index.html' : p;
    const fp = path.join(ROOT, 'public', file);
    if (!fp.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      return send(res, 404, 'not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    return fs.createReadStream(fp).pipe(res);
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`VIXYRA AI running at http://${HOST}:${PORT}`);
  console.log(`LLM configured: ${llmConfigured(env)} (new topics need a key; template job runs without one)`);
});
