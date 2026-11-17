// VIXYRA AI frontend — polls the real job API, shows real stages.
// Nothing here invents progress: every number comes from /api/jobs/:id.
const $ = (s) => document.querySelector(s);
let currentId = null;
let timer = null;

async function health() {
  try {
    const h = await (await fetch('/api/health')).json();
    const lines = Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('  ·  ');
    $('#health').textContent = lines + (h.llm ? '' : '\nNo LLM key — new topics will wait for one. The bundled template story still runs end-to-end.');
  } catch { $('#health').textContent = 'Server not reachable.'; }
}

async function listJobs() {
  try {
    const jobs = await (await fetch('/api/jobs')).json();
    $('#jobs').innerHTML = jobs.slice(0, 8).map((j) =>
      `<li><a href="#" data-id="${j.id}">${j.title || j.prompt || j.id}</a> — ${j.status} · ${j.stage} · ${j.progress}%</li>`).join('') || '<li>No jobs yet.</li>';
    document.querySelectorAll('#jobs a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openJob(a.dataset.id); }));
  } catch { /* ignore */ }
}

function renderJob(j) {
  $('#job').hidden = false;
  $('#job-title').textContent = j.title || j.prompt || ('Job ' + j.id);
  $('#job-status').textContent = `${j.status} — ${j.stage} (${j.progress}%)` + (j.meta?.note ? ` — ${j.meta.note}` : '');
  $('#bar-fill').style.width = j.progress + '%';
  $('#stages').innerHTML = Object.entries(j.stages).map(([name, s]) =>
    `<div class="${s.status}">${name}<br><small>${s.status}${s.note ? ' — ' + s.note : ''}</small></div>`).join('');
  const err = $('#job-error');
  if (j.error) { err.hidden = false; err.textContent = j.error; } else err.hidden = true;
  $('#retry').hidden = !(j.status === 'failed' || j.status === 'awaiting_llm');
  const dl = $('#download');
  if (j.files?.video) {
    dl.hidden = false; dl.href = `/api/jobs/${j.id}/video`;
    const v = $('#player'); v.hidden = false; if (!v.src.includes(j.id)) v.src = `/api/jobs/${j.id}/video`;
  } else { dl.hidden = true; $('#player').hidden = true; }
  const sh = $('#sheet');
  if (j.files?.sheet) { sh.hidden = false; if (!sh.src.includes(j.id)) sh.src = `/api/jobs/${j.id}/sheet`; }
  else sh.hidden = true;
}

async function poll() {
  if (!currentId) return;
  try {
    const j = await (await fetch('/api/jobs/' + currentId)).json();
    renderJob(j);
    const log = await (await fetch('/api/jobs/' + currentId + '/log')).text().catch(() => '');
    if (log) $('#log').textContent = log.slice(-6000);
    if (j.status === 'done' || j.status === 'failed' || j.status === 'awaiting_llm') { clearInterval(timer); timer = null; }
    listJobs();
  } catch { /* keep polling */ }
}

function openJob(id) {
  currentId = id;
  if (timer) clearInterval(timer);
  timer = setInterval(poll, 3000);
  poll();
  document.querySelector('#job').scrollIntoView({ behavior: 'smooth' });
}

$('#gen-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#generate');
  btn.disabled = true; btn.textContent = 'Starting…';
  try {
    const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: $('#prompt').value }) });
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || 'could not start job');
    openJob(job.id);
  } catch (err) { alert('Could not start job: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = '▶ Generate Video'; }
});

$('#retry').addEventListener('click', async () => {
  if (!currentId) return;
  await fetch('/api/jobs/' + currentId + '/retry', { method: 'POST' });
  openJob(currentId);
});

health(); listJobs(); setInterval(listJobs, 15000);
