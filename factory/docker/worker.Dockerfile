# RepoHQ factory sandbox worker (docs/autonomous-factory.md §14, roadmap Phase 76).
# Runs a target repo's install, checks and the model harness (Aider / Claude Code) with:
#   - no GitHub credential, no host mounts, no Docker socket, no host environment
#   - a non-root user, all capabilities dropped, no-new-privileges, CPU/memory/pid limits
#   - network only through the egress gateway (package registries + LiteLLM)
# The host keeps git push / gh pr create, after its judge has passed the diff.
FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.291
ARG AIDER_VERSION=0.86.2

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 python3-venv procps \
 && rm -rf /var/lib/apt/lists/*

# Aider (M0 harness) in its own venv.
RUN python3 -m venv /opt/aider \
 && /opt/aider/bin/pip install --no-cache-dir "aider-chat==${AIDER_VERSION}" \
 && ln -s /opt/aider/bin/aider /usr/local/bin/aider

# Claude Code (M1/M2 harness) plus the package managers repos use.
RUN npm install -g --no-fund --no-audit "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" pnpm@10 \
 && npm cache clean --force

RUN useradd --create-home --uid 10001 --shell /bin/bash worker \
 && mkdir -p /workspace \
 && chown worker:worker /workspace

USER worker
# Commits made inside the sandbox never leave it: the host re-applies the judged patch.
RUN git config --global user.name "RepoHQ Factory Sandbox" \
 && git config --global user.email "factory-sandbox@localhost" \
 && git config --global advice.detachedHead false \
 && git config --global safe.directory /workspace

ENV CI=1 NO_COLOR=1 FORCE_COLOR=0 \
    LITELLM_LOCAL_MODEL_COST_MAP=True \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    DISABLE_AUTOUPDATER=1
WORKDIR /workspace
