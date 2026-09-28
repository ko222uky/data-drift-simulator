FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /bin/

ARG MLFLOW_VERSION=3.16.1
RUN uv pip install --system --no-cache "mlflow==${MLFLOW_VERSION}" "psycopg[binary]>=3.2"

ENV PYTHONUNBUFFERED=1 MLFLOW_DISABLE_AGENT_HINT=1

RUN useradd --create-home --uid 1000 mlflow && mkdir /mlartifacts && chown mlflow /mlartifacts
USER mlflow
WORKDIR /home/mlflow

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/mlflow/health')"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
