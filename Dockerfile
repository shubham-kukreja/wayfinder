# Build context is the REPO ROOT, not packages/server — @wayfinder/server
# depends on @wayfinder/engine via `workspace:*`, so the engine source and
# the workspace manifests have to be inside the image.
#
# Base image ships Chromium plus its shared libraries. playwright-core
# (used by the RBI and NSE adapters) bundles no browser binary of its own,
# so CHROMIUM_EXECUTABLE_PATH is pointed at the system Chromium below.
# Tag MUST track the playwright-core version pnpm actually resolves
# (currently 1.62.1 — package.json's ^1.48.0 floats upward). A mismatched
# base image ships a Chromium build the client doesn't speak.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy manifests first so `pnpm install` is cached across source-only edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json ./packages/engine/
COPY packages/server/package.json ./packages/server/

# --frozen-lockfile so a drifted lockfile fails the build instead of
# silently resolving different versions than local. The server runs via
# tsx (no build step), so devDependencies are needed at runtime and we
# deliberately do NOT pass --prod here.
RUN pnpm install --frozen-lockfile --filter @wayfinder/server...

COPY packages/engine ./packages/engine
COPY packages/server ./packages/server

# CHROMIUM_EXECUTABLE_PATH is deliberately left UNSET. The base image
# installs browsers under /ms-playwright and sets PLAYWRIGHT_BROWSERS_PATH
# to match, so playwright-core's default resolution finds Chromium on its
# own. config.ts maps an empty env var to undefined, which is exactly the
# "use default resolution" case rbi.ts documents.

WORKDIR /app/packages/server
EXPOSE 3001
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
