# Roqqu Studio API — Cloud Run image (#84).
# Sandbox-only execution; no production Roqqu credentials ever run here.
FROM python:3.12-slim AS base

RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml uv.lock* ./
COPY roqqu_studio ./roqqu_studio

RUN uv pip install --system --no-cache ".[api,ai]"

ENV PYTHONUNBUFFERED=1
EXPOSE 8080

# Cloud Run sets $PORT; default to 8080 for local `docker run`.
CMD ["sh", "-c", "uvicorn roqqu_studio.api.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
