# Alliance HQ video OCR worker — Node 22 glibc (sharp/ffmpeg need glibc, not Alpine).
# Build context: repository root.
#
#   docker build -f deploy/video-worker/Dockerfile \
#     --build-arg VIDEO_WORKER_STANDALONE=1 -t alliance-hq-video-worker .
#
# Do not run db:prepare in this image — Vercel (or ops) applies migrations.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV VIDEO_WORKER_STANDALONE=1
# Middleware inlines VIDEO_WORKER_MODE at build time — must be set here, not only at runtime.
ENV VIDEO_WORKER_MODE=1
# Build-time placeholders so Next can compile without real secrets.
ENV AUTH_SECRET=build-placeholder-auth-secret
ENV TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
ENV NEXT_PUBLIC_APP_URL=http://localhost:3000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:worker

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV VIDEO_WORKER_MODE=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# ffmpeg-static / sharp / tesseract land via standalone NFT + serverExternalPackages.
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
