# syntax=docker/dockerfile:1
# Image for the Nostrich web client (apps/web).

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable
WORKDIR /repo

# ---- build ----
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1

# Manifests first, sources later, so the install layer stays cached until the
# lockfile actually changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/app/package.json packages/app/
COPY packages/hooks/package.json packages/hooks/
COPY packages/nostr/package.json packages/nostr/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter web...

# The Prisma client depends only on the schema, so it stays cached across
# ordinary code changes.
COPY packages/api/prisma packages/api/prisma
RUN pnpm --filter @nostrich/api db:generate

COPY . .
RUN pnpm --filter web build

# ---- runner ----
FROM build AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3400
ENV HOSTNAME=0.0.0.0
EXPOSE 3400
CMD ["pnpm", "--filter", "web", "start"]
