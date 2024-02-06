# Install dependencies only when needed
FROM --platform=linux/amd64 node:20-alpine AS deps
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./
RUN yarn global add pnpm && pnpm i

# Rebuild the source code only when needed
FROM --platform=linux/amd64 node:20-alpine AS builder

# These variables are passed on run time
ENV DATABASE_URL=default
ENV NEXTAUTH_SECRET=default
ENV NEXTAUTH_URL=default
ENV GOOGLE_CLIENT_ID=default
ENV GOOGLE_CLIENT_SECRET=default
ENV AZURE_AD_TENANT_ID=default
ENV AZURE_AD_CLIENT_ID=default
ENV AZURE_AD_CLIENT_SECRET=default
ENV S3_PUBLIC_KEY=default
ENV S3_SECRET_KEY=default

# These variables are passed on build time
ARG REDIS_URL

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn global add pnpm && SKIN_ENV_VALIDATION=1 pnpm run build

FROM node:20-alpine AS runner

# Puppeteer downloaded chromium will not work on Alpine
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install chromium and support packages, add "puppeteer" user
RUN apk add --no-cache chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ghostscript

ENV NODE_ENV production

WORKDIR /app

COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

ENV PORT 3000
# set hostname to localhost
ENV HOSTNAME "0.0.0.0"

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD ["server.js"]
