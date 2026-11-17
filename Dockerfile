FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip python3-venv chromium curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Chrome for headless rendering (chromium binary); capture.mjs picks it up
# via CHROME env or /usr/bin/chromium.
ENV CHROME=/usr/bin/chromium
ENV FACELESS_SKILL=/app/skill
# Listen on all interfaces; the platform sets $PORT (Render/Railway).
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY . /app
# The faceless-shorts skill + kit is vendored in ./skill (see README).
# LLM config comes from platform env vars at runtime:
#   LLM_API_KEY, LLM_API_BASE_URL, LLM_MODEL (Groq free tier recommended
#   for hosted use — no 4.7 GB local model on the server). Ollama is the
#   self-hosted/laptop path, not the hosted path.
RUN mkdir -p /app/jobs /root/.faceless-shorts \
 && python3 -m venv /root/.faceless-shorts/venv \
 && /root/.faceless-shorts/venv/bin/pip install -q numpy scipy kokoro-onnx faster-whisper \
 && bash scripts/setup.sh || echo "setup needs network/models at first run — see README"
EXPOSE 3000
CMD ["node", "server.mjs"]
