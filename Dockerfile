FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg git \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && pip install --no-cache-dir uv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY cli/pyproject.toml cli/uv.lock cli/README.md ./cli/
COPY server/package.json server/package-lock.json server/tsconfig.json ./server/

RUN npm ci --prefix server

COPY . .

RUN uv sync --frozen --no-dev --project cli \
    && npm run build --prefix server

RUN useradd --create-home --shell /bin/bash sonde \
    && chown -R sonde:sonde /app

USER sonde

ENV NODE_ENV=production \
    SONDE_CLI_DIR=/app/cli \
    PATH=/app/cli/.venv/bin:/usr/local/bin:/usr/bin:/bin \
    PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD python -c "import os, sys, urllib.request; port = os.environ.get('PORT', '3001'); urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3); sys.exit(0)"

CMD ["node", "server/dist/index.js"]
