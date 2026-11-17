// LLM provider — OpenAI-compatible chat completions (OpenAI, Anthropic via
// compatible gateway, Gemini OpenAI-compat endpoint, local Ollama, etc.).
// This is the ONLY place that talks to an LLM. Everything else is local code.
// If no key is configured, chat() throws LlmNotConfigured — the job is marked
// "awaiting_llm" and NEVER fakes a script, scene code, or video.
import fs from 'node:fs';

export class LlmNotConfigured extends Error {
  constructor() {
    super('LLM_API_KEY is not set. Add it to .env to generate new stories, scripts and scene code. Only the bundled template job can run without it.');
    this.name = 'LlmNotConfigured';
    this.code = 'LLM_NOT_CONFIGURED';
  }
}

export function loadEnv(root) {
  const env = { ...process.env };
  for (const p of [root + '/.env', process.cwd() + '/.env']) {
    try {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch { /* no .env — env vars only */ }
  }
  return env;
}

export function llmConfigured(env) {
  return Boolean((env.LLM_API_KEY || '').trim());
}

export function llmConfig(env) {
  return {
    baseUrl: (env.LLM_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: env.LLM_MODEL || 'gpt-4o-mini',
    qaModel: env.LLM_QA_MODEL || env.LLM_MODEL || 'gpt-4o-mini',
    key: (env.LLM_API_KEY || '').trim(),
  };
}

// Minimal chat-completions call. No streaming, no tools. Returns text.
// Throws on non-2xx with the provider's error body (surfaced to the job log).
export async function chat(env, { system, user, model, maxTokens = 4000, temperature = 0.7 }) {
  const cfg = llmConfig(env);
  if (!cfg.key) throw new LlmNotConfigured();
  const res = await fetch(cfg.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: model || cfg.model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('LLM returned no content');
  return text;
}

// Extract the first ```json / ```js fenced block, or the raw text.
export function extractCodeBlock(text, lang) {
  const re = new RegExp('```(?:' + (lang || 'json|js|javascript') + ')?\\s*\\n([\\s\\S]*?)```', 'i');
  const m = text.match(re);
  return (m ? m[1] : text).trim();
}
