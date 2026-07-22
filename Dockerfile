# --- Stage 1: Install dependencies + build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package metadata first for better cache reuse.
COPY package*.json ./

RUN if [ -f package-lock.json ]; then \
      npm ci --frozen-lockfile; \
    else \
      npm install --no-audit --no-fund; \
    fi

COPY . .

RUN npm run build

# --- Stage 2: Production runtime image ---
FROM node:20-alpine

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nitro

WORKDIR /app

COPY --from=builder --chown=nitro:nodejs /app/.output .output
COPY --from=builder --chown=nitro:nodejs /app/package.json package.json
COPY --from=builder --chown=nitro:nodejs /app/node_modules node_modules
COPY --from=builder --chown=nitro:nodejs /app/drizzle.config.ts drizzle.config.ts
COPY --from=builder --chown=nitro:nodejs /app/src/db/migrations src/db/migrations

USER nitro

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
