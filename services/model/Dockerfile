FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    MLFLOW_DISABLE_AGENT_HINT=1 \
    GIT_PYTHON_REFRESH=quiet

WORKDIR /app

# Dependencies first (cached layer; torch is the slow part), then the project itself.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

RUN useradd --create-home --uid 1000 app
USER app
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000
# Importing PyTorch is slow on small droplets.
HEALTHCHECK --interval=15s --timeout=3s --start-period=120s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
# One worker: the monitoring loop is in-process state and must not be duplicated.
CMD ["uvicorn", "model_service.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
