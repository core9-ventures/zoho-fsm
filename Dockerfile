FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# The build only needs placeholder values; the real ones are read when the container starts.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    DIRECT_DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build-build-build-build-build-build-build \
    JWT_SECRET=build-build-build-build-build-build-build \
    pnpm prisma generate && \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    DIRECT_DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build-build-build-build-build-build-build \
    JWT_SECRET=build-build-build-build-build-build-build \
    pnpm build
ENV NODE_ENV=production
EXPOSE 3000
# Apply new migrations, create the Super Admin on first run (skipped if it exists), then start.
CMD ["sh", "-c", "pnpm db:deploy && pnpm bootstrap && pnpm start"]
