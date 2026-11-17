// Job store — one folder per job under jobs/<id>/, job.json is the truth.
// Assets are preserved in the job folder (project copy, renders, review).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const STAGES = [
  'intake', 'script', 'voice', 'words', 'scenes',
  'check', 'cues-mix', 'sheet-qa', 'render', 'join', 'verify', 'done',
];

export function newJob(root, prompt) {
  const id = crypto.randomBytes(6).toString('hex');
  const dir = path.join(root, 'jobs', id);
  fs.mkdirSync(dir, { recursive: true });
  const job = {
    id, prompt: (prompt || '').trim(), mode: null, title: null,
    status: 'queued', stage: 'intake', stageIndex: 0,
    progress: 0, error: null, errorCode: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    stages: Object.fromEntries(STAGES.map((s) => [s, { status: 'pending', at: null, note: null }])),
    files: {}, // sheet, video, script, log
    meta: {},
  };
  saveJob(root, job);
  return job;
}

export function jobDir(root, id) { return path.join(root, 'jobs', id); }
export function jobPath(root, id) { return path.join(jobDir(root, id), 'job.json'); }

export function loadJob(root, id) {
  try { return JSON.parse(fs.readFileSync(jobPath(root, id), 'utf8')); }
  catch { return null; }
}

export function saveJob(root, job) {
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(jobPath(root, job.id), JSON.stringify(job, null, 2));
}

export function listJobs(root) {
  const base = path.join(root, 'jobs');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base)
    .map((id) => loadJob(root, id)).filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function setStage(root, job, stage, status, note) {
  job.stage = stage;
  job.stageIndex = STAGES.indexOf(stage);
  job.stages[stage] = { status, at: new Date().toISOString(), note: note || null };
  job.status = status === 'failed' ? 'failed'
    : status === 'awaiting_llm' ? 'awaiting_llm'
    : stage === 'done' ? 'done' : 'running';
  saveJob(root, job);
}

export function setProgress(root, job, progress, note) {
  job.progress = Math.max(0, Math.min(100, progress));
  if (note) job.meta.note = note;
  saveJob(root, job);
}

export function failJob(root, job, stage, err) {
  job.error = String(err?.message || err);
  job.errorCode = err?.code || null;
  setStage(root, job, stage, err?.code === 'LLM_NOT_CONFIGURED' ? 'awaiting_llm' : 'failed', job.error);
  return job;
}
