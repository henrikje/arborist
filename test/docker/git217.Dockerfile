# Build git from source — cached in Docker layers so only runs once.
# GIT_VERSION can be overridden to test other versions.
ARG GIT_VERSION=2.17.0

# ── Stage 1: compile git ──────────────────────────────────────────
FROM debian:bookworm-slim AS builder
ARG GIT_VERSION

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates \
    libcurl4-openssl-dev libexpat1-dev gettext libz-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://mirrors.edge.kernel.org/pub/software/scm/git/git-${GIT_VERSION}.tar.gz" \
    | tar xz -C /tmp \
    && cd "/tmp/git-${GIT_VERSION}" \
    && make prefix=/usr/local -j"$(nproc)" NO_TCLTK=1 all \
    && make prefix=/usr/local NO_TCLTK=1 install

# ── Stage 2: runtime ─────────────────────────────────────────────
FROM debian:bookworm-slim

# Runtime deps for git + bun
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libcurl4 unzip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/git* /usr/local/bin/
COPY --from=builder /usr/local/libexec/git-core/ /usr/local/libexec/git-core/
COPY --from=builder /usr/local/share/git-core/ /usr/local/share/git-core/

# Install Bun (pinned for reproducibility)
ARG BUN_VERSION=1.3.10
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/root/.bun bash -s "bun-v${BUN_VERSION}"
ENV PATH="/root/.bun/bin:${PATH}"

# Git config for tests
RUN git config --global user.name "Test" \
    && git config --global user.email "test@localhost"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app
ENTRYPOINT ["/entrypoint.sh"]
