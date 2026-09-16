# Build context is the REPO ROOT, not packages/server — @wayfinder/server
# depends on @wayfinder/engine via `workspace:*`, so the engine source and
# the workspace manifests have to be inside the image.
#
# Base image ships Chromium plus its shared libraries. playwright-core
# (used by the RBI and NSE adapters) bundles no browser binary of its own,
# so it relies on the browsers this image already installs (see the
# CHROMIUM_EXECUTABLE_PATH note further down).
# Tag MUST track the playwright-core version pnpm actually resolves
# (currently 1.62.1 — package.json's ^1.48.0 floats upward). A mismatched
# base image ships a Chromium build the client doesn't speak.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

# The base image ships Node 24 (ABI v137), and better-sqlite3@11.10.0
# publishes prebuilt linux-x64 binaries only for ABI v108/v115/v127/v131
# (Node 18/20/22/23). On Node 24 prebuild-install finds nothing and falls
# back to node-gyp, which then dies on this image with "not found: make".
# Downgrading to Node 22 (ABI v127) gets a prebuilt binary and skips the
# source build entirely — faster than installing build-essential, and it
# keeps a C++ toolchain out of the runtime image.
#
# The base image leaves its own /etc/apt/sources.list.d/nodesource.list
# pointing at node_24.x. Merely ADDING a node_22.x repo does nothing —
# apt sees both and installs the higher version. So overwrite that file
# (not add a second one) and pin the package, or this silently no-ops.
RUN rm -f /etc/apt/sources.list.d/nodesource.list \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
    && printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 1001\n' \
       > /etc/apt/preferences.d/nodesource \
    && apt-get update \
    && apt-get install -y --no-install-recommends --allow-downgrades nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node -v \
    && node -e "const m=process.versions.modules; if (m!=='127') { throw new Error('Expected Node 22 (ABI 127), got '+process.version+' (ABI '+m+')'); }"

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

# Runtime dependency, not a test fixture: pipeline/currentSnapshot.ts
# resolves ../../../../mock/snapshot.json from the repo root as the
# baseline every snapshot is built on. Without it /api/snapshot,
# /api/datapoints and /api/snapshots/draft-status all 500 with ENOENT.
COPY mock ./mock

# CHROMIUM_EXECUTABLE_PATH is deliberately left UNSET. The base image
# installs browsers under /ms-playwright and sets PLAYWRIGHT_BROWSERS_PATH
# to match, so playwright-core's default resolution finds Chromium on its
# own. config.ts maps an empty env var to undefined, which is exactly the
# "use default resolution" case rbi.ts documents.

# Set only now, AFTER install. Setting it before `pnpm install` would make
# pnpm skip devDependencies — and tsx, the actual runtime command below,
# is a devDependency.
ENV NODE_ENV=production

WORKDIR /app/packages/server
EXPOSE 3001
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
